import { memo, useMemo } from 'react';
import { network } from '../data/network';
import { fmt } from '../engine/time';
import type { Closure, FlightResult, SimResult } from '../engine/types';
import { TONE_COLOR, tone } from '../ui';

const W = 520;
const H = 640;
const PAD = 34;
const LNG0 = 72, LNG1 = 92.6, LAT0 = 7.6, LAT1 = 31.6;

const project = (lat: number, lng: number) => ({
  x: PAD + ((lng - LNG0) / (LNG1 - LNG0)) * (W - 2 * PAD),
  y: PAD + ((LAT1 - lat) / (LAT1 - LAT0)) * (H - 2 * PAD),
});

const POS = Object.fromEntries(network.airports.map((a) => [a.id, project(a.lat, a.lng)]));
const R = { mega_hub: 8, regional_hub: 6, spoke: 4.2 } as const;

interface Curve { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number }

function curve(o: string, d: string): Curve {
  const a = POS[o], b = POS[d];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(0.18 * len, 40);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, cx: mx - (dy / len) * k, cy: my + (dx / len) * k };
}
const CURVES = new Map<string, Curve>();
for (const f of network.flights) {
  const key = `${f.origin}-${f.destination}`;
  if (!CURVES.has(key)) CURVES.set(key, curve(f.origin, f.destination));
}
const pathOf = (c: Curve) => `M${c.x0.toFixed(1)},${c.y0.toFixed(1)} Q${c.cx.toFixed(1)},${c.cy.toFixed(1)} ${c.x1.toFixed(1)},${c.y1.toFixed(1)}`;

function pointAt(c: Curve, t: number) {
  const u = 1 - t;
  const x = u * u * c.x0 + 2 * u * t * c.cx + t * t * c.x1;
  const y = u * u * c.y0 + 2 * u * t * c.cy + t * t * c.y1;
  const tx = 2 * u * (c.cx - c.x0) + 2 * t * (c.x1 - c.cx);
  const ty = 2 * u * (c.cy - c.y0) + 2 * t * (c.y1 - c.cy);
  return { x, y, angle: (Math.atan2(ty, tx) * 180) / Math.PI };
}

const severity = (r: FlightResult) => (r.cancelled ? 3 : r.delay > 30 ? 2 : r.delay > 0 ? 1 : 0);

interface Props {
  sim: SimResult;
  closures: Closure[];
  time: number;
  selected: string | null;
  chain: Set<string>;
  onAirport: (id: string) => void;
  onFlight: (id: string) => void;
}

function NetworkMapImpl({ sim, closures, time, selected, chain, onAirport, onFlight }: Props) {
  const flights = useMemo(() => Object.values(sim.flights), [sim]);

  // Worst state per directional route.
  const routes = useMemo(() => {
    const m = new Map<string, FlightResult>();
    for (const r of flights) {
      const key = `${r.origin}-${r.destination}`;
      const cur = m.get(key);
      if (!cur || severity(r) > severity(cur)) m.set(key, r);
    }
    return [...m.entries()];
  }, [flights]);

  const airborne = flights.filter((r) => !r.cancelled && r.dep <= time && time < r.arr);
  const closedNow = new Set(closures.filter((c) => c.start <= time && time < c.end).map((c) => c.airport));
  const closedAny = new Set(closures.map((c) => c.airport));
  const late = airborne.filter((r) => r.delay > 0).length;

  return (
    <div className="map-wrap">
      <svg className="map-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Network map at ${fmt(time)}: ${airborne.length} aircraft airborne`}>
        <defs>
          <radialGradient id="glow" r="0.5">
            <stop offset="0" stopColor="#38bdf8" stopOpacity="0.5" />
            <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="storm" r="0.5">
            <stop offset="0" stopColor="#a855f7" stopOpacity="0.55" />
            <stop offset="0.6" stopColor="#ef4444" stopOpacity="0.18" />
            <stop offset="1" stopColor="#ef4444" stopOpacity="0" />
          </radialGradient>
          <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="#1e2a44" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#dots)" />

        {routes.map(([key, r]) => {
          const c = CURVES.get(key)!;
          const inChain = [...chain].some((id) => sim.flights[id] && `${sim.flights[id].origin}-${sim.flights[id].destination}` === key);
          const sev = severity(r);
          return (
            <path
              key={key}
              d={pathOf(c)}
              className="route"
              stroke={sev === 0 ? '#2a3a5c' : TONE_COLOR[tone(r)]}
              strokeWidth={inChain ? 2.6 : sev ? 1.6 : 1}
              strokeDasharray={r.cancelled ? '4 4' : undefined}
              opacity={inChain ? 1 : sev ? 0.75 : 0.55}
            />
          );
        })}

        {network.airports.map((a) => {
          const p = POS[a.id];
          const closed = closedNow.has(a.id);
          return (
            <g key={a.id}>
              {closedAny.has(a.id) && <circle cx={p.x} cy={p.y} r={34} fill="url(#storm)" opacity={closed ? 1 : 0.35} />}
              {closed && <circle cx={p.x} cy={p.y} r={14} className="storm-ring" />}
              <circle cx={p.x} cy={p.y} r={R[a.tier] * 2.4} fill="url(#glow)" opacity={a.tier === 'spoke' ? 0.4 : 0.7} />
              <circle
                className="ap-node"
                cx={p.x}
                cy={p.y}
                r={R[a.tier]}
                fill={closed ? '#ef4444' : a.tier === 'mega_hub' ? '#38bdf8' : a.tier === 'regional_hub' ? '#7dd3fc' : '#bae6fd'}
                stroke="#070b16"
                strokeWidth={1.5}
                tabIndex={0}
                role="button"
                aria-label={`${a.city} (${a.id})${closed ? ', closed now' : ''}. Click to close this airport.`}
                onClick={() => onAirport(a.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onAirport(a.id)}
              >
                <title>{`${a.name}, ${a.city} (${a.id}) · ${a.tier.replace('_', ' ')} · capacity ${a.capacity_per_hour}/h`}</title>
              </circle>
              <text className="ap-label" x={p.x + R[a.tier] + 4} y={p.y + 3.5}>
                {a.id}
              </text>
            </g>
          );
        })}

        {airborne.map((r) => {
          const c = CURVES.get(`${r.origin}-${r.destination}`)!;
          const pt = pointAt(c, (time - r.dep) / (r.arr - r.dep));
          const sel = r.id === selected || chain.has(r.id);
          return (
            <g
              key={r.id}
              transform={`translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) rotate(${pt.angle.toFixed(0)})`}
              onClick={() => onFlight(r.id)}
              style={{ cursor: 'pointer' }}
            >
              <title>{`${r.id} ${r.origin}→${r.destination} · ${r.delay > 0 ? `+${r.delay} min late` : 'on time'} · ${r.tail}`}</title>
              {sel && <circle r={9} fill="none" stroke="#fff" strokeWidth={1.2} opacity={0.8} />}
              <path className="plane" d="M7,0 L-5,-5 L-2.5,0 L-5,5 Z" fill={TONE_COLOR[tone(r)]} stroke="#070b16" strokeWidth={0.8} />
            </g>
          );
        })}
      </svg>
      <div className="map-hud" aria-hidden="true">
        <div className="clock">
          {fmt(time)}
          <small>IST</small>
        </div>
        <div className="stat-line">
          {airborne.length} airborne · {late} late
          {closedNow.size > 0 && <span style={{ color: '#d8b4fe' }}> · {[...closedNow].join(', ')} closed</span>}
        </div>
      </div>
    </div>
  );
}

export const NetworkMap = memo(NetworkMapImpl);
