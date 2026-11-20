import { network } from '../data/network';
import { fmt, toMin } from '../engine/time';
import type { Closure } from '../engine/types';

interface Props {
  closures: Closure[];
  onChange: (c: Closure[]) => void;
}

const AIRPORTS = [...network.airports].sort((a, b) => a.city.localeCompare(b.city));

export function nextClosureId(closures: Closure[]): string {
  let n = 1;
  while (closures.some((c) => c.id === `C${n}`)) n++;
  return `C${n}`;
}

export function Controls({ closures, onChange }: Props) {
  const update = (id: string, patch: Partial<Closure>) => onChange(closures.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const add = () => {
    const used = new Set(closures.map((c) => c.airport));
    const ap = AIRPORTS.find((a) => !used.has(a.id) && a.tier !== 'spoke')?.id ?? 'DEL';
    onChange([...closures, { id: nextClosureId(closures), airport: ap, start: toMin('10:00'), end: toMin('11:00') }]);
  };
  return (
    <section className="panel controls" aria-label="Close an airport">
      <h2>Close an airport</h2>
      {closures.length === 0 && <p className="muted" style={{ margin: 0 }}>No closure. Every flight runs on schedule. Add one, pick a preset, or click an airport on the map.</p>}
      {closures.map((c, i) => {
        const minutes = c.end - c.start;
        return (
          <div className="closure-card" key={c.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="mono" style={{ color: '#d8b4fe', fontSize: 12, fontWeight: 700 }}>⛈ CLOSURE {i + 1}</span>
              <button className="btn small ghost danger" onClick={() => onChange(closures.filter((x) => x.id !== c.id))} aria-label={`Remove closure ${i + 1}`}>
                ✕
              </button>
            </div>
            <label className="field">
              <span>Airport</span>
              <select value={c.airport} onChange={(e) => update(c.id, { airport: e.target.value })}>
                {AIRPORTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.city} ({a.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Closes at</span>
              <input
                type="time"
                step={300}
                value={fmt(c.start)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const s = toMin(e.target.value);
                  update(c.id, { start: s, end: s + minutes });
                }}
              />
            </label>
            <label className="field">
              <span>
                Duration <b className="mono">{minutes} min · reopens {fmt(c.end)}</b>
              </span>
              <input type="range" min={15} max={360} step={15} value={minutes} onChange={(e) => update(c.id, { end: c.start + Number(e.target.value) })} />
            </label>
          </div>
        );
      })}
      <div className="row">
        <button className="btn" onClick={add} disabled={closures.length >= 3} style={{ flex: 1 }}>
          + Add closure
        </button>
        {closures.length > 0 && (
          <button className="btn ghost" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      <div className="legend" aria-label="Legend">
        <span><i style={{ background: 'var(--ok)' }} />on time</span>
        <span><i style={{ background: 'var(--minor)' }} />1–30 min</span>
        <span><i style={{ background: 'var(--major)' }} />&gt;30 min</span>
        <span><i className="hatch" />cancelled</span>
      </div>
    </section>
  );
}
