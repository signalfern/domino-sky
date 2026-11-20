# Domino Sky Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive airport-closure delay simulator with a Gemini dispatcher whose numbers are verified against a deterministic engine.

**Architecture:** Pure TypeScript engine (`src/engine`) runs in the browser. React UI renders SVG map, timeline and tables from engine output. One Vercel function (`api/dispatch.ts`) calls Gemini; the client verifies every number in the reply.

**Tech Stack:** Vite 6, React 18, TypeScript 5, Vitest 2, plain CSS, Vercel Node function, Gemini REST API.

**Spec:** `docs/superpowers/specs/2026-11-20-domino-sky-design.md`

## Global Constraints
- All times are minutes from 00:00 IST; display `HH:MM`, values ≥ 1440 display with `+1`.
- Min turnaround 30 min; spare crew report 45 min before first departure; max duty 600.
- Stranded cost weight: 180 passenger-minutes per stranded passenger.
- No external map tiles or country borders. No runtime dependencies beyond React.
- API key only server-side via `GEMINI_API_KEY`; model via `GEMINI_MODEL`.
- App must work fully with no AI key (rule-based fallback).

## Review Focus
- Closure that pushes flights past midnight → times show `+1 HH:MM`, no crash.
- Closure with end ≤ start → ignored (no-op), UI prevents it.
- Cancelling the first leg of a chain → later legs cancelled until one starts where the aircraft is.
- Spare offered only for flights departing its base, at or after `available_from`; each spare once.
- AI reply with unknown plan id or unverified number → retry once, then fallback; badge says so.

---

### Task 1: Scaffold + data + time utils
**Files:** Create `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `vercel.json`, `src/main.tsx`, `src/data/flight_network.json` (copy), `src/engine/types.ts`, `src/engine/time.ts`, `tests/time.test.ts`

**Interfaces — Produces:**
- `toMin(hhmm: string): number`, `fmt(min: number): string` (`"+1 00:15"` for ≥1440)
- Types: `Airport, Flight, Connection, Crew, Spare, Network` (raw JSON shapes), `loadNetwork(): Network`

- [ ] Test: `toMin("08:50")===530`, `fmt(530)==="08:50"`, `fmt(1455)==="+1 00:15"`.
- [ ] Implement, run `npx vitest run`, expect PASS. Commit `chore: scaffold domino sky`.

### Task 2: Simulation engine
**Files:** Create `src/engine/simulate.ts`, `tests/simulate.test.ts`

**Interfaces — Produces:**
```ts
type Closure = { id: string; airport: string; start: number; end: number };
type Action = { kind: 'cancel'; flightId: string } | { kind: 'swap'; spareId: string; flightId: string } | { kind: 'hold'; connectionId: string };
type Scenario = { closures: Closure[]; actions: Action[] };
type Cause = { kind: 'origin_closed'; airport: string; until: number } | { kind: 'dest_closed'; airport: string; until: number }
  | { kind: 'late_aircraft'; prevFlightId: string; readyAt: number } | { kind: 'held_for_connection'; connectionId: string; readyAt: number }
  | { kind: 'spare_ready'; spareId: string; readyAt: number };
type CancelReason = 'user' | 'aircraft_out_of_position' | 'crew_timeout';
type FlightResult = { id; tail; crewId; origin; destination; pax; schedDep; schedArr; dep; arr; delay; cancelled: boolean;
  cancelReason?: CancelReason; cause?: Cause /* binding constraint */; rootClosureId?: string; depth: number /* domino generation */ };
type ConnResult = { id; airport; from; to; pax; gap: number | null; min: number; status: 'ok' | 'missed' | 'cancelled' };
type CrewResult = { id; tail; dutyStart; dutyEnd: number; duty: number; max: number; timedOut: string[] };
type Metrics = { lateFlights; totalDelayMin; paxDelayMin; maxDelay; cancelledFlights; strandedPax; strandedFromCancel; strandedFromConnections;
  brokenConnections; crewTimeouts; affectedAircraft; cost };
type SimResult = { flights: Record<string, FlightResult>; flightOrder: string[]; connections: ConnResult[]; crews: CrewResult[]; metrics: Metrics;
  capacity: { airport: string; hour: number; movements: number; cap: number }[] /* only over-capacity rows */ };
simulate(net: Network, sc: Scenario): SimResult
```
Algorithm (per tail in leg order, holds need cross-tail order → iterate whole network until no change, max 10 passes):
earliest = max(schedDep, prevArr+30 | spare readyAt, hold readyAt); apply closures until stable
(dep in [s,e) at origin → e; arr in [s,e) at dest → dep = e − block); crew check arr − dutyStart > max → cancel rest;
out-of-position check before each leg. `cause` = the constraint that set `dep` (closure beats late aircraft on ties).
`rootClosureId` inherited through `late_aircraft`/`held_for_connection`; `depth` = parent depth + 1.

- [ ] Tests (each one `it`):
  - no closures → `metrics.lateFlights===0`, `strandedPax===0`, all connections ok.
  - BOM closed 07:30–09:00 → DS0401 (dep 07:45) departs 09:00, cause `origin_closed`; DS0402 delayed with cause `late_aircraft` prev DS0401.
  - DS1201 arr 07:40 at BOM in window → `dep === 9*60 - 70`, cause `dest_closed`.
  - cancel DS0202 → DS0203 cancelled `aircraft_out_of_position`, DS0204 operates on time.
  - cancel DS0101 (first leg) → DS0102 cancelled, DS0103 operates.
  - DEL closed 12:00–13:00 → CR03 times out on DS0304, DS0304 `crew_timeout`; stranded includes its 167 pax.
  - swap VT-DS18 on DS0304 under same closure → DS0304 operates, tail `VT-DS18`, no crew timeout.
  - hold CX13 under a closure that breaks it → connection ok, DS1102 dep ≥ DS0104 arr + 45.
  - end ≤ start closure → identical to baseline.
  - DEL closed 20:00–23:59 style late closure → arrivals past 1440 don't crash.
- [ ] Run, FAIL; implement; run, PASS. Commit `feat: deterministic simulation engine`.

### Task 3: Planner, facts, verifier, fallback
**Files:** Create `src/engine/planner.ts`, `src/engine/facts.ts`, `src/engine/verify.ts`, `tests/planner.test.ts`, `tests/verify.test.ts`

**Interfaces — Produces:**
```ts
type Plan = { id: string /* P1.. */; actions: Action[]; label: string; result: SimResult; delta: { strandedPax; paxDelayMin; cost; lateFlights; cancelledFlights; brokenConnections; crewTimeouts } };
candidateActions(net, sc, base: SimResult): Action[]   // cancel: late/timeout flights; swap: spare base == origin & not used; hold: missed conns
buildPlans(net, sc): { baseline: SimResult; disrupted: SimResult; plans: Plan[] }  // greedy ≤3 actions (best combo first) + top 4 singles, dedup, sorted by cost
describeAction(net, a: Action): string
buildFacts(baseline, disrupted, plans): Record<string, number | string> // keys like disrupted.strandedPax, P1.strandedPax, P1.delta.strandedPax
fillPlaceholders(text: string, facts): { text: string; missing: string[] }   // {{key}}
verifyNumbers(text: string, facts): { ok: boolean; checked: number; bad: string[] } // numbers inside flight ids/tails/HH:MM times are allowed if they appear in facts/network
fallbackDispatch(net, out): DispatchReply  // template text, uses placeholders
```
- [ ] Tests: BOM 07:30–09:00 → `plans[0].result.metrics.cost <= disrupted.metrics.cost`; every plan id unique; swap actions only from BLR/DEL origins;
  `fillPlaceholders("{{disrupted.strandedPax}} pax", facts)` gives engine value; `verifyNumbers("999 pax stranded", facts).ok===false`;
  `verifyNumbers("DS0204 leaves at 13:05", facts)` ok when those are facts.
- [ ] Run FAIL → implement → PASS. Commit `feat: recovery planner and number verification`.

### Task 4: Gemini dispatcher function + client
**Files:** Create `api/dispatch.ts`, `src/ai/dispatch.ts`, `src/ai/prompt.ts`, `tests/dispatch.test.ts`

**Interfaces:**
- `POST /api/dispatch` body `{ prompt: string }` → `{ reply: DispatchReply } | { error }` (server adds system instruction, JSON schema, calls `generateContent`).
- `type DispatchReply = { planId: string; headline: string; explanation: string[]; risks: string[]; source: 'gemini' | 'rules' }`
- `buildPrompt(net, out, facts): string`; `runDispatcher(net, out): Promise<{ reply; verification; attempts }>` — fetch, validate planId ∈ plans, fill + verify, retry once with error list, else fallback.
- [ ] Tests (fetch mocked): bad planId → fallback `source==='rules'`; reply with wrong number → retry then fallback; good reply → `source==='gemini'`, `verification.ok`.
- [ ] Run FAIL → implement → PASS. Commit `feat: gemini dispatcher with verified numbers`.

### Task 5: UI
**Files:** Create `src/App.tsx`, `src/styles.css`, `src/components/{Controls,KpiBar,NetworkMap,Timeline,FlightTable,ConnectionsCrew,Dispatcher,WhyPanel}.tsx`

- Controls: airport select, start (time input, 15-min step), duration slider 30–300, presets, run on change (instant).
- KpiBar: before vs after numbers with deltas.
- NetworkMap: SVG, equirectangular projection of lat/lng; routes as curves; planes interpolated at slider time; closed airport pulse.
- Timeline: 16 rows 05:00–24:00+, sched ghost bar + simulated bar coloured by delay, cancelled hatched; view toggle Disrupted / Recovered.
- FlightTable: late/cancelled flights, delay, cause text, click → WhyPanel domino chain to root closure.
- Dispatcher: "Ask AI dispatcher" → plan, explanation, verified badge, Apply → recovered view and before/after.
- [ ] `npx tsc --noEmit` clean, `npm run build` PASS. Verify in browser preview (BOM preset, click flight, run dispatcher, mobile width). Commit `feat: domino sky ui`.

### Task 6: Ship
- [ ] README (problem, rules, architecture, how numbers are verified, run locally). Public GitHub repo `promtwars`, push.
- [ ] Deploy to Vercel; user sets `GEMINI_API_KEY`. Verify live URL loads and dispatcher works (or falls back).
