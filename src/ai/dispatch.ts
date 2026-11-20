import { fillPlaceholders, verifyText } from '../engine/facts';
import type { Facts, Verification } from '../engine/facts';
import type { PlanSet } from '../engine/planner';
import { cancelReasonText } from '../engine/simulate';
import type { FlightResult, Network } from '../engine/types';
import type { DispatchContext, DispatchReply } from './prompt';

export type ReplySource = 'gemini' | 'rules';

export interface DispatchOutcome {
  planId: string | null;
  /** text with placeholders already filled from engine facts */
  reply: DispatchReply;
  source: ReplySource;
  model?: string;
  verification: Verification;
  attempts: number;
  note?: string;
}

const PLAN_METRIC_KEYS = ['strandedPax', 'totalDelayMin', 'lateFlights', 'cancelledFlights', 'brokenConnections', 'crewTimeouts', 'sparesUsed', 'cost'];

/** Cause of one flight, written with placeholders so it can be shown to the AI and verified. */
export function causePhrase(r: FlightResult): string {
  if (r.cancelled) return cancelReasonText[r.cancelReason!];
  const c = r.cause;
  if (!c) return 'on time';
  switch (c.kind) {
    case 'origin_closed': return `${c.airport} closed, departure waits for reopening`;
    case 'dest_closed': return `${c.airport} closed, held at ${r.origin} so it lands at reopening`;
    case 'late_aircraft': return `waits for its aircraft arriving late on ${c.prevFlightId}`;
    case 'held_for_connection': return `held for connection ${c.connectionId}`;
    case 'spare_ready': return `waits for spare ${c.spareId}`;
  }
}

export function buildContext(net: Network, ps: PlanSet, facts: Facts): DispatchContext {
  const d = ps.disrupted;
  const hit = d.flightOrder.map((id) => d.flights[id]).filter((r) => r.cancelled || r.delay > 0);
  const top = [...hit].sort((a, b) => Number(b.cancelled) - Number(a.cancelled) || b.delay * b.pax - a.delay * a.pax).slice(0, 12);
  const summary = top.map((r) =>
    r.cancelled
      ? `${r.id} on ${r.tail} ${r.origin}-${r.destination} CANCELLED ({{${r.id}.pax}} pax): ${causePhrase(r)}`
      : `${r.id} on ${r.tail} ${r.origin}-${r.destination} late {{${r.id}.disrupted.delay}} min, leaves {{${r.id}.disrupted.dep}} instead of {{${r.id}.schedDep}}, {{${r.id}.pax}} pax${r.depth > 0 ? `, domino step {{${r.id}.depth}}` : ''}: ${causePhrase(r)}`,
  );
  for (const c of d.connections.filter((x) => x.status !== 'ok')) {
    summary.push(`Connection ${c.id} at ${c.airport} (${c.from} to ${c.to}, {{${c.id}.pax}} pax) is ${c.status === 'missed' ? 'MISSED' : 'lost to a cancellation'}`);
  }
  for (const c of d.crews.filter((x) => x.timedOut.length)) {
    summary.push(`Crew ${c.id} would pass its {{${c.id}.max}} min duty limit, so ${c.timedOut.join(', ')} cannot operate`);
  }
  const scenario = ps.closures.map((_, i) => `{{closure${i + 1}.airport}} closed {{closure${i + 1}.start}} to {{closure${i + 1}.end}}`).join('; ');
  const networkLine = `{{network.airports}} airports, {{network.flights}} flights, {{network.aircraft}} aircraft, {{network.spares}} spare aircraft (${net.spare_aircraft.map((s) => `${s.tail_id} at ${s.base}`).join(', ')})`;
  // Send only the facts the model can use: totals, plan totals and every fact cited in the summary.
  // (Verification still runs against the full fact table.)
  const cited = new Set([...[scenario, networkLine, ...summary].join(' ').matchAll(/\{\{([\w.-]+)\}\}/g)].map((m) => m[1]));
  const slim = Object.fromEntries(Object.entries(facts).filter(([k]) => cited.has(k) || /^(closure\d|network\.|disrupted\.|plans\.|P\d+\.)/.test(k)));
  return {
    scenario,
    network: networkLine,
    disruptedSummary: summary,
    plans: ps.plans.map((p) => ({ id: p.id, steps: p.steps, keys: PLAN_METRIC_KEYS.map((k) => `${p.id}.${k}`).concat([`${p.id}.saved.strandedPax`, `${p.id}.saved.totalDelayMin`, `${p.id}.saved.strandedPct`]) })),
    facts: slim,
  };
}

/** The flights, tails and passengers this scenario hurts most, as verifiable sentences. */
function groundedLines(ps: PlanSet): string[] {
  const d = ps.disrupted;
  const out: string[] = [];
  const late = Object.values(d.flights).filter((r) => !r.cancelled && r.delay > 0).sort((a, b) => b.delay * b.pax - a.delay * a.pax);
  const deepest = [...late].sort((a, b) => b.depth - a.depth)[0];
  for (const r of late.slice(0, 2)) {
    out.push(`${r.id} on ${r.tail} (${r.origin} to ${r.destination}) leaves {{${r.id}.disrupted.dep}} instead of {{${r.id}.schedDep}} with {{${r.id}.pax}} passengers: ${causePhrase(r)}.`);
  }
  if (deepest && deepest.depth > 1 && !late.slice(0, 2).includes(deepest)) {
    out.push(`The delay reaches ${deepest.id} on ${deepest.tail} at ${deepest.origin}, domino step {{${deepest.id}.depth}} from the closure.`);
  }
  const cxl = Object.values(d.flights).find((r) => r.cancelled);
  if (cxl) out.push(`${cxl.id} on ${cxl.tail} cannot fly (${causePhrase(cxl).toLowerCase()}): {{${cxl.id}.pax}} passengers stranded.`);
  const conn = [...d.connections].filter((c) => c.status === 'missed').sort((a, b) => b.pax - a.pax)[0];
  if (conn) out.push(`Connection ${conn.id} at ${conn.airport} breaks: {{${conn.id}.pax}} passengers from ${conn.from} miss ${conn.to}.`);
  return out;
}

/** Deterministic dispatcher: always available, always verifiable. */
export function rulesReply(ps: PlanSet, net?: Network): DispatchReply {
  const p = ps.plans[0];
  if (!p) {
    return {
      planId: '',
      headline: ps.disrupted.metrics.cost === 0 ? 'No action needed: the network absorbs this closure' : 'No recovery move improves this situation',
      explanation: [
        `Closure: {{closure1.airport}} from {{closure1.start}} to {{closure1.end}}.`,
        `Late flights: {{disrupted.lateFlights}}. Stranded passengers: {{disrupted.strandedPax}}.`,
        ...groundedLines(ps),
      ],
      risks: ['Watch for new closures. Slack is small on several aircraft.'],
      whyNotOthers: `The engine tested every cancellation, spare swap${net ? ` (${net.spare_aircraft.map((s) => `${s.tail_id} at ${s.base}`).join(', ')})` : ''} and hold. None lowers the total.`,
    };
  }
  const id = p.id;
  const m = p.result.metrics;
  const explanation = [
    `The closure makes {{disrupted.lateFlights}} flights late and strands {{disrupted.strandedPax}} passengers.`,
    ...groundedLines(ps),
  ];
  if (m.strandedPax !== ps.disrupted.metrics.strandedPax) explanation.push(`With ${id}, stranded passengers go from {{disrupted.strandedPax}} to {{${id}.strandedPax}}.`);
  if (m.totalDelayMin !== ps.disrupted.metrics.totalDelayMin) explanation.push(`With ${id}, total delay goes from {{disrupted.totalDelayMin}} to {{${id}.totalDelayMin}} min.`);
  if (ps.disrupted.metrics.crewTimeouts > 0) explanation.push(`Crews over the duty limit go from {{disrupted.crewTimeouts}} to {{${id}.crewTimeouts}}.`);
  if (ps.disrupted.metrics.brokenConnections > 0) explanation.push(`Broken connections go from {{disrupted.brokenConnections}} to {{${id}.brokenConnections}}.`);
  const risks: string[] = [];
  if (m.sparesUsed > 0) risks.push(`The plan uses {{${id}.sparesUsed}} of {{network.spares}} spare aircraft. Less reserve for later problems.`);
  if (m.cancelledFlights > 0) risks.push(`{{${id}.cancelledFlights}} flights stay cancelled. Rebook {{${id}.strandedFromCancel}} passengers.`);
  if (!risks.length) risks.push('Some aircraft still run with little turnaround slack.');
  return {
    planId: id,
    headline:
      p.delta.strandedPax > 0
        ? `Do ${id}: cut stranded passengers by {{${id}.saved.strandedPax}}`
        : p.delta.totalDelayMin > 0
          ? `Do ${id}: cut total delay by {{${id}.saved.totalDelayMin}} min`
          : `Do ${id}: lower the disruption cost`,
    explanation,
    risks,
    whyNotOthers: ps.plans.length > 1 ? `${id} has the lowest cost ({{${id}.cost}}) of {{plans.count}} plans checked by the engine.` : 'It is the only plan that lowers the cost.',
  };
}

function allText(r: DispatchReply): string[] {
  return [r.headline, ...r.explanation, ...r.risks, r.whyNotOthers];
}

export function checkReply(r: DispatchReply, ps: PlanSet, facts: Facts): { ok: boolean; problems: string[]; verification: Verification } {
  const problems: string[] = [];
  if (ps.plans.length && !ps.plans.some((p) => p.id === r.planId)) problems.push(`planId "${r.planId}" is not one of ${ps.plans.map((p) => p.id).join(', ')}`);
  const v = allText(r).map((t) => verifyText(t, facts));
  const verification: Verification = {
    ok: v.every((x) => x.ok),
    checked: v.reduce((s, x) => s + x.checked, 0),
    verified: v.reduce((s, x) => s + x.verified, 0),
    bad: v.flatMap((x) => x.bad),
  };
  if (!verification.ok) problems.push(`these numbers are not engine facts: ${verification.bad.join(', ')}`);
  return { ok: problems.length === 0, problems, verification };
}

export function fillReply(r: DispatchReply, facts: Facts): DispatchReply {
  const f = (t: string) => fillPlaceholders(t, facts).text;
  return { ...r, headline: f(r.headline), explanation: r.explanation.map(f), risks: r.risks.map(f), whyNotOthers: f(r.whyNotOthers) };
}

type Caller = (body: { context: DispatchContext; feedback?: string }) => Promise<{ reply: DispatchReply; model?: string }>;

export const httpCaller: Caller = async (body) => {
  const res = await fetch('/api/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { reply?: DispatchReply; model?: string; error?: string };
  if (!res.ok || !data.reply) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { reply: data.reply, model: data.model };
};

/** Ask Gemini; verify plan id and every number; retry once with feedback; else fall back to rules. */
export async function runDispatcher(net: Network, ps: PlanSet, facts: Facts, call: Caller = httpCaller): Promise<DispatchOutcome> {
  const context = buildContext(net, ps, facts);
  let feedback: string | undefined;
  let note: string | undefined;
  let attempts = 0;
  for (let i = 0; i < 2; i++) {
    attempts++;
    try {
      const { reply, model } = await call({ context, feedback });
      const chk = checkReply(reply, ps, facts);
      if (chk.ok) {
        return { planId: reply.planId || null, reply: fillReply(reply, facts), source: 'gemini', model, verification: chk.verification, attempts };
      }
      feedback = chk.problems.join('; ');
      note = `Gemini answer rejected: ${feedback}`;
    } catch (e) {
      note = `Gemini unavailable: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
  }
  const rules = rulesReply(ps, net);
  const chk = checkReply(rules, ps, facts);
  return { planId: rules.planId || null, reply: fillReply(rules, facts), source: 'rules', verification: chk.verification, attempts, note };
}
