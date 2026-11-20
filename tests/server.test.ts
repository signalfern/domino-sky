import { describe, expect, it, vi } from 'vitest';
import { callGeminiParse, validateBody } from '../src/server/gemini';
import { createRateLimiter } from '../src/server/rateLimit';

const ok = (parsed: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }] }), { status: 200 });
const err = (status: number, message = 'nope') => new Response(JSON.stringify({ error: { code: status, message } }), { status });
const PARSED = { closures: [{ airport: 'BOM', start: '07:30', minutes: 90 }], note: '' };

/** fetch mock that replays responses in order and records which model each call used. */
function replay(...responses: Response[]) {
  const calls: { model: string; body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ model: decodeURIComponent(String(url).split('/models/')[1].split(':')[0]), body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (!r) throw new Error('unexpected call');
    return r;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('validateBody', () => {
  it('rejects junk and missing fields', () => {
    expect(() => validateBody(null)).toThrow();
    expect(() => validateBody({})).toThrow('Bad context');
    expect(() => validateBody({ task: 'parse', text: '   ' })).toThrow('Missing text');
    expect(() => validateBody({ context: { plans: 'x', facts: {} } })).toThrow('Bad context');
  });
  it('accepts JSON strings, routes tasks and caps text length', () => {
    const r = validateBody(JSON.stringify({ task: 'parse', text: 'x'.repeat(5000) }));
    expect(r.task).toBe('parse');
    expect(r.task === 'parse' && r.text.length).toBe(600);
    expect(validateBody({ context: { plans: [], facts: {} } }).task).toBe('dispatch');
  });
  it('rejects oversized requests', () => {
    expect(() => validateBody({ context: { plans: [], facts: { big: 'x'.repeat(130_000) } } })).toThrow('too large');
  });
});

describe('Gemini client', () => {
  it('returns the first valid structured answer and asks for low thinking', async () => {
    const { impl, calls } = replay(ok(PARSED));
    const r = await callGeminiParse('storm', 'k', undefined, impl);
    expect(r.parsed).toEqual(PARSED);
    expect(r.model).toBe('gemini-flash-lite-latest');
    expect((calls[0].body.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });
  it('retries once when the model is overloaded (503)', async () => {
    const { impl, calls } = replay(err(503, 'high demand'), ok(PARSED));
    const r = await callGeminiParse('storm', 'k', undefined, impl);
    expect(r.model).toBe('gemini-flash-lite-latest');
    expect(calls).toHaveLength(2);
  });
  it('moves to the next model when one is retired (404)', async () => {
    const { impl, calls } = replay(err(404), ok(PARSED));
    const r = await callGeminiParse('storm', 'k', 'old-model', impl);
    expect(calls.map((c) => c.model)).toEqual(['old-model', 'gemini-flash-lite-latest']);
    expect(r.model).toBe('gemini-flash-lite-latest');
  });
  it('retries without a thinking config if the model rejects it', async () => {
    const { impl, calls } = replay(err(400, 'thinking_level is not supported'), ok(PARSED));
    await callGeminiParse('storm', 'k', undefined, impl);
    expect((calls[1].body.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });
  it('stops at once on a bad key (401/403)', async () => {
    const { impl, calls } = replay(err(403));
    await expect(callGeminiParse('storm', 'k', undefined, impl)).rejects.toThrow('403');
    expect(calls).toHaveLength(1);
  });
  it('rejects answers that do not match the schema', async () => {
    const { impl } = replay(ok({ closures: 'nope' }));
    await expect(callGeminiParse('storm', 'k', undefined, impl)).rejects.toThrow('schema');
  });
  it('reports every model it tried when all fail', async () => {
    const { impl } = replay(err(404), err(503), err(503), err(404));
    await expect(callGeminiParse('storm', 'k', undefined, impl)).rejects.toThrow(/gemini-flash-lite-latest.*gemini-flash-latest.*gemini-3\.8-flash/);
  });
});

describe('rate limiter', () => {
  it('allows the limit, blocks the rest, then resets after the window', () => {
    let t = 0;
    const hit = createRateLimiter(3, 60_000, () => t);
    expect([hit('a'), hit('a'), hit('a')].every((r) => r.ok)).toBe(true);
    const blocked = hit('a');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    expect(hit('b').ok).toBe(true); // other clients unaffected
    t = 60_000;
    expect(hit('a').ok).toBe(true);
  });
});
