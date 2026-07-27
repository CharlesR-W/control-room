"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  branchRun,
  createDefaultDecision,
  createInitialRun,
  deserializeRun,
  getVisibleSnapshot,
  replayRun,
  serializeRun,
  stepRun,
  validateDecision,
} from "@/lib/sim";
import type {
  Contribution,
  DecisionPackage,
  ObservationReport,
  SimulationMode,
  SimulationRun,
  TurnRecord,
  ValidationResult,
  VisibleSnapshot,
} from "@/lib/sim";
import { AfterActionReview } from "./AfterActionReview";
import { DecisionBook } from "./DecisionBook";
import { Icon, type IconName } from "./Icons";
import { Briefing, Landing } from "./Landing";
import { MechanicsRulebook } from "./MechanicsRulebook";
import { formatDate, formatUsd, StatusLabel, statusFromObjective } from "./Panels";
import {
  ScreenRouter,
  type MetricInspection,
  type ViewId,
} from "./Screens";
import { Meter, Sparkline } from "./Visuals";

const AUTOSAVE_KEY = "control-room:narrows:autosave:v1";

type AppPhase = "landing" | "briefing" | "playing" | "aar";
type DrawerState =
  | { kind: "metric"; metric: MetricInspection }
  | { kind: "trace"; title: string; traces: Contribution[] }
  | { kind: "report"; report: ObservationReport }
  | null;

const NAV_ITEMS: Array<{
  id: ViewId;
  label: string;
  icon: IconName;
  unlockWith?: string;
}> = [
  { id: "situation", label: "Situation", icon: "situation" },
  { id: "supply", label: "Supply", icon: "supply" },
  {
    id: "transport",
    label: "Port & Transport",
    icon: "transport",
    unlockWith: "portSchedule",
  },
  {
    id: "finance",
    label: "Finance",
    icon: "finance",
    unlockWith: "copperPlan",
  },
  {
    id: "repair",
    label: "Repair",
    icon: "repair",
    unlockWith: "repairIntensity",
  },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "timeline", label: "Timeline", icon: "timeline" },
];

function phaseForTurn(turn: number) {
  if (turn < 2)
    return {
      number: 1,
      title: "Stocks & pipelines",
      description: "Learn to order before visible coverage reaches the shipping lead time.",
    };
  if (turn < 4)
    return {
      number: 2,
      title: "Shared port capacity",
      description: "Imports and copper now compete for one physical bottleneck.",
    };
  if (turn < 6)
    return {
      number: 3,
      title: "Regional distribution",
      description: "Rail priority and emergency trucking expose local shortfalls.",
    };
  if (turn < 9)
    return {
      number: 4,
      title: "Repair & uncertainty",
      description: "Choose what to learn and how fast to rebuild.",
    };
  return {
    number: 5,
    title: "Independent stabilization",
    description: "Protect the end state without tutorial scaffolding.",
  };
}

function objectiveValue(objective: VisibleSnapshot["objectives"][number]) {
  if (objective.id === "fx-floor") return formatUsd(objective.value, true);
  if (objective.id === "port-repair") return `${objective.value.toFixed(0)}%`;
  if (objective.id === "resilience") return `${objective.value.toFixed(1)} wk`;
  return objective.value.toFixed(objective.value < 10 ? 1 : 0);
}

function RunBrand() {
  return (
    <>
      <span className="brand__mark" aria-hidden="true">
        <span />
      </span>
      <strong>Control Room</strong>
    </>
  );
}

function Guardrails({ visible }: { visible: VisibleSnapshot }) {
  const ids = ["food-service", "diesel-service", "fx-floor", "port-repair"] as const;
  return (
    <div className="guardrails" aria-label="Top mandate guardrails">
      {ids.map((id) => {
        const objective = visible.objectives.find((item) => item.id === id);
        if (!objective) return null;
        const progress =
          id === "fx-floor"
            ? Math.max(
                0,
                Math.min(
                  100,
                  (objective.value / visible.headline.emergencyFloorCents) * 60,
                ),
              )
            : id === "port-repair"
              ? objective.value
              : objective.status === "secure"
                ? 82
                : objective.status === "at-risk"
                  ? 48
                  : 18;
        const status =
          objective.status === "secure"
            ? "stable"
            : objective.status === "at-risk"
              ? "watch"
              : "critical";
        return (
          <div className={`guardrail guardrail--${status}`} key={id}>
            <div className="guardrail__top">
              <span>{objective.label.replace("Avoid severe regional ", "").replace("Preserve essential ", "")}</span>
              <strong>{objectiveValue(objective)}</strong>
            </div>
            <div className="guardrail__track" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SideNavigation({
  visible,
  view,
  open,
  onSelect,
}: {
  visible: VisibleSnapshot;
  view: ViewId;
  open: boolean;
  onSelect: (view: ViewId) => void;
}) {
  const phase = phaseForTurn(visible.turn);
  return (
    <nav className="side-nav" data-open={open} aria-label="Control room sections">
      <div className="side-nav__section">
        <span className="side-nav__label">Operating desk</span>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => {
            const locked =
              Boolean(item.unlockWith) &&
              !visible.availableActions.includes(
                item.unlockWith as VisibleSnapshot["availableActions"][number],
              );
            const badge =
              item.id === "reports"
                ? visible.reports.filter((report) => report.publishedTurn === visible.turn)
                    .length
                : item.id === "situation"
                  ? visible.alerts.length
                  : 0;
            return (
              <li key={item.id}>
                <button
                  className="nav-button"
                  type="button"
                  aria-current={view === item.id ? "page" : undefined}
                  disabled={locked}
                  title={locked ? `${item.label} unlocks in a later guided phase` : item.label}
                  onClick={() => onSelect(item.id)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {locked ? (
                    <span className="nav-button__lock" aria-label="Locked">
                      ◇
                    </span>
                  ) : badge > 0 ? (
                    <span className="nav-button__badge">{badge}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <footer className="side-nav__footer">
        <div className="phase-card">
          <span className="micro-label">
            Guided phase {phase.number} of 5
          </span>
          <strong>{phase.title}</strong>
          <span>{phase.description}</span>
          <div className="phase-dots" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((number) => (
              <i
                key={number}
                data-complete={number < phase.number}
                data-current={number === phase.number}
              />
            ))}
          </div>
        </div>
      </footer>
    </nav>
  );
}

function TopBar({
  run,
  visible,
  mobileNavOpen,
  runMenuOpen,
  onToggleMobileNav,
  onToggleBook,
  onOpenMechanics,
  onToggleRunMenu,
  onExport,
  onImport,
  onReplay,
  onAar,
  onNewRun,
}: {
  run: SimulationRun;
  visible: VisibleSnapshot;
  mobileNavOpen: boolean;
  runMenuOpen: boolean;
  onToggleMobileNav: () => void;
  onToggleBook: () => void;
  onOpenMechanics: () => void;
  onToggleRunMenu: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReplay: () => void;
  onAar: () => void;
  onNewRun: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <RunBrand />
      </div>
      <button
        className="icon-button mobile-menu-button"
        type="button"
        aria-expanded={mobileNavOpen}
        aria-label="Toggle navigation"
        onClick={onToggleMobileNav}
      >
        <Icon name="menu" />
      </button>
      <div className="topbar__context">
        <div className="topbar__context-copy">
          <strong>The Narrows</strong>
          <span>Minister for National Supply · Republic of Selene</span>
        </div>
        <div className="topbar__date">
          <strong>{formatDate(visible.simulatedDate)}</strong>
          <span>Weekly decision cadence</span>
        </div>
      </div>
      <Guardrails visible={visible} />
      <div className="topbar__actions">
        <span className="turn-pill">
          Week {visible.turn}/{visible.turnsTotal}
        </span>
        <button
          className="button button--ghost button--small mechanics-open-button"
          type="button"
          onClick={onOpenMechanics}
        >
          <Icon name="info" />
          Mechanics
        </button>
        <button
          className="button button--primary button--small book-open-button"
          type="button"
          onClick={onToggleBook}
        >
          <Icon name="briefcase" />
          Decisions
        </button>
        <div className="menu-wrap">
          <button
            className="icon-button"
            type="button"
            aria-expanded={runMenuOpen}
            aria-label="Open run menu"
            onClick={onToggleRunMenu}
          >
            <Icon name="menu" />
          </button>
          {runMenuOpen ? (
            <div className="popover-menu" role="menu">
              <div className="popover-menu__header">
                <strong>Run {run.branch.id}</strong>
                <span>
                  Seed {run.seed} · engine {run.engineVersion}
                </span>
              </div>
              <button type="button" role="menuitem" onClick={onExport}>
                <Icon name="download" />
                Export run JSON
              </button>
              <label role="menuitem">
                <Icon name="upload" />
                Import verified run
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onImport(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <button type="button" role="menuitem" onClick={onReplay}>
                <Icon name="timeline" />
                Verify deterministic replay
              </button>
              <button type="button" role="menuitem" onClick={onOpenMechanics}>
                <Icon name="info" />
                Open mechanics rulebook
              </button>
              {visible.complete ? (
                <button type="button" role="menuitem" onClick={onAar}>
                  <Icon name="reports" />
                  Open after-action review
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={onNewRun}>
                <Icon name="branch" />
                Return to scenario card
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Drawer({
  state,
  onClose,
}: {
  state: NonNullable<DrawerState>;
  onClose: () => void;
}) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);

  if (state.kind === "metric") {
    const metric = state.metric;
    return (
      <>
        <button className="scrim" type="button" onClick={onClose} aria-label="Close metric drawer" />
        <aside className="drawer" aria-labelledby="metric-drawer-title">
          <header className="drawer__header">
            <div>
              <p className="eyebrow">Metric definition &amp; provenance</p>
              <h2 id="metric-drawer-title">{metric.label}</h2>
              <p>{metric.id}</p>
            </div>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close drawer">
              <Icon name="close" />
            </button>
          </header>
          <div className="drawer__body">
            <div className="metric-definition">
              <div className="metric-definition__hero">
                <strong>{metric.value}</strong>
                <span>{metric.unit}</span>
                <Sparkline values={metric.history} label={`${metric.label} history`} />
              </div>
              <p style={{ color: "var(--text-soft)", fontSize: ".74rem", lineHeight: 1.6, margin: 0 }}>
                {metric.definition}
              </p>
              <div className="provenance-grid">
                <div className="provenance-item">
                  <span>Source</span>
                  <strong>{metric.source}</strong>
                </div>
                <div className="provenance-item">
                  <span>As of</span>
                  <strong>{metric.asOf}</strong>
                </div>
                <div className="provenance-item">
                  <span>Status</span>
                  <strong>{metric.status}</strong>
                </div>
                <div className="provenance-item">
                  <span>Visibility</span>
                  <strong>Player report</strong>
                </div>
              </div>
              <section>
                <p className="eyebrow">Visible contributors</p>
                {metric.traces.length ? (
                  <TraceList traces={metric.traces} />
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: ".67rem" }}>
                    No causal contribution has been released for this metric in the
                    current turn.
                  </p>
                )}
              </section>
            </div>
          </div>
        </aside>
      </>
    );
  }

  if (state.kind === "report") {
    const report = state.report;
    return (
      <>
        <button className="scrim" type="button" onClick={onClose} aria-label="Close report drawer" />
        <aside className="drawer" aria-labelledby="report-drawer-title">
          <header className="drawer__header">
            <div>
              <p className="eyebrow">{report.source}</p>
              <h2 id="report-drawer-title">{report.title}</h2>
              <p>
                Published week {report.publishedTurn} · {report.status}
              </p>
            </div>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close drawer">
              <Icon name="close" />
            </button>
          </header>
          <div className="drawer__body">
            <div className="report-detail">
              <div>
                <StatusLabel
                  tone={
                    report.status === "revised"
                      ? "watch"
                      : report.confidence === "low"
                        ? "critical"
                        : "info"
                  }
                >
                  {report.status} · {report.confidence} confidence
                </StatusLabel>
              </div>
              <div className="provenance-grid">
                <div className="provenance-item">
                  <span>Event date</span>
                  <strong>Week {report.eventTurn}</strong>
                </div>
                <div className="provenance-item">
                  <span>As of</span>
                  <strong>Week {report.asOfTurn}</strong>
                </div>
                <div className="provenance-item">
                  <span>Publication</span>
                  <strong>Week {report.publishedTurn}</strong>
                </div>
                <div className="provenance-item">
                  <span>Revision of</span>
                  <strong>{report.revisesReportId ?? "Original release"}</strong>
                </div>
              </div>
              <section>
                <p className="eyebrow">Reported values</p>
                <div className="report-detail__values">
                  {Object.entries(report.values).map(([key, value]) => (
                    <div className="report-value" key={key}>
                      <span>{key.replaceAll(/([A-Z])/g, " $1").replaceAll("-", " ")}</span>
                      <strong>{value === null ? "Not available" : String(value)}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <p className="eyebrow">Methodology &amp; scope</p>
                <p style={{ color: "var(--text-soft)", fontSize: ".72rem", lineHeight: 1.6 }}>
                  {report.methodology}
                </p>
              </section>
            </div>
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      <button className="scrim" type="button" onClick={onClose} aria-label="Close causal trace drawer" />
      <aside className="drawer" aria-labelledby="trace-drawer-title">
        <header className="drawer__header">
          <div>
            <p className="eyebrow">Structured causal trace</p>
            <h2 id="trace-drawer-title">{state.title}</h2>
            <p>Only contributions visible at the current desk are shown</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close drawer">
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer__body">
          {state.traces.length ? (
            <TraceList traces={state.traces} />
          ) : (
            <p style={{ color: "var(--muted)", fontSize: ".7rem" }}>
              No visible contributions were emitted for this object in the selected
              turn. Full hidden-state mechanisms are revealed only after the run.
            </p>
          )}
        </div>
      </aside>
    </>
  );
}

function TraceList({ traces }: { traces: Contribution[] }) {
  return (
    <div className="trace-list">
      {traces.map((trace) => (
        <article
          className={`trace-item ${trace.amount < 0 ? "trace-item--negative" : ""}`}
          key={trace.id}
        >
          <span className="trace-item__marker" />
          <span className="trace-item__copy">
            <strong>{trace.mechanism.replaceAll("-", " ")}</strong>
            <span>
              {trace.note}
              {trace.bindingConstraint !== "none"
                ? ` Binding constraint: ${trace.bindingConstraint}.`
                : ""}
            </span>
          </span>
          <strong className="trace-item__value">
            {trace.amount > 0 ? "+" : ""}
            {trace.unit === "usd-cents"
              ? formatUsd(trace.amount, true)
              : `${trace.amount.toFixed(2)} ${trace.unit}`}
          </strong>
        </article>
      ))}
    </div>
  );
}

function CommitReview({
  decision,
  validation,
  onCancel,
  onCommit,
}: {
  decision: DecisionPackage;
  validation: ValidationResult;
  onCancel: () => void;
  onCommit: () => void;
}) {
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="commit-title">
      <div className="modal">
        <header className="modal__header">
          <div>
            <p className="eyebrow">Decision package / Week {decision.forTurn}</p>
            <h2 id="commit-title">Review direct commitments</h2>
            <p>Consequences are not previewed. History is immutable after commitment.</p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Cancel review">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">
          <div className="commit-review">
            <div className="commit-review__resources">
              <div className="commit-resource">
                <span>Import contracts</span>
                <strong>{formatUsd(validation.preview.importCostCents, true)}</strong>
              </div>
              <div className="commit-resource">
                <span>Repair commitment</span>
                <strong>{formatUsd(validation.preview.repairCostCents, true)}</strong>
              </div>
              <div className="commit-resource">
                <span>Implementation claim</span>
                <strong>
                  {validation.preview.adminTeamsClaimed} new team
                  {validation.preview.adminTeamsClaimed === 1 ? "" : "s"}
                </strong>
              </div>
            </div>

            <div className="grid grid--2">
              <div className="panel panel--inset">
                <div className="panel__body">
                  <p className="micro-label">Forecast recorded</p>
                  <p style={{ color: "var(--text-soft)", fontSize: ".72rem", lineHeight: 1.55 }}>
                    Grain {decision.forecasts.grainCoverageWeeks?.toFixed(1)} weeks · FX $
                    {decision.forecasts.fxUsdM?.toFixed(1)}m · binding{" "}
                    {decision.forecasts.bindingConstraint}
                  </p>
                </div>
              </div>
              <div className="panel panel--inset">
                <div className="panel__body">
                  <p className="micro-label">Minister&apos;s rationale</p>
                  <p style={{ color: "var(--text-soft)", fontSize: ".72rem", lineHeight: 1.55 }}>
                    {decision.notes}
                  </p>
                </div>
              </div>
            </div>

            {validation.warnings.map((warning) => (
              <div className="commit-review__warning" key={`${warning.path}-${warning.code}`}>
                <Icon name="alert" />
                <span>{warning.message}</span>
              </div>
            ))}

            <div>
              <div className="capacity-summary__copy">
                <span>FX after direct commitments</span>
                <strong>
                  {formatUsd(validation.preview.projectedFxAfterDirectCommitmentsCents, true)}
                </strong>
              </div>
              <Meter
                value={Math.max(0, validation.preview.projectedFxAfterDirectCommitmentsCents)}
                max={Math.max(1, validation.preview.availableFxCents)}
                label="Foreign exchange remaining after direct commitments"
                tone={
                  validation.preview.projectedFxAfterDirectCommitmentsCents <
                  10_000_000_00
                    ? "amber"
                    : "teal"
                }
              />
            </div>

            <div className="commit-review__warning">
              <Icon name="info" />
              <span>
                Commit reserves resources and advances the simulation one week. To test
                a different package later, create a branch from this pre-commit state.
              </span>
            </div>
          </div>
        </div>
        <footer className="modal__footer">
          <button className="button button--ghost" type="button" onClick={onCancel}>
            Return to draft
          </button>
          <button className="button button--primary" type="button" onClick={onCommit}>
            Commit package &amp; advance
            <Icon name="arrow" />
          </button>
        </footer>
      </div>
    </div>
  );
}

function OutcomeDigest({
  record,
  visible,
  onTrace,
  onContinue,
}: {
  record: TurnRecord;
  visible: VisibleSnapshot;
  onTrace: (title: string, traces: Contribution[]) => void;
  onContinue: () => void;
}) {
  const releasedTrace = visible.latestTrace;
  const highlights = [
    ...record.events.map((event) => ({
      id: event.id,
      title: event.title,
      body: event.description,
      tone:
        event.severity === "critical"
          ? ("critical" as const)
          : event.severity === "warning"
            ? ("watch" as const)
            : ("info" as const),
      traces: releasedTrace.filter((trace) => trace.eventIds.includes(event.id)),
    })),
    ...record.actionStatusChanges.slice(0, Math.max(0, 4 - record.events.length)).map((action) => ({
      id: `${action.id}-${action.lifecycle}`,
      title: action.label,
      body: `${action.lifecycle.replaceAll("-", " ")} — ${action.reason}`,
      tone:
        action.lifecycle === "failed"
          ? ("critical" as const)
          : action.lifecycle === "active" || action.lifecycle === "completed"
            ? ("stable" as const)
            : ("info" as const),
      traces: releasedTrace.filter((trace) => trace.actionIds.includes(action.id)),
    })),
  ].slice(0, 6);

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="digest-title">
      <div className="modal outcome-digest">
        <div className="outcome-digest__hero">
          <div className="outcome-digest__week">
            <span>Week</span>
            <strong>{record.turn}</strong>
          </div>
          <div className="outcome-digest__copy">
            <p className="eyebrow">{formatDate(record.simulatedDate)} / Turn complete</p>
            <h2 id="digest-title">
              {record.events.some((event) => event.severity === "critical")
                ? "The system absorbed a critical shock."
                : "The week’s commitments have settled."}
            </h2>
            <p>
              New arrivals, reports, lifecycle changes, allocations, and ledger
              settlements are now part of immutable history.
            </p>
          </div>
        </div>
        <div className="modal__body">
          <div className="digest-grid">
            {highlights.length ? (
              highlights.map((highlight) => (
                <article className="digest-card" key={highlight.id}>
                  <div className="digest-card__top">
                    <strong>{highlight.title}</strong>
                    <StatusLabel tone={highlight.tone}>
                      {highlight.tone === "stable" ? "Resolved" : highlight.tone}
                    </StatusLabel>
                  </div>
                  <p>{highlight.body}</p>
                  {highlight.traces.length ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => onTrace(highlight.title, highlight.traces)}
                    >
                      Why did this change?
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <article className="digest-card">
                <div className="digest-card__top">
                  <strong>Routine operations</strong>
                  <StatusLabel tone="info">Settled</StatusLabel>
                </div>
                <p>No new exceptional event or action status change was recorded.</p>
              </article>
            )}
          </div>
          <div className="commit-review__resources" style={{ marginTop: 16 }}>
            <div className="commit-resource">
              <span>Reported grain</span>
              <strong>{visible.headline.reportedGrainCoverageWeeks.toFixed(1)} weeks</strong>
            </div>
            <div className="commit-resource">
              <span>Diesel</span>
              <strong>{visible.headline.dieselCoverageWeeks.toFixed(1)} weeks</strong>
            </div>
            <div className="commit-resource">
              <span>Foreign exchange</span>
              <strong>{formatUsd(visible.headline.fxCents, true)}</strong>
            </div>
          </div>
        </div>
        <footer className="modal__footer">
          <button className="button button--primary" type="button" onClick={onContinue}>
            {visible.complete ? "Open after-action review" : "Return to control room"}
            <Icon name="arrow" />
          </button>
        </footer>
      </div>
    </div>
  );
}

function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(id);
  }, [onClose]);
  return (
    <div className="toast" role="status">
      <Icon name="check" />
      <span>{message}</span>
      <button className="icon-button" type="button" onClick={onClose} aria-label="Dismiss notification">
        <Icon name="close" />
      </button>
    </div>
  );
}

function SimulationDesk({
  run,
  draft,
  validation,
  view,
  drawer,
  outcome,
  reviewOpen,
  mechanicsOpen,
  bookOpen,
  bookSection,
  navOpen,
  runMenuOpen,
  toast,
  onDraft,
  onView,
  onInspect,
  onOpenReport,
  onOpenTrace,
  onOpenBook,
  onCloseBook,
  onToggleNav,
  onToggleRunMenu,
  onOpenMechanics,
  onCloseMechanics,
  onReview,
  onCancelReview,
  onCommit,
  onCloseDrawer,
  onContinueOutcome,
  onBranch,
  onExport,
  onImport,
  onReplay,
  onAar,
  onNewRun,
  onCloseToast,
}: {
  run: SimulationRun;
  draft: DecisionPackage;
  validation: ValidationResult;
  view: ViewId;
  drawer: DrawerState;
  outcome: TurnRecord | null;
  reviewOpen: boolean;
  mechanicsOpen: boolean;
  bookOpen: boolean;
  bookSection: string | null;
  navOpen: boolean;
  runMenuOpen: boolean;
  toast: string | null;
  onDraft: (draft: DecisionPackage) => void;
  onView: (view: ViewId) => void;
  onInspect: (metric: MetricInspection) => void;
  onOpenReport: (report: ObservationReport) => void;
  onOpenTrace: (title: string, traces: Contribution[]) => void;
  onOpenBook: (section?: string) => void;
  onCloseBook: () => void;
  onToggleNav: () => void;
  onToggleRunMenu: () => void;
  onOpenMechanics: () => void;
  onCloseMechanics: () => void;
  onReview: () => void;
  onCancelReview: () => void;
  onCommit: () => void;
  onCloseDrawer: () => void;
  onContinueOutcome: () => void;
  onBranch: (turn: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReplay: () => void;
  onAar: () => void;
  onNewRun: () => void;
  onCloseToast: () => void;
}) {
  const visible = getVisibleSnapshot(run);

  return (
    <div className="control-room">
      <a className="skip-link" href="#main-workspace">
        Skip to main workspace
      </a>
      <TopBar
        run={run}
        visible={visible}
        mobileNavOpen={navOpen}
        runMenuOpen={runMenuOpen}
        onToggleMobileNav={onToggleNav}
        onToggleBook={() => onOpenBook()}
        onOpenMechanics={onOpenMechanics}
        onToggleRunMenu={onToggleRunMenu}
        onExport={onExport}
        onImport={onImport}
        onReplay={onReplay}
        onAar={onAar}
        onNewRun={onNewRun}
      />
      <div className="shell">
        <SideNavigation
          visible={visible}
          view={view}
          open={navOpen}
          onSelect={onView}
        />
        <main className="workspace" id="main-workspace" tabIndex={-1}>
          <ScreenRouter
            view={view}
            run={run}
            visible={visible}
            decision={draft}
            onInspect={onInspect}
            onOpenReport={onOpenReport}
            onOpenTrace={onOpenTrace}
            onNavigate={onView}
            onBranch={onBranch}
            onOpenBook={onOpenBook}
          />
        </main>
        <DecisionBook
          visible={visible}
          decision={draft}
          validation={validation}
          open={bookOpen}
          requestedSection={bookSection}
          onChange={onDraft}
          onReview={onReview}
          onOpenMechanics={onOpenMechanics}
          onClose={onCloseBook}
        />
      </div>
      {drawer ? <Drawer state={drawer} onClose={onCloseDrawer} /> : null}
      {reviewOpen ? (
        <CommitReview
          decision={draft}
          validation={validation}
          onCancel={onCancelReview}
          onCommit={onCommit}
        />
      ) : null}
      {mechanicsOpen ? (
        <MechanicsRulebook
          visible={visible}
          decision={draft}
          onClose={onCloseMechanics}
        />
      ) : null}
      {outcome ? (
        <OutcomeDigest
          record={outcome}
          visible={visible}
          onTrace={onOpenTrace}
          onContinue={onContinueOutcome}
        />
      ) : null}
      {toast ? <Toast message={toast} onClose={onCloseToast} /> : null}
    </div>
  );
}

export function ControlRoomGame({ onExit }: { onExit?: () => void }) {
  const [phase, setPhase] = useState<AppPhase>("landing");
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [savedRun, setSavedRun] = useState<SimulationRun | null>(null);
  const [draft, setDraft] = useState<DecisionPackage | null>(null);
  const [view, setView] = useState<ViewId>("situation");
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [outcome, setOutcome] = useState<TurnRecord | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mechanicsOpen, setMechanicsOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookSection, setBookSection] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const lastSavedJson = useRef<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    try {
      const verified = deserializeRun(raw);
      setSavedRun(verified);
      lastSavedJson.current = raw;
    } catch {
      window.localStorage.removeItem(AUTOSAVE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!run) return;
    const json = serializeRun(run);
    if (json === lastSavedJson.current) return;
    window.localStorage.setItem(AUTOSAVE_KEY, json);
    lastSavedJson.current = json;
    setSavedRun(run);
  }, [run]);

  const validation = useMemo(() => {
    if (!run || !draft) return null;
    return validateDecision(run.state, draft);
  }, [run, draft]);

  const beginRun = (mode: SimulationMode, seed: number) => {
    const next = createInitialRun(seed, mode);
    setRun(next);
    setDraft(createDefaultDecision(next.state));
    setPhase("briefing");
    setView("situation");
    setOutcome(null);
  };

  const resume = () => {
    if (!savedRun) return;
    const verified = replayRun(savedRun);
    setRun(verified);
    setDraft(verified.state.complete ? null : createDefaultDecision(verified.state));
    setPhase(verified.state.complete ? "aar" : "playing");
    setView("situation");
    setToast("Autosave verified by deterministic replay.");
  };

  const importRun = async (file: File) => {
    try {
      const text = await file.text();
      const imported = deserializeRun(text);
      setRun(imported);
      setDraft(imported.state.complete ? null : createDefaultDecision(imported.state));
      setPhase(imported.state.complete ? "aar" : "playing");
      setView("situation");
      setRunMenuOpen(false);
      setToast("Imported run verified against version and replay hashes.");
    } catch (error) {
      setToast(
        error instanceof Error
          ? `Import rejected: ${error.message}`
          : "Import rejected: invalid run file.",
      );
    }
  };

  const exportRun = () => {
    if (!run) return;
    const blob = new Blob([serializeRun(run)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `control-room-narrows-seed-${run.seed}-turn-${run.state.turn}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setRunMenuOpen(false);
    setToast("Run exported as a replay-verifiable JSON record.");
  };

  const commit = () => {
    if (!run || !draft || !validation?.valid) return;
    try {
      const next = stepRun(run, draft);
      const record = next.history.at(-1) ?? null;
      setRun(next);
      // Keep a non-committable draft long enough to render the final turn digest.
      // The digest then transitions to the AAR; completed imported/resumed runs
      // still bypass the desk and open the AAR directly.
      setDraft(createDefaultDecision(next.state));
      setReviewOpen(false);
      setBookOpen(false);
      setOutcome(record);
      setView("situation");
    } catch (error) {
      setReviewOpen(false);
      setToast(
        error instanceof Error
          ? `Package was not committed: ${error.message}`
          : "Package was not committed.",
      );
    }
  };

  const createBranch = (turn: number) => {
    if (!run) return;
    try {
      const branch = branchRun(run, turn);
      setRun(branch);
      setDraft(createDefaultDecision(branch.state));
      setPhase("playing");
      setOutcome(null);
      setDrawer(null);
      setView("situation");
      setToast(
        `New branch created from ${turn === 0 ? "the opening state" : `week ${turn}`}.`,
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not create branch.");
    }
  };

  const verifyReplay = () => {
    if (!run) return;
    try {
      const verified = replayRun(run);
      setRun(verified);
      setDraft(verified.state.complete ? null : createDefaultDecision(verified.state));
      setRunMenuOpen(false);
      setToast(`Replay verified through week ${verified.state.turn}; all state hashes match.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Replay verification failed.");
    }
  };

  const openBook = (section?: string) => {
    setBookSection(section ?? null);
    setBookOpen(true);
  };

  if (phase === "landing") {
    return (
      <Landing
        savedRun={
          savedRun
            ? {
                turn: savedRun.state.turn,
                simulatedDate: savedRun.state.simulatedDate,
                mode: savedRun.mode,
                seed: savedRun.seed,
              }
            : null
        }
        onBegin={beginRun}
        onResume={resume}
        onImport={importRun}
        onLibrary={onExit}
      />
    );
  }

  if (!run) return null;

  if (phase === "briefing") {
    return (
      <>
        <Landing
          savedRun={null}
          onBegin={beginRun}
          onResume={() => undefined}
          onImport={importRun}
          onLibrary={onExit}
        />
        <Briefing
          mode={run.mode}
          seed={run.seed}
          onEnter={() => setPhase("playing")}
          onBack={() => setPhase("landing")}
        />
      </>
    );
  }

  if (phase === "aar") {
    return (
      <AfterActionReview
        run={run}
        onBranch={createBranch}
        onExport={exportRun}
        onRestart={() => setPhase("landing")}
        onReturn={() => setPhase("playing")}
      />
    );
  }

  if (!draft || !validation) {
    return (
      <AfterActionReview
        run={run}
        onBranch={createBranch}
        onExport={exportRun}
        onRestart={() => setPhase("landing")}
        onReturn={() => setPhase("aar")}
      />
    );
  }

  return (
    <SimulationDesk
      run={run}
      draft={draft}
      validation={validation}
      view={view}
      drawer={drawer}
      outcome={outcome}
      reviewOpen={reviewOpen}
      mechanicsOpen={mechanicsOpen}
      bookOpen={bookOpen}
      bookSection={bookSection}
      navOpen={navOpen}
      runMenuOpen={runMenuOpen}
      toast={toast}
      onDraft={setDraft}
      onView={(nextView) => {
        setView(nextView);
        setNavOpen(false);
      }}
      onInspect={(metric) => setDrawer({ kind: "metric", metric })}
      onOpenReport={(report) => setDrawer({ kind: "report", report })}
      onOpenTrace={(title, traces) => setDrawer({ kind: "trace", title, traces })}
      onOpenBook={openBook}
      onCloseBook={() => setBookOpen(false)}
      onToggleNav={() => setNavOpen((current) => !current)}
      onToggleRunMenu={() => setRunMenuOpen((current) => !current)}
      onOpenMechanics={() => {
        setRunMenuOpen(false);
        setMechanicsOpen(true);
      }}
      onCloseMechanics={() => setMechanicsOpen(false)}
      onReview={() => setReviewOpen(true)}
      onCancelReview={() => setReviewOpen(false)}
      onCommit={commit}
      onCloseDrawer={() => setDrawer(null)}
      onContinueOutcome={() => {
        setOutcome(null);
        if (run.state.complete) setPhase("aar");
      }}
      onBranch={createBranch}
      onExport={exportRun}
      onImport={importRun}
      onReplay={verifyReplay}
      onAar={() => setPhase("aar")}
      onNewRun={() => {
        setRunMenuOpen(false);
        setPhase("landing");
      }}
      onCloseToast={() => setToast(null)}
    />
  );
}
