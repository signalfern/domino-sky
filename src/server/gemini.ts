import { buildUserPrompt, isDispatchReply, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION } from '../ai/prompt.js';
import type { DispatchContext, DispatchReply } from '../ai/prompt.js';
import { isParseReply, PARSE_SCHEMA, PARSE_SYSTEM } from '../ai/crisis.js';
import type { ParseReply } from '../ai/crisis.js';

const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash'];
const PER_CALL_MS = 15_000;
const TOTAL_BUDGET_MS = 30_000;
const MAX_BODY = 120_000;
const MAX_TEXT = 600;

export type Request =
  | { task: 'dispatch'; context: DispatchContext; feedback?: string }
  | { task: 'parse'; text: string };

export function validateBody(body: unknown): Request {
  const b = (typeof body === 'string' ? JSON.parse(body) : body) as { task?: unknown; text?: unknown; context?: DispatchContext; feedback?: unknown };
  if (!b || typeof b !== 'object') throw new Error('Bad request');
  if (JSON.stringify(b).length > MAX_BODY) throw new Error('Request too large');
  if (b.task === 'parse') {
    if (typeof b.text !== 'string' || !b.text.trim()) throw new Error('Missing text');
    return { task: 'parse', text: b.text.slice(0, MAX_TEXT) };
  }
  if (!b.context || typeof b.context !== 'object' || !Array.isArray(b.context.plans) || typeof b.context.facts !== 'object') throw new Error('Bad context');
  return { task: 'dispatch', context: b.context, feedback: typeof b.feedback === 'string' ? b.feedback.slice(0, 2000) : undefined };
}

/** One structured-output Gemini call, trying fallback model ids if one is retired. */
async function generate<T>(
  system: string,
  user: string,
  schema: unknown,
  check: (x: unknown) => x is T,
  apiKey: string,
  preferredModel: string | undefined,
  fetchImpl: typeof fetch,
): Promise<{ data: T; model: string }> {
  const models = [...new Set([preferredModel, ...FALLBACK_MODELS].filter(Boolean) as string[])];
  const request = (thinking: boolean) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: schema,
        // The task is extraction / explanation, not deep reasoning: keep latency low.
        ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
      },
    });
  const errors: string[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const model of models) {
    for (const thinking of [true, false]) {
      const left = deadline - Date.now();
      if (left < 2_000) throw new Error(`Gemini: out of time (${errors.join('; ')})`);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(PER_CALL_MS, left));
      try {
        const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: request(thinking),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
          errors.push(`${model}${thinking ? '' : ' (no thinking cfg)'}: HTTP ${res.status} ${detail}`);
          if (res.status === 400 && thinking && /thinking/i.test(detail)) continue; // retry without thinking config
          if (res.status === 401 || res.status === 403) throw new Error(`Gemini HTTP ${res.status}`); // bad key: no point retrying
          break; // retired (404), overloaded (429/5xx) or rejected (400): try the next model
        }
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        const parsed: unknown = JSON.parse(text);
        if (!check(parsed)) throw new Error('Gemini reply did not match schema');
        return { data: parsed, model };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          errors.push(`${model}: timeout`);
          break;
        }
        throw new Error(`${e instanceof Error ? e.message : String(e)} (${errors.join('; ')})`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error(`Gemini unavailable: ${errors.join('; ')}`);
}

export async function callGemini(
  input: { context: DispatchContext; feedback?: string },
  apiKey: string,
  preferredModel?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ reply: DispatchReply; model: string }> {
  const r = await generate(SYSTEM_INSTRUCTION, buildUserPrompt(input.context, input.feedback), RESPONSE_SCHEMA, isDispatchReply, apiKey, preferredModel, fetchImpl);
  return { reply: r.data, model: r.model };
}

export async function callGeminiParse(text: string, apiKey: string, preferredModel?: string, fetchImpl: typeof fetch = fetch): Promise<{ parsed: ParseReply; model: string }> {
  const r = await generate(PARSE_SYSTEM, `CRISIS: ${text}`, PARSE_SCHEMA, isParseReply, apiKey, preferredModel, fetchImpl);
  return { parsed: r.data, model: r.model };
}

/** Shared by the Vercel function and the local dev server. */
export async function handle(body: unknown, apiKey: string, model?: string) {
  const req = validateBody(body);
  return req.task === 'parse' ? callGeminiParse(req.text, apiKey, model) : callGemini(req, apiKey, model);
}
