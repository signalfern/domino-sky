import { describe, expect, it } from 'vitest';
import { network } from '../src/data/network';
import { AIRPORT_ALIASES, parseCrisisLocal, runCrisisParser, toClosures } from '../src/ai/crisis';
import { toMin } from '../src/engine/time';

const parse = (t: string) => toClosures(parseCrisisLocal(t).closures).map((c) => [c.airport, c.start, c.end]);

describe('plain-English crisis parser (offline)', () => {
  it('covers exactly the dataset airports', () => {
    expect(Object.keys(AIRPORT_ALIASES).sort()).toEqual(network.airports.map((a) => a.id).sort());
  });
  it('reads chained storms with a start + duration and a time range', () => {
    expect(parse('Thunderstorm over Mumbai at 7:30 for 90 minutes and fog in Delhi from 6 to 8')).toEqual([
      ['BOM', toMin('07:30'), toMin('09:00')],
      ['DEL', toMin('06:00'), toMin('08:00')],
    ]);
  });
  it('reads bare-hour ranges like "6 to 8" and "6pm till 9pm"', () => {
    expect(parse('storm over Hyderabad at 10:30 for 75 min and fog in Delhi 6 to 8')).toEqual([
      ['HYD', toMin('10:30'), toMin('11:45')],
      ['DEL', toMin('06:00'), toMin('08:00')],
    ]);
    expect(parse('Pune 6pm till 9pm')).toEqual([['PNQ', toMin('18:00'), toMin('21:00')]]);
  });
  it('reads old city names, am/pm and word durations', () => {
    expect(parse('bangalore shut at 2pm for two hours')).toEqual([['BLR', toMin('14:00'), toMin('16:00')]]);
    expect(parse('GAU closed 17:00 for an hour and a half')).toEqual([['GAU', toMin('17:00'), toMin('18:30')]]);
    expect(parse('Calcutta 1.5 hours from 9:15')).toEqual([['CCU', toMin('09:15'), toMin('10:45')]]);
  });
  it('fills defaults and says so', () => {
    const r = parseCrisisLocal('Goa is closed');
    expect(toClosures(r.closures)).toEqual([{ id: 'C1', airport: 'GOI', start: toMin('08:00'), end: toMin('09:00') }]);
    expect(r.note).toMatch(/no start time/);
  });
  it('does not treat words like "delay" as Delhi', () => {
    expect(parse('a long delay everywhere')).toEqual([]);
  });
});

describe('crisis runner', () => {
  it('uses Gemini output after validating it against the network', async () => {
    const out = await runCrisisParser('x', async () => ({ closures: [{ airport: 'HYD', start: '10:30', minutes: 75 }, { airport: 'XXX', start: '10:00', minutes: 30 }], note: '' }));
    expect(out.source).toBe('gemini');
    expect(out.closures).toEqual([{ id: 'C1', airport: 'HYD', start: toMin('10:30'), end: toMin('11:45') }]);
  });
  it('falls back to the offline parser when the API fails', async () => {
    const out = await runCrisisParser('storm in Chennai at 11:00 for 45 min', async () => { throw new Error('503'); });
    expect(out.source).toBe('rules');
    expect(out.closures).toEqual([{ id: 'C1', airport: 'MAA', start: toMin('11:00'), end: toMin('11:45') }]);
  });
});
