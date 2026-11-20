/**
 * Fixed-window, per-key rate limiter (best effort: one window table per serverless instance).
 * Protects the Gemini quota behind /api/dispatch from scripted abuse.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): { ok: boolean; retryAfterSec: number } => {
    const t = now();
    let h = hits.get(key);
    if (!h || t >= h.reset) {
      h = { count: 0, reset: t + windowMs };
      hits.set(key, h);
    }
    h.count++;
    if (hits.size > 5_000) for (const [k, v] of hits) if (t >= v.reset) hits.delete(k);
    return { ok: h.count <= limit, retryAfterSec: Math.max(1, Math.ceil((h.reset - t) / 1000)) };
  };
}
