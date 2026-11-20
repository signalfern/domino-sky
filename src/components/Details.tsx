import { causePhrase } from '../ai/dispatch';
import { fmt } from '../engine/time';
import type { SimResult } from '../engine/types';
import { tone } from '../ui';

export type DetailTab = 'flights' | 'connections' | 'crews';

/* ---------------- Details view ---------------- */

interface DetailsProps {
  sim: SimResult;
  tab: DetailTab;
  selected: string | null;
  onFlight: (id: string) => void;
}

export function Details({ sim, tab, selected, onFlight }: DetailsProps) {
  if (tab === 'flights') {
    const rows = sim.flightOrder.map((id) => sim.flights[id]).filter((r) => r.cancelled || r.delay > 0);
    return (
      <div className="details">
        <table>
          <thead>
            <tr><th>Flight</th><th>Departs</th><th>Delay</th><th>Why</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="empty">All flights on time.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={`click${r.id === selected ? ' sel' : ''}`} onClick={() => onFlight(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onFlight(r.id)}>
                <td className="mono"><b>{r.id}</b> <span className="muted">{r.origin}→{r.destination}</span></td>
                <td className="mono">{r.cancelled ? <s className="muted">{fmt(r.schedDep)}</s> : <>{fmt(r.dep)} <span className="muted">was {fmt(r.schedDep)}</span></>}</td>
                <td><span className={`pill ${tone(r)}`}>{r.cancelled ? 'cancelled' : `+${r.delay} min`}</span></td>
                <td className="muted">{causePhrase(r)}{r.tail !== r.plannedTail && <> · flown by {r.tail}</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (tab === 'connections') {
    const rows = sim.connections.filter((c) => c.status !== 'ok');
    return (
      <div className="details">
        <table>
          <thead>
            <tr><th>Connection</th><th>Passengers</th><th>Time to connect</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="empty">Every connection holds.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className="click" onClick={() => onFlight(c.to)}>
                <td className="mono"><b>{c.from} → {c.to}</b> <span className="muted">at {c.airport}</span></td>
                <td className="mono">{c.pax}</td>
                <td className="mono">{c.gap === null ? '—' : `${c.gap} min`} <span className="muted">need {c.min}</span></td>
                <td><span className={`pill ${c.status === 'missed' ? 'major' : 'cancel'}`}>{c.status === 'missed' ? 'missed' : 'flight cancelled'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const crews = [...sim.crews].sort((a, b) => b.timedOut.length - a.timedOut.length || b.duty / b.max - a.duty / a.max);
  return (
    <div className="details">
      <table>
        <thead>
          <tr><th>Crew</th><th>Duty used</th><th>Status</th></tr>
        </thead>
        <tbody>
          {crews.map((c) => {
            const over = c.timedOut.length > 0;
            const pct = Math.min(100, (c.duty / c.max) * 100);
            return (
              <tr key={c.id} className={over ? 'click' : ''} onClick={() => over && onFlight(c.timedOut[0])}>
                <td className="mono"><b>{c.id}</b> <span className="muted">{c.standby ? 'standby · ' : ''}{c.tail}</span></td>
                <td className="mono">
                  {c.duty} / {c.max} min
                  <div className="bar-mini"><div style={{ width: `${pct}%`, background: over ? 'var(--major)' : c.max - c.duty < 30 ? 'var(--minor)' : 'var(--ok)' }} /></div>
                </td>
                <td>{over ? <span className="pill major">cannot fly {c.timedOut.join(', ')}</span> : <span className="pill ok">legal</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
