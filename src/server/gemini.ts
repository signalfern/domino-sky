import { buildUserPrompt, isDispatchReply, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION } from '../ai/prompt.js';
import type { DispatchContext, DispatchReply } from '../ai/prompt.js';
import { isParseReply, PARSE_SCHEMA, PARSE_SYSTEM } from '../ai/crisis.js';
import type { ParseReply } from '../ai/crisis.js';

const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash'];
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
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema },
  });
  let lastError = 'No model available';
  for (const model of models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: ctrl.signal,
      });
      if (res.status === 404 || res.status === 400) {
        lastError = `${model}: HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const parsed: unknown = JSON.parse(text);
      if (!check(parsed)) throw new Error('Gemini reply did not match schema');
      return { data: parsed, model };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (!(e instanceof Error && e.name === 'AbortError')) throw new Error(lastError);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
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
