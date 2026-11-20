import { buildUserPrompt, isDispatchReply, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION } from '../ai/prompt';
import type { DispatchContext, DispatchReply } from '../ai/prompt';

const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash'];
const MAX_BODY = 120_000;

export interface GeminiResult {
  reply: DispatchReply;
  model: string;
}

export function validateBody(body: unknown): { context: DispatchContext; feedback?: string } {
  const b = (typeof body === 'string' ? JSON.parse(body) : body) as { context?: DispatchContext; feedback?: unknown };
  if (!b || typeof b !== 'object' || !b.context || typeof b.context !== 'object') throw new Error('Missing context');
  if (JSON.stringify(b).length > MAX_BODY) throw new Error('Request too large');
  if (!Array.isArray(b.context.plans) || typeof b.context.facts !== 'object') throw new Error('Bad context');
  return { context: b.context, feedback: typeof b.feedback === 'string' ? b.feedback.slice(0, 2000) : undefined };
}

export async function callGemini(
  input: { context: DispatchContext; feedback?: string },
  apiKey: string,
  preferredModel?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeminiResult> {
  const models = [...new Set([preferredModel, ...FALLBACK_MODELS].filter(Boolean) as string[])];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input.context, input.feedback) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
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
      if (!isDispatchReply(parsed)) throw new Error('Gemini reply did not match schema');
      return { reply: parsed, model };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (!(e instanceof Error && e.name === 'AbortError')) throw new Error(lastError);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}
