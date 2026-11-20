# ✈ Domino Sky — airline disruption simulator with a verified AI dispatcher

> A 90-minute thunderstorm in Mumbai can cancel a flight five hours later in a city with clear skies.
> **Domino Sky** lets you close any airport for any window and watch the delay spread through aircraft chains,
> passenger connections and crew duty limits — then asks a **Gemini AI dispatcher** to recover the day,
> with **every number it says checked against a deterministic engine**.

[![CI](https://github.com/signalfern/domino-sky/actions/workflows/ci.yml/badge.svg)](https://github.com/signalfern/domino-sky/actions/workflows/ci.yml) **Live demo:** https://domino-sky-five.vercel.app

Built for **Prompt Wars** (Google for Developers × Hack2skill).

## What it does

| | |
|---|---|
| **Close any airport** | Pick airport, start time, duration (5–360 min, 5-min steps). Chain up to 3 closures. One-click presets (Mumbai storm, Delhi runway, Bengaluru rain, Hyderabad fog, **chained Mumbai + Delhi**) or click an airport on the map. |
| **Describe a crisis in plain English** | *"fog in Delhi 6 to 8, storm over Mumbai at 7:30 for 90 min"* → Gemini compiles it into real closures (structured JSON, airport enum, validated against the network). Offline, a deterministic parser does the same. |
| **Watch the domino effect** | Zoomable, pannable map of India (official boundary; wheel / pinch / drag / +−) with aircraft flying their routes on a time scrubber (play at 1×/3×/8×). Live network map with aircraft flying their routes on a time scrubber (play at 1×/3×/8×). Aircraft timeline (Gantt) shows schedule vs simulated for all 16 aircraft + 2 spares. |
| **See why each flight is late** | Every flight carries its binding cause: origin closed, destination closed (held at origin), late inbound aircraft, held for a connection, crew out of hours, aircraft out of position. Click a flight to see its full domino chain back to the closure. |
| **Count the damage** | Late flights, delay minutes, passengers delayed, stranded passengers (cancelled + missed connections), broken connections, crews over their legal duty limit. |
| **AI dispatcher** | The engine generates and scores recovery plans (cancel a leg, swap in a spare aircraft, hold a flight for connecting passengers, and greedy combinations of up to 3). Gemini picks one and explains the trade-offs in plain operational English. |
| **Before / after** | Apply any plan with one click and flip between before and after on the KPIs, map and timeline. |
| **Your own recovery moves** | Click any flight: *Cancel it*, *Spare VT-DS17/18 flies from here* (only legal swaps are offered), or *Hold for N connecting pax*. Every move re-runs the engine; remove a move or *Reset all* to restore the exact prior state. |
| **Grounded AI** | The dispatcher cites the exact flight ids, tail ids, departure times, passenger counts and domino step of the scenario on screen, and every number is verified against the engine. |

## Judges' live stress tests — automated in [`tests/stress.test.ts`](tests/stress.test.ts)

| Test | What the engine does |
|---|---|
| **Buffer absorption** | BOM closed 20 min at 08:15: DS0501 leaves 20 min late, the 70-min turnaround absorbs it, DS0502–DS0504 stay on time. Closed 110 min: the delay propagates 3 more hops down VT-DS05 (domino step 4). |
| **Hub vs spoke** | A GAU or TRV closure only hurts aircraft whose `tail_id` chain touches that airport. |
| **Live recovery delta** | Swapping VT-DS18 onto DS0304 in the Delhi scenario cuts stranded passengers and cancellations; removing the move restores the identical prior state. Chained BOM + DEL closures keep every total consistent. |
| **Grounded AI** | For an unscripted HYD 75-min storm, the answer names only flights the HYD closure actually hurts, cites tail ids, and passes number verification. |

## The rule: AI explains, code calculates

1. All delay and passenger numbers come from `src/engine` — pure, deterministic TypeScript with unit tests.
2. The dispatcher receives a **facts table** (`buildFacts`) and must write every number as a placeholder like
   `{{P1.strandedPax}}`. The app fills placeholders from the engine.
3. `verifyText` scans every number the model wrote itself (outside placeholders) and every clock time. Anything
   that is not an engine fact rejects the answer. The plan id must be one the engine produced.
4. A rejected answer is retried once with the exact problems listed; if it fails again (or the API is down / no key),
   the deterministic rule-based dispatcher answers instead. The UI shows a badge: **“✓ 15/15 numbers match the engine”**.

## Simulation rules (deterministic)

- Times are minutes from 00:00 IST. Minimum turnaround 30 min (from the dataset).
- **Closure** `[start, end)`: no departure or arrival at that airport. A departure inside the window moves to `end`.
  A flight that would *land* inside the window is held at its origin so it lands at `end`. Repeated until stable (multi-closure safe).
- **Aircraft chain**: `dep = max(scheduled, previous arrival + 30)`.
- **Crew**: duty = last arrival − duty_start ≤ max_duty (600). A leg that would land after the limit cannot operate: it and the rest of that crew's day are cancelled.
- **Cancel** a leg: the aircraft stays at its origin; later legs that start elsewhere are cancelled (out of position).
- **Spare swap**: a spare (VT-DS17 at BLR, VT-DS18 at DEL) with a fresh standby crew takes over a flight leaving its base and the rest of that chain. Each spare once.
- **Hold**: a flight waits until `feeder arrival + min_connect`; the delay propagates down its own chain.
- **Connection** broken if the gap < min connect, or either flight is cancelled.
- **Stranded passengers** = pax on cancelled flights + pax on missed connections (both flights operating), no double counting.
- **Plan cost** = Σ(delay × pax) + 180 × stranded pax. Hourly movements are checked against `capacity_per_hour`.

## Architecture

```
src/engine/     simulate.ts  (closures, chains, crew, connections, causes, domino depth)
                planner.ts   (candidate actions, greedy plans, deltas)
                facts.ts     (facts table, placeholder filling, number verifier)
src/ai/         prompt.ts    (system instruction + JSON schema, shared with server)
                crisis.ts    (plain-English crisis → closures: Gemini schema + offline parser)
                dispatch.ts  (context builder, Gemini call → verify → retry → rule fallback)
src/server/     gemini.ts    (Gemini REST generateContent with structured JSON output)
api/dispatch.ts Vercel serverless function (API key stays server-side)
src/components/ NetworkMap (SVG) + useZoom, Timeline, Controls (incl. crisis box), Dispatcher, Impact, Details, WhyDrawer
tests/          Vitest: engine, planner, verifier, dispatcher fallbacks
```

- No map tiles, no chart library: hand-written SVG and CSS, React only. Fast first load, 60 fps playback.
- The full plan search (≈100 simulations) runs in the browser in a few milliseconds.

## Quality, security, accessibility

- **Checks:** `npm run check` = typecheck (strict TS) + ESLint (`typescript-eslint` strict + stylistic, React Hooks rules) + 60+ Vitest tests + production build. The same steps run in GitHub Actions on every push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- **Tests cover:** engine rules, the judges' 4 stress tests, planner, fact verification, dispatcher fallbacks, crisis parser, Gemini client (retry on overload, retired models, bad key, schema), rate limiter, landing animation bounds.
- **Security:** API key only on the server; strict CSP, `nosniff`, frame-deny, HSTS, referrer and permissions policies (`vercel.json`); `/api/dispatch` accepts JSON POST only, size-capped input, per-client rate limit (20/min), schema-validated model output, generic errors to the browser (details stay in server logs). User text never reaches the engine without validation against the network.
- **Accessibility:** WCAG AA text contrast (≥ 4.99:1), keyboard-operable map (airports are buttons), WAI-ARIA tabs with arrow keys, skip link, live region for impact changes, labelled controls, `prefers-reduced-motion` respected.

## Run locally

```bash
npm install
npm test          # unit tests
npm run check     # typecheck + lint + tests + build (what CI runs)
npm run dev       # http://localhost:5173
```

AI dispatcher locally: create `.env.local` with `GEMINI_API_KEY=...` (optional `GEMINI_MODEL`). Without a key the app
uses the rule-based dispatcher.

## Deploy (Vercel)

Import the repo in Vercel (framework: Vite), add the environment variable `GEMINI_API_KEY` (and optionally
`GEMINI_MODEL`, default `gemini-flash-latest`), deploy.

## Dataset

- Map outline: India official boundary from [DataMeet `india-composite.geojson`](https://github.com/datameet/maps/tree/master/Country) (CC0), simplified and embedded (`src/data/indiaOutline.ts`).

`src/data/flight_network.json` — 16 airports, 70 flights, 16 aircraft, 21 connections, 16 crews, 2 spare aircraft (provided by the organisers).
- Landing-page aircraft: side view from [Boeing 737-800 v1.0.png](https://commons.wikimedia.org/wiki/File:Boeing_737-800_v1.0.png) by Julien Scavini, Wikimedia Commons, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); cropped, filled and mirrored (`public/plane-737.webp`, same licence).
