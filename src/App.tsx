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
import { Controls } from './components/Controls';
import { Dispatcher } from './components/Dispatcher';
import { Details, Impact, WhyDrawer, type DetailTab } from './components/Panels';
import { PRESETS } from './ui';

type View = 'map' | 'timeline' | 'details';
const SPEEDS = [{ v: 15, l: '1×' }, { v: 45, l: '3×' }, { v: 120, l: '8×' }];
const T_MIN = 5 * 60;
const T_MAX = 25 * 60;

export default function App({ onHome }: { onHome?: () => void }) {
  const [closures, setClosures] = useState<Closure[]>(PRESETS[0].closures);
  const deferred = useDeferredValue(closures);
  const disrupted = useMemo(() => simulate(network, { closures, actions: [] }), [closures]);
  const planSet = useMemo(() => buildPlans(network, deferred), [deferred]);
  const facts = useMemo(() => buildFacts(planSet, network), [planSet]);
  const stale = deferred !== closures;

  const [applied, setApplied] = useState<string | null>(null);
  const [showAfter, setShowAfter] = useState(true);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [outcome, setOutcome] = useState<DispatchOutcome | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('map');
  const [detailTab, setDetailTab] = useState<DetailTab>('flights');
  const [time, setTime] = useState(PRESETS[0].closures[0].end + 30);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const reqId = useRef(0);
  const aboutRef = useRef<HTMLDialogElement>(null);

  // A new scenario invalidates the old dispatch and plan.
  useEffect(() => {
    reqId.current++;
    setApplied(null);
    setStatus('idle');
    setOutcome(null);
  }, [closures]);

  const plan = !stale && applied ? planSet.plans.find((p) => p.id === applied) : undefined;
  const after = !!plan && showAfter;
  const sim = after ? plan!.result : disrupted;
  const chain = useMemo(() => new Set(selected ? dominoChain(sim, selected).map((r) => r.id) : []), [sim, selected]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const n = t + dt * SPEEDS[speed].v;
        if (n >= T_MAX) {
          setPlaying(false);
          return T_MAX;
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
    setShowAfter(true);
  };

  const loadPreset = (cs: Closure[]) => {
    setClosures(cs.map((c) => ({ ...c })));
    setTime(cs[0].end + 30);
    setSelected(null);
  };

  const onAirport = useCallback((ap: string) => {
    setClosures((cs) => {
      if (cs.length === 0) return [{ id: 'C1', airport: ap, start: 8 * 60, end: 9 * 60 + 30 }];
      if (cs.some((c) => c.airport === ap)) return cs;
      const [first, ...rest] = cs;
      return [{ ...first, airport: ap }, ...rest];
    });
  }, []);

  const openDetails = (tab: DetailTab) => {
    setDetailTab(tab);
    setView('details');
  };

  const t = Math.round(time);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => { if (onHome) { e.preventDefault(); onHome(); } }} aria-label="Domino Sky home">
          <div className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M3 15l7-2.5L13.5 4l1.8.8-1.6 6.4 6-1.8.8 1.7-6.2 2.6 1.6 5.2-1.7.9-3.4-4.3-6.9.9z" fill="white" /></svg>
          </div>
          <div>
            <h1>Domino Sky</h1>
            <p>Close an airport, watch the delay spread, recover with AI.</p>
          </div>
        </a>
        <span className="spacer" />
        <button className="btn small" onClick={() => aboutRef.current?.showModal()}>How it works</button>
      </header>

      <main className="layout">
        <div className="col">
          <Controls closures={closures} onChange={setClosures} onPreset={loadPreset} />
          <Impact closures={closures} current={sim.metrics} before={after ? disrupted.metrics : undefined} planId={plan?.id} onOpen={openDetails} />
        </div>

        <section className="card stage" aria-label="Network view">
          <div className="stage-head">
            <div className="seg" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>Map</button>
              <button role="tab" aria-selected={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</button>
              <button role="tab" aria-selected={view === 'details'} onClick={() => setView('details')}>Details</button>
            </div>
            {view === 'details' && (
              <div className="seg" role="tablist" aria-label="Details">
                <button role="tab" aria-selected={detailTab === 'flights'} onClick={() => setDetailTab('flights')}>Flights</button>
                <button role="tab" aria-selected={detailTab === 'connections'} onClick={() => setDetailTab('connections')}>Connections</button>
                <button role="tab" aria-selected={detailTab === 'crews'} onClick={() => setDetailTab('crews')}>Crews</button>
              </div>
            )}
            <span className="spacer" />
            {plan ? (
              <div className="seg" role="group" aria-label="Before or after the plan">
                <button aria-pressed={!showAfter} onClick={() => setShowAfter(false)}>Before</button>
                <button aria-pressed={showAfter} onClick={() => setShowAfter(true)}>After {plan.id}</button>
              </div>
            ) : (
              view !== 'details' && (
                <div className="legend" aria-label="Legend">
                  <span><i style={{ background: 'var(--ok)' }} />on time</span>
                  <span><i style={{ background: 'var(--minor)' }} />≤30 min</span>
                  <span><i style={{ background: 'var(--major)' }} />&gt;30 min</span>
                  <span><i className="hatch" />cancelled</span>
                </div>
              )
            )}
          </div>

          <div className="stage-body">
            {view === 'map' && <NetworkMap sim={sim} closures={closures} time={t} selected={selected} chain={chain} onAirport={onAirport} onFlight={setSelected} />}
            {view === 'timeline' && <Timeline sim={sim} closures={closures} time={t} selected={selected} chain={chain} onFlight={setSelected} />}
            {view === 'details' && <Details sim={sim} tab={detailTab} selected={selected} onFlight={setSelected} />}
            {selected && <WhyDrawer sim={sim} closures={closures} flightId={selected} onClose={() => setSelected(null)} />}
          </div>

          {view !== 'details' && (
            <div className="scrubber">
              <button className="play" onClick={() => { if (time >= T_MAX) setTime(T_MIN); setPlaying((p) => !p); }} aria-label={playing ? 'Pause' : 'Play the day'}>
                {playing ? '❚❚' : '▶'}
              </button>
              <button className="btn small" onClick={() => setSpeed((s) => (s + 1) % SPEEDS.length)} aria-label="Playback speed">{SPEEDS[speed].l}</button>
              <input type="range" min={T_MIN} max={T_MAX} step={1} value={t} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} aria-label="Time of day" />
              <span className="mono">{fmt(t)}</span>
            </div>
          )}
        </section>

        <div className="col">
          <Dispatcher planSet={planSet} stale={stale} status={status} outcome={outcome} applied={applied} onAsk={ask} onApply={applyPlan} />
        </div>
      </main>

      <dialog ref={aboutRef} aria-labelledby="about-title" onClick={(e) => e.target === aboutRef.current && aboutRef.current?.close()}>
        <h3 id="about-title">How Domino Sky works</h3>
        <ol>
          <li>While an airport is closed, no flight leaves or lands there. A flight that would land during the closure waits at its origin.</li>
          <li>Each aircraft flies its flights in order, with at least {network.meta.min_turnaround_minutes} min on the ground. One late flight delays every later flight of that aircraft.</li>
          <li>A connection breaks when passengers get less than the minimum connect time.</li>
          <li>A crew may not land after its duty limit. That flight and the rest of the crew's day are cancelled.</li>
          <li>Stranded passengers = passengers on cancelled flights + connecting passengers who miss their connection.</li>
          <li>The engine tests every recovery move (cancel a flight, use a spare aircraft, hold a flight for connecting passengers) and scores each plan.</li>
          <li>The Gemini AI picks a plan and explains it. It never calculates. Every number it writes is checked against the engine before you see it.</li>
        </ol>
        <p className="muted" style={{ fontSize: 12.5 }}>
          {network.airports.length} airports · {network.flights.length} flights · {new Set(network.flights.map((f) => f.tail_id)).size} aircraft · {network.connections.length} connections · {network.spare_aircraft.length} spare aircraft
        </p>
        <button className="btn primary" onClick={() => aboutRef.current?.close()}>Got it</button>
      </dialog>
    </div>
  );
}
