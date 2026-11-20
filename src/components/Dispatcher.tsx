import type { DispatchOutcome } from '../ai/dispatch';
import type { Plan, PlanSet } from '../engine/planner';
import type { Metrics } from '../engine/types';
import { fmtNum, shortAction } from '../ui';

interface Props {
  planSet: PlanSet;
  stale: boolean;
  status: 'idle' | 'loading' | 'done';
  outcome: DispatchOutcome | null;
  applied: string | null;
  onAsk: () => void;
  onApply: (id: string | null) => void;
}

function BeforeAfter({ before, after }: { before: Metrics; after: Metrics }) {
  const cell = (k: string, b: number, a: number) => (
    <div>
      <div className="k">{k}</div>
      <div className="x">
        <s>{fmtNum(b)}→</s>
        <span className={a < b ? 'better' : a > b ? 'worse' : undefined}>{fmtNum(a)}</span>
      </div>
    </div>
  );
  return (
    <div className="ba">
      {cell('Stranded', before.strandedPax, after.strandedPax)}
      {cell('Delay min', before.totalDelayMin, after.totalDelayMin)}
      {cell('Cancelled', before.cancelledFlights, after.cancelledFlights)}
    </div>
  );
}

function PlanCard({ p, base, rec, applied, onApply }: { p: Plan; base: Metrics; rec: boolean; applied: boolean; onApply: (id: string | null) => void }) {
  return (
    <div className={`plan${rec ? ' rec' : ''}${applied ? ' applied' : ''}`}>
      <div className="plan-top">
        <span className="name">
          Plan {p.id}
          {rec && <span className="badge ai inline">recommended</span>}
        </span>
        {applied ? (
          <button className="btn small" onClick={() => onApply(null)}>Undo</button>
        ) : (
          <button className={`btn small${rec ? ' primary' : ''}`} onClick={() => onApply(p.id)}>Apply</button>
        )}
      </div>
      <div className="actions">
        {p.actions.map((a, i) => {
          const s = shortAction(a, p.result);
          return (
            <div className="action" key={i}>
              <span className="ic">{s.icon}</span>
              <span>{s.text}</span>
            </div>
          );
        })}
      </div>
      <BeforeAfter before={base} after={p.result.metrics} />
    </div>
  );
}

export function Dispatcher({ planSet, stale, status, outcome, applied, onAsk, onApply }: Props) {
  const { plans, disrupted } = planSet;
  const base = disrupted.metrics;
  const rec = outcome?.planId ?? null;
  const top = plans.find((p) => p.id === rec) ?? null;
  const others = plans.filter((p) => p.id !== top?.id);
  const nothing = base.cost === 0;

  return (
    <section className="card ai-card" aria-labelledby="s3" aria-busy={status === 'loading'}>
      <h2 className="step-title" id="s3">
        <span className="step-num">3</span> Recover with AI
      </h2>

      {status !== 'done' && (
        <>
          <p className="ai-intro">
            {nothing
              ? 'Nothing to fix yet. Close an airport first.'
              : plans.length
                ? `The engine tested every recovery move. ${plans.length} plan${plans.length > 1 ? 's' : ''} beat doing nothing. The AI dispatcher picks one and explains why.`
                : 'The engine found no move that improves this situation.'}
          </p>
          {!nothing && plans.length > 0 && (
            <button className="btn ai" onClick={onAsk} disabled={status === 'loading' || stale}>
              {status === 'loading' ? 'Thinking…' : stale ? 'Updating plans…' : '✦ Ask the AI dispatcher'}
            </button>
          )}
          {status === 'loading' && (
            <div className="shimmers" aria-hidden="true">
              <div className="shimmer" style={{ width: '90%' }} />
              <div className="shimmer" style={{ width: '70%' }} />
              <div className="shimmer" style={{ width: '80%' }} />
            </div>
          )}
        </>
      )}

      {status === 'done' && outcome && (
        <>
          <div className="badges">
            {outcome.source === 'gemini' ? <span className="badge ai">✦ Gemini</span> : <span className="badge warn">Rule-based</span>}
            <span className={`badge ${outcome.verification.ok ? 'ok' : 'warn'}`} title="Every number in this answer was checked against the simulation engine.">
              {outcome.verification.ok ? '✓' : '!'} {outcome.verification.verified}/{outcome.verification.checked} numbers verified
            </span>
          </div>
          <p className="ai-head">{outcome.reply.headline}</p>
          {outcome.note && <p className="note">AI unavailable, showing the built-in rule-based dispatcher.</p>}
          <ul className="ai-list">
            {outcome.reply.explanation.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          {outcome.reply.risks.length > 0 && (
            <div className="risk">
              {outcome.reply.risks.map((t, i) => <span key={i}>⚠ {t}</span>)}
            </div>
          )}
          {top && <PlanCard p={top} base={base} rec applied={applied === top.id} onApply={onApply} />}
          {!top && outcome.reply.whyNotOthers && <p className="note">{outcome.reply.whyNotOthers}</p>}
        </>
      )}

      {others.length > 0 && (
        <details className="more" open={status === 'done' && !top}>
          <summary>{status === 'done' && top ? `Other plans (${others.length})` : `Browse ${others.length} engine plan${others.length > 1 ? 's' : ''}`}</summary>
          <div className="list">
            {others.map((p) => (
              <PlanCard key={p.id} p={p} base={base} rec={false} applied={applied === p.id} onApply={onApply} />
            ))}
          </div>
        </details>
      )}
      {status === 'done' && (
        <button className="btn link spaced" onClick={onAsk}>↻ Ask again</button>
      )}
    </section>
  );
}
