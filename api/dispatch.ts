import type { VercelRequest, VercelResponse } from '@vercel/node';
import { callGemini, callGeminiParse, validateBody } from '../src/server/gemini.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
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
    return res.status(502).json({ error: e instanceof Error ? e.message : 'Gemini call failed' });
  }
}
