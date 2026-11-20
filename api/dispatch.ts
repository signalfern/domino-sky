import type { VercelRequest, VercelResponse } from '@vercel/node';
import { callGemini, callGeminiParse, validateBody } from '../src/server/gemini.js';
import { createRateLimiter } from '../src/server/rateLimit.js';

const limit = createRateLimiter(20, 60_000); // 20 AI calls per minute per client

function clientKey(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'POST').json({ error: 'Use POST' });
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) return res.status(415).json({ error: 'Send JSON' });

  const rl = limit(clientKey(req));
  if (!rl.ok) return res.status(429).setHeader('Retry-After', String(rl.retryAfterSec)).json({ error: 'Too many AI requests, try again shortly' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI dispatcher is not configured (GEMINI_API_KEY missing)' });

  let input;
  try {
    input = validateBody(req.body);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
  try {
    const out = input.task === 'parse' ? await callGeminiParse(input.text, key, process.env.GEMINI_MODEL) : await callGemini(input, key, process.env.GEMINI_MODEL);
    return res.status(200).json(out);
  } catch (e) {
    // Details stay in the server log; the browser only needs to know it should fall back.
    console.error('[dispatch]', e instanceof Error ? e.message : e);
    return res.status(502).json({ error: 'Gemini is busy or unavailable' });
  }
}
