import { describe, expect, it } from 'vitest';
import { network } from '../src/data/network';
import { buildPlans } from '../src/engine/planner';
import { buildFacts, fillPlaceholders, verifyText } from '../src/engine/facts';
import { toMin } from '../src/engine/time';
import type { Closure } from '../src/engine/types';

const close = (airport: string, start: string, end: string): Closure => ({ id: 'C1', airport, start: toMin(start), end: toMin(end) });

describe('planner', () => {
  it('returns no plans when nothing is disrupted', () => {
    expect(buildPlans(network, []).plans).toHaveLength(0);
  });
  it('finds plans that beat doing nothing (BOM storm)', () => {
    const ps = buildPlans(network, [close('BOM', '07:30', '09:00')]);
    expect(ps.plans.length).toBeGreaterThan(0);
    expect(ps.plans[0].result.metrics.cost).toBeLessThan(ps.disrupted.metrics.cost);
    expect(new Set(ps.plans.map((p) => p.id)).size).toBe(ps.plans.length);
    for (const p of ps.plans) expect(p.actions.length).toBeLessThanOrEqual(3);
  });
  it('only swaps spares onto flights leaving the spare base', () => {
    const ps = buildPlans(network, [close('DEL', '12:00', '13:00')]);
    const swaps = ps.plans.flatMap((p) => p.actions).filter((a) => a.kind === 'swap');
    for (const a of swaps) {
      const f = network.flights.find((x) => x.flight_id === (a as { flightId: string }).flightId)!;
      expect(['BLR', 'DEL']).toContain(f.origin);
    }
    expect(ps.plans[0].result.metrics.crewTimeouts).toBe(0);
  });
});

describe('facts and verification', () => {
  const ps = buildPlans(network, [close('BOM', '07:30', '09:00')]);
  const facts = buildFacts(ps, network);
  it('fills placeholders with engine values', () => {
    const r = fillPlaceholders('{{disrupted.strandedPax}} pax', facts);
    expect(r.text).toBe(`${ps.disrupted.metrics.strandedPax.toLocaleString('en-IN')} pax`);
    expect(r.missing).toHaveLength(0);
  });
  it('rejects invented numbers', () => {
    expect(verifyText('999 pax stranded', facts).ok).toBe(false);
  });
  it('rejects unknown placeholders', () => {
    expect(verifyText('{{made.up}} pax', facts).ok).toBe(false);
  });
  it('accepts ids and fact times', () => {
    const v = verifyText('DS0401 on VT-DS04 leaves at 09:00 ({{disrupted.lateFlights}} late)', facts);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(2);
  });
  it('rejects times that are not facts', () => {
    expect(verifyText('leaves at 04:13', facts).ok).toBe(false);
  });
});
