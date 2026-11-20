import type { Action, Closure, FlightResult, SimResult } from './engine/types';
import { network } from './data/network';
import { toMin } from './engine/time';

export const cityOf = Object.fromEntries(network.airports.map((a) => [a.id, a.city]));
const flightById = Object.fromEntries(network.flights.map((f) => [f.flight_id, f]));
const connById = Object.fromEntries(network.connections.map((c) => [c.connection_id, c]));

export type Tone = 'ok' | 'minor' | 'major' | 'cancel';

export function tone(r: FlightResult): Tone {
  if (r.cancelled) return 'cancel';
  if (r.delay <= 0) return 'ok';
  return r.delay <= 30 ? 'minor' : 'major';
}

export const TONE_COLOR: Record<Tone, string> = {
  ok: 'var(--ok)',
  minor: 'var(--minor)',
  major: 'var(--major)',
  cancel: 'var(--cancel)',
};

export interface Preset {
  id: string;
  label: string;
  detail: string;
  closures: Closure[];
}

const c = (airport: string, start: string, minutes: number): Closure => ({ id: 'C1', airport, start: toMin(start), end: toMin(start) + minutes });

export const PRESETS: Preset[] = [
  { id: 'bom', label: 'Mumbai storm', detail: 'BOM 07:30 · 90m', closures: [c('BOM', '07:30', 90)] },
  { id: 'del', label: 'Delhi runway', detail: 'DEL 12:00 · 60m', closures: [c('DEL', '12:00', 60)] },
  { id: 'blr', label: 'Bengaluru rain', detail: 'BLR 11:00 · 120m', closures: [c('BLR', '11:00', 120)] },
  { id: 'hyd', label: 'Hyderabad fog', detail: 'HYD 06:00 · 120m', closures: [c('HYD', '06:00', 120)] },
  { id: 'chain', label: 'Chained storms: Mumbai + Delhi', detail: 'BOM 07:30 · 90m + DEL 12:00 · 60m', closures: [c('BOM', '07:30', 90), { ...c('DEL', '12:00', 60), id: 'C2' }] },
];

export const fmtNum = (n: number) => n.toLocaleString('en-IN');

/** Short, scannable description of one recovery action. */
export function shortAction(a: Action, sim?: SimResult): { icon: string; text: string } {
  if (a.kind === 'cancel') {
    const f = flightById[a.flightId];
    const knock = sim ? Object.values(sim.flights).filter((r) => r.cancelReason === 'aircraft_out_of_position' && r.plannedTail === f.tail_id).map((r) => r.id) : [];
    return { icon: '✕', text: `Cancel ${f.flight_id} ${f.origin}→${f.destination}${knock.length ? ` (and ${knock.join(', ')})` : ''}` };
  }
  if (a.kind === 'swap') {
    const f = flightById[a.flightId];
    return { icon: '✈', text: `Spare ${a.spareId} flies ${f.flight_id} ${f.origin}→${f.destination} onward` };
  }
  const cx = connById[a.connectionId];
  return { icon: '⏸', text: `Hold ${cx.to_flight} at ${cx.airport} for ${cx.passengers} connecting pax` };
}
