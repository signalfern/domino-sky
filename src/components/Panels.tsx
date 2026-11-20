import { causePhrase } from '../ai/dispatch';
import { dominoChain } from '../engine/simulate';
import { dur, fmt } from '../engine/time';
import type { Closure, Metrics, SimResult } from '../engine/types';
import { cityOf, fmtNum, tone } from '../ui';

export type DetailTab = 'flights' | 'connections' | 'crews';

/* ---------------- Step 2: impact ---------------- */

const STATS: { key: keyof Metrics; label: string; tab: DetailTab }[] = [
  { key: 'lateFlights', label: 'Late flights', tab: 'flights' },
  { key: 'strandedPax', label: 'Stranded passengers', tab: 'connections' },
  { key: 'brokenConnections', label: 'Broken connections', tab: 'connections' },
  { key: 'crewTimeouts', label: 'Crews over duty limit', tab: 'crews' },
];

interface ImpactProps {
  closures: Closure[];
  current: Metrics;
  before?: Metrics;
  planId?: string;
  onOpen: (tab: DetailTab) => void;
}

export function Impact({ closures, current, before, planId, onOpen }: ImpactProps) {
  const where = closures.map((c) => cityOf[c.airport]).join(' + ');
  return (
    <section className="card" aria-labelledby="s2">
      <h2 className="step-title" id="s2">
        <span className="step-num">2</span> {before ? `Impact after ${planId}` : 'Impact'}
      </h2>
      <p className="summary">
        {closures.length === 0 ? (
          'Every flight runs on schedule.'
        ) : current.cost === 0 && !before ? (
          <>The network absorbs the {where} closure. No flight is late.</>
        ) : (
          <>
            {before ? `With ${planId}: ` : `The ${where} closure makes `}
            <b>{current.lateFlights} flights late</b> on <b>{current.affectedAircraft} aircraft</b>
            {current.cancelledFlights > 0 && <>, <b>{current.cancelledFlights} cancelled</b></>}.
          </>
        )}
      </p>
      <div className="stats">
        {STATS.map((s) => {
          const v = current[s.key];
          const b = before?.[s.key];
          const d = b === undefined ? 0 : v - b;
          const heat = v === 0 ? 'cool' : s.key === 'lateFlights' ? 'warm' : 'hot';
          return (
            <button key={s.key} className={`stat ${heat}`} onClick={() => onOpen(s.key === 'strandedPax' && current.strandedFromCancel > current.strandedFromConnections ? 'flights' : s.tab)} title="Show details">
              <div className="v">
                {fmtNum(v)}
                {b !== undefined && d !== 0 && <span className={`delta ${d < 0 ? 'good' : 'bad'}`}>{d > 0 ? '+' : '−'}{fmtNum(Math.abs(d))}</span>}
              </div>
              <div className="l">
                {s.label}
                {b !== undefined && <span className="was"> · was {fmtNum(b)}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {closures.length > 0 && (
        <p className="subline">
          <span className="mono">{fmtNum(current.totalDelayMin)}</span> delay min · longest <span className="mono">{current.maxDelay}</span> min ·{' '}
          <span className="mono">{fmtNum(current.delayedPax)}</span> passengers late
        </p>
      )}
    </section>
  );
}

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

/* ---------------- Why drawer (domino chain) ---------------- */

export function WhyDrawer({ sim, closures, flightId, onClose }: { sim: SimResult; closures: Closure[]; flightId: string; onClose: () => void }) {
  const target = sim.flights[flightId];
  if (!target) return null;
  const chain = dominoChain(sim, flightId);
  const root = closures.find((c) => c.id === target.rootClosureId);
  const conns = sim.connections.filter((c) => (c.from === flightId || c.to === flightId) && c.status !== 'ok');
  const crew = sim.crews.find((c) => c.id === target.crewId);
  const status = target.cancelled ? 'cancelled' : target.delay > 0 ? 'late' : 'on time';
  return (
    <aside className="drawer" aria-label={`Why ${flightId} is ${status}`}>
      <div className="drawer-head">
        <h3>Why is {flightId} {status}?</h3>
        <button className="icon-x" onClick={onClose} aria-label="Close">✕</button>
      </div>
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
        const firstTimeout = r.cancelReason === 'crew_timeout' && r.id === chain.find((x) => x.cancelReason === 'crew_timeout')?.id;
        return (
          <div className="why-step" key={r.id} style={{ ['--c' as string]: `var(--${t === 'cancel' ? 'cancel' : t})` }}>
            <div className="why-dot">{i + 1}</div>
            <div>
              <div className="why-title mono">
                {r.id} {r.origin}→{r.destination}
                <span className={`pill ${t}`}>{r.cancelled ? 'cancelled' : r.delay > 0 ? `+${r.delay} min` : 'on time'}</span>
              </div>
              <div className="why-text">
                {causePhrase(r)}
                {firstTimeout && crew ? ` (${crew.id} would land ${fmt(r.arr)}: ${r.arr - crew.dutyStart} of ${crew.max} duty min)` : ''}.{' '}
                {r.cancelled ? `${r.pax} passengers stranded.` : r.delay > 0 ? `Leaves ${fmt(r.dep)} instead of ${fmt(r.schedDep)}.` : `Leaves ${fmt(r.dep)}.`}
              </div>
            </div>
          </div>
        );
      })}
      {conns.map((c) => (
        <div className="why-step" key={c.id} style={{ ['--c' as string]: 'var(--storm)' }}>
          <div className="why-dot">⇄</div>
          <div>
            <div className="why-title mono">{c.from} → {c.to} at {c.airport}</div>
            <div className="why-text">{c.pax} connecting passengers {c.status === 'missed' ? `miss it: ${c.gap} min to connect, need ${c.min}` : 'lose it to a cancellation'}.</div>
          </div>
        </div>
      ))}
    </aside>
  );
}
