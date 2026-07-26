"use client";

import { useMemo } from "react";
import { getVisibleSnapshot, runBaseline } from "@/lib/sim";
import type { BaselinePolicy, SimulationRun } from "@/lib/sim";
import { Icon } from "./Icons";
import { formatUsd, Panel, StatusLabel } from "./Panels";
import { DebriefConstraintExhibit } from "./Screens";
import { Waterfall } from "./Visuals";

function totalTrueGrain(run: SimulationRun) {
  const state = run.state;
  return (
    state.grainCentralKt +
    state.regions.capital.grainKt +
    state.regions.north.grainKt +
    state.regions.interior.grainKt
  );
}

function grainContribution(run: SimulationRun, positive: boolean) {
  return run.history
    .flatMap((record) => record.trace)
    .filter(
      (trace) =>
        trace.unit === "kt" &&
        trace.target.toLowerCase().includes("grain") &&
        (positive ? trace.amount > 0 : trace.amount < 0),
    )
    .reduce((sum, trace) => sum + trace.amount, 0);
}

function dieselContribution(run: SimulationRun, positive: boolean) {
  return run.history
    .flatMap((record) => record.trace)
    .filter(
      (trace) =>
        trace.unit === "kt" &&
        trace.target.toLowerCase().includes("diesel") &&
        (positive ? trace.amount > 0 : trace.amount < 0),
    )
    .reduce((sum, trace) => sum + trace.amount, 0);
}

function baselineSummary(label: string, run: SimulationRun, policy: BaselinePolicy | "player") {
  return {
    label,
    policy,
    foodDays: run.state.metrics.foodShortfallDays,
    minFx: run.state.metrics.minimumFxCents,
    repair: run.state.repairProgressPct,
    resilience: run.state.objectives.find((objective) => objective.id === "resilience")
      ?.value ?? 0,
    hardship: run.state.metrics.hardshipPoints,
  };
}

export function AfterActionReview({
  run,
  onBranch,
  onExport,
  onRestart,
  onReturn,
}: {
  run: SimulationRun;
  onBranch: (turn: number) => void;
  onExport: () => void;
  onRestart: () => void;
  onReturn: () => void;
}) {
  const visible = getVisibleSnapshot(run);
  const reactive = useMemo(
    () => runBaseline("reactive", run.seed, run.mode),
    [run.mode, run.seed],
  );
  const competent = useMemo(
    () => runBaseline("competent", run.seed, run.mode),
    [run.mode, run.seed],
  );
  const comparisons = [
    baselineSummary("Your run", run, "player"),
    baselineSummary("Reactive baseline", reactive, "reactive"),
    baselineSummary("Buffer-first baseline", competent, "competent"),
  ];

  const openingGrain = totalTrueGrain({
    ...run,
    state: run.initialState,
  });
  const closingGrain = totalTrueGrain(run);
  const grainIn = grainContribution(run, true);
  const grainOut = grainContribution(run, false);
  const dieselIn = dieselContribution(run, true);
  const dieselOut = dieselContribution(run, false);
  const finalResilience =
    run.state.objectives.find((objective) => objective.id === "resilience")?.value ?? 0;
  const breached = run.state.objectives.filter(
    (objective) => objective.status === "breached",
  ).length;
  const informativeTurn = Math.max(
    1,
    Math.min(
      10,
      run.history.find((record) =>
        record.objectives.some((objective) => objective.status === "breached"),
      )?.turn ?? 6,
    ),
  );

  const initialReportedGrain =
    run.initialState.grainCentralKt +
    run.initialState.regions.capital.reportedGrainKt +
    run.initialState.regions.north.reportedGrainKt +
    run.initialState.regions.interior.reportedGrainKt;
  const cropReport = run.initialState.observations.reportedDomesticOutputKt;
  const cropTruth = run.initialState.domesticGrainOutputKt;

  return (
    <main className="aar">
      <header className="aar-topbar">
        <div className="aar-topbar__title">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <span />
            </span>
          </div>
          <strong>After-action review</strong>
          <span>
            The Narrows · seed {run.seed} · branch {run.branch.id}
          </span>
        </div>
        <div className="aar-topbar__actions">
          <button className="button button--ghost button--small" type="button" onClick={onReturn}>
            <span>Return to desk</span>
          </button>
          <button className="button button--small" type="button" onClick={onExport}>
            <Icon name="download" />
            <span>Export run</span>
          </button>
        </div>
      </header>

      <div className="aar-main">
        <section className="aar-hero">
          <div>
            <p className="eyebrow">Twelve-week assessment / Deterministic replay verified</p>
            <h1>
              {breached === 0
                ? "The system held. The question is how."
                : "The crisis exposed the cost of delay."}
            </h1>
            <p>
              Your run ended with {finalResilience.toFixed(1)} weeks of minimum reserve
              coverage, {run.state.metrics.foodShortfallDays.toFixed(0)} food-service
              shortfall days, and {formatUsd(run.state.metrics.minimumFxCents, true)} as
              the lowest foreign-exchange balance. The exhibits below reconstruct intent
              before revealing hidden state.
            </p>
          </div>
          <div className="aar-hero__facts">
            <div className="aar-fact">
              <span>Food shortfall</span>
              <strong>{run.state.metrics.foodShortfallDays.toFixed(0)} days</strong>
            </div>
            <div className="aar-fact">
              <span>Minimum FX</span>
              <strong>{formatUsd(run.state.metrics.minimumFxCents, true)}</strong>
            </div>
            <div className="aar-fact">
              <span>Port restored</span>
              <strong>{run.state.repairProgressPct.toFixed(0)}%</strong>
            </div>
            <div className="aar-fact">
              <span>Policy churn</span>
              <strong>{run.state.metrics.policyChurn}</strong>
            </div>
          </div>
        </section>

        <section className="aar-section" aria-labelledby="intent-title">
          <div className="aar-section__header">
            <span className="aar-section__number">01</span>
            <div className="aar-section__copy">
              <h2 id="intent-title">Reconstruct your intent</h2>
              <p>
                These are the forecasts and rationales recorded before each immutable
                package was committed.
              </p>
            </div>
          </div>
          <Panel flush>
            <div className="forecast-table">
              <div className="forecast-row forecast-row--header">
                <span>Week</span>
                <span>Rationale</span>
                <span>Forecast grain</span>
                <span>Realized reported</span>
                <span>Binding call</span>
              </div>
              {run.history.map((record) => {
                const state = record.stateSnapshot;
                const reported =
                  state.grainCentralKt +
                  state.regions.capital.reportedGrainKt +
                  state.regions.north.reportedGrainKt +
                  state.regions.interior.reportedGrainKt;
                const demand =
                  state.regions.capital.weeklyDemandKt +
                  state.regions.north.weeklyDemandKt +
                  state.regions.interior.weeklyDemandKt;
                const realized = reported / Math.max(0.01, demand);
                const binding = record.bindingConstraints.find((item) => item.binding);
                return (
                  <div className="forecast-row" key={record.turn}>
                    <strong>W{record.turn}</strong>
                    <span className="forecast-row__note" title={record.decision.notes}>
                      {record.decision.notes}
                    </span>
                    <span>
                      {record.decision.forecasts.grainCoverageWeeks?.toFixed(1) ?? "—"} wk
                    </span>
                    <span>{realized.toFixed(1)} wk</span>
                    <StatusLabel
                      tone={
                        record.decision.forecasts.bindingConstraint ===
                        (binding?.constraint ?? "none")
                          ? "stable"
                          : "watch"
                      }
                    >
                      {record.decision.forecasts.bindingConstraint ?? "none"}
                    </StatusLabel>
                  </div>
                );
              })}
            </div>
          </Panel>
        </section>

        <section className="aar-section" aria-labelledby="accounting-title">
          <div className="aar-section__header">
            <span className="aar-section__number">02</span>
            <div className="aar-section__copy">
              <h2 id="accounting-title">Account for the outcome</h2>
              <p>
                Stocks reconcile from opening to closing. Contributions aggregate the
                logged causal trace rather than retelling the run from memory.
              </p>
            </div>
          </div>
          <div className="grid grid--2">
            <Panel title="Twelve-week grain accounting" flush>
              <Waterfall
                label="Opening to closing true grain accounting"
                unit="kt"
                items={[
                  { label: "Opening", value: openingGrain, kind: "opening" },
                  { label: "Inflows", value: grainIn, kind: "inflow" },
                  { label: "Outflows", value: grainOut, kind: "outflow" },
                  { label: "Closing", value: closingGrain, kind: "closing" },
                ]}
              />
            </Panel>
            <Panel title="Twelve-week diesel accounting" flush>
              <Waterfall
                label="Opening to closing diesel accounting"
                unit="kt"
                items={[
                  { label: "Opening", value: run.initialState.dieselKt, kind: "opening" },
                  { label: "Inflows", value: dieselIn, kind: "inflow" },
                  { label: "Outflows", value: dieselOut, kind: "outflow" },
                  { label: "Closing", value: run.state.dieselKt, kind: "closing" },
                ]}
              />
            </Panel>
          </div>
        </section>

        <section className="aar-section" aria-labelledby="bottleneck-title">
          <div className="aar-section__header">
            <span className="aar-section__number">03</span>
            <div className="aar-section__copy">
              <h2 id="bottleneck-title">Locate the moving bottleneck</h2>
              <p>
                Filled squares indicate the mechanism that bound a requested flow; pale
                squares indicate pressure without a realized shortfall.
              </p>
            </div>
          </div>
          <Panel title="Weekly binding-constraint timeline" flush>
            <div style={{ padding: 15 }}>
              <DebriefConstraintExhibit run={run} />
            </div>
          </Panel>
        </section>

        <section className="aar-section" aria-labelledby="comparison-title">
          <div className="aar-section__header">
            <span className="aar-section__number">04</span>
            <div className="aar-section__copy">
              <h2 id="comparison-title">Compare interpretable policies</h2>
              <p>
                These references replay the same seed. They are transparent rules—not a
                mysterious optimal agent.
              </p>
            </div>
          </div>
          <div className="baseline-grid">
            {comparisons.map((comparison) => (
              <article
                className={`baseline-card ${
                  comparison.policy === "player" ? "baseline-card--player" : ""
                }`}
                key={comparison.label}
              >
                <StatusLabel
                  tone={comparison.policy === "player" ? "info" : "stable"}
                >
                  {comparison.policy === "player" ? "Recorded run" : "Reference policy"}
                </StatusLabel>
                <h3>{comparison.label}</h3>
                <p>
                  {comparison.policy === "player"
                    ? "Your committed packages and forecasts."
                    : comparison.policy === "reactive"
                      ? "Acts after reported stock thresholds are crossed."
                      : "Orders ahead of lead times, repairs early, and protects buffers."}
                </p>
                <div className="baseline-metrics">
                  <div className="baseline-metric">
                    <span>Food shortfall</span>
                    <strong>{comparison.foodDays.toFixed(0)} days</strong>
                  </div>
                  <div className="baseline-metric">
                    <span>Minimum FX</span>
                    <strong>{formatUsd(comparison.minFx, true)}</strong>
                  </div>
                  <div className="baseline-metric">
                    <span>Repair</span>
                    <strong>{comparison.repair.toFixed(0)}%</strong>
                  </div>
                  <div className="baseline-metric">
                    <span>Resilience</span>
                    <strong>{comparison.resilience.toFixed(1)} wk</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="aar-section" aria-labelledby="truth-title">
          <div className="aar-section__header">
            <span className="aar-section__number">05</span>
            <div className="aar-section__copy">
              <h2 id="truth-title">Reveal hidden state</h2>
              <p>
                Separate what was unknowable, what was measurable through an information
                action, and what was visible but easy to neglect.
              </p>
            </div>
          </div>
          <div className="truth-reveal">
            <article className="truth-column">
              <span className="truth-column__icon">
                <Icon name="info" />
              </span>
              <h3>Initially uncertain</h3>
              <p>
                The opening domestic crop estimate was {cropReport.toFixed(1)} kt per
                week. Seeded field conditions set the true output before play.
              </p>
              <strong>{cropTruth.toFixed(2)} kt/wk true</strong>
            </article>
            <article className="truth-column">
              <span className="truth-column__icon">
                <Icon name="repair" />
              </span>
              <h3>Knowable by inspection</h3>
              <p>
                Port repair productivity could be measured with an engineering audit,
                but not inferred from nameplate throughput alone.
              </p>
              <strong>{run.state.variant.repairEfficiency.toFixed(2)}× efficiency</strong>
            </article>
            <article className="truth-column">
              <span className="truth-column__icon">
                <Icon name="reports" />
              </span>
              <h3>Visible through imperfect returns</h3>
              <p>
                Opening regional returns summed to{" "}
                {initialReportedGrain.toFixed(1)} kt including the central depot; true
                opening stock was {openingGrain.toFixed(1)} kt.
              </p>
              <strong>{(initialReportedGrain - openingGrain).toFixed(1)} kt error</strong>
            </article>
          </div>
        </section>

        <section className="aar-section" aria-labelledby="transfer-title">
          <div className="aar-section__header">
            <span className="aar-section__number">06</span>
            <div className="aar-section__copy">
              <h2 id="transfer-title">Test transfer</h2>
              <p>
                State the mechanism in domain-general language before replaying the same
                story.
              </p>
            </div>
          </div>
          <div className="transfer-questions">
            <article className="transfer-card">
              <p>
                If standard shipping took one additional week, which of your orders
                crossed the lead-time threshold too late—and what earlier signal should
                have triggered it?
              </p>
            </article>
            <article className="transfer-card">
              <p>
                If copper receipts fell by 20%, would foreign exchange or physical port
                capacity bind first? What evidence from your trace supports the answer?
              </p>
            </article>
            <article className="transfer-card">
              <p>
                If rail capacity rose to 14 kt immediately, which constraint would
                migrate next? Name the stock, flow, or queue that exposes it.
              </p>
            </article>
          </div>
        </section>

        <section className="branch-cta" aria-labelledby="branch-title">
          <div>
            <p className="eyebrow">Replay the diagnosis, not just the outcome</p>
            <h2 id="branch-title">Branch from week {informativeTurn}</h2>
            <p>
              This was the first high-information decision point in the recorded run.
              The original history remains immutable; a new branch keeps all earlier
              decisions and changes only what follows.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="button button--primary"
              type="button"
              onClick={() => onBranch(informativeTurn - 1)}
            >
              <Icon name="branch" />
              Create branch
            </button>
            <button className="button" type="button" onClick={onRestart}>
              New run
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
