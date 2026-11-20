# ✈ Domino Sky — airline disruption simulator with a verified AI dispatcher

> A 90-minute thunderstorm in Mumbai can cancel a flight five hours later in a city with clear skies.
> **Domino Sky** lets you close any airport for any window and watch the delay spread through aircraft chains,
> passenger connections and crew duty limits — then asks a **Gemini AI dispatcher** to recover the day,
> with **every number it says checked against a deterministic engine**.

**Live demo:** https://domino-sky-five.vercel.app

Built for **Prompt Wars** (Google for Developers × Hack2skill).

## What it does

| | |
|---|---|
| **Close any airport** | Pick airport, start time, duration (15–360 min). Add up to 3 closures. One-click presets (Mumbai thunderstorm, Delhi runway closure, …) or click an airport on the map. |
| **Watch the domino effect** | Live network map with aircraft flying their routes on a time scrubber (play at 1×/3×/8×). Aircraft timeline (Gantt) shows schedule vs simulated for all 16 aircraft + 2 spares. |
| **See why each flight is late** | Every flight carries its binding cause: origin closed, destination closed (held at origin), late inbound aircraft, held for a connection, crew out of hours, aircraft out of position. Click a flight to see its full domino chain back to the closure. |
| **Count the damage** | Late flights, delay minutes, passengers delayed, stranded passengers (cancelled + missed connections), broken connections, crews over their legal duty limit. |
| **AI dispatcher** | The engine generates and scores recovery plans (cancel a leg, swap in a spare aircraft, hold a flight for connecting passengers, and greedy combinations of up to 3). Gemini picks one and explains the trade-offs in plain operational English. |
| **Before / after** | Apply any plan and flip between before and after on the KPIs, map and timeline. |

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
                dispatch.ts  (context builder, Gemini call → verify → retry → rule fallback)
src/server/     gemini.ts    (Gemini REST generateContent with structured JSON output)
api/dispatch.ts Vercel serverless function (API key stays server-side)
src/components/ NetworkMap (SVG), Timeline, Controls, Dispatcher, Panels (KPIs, tables, why-chain)
tests/          Vitest: engine, planner, verifier, dispatcher fallbacks
```

- No map tiles, no chart library: hand-written SVG and CSS, React only. Fast first load, 60 fps playback.
- The full plan search (≈100 simulations) runs in the browser in a few milliseconds.

## Run locally

```bash
npm install
npm test          # unit tests
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
