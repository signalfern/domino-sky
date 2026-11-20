import { describe, expect, it } from 'vitest';
import { dur, fmt, toMin } from '../src/engine/time';

describe('time', () => {
  it('parses and formats HH:MM', () => {
    expect(toMin('08:50')).toBe(530);
    expect(fmt(530)).toBe('08:50');
  });
  it('marks next-day times', () => {
    expect(fmt(1455)).toBe('+1 00:15');
  });
  it('formats durations', () => {
    expect(dur(45)).toBe('45 min');
    expect(dur(90)).toBe('1h 30m');
    expect(dur(120)).toBe('2h');
  });
});
