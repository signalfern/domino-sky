import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { network } from '../data/network';
import { fmt } from '../engine/time';
import type { Closure, FlightResult, SimResult } from '../engine/types';
import { TONE_COLOR, tone } from '../ui';
import { INDIA_RINGS } from '../data/indiaOutline';

// Equirectangular projection fitted to all of India; x is scaled by cos(22°) so shapes keep their proportions.
const LNG0 = 67.6, LNG1 = 97.9, LAT0 = 6.2, LAT1 = 37.6;
const PAD = 16;
const H = 640;
const KY = (H - 2 * PAD) / (LAT1 - LAT0);
const KX = KY * Math.cos((22 * Math.PI) / 180);
const W = Math.round(KX * (LNG1 - LNG0) + 2 * PAD);

const project = (lat: number, lng: number) => ({ x: PAD + (lng - LNG0) * KX, y: PAD + (LAT1 - lat) * KY });

const INDIA_PATH = INDIA_RINGS.map((r) => {
  let d = '';
  for (let i = 0; i < r.length; i += 2) {
    const p = project(r[i + 1], r[i]);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return `${d}Z`;
}).join('');

const POS = Object.fromEntries(network.airports.map((a) => [a.id, project(a.lat, a.lng)]));
const R = { mega_hub: 7, regional_hub: 5.5, spoke: 4 } as const;

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

interface Box { x: number; y: number; w: number; h: number }
const FULL: Box = { x: 0, y: 0, w: W, h: H };
const MAX_ZOOM = 6;
const lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
function fit(v: Box): Box {
  const w = lim(v.w, W / MAX_ZOOM, W);
  const h = (w * H) / W;
  return { w, h, x: lim(v.x, 0, W - w), y: lim(v.y, 0, H - h) };
}

/** Wheel / pinch to zoom, drag to pan, buttons for +, - and reset. */
function useZoom() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<Box>(FULL);
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const drag = useRef({ pts: new Map<number, { x: number; y: number }>(), moved: false, dist: 0 });

  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: vbRef.current.x + vbRef.current.w / 2, y: vbRef.current.y + vbRef.current.h / 2 };
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    return pt.matrixTransform(m.inverse());
  };
  const zoomAt = (cx: number, cy: number, f: number) => {
    const p = toSvg(cx, cy);
    const v = vbRef.current;
    setVb(fit({ w: v.w / f, h: v.h / f, x: p.x - (p.x - v.x) / f, y: p.y - (p.y - v.y) / f }));
  };
  const zoomCenter = (f: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };

  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0018));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = (e: React.PointerEvent) => {
    drag.current.pts.delete(e.pointerId);
    if (drag.current.pts.size < 2) drag.current.dist = 0;
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      drag.current.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.current.moved = false;
      if (drag.current.pts.size === 2) {
        const [a, b] = [...drag.current.pts.values()];
        drag.current.dist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      const prev = d.pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (d.pts.size === 1) {
        if (vbRef.current.w >= W - 0.5) return; // nothing to pan at full view
        if (!d.moved && Math.hypot(cur.x - prev.x, cur.y - prev.y) < 4) return;
        if (!d.moved) svgRef.current?.setPointerCapture(e.pointerId);
        d.moved = true;
        const m = svgRef.current?.getScreenCTM();
        const k = m ? m.a : 1;
        const v = vbRef.current;
        setVb(fit({ ...v, x: v.x - (cur.x - prev.x) / k, y: v.y - (cur.y - prev.y) / k }));
        d.pts.set(e.pointerId, cur);
      } else if (d.pts.size === 2) {
        d.pts.set(e.pointerId, cur);
        const [a, b] = [...d.pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (d.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / d.dist);
        d.dist = dist;
        d.moved = true;
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e: React.MouseEvent) => {
      if (drag.current.moved) {
        e.stopPropagation();
        drag.current.moved = false;
      }
    },
  };
  return { svgRef, vb, zoomed: vb.w < W - 0.5, handlers, zoomIn: () => zoomCenter(1.6), zoomOut: () => zoomCenter(1 / 1.6), reset: () => setVb(FULL) };
}

function NetworkMapImpl({ sim, closures, time, selected, chain, onAirport, onFlight }: Props) {
  const flights = useMemo(() => Object.values(sim.flights), [sim]);
  const zoom = useZoom();
  const z = W / zoom.vb.w;
  const u = 1 / Math.sqrt(z); // markers grow slower than the map

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
      <svg
        ref={zoom.svgRef}
        className="map-svg"
        viewBox={`${zoom.vb.x.toFixed(2)} ${zoom.vb.y.toFixed(2)} ${zoom.vb.w.toFixed(2)} ${zoom.vb.h.toFixed(2)}`}
        role="img"
        aria-label={`Network map at ${fmt(time)}: ${airborne.length} aircraft airborne. Scroll or pinch to zoom, drag to pan.`}
        style={{ touchAction: zoom.zoomed ? 'none' : 'pan-y', cursor: zoom.zoomed ? 'grab' : undefined }}
        {...zoom.handlers}
      >
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
        <path d={INDIA_PATH} fill="#111c34" stroke="#2f4470" strokeWidth={1} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <text x={W - PAD - 4} y={H - PAD - 4} textAnchor="end" fontSize="9" fill="#3b4a6b" fontFamily="var(--mono)">
          India · official boundary
        </text>

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
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {network.airports.map((a) => {
          const p = POS[a.id];
          const closed = closedNow.has(a.id);
          return (
            <g key={a.id}>
              {closedAny.has(a.id) && <circle cx={p.x} cy={p.y} r={34 * u} fill="url(#storm)" opacity={closed ? 1 : 0.35} />}
              {closed && <circle cx={p.x} cy={p.y} r={14 * u} className="storm-ring" />}
              <circle cx={p.x} cy={p.y} r={R[a.tier] * 2.4 * u} fill="url(#glow)" opacity={a.tier === 'spoke' ? 0.4 : 0.7} />
              <circle
                className="ap-node"
                cx={p.x}
                cy={p.y}
                r={R[a.tier] * u}
                fill={closed ? '#ef4444' : a.tier === 'mega_hub' ? '#38bdf8' : a.tier === 'regional_hub' ? '#7dd3fc' : '#bae6fd'}
                stroke="#070b16"
                strokeWidth={1.5 * u}
                tabIndex={0}
                role="button"
                aria-label={`${a.city} (${a.id})${closed ? ', closed now' : ''}. Click to close this airport.`}
                onClick={() => onAirport(a.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onAirport(a.id)}
              >
                <title>{`${a.name}, ${a.city} (${a.id}) · ${a.tier.replace('_', ' ')} · capacity ${a.capacity_per_hour}/h`}</title>
              </circle>
              <text className="ap-label" x={p.x + (R[a.tier] + 4) * u} y={p.y + 3.5 * u} style={{ fontSize: 10 * u }}>
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
              transform={`translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) rotate(${pt.angle.toFixed(0)}) scale(${u.toFixed(3)})`}
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
      <div className="map-zoom" role="group" aria-label="Map zoom">
        <button onClick={zoom.zoomIn} aria-label="Zoom in" disabled={z >= MAX_ZOOM - 0.01}>+</button>
        <button onClick={zoom.zoomOut} aria-label="Zoom out" disabled={!zoom.zoomed}>&minus;</button>
        <button onClick={zoom.reset} aria-label="Reset zoom" disabled={!zoom.zoomed} title="Show all of India">&#x2922;</button>
        <span className="mono">{z.toFixed(1)}&times;</span>
      </div>
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
