import {
  ENGINE_VERSION,
  IMPORT_LEAD_TURNS,
  RNG_VERSION,
  ROLE_TITLE,
  RUN_SCHEMA_VERSION,
  SCENARIO_CONTENT_HASH,
  SCENARIO_ID,
  SCENARIO_TITLE,
  SCENARIO_VERSION,
  TOTAL_TURNS,
} from "./constants.ts";
import { cloneJson, normaliseSeed, round, stableHash } from "./determinism.ts";
import {
  DecisionValidationError,
  createDefaultDecision,
  stepWorld,
} from "./engine.ts";
import {
  availableActionsForState,
  createInitialWorldState,
  ongoingAdminClaimsForNextTurn,
  reportedTotalGrainKt,
  totalWeeklyDemandKt,
  validateDecision,
} from "./model.ts";
import type {
  BaselinePolicy,
  BindingConstraint,
  DecisionPackage,
  RegionId,
  SimulationMode,
  SimulationRun,
  TurnRecord,
  VisibleAlert,
  VisibleSnapshot,
  WorldState,
} from "./types.ts";

export function createInitialRun(
  seed: number,
  mode: SimulationMode = "guided",
): SimulationRun {
  if (!["guided", "professional", "sandbox"].includes(mode)) {
    throw new Error(`Unknown simulation mode: ${String(mode)}.`);
  }
  const normalised = normaliseSeed(seed);
  const state = createInitialWorldState(normalised, mode);
  const initialState = cloneJson(state);
  const initialStateHash = stableHash(initialState);
  const runId = `${SCENARIO_ID}:${SCENARIO_VERSION}:${normalised}:${mode}`;
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    scenarioId: SCENARIO_ID,
    scenarioVersion: SCENARIO_VERSION,
    scenarioContentHash: SCENARIO_CONTENT_HASH,
    rngVersion: RNG_VERSION,
    seed: normalised,
    mode,
    runId,
    branch: {
      id: "main",
      parentRunId: null,
      forkTurn: null,
    },
    initialStateHash,
    initialState,
    state,
    history: [],
  };
}

export function stepRun(
  run: SimulationRun,
  decision: DecisionPackage,
): SimulationRun {
  if (
    run.engineVersion !== ENGINE_VERSION ||
    run.scenarioVersion !== SCENARIO_VERSION ||
    run.scenarioContentHash !== SCENARIO_CONTENT_HASH ||
    run.rngVersion !== RNG_VERSION
  ) {
    throw new Error("Run version does not match this simulation engine.");
  }
  const result = stepWorld(run.state, decision);
  const stateSnapshot = cloneJson(result.state);
  const record: TurnRecord = {
    turn: result.state.turn,
    simulatedDate: result.state.simulatedDate,
    decision: cloneJson(decision),
    events: cloneJson(result.events),
    reports: cloneJson(result.reports),
    actionStatusChanges: cloneJson(result.actionStatusChanges),
    objectives: cloneJson(result.objectives),
    trace: cloneJson(result.trace),
    bindingConstraints: cloneJson(result.bindingConstraints),
    invariants: cloneJson(result.invariants),
    stateHash: stableHash(stateSnapshot),
    stateSnapshot,
  };
  return {
    ...run,
    state: result.state,
    history: [...run.history, record],
  };
}

export function replayRun(run: SimulationRun): SimulationRun {
  if (stableHash(run.initialState) !== run.initialStateHash) {
    throw new Error("Saved run initial-state hash is invalid.");
  }
  let replay = createInitialRun(run.seed, run.mode);
  if (replay.initialStateHash !== run.initialStateHash) {
    throw new Error(
      "Current engine cannot reconstruct the saved run's pinned initial state.",
    );
  }
  for (const expected of run.history) {
    replay = stepRun(replay, cloneJson(expected.decision));
    const actual = replay.history[replay.history.length - 1];
    if (actual.stateHash !== expected.stateHash) {
      throw new Error(
        `Deterministic replay mismatch at turn ${expected.turn}: expected ${expected.stateHash}, got ${actual.stateHash}.`,
      );
    }
  }
  return {
    ...replay,
    runId: run.runId,
    branch: cloneJson(run.branch),
  };
}

export function branchRun(run: SimulationRun, turn: number): SimulationRun {
  if (!Number.isInteger(turn) || turn < 0 || turn > run.history.length) {
    throw new Error(`Branch turn must be an integer from 0 to ${run.history.length}.`);
  }
  let branch = createInitialRun(run.seed, run.mode);
  for (const record of run.history.slice(0, turn)) {
    branch = stepRun(branch, cloneJson(record.decision));
    const replayed = branch.history[branch.history.length - 1];
    if (replayed.stateHash !== record.stateHash) {
      throw new Error(`Cannot branch because replay diverged at turn ${record.turn}.`);
    }
  }
  const prefixHash = stableHash(
    branch.history.map((record) => ({
      turn: record.turn,
      decision: record.decision,
      stateHash: record.stateHash,
    })),
  );
  const branchId = `branch-${turn}-${prefixHash}`;
  return {
    ...branch,
    runId: `${run.runId}:${branchId}`,
    branch: {
      id: branchId,
      parentRunId: run.runId,
      forkTurn: turn,
    },
  };
}

function pendingImplementationTeams(state: WorldState): number {
  const auditTeams = state.observations.pendingAudits.length;
  return auditTeams + (state.pendingRationPolicy ? 1 : 0);
}

function serviceStatus(
  reportedGrainKt: number,
  weeklyDemandKt: number,
): "secure" | "at-risk" | "shortfall" {
  const weeks = reportedGrainKt / Math.max(0.01, weeklyDemandKt);
  if (weeks < 0.5) return "shortfall";
  if (weeks < 1.25) return "at-risk";
  return "secure";
}

function visibleAlerts(run: SimulationRun): VisibleAlert[] {
  const state = run.state;
  const alerts: VisibleAlert[] = [];
  const reportedGrain = reportedTotalGrainKt(state);
  const coverage = reportedGrain / totalWeeklyDemandKt(state);
  if (coverage < 1.5) {
    alerts.push({
      id: "alert:grain-coverage",
      severity: coverage < 0.75 ? "critical" : "warning",
      message: `Reported national grain coverage is ${round(coverage, 1)} weeks.`,
    });
  }
  if (state.dieselKt / 3 < 1.5) {
    alerts.push({
      id: "alert:diesel-coverage",
      severity: state.dieselKt / 3 < 0.75 ? "critical" : "warning",
      message: `Diesel coverage is ${round(state.dieselKt / 3, 1)} weeks.`,
    });
  }
  if (state.finance.fxCents < state.finance.emergencyFloorCents * 1.2) {
    alerts.push({
      id: "alert:fx-floor",
      severity:
        state.finance.fxCents < state.finance.emergencyFloorCents
          ? "critical"
          : "warning",
      message: "Foreign-exchange reserves are close to or below the emergency floor.",
    });
  }
  const weatherWarning = state.events
    .filter((item) => item.type === "weather-warning")
    .at(-1);
  if (weatherWarning && weatherWarning.turn === state.turn) {
    alerts.push({
      id: "alert:weather",
      severity: "warning",
      message: weatherWarning.description,
    });
  }
  if (state.earlyPaymentOffer.status === "available") {
    alerts.push({
      id: "alert:early-payment",
      severity: "info",
      message: `The copper advance offer remains open through turn ${state.earlyPaymentOffer.availableUntilTurn}.`,
    });
  }
  return alerts;
}

function visibleObjectivesForState(
  state: WorldState,
  objectives: WorldState["objectives"],
): WorldState["objectives"] {
  if (state.complete || state.mode === "sandbox") return cloneJson(objectives);
  const reportedCoverage =
    reportedTotalGrainKt(state) / Math.max(0.01, totalWeeklyDemandKt(state));
  const dieselCoverage = state.dieselKt / 3;
  return cloneJson(
    objectives.map((objective) =>
      objective.id === "resilience"
        ? {
            ...objective,
            value: round(Math.min(reportedCoverage, dieselCoverage), 3),
            status:
              reportedCoverage >= 2.5 &&
              dieselCoverage >= 2 &&
              state.finance.creditPrincipalCents === 0 &&
              state.finance.contractAdvanceLiabilityCents === 0 &&
              state.finance.arrearsCents === 0
                ? "secure"
                : reportedCoverage < 1 || dieselCoverage < 0.75
                  ? "breached"
                  : "at-risk",
          }
        : objective,
    ),
  );
}

export function getVisibleSnapshot(run: SimulationRun): VisibleSnapshot {
  const state = run.state;
  const reportedGrain = reportedTotalGrainKt(state);
  const regions = Object.fromEntries(
    (["capital", "north", "interior"] as RegionId[]).map((region) => {
      const item = state.regions[region];
      return [
        region,
        {
          id: region,
          label: item.label,
          reportedGrainKt: item.reportedGrainKt,
          weeklyDemandKt: item.weeklyDemandKt,
          reportedCoverageWeeks: round(
            item.reportedGrainKt / Math.max(0.01, item.weeklyDemandKt),
            2,
          ),
          activeRation: item.activeRation,
          serviceStatus: serviceStatus(item.reportedGrainKt, item.weeklyDemandKt),
        },
      ];
    }),
  ) as VisibleSnapshot["regions"];

  const fullTraceVisible = state.complete || state.mode === "sandbox";
  const latestTrace = fullTraceVisible
    ? cloneJson(state.lastTrace)
    : cloneJson(
        state.lastTrace.filter(
          (entry) =>
            entry.target !== "grain.totalKt" ||
            entry.mechanism === "import-unloading",
        ),
      );

  const visibleShipments: VisibleSnapshot["shipments"] = state.shipments.map(
    (shipment) => {
      const earliestTurn =
        shipment.supplier === "opening-pipeline"
          ? shipment.arrivalTurn
          : shipment.orderedTurn + IMPORT_LEAD_TURNS[shipment.supplier];
      const latestTurn =
        earliestTurn + (shipment.supplier === "distant-discount" ? 1 : 0);
      const arrivalIsObservable =
        shipment.status !== "sailing" || earliestTurn === latestTurn;

      return {
        ...cloneJson(shipment),
        arrivalTurn: arrivalIsObservable ? shipment.arrivalTurn : null,
        expectedArrivalWindow: {
          earliestTurn,
          latestTurn,
        },
      };
    },
  );
  const currentWeatherWarning = state.events
    .filter(
      (item) =>
        item.type === "weather-warning" &&
        item.turn === state.turn,
    )
    .at(-1);

  return {
    scenarioId: SCENARIO_ID,
    title: SCENARIO_TITLE,
    role: ROLE_TITLE,
    turn: state.turn,
    turnsTotal: TOTAL_TURNS,
    simulatedDate: state.simulatedDate,
    mode: state.mode,
    complete: state.complete,
    headline: {
      reportedGrainKt: reportedGrain,
      reportedGrainCoverageWeeks: round(
        reportedGrain / Math.max(0.01, totalWeeklyDemandKt(state)),
        2,
      ),
      dieselKt: state.dieselKt,
      dieselCoverageWeeks: round(state.dieselKt / 3, 2),
      fxCents: state.finance.fxCents,
      emergencyFloorCents: state.finance.emergencyFloorCents,
      portCapacityKt: state.portCapacityKt,
      portRepairProgressPct: state.repairProgressPct,
      railCapacityKt: state.railCapacityKt,
      implementationTeamsAvailable:
        state.implementationTeamsTotal -
        ongoingAdminClaimsForNextTurn(state),
    },
    operations: {
      centralGrainKt: state.grainCentralKt,
      copperAtPortKt: state.copperAtPortKt,
      truckCapacityKt: state.truckCapacityKt,
      reportedDomesticGrainOutputKt:
        state.observations.reportedDomesticOutputKt,
      domesticDieselSupplyKt: state.domesticDieselSupplyKt,
      implementationTeamsTotal: state.implementationTeamsTotal,
      implementationTeamsInFlight: pendingImplementationTeams(state),
      knownPortRepairEfficiency:
        state.observations.knownPortRepairEfficiency,
      knownPortClosureTurn: currentWeatherWarning
        ? state.variant.closureTurn
        : null,
    },
    finance: {
      creditPrincipalCents: state.finance.creditPrincipalCents,
      creditLimitCents: state.finance.creditLimitCents,
      creditRemainingCents:
        state.finance.creditLimitCents -
        state.finance.creditPrincipalCents,
      contractAdvanceLiabilityCents:
        state.finance.contractAdvanceLiabilityCents,
      arrearsCents: state.finance.arrearsCents,
      contractualPenaltiesCents:
        state.finance.contractualPenaltiesCents,
    },
    regions,
    shipments: visibleShipments,
    reports: cloneJson(state.observations.reports),
    events: cloneJson(state.events),
    objectives: visibleObjectivesForState(state, state.objectives),
    availableActions: availableActionsForState(state),
    activeActions: cloneJson(
      state.actions.filter((action) =>
        ["queued", "implementing", "active"].includes(action.lifecycle),
      ),
    ),
    pendingRationPolicy: cloneJson(state.pendingRationPolicy),
    earlyPaymentOffer:
      state.earlyPaymentOffer.status === "not-offered"
        ? {
            status: "not-offered",
            offeredTurn: -1,
            availableUntilTurn: -1,
          }
        : cloneJson(state.earlyPaymentOffer),
    earlyPaymentObligation: cloneJson(state.earlyPaymentObligation),
    alerts: visibleAlerts(run),
    latestTrace,
    latestBindings: fullTraceVisible
      ? cloneJson(state.lastBindings)
      : cloneJson(
          state.lastBindings.filter(
            (item) =>
              item.system !== "essential-diesel" ||
              item.binding ||
              state.dieselKt < 4.5,
          ),
        ),
    history: run.history.map((record) => ({
      turn: record.turn,
      simulatedDate: record.simulatedDate,
      decisionId: record.decision.id,
      events: cloneJson(record.events),
      objectives: visibleObjectivesForState(
        record.stateSnapshot,
        record.objectives,
      ),
    })),
  };
}

function lowestReportedRegion(state: WorldState): RegionId {
  return (["capital", "north", "interior"] as RegionId[]).sort(
    (left, right) =>
      state.regions[left].reportedGrainKt /
        state.regions[left].weeklyDemandKt -
      state.regions[right].reportedGrainKt /
        state.regions[right].weeklyDemandKt,
  )[0];
}

function fillForecasts(
  state: WorldState,
  decision: DecisionPackage,
  constraint: BindingConstraint,
): DecisionPackage {
  decision.forecasts = {
    grainCoverageWeeks: round(
      reportedTotalGrainKt(state) / totalWeeklyDemandKt(state),
      2,
    ),
    fxUsdM: round(state.finance.fxCents / 100_000_000, 2),
    bindingConstraint: constraint,
  };
  return decision;
}

function baselineDecision(
  policy: BaselinePolicy,
  state: WorldState,
): DecisionPackage {
  const decision = createDefaultDecision(state);
  if (policy === "minimal") {
    decision.notes = "Maintain inherited operating schedules; make no new intervention.";
    return fillForecasts(state, decision, "port");
  }

  if (policy === "adversary") {
    decision.portSchedule = {
      grainImportsKt: 0,
      dieselImportsKt: 0,
      copperExportsKt: 8,
      repairEquipmentKt: 0,
    };
    decision.railAndTruck = {
      railGrainKt: 0,
      railCopperKt: 10,
      grainSharesPct: { capital: 34, north: 33, interior: 33 },
      truckRegion: "none",
      truckGrainKt: 0,
    };
    decision.copperPlan.mineTargetKt = 5;
    decision.rationPolicy = {
      capital: state.turn % 2 === 0 ? "severe" : "none",
      north: state.turn % 2 === 0 ? "severe" : "none",
      interior: state.turn % 2 === 0 ? "severe" : "none",
    };
    decision.copperPlan.acceptEarlyPayment =
      state.earlyPaymentOffer.status === "available";
    decision.notes = "Exploit-search stress policy: maximize exports and churn rationing.";
    return fillForecasts(state, decision, "regional-stock");
  }

  const grainCoverage = reportedTotalGrainKt(state) / totalWeeklyDemandKt(state);
  const dieselCoverage = state.dieselKt / 3;
  const lowRegion = lowestReportedRegion(state);
  const remainingCredit =
    (state.finance.creditLimitCents - state.finance.creditPrincipalCents) /
    100_000_000;

  if (policy === "reactive") {
    if (grainCoverage < 2) {
      decision.imports.push({
        cargo: "grain",
        supplier: "near-premium",
        quantityKt: 5,
      });
    }
    if (dieselCoverage < 1.5) {
      decision.imports.push({
        cargo: "diesel",
        supplier: "near-premium",
        quantityKt: 2,
      });
    }
    if (
      state.regions[lowRegion].reportedGrainKt /
        state.regions[lowRegion].weeklyDemandKt <
      0.9
    ) {
      decision.rationPolicy[lowRegion] = "moderate";
      decision.railAndTruck.truckRegion = lowRegion;
      decision.railAndTruck.truckGrainKt = Math.min(1.5, state.grainCentralKt);
    }
    if (state.turn >= 6 && state.repairProgressPct < 40) {
      decision.repairIntensity = "normal";
      decision.portSchedule.repairEquipmentKt = 0.6;
    }
    if (
      state.finance.fxCents < state.finance.emergencyFloorCents + 200_000_000 &&
      remainingCredit >= 2
    ) {
      decision.emergencyCreditUsdM = 2;
    }
    decision.notes = "Reactive baseline responds after reported thresholds are crossed.";
    return fillForecasts(
      state,
      decision,
      grainCoverage < 1.5 ? "grain-stock" : "port",
    );
  }

  decision.portSchedule = {
    grainImportsKt: 3.5,
    dieselImportsKt: 1.5,
    copperExportsKt: 4,
    repairEquipmentKt: 1.1,
  };
  decision.railAndTruck.railGrainKt = 5.5;
  decision.railAndTruck.railCopperKt = 4.5;
  decision.copperPlan.mineTargetKt = 4.5;
  decision.repairIntensity =
    state.repairProgressPct >= 80 ? "none" : "accelerated";
  if (decision.repairIntensity === "none") {
    decision.portSchedule.repairEquipmentKt = 0;
  }
  if (state.turn === 0) {
    decision.imports.push(
      { cargo: "grain", supplier: "standard", quantityKt: 8 },
      { cargo: "diesel", supplier: "standard", quantityKt: 4 },
    );
    decision.audit = "north-stock";
  } else if (state.turn === 3) {
    decision.imports.push({
      cargo: "grain",
      supplier: "standard",
      quantityKt: 6,
    });
    decision.audit = "crop";
  } else if (state.turn === 6) {
    decision.imports.push({
      cargo: "diesel",
      supplier: "standard",
      quantityKt: 3,
    });
    decision.audit = "port-damage";
  }
  if (
    state.regions[lowRegion].reportedGrainKt /
      state.regions[lowRegion].weeklyDemandKt <
    1.2
  ) {
    decision.rationPolicy[lowRegion] = "moderate";
  }
  if (
    state.finance.fxCents < state.finance.emergencyFloorCents + 300_000_000 &&
    remainingCredit >= 2
  ) {
    decision.emergencyCreditUsdM = 2;
  }
  decision.notes =
    "Competent rule-based baseline orders ahead of lead times, repairs early, and protects buffers.";
  return fillForecasts(state, decision, "port");
}

export function runBaseline(
  policy: BaselinePolicy,
  seed: number,
  mode: SimulationMode = "professional",
): SimulationRun {
  let run = createInitialRun(seed, mode);
  while (!run.state.complete) {
    let decision = baselineDecision(policy, run.state);
    let validation = validateDecision(run.state, decision);
    if (!validation.valid) {
      decision = fillForecasts(
        run.state,
        createDefaultDecision(run.state),
        "port",
      );
      decision.notes = `${policy} baseline fell back to the safe operating schedule: ${validation.errors
        .map((error) => error.code)
        .join(", ")}.`;
      validation = validateDecision(run.state, decision);
    }
    if (!validation.valid) throw new DecisionValidationError(validation);
    run = stepRun(run, decision);
  }
  return run;
}

export function serializeRun(run: SimulationRun): string {
  return JSON.stringify(run);
}

export function deserializeRun(json: string): SimulationRun {
  const parsed = JSON.parse(json) as SimulationRun;
  if (
    parsed.schemaVersion !== RUN_SCHEMA_VERSION ||
    parsed.engineVersion !== ENGINE_VERSION ||
    parsed.scenarioId !== SCENARIO_ID ||
    parsed.scenarioVersion !== SCENARIO_VERSION ||
    parsed.scenarioContentHash !== SCENARIO_CONTENT_HASH ||
    parsed.rngVersion !== RNG_VERSION
  ) {
    throw new Error("Saved run is not compatible with this engine build.");
  }
  return replayRun(parsed);
}
