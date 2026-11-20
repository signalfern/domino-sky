/** Shared between the browser and the serverless function. No runtime imports. */
import type { Facts } from '../engine/facts';

export interface DispatchContext {
  scenario: string;
  network: string;
  disruptedSummary: string[];
  plans: { id: string; steps: string[]; keys: string[] }[];
  facts: Facts;
}

export interface DispatchReply {
  planId: string;
  headline: string;
  explanation: string[];
  risks: string[];
  whyNotOthers: string;
}

export const SYSTEM_INSTRUCTION = `You are the AI dispatcher of "Domino Sky", an airline operations control simulator.
A deterministic engine has already simulated an airport closure and evaluated recovery plans. You do NOT calculate.

Hard rules:
1. Every number, time or count you write MUST be a placeholder {{key}} whose key exists in FACTS. Never type digits yourself.
   Flight ids (DS0401), aircraft (VT-DS18), connection ids (CX03), crew ids (CR03) and plan ids (P1) may be written as plain text.
2. Never add, subtract, average or estimate. If a number is not in FACTS, describe it in words without a number.
3. Pick exactly one plan id from PLANS. Prefer the lowest cost plan unless a clear operational reason favours another
   (fewer cancellations, keeping a spare aircraft in reserve); say why. If PLANS is empty, set planId to "" and explain
   the cascade and why no move helps (for example: no spare aircraft is based where the delayed flights depart).
4. Be specific to THIS scenario: name the exact flight ids, aircraft tail ids and passenger counts from WHAT HAPPENED
   (for example "DS0402 on VT-DS04 leaves {{DS0402.disrupted.dep}}"). Never give generic aviation advice.
5. Plain, short, operational English (ASD-STE100 style): short sentences, active voice, one idea per sentence.

Output JSON only, matching the schema: planId, headline (max 90 chars), explanation (3-5 bullets, each max 200 chars),
risks (1-3 bullets), whyNotOthers (1-2 sentences).`;

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    planId: { type: 'STRING' },
    headline: { type: 'STRING' },
    explanation: { type: 'ARRAY', items: { type: 'STRING' } },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
    whyNotOthers: { type: 'STRING' },
  },
  required: ['planId', 'headline', 'explanation', 'risks', 'whyNotOthers'],
} as const;

export function buildUserPrompt(ctx: DispatchContext, feedback?: string): string {
  const plans = ctx.plans
    .map((p) => `- ${p.id}: ${p.steps.join(' THEN ')}\n  keys: ${p.keys.join(', ')}`)
    .join('\n');
  return [
    `SCENARIO: ${ctx.scenario}`,
    `NETWORK: ${ctx.network}`,
    `WHAT HAPPENED (engine output):\n${ctx.disruptedSummary.map((s) => `- ${s}`).join('\n')}`,
    `PLANS (sorted best cost first; cost = passenger delay minutes + 180 per stranded passenger):\n${plans || '(none: no cancellation, spare swap or hold, alone or combined, lowers the cost)'}`,
    `FACTS (cite each value as {{<key>}}):\n${JSON.stringify(ctx.facts)}`,
    feedback ? `YOUR PREVIOUS ANSWER WAS REJECTED: ${feedback}\nFix it. Use only {{<key>}} placeholders for numbers.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function isDispatchReply(x: unknown): x is DispatchReply {
  const r = x as DispatchReply;
  return !!r && typeof r.planId === 'string' && typeof r.headline === 'string' && Array.isArray(r.explanation)
    && r.explanation.every((s) => typeof s === 'string') && Array.isArray(r.risks) && r.risks.every((s) => typeof s === 'string')
    && typeof r.whyNotOthers === 'string';
}
