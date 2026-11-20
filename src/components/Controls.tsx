import { network } from '../data/network';
import { fmt, toMin } from '../engine/time';
import type { Closure } from '../engine/types';
import { PRESETS } from '../ui';

const AIRPORTS = [...network.airports].sort((a, b) => a.city.localeCompare(b.city));

export function nextClosureId(closures: Closure[]): string {
  let n = 1;
  while (closures.some((c) => c.id === `C${n}`)) n++;
  return `C${n}`;
}

const same = (a: Closure[], b: Closure[]) =>
  a.length === b.length && a.every((c, i) => c.airport === b[i].airport && c.start === b[i].start && c.end === b[i].end);

interface Props {
  closures: Closure[];
  onChange: (c: Closure[]) => void;
  onPreset: (closures: Closure[]) => void;
}

export function Controls({ closures, onChange, onPreset }: Props) {
  const update = (id: string, patch: Partial<Closure>) => onChange(closures.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const add = () => {
    const used = new Set(closures.map((c) => c.airport));
    const ap = AIRPORTS.find((a) => !used.has(a.id) && a.tier === 'mega_hub')?.id ?? 'DEL';
    onChange([...closures, { id: nextClosureId(closures), airport: ap, start: toMin('10:00'), end: toMin('11:00') }]);
  };

  return (
    <section className="card" aria-labelledby="s1">
      <h2 className="step-title" id="s1">
        <span className="step-num">1</span> Close an airport
      </h2>

      <div className="presets" role="group" aria-label="Quick scenarios">
        {PRESETS.map((p) => (
          <button key={p.id} className="preset" aria-pressed={same(p.closures, closures)} onClick={() => onPreset(p.closures)}>
            {p.label}
            <small>{p.detail}</small>
          </button>
        ))}
      </div>

      {closures.map((c, i) => {
        const minutes = c.end - c.start;
        return (
          <div className="closure" key={c.id}>
            <div className="closure-row">
              <select value={c.airport} onChange={(e) => update(c.id, { airport: e.target.value })} aria-label={`Closure ${i + 1} airport`}>
                {AIRPORTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.city} ({a.id})
                  </option>
                ))}
              </select>
              <input
                type="time"
                step={300}
                value={fmt(c.start)}
                aria-label={`Closure ${i + 1} start time`}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const s = toMin(e.target.value);
                  update(c.id, { start: s, end: s + minutes });
                }}
              />
              <button className="icon-x" onClick={() => onChange(closures.filter((x) => x.id !== c.id))} aria-label={`Remove closure ${i + 1}`}>
                ✕
              </button>
            </div>
            <label>
              <div className="slider-label">
                <span>Closed for <b>{minutes} min</b></span>
                <span>reopens <b>{fmt(c.end)}</b></span>
              </div>
              <input type="range" min={15} max={360} step={15} value={minutes} onChange={(e) => update(c.id, { end: c.start + Number(e.target.value) })} />
            </label>
          </div>
        );
      })}

      {closures.length === 0 && <p className="hint" style={{ marginTop: 0 }}>No airport is closed. Pick a scenario above or click an airport on the map.</p>}
      {closures.length < 3 && (
        <button className="btn link" onClick={add} style={{ marginTop: 8 }}>
          + {closures.length ? 'Close another airport' : 'Close an airport'}
        </button>
      )}
    </section>
  );
}
