import { simulate, indexNetwork } from './simulate';
import type { Action, Closure, Network, SimResult, Metrics } from './types';

export interface PlanDelta {
  strandedPax: number;
  paxDelayMin: number;
  totalDelayMin: number;
  cost: number;
  lateFlights: number;
  cancelledFlights: number;
  brokenConnections: number;
  crewTimeouts: number;
}

export interface Plan {
  id: string;
  actions: Action[];
  label: string;
  steps: string[];
  result: SimResult;
  /** improvement vs the disrupted state (positive = better) */
  delta: PlanDelta;
}

export interface PlanSet {
  closures: Closure[];
  baseline: SimResult;
  disrupted: SimResult;
  plans: Plan[];
}

const MAX_ACTIONS = 3;

export function actionKey(a: Action): string {
  if (a.kind === 'cancel') return `cancel:${a.flightId}`;
  if (a.kind === 'swap') return `swap:${a.spareId}:${a.flightId}`;
  return `hold:${a.connectionId}`;
}

export function describeAction(net: Network, a: Action, sim?: SimResult): string {
  const idx = indexNetwork(net);
  if (a.kind === 'cancel') {
    const f = idx.flights.get(a.flightId)!;
    const extra = sim ? Object.values(sim.flights).filter((r) => r.cancelReason === 'aircraft_out_of_position' && r.plannedTail === f.tail_id).map((r) => r.id) : [];
    return `Cancel ${f.flight_id} ${f.origin}→${f.destination}${extra.length ? ` (also ${extra.join(', ')}: aircraft stays at ${f.origin})` : ''}`;
  }
  if (a.kind === 'swap') {
    const f = idx.flights.get(a.flightId)!;
    return `Swap spare ${a.spareId} onto ${f.flight_id} ${f.origin}→${f.destination} and the rest of ${f.tail_id}'s day`;
  }
  const c = net.connections.find((x) => x.connection_id === a.connectionId)!;
  return `Hold ${c.to_flight} at ${c.airport} for ${c.passengers} connecting passengers from ${c.from_flight} (${c.connection_id})`;
}

/** Recovery moves worth trying from the current state. */
export function candidateActions(net: Network, current: SimResult, taken: Action[]): Action[] {
  const idx = indexNetwork(net);
  const takenKeys = new Set(taken.map(actionKey));
  const usedSpares = new Set(taken.filter((a) => a.kind === 'swap').map((a) => (a as { spareId: string }).spareId));
  const out: Action[] = [];
  const flights = Object.values(current.flights);
  for (const r of flights) {
    if (!r.cancelled && r.delay > 0) out.push({ kind: 'cancel', flightId: r.id });
  }
  for (const s of idx.spares.values()) {
    if (usedSpares.has(s.tail_id)) continue;
    for (const r of flights) {
      const hurt = (r.delay > 0 && !r.cancelled) || r.cancelReason === 'crew_timeout';
      if (hurt && r.origin === s.base && r.tail === r.plannedTail) out.push({ kind: 'swap', spareId: s.tail_id, flightId: r.id });
    }
  }
  for (const c of current.connections) if (c.status === 'missed') out.push({ kind: 'hold', connectionId: c.id });
  return out.filter((a) => !takenKeys.has(actionKey(a)));
}

export function planDelta(before: Metrics, after: Metrics): PlanDelta {
  return {
    strandedPax: before.strandedPax - after.strandedPax,
    paxDelayMin: before.paxDelayMin - after.paxDelayMin,
    totalDelayMin: before.totalDelayMin - after.totalDelayMin,
    cost: before.cost - after.cost,
    lateFlights: before.lateFlights - after.lateFlights,
    cancelledFlights: before.cancelledFlights - after.cancelledFlights,
    brokenConnections: before.brokenConnections - after.brokenConnections,
    crewTimeouts: before.crewTimeouts - after.crewTimeouts,
  };
}

function evaluate(net: Network, closures: Closure[], actions: Action[]): SimResult {
  return simulate(net, { closures, actions });
}

/**
 * Build candidate recovery plans. Every number is from the simulation engine.
 * P1 = greedy best combination (≤ 3 actions); then the best single actions.
 */
export function buildPlans(net: Network, closures: Closure[]): PlanSet {
  const baseline = evaluate(net, [], []);
  const disrupted = evaluate(net, closures, []);
  const plans: Plan[] = [];
  if (disrupted.metrics.cost === 0) return { closures, baseline, disrupted, plans };

  // Score every single move once.
  const singles = candidateActions(net, disrupted, [])
    .map((a) => ({ actions: [a], result: evaluate(net, closures, [a]) }))
    .filter((p) => p.result.metrics.cost < disrupted.metrics.cost)
    .sort((a, b) => a.result.metrics.cost - b.result.metrics.cost);

  // Greedy combination.
  let taken: Action[] = [];
  let cur = disrupted;
  for (let step = 0; step < MAX_ACTIONS; step++) {
    let best: { a: Action; r: SimResult } | null = null;
    for (const a of candidateActions(net, cur, taken)) {
      const r = evaluate(net, closures, [...taken, a]);
      if (r.metrics.cost < (best ? best.r.metrics.cost : cur.metrics.cost)) best = { a, r };
    }
    if (!best) break;
    taken = [...taken, best.a];
    cur = best.r;
  }

  const seen = new Set<string>();
  const push = (actions: Action[], result: SimResult) => {
    const key = actions.map(actionKey).sort().join('|');
    if (!actions.length || seen.has(key)) return;
    seen.add(key);
    const steps = actions.map((a) => describeAction(net, a, result));
    plans.push({ id: '', actions, label: steps.join(' + '), steps, result, delta: planDelta(disrupted.metrics, result.metrics) });
  };
  push(taken, cur);
  for (const s of singles.slice(0, 6)) {
    if (plans.length >= 5) break;
    push(s.actions, s.result);
  }
  plans.sort((a, b) => a.result.metrics.cost - b.result.metrics.cost);
  plans.forEach((p, i) => (p.id = `P${i + 1}`));
  return { closures, baseline, disrupted, plans };
}
