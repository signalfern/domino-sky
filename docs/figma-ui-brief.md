# Domino Sky — UI brief for Figma

Paste the "Prompt for Figma" block into Figma Make / Figma AI. The rest is detail for each screen.

## Prompt for Figma

> Design a dark, modern, data-dense web app called **Domino Sky**: an airline disruption simulator for a
> 16-airport Indian domestic network (70 flights, 16 aircraft). The user closes an airport for a time window
> (e.g. a 90-minute thunderstorm at Mumbai) and watches the delay spread like dominoes across the network.
> An AI dispatcher then recommends recovery actions and the app shows before vs after.
> Desktop 1440×900 single screen dashboard + mobile 390 wide stacked layout.
> Style: mission-control / air-traffic-control feel, dark navy background, glassy panels, thin borders,
> cyan accent, delay colour scale green → amber → red, cancelled flights grey with diagonal hatching,
> closed airport shown as a pulsing red-purple storm ring. Font Inter for UI, JetBrains Mono for times and flight IDs.
> No country borders on the map — just airports as glowing nodes placed by coordinates and curved route lines.

## Design tokens (suggested)
| Token | Value | Use |
|---|---|---|
| bg | #070B16 | page |
| panel | #0F1629 (80% opacity, blur) | cards |
| border | #1E2A44 | panel borders |
| text | #E6ECF7 / muted #8A97B2 | text |
| accent | #38BDF8 | buttons, selected |
| ok | #22C55E | on time |
| minor | #F59E0B | 1–30 min late |
| major | #EF4444 | >30 min late |
| cancelled | #64748B + hatch | cancelled |
| storm | #A855F7 → #EF4444 | closed airport |
| ai | #818CF8 | AI dispatcher panel |

## Layout (desktop)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ DOMINO SKY  logo        [Scenario chips: BOM storm · DEL fog · BLR rain]  ⓘ │
├──────────────────────────────────────────────────────────────────────────────┤
│ KPI BAR: Late flights 12 | Delay 640 min | Stranded pax 312 | Broken conns 4 │
│          | Crews over limit 1 | Cancelled 2      (each: before → after ▼)    │
├───────────────┬──────────────────────────────────────────┬───────────────────┤
│ CLOSE AIRPORT │            NETWORK MAP (SVG)             │  AI DISPATCHER    │
│ Airport  [BOM]│   glowing airport nodes, curved routes,  │  [Ask dispatcher] │
│ From   [07:30]│   planes moving, storm ring on BOM       │  Recommended plan │
│ For  ─●── 90m │                                          │  • Cancel DS0202/ │
│ [+ add closure]│  ▶ ──────●──────────── time 09:40       │    DS0203         │
│ [Simulate]    │                                          │  • Spare VT-DS18  │
│               │                                          │  ✓ 14/14 numbers  │
│ View: Disrupted│                                         │    verified       │
│  | Recovered  │                                          │  [Apply plan]     │
├───────────────┴──────────────────────────────────────────┴───────────────────┤
│ AIRCRAFT TIMELINE (Gantt) 16 rows VT-DS01…VT-DS16, hours 05:00 → 24:00       │
│ ghost bar = schedule, solid bar = simulated, colour = delay, hatched = cancel │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ LATE FLIGHTS TABLE                   │ WHY IS IT LATE? (domino chain)        │
│ Flight Route Sched New Delay Cause   │ BOM closed 07:30–09:00                │
│ DS0402 GOI-BOM 09:20 10:05 +45 ✈ late│   ↓ DS0401 held at BOM +75            │
│                                      │   ↓ DS0402 waits for aircraft +45     │
│ Tabs: Flights | Connections | Crews  │   ↓ DS0403 …                          │
└──────────────────────────────────────┴───────────────────────────────────────┘
```
Mobile: header → KPI chips (horizontal scroll) → controls → map → AI panel → timeline (horizontal scroll) → tables.

## Components and data
1. **Header** — app name, scenario preset chips (one click fills the controls), info button (explains rules).
2. **KPI bar** — 6 cards. Each shows value, label, and when a plan is applied: before → after with green/red delta.
   Fields: lateFlights, totalDelayMin, strandedPax, brokenConnections, crewTimeouts, cancelledFlights.
3. **Close-airport panel** — airport dropdown (16 airports, code + city), start time (HH:MM, 15-min steps),
   duration slider 30–300 min, "+ add closure" (list of closure rows with remove ×), view toggle Disrupted/Recovered.
4. **Network map** — airports as nodes (size by tier: mega hub / regional hub / spoke), code labels,
   curved routes, planes as small arrow glyphs coloured by delay, closed airport storm ring + countdown label,
   time scrubber with play/pause and speed (1×/4×/16×). Hover airport → tooltip (name, movements, closures).
   Hover plane → flight id, route, delay.
5. **AI dispatcher panel** — states: idle (button), thinking (shimmer), result:
   headline, recommended plan (action chips: Cancel / Swap spare / Hold), explanation bullets,
   risks, verification badge "✓ N/N numbers match the engine" (or amber "Rule-based fallback"),
   alternatives list (2–4 plans with stranded pax + delay), buttons Apply plan / Compare.
6. **Aircraft timeline** — 16 rows, hour grid, now-line from scrubber, closure window shaded band per airport,
   bars labelled with flight id + route; click bar → selects flight.
7. **Tables (tabs)** — Flights (id, route, sched dep, new dep, delay, status pill, cause),
   Connections (id, airport, from → to, pax, gap vs min, status), Crews (id, aircraft, duty used / 600, status).
8. **Why panel** — vertical domino chain from the root closure to the selected flight, each step with time and minutes.
9. **Before/after compare** — two mini timelines or KPI columns side by side.

## States to design
Empty (no closure, all green), disrupted (red cascade), AI thinking, AI result, plan applied (before/after), mobile.
