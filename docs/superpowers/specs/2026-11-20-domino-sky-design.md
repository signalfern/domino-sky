# Domino Sky — Design

Date: 2026-11-20 · Event: Prompt Wars (Google for Developers × Hack2skill)

## Intent
An interactive simulator. The user closes any airport for a chosen time window and watches the delay
spread through the airline network (aircraft chains, passenger connections, crew duty limits).
An AI dispatcher recommends recovery actions and the app shows the result before and after.

Judging: 60% UI + app performance, 20% AI evaluation, rest jury. So: fast, polished, correct, explainable.

## Goals
- Deterministic engine: every delay, passenger and crew number comes from code.
- Explain *why* each flight is late (root cause chain back to the closure).
- Count stranded passengers, broken connections, crew duty breaches.
- AI dispatcher (Gemini) that recommends a plan from engine-evaluated candidates and explains it.
- Every number in AI text is verified against engine output; badge shows it.
- Works without an AI key (rule-based fallback), so the live demo never breaks.

## Non-goals
- No live data, no login, no database.
- No country border map (avoid disputed-border risk). Airports placed by lat/lng.

## Approaches
1. **Client-side TS engine + one serverless AI function (picked).** Fast, no backend for maths, key stays server-side.
2. Full backend (Node/Python API) doing simulation. Slower, more moving parts, no benefit for 70 flights.
3. Pure client app calling Gemini from the browser. Exposes the API key. Rejected.

Stack: Vite + React + TypeScript, plain CSS, SVG visuals, Vitest. Vercel hosting with `/api/dispatch` function.
AI: Gemini API (`GEMINI_API_KEY`, `GEMINI_MODEL` env vars).

## Engine rules
- Times in minutes from 00:00 IST. Min turnaround 30.
- Closure `{airport, start, end}` (can be several): no departure or arrival at that airport in `[start, end)`.
  - Departure inside window → departure moves to `end`.
  - Arrival inside window → flight held at origin, departure = `end - block` (lands at reopen).
  - Repeat until stable (multi-closure safe).
- Aircraft chain: `dep = max(scheduled dep, previous arrival + 30)`; arr = dep + block.
- Crew: duty = last operated arrival − duty_start ≤ max_duty. A flight that would land after the limit cannot
  operate: it and all later legs of that crew/aircraft are cancelled (reason `crew_timeout`).
- Cancel action: aircraft stays at origin. Any later leg that does not start where the aircraft is gets cancelled
  (`aircraft_out_of_position`) until a leg starts at the aircraft's location.
- Spare swap action `{spare, flight}`: flight origin must be the spare's base. Spare (with fresh standby crew,
  report 45 min before its first departure, max duty 600) flies that flight and the rest of the chain.
  The original aircraft stops before that flight. Each spare used once.
- Hold action `{connection}`: to_flight departs no earlier than from_arrival + min_connect (propagates down its chain).
- Connection broken if gap < min_connect or either flight cancelled.
- Stranded pax = pax on cancelled flights + pax of broken connections where both flights still operate.
- Delay reasons per flight: origin closed, destination closed (held at origin), late inbound aircraft (with
  previous flight), held for connection, plus cancellation reasons. Root-cause chain traced back.
- Capacity: hourly movements per airport checked against `capacity_per_hour`; reported.

## Recovery planner
- Candidate single actions: cancel (affected flights), spare swap (feasible flights from BLR/DEL), hold (broken connections).
- Each evaluated by the engine. Cost (passenger-minutes) = Σ(delay × pax on operating flights) + 180 × stranded pax.
- Greedy combine up to 3 actions → several candidate plans (best combo + best singles), with exact metrics.

## AI dispatcher
- Client sends scenario + candidate plans with engine metrics to `/api/dispatch`.
- Gemini returns JSON: chosen plan id, headline, explanation, risks. Told to use `{{fact_key}}` placeholders for numbers.
- App fills placeholders from engine facts, then scans all remaining numbers; any number not in engine facts →
  retry once, then rule-based fallback. UI shows "N/N numbers verified".
- Chosen plan re-simulated by the engine; before/after shown.

## UI
- Header KPIs: flights delayed, total delay minutes, stranded pax, broken connections, crew breaches, cancellations.
- Control panel: airport picker (also click on map), start time, duration, presets (e.g. BOM thunderstorm 90 min).
- Network map (SVG) with planes moving along routes on a time slider (play/pause), closed airport storm ring.
- Domino chain view per flight ("why late").
- Aircraft timeline (Gantt, 16 rows) scheduled vs simulated, before/after toggle.
- Tables: late flights + reasons, broken connections, crew breaches.
- AI dispatcher panel with plan, explanation, verification badge, apply → before/after comparison.
- Responsive, keyboard accessible, dark theme.

## Left to the builder
Visual styling details, exact cost weights, chart sizes.
