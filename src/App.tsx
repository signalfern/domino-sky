import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { network } from './data/network';
import { simulate, dominoChain } from './engine/simulate';
import { buildPlans } from './engine/planner';
import { buildFacts } from './engine/facts';
import { fmt } from './engine/time';
import type { Closure } from './engine/types';
import { runDispatcher, type DispatchOutcome } from './ai/dispatch';
import { NetworkMap } from './components/NetworkMap';
import { Timeline } from './components/Timeline';
import { Controls, nextClosureId } from './components/Controls';
import { Dispatcher } from './components/Dispatcher';
import { KpiBar, Tables, WhyPanel } from './components/Panels';
import { PRESETS, cityOf } from './ui';

type View = 'before' | 'after';
const SPEEDS = [15, 45, 120];

export default function App() {
  const [closures, setClosures] = useState<Closure[]>(PRESETS[0].closures);
  const deferred = useDeferredValue(closures);
  const disrupted = useMemo(() => simulate(network, { closures, actions: [] }), [closures]);
  const planSet = useMemo(() => buildPlans(network, deferred), [deferred]);
  const facts = useMemo(() => buildFacts(planSet, network), [planSet]);
  const stale = deferred !== closures;

  const [applied, setApplied] = useState<string | null>(null);
  const [view, setView] = useState<View>('before');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [outcome, setOutcome] = useState<DispatchOutcome | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(() => (PRESETS[0].closures[0].end + 30));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1]);
  const reqId = useRef(0);
  const aboutRef = useRef<HTMLDialogElement>(null);

  // A new scenario invalidates the old dispatch and plan.
  useEffect(() => {
    reqId.current++;
    setApplied(null);
    setView('before');
    setStatus('idle');
    setOutcome(null);
  }, [closures]);

  const plan = !stale && applied ? planSet.plans.find((p) => p.id === applied) : undefined;
  const sim = plan && view === 'after' ? plan.result : disrupted;
  const chain = useMemo(() => new Set(selected ? dominoChain(sim, selected).map((r) => r.id) : []), [sim, selected]);

  // Playback.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const n = t + dt * speed;
        if (n >= 24 * 60 + 60) {
          setPlaying(false);
          return 24 * 60 + 60;
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const ask = useCallback(async () => {
    const id = ++reqId.current;
    setStatus('loading');
    const out = await runDispatcher(network, planSet, facts);
    if (id !== reqId.current) return;
    setOutcome(out);
    setStatus('done');
  }, [planSet, facts]);

  const applyPlan = (id: string | null) => {
    setApplied(id);
    setView(id ? 'after' : 'before');
  };

  const onAirport = useCallback((ap: string) => {
    setClosures((cs) => {
      if (cs.length === 0) return [{ id: 'C1', airport: ap, start: 8 * 60, end: 9 * 60 + 30 }];
      if (cs.some((c) => c.airport === ap)) return cs;
      const [first, ...rest] = cs;
      return [{ ...first, airport: ap }, ...rest];
    });
  }, []);

  const presetActive = (pid: string) => {
    const p = PRESETS.find((x) => x.id === pid)!;
    return closures.length === 1 && p.closures[0].airport === closures[0].airport && p.closures[0].start === closures[0].start && p.closures[0].end === closures[0].end;
  };

  const loadPreset = (pid: string) => {
    const p = PRESETS.find((x) => x.id === pid)!;
    setClosures(p.closures.map((c) => ({ ...c, id: nextClosureId([]) })));
    setTime(p.closures[0].end + 30);
    setSelected(null);
  };

  const t = Math.round(time);
  const scenarioText = closures.length
    ? closures.map((c) => `${cityOf[c.airport]} closed ${fmt(c.start)}–${fmt(c.end)}`).join(' · ')
    : 'No closure';

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 15l7-2.5L13.5 4l1.8.8-1.6 6.4 6-1.8.8 1.7-6.2 2.6 1.6 5.2-1.7.9-3.4-4.3-6.9.9z" fill="white" /></svg>
          </div>
          <div>
            <h1>Domino Sky</h1>
            <p>Close an airport. Watch the delay spread. Let the AI dispatcher recover the day.</p>
          </div>
        </div>
        <nav className="presets" aria-label="Scenario presets">
          {PRESETS.map((p) => (
            <button key={p.id} className="chip" aria-pressed={presetActive(p.id)} onClick={() => loadPreset(p.id)}>
              {p.label} <small>{p.detail}</small>
            </button>
          ))}
          <button className="icon-btn" aria-label="How Domino Sky works" onClick={() => aboutRef.current?.showModal()}>?</button>
        </nav>
      </header>

      <KpiBar current={sim.metrics} before={plan && view === 'after' ? disrupted.metrics : undefined} />

      <div className="grid-main">
        <Controls closures={closures} onChange={setClosures} />

        <section className="panel" aria-label="Network map">
          <h2>
            Network · {scenarioText}
            <span className="spacer" />
            {plan && (
              <div className="seg" role="group" aria-label="Before or after the plan">
                <button aria-pressed={view === 'before'} onClick={() => setView('before')}>Before</button>
                <button aria-pressed={view === 'after'} onClick={() => setView('after')}>After {plan.id}</button>
              </div>
            )}
          </h2>
          <NetworkMap sim={sim} closures={closures} time={t} selected={selected} chain={chain} onAirport={onAirport} onFlight={setSelected} />
          <div className="scrubber">
            <button className="btn small" onClick={() => { if (time >= 24 * 60 + 60) setTime(5 * 60); setPlaying((p) => !p); }} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="seg" role="group" aria-label="Playback speed">
              {SPEEDS.map((s) => (
                <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s === 15 ? '1×' : s === 45 ? '3×' : '8×'}</button>
              ))}
            </div>
            <input type="range" min={5 * 60} max={25 * 60} step={1} value={t} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} aria-label="Simulation time" />
            <span className="mono" style={{ minWidth: 48 }}>{fmt(t)}</span>
          </div>
        </section>

        <Dispatcher planSet={planSet} stale={stale} status={status} outcome={outcome} applied={applied} onAsk={ask} onApply={applyPlan} />
      </div>

      <section className="panel" aria-label="Aircraft timeline">
        <h2>
          Aircraft timeline <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>· dashed = schedule · bar = {plan && view === 'after' ? `after ${plan.id}` : 'simulated'} · ★ spare</span>
        </h2>
        <Timeline sim={sim} closures={closures} time={t} selected={selected} chain={chain} onFlight={setSelected} />
      </section>

      <div className="grid-bottom">
        <Tables sim={sim} selected={selected} onFlight={setSelected} />
        <WhyPanel sim={sim} closures={closures} flightId={selected} />
      </div>

      <footer className="footer">
        {network.airports.length} airports · {network.flights.length} flights · {new Set(network.flights.map((f) => f.tail_id)).size} aircraft · {network.connections.length} connections · {network.spare_aircraft.length} spares. All numbers come from a deterministic engine; the AI only explains and recommends.
      </footer>

      <dialog ref={aboutRef} aria-labelledby="about-title" onClick={(e) => e.target === aboutRef.current && aboutRef.current?.close()}>
        <h3 id="about-title">How Domino Sky works</h3>
        <ol>
          <li>While an airport is closed, no flight leaves or lands there. A flight that would land during the closure is held at its origin so it lands at reopening.</li>
          <li>Each aircraft flies its legs in order with at least {network.meta.min_turnaround_minutes} min turnaround, so one late leg delays every later leg.</li>
          <li>A connection breaks when the gap is shorter than its minimum connect time.</li>
          <li>A crew may not land after duty start + max duty. That leg and the rest of the crew's day are cancelled.</li>
          <li>Cancelling a leg leaves the aircraft where it is, so a later leg that starts elsewhere is cancelled too.</li>
          <li>A spare aircraft (with a fresh standby crew) can take over the rest of a chain from its base.</li>
          <li>Stranded passengers = passengers on cancelled flights + connecting passengers who miss their connection.</li>
          <li>Plan cost = passenger delay minutes + 180 per stranded passenger. The engine scores every plan.</li>
          <li>The Gemini dispatcher picks a plan and explains it. It must write numbers as references to engine facts. Every number is checked; if a check fails, the rule-based dispatcher is shown instead.</li>
        </ol>
        <button className="btn primary" onClick={() => aboutRef.current?.close()}>Got it</button>
      </dialog>
    </div>
  );
}
