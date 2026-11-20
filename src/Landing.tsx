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
 * scene that a screen of w×h shows (the SVG uses preserveAspectRatio "slice").
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
  return { x, y, rot, s, roll, view: { x0, y0, vw, vh } };
}

/** Opacity of a caption that fades in over [a, a+f] and out over [b-f, b]. */
const band = (p: number, a: number, b: number, f = 0.05) => Math.min(smooth(a, a + f, p), 1 - smooth(b - f, b, p));

const STARS = Array.from({ length: 70 }, (_, i) => ({ x: (i * 377) % 1600, y: (i * 151) % 520, r: i % 7 === 0 ? 1.6 : 0.9 }));
const LIGHTS = Array.from({ length: 80 }, (_, i) => i * 60);
const SKYLINE = Array.from({ length: 34 }, (_, i) => ({ x: i * 50 - 20, w: 34 + ((i * 13) % 20), h: 40 + ((i * 37) % 110) }));

function Plane() {
  return (
    <g transform="translate(-100 -30)">
      {/* vertical tail */}
      <path d="M28 23 L14 2 L30 2 L54 23 Z" fill="#cbd5e1" />
      <path d="M17 6 L29 6 L33 11 L21 11 Z" fill="#38bdf8" />
      {/* horizontal stabiliser */}
      <path d="M30 29 L12 33 L20 35 L46 31 Z" fill="#94a3b8" />
      {/* fuselage */}
      <path d="M22 30 C22 25 28 22 40 22 L168 22 C181 22 191 26 197 30 C191 34 181 38 168 38 L40 38 C28 38 22 35 22 30 Z" fill="#e8edf7" />
      <path d="M40 33.5 L176 33.5" stroke="#38bdf8" strokeWidth="2" />
      {/* windows */}
      {Array.from({ length: 15 }, (_, i) => (
        <circle key={i} cx={62 + i * 7} cy={27.5} r={1.3} fill="#334155" />
      ))}
      <path d="M177 25.5 L188 27.5 L185 29.5 L176 29 Z" fill="#1e293b" />
      {/* wing + engine */}
      <path d="M96 32 L70 50 L84 50 L126 33 Z" fill="#cbd5e1" />
      <rect x="86" y="37" width="28" height="9" rx="4.5" fill="#94a3b8" />
      <circle className="lp-engine" cx="86" cy="41.5" r="3" fill="#f59e0b" />
      {/* landing gear */}
      <g className="lp-gear">
        <path d="M60 38 L60 47 M150 38 L150 47 M104 46 L104 50" stroke="#64748b" strokeWidth="2" />
        <circle cx="60" cy="49" r="3" fill="#0f172a" stroke="#64748b" />
        <circle cx="150" cy="49" r="3" fill="#0f172a" stroke="#64748b" />
      </g>
    </g>
  );
}

interface Props {
  onLaunch: () => void;
  prefetch: () => Promise<unknown>;
}

export default function Landing({ onLaunch, prefetch }: Props) {
  const heroRef = useRef<HTMLElement>(null);
  const planeRef = useRef<SVGGElement>(null);
  const groundRef = useRef<SVGGElement>(null);
  const lightsRef = useRef<SVGGElement>(null);
  const cloudsRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const starsRef = useRef<SVGGElement>(null);
  const capRefs = useRef<(HTMLDivElement | null)[]>([]);
  const titleRef = useRef<HTMLDivElement>(null);
  const progRef = useRef<HTMLDivElement>(null);

  // Warm the simulator chunk so the launch is instant.
  useEffect(() => {
    const id = window.setTimeout(() => void prefetch(), 1200);
    return () => window.clearTimeout(id);
  }, [prefetch]);

  useEffect(() => {
    let raf = 0;
    const render = () => {
      raf = 0;
      const hero = heroRef.current;
      if (!hero) return;
      const total = hero.offsetHeight - window.innerHeight;
      const p = clamp(-hero.getBoundingClientRect().top / Math.max(total, 1));

      const { x, y, rot, s, roll } = planePose(p, window.innerWidth, window.innerHeight);
      planeRef.current?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(2)}) scale(${s.toFixed(3)})`);
      planeRef.current?.style.setProperty('--gear', String(1 - smooth(0.46, 0.54, p)));

      groundRef.current?.setAttribute('transform', `translate(0 ${(smooth(0.38, 1, p) * 420).toFixed(1)})`);
      lightsRef.current?.setAttribute('transform', `translate(${(-(roll * 2200) - clamp((p - 0.4) / 0.6) * 600).toFixed(1)} 0)`);
      starsRef.current?.setAttribute('transform', `translate(0 ${(p * 60).toFixed(1)})`);
      if (cloudsRef.current) {
        cloudsRef.current.setAttribute('transform', `translate(${(-p * 200).toFixed(1)} ${(560 - smooth(0.45, 1, p) * 520).toFixed(1)})`);
        cloudsRef.current.style.opacity = String(smooth(0.42, 0.62, p));
      }
      if (trailRef.current) {
        trailRef.current.style.opacity = String(smooth(0.5, 0.7, p) * 0.7);
        trailRef.current.setAttribute('d', `M${(x - 95 * s).toFixed(1)} ${(y + 10).toFixed(1)} Q ${(x - 500).toFixed(1)} ${(y + 160).toFixed(1)} ${(x - 900).toFixed(1)} ${(y + 260).toFixed(1)}`);
      }
      if (titleRef.current) {
        const o = 1 - smooth(0.02, 0.1, p);
        titleRef.current.style.opacity = String(o);
        titleRef.current.style.transform = `translateY(${(-p * 120).toFixed(1)}px)`;
      }
      const bands: [number, number][] = [[0.1, 0.36], [0.38, 0.66], [0.68, 2]];
      capRefs.current.forEach((el, i) => {
        if (!el) return;
        const o = band(p, bands[i][0], bands[i][1]);
        el.style.opacity = String(o);
        el.style.transform = `translateY(${((1 - o) * 24).toFixed(1)}px)`;
        el.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
      });
      if (progRef.current) progRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };
    render();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
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
          <svg className="lp-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <linearGradient id="lp-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#050816" />
                <stop offset="0.55" stopColor="#0b1430" />
                <stop offset="0.85" stopColor="#1b1f4a" />
                <stop offset="1" stopColor="#3a1f4f" />
              </linearGradient>
              <radialGradient id="lp-glow" cx="0.5" cy="1" r="0.7">
                <stop offset="0" stopColor="#f59e0b" stopOpacity="0.25" />
                <stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="lp-trail" x1="1" y1="0" x2="0" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect width="1600" height="900" fill="url(#lp-sky)" />
            <g ref={starsRef}>
              {STARS.map((s, i) => (
                <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={0.25 + (i % 5) * 0.12} />
              ))}
            </g>
            <path ref={trailRef} fill="none" stroke="url(#lp-trail)" strokeWidth="3" strokeLinecap="round" style={{ opacity: 0 }} />

            <g ref={groundRef}>
              <rect x="0" y="560" width="1600" height="200" fill="url(#lp-glow)" />
              {SKYLINE.map((b, i) => (
                <g key={i}>
                  <rect x={b.x} y={690 - b.h} width={b.w} height={b.h} fill="#0b1124" />
                  {Array.from({ length: Math.floor(b.h / 22) }, (_, j) => (
                    <rect key={j} x={b.x + 6 + ((i + j) % 3) * 8} y={690 - b.h + 8 + j * 20} width="3" height="3" fill="#fcd34d" opacity={(i + j) % 4 === 0 ? 0.8 : 0.15} />
                  ))}
                </g>
              ))}
              <rect x="0" y="690" width="1600" height="210" fill="#070b16" />
              <rect x="0" y="716" width="1600" height="40" fill="#111827" />
              <g ref={lightsRef}>
                {LIGHTS.map((x) => (
                  <g key={x}>
                    <rect x={x} y="734" width="28" height="3" rx="1.5" fill="#e2e8f0" opacity="0.55" />
                    <circle cx={x + 10} cy="714" r="2.4" fill="#38bdf8" />
                    <circle cx={x + 10} cy="758" r="2.4" fill="#22c55e" />
                  </g>
                ))}
              </g>
            </g>

            <g ref={cloudsRef} style={{ opacity: 0 }}>
              {[[100, 120, 1], [520, 40, 0.8], [980, 160, 1.2], [1380, 60, 0.9], [300, 330, 1.1], [1150, 360, 0.8]].map(([cx, cy, k], i) => (
                <g key={i} transform={`translate(${cx} ${cy}) scale(${k})`} opacity={0.5 + (i % 3) * 0.15}>
                  <ellipse cx="0" cy="0" rx="140" ry="34" fill="#1e2a4a" />
                  <ellipse cx="-50" cy="-18" rx="70" ry="30" fill="#24335a" />
                  <ellipse cx="40" cy="-24" rx="80" ry="36" fill="#2a3b66" />
                </g>
              ))}
            </g>

            <g ref={planeRef}>
              <Plane />
            </g>
          </svg>

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
        <p className="lp-foot">Built for Prompt Wars · React, TypeScript, Gemini, Vercel</p>
      </section>
    </div>
  );
}
