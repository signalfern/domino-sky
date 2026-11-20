import { useEffect, useRef } from 'react';
import { causePhrase } from '../ai/dispatch';
import { network } from '../data/network';
import { actionKey } from '../engine/planner';
import { dominoChain } from '../engine/simulate';
import { dur, fmt } from '../engine/time';
import { isSwap } from '../engine/types';
import type { Action, Closure, SimResult } from '../engine/types';
import { cityOf, tone } from '../ui';

/* ---------------- Why drawer (domino chain) ---------------- */

/** One-click recovery moves for a selected flight. Only legal moves are offered. */
function MoveButtons({ sim, flightId, actions, onMove }: { sim: SimResult; flightId: string; actions: Action[]; onMove: (a: Action) => void }) {
  const r = sim.flights[flightId];
  const used = new Set(actions.filter(isSwap).map((a) => a.spareId));
  const userCancelled = r.cancelReason === 'user';
  const moves: { a: Action; label: string }[] = [];
  if (!r.cancelled) moves.push({ a: { kind: 'cancel', flightId }, label: `Cancel ${flightId}` });
  if (!userCancelled && r.tail === r.plannedTail) {
    for (const s of network.spare_aircraft) {
      if (s.base === r.origin && !used.has(s.tail_id)) moves.push({ a: { kind: 'swap', spareId: s.tail_id, flightId }, label: `Spare ${s.tail_id} flies from here` });
    }
  }
  for (const c of sim.connections) {
    if (c.status === 'missed' && (c.to === flightId || c.from === flightId)) moves.push({ a: { kind: 'hold', connectionId: c.id }, label: `Hold ${c.to} for ${c.pax} pax (${c.id})` });
  }
  if (!moves.length) return null;
  return (
    <div className="move-btns" aria-label="Recovery moves for this flight">
      {moves.map((m) => (
        <button key={actionKey(m.a)} className="btn small" onClick={() => onMove(m.a)}>{m.label}</button>
      ))}
    </div>
  );
}

interface WhyProps {
  sim: SimResult;
  closures: Closure[];
  flightId: string;
  actions: Action[];
  onMove: (a: Action) => void;
  onClose: () => void;
}

export function WhyDrawer({ sim, closures, flightId, actions, onMove, onClose }: WhyProps) {
  const headRef = useRef<HTMLHeadingElement>(null);
  // Move keyboard focus into the drawer when a new flight is selected.
  useEffect(() => {
    headRef.current?.focus();
  }, [flightId]);
  const target = sim.flights[flightId];
  if (!target) return null;
  const chain = dominoChain(sim, flightId);
  const root = closures.find((c) => c.id === target.rootClosureId);
  const conns = sim.connections.filter((c) => (c.from === flightId || c.to === flightId) && c.status !== 'ok');
  const crew = sim.crews.find((c) => c.id === target.crewId);
  const status = target.cancelled ? 'cancelled' : target.delay > 0 ? 'late' : 'on time';
  return (
    <aside className="drawer" aria-label={`Why ${flightId} is ${status}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="drawer-head">
        <h3 ref={headRef} tabIndex={-1}>Why is {flightId} {status}?</h3>
        <button className="icon-x" onClick={onClose} aria-label="Close (Esc)">✕</button>
      </div>
      {root && (
        <div className="why-step" data-tone="storm">
          <div className="why-dot" aria-hidden="true">⛈</div>
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
          <div className="why-step" key={r.id} data-tone={t}>
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
        <div className="why-step" key={c.id} data-tone="storm">
          <div className="why-dot" aria-hidden="true">⇄</div>
          <div>
            <div className="why-title mono">{c.from} → {c.to} at {c.airport}</div>
            <div className="why-text">{c.pax} connecting passengers {c.status === 'missed' ? `miss it: ${c.gap} min to connect, need ${c.min}` : 'lose it to a cancellation'}.</div>
          </div>
        </div>
      ))}
      <MoveButtons sim={sim} flightId={flightId} actions={actions} onMove={onMove} />
    </aside>
  );
}
