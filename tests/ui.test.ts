import { describe, expect, it } from 'vitest';
import { network } from '../src/data/network';
import { simulate } from '../src/engine/simulate';
import { PRESETS, shortAction, tone } from '../src/ui';
import type { FlightResult } from '../src/engine/types';

const flight = (p: Partial<FlightResult>) => ({ cancelled: false, delay: 0, ...p }) as FlightResult;

describe('ui helpers', () => {
  it('maps delay to the green → amber → red → grey scale', () => {
    expect(tone(flight({}))).toBe('ok');
    expect(tone(flight({ delay: 30 }))).toBe('minor');
    expect(tone(flight({ delay: 31 }))).toBe('major');
    expect(tone(flight({ cancelled: true, delay: 90 }))).toBe('cancel');
  });
  it('describes each recovery move briefly, including knock-on cancellations', () => {
    const sim = simulate(network, { closures: [], actions: [{ kind: 'cancel', flightId: 'DS0202' }] });
    expect(shortAction({ kind: 'cancel', flightId: 'DS0202' }, sim).text).toBe('Cancel DS0202 BOM→PNQ (and DS0203)');
    expect(shortAction({ kind: 'swap', spareId: 'VT-DS18', flightId: 'DS0304' }).text).toBe('Spare VT-DS18 flies DS0304 DEL→CCU onward');
    expect(shortAction({ kind: 'hold', connectionId: 'CX13' }).text).toBe('Hold DS1102 at DEL for 37 connecting pax');
  });
  it('every preset closes real airports with valid windows and actually disrupts the network', () => {
    const airports = new Set(network.airports.map((a) => a.id));
    for (const p of PRESETS) {
      for (const c of p.closures) {
        expect(airports.has(c.airport)).toBe(true);
        expect(c.end).toBeGreaterThan(c.start);
      }
      expect(new Set(p.closures.map((c) => c.id)).size).toBe(p.closures.length);
      expect(simulate(network, { closures: p.closures, actions: [] }).metrics.lateFlights).toBeGreaterThan(0);
    }
  });
});
