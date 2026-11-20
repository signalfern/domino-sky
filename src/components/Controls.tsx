import { useState } from 'react';
import { network } from '../data/network';
import { runCrisisParser } from '../ai/crisis';
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

/** Plain-English crisis box: Gemini (or the offline parser) turns text into real closures. */
function CrisisBox({ onPreset }: { onPreset: (c: Closure[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const out = await runCrisisParser(text);
    setBusy(false);
    if (!out.closures.length) {
      setMsg({ ok: false, text: 'No airport found. Try: "Storm in Mumbai at 7:30 for 90 min".' });
      return;
    }
    onPreset(out.closures);
    const what = out.closures.map((c) => `${c.airport} ${fmt(c.start)}–${fmt(c.end)}`).join(' + ');
    setMsg({ ok: true, text: `${out.source === 'gemini' ? '✦ Gemini' : 'Built-in parser'}: ${what}${out.note ? ` (${out.note})` : ''}` });
  };
  return (
    <form className="crisis" onSubmit={submit}>
      <label htmlFor="crisis-text" className="crisis-label">Or describe a crisis</label>
      <div className="crisis-row">
        <input
          id="crisis-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. fog in Delhi 6 to 8, storm over Mumbai at 7:30 for 90 min"
          maxLength={600}
        />
        <button className="btn small primary" type="submit" disabled={busy || !text.trim()}>{busy ? '…' : 'Simulate'}</button>
      </div>
      {msg && <p className={`crisis-msg${msg.ok ? '' : ' bad'}`} role="status">{msg.text}</p>}
    </form>
  );
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
          <button key={p.id} className={`preset${p.closures.length > 1 ? ' wide' : ''}`} aria-pressed={same(p.closures, closures)} onClick={() => onPreset(p.closures)}>
            {p.label}
            <small>{p.detail}</small>
          </button>
        ))}
      </div>

      <CrisisBox onPreset={onPreset} />

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
              <input type="range" min={5} max={360} step={5} value={minutes} onChange={(e) => update(c.id, { end: c.start + Number(e.target.value) })} />
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
