import { useState } from 'react';
import { causePhrase } from '../ai/dispatch';
import { dominoChain } from '../engine/simulate';
import { dur, fmt } from '../engine/time';
import type { Closure, Metrics, SimResult } from '../engine/types';
import { cityOf, fmtNum, tone } from '../ui';

/* ---------------- KPI bar ---------------- */

const KPIS: { key: keyof Metrics; label: string; color: string; unit?: string }[] = [
  { key: 'lateFlights', label: 'Late flights', color: 'var(--minor)' },
  { key: 'totalDelayMin', label: 'Delay minutes', color: 'var(--minor)', unit: 'min' },
  { key: 'strandedPax', label: 'Stranded pax', color: 'var(--major)' },
  { key: 'brokenConnections', label: 'Broken connections', color: 'var(--storm)' },
  { key: 'crewTimeouts', label: 'Crews over limit', color: 'var(--major)' },
  { key: 'cancelledFlights', label: 'Cancelled', color: 'var(--cancel)' },
];

export function KpiBar({ current, before }: { current: Metrics; before?: Metrics }) {
  return (
    <section className="kpis" aria-label="Key numbers">
      {KPIS.map((k) => {
        const v = current[k.key];
        const b = before?.[k.key];
        const d = b === undefined ? 0 : v - b;
        return (
          <div className="kpi" key={k.key} style={{ ['--k' as string]: k.color }}>
            <div className="label">{k.label}</div>
            <div className="value" aria-live="polite">{fmtNum(v)}</div>
            <div className="sub">
              {b !== undefined ? (
                <>
                  <span className="mono">was {fmtNum(b)}</span>
                  <span className={`delta ${d < 0 ? 'good' : d > 0 ? 'bad' : 'flat'}`}>{d > 0 ? `+${fmtNum(d)}` : d < 0 ? `−${fmtNum(-d)}` : '±0'}</span>
                </>
              ) : k.key === 'strandedPax' ? (
                <span>{fmtNum(current.strandedFromCancel)} cancelled · {fmtNum(current.strandedFromConnections)} missed conn.</span>
              ) : k.key === 'totalDelayMin' ? (
                <span>max {current.maxDelay} min · {fmtNum(current.delayedPax)} pax late</span>
              ) : k.key === 'lateFlights' ? (
                <span>{current.affectedAircraft} of 16 aircraft hit</span>
              ) : (
                <span>&nbsp;</span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ---------------- Tables ---------------- */

type Tab = 'flights' | 'connections' | 'crews';

export function Tables({ sim, selected, onFlight }: { sim: SimResult; selected: string | null; onFlight: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('flights');
  const [all, setAll] = useState(false);
  const rows = sim.flightOrder.map((id) => sim.flights[id]).filter((r) => all || r.cancelled || r.delay > 0);
  const badConn = sim.connections.filter((c) => all || c.status !== 'ok');
  const crews = sim.crews.filter((c) => all || c.timedOut.length > 0 || c.standby || c.max - c.duty < 60);
  return (
    <section className="panel" aria-label="Details">
      <h2>
        <div className="seg tabs" role="tablist">
          {(['flights', 'connections', 'crews'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === 'flights' ? `Flights (${sim.flightOrder.filter((id) => sim.flights[id].cancelled || sim.flights[id].delay > 0).length})` : t === 'connections' ? `Connections (${sim.connections.filter((c) => c.status !== 'ok').length})` : `Crews (${sim.crews.filter((c) => c.timedOut.length).length})`}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <label className="row" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show all
        </label>
      </h2>
      <div className="table-wrap">
        {tab === 'flights' && (
          <table>
            <thead>
              <tr><th>Flight</th><th>Route</th><th>Aircraft</th><th>Sched</th><th>New</th><th>Delay</th><th>Why</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="empty">All flights on time.</td></tr>}
              {rows.map((r) => {
                const t = tone(r);
                return (
                  <tr key={r.id} className={r.id === selected ? 'sel' : ''} onClick={() => onFlight(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onFlight(r.id)}>
                    <td className="mono"><b>{r.id}</b></td>
                    <td className="mono">{r.origin}→{r.destination}</td>
                    <td className="mono" style={{ color: r.tail !== r.plannedTail ? 'var(--accent)' : undefined }}>{r.tail}</td>
                    <td className="mono">{fmt(r.schedDep)}</td>
                    <td className="mono">{r.cancelled ? '—' : fmt(r.dep)}</td>
                    <td><span className={`pill ${t}`}>{r.cancelled ? 'CXL' : r.delay > 0 ? `+${r.delay}` : 'on time'}</span></td>
                    <td className="muted">{causePhrase(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === 'connections' && (
          <table>
            <thead>
              <tr><th>Conn</th><th>Airport</th><th>From → To</th><th>Pax</th><th>Gap / min</th><th>Status</th></tr>
            </thead>
            <tbody>
              {badConn.length === 0 && <tr><td colSpan={6} className="empty">All connections hold.</td></tr>}
              {badConn.map((c) => (
                <tr key={c.id} onClick={() => onFlight(c.to)}>
                  <td className="mono"><b>{c.id}</b></td>
                  <td className="mono">{c.airport}</td>
                  <td className="mono">{c.from} → {c.to}</td>
                  <td className="mono">{c.pax}</td>
                  <td className="mono">{c.gap === null ? '—' : `${c.gap} / ${c.min}`} <span className="muted">(was {c.schedGap})</span></td>
                  <td><span className={`pill ${c.status === 'ok' ? 'ok' : c.status === 'missed' ? 'major' : 'cancel'}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'crews' && (
          <table>
            <thead>
              <tr><th>Crew</th><th>Aircraft</th><th>Duty</th><th>Used / max</th><th>Status</th></tr>
            </thead>
            <tbody>
              {crews.length === 0 && <tr><td colSpan={5} className="empty">All crews have more than 60 min duty left.</td></tr>}
              {crews.map((c) => (
                <tr key={c.id} onClick={() => c.timedOut[0] && onFlight(c.timedOut[0])}>
                  <td className="mono"><b>{c.id}</b>{c.standby && <span className="muted"> standby</span>}</td>
                  <td className="mono">{c.tail}</td>
                  <td className="mono">{fmt(c.dutyStart)}–{fmt(c.dutyEnd)}</td>
                  <td className="mono">
                    {c.duty} / {c.max}
                    <div style={{ height: 4, background: '#1e293b', borderRadius: 3, marginTop: 4 }}>
                      <div style={{ width: `${Math.min(100, (c.duty / c.max) * 100)}%`, height: 4, borderRadius: 3, background: c.timedOut.length ? 'var(--major)' : c.max - c.duty < 30 ? 'var(--minor)' : 'var(--ok)' }} />
                    </div>
                  </td>
                  <td>{c.timedOut.length ? <span className="pill major">over limit: {c.timedOut.join(', ')}</span> : <span className="pill ok">legal</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* ---------------- Why panel (domino chain) ---------------- */

export function WhyPanel({ sim, closures, flightId }: { sim: SimResult; closures: Closure[]; flightId: string | null }) {
  if (!flightId) {
    return (
      <section className="panel" aria-label="Why is it late">
        <h2>Why is it late?</h2>
        <p className="muted" style={{ margin: 0 }}>Select a flight on the map, timeline or table to see its domino chain back to the closure.</p>
      </section>
    );
  }
  const chain = dominoChain(sim, flightId);
  const target = sim.flights[flightId];
  const root = closures.find((c) => c.id === target.rootClosureId);
  const conns = sim.connections.filter((c) => (c.from === flightId || c.to === flightId) && c.status !== 'ok');
  return (
    <section className="panel" aria-label="Why is it late">
      <h2>Why is {flightId} {target.cancelled ? 'cancelled' : target.delay > 0 ? 'late' : 'on time'}?</h2>
      <div className="why">
        {root && (
          <div className="why-step" style={{ ['--c' as string]: 'var(--storm)' }}>
            <div className="why-dot">⛈</div>
            <div>
              <div className="why-title">{cityOf[root.airport]} ({root.airport}) closed</div>
              <div className="why-text mono">{fmt(root.start)}–{fmt(root.end)} · {dur(root.end - root.start)}</div>
            </div>
          </div>
        )}
        {chain.map((r, i) => {
          const t = tone(r);
          const c = t === 'ok' ? 'var(--ok)' : t === 'minor' ? 'var(--minor)' : t === 'major' ? 'var(--major)' : 'var(--cancel)';
          return (
            <div className="why-step" key={r.id} style={{ ['--c' as string]: c }}>
              <div className="why-dot">{i + 1}</div>
              <div>
                <div className="why-title mono">
                  {r.id} {r.origin}→{r.destination}{' '}
                  <span className={`pill ${t}`}>{r.cancelled ? 'CANCELLED' : r.delay > 0 ? `+${r.delay} min` : 'on time'}</span>
                </div>
                <div className="why-text">
                  {causePhrase(r)}. {r.cancelled ? `${r.pax} passengers stranded.` : `Scheduled ${fmt(r.schedDep)}, now ${fmt(r.dep)} → lands ${fmt(r.arr)}.`}
                </div>
              </div>
            </div>
          );
        })}
        {conns.map((c) => (
          <div className="why-step" key={c.id} style={{ ['--c' as string]: 'var(--storm)' }}>
            <div className="why-dot">⇄</div>
            <div>
              <div className="why-title mono">{c.id} {c.from}→{c.to} at {c.airport}</div>
              <div className="why-text">{c.pax} connecting passengers {c.status === 'missed' ? `miss it: ${c.gap} min gap, need ${c.min}` : 'lose it to a cancellation'}.</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
