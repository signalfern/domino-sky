import { fmt } from './time';
import type { PlanSet } from './planner';
import type { Metrics, Network } from './types';

export type Facts = Record<string, number | string>;

const METRIC_KEYS: (keyof Metrics)[] = [
  'lateFlights', 'delayedPax', 'totalDelayMin', 'paxDelayMin', 'maxDelay', 'cancelledFlights', 'strandedPax',
  'strandedFromCancel', 'strandedFromConnections', 'brokenConnections', 'crewTimeouts', 'affectedAircraft', 'sparesUsed', 'cost',
];

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Flat table of every number the dispatcher may quote. Keys are used as {{placeholders}}. */
export function buildFacts(ps: PlanSet, net: Network): Facts {
  const f: Facts = {
    'network.airports': net.airports.length,
    'network.flights': net.flights.length,
    'network.aircraft': new Set(net.flights.map((x) => x.tail_id)).size,
    'network.spares': net.spare_aircraft.length,
    'network.connections': net.connections.length,
  };
  ps.closures.forEach((c, i) => {
    f[`closure${i + 1}.airport`] = c.airport;
    f[`closure${i + 1}.start`] = fmt(c.start);
    f[`closure${i + 1}.end`] = fmt(c.end);
    f[`closure${i + 1}.minutes`] = c.end - c.start;
  });
  f['closures.count'] = ps.closures.length;
  for (const k of METRIC_KEYS) {
    f[`baseline.${k}`] = ps.baseline.metrics[k];
    f[`disrupted.${k}`] = ps.disrupted.metrics[k];
  }
  f['plans.count'] = ps.plans.length;
  for (const p of ps.plans) {
    for (const k of METRIC_KEYS) f[`${p.id}.${k}`] = p.result.metrics[k];
    for (const [k, v] of Object.entries(p.delta)) f[`${p.id}.saved.${k}`] = v;
    f[`${p.id}.actions`] = p.actions.length;
    f[`${p.id}.saved.strandedPct`] = pct(p.delta.strandedPax, ps.disrupted.metrics.strandedPax);
    f[`${p.id}.saved.costPct`] = pct(p.delta.cost, ps.disrupted.metrics.cost);
    f[`${p.id}.saved.delayPct`] = pct(p.delta.totalDelayMin, ps.disrupted.metrics.totalDelayMin);
  }
  // Per-flight facts for flights that the disruption or any plan touches.
  const touched = new Set<string>();
  for (const r of Object.values(ps.disrupted.flights)) if (r.delay > 0 || r.cancelled) touched.add(r.id);
  for (const p of ps.plans) for (const r of Object.values(p.result.flights)) if (r.delay > 0 || r.cancelled) touched.add(r.id);
  for (const id of touched) {
    const d = ps.disrupted.flights[id];
    f[`${id}.pax`] = d.pax;
    f[`${id}.schedDep`] = fmt(d.schedDep);
    f[`${id}.disrupted.dep`] = fmt(d.dep);
    f[`${id}.disrupted.delay`] = d.delay;
    for (const p of ps.plans) {
      const r = p.result.flights[id];
      f[`${id}.${p.id}.dep`] = fmt(r.dep);
      f[`${id}.${p.id}.delay`] = r.delay;
    }
  }
  for (const c of ps.disrupted.connections) {
    if (c.status === 'ok') continue;
    f[`${c.id}.pax`] = c.pax;
    f[`${c.id}.min`] = c.min;
    if (c.gap !== null) f[`${c.id}.disrupted.gap`] = c.gap;
  }
  for (const c of ps.disrupted.crews) {
    if (!c.timedOut.length) continue;
    f[`${c.id}.max`] = c.max;
  }
  return f;
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function fillPlaceholders(text: string, facts: Facts): { text: string; used: string[]; missing: string[] } {
  const used: string[] = [];
  const missing: string[] = [];
  const out = text.replace(PLACEHOLDER, (_, key: string) => {
    if (key in facts) {
      used.push(key);
      const v = facts[key];
      return typeof v === 'number' ? v.toLocaleString('en-IN') : v;
    }
    missing.push(key);
    return `[?${key}]`;
  });
  return { text: out, used, missing };
}

/** Identifiers whose digits are names, not quantities. */
const ID_PATTERN = /\b(?:DS\d{4}|VT-DS\d{2}|CX\d{2}|CR\d{2}|SB-VT-DS\d{2}|P\d{1,2})\b/g;
const TIME_PATTERN = /(?:\+1\s)?\b\d{2}:\d{2}\b/g;
const NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/g;

export interface Verification {
  ok: boolean;
  checked: number;
  verified: number;
  bad: string[];
}

/**
 * Check every number the AI wrote itself (outside {{placeholders}}) against the engine's facts.
 * Placeholders count as verified (the app fills them) as long as the key exists.
 */
export function verifyText(raw: string, facts: Facts): Verification {
  const bad: string[] = [];
  let checked = 0;
  let verified = 0;
  const numeric = new Set<number>();
  const strings = new Set<string>();
  for (const v of Object.values(facts)) {
    if (typeof v === 'number') numeric.add(v);
    else strings.add(v);
  }
  // Placeholders.
  for (const m of raw.matchAll(PLACEHOLDER)) {
    checked++;
    if (m[1] in facts) verified++;
    else bad.push(`{{${m[1]}}}`);
  }
  let rest = raw.replace(PLACEHOLDER, ' ').replace(ID_PATTERN, ' ');
  // Clock times must be fact times.
  for (const m of rest.matchAll(TIME_PATTERN)) {
    checked++;
    if (strings.has(m[0])) verified++;
    else bad.push(m[0]);
  }
  rest = rest.replace(TIME_PATTERN, ' ');
  for (const m of rest.matchAll(NUMBER_PATTERN)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isNaN(n)) continue;
    checked++;
    if (numeric.has(n) || numeric.has(Math.abs(n))) verified++;
    else bad.push(m[0]);
  }
  return { ok: bad.length === 0, checked, verified, bad };
}
