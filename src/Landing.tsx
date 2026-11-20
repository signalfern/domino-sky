import { useEffect, useRef } from 'react';
import './landing.css';

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const easeIn = (t: number) => t * t;

/**
 * Plane pose in the 1600×900 scene for scroll progress p, kept inside the part of the
 * scene that a screen of w×h shows (the scene is scaled to cover the screen, like "slice").
 */
export function planePose(p: number, w: number, h: number) {
  const k = Math.max(w / 1600, h / 900);
  const vw = w / k;
  const vh = h / k;
  const x0 = (1600 - vw) / 2;
  const y0 = (900 - vh) / 2;
  const s0 = Math.min(2.2, vw * 0.0016);
  const half = 100 * s0;
  const roll = easeIn(clamp(p / 0.4));
  const climb = smooth(0.36, 1, p);
  const xa = x0 + half + 0.04 * vw;
  const xb = x0 + 0.5 * vw;
  const xc = x0 + vw - half * 0.7 - 0.04 * vw;
  const x = xa + roll * (xb - xa) + clamp((p - 0.4) / 0.6) * (xc - xb);
  const yGround = 718 - 22 * s0;
  const y = yGround - climb * (yGround - (y0 + vh * 0.24));
  const rot = -13 * smooth(0.3, 0.44, p) + 4 * smooth(0.8, 1, p);
  const s = s0 * (1 - 0.32 * smooth(0.45, 1, p));
  return { x, y, rot, s, s0, roll, k, view: { x0, y0, vw, vh } };
}

/** Opacity of a caption that fades in over [a, a+f] and out over [b-f, b]. */
const band = (p: number, a: number, b: number, f = 0.05) => Math.min(smooth(a, a + f, p), 1 - smooth(b - f, b, p));

const STARS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 377) % 1600, y: (i * 151) % 520, r: i % 7 === 0 ? 1.6 : 0.9 }));
const SKYLINE = Array.from({ length: 34 }, (_, i) => ({ x: i * 50 - 20, w: 34 + ((i * 13) % 20), h: 40 + ((i * 37) % 110) }));
const CLOUDS = [
  [6, 14, 1], [32, 4, 0.8], [61, 18, 1.2], [86, 7, 0.9], [18, 38, 1.1], [72, 40, 0.8],
] as const;
const PLANE_RATIO = 940 / 286;
const LIGHT_GAP = 60; // scene units between runway lights

interface Props {
  onLaunch: () => void;
  prefetch: () => Promise<unknown>;
}

export default function Landing({ onLaunch, prefetch }: Props) {
  const heroRef = useRef<HTMLElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const groundRef = useRef<HTMLDivElement>(null);
  const lightsRef = useRef<HTMLDivElement>(null);
  const cloudsRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<SVGSVGElement>(null);
  const capRefs = useRef<(HTMLDivElement | null)[]>([]);
  const titleRef = useRef<HTMLDivElement>(null);
  const progRef = useRef<HTMLDivElement>(null);

  // Warm the simulator chunk so the launch is instant.
  useEffect(() => {
    const id = window.setTimeout(() => void prefetch(), 1200);
    return () => window.clearTimeout(id);
  }, [prefetch]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let shown = -1; // smoothed progress
    let layout = { w: 0, h: 0, k: 1, x0: 0, y0: 0 };

    const target = () => {
      const hero = heroRef.current;
      if (!hero) return 0;
      return clamp(-hero.getBoundingClientRect().top / Math.max(hero.offsetHeight - window.innerHeight, 1));
    };

    const relayout = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const pose = planePose(0, w, h);
      layout = { w, h, k: pose.k, x0: pose.view.x0, y0: pose.view.y0 };
      const plane = planeRef.current;
      if (plane) {
        const pw = 200 * pose.s0 * pose.k;
        plane.style.width = `${pw}px`;
        plane.style.height = `${pw / PLANE_RATIO}px`;
      }
      const lights = lightsRef.current;
      if (lights) {
        lights.style.top = `${(714 - layout.y0) * layout.k}px`;
        lights.style.height = `${46 * layout.k}px`;
        lights.style.setProperty('--gap', `${LIGHT_GAP * layout.k}px`);
      }
    };

    const draw = (p: number) => {
      const { k, x0, y0 } = layout;
      const pose = planePose(p, layout.w, layout.h);
      const px = (pose.x - x0) * k;
      const py = (pose.y - y0) * k;
      const plane = planeRef.current;
      if (plane) {
        plane.style.transform = `translate3d(${(px - plane.offsetWidth / 2).toFixed(1)}px, ${(py - plane.offsetHeight / 2).toFixed(1)}px, 0) rotate(${pose.rot.toFixed(2)}deg) scale(${(pose.s / pose.s0).toFixed(4)})`;
      }
      if (trailRef.current) trailRef.current.style.opacity = (smooth(0.5, 0.7, p) * 0.8).toFixed(3);
      if (groundRef.current) groundRef.current.style.transform = `translate3d(0, ${(smooth(0.38, 1, p) * 420 * k).toFixed(1)}px, 0)`;
      if (lightsRef.current) {
        const run = (pose.roll * 2200 + clamp((p - 0.4) / 0.6) * 600) * k;
        lightsRef.current.style.transform = `translate3d(${(-(run % (LIGHT_GAP * k))).toFixed(1)}px, 0, 0)`;
      }
      if (starsRef.current) starsRef.current.style.transform = `translate3d(0, ${(p * 60 * k).toFixed(1)}px, 0)`;
      if (cloudsRef.current) {
        cloudsRef.current.style.transform = `translate3d(${(-p * 200 * k).toFixed(1)}px, ${((560 - smooth(0.45, 1, p) * 520) * k).toFixed(1)}px, 0)`;
        cloudsRef.current.style.opacity = smooth(0.42, 0.62, p).toFixed(3);
      }
      if (titleRef.current) {
        titleRef.current.style.opacity = (1 - smooth(0.02, 0.1, p)).toFixed(3);
        titleRef.current.style.transform = `translate3d(0, ${(-p * 120).toFixed(1)}px, 0)`;
      }
      const bands: [number, number][] = [[0.1, 0.36], [0.38, 0.66], [0.68, 2]];
      capRefs.current.forEach((el, i) => {
        if (!el) return;
        const o = band(p, bands[i][0], bands[i][1]);
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate3d(0, ${((1 - o) * 24).toFixed(1)}px, 0)`;
        el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
      });
      if (progRef.current) progRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
    };

    // Ease the shown progress toward the scroll position every frame: smooth even with stepped mouse wheels.
    const tick = () => {
      raf = 0;
      const t = target();
      shown = shown < 0 || reduce ? t : shown + (t - shown) * 0.16;
      if (Math.abs(t - shown) < 0.0004) shown = t;
      draw(shown);
      if (shown !== t) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onResize = () => {
      relayout();
      kick();
    };

    relayout();
    tick();
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', kick);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  const launch = (e: React.MouseEvent) => {
    e.preventDefault();
    onLaunch();
  };

  return (
    <div className="lp">
      <nav className="lp-nav">
        <a className="lp-brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M3 15l7-2.5L13.5 4l1.8.8-1.6 6.4 6-1.8.8 1.7-6.2 2.6 1.6 5.2-1.7.9-3.4-4.3-6.9.9z" fill="white" /></svg>
          </span>
          Domino Sky
        </a>
        <a className="lp-btn small" href="/simulate" onClick={launch} onMouseEnter={() => void prefetch()}>
          Launch simulator →
        </a>
        <div className="lp-progress" ref={progRef} aria-hidden="true" />
      </nav>

      <section className="lp-hero" ref={heroRef} aria-label="Take-off story">
        <div className="lp-sticky">
          <div className="lp-sky" aria-hidden="true" />
          <svg className="lp-layer" ref={starsRef} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {STARS.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={0.25 + (i % 5) * 0.12} />
            ))}
          </svg>

          <div className="lp-layer" ref={groundRef} aria-hidden="true">
            <svg className="lp-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
              <defs>
                <radialGradient id="lp-glow" cx="0.5" cy="1" r="0.7">
                  <stop offset="0" stopColor="#f59e0b" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect x="0" y="560" width="1600" height="200" fill="url(#lp-glow)" />
              {SKYLINE.map((b, i) => (
                <g key={i}>
                  <rect x={b.x} y={690 - b.h} width={b.w} height={b.h} fill="#0b1124" />
                  {Array.from({ length: Math.floor(b.h / 22) }, (_, j) => (
                    <rect key={j} x={b.x + 6 + ((i + j) % 3) * 8} y={690 - b.h + 8 + j * 20} width="3" height="3" fill="#fcd34d" opacity={(i + j) % 4 === 0 ? 0.8 : 0.15} />
                  ))}
                </g>
              ))}
              <rect x="0" y="690" width="1600" height="900" fill="#070b16" />
              <rect x="0" y="716" width="1600" height="40" fill="#111827" />
            </svg>
            <div className="lp-lights" ref={lightsRef} />
          </div>

          <div className="lp-layer lp-clouds" ref={cloudsRef} aria-hidden="true">
            {CLOUDS.map(([x, y, s], i) => (
              <div key={i} className="lp-cloud" style={{ left: `${x}%`, top: `${y}%`, transform: `scale(${s})`, opacity: 0.55 + (i % 3) * 0.15 }} />
            ))}
          </div>

          <div className="lp-plane" ref={planeRef} aria-hidden="true">
            <div className="lp-trail" ref={trailRef} />
            <img src="/plane-737.webp" alt="" width={940} height={286} decoding="async" fetchPriority="high" />
          </div>

          <div className="lp-copy">
            <div className="lp-title" ref={titleRef}>
              <p className="lp-kicker">Airline disruption simulator</p>
              <h1>One storm. Seventy flights.<br />Watch the dominoes fall.</h1>
              <p className="lp-lead">Close any airport and see how the delay spreads through aircraft, connections and crews. Then let an AI dispatcher recover the day.</p>
              <div className="lp-scroll" aria-hidden="true">Scroll to take off ↓</div>
            </div>
            <div className="lp-cap" ref={(el) => (capRefs.current[0] = el)}>
              <span className="lp-step">06:00</span>
              <h2>Each aircraft flies a chain of flights.</h2>
              <p>16 aircraft, 70 flights, 16 airports. Every plane must land before its next flight can leave.</p>
            </div>
            <div className="lp-cap" ref={(el) => (capRefs.current[1] = el)}>
              <span className="lp-step storm">07:30 · Mumbai closed</span>
              <h2>A 90-minute storm holds one plane.</h2>
              <p>Every later flight on its chain now starts late, even in cities with clear skies.</p>
            </div>
            <div className="lp-cap" ref={(el) => (capRefs.current[2] = el)}>
              <span className="lp-step">The domino effect</span>
              <h2>Connections break. Crews run out of hours.</h2>
              <p>Find out how far it spreads, and how to stop it.</p>
              <a className="lp-btn" href="/simulate" onClick={launch}>Launch the simulator →</a>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section">
        <h2 className="lp-h2">How it works</h2>
        <div className="lp-steps">
          <div className="lp-card">
            <span className="lp-num">1</span>
            <h3>Close an airport</h3>
            <p>Pick any of 16 airports, a start time and a duration. Or start from a ready scenario.</p>
          </div>
          <div className="lp-card">
            <span className="lp-num">2</span>
            <h3>Watch it spread</h3>
            <p>See which flights are late and why, how many passengers are stranded, and which crews go over their legal hours.</p>
          </div>
          <div className="lp-card">
            <span className="lp-num">3</span>
            <h3>Recover with AI</h3>
            <p>A Gemini dispatcher picks the best recovery plan: cancel a flight, swap in a spare aircraft or hold a connection. Compare before and after.</p>
          </div>
        </div>
      </section>

      <section className="lp-section lp-trust">
        <div>
          <h2 className="lp-h2">The AI explains. The code calculates.</h2>
          <p>Every delay and passenger number comes from a deterministic simulation engine. The AI never does maths. Each number it writes is checked against the engine before you see it.</p>
        </div>
        <div className="lp-badge" aria-hidden="true">
          <span>✓</span> 13/13 numbers verified
        </div>
      </section>

      <section className="lp-section lp-final">
        <h2 className="lp-h2">Ready for departure?</h2>
        <a className="lp-btn big" href="/simulate" onClick={launch} onMouseEnter={() => void prefetch()}>
          Launch the simulator →
        </a>
        <p className="lp-foot">Built for Prompt Wars · React, TypeScript, Gemini, Vercel · Aircraft drawing: Julien Scavini, Wikimedia Commons, CC BY-SA 3.0</p>
      </section>
    </div>
  );
}
