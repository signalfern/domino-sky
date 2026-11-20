import type { DispatchOutcome } from '../ai/dispatch';
import type { Plan, PlanSet } from '../engine/planner';
import { fmtNum } from '../ui';

interface Props {
  planSet: PlanSet;
  stale: boolean;
  status: 'idle' | 'loading' | 'done';
  outcome: DispatchOutcome | null;
  applied: string | null;
  onAsk: () => void;
  onApply: (id: string | null) => void;
}

function Metrics({ p, base }: { p: Plan; base: PlanSet['disrupted'] }) {
  const m = p.result.metrics;
  return (
    <div className="plan-metrics">
      <span>stranded <b>{fmtNum(base.metrics.strandedPax)}→{fmtNum(m.strandedPax)}</b></span>
      <span>delay <b>{fmtNum(base.metrics.totalDelayMin)}→{fmtNum(m.totalDelayMin)}</b> min</span>
      <span>cxl <b>{m.cancelledFlights}</b></span>
      {m.sparesUsed > 0 && <span>spares <b>{m.sparesUsed}</b></span>}
    </div>
  );
}

export function Dispatcher({ planSet, stale, status, outcome, applied, onAsk, onApply }: Props) {
  const { plans, disrupted } = planSet;
  const rec = outcome?.planId ?? null;
  const ordered = rec ? [...plans].sort((a, b) => Number(b.id === rec) - Number(a.id === rec)) : plans;
  const noDisruption = disrupted.metrics.cost === 0;

  return (
    <section className="panel dispatcher" aria-label="AI dispatcher" aria-busy={status === 'loading'}>
      <h2>
        <span style={{ color: 'var(--ai)' }}>✦</span> AI dispatcher
        <span className="spacer" />
        {outcome && (outcome.source === 'gemini' ? <span className="badge ai">Gemini{outcome.model ? ` · ${outcome.model}` : ''}</span> : <span className="badge warn">Rule-based</span>)}
      </h2>

      {status !== 'done' && (
        <div className="ai-empty">
          <p style={{ margin: 0 }}>
            {noDisruption
              ? 'Nothing to fix. Close an airport to see the domino effect.'
              : `The engine checked recovery moves and found ${plans.length} plan${plans.length === 1 ? '' : 's'} that beat doing nothing. Ask the dispatcher to pick one and explain it.`}
          </p>
          <button className="btn ai" onClick={onAsk} disabled={noDisruption || status === 'loading' || stale}>
            {status === 'loading' ? 'Dispatcher is thinking…' : stale ? 'Recomputing plans…' : '✦ Ask AI dispatcher'}
          </button>
          {status === 'loading' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="shimmer" style={{ width: '90%' }} />
              <div className="shimmer" style={{ width: '75%' }} />
              <div className="shimmer" style={{ width: '82%' }} />
            </div>
          )}
        </div>
      )}

      {status === 'done' && outcome && (
        <>
          <div className="ai-head">{outcome.reply.headline}</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className={`badge ${outcome.verification.ok ? 'ok' : 'warn'}`} title="Every number in this text was checked against the simulation engine.">
              {outcome.verification.ok ? '✓' : '!'} {outcome.verification.verified}/{outcome.verification.checked} numbers match the engine
            </span>
            <button className="btn small ghost" onClick={onAsk}>↻ Ask again</button>
          </div>
          {outcome.note && <div className="note">{outcome.note}. Showing the deterministic rule-based dispatcher.</div>}
          <ul className="ai-list">
            {outcome.reply.explanation.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          {outcome.reply.risks.length > 0 && (
            <>
              <div className="ai-section-title">Risks</div>
              <ul className="ai-list">
                {outcome.reply.risks.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </>
          )}
          {outcome.reply.whyNotOthers && <div className="note">{outcome.reply.whyNotOthers}</div>}
        </>
      )}

      {plans.length > 0 && (
        <>
          <div className="ai-section-title">Candidate plans (engine-scored)</div>
          <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflow: 'auto' }}>
            {ordered.map((p) => (
              <div key={p.id} className={`plan-card${p.id === rec ? ' rec' : ''}${p.id === applied ? ' applied' : ''}`}>
                <div className="plan-top">
                  <span className="plan-id">{p.id}</span>
                  {p.id === rec && <span className="badge ai">recommended</span>}
                  {p.id === applied && <span className="badge ok">applied</span>}
                  <span style={{ flex: 1 }} />
                  {p.id === applied ? (
                    <button className="btn small" onClick={() => onApply(null)}>Undo</button>
                  ) : (
                    <button className={`btn small${p.id === rec ? ' primary' : ''}`} onClick={() => onApply(p.id)}>Apply</button>
                  )}
                </div>
                <ol className="plan-steps">
                  {p.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                <Metrics p={p} base={disrupted} />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
