/** The judges' four live "unfakeable" stress tests, as automated checks. */
import { describe, expect, it } from 'vitest';
import { network } from '../src/data/network';
import { simulate } from '../src/engine/simulate';
import { buildPlans } from '../src/engine/planner';
import { buildFacts } from '../src/engine/facts';
import { checkReply, rulesReply } from '../src/ai/dispatch';
import { toMin } from '../src/engine/time';
import type { Closure } from '../src/engine/types';

const close = (airport: string, start: string, minutes: number, id = 'C1'): Closure => ({ id, airport, start: toMin(start), end: toMin(start) + minutes });

describe('1 · buffer absorption', () => {
  it('a 20-minute closure is absorbed by a generous turnaround; a 110-minute storm propagates 3+ hops', () => {
    const small = simulate(network, { closures: [close('BOM', '08:15', 20)], actions: [] });
    expect(small.flights.DS0501.delay).toBe(20); // hit directly
    expect(small.flights.DS0502.delay).toBe(0); // 70-min turnaround absorbs it
    expect(small.flights.DS0504.delay).toBe(0);

    const big = simulate(network, { closures: [close('BOM', '08:15', 110)], actions: [] });
    expect(big.flights.DS0501.delay).toBe(110);
    expect(big.flights.DS0502.delay).toBeGreaterThan(0);
    expect(big.flights.DS0503.delay).toBeGreaterThan(0);
    expect(big.flights.DS0504.delay).toBeGreaterThan(0);
    expect(big.flights.DS0504.depth).toBeGreaterThanOrEqual(4);
  });
});

describe('2 · hub vs spoke', () => {
  for (const ap of ['GAU', 'TRV']) {
    it(`a ${ap} closure only hurts aircraft whose chain touches ${ap}`, () => {
      const touching = new Set(network.flights.filter((f) => f.origin === ap || f.destination === ap).map((f) => f.tail_id));
      const r = simulate(network, { closures: [close(ap, '13:00', 300)], actions: [] });
      const hurt = Object.values(r.flights).filter((f) => f.delay > 0 || f.cancelled);
      expect(hurt.length).toBeGreaterThan(0);
      for (const f of hurt) expect(touching.has(f.plannedTail)).toBe(true);
    });
  }
});

describe('3 · live recovery delta', () => {
  it('a recovery move recalculates downward, and removing it restores the exact prior state', () => {
    const closures = [close('DEL', '12:00', 60)];
    const before = simulate(network, { closures, actions: [] });
    const after = simulate(network, { closures, actions: [{ kind: 'swap', spareId: 'VT-DS18', flightId: 'DS0304' }] });
    expect(after.metrics.strandedPax).toBeLessThan(before.metrics.strandedPax);
    expect(after.metrics.cancelledFlights).toBeLessThan(before.metrics.cancelledFlights);
    expect(simulate(network, { closures, actions: [] })).toEqual(before);
  });
  it('chained storms (Mumbai and Delhi together) stay consistent', () => {
    const r = simulate(network, { closures: [close('BOM', '07:30', 90, 'A'), close('DEL', '12:00', 60, 'B')], actions: [] });
    expect(r.metrics.strandedPax).toBe(r.metrics.strandedFromCancel + r.metrics.strandedFromConnections);
    const roots = new Set(Object.values(r.flights).map((f) => f.rootClosureId).filter(Boolean));
    expect(roots).toEqual(new Set(['A', 'B']));
  });
});

describe('4 · grounded AI', () => {
  it('an unscripted HYD storm yields an answer about HYD-affected flights only, every number verified', () => {
    const ps = buildPlans(network, [close('HYD', '10:30', 75)]);
    const facts = buildFacts(ps, network);
    const reply = rulesReply(ps);
    expect(checkReply(reply, ps, facts).ok).toBe(true);
    const text = [reply.headline, ...reply.explanation, ...reply.risks].join(' ');
    const ids = [...text.matchAll(/DS\d{4}/g)].map((m) => m[0]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const f = ps.disrupted.flights[id];
      expect(f.delay > 0 || f.cancelled || ps.plans.some((p) => p.actions.some((a) => 'flightId' in a && a.flightId === id))).toBe(true);
    }
    expect(text).toMatch(/VT-DS\d{2}/); // cites tail ids
    expect(text).not.toMatch(/BOM closed|Mumbai/); // nothing left over from a rehearsed preset
  });
});
