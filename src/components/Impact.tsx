import { actionKey } from '../engine/planner';
import type { Action, Closure, Metrics, SimResult } from '../engine/types';
import { cityOf, fmtNum, shortAction } from '../ui';
import type { DetailTab } from './Details';

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
  moves: Action[];
  movesSim: SimResult | null;
  onRemoveMove: (key: string) => void;
  onResetMoves: () => void;
  onOpen: (tab: DetailTab) => void;
  /** Deepest domino in the current view, for one-click chain tracing. */
  deepest?: { id: string; tail: string; depth: number };
  onTrace: (id: string) => void;
}

export function Impact({ closures, current, before, planId, moves, movesSim, onRemoveMove, onResetMoves, onOpen, deepest, onTrace }: ImpactProps) {
  const where = closures.map((c) => cityOf[c.airport]).join(' + ');
  return (
    <section className="card" aria-labelledby="s2">
      <h2 className="step-title" id="s2">
        <span className="step-num">2</span> {before ? `Impact after ${planId}` : 'Impact'}
      </h2>
      <p className="summary" aria-live="polite">
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
      {deepest && deepest.depth > 1 && (
        <button className="btn small trace" onClick={() => onTrace(deepest.id)}>
          ⛓ Trace the longest chain: {deepest.id} on {deepest.tail} ({deepest.depth} steps)
        </button>
      )}
      {moves.length > 0 && (
        <div className="moves" aria-label="Recovery moves">
          <div className="moves-head">
            <span>Recovery moves ({moves.length})</span>
            <button className="btn link" onClick={onResetMoves}>Reset all</button>
          </div>
          {moves.map((a) => {
            const s = shortAction(a, movesSim ?? undefined);
            const key = actionKey(a);
            return (
              <div className="action" key={key}>
                <span className="ic" aria-hidden="true">{s.icon}</span>
                <span className="grow">{s.text}</span>
                <button className="icon-x" onClick={() => onRemoveMove(key)} aria-label={`Undo: ${s.text}`}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
