import { describe, expect, it } from 'vitest';
import { network } from '../src/data/network';
import { buildPlans } from '../src/engine/planner';
import { buildFacts } from '../src/engine/facts';
import { buildContext, checkReply, rulesReply, runDispatcher } from '../src/ai/dispatch';
import { buildUserPrompt } from '../src/ai/prompt';
import type { DispatchReply } from '../src/ai/prompt';
import { toMin } from '../src/engine/time';

const scenarios = [
  [{ id: 'C1', airport: 'BOM', start: toMin('07:30'), end: toMin('09:00') }],
  [{ id: 'C1', airport: 'DEL', start: toMin('12:00'), end: toMin('13:00') }],
  [{ id: 'C1', airport: 'BLR', start: toMin('11:00'), end: toMin('14:00') }],
  [{ id: 'C1', airport: 'GOI', start: toMin('05:00'), end: toMin('06:00') }],
];
const ps = buildPlans(network, scenarios[0]);
const facts = buildFacts(ps, network);
const good: DispatchReply = {
  planId: 'P1',
  headline: 'Do P1 to cut stranded passengers by {{P1.saved.strandedPax}}',
  explanation: ['Stranded passengers fall from {{disrupted.strandedPax}} to {{P1.strandedPax}}.'],
  risks: ['Uses {{P1.sparesUsed}} spare aircraft.'],
  whyNotOthers: 'P1 has the lowest cost.',
};

describe('dispatcher', () => {
  it('rule-based replies always pass verification', () => {
    for (const cl of scenarios) {
      const p = buildPlans(network, cl);
      const f = buildFacts(p, network);
      const chk = checkReply(rulesReply(p), p, f);
      expect(chk.problems).toEqual([]);
    }
  });
  it('context placeholders all exist in facts', () => {
    for (const cl of scenarios) {
      const p = buildPlans(network, cl);
      const f = buildFacts(p, network);
      const prompt = buildUserPrompt(buildContext(network, p, f));
      const keys = [...prompt.matchAll(/\{\{([\w.-]+)\}\}/g)].map((m) => m[1]);
      expect(keys.filter((k) => !(k in f))).toEqual([]);
    }
  });
  it('accepts a verified Gemini answer', async () => {
    const out = await runDispatcher(network, ps, facts, async () => ({ reply: good, model: 'test' }));
    expect(out.source).toBe('gemini');
    expect(out.verification.ok).toBe(true);
    expect(out.reply.explanation[0]).toContain(String(ps.disrupted.metrics.strandedPax));
  });
  it('retries once, then falls back when numbers are invented', async () => {
    let calls = 0;
    const out = await runDispatcher(network, ps, facts, async () => {
      calls++;
      return { reply: { ...good, explanation: ['This saves 12345 passengers.'] } };
    });
    expect(calls).toBe(2);
    expect(out.source).toBe('rules');
    expect(out.verification.ok).toBe(true);
  });
  it('falls back on an unknown plan id', async () => {
    const out = await runDispatcher(network, ps, facts, async () => ({ reply: { ...good, planId: 'P99' } }));
    expect(out.source).toBe('rules');
  });
  it('falls back when the API is down', async () => {
    const out = await runDispatcher(network, ps, facts, async () => { throw new Error('503'); });
    expect(out.source).toBe('rules');
    expect(out.note).toContain('503');
  });
});

describe('dispatcher when no move helps', () => {
  it('still explains the cascade with real flights (Kolkata 16:00–18:00)', async () => {
    const p = buildPlans(network, [{ id: 'C1', airport: 'CCU', start: toMin('16:00'), end: toMin('18:00') }]);
    expect(p.plans).toHaveLength(0);
    expect(p.disrupted.metrics.cost).toBeGreaterThan(0);
    const f = buildFacts(p, network);
    const out = await runDispatcher(network, p, f, async () => { throw new Error('offline'); });
    expect(out.planId).toBeNull();
    expect(out.verification.ok).toBe(true);
    const text = [out.reply.headline, ...out.reply.explanation, out.reply.whyNotOthers].join(' ');
    expect(text).toMatch(/DS10\d\d on VT-DS10/);
    expect(text).toContain('VT-DS17 at BLR');
  });
});
