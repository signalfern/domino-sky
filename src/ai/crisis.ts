/**
 * Plain-English crisis → simulation closures.
 * Shared by the browser and the serverless function: no runtime imports.
 * Gemini does the parsing when available; a deterministic parser is the offline fallback.
 */
import type { Closure } from '../engine/types';

/** Names people use for each airport in the dataset (IATA codes are matched separately, upper case). */
export const AIRPORT_ALIASES: Record<string, string[]> = {
  DEL: ['delhi', 'new delhi'],
  BOM: ['mumbai', 'bombay'],
  BLR: ['bengaluru', 'bangalore'],
  HYD: ['hyderabad'],
  MAA: ['chennai', 'madras'],
  CCU: ['kolkata', 'calcutta'],
  AMD: ['ahmedabad'],
  COK: ['kochi', 'cochin'],
  GOI: ['goa', 'dabolim'],
  PNQ: ['pune', 'poona'],
  JAI: ['jaipur'],
  GAU: ['guwahati', 'gauhati'],
  LKO: ['lucknow'],
  IXC: ['chandigarh'],
  BBI: ['bhubaneswar'],
  TRV: ['thiruvananthapuram', 'trivandrum'],
};
const CODES = Object.keys(AIRPORT_ALIASES);
export const MAX_CLOSURES = 3;
const DEFAULT_START = 8 * 60;
const DEFAULT_MINUTES = 60;

export interface ParsedClosure {
  airport: string;
  start: string; // HH:MM
  minutes: number;
}
export interface ParseReply {
  closures: ParsedClosure[];
  note: string;
}

export const PARSE_SYSTEM = `You convert a plain-English description of airport disruptions in India into simulation closures.
Airports you may use (IATA: city): ${CODES.map((c) => `${c}: ${AIRPORT_ALIASES[c][0]}`).join(', ')}.
Rules:
- One closure per affected airport, at most ${MAX_CLOSURES}. Ignore places that are not in the list and say so in "note".
- "start" is local IST time in 24-hour HH:MM. "minutes" is how long the airport is closed (5 to 720).
- A range like "from 6 to 8" means start 06:00, minutes 120. "7:30 pm" means 19:30.
- No start time given: use 08:00. No duration given: use 60. Mention every assumption in "note".
Output JSON only, matching the schema.`;

export const PARSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    closures: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { airport: { type: 'STRING', enum: CODES }, start: { type: 'STRING' }, minutes: { type: 'INTEGER' } },
        required: ['airport', 'start', 'minutes'],
      },
    },
    note: { type: 'STRING' },
  },
  required: ['closures', 'note'],
} as const;

export function isParseReply(x: unknown): x is ParseReply {
  const r = x as ParseReply;
  return !!r && Array.isArray(r.closures) && typeof r.note === 'string'
    && r.closures.every((c) => c && typeof c.airport === 'string' && typeof c.start === 'string' && typeof c.minutes === 'number');
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Validate parsed closures against the network and turn them into engine closures. */
export function toClosures(parsed: ParsedClosure[]): Closure[] {
  const out: Closure[] = [];
  for (const p of parsed) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(p.start.trim());
    if (!CODES.includes(p.airport) || !m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    if (start > 23 * 60 + 59 || Number(m[2]) > 59) continue;
    const minutes = Math.round(Math.min(720, Math.max(5, p.minutes)));
    if (out.some((c) => c.airport === p.airport)) continue;
    out.push({ id: `C${out.length + 1}`, airport: p.airport, start, end: start + minutes });
    if (out.length === MAX_CLOSURES) break;
  }
  return out;
}

/* ---------------- deterministic fallback parser ---------------- */

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, an: 1, a: 1 };

function durationIn(seg: string): { minutes: number | null; rest: string } {
  let minutes = 0;
  let found = false;
  let rest = seg;
  const take = (re: RegExp, f: (group: string) => number) => {
    rest = rest.replace(re, (_match: string, group?: string) => {
      found = true;
      minutes += f(group ?? '');
      return ' ';
    });
  };
  take(/\b(?:an?|one)\s+hour\s+and\s+a\s+half\b|\bone\s+and\s+a\s+half\s+hours?\b/gi, () => 90);
  take(/\bhalf\s+an?\s+hour\b/gi, () => 30);
  take(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/gi, (g) => Math.round(Number(g) * 60));
  take(/\b(one|two|three|four|five|six|seven|eight|an|a)\s+hours?\b/gi, (g) => WORD_NUM[g.toLowerCase()] * 60);
  take(/\b(\d+)\s*(?:minutes?|mins?|m)\b/gi, (g) => Number(g));
  return { minutes: found ? minutes : null, rest };
}

interface TimeHit { min: number; index: number; prep: string }

function timesIn(seg: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const re = /(?:\b(at|from|to|until|till|by|between|and|after)\s+|(-|–)\s*)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d])/gi;
  for (const m of seg.matchAll(re)) {
    const prep = (m[1] ?? m[2] ?? '').toLowerCase();
    const hasMin = m[4] !== undefined;
    const ampm = m[5]?.toLowerCase().replace(/\./g, '');
    if (!hasMin && !ampm && !prep) continue; // a bare number is not a time
    let h = Number(m[3]);
    const mm = hasMin ? Number(m[4]) : 0;
    if (h > 23 || mm > 59) continue;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    hits.push({ min: h * 60 + mm, index: m.index ?? 0, prep });
  }
  for (const m of seg.matchAll(/\b(noon|midday|midnight)\b/gi)) hits.push({ min: m[1].toLowerCase() === 'midnight' ? 0 : 720, index: m.index ?? 0, prep: '' });
  return hits.sort((a, b) => a.index - b.index);
}

/** "6 to 8", "06:00-08:30", "6pm till 9pm" (both ends may be bare hours). */
const RANGE = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:to|until|till|-|–)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?!\d)/i;

function clock(h: string, m: string | undefined, ampm: string | undefined): number | null {
  let hh = Number(h);
  const mm = m ? Number(m) : 0;
  const ap = ampm?.toLowerCase().replace(/\./g, '');
  if (hh > 23 || mm > 59) return null;
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  return hh * 60 + mm;
}

/** Offline parser: finds airports, times, ranges and durations in free text. */
export function parseCrisisLocal(text: string): ParseReply {
  const mentions: { code: string; index: number }[] = [];
  for (const code of CODES) {
    for (const m of text.matchAll(new RegExp(`\\b${code}\\b`, 'g'))) mentions.push({ code, index: m.index ?? 0 });
    for (const alias of AIRPORT_ALIASES[code]) {
      for (const m of text.matchAll(new RegExp(`\\b${alias.replace(' ', '\\s+')}\\b`, 'gi'))) mentions.push({ code, index: m.index ?? 0 });
    }
  }
  mentions.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const uniq = mentions.filter((m) => !seen.has(m.code) && seen.add(m.code));
  const notes: string[] = [];
  const closures: ParsedClosure[] = [];
  uniq.slice(0, MAX_CLOSURES).forEach((m, i) => {
    const from = i === 0 ? 0 : m.index;
    const to = uniq[i + 1]?.index ?? text.length;
    const { minutes, rest } = durationIn(text.slice(from, to));
    let start: number | null = null;
    let len = minutes;
    const range = RANGE.exec(rest);
    if (range) {
      const a = clock(range[1], range[2], range[3] ?? range[6]);
      const b = clock(range[4], range[5], range[6]);
      if (a !== null && b !== null) {
        start = a;
        if (len === null) len = (b - a + 1440) % 1440 || null;
      }
    }
    if (start === null) {
      const times = timesIn(rest);
      start = times[0]?.min ?? null;
      const second = times.find((t, j) => j > 0 && ['to', 'until', 'till', 'and', '-', '–'].includes(t.prep));
      if (start !== null && second && len === null) len = (second.min - start + 1440) % 1440 || null;
    }
    if (start === null) {
      start = DEFAULT_START;
      notes.push(`${m.code}: no start time, used ${hhmm(DEFAULT_START)}`);
    }
    if (len === null) {
      len = DEFAULT_MINUTES;
      notes.push(`${m.code}: no duration, used ${DEFAULT_MINUTES} min`);
    }
    closures.push({ airport: m.code, start: hhmm(start), minutes: len });
  });
  if (uniq.length > MAX_CLOSURES) notes.push(`only the first ${MAX_CLOSURES} airports are used`);
  return { closures, note: notes.join('; ') };
}

/* ---------------- client runner ---------------- */

export interface CrisisOutcome {
  closures: Closure[];
  source: 'gemini' | 'rules';
  note: string;
}

type ParseCaller = (text: string) => Promise<ParseReply>;

export const httpParse: ParseCaller = async (text) => {
  const res = await fetch('/api/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'parse', text }) });
  const data = (await res.json().catch(() => ({}))) as { parsed?: ParseReply; error?: string };
  if (!res.ok || !data.parsed) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.parsed;
};

/** Gemini first; validated against the network; deterministic parser if Gemini is down or returns nothing usable. */
export async function runCrisisParser(text: string, call: ParseCaller = httpParse): Promise<CrisisOutcome> {
  try {
    const parsed = await call(text);
    if (isParseReply(parsed)) {
      const closures = toClosures(parsed.closures);
      if (closures.length) return { closures, source: 'gemini', note: parsed.note };
    }
  } catch {
    /* fall through to the offline parser */
  }
  const local = parseCrisisLocal(text);
  return { closures: toClosures(local.closures), source: 'rules', note: local.note };
}
