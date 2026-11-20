import { describe, expect, it } from 'vitest';
import { planePose } from '../src/Landing';

const SCREENS: [string, number, number][] = [['desktop', 1440, 900], ['wide', 2560, 1080], ['laptop', 1280, 720], ['phone', 375, 812], ['tablet', 768, 1024]];

describe('landing take-off pose', () => {
  for (const [name, w, h] of SCREENS) {
    it(`keeps the plane on screen through the whole scroll (${name})`, () => {
      for (let i = 0; i <= 20; i++) {
        const { x, y, s, view } = planePose(i / 20, w, h);
        const half = 100 * s;
        expect(x - half).toBeGreaterThanOrEqual(view.x0 - 1);
        expect(x + half).toBeLessThanOrEqual(view.x0 + view.vw + 1);
        expect(y - 30 * s).toBeGreaterThanOrEqual(view.y0);
        expect(y + 30 * s).toBeLessThanOrEqual(view.y0 + view.vh);
      }
    });
  }
  it('rolls on the runway, then climbs and pitches up', () => {
    const start = planePose(0, 1440, 900);
    const lift = planePose(0.3, 1440, 900);
    const end = planePose(1, 1440, 900);
    expect(lift.y).toBeCloseTo(start.y, 0);
    expect(lift.x).toBeGreaterThan(start.x);
    expect(end.y).toBeLessThan(start.y - 200);
    expect(planePose(0.5, 1440, 900).rot).toBeLessThan(-10);
  });
});
