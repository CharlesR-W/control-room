"use client";

import { useEffect, useMemo, useState } from "react";
import type { SimulationMode } from "@/lib/sim/types";
import {
  createScenarioRun,
  replayScenarioRun,
  stepScenarioRun,
} from "@/lib/scenarios/helpers";
import type {
  AnyScenarioModel,
  ScenarioDecision,
  ScenarioRun,
} from "@/lib/scenarios/types";
import { ScenarioEmblem, themeLabelForScenario } from "./ScenarioTheme";

type Phase = "briefing" | "playing" | "aar";

function formatValue(value: number, unit: string) {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 2 ? 1 : 0,
  });
  return unit === "%" ? `${formatted}%` : `${formatted} ${unit}`;
}

function downloadRun(run: ScenarioRun) {
  const blob = new Blob([JSON.stringify(run, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${run.scenarioId}-${run.seed}-turn-${run.state.turn}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GenericScenarioGame({
  model,
  onExit,
}: {
  model: AnyScenarioModel;
  onExit: () => void;
}) {
  const [mode, setMode] = useState<SimulationMode>("guided");
  const [seed, setSeed] = useState(1943);
  const [phase, setPhase] = useState<Phase>("briefing");
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [decision, setDecision] = useState<ScenarioDecision | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [showTrace, setShowTrace] = useState(false);
  const storageKey = `control-room:${model.metadata.id}:autosave:v1`;
  const themeLabel = themeLabelForScenario(model.metadata.id);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as ScenarioRun;
      if (
        parsed.scenarioId === model.metadata.id &&
        parsed.scenarioVersion === model.metadata.version
      ) {
        const verified = replayScenarioRun(model, parsed);
        setRun(verified);
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [model, storageKey]);

  useEffect(() => {
    if (run) localStorage.setItem(storageKey, JSON.stringify(run));
  }, [run, storageKey]);

  const view = run ? model.getView(run.state) : null;
  const activeActions = run
    ? model.actions.filter((action) => (action.unlockTurn ?? 0) <= run.state.turn)
    : [];

  const validationErrors = useMemo(() => {
    if (!run || !decision) return [];
    const common = activeActions.flatMap((action) => {
      const value = decision.values[action.id];
      if (!Number.isFinite(value)) return [`${action.label} needs a numeric value.`];
      if (value < action.min || value > action.max) {
        return [`${action.label} must be ${action.min}–${action.max} ${action.unit}.`];
      }
      return [];
    });
    return [...common, ...model.validateDecision(run.state, decision)];
  }, [activeActions, decision, model, run]);

  function begin() {
    const next = createScenarioRun(model, seed, mode);
    setRun(next);
    setDecision(model.defaultDecision(next.state));
    setErrors([]);
    setPhase("playing");
  }

  function resume() {
    if (!run) return;
    setDecision(model.defaultDecision(run.state));
    setErrors([]);
    setPhase(run.state.complete ? "aar" : "playing");
  }

  function commit() {
    if (!run || !decision) return;
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    try {
      const next = stepScenarioRun(model, run, decision);
      setRun(next);
      setErrors([]);
      setShowTrace(false);
      if (next.state.complete) {
        setPhase("aar");
      } else {
        setDecision(model.defaultDecision(next.state));
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "The decision could not be committed."]);
    }
  }

  if (phase === "briefing") {
    return (
      <main
        className="scenario-briefing"
        data-scenario={model.metadata.id}
        style={{ "--scenario-accent": model.metadata.accent } as React.CSSProperties}
      >
        <div className="scenario-theme-atmosphere" aria-hidden="true" />
        <button className="button button--ghost scenario-back" type="button" onClick={onExit}>
          ← Scenario library
        </button>
        <section className="scenario-briefing__body">
          <div>
            <ScenarioEmblem scenarioId={model.metadata.id} />
            <p className="eyebrow">{model.metadata.period} · {model.metadata.fidelity}</p>
            <h1>{model.metadata.title}</h1>
            <p className="scenario-briefing__deck">{model.metadata.deck}</p>
            {model.metadata.briefing.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            <div className="scenario-model-note">
              <strong>Claims boundary</strong>
              <span>{model.metadata.modelNote}</span>
            </div>
          </div>
          <aside className="scenario-briefing__desk">
            <p className="eyebrow">Your desk</p>
            <h2>{model.metadata.role}</h2>
            <dl>
              <div><dt>Horizon</dt><dd>{model.metadata.totalTurns} {model.metadata.turnLabel.toLowerCase()}s</dd></div>
              <div><dt>Session</dt><dd>{model.metadata.sessionLength}</dd></div>
            </dl>
            <h3>You will learn to</h3>
            <ul>
              {model.metadata.learningObjectives.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <label className="field-label">
              Assistance
              <select className="select" value={mode} onChange={(event) => setMode(event.target.value as SimulationMode)}>
                <option value="guided">Guided</option>
                <option value="professional">Professional</option>
              </select>
            </label>
            <label className="field-label">
              Scenario seed
              <input className="field" type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
            </label>
            <button className="button button--primary" type="button" onClick={begin}>Begin scenario →</button>
            {run ? <button className="button" type="button" onClick={resume}>Resume turn {run.state.turn}</button> : null}
          </aside>
        </section>
      </main>
    );
  }

  if (!run || !view || !decision) return null;

  const latest = run.history.at(-1);
  const secureCount = view.objectives.filter((objective) => objective.status === "secure").length;

  if (phase === "aar") {
    return (
      <main
        className="scenario-aar"
        data-scenario={model.metadata.id}
        style={{ "--scenario-accent": model.metadata.accent } as React.CSSProperties}
      >
        <div className="scenario-theme-atmosphere" aria-hidden="true" />
        <header>
          <ScenarioEmblem scenarioId={model.metadata.id} />
          <p className="eyebrow">After-action review</p>
          <h1>{model.metadata.title}</h1>
          <p>{secureCount} of {view.objectives.length} mandate priorities secure at the end of the run.</p>
        </header>
        <section className="scenario-aar__grid">
          <div className="scenario-panel">
            <h2>Final mandate</h2>
            <ol className="scenario-objectives">
              {view.objectives.map((objective) => (
                <li key={objective.id} data-status={objective.status}>
                  <span>{objective.label}</span>
                  <strong>{formatValue(objective.value, objective.unit)}</strong>
                </li>
              ))}
            </ol>
          </div>
          <div className="scenario-panel">
            <h2>Decision record</h2>
            <div className="scenario-timeline">
              {run.history.map((record) => (
                <article key={record.turn}>
                  <span>{model.metadata.turnLabel} {record.turn}</span>
                  <strong>{record.headline}</strong>
                  {record.events.map((event) => <p key={event}>{event}</p>)}
                </article>
              ))}
            </div>
          </div>
        </section>
        <div className="scenario-aar__actions">
          <button className="button button--primary" type="button" onClick={() => { localStorage.removeItem(storageKey); setRun(null); setPhase("briefing"); }}>Run another variant</button>
          <button className="button" type="button" onClick={() => downloadRun(run)}>Export run JSON</button>
          <button className="button button--ghost" type="button" onClick={onExit}>Scenario library</button>
        </div>
      </main>
    );
  }

  return (
    <main
      className="scenario-game"
      data-scenario={model.metadata.id}
      style={{ "--scenario-accent": model.metadata.accent } as React.CSSProperties}
    >
      <div className="scenario-theme-atmosphere" aria-hidden="true" />
      <header className="scenario-game__topbar">
        <button className="scenario-wordmark" type="button" onClick={onExit}>
          <ScenarioEmblem scenarioId={model.metadata.id} compact />
          Control Room
        </button>
        <div>
          <strong>{model.metadata.shortTitle}</strong>
          <span>{themeLabel.label} · {model.metadata.role}</span>
        </div>
        <div>
          <strong>{view.dateLabel}</strong>
          <span>{model.metadata.turnLabel} {run.state.turn + 1} / {model.metadata.totalTurns}</span>
        </div>
        <button className="button button--small" type="button" onClick={() => downloadRun(run)}>Export</button>
      </header>

      <section className="scenario-game__phase">
        <div>
          <p className="eyebrow">{view.phase}</p>
          <h1>{view.summary}</h1>
          <p>{view.phaseDescription}</p>
        </div>
        <div className="scenario-progress" aria-label="Scenario progress">
          <span style={{ width: `${(run.state.turn / model.metadata.totalTurns) * 100}%` }} />
        </div>
      </section>

      {view.alerts.length > 0 ? (
        <section className="scenario-alerts" aria-label="Current alerts">
          {view.alerts.map((alert) => <p key={alert.id} data-severity={alert.severity}>{alert.message}</p>)}
        </section>
      ) : null}

      <div className="scenario-game__grid">
        <section className="scenario-game__main">
          <div className="scenario-metrics">
            {view.metrics.map((metric) => (
              <article key={metric.id} data-status={metric.status}>
                <span>{metric.label}</span>
                <strong>{formatValue(metric.value, metric.unit)}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </div>

          <div className="scenario-panel">
            <div className="scenario-panel__heading">
              <div><p className="eyebrow">Decision package</p><h2>Commit this {model.metadata.turnLabel.toLowerCase()}</h2></div>
              <span>{activeActions.length} active levers</span>
            </div>
            <div className="scenario-actions">
              {activeActions.map((action) => {
                const value = decision.values[action.id] ?? action.defaultValue;
                return (
                  <label key={action.id} className="scenario-action">
                    <span><strong>{action.label}</strong><small>{action.description}</small></span>
                    <span className="scenario-action__control">
                      <input type="range" min={action.min} max={action.max} step={action.step} value={value} onChange={(event) => setDecision({ values: { ...decision.values, [action.id]: Number(event.target.value) } })} />
                      <input className="field" type="number" min={action.min} max={action.max} step={action.step} value={value} onChange={(event) => setDecision({ values: { ...decision.values, [action.id]: Number(event.target.value) } })} />
                      <em>{action.unit}</em>
                    </span>
                    <small className="scenario-action__commitment">{action.commitment}</small>
                  </label>
                );
              })}
            </div>
            {errors.length > 0 ? <div className="scenario-errors">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
            <div className="scenario-commit">
              <span>Decisions are committed as a package and cannot be changed after stepping.</span>
              <button className="button button--primary" type="button" disabled={validationErrors.length > 0} onClick={commit}>Commit package →</button>
            </div>
          </div>

          {latest ? (
            <div className="scenario-panel">
              <button className="scenario-trace-toggle" type="button" onClick={() => setShowTrace(!showTrace)}>
                <span><p className="eyebrow">Last turn</p><strong>{latest.headline}</strong></span>
                <span>{showTrace ? "Hide" : "Inspect"} causal trace</span>
              </button>
              {latest.events.map((event) => <p className="scenario-event" key={event}>{event}</p>)}
              {showTrace ? (
                <div className="scenario-trace">
                  {latest.contributions.map((item, index) => (
                    <article key={`${item.target}-${item.source}-${index}`}>
                      <span>{item.source} → {item.target}</span>
                      <strong>{item.delta > 0 ? "+" : ""}{formatValue(item.delta, item.unit)}</strong>
                      <p>{item.explanation}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside className="scenario-game__aside">
          <div className="scenario-panel">
            <p className="eyebrow">Mandate / priority order</p>
            <ol className="scenario-objectives">
              {view.objectives.map((objective) => (
                <li key={objective.id} data-status={objective.status}>
                  <span>{objective.label}{objective.hard ? <small>Hard constraint</small> : null}</span>
                  <strong>{formatValue(objective.value, objective.unit)}</strong>
                </li>
              ))}
            </ol>
          </div>
          <div className="scenario-panel">
            <p className="eyebrow">Run record</p>
            <div className="scenario-mini-timeline">
              {run.history.slice().reverse().map((record) => (
                <article key={record.turn}><span>{record.turn}</span><p>{record.headline}</p></article>
              ))}
              {run.history.length === 0 ? <p>No committed decisions yet.</p> : null}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
