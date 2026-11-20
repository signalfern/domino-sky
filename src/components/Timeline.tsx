import { memo, useMemo } from 'react';
import { network } from '../data/network';
import { fmt } from '../engine/time';
import type { Closure, FlightResult, SimResult } from '../engine/types';
import { TONE_COLOR, tone } from '../ui';

interface Props {
  sim: SimResult;
  closures: Closure[];
  time: number;
  selected: string | null;
  chain: Set<string>;
  onFlight: (id: string) => void;
}

const T0 = 5 * 60;
const TAILS = [...new Set(network.flights.map((f) => f.tail_id))].sort();
const SPARES = network.spare_aircraft.map((s) => s.tail_id);

function TimelineImpl({ sim, closures, time, selected, chain, onFlight }: Props) {
  const flights = useMemo(() => Object.values(sim.flights), [sim]);
  const t1 = Math.max(24 * 60, ...flights.map((r) => r.arr + 20));
  const span = t1 - T0;
  const pos = (m: number) => `${(((m - T0) / span) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${(((b - a) / span) * 100).toFixed(3)}%`;
  const hours: number[] = [];
  for (let h = Math.ceil(T0 / 60); h * 60 <= t1; h++) hours.push(h * 60);

  const rows = [...TAILS, ...SPARES].map((tail) => ({
    tail,
    spare: SPARES.includes(tail),
    ghosts: flights.filter((r) => r.plannedTail === tail),
    bars: flights.filter((r) => r.tail === tail),
  }));

  const label = (r: FlightResult) =>
    `${r.id} ${r.origin}→${r.destination}, ${r.cancelled ? 'cancelled' : r.delay > 0 ? `${r.delay} min late, departs ${fmt(r.dep)}` : `on time ${fmt(r.dep)}`}`;

  return (
    <div className="tl" role="region" aria-label="Aircraft timeline">
      <div className="tl-inner">
        <div className="tl-axis">
          {hours.map((h) => (
            <span key={h} style={{ left: pos(h) }}>
              {fmt(h)}
            </span>
          ))}
        </div>
        <div className="tl-rows">
          {rows.map((row) => (
            <div className="tl-row" key={row.tail}>
              <div className={`tl-tail${row.spare ? ' spare' : ''}`}>{row.spare ? `${row.tail} ★` : row.tail}</div>
              <div className="tl-track">
                {hours.map((h) => (
                  <div key={h} className="tl-grid" style={{ left: pos(h) }} />
                ))}
                {row.ghosts.map((r) => (
                  <div key={`g${r.id}`} className="tl-ghost" style={{ left: pos(r.schedDep), width: width(r.schedDep, r.schedArr) }} />
                ))}
                {row.bars.map((r) => {
                  const t = tone(r);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`tl-bar${t === 'cancel' ? ' cancel hatch' : ''}${r.id === selected ? ' sel' : ''}${chain.has(r.id) && r.id !== selected ? ' chain' : ''}`}
                      style={{ left: pos(r.dep), width: width(r.dep, r.arr), background: t === 'cancel' ? undefined : TONE_COLOR[t] }}
                      onClick={() => onFlight(r.id)}
                      title={label(r)}
                      aria-label={label(r)}
                    >
                      {r.id.slice(2)} {r.destination}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ position: 'absolute', inset: 0, left: 84, pointerEvents: 'none' }}>
            {closures.map((c) => (
              <div key={c.id} className="tl-band" style={{ left: pos(c.start), width: width(c.start, c.end) }}>
                <span>
                  {c.airport} closed {fmt(c.start)}–{fmt(c.end)}
                </span>
              </div>
            ))}
            {time >= T0 && time <= t1 && <div className="tl-now" style={{ left: pos(time) }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export const Timeline = memo(TimelineImpl);
