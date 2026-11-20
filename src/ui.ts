import type { FlightResult } from './engine/types';
import { network } from './data/network';
import { toMin } from './engine/time';
import type { Closure } from './engine/types';

export const airportById = Object.fromEntries(network.airports.map((a) => [a.id, a]));
export const cityOf = Object.fromEntries(network.airports.map((a) => [a.id, a.city]));

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
  { id: 'bom', label: 'Mumbai thunderstorm', detail: 'BOM · 07:30 · 90 min', closures: [c('BOM', '07:30', 90)] },
  { id: 'del', label: 'Delhi runway closure', detail: 'DEL · 12:00 · 60 min', closures: [c('DEL', '12:00', 60)] },
  { id: 'blr', label: 'Bengaluru heavy rain', detail: 'BLR · 11:00 · 120 min', closures: [c('BLR', '11:00', 120)] },
  { id: 'hyd', label: 'Hyderabad fog', detail: 'HYD · 06:00 · 120 min', closures: [c('HYD', '06:00', 120)] },
];

export const fmtNum = (n: number) => n.toLocaleString('en-IN');
