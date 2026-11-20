import { describe, expect, it } from 'vitest';
import { network } from '../src/data/network';
import { dominoChain, simulate } from '../src/engine/simulate';
import { fmt, toMin } from '../src/engine/time';
import type { Action, Closure } from '../src/engine/types';

const close = (airport: string, start: string, end: string, id = 'C1'): Closure => ({ id, airport, start: toMin(start), end: toMin(end) });
const run = (closures: Closure[], actions: Action[] = []) => simulate(network, { closures, actions });
const BOM_STORM = [close('BOM', '07:30', '09:00')];

describe('simulate — baseline', () => {
  it('has no disruption without closures', () => {
    const r = run([]);
    expect(r.metrics.lateFlights).toBe(0);
    expect(r.metrics.strandedPax).toBe(0);
    expect(r.metrics.cancelledFlights).toBe(0);
    expect(r.connections.every((c) => c.status === 'ok')).toBe(true);
    expect(r.crews.every((c) => c.duty <= c.max)).toBe(true);
    expect(r.flightOrder).toHaveLength(70);
  });
  it('ignores a closure whose end is not after its start', () => {
    const r = run([close('BOM', '09:00', '09:00')]);
    expect(r.metrics.lateFlights).toBe(0);
    expect(r.closures).toHaveLength(0);
  });
});

describe('simulate — closures', () => {
  it('moves departures out of a closed origin', () => {
    const r = run(BOM_STORM);
    expect(r.flights.DS0401.dep).toBe(toMin('09:00'));
    expect(r.flights.DS0401.cause?.kind).toBe('origin_closed');
    expect(r.flights.DS0401.depth).toBe(1);
  });
  it('holds inbound flights at origin so they land at reopening', () => {
    const r = run(BOM_STORM);
    expect(r.flights.DS1201.dep).toBe(9 * 60 - 70);
    expect(r.flights.DS1201.arr).toBe(9 * 60);
    expect(r.flights.DS1201.cause?.kind).toBe('dest_closed');
  });
  it('propagates down the aircraft chain with a reason', () => {
    const r = run(BOM_STORM);
    const f = r.flights.DS0402;
    expect(f.delay).toBe(75);
    expect(f.cause).toEqual({ kind: 'late_aircraft', prevFlightId: 'DS0401', readyAt: toMin('10:35') });
    expect(f.rootClosureId).toBe('C1');
    expect(f.depth).toBe(2);
    expect(dominoChain(r, 'DS0402').map((x) => x.id)).toEqual(['DS0401', 'DS0402']);
  });
  it('breaks connections and counts stranded passengers', () => {
    const r = run(BOM_STORM);
    const missed = r.connections.filter((c) => c.status === 'missed');
    expect(r.metrics.strandedFromConnections).toBe(missed.reduce((s, c) => s + c.pax, 0));
    expect(r.metrics.strandedPax).toBe(r.metrics.strandedFromCancel + r.metrics.strandedFromConnections);
  });
  it('cancels legs a crew cannot legally fly', () => {
    const r = run([close('DEL', '12:00', '13:00')]);
    expect(r.flights.DS0304.cancelled).toBe(true);
    expect(r.flights.DS0304.cancelReason).toBe('crew_timeout');
    expect(r.flights.DS0304.rootClosureId).toBe('C1');
    expect(r.metrics.strandedFromCancel).toBeGreaterThanOrEqual(167);
    expect(r.crews.find((c) => c.id === 'CR03')!.timedOut).toEqual(['DS0304']);
  });
  it('handles closures that push flights past midnight', () => {
    const r = run([close('CCU', '19:00', '23:00')]);
    expect(r.flights.DS1004.dep).toBe(toMin('21:45'));
    expect(fmt(r.flights.DS1004.arr)).toBe('23:00');
    expect(r.flights.DS1005.cancelled).toBe(true);
    expect(r.flights.DS1005.cancelReason).toBe('crew_timeout');
  });
  it('supports several closures at once', () => {
    const r = run([close('BOM', '07:30', '09:00', 'A'), close('BLR', '12:00', '13:00', 'B')]);
    expect(r.flights.DS0401.rootClosureId).toBe('A');
    expect(r.flights.DS0605.rootClosureId).toBe('B');
  });
});

describe('simulate — recovery actions', () => {
  it('cancelling a leg leaves the aircraft at its origin', () => {
    const r = run([], [{ kind: 'cancel', flightId: 'DS0202' }]);
    expect(r.flights.DS0202.cancelReason).toBe('user');
    expect(r.flights.DS0203.cancelReason).toBe('aircraft_out_of_position');
    expect(r.flights.DS0204.cancelled).toBe(false);
    expect(r.flights.DS0204.delay).toBe(0);
  });
  it('cancelling a first leg strands later legs until the aircraft is back in position', () => {
    const r = run([], [{ kind: 'cancel', flightId: 'DS0101' }]);
    expect(r.flights.DS0102.cancelReason).toBe('aircraft_out_of_position');
    expect(r.flights.DS0103.cancelled).toBe(false);
  });
  it('a spare with a fresh crew takes over the rest of a chain', () => {
    const r = run([close('DEL', '12:00', '13:00')], [{ kind: 'swap', spareId: 'VT-DS18', flightId: 'DS0304' }]);
    expect(r.flights.DS0304.cancelled).toBe(false);
    expect(r.flights.DS0304.tail).toBe('VT-DS18');
    expect(r.metrics.crewTimeouts).toBe(0);
    expect(r.metrics.sparesUsed).toBe(1);
  });
  it('rejects a spare swap away from the spare base', () => {
    const r = run([], [{ kind: 'swap', spareId: 'VT-DS17', flightId: 'DS0401' }]);
    expect(r.metrics.sparesUsed).toBe(0);
    expect(r.warnings.length).toBe(1);
  });
  it('uses each spare once', () => {
    const r = run([], [{ kind: 'swap', spareId: 'VT-DS18', flightId: 'DS0103' }, { kind: 'swap', spareId: 'VT-DS18', flightId: 'DS0304' }]);
    expect(r.metrics.sparesUsed).toBe(1);
  });
  it('holding a flight protects the connection', () => {
    const lko = [close('LKO', '12:30', '13:30')];
    expect(run(lko).connections.find((c) => c.id === 'CX13')!.status).toBe('missed');
    const r = run(lko, [{ kind: 'hold', connectionId: 'CX13' }]);
    expect(r.connections.find((c) => c.id === 'CX13')!.status).toBe('ok');
    expect(r.flights.DS1102.dep).toBeGreaterThanOrEqual(r.flights.DS0104.arr + 45);
    expect(r.flights.DS1102.cause?.kind).toBe('held_for_connection');
  });
});
