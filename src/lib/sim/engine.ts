import {
  ACTION_LABELS,
  COPPER_RECEIPT_CENTS_PER_KT,
  DIESEL_ESSENTIAL_REQUIREMENT_KT,
  DIESEL_PER_COPPER_KT,
  DIESEL_PER_RAIL_GRAIN_KT,
  DIESEL_PER_TRUCKED_GRAIN_KT,
  EARLY_PAYMENT_ADVANCE_CENTS,
  EARLY_PAYMENT_CARGO_KT,
  EARLY_PAYMENT_PENALTY_CENTS,
  IMPORT_LEAD_TURNS,
  IMPORT_UNIT_COST_CENTS_PER_KT,
  REGION_IDS,
  REPAIR_ASSUMPTIONS,
  TOTAL_TURNS,
  WEEKLY_CREDIT_INTEREST_RATE,
} from "./constants.ts";
import {
  addWeeks,
  cloneJson,
  deterministicInt,
  round,
  stableHash,
} from "./determinism.ts";
import {
  createDefaultDecision,
  decisionAdminClaims,
  evaluateObjectives,
  portCapacityForRepair,
  trueTotalGrainKt,
  validateDecision,
} from "./model.ts";
import type {
  ActionFamily,
  ActionLifecycle,
  ActionStatus,
  BindingConstraint,
  BindingRecord,
  Contribution,
  DecisionPackage,
  InvariantCheck,
  LedgerEntry,
  ObservationReport,
  RegionId,
  SimulationEvent,
  Shipment,
  StepResult,
  TruthRecord,
  ValidationResult,
  WorldState,
} from "./types.ts";

export class DecisionValidationError extends Error {
  readonly validation: ValidationResult;

  constructor(validation: ValidationResult) {
    super(validation.errors.map((error) => error.message).join(" "));
    this.name = "DecisionValidationError";
    this.validation = validation;
  }
}

function actionId(turn: number, family: ActionFamily, suffix = "1"): string {
  return `action:${turn}:${family}:${suffix}`;
}

function event(
  turn: number,
  type: SimulationEvent["type"],
  title: string,
  description: string,
  severity: SimulationEvent["severity"],
  relatedVariables: string[],
): SimulationEvent {
  return {
    id: `event:${turn}:${type}`,
    turn,
    type,
    title,
    description,
    severity,
    relatedVariables,
  };
}

function contribution(
  turn: number,
  index: number,
  target: string,
  mechanism: string,
  amount: number,
  unit: Contribution["unit"],
  bindingConstraint: BindingConstraint,
  note: string,
  actionIds: string[] = [],
  eventIds: string[] = [],
  sourceVariables: string[] = [],
): Contribution {
  return {
    id: `trace:${turn}:${index}:${target}:${mechanism}`,
    turn,
    target,
    mechanism,
    sourceVariables,
    actionIds,
    eventIds,
    amount,
    unit,
    bindingConstraint,
    note,
  };
}

function binding(
  turn: number,
  system: string,
  requested: number,
  available: number,
  realised: number,
  unit: BindingRecord["unit"],
  constraint: BindingConstraint,
  note: string,
): BindingRecord {
  return {
    id: `binding:${turn}:${system}`,
    turn,
    system,
    requested: round(requested),
    available: round(available),
    realized: round(realised),
    unit,
    constraint,
    binding: requested > available + 1e-6 || realised + 1e-6 < requested,
    note,
  };
}

function addAction(
  state: WorldState,
  changes: ActionStatus[],
  id: string,
  family: ActionFamily,
  label: string,
  lifecycle: ActionLifecycle,
  turn: number,
  effectiveTurn: number,
  reason: string,
): ActionStatus {
  const status: ActionStatus = {
    id,
    family,
    label,
    lifecycle,
    committedTurn: turn,
    effectiveTurn,
    completedTurn: lifecycle === "completed" ? turn : null,
    reason,
  };
  state.actions.push(status);
  changes.push(cloneJson(status));
  return status;
}

function updateAction(
  state: WorldState,
  changes: ActionStatus[],
  id: string,
  lifecycle: ActionLifecycle,
  turn: number,
  reason: string,
): void {
  const found = state.actions.find((action) => action.id === id);
  if (!found) return;
  found.lifecycle = lifecycle;
  found.reason = reason;
  if (["completed", "expired", "cancelled", "failed"].includes(lifecycle)) {
    found.completedTurn = turn;
  }
  changes.push(cloneJson(found));
}

function postLedger(
  state: WorldState,
  turn: number,
  account: LedgerEntry["account"],
  description: string,
  requestedCashDeltaCents: number,
  liabilityDeltaCents: number,
  relatedActionId: string | null,
  relatedEventId: string | null,
): LedgerEntry {
  let cashDeltaCents = Math.round(requestedCashDeltaCents);
  let liabilityDelta = Math.round(liabilityDeltaCents);
  if (cashDeltaCents < 0 && state.finance.fxCents + cashDeltaCents < 0) {
    const unpaid = -(state.finance.fxCents + cashDeltaCents);
    cashDeltaCents = -state.finance.fxCents;
    state.finance.arrearsCents += unpaid;
    liabilityDelta += unpaid;
  }
  state.finance.fxCents += cashDeltaCents;
  state.metrics.minimumFxCents = Math.min(
    state.metrics.minimumFxCents,
    state.finance.fxCents,
  );
  const entry: LedgerEntry = {
    id: `ledger:${turn}:${state.finance.ledger.length + 1}:${account}`,
    turn,
    account,
    description,
    cashDeltaCents,
    liabilityDeltaCents: liabilityDelta,
    balanceAfterCents: state.finance.fxCents,
    relatedActionId,
    relatedEventId,
  };
  state.finance.ledger.push(entry);
  return entry;
}

function applyOpeningMilestones(
  state: WorldState,
  turn: number,
  reports: ObservationReport[],
  actionChanges: ActionStatus[],
): void {
  if (state.pendingRationPolicy && state.pendingRationPolicy.effectiveTurn <= turn) {
    for (const region of REGION_IDS) {
      state.regions[region].activeRation = state.pendingRationPolicy.levels[region];
    }
    updateAction(
      state,
      actionChanges,
      state.pendingRationPolicy.actionId,
      "active",
      turn,
      "The revised ration bands are now in force.",
    );
    state.pendingRationPolicy = null;
  }

  const remainingAudits = [];
  for (const audit of state.observations.pendingAudits) {
    if (audit.completionTurn > turn) {
      remainingAudits.push(audit);
      continue;
    }
    const values: ObservationReport["values"] = { auditKind: audit.kind };
    let title = "Audit completed";
    let kind: ObservationReport["kind"] = "audit";
    if (audit.kind.endsWith("-stock")) {
      const region = audit.kind.replace("-stock", "") as RegionId;
      values.region = region;
      values.grainKt = state.regions[region].grainKt;
      state.regions[region].reportedGrainKt = state.regions[region].grainKt;
      title = `${state.regions[region].label} stock audit`;
    } else if (audit.kind === "crop") {
      values.weeklyOutputKt = state.domesticGrainOutputKt;
      state.observations.reportedDomesticOutputKt = state.domesticGrainOutputKt;
      title = "Rapid crop reassessment";
      kind = "crop";
    } else {
      values.repairEfficiency = state.variant.repairEfficiency;
      values.capacityAt40PctKt = 16;
      values.capacityAt80PctKt = 20;
      state.observations.knownPortRepairEfficiency = state.variant.repairEfficiency;
      title = "Port engineering inspection";
      kind = "port-engineering";
    }
    reports.push({
      id: `report:audit:${audit.id}`,
      kind,
      title,
      source: "Emergency inspection team",
      eventTurn: turn,
      asOfTurn: Math.max(0, turn - 1),
      publishedTurn: turn,
      status: "final",
      revisesReportId: null,
      values,
      methodology: "Targeted physical inspection commissioned by the Decision Book.",
      confidence: "high",
    });
    updateAction(
      state,
      actionChanges,
      audit.actionId,
      "completed",
      turn,
      "The requested inspection report has arrived.",
    );
  }
  state.observations.pendingAudits = remainingAudits;
}

function enactFinancialAndQueuedActions(
  state: WorldState,
  decision: DecisionPackage,
  turn: number,
  actionChanges: ActionStatus[],
): void {
  if (decision.emergencyCreditUsdM > 0) {
    const id = actionId(turn, "emergencyCredit");
    const cents = Math.round(decision.emergencyCreditUsdM * 100_000_000);
    state.finance.creditPrincipalCents += cents;
    postLedger(
      state,
      turn,
      "emergency-credit",
      `Draw ${decision.emergencyCreditUsdM.toFixed(1)}m USD from the emergency line`,
      cents,
      cents,
      id,
      null,
    );
    state.metrics.emergencyActionCount += 1;
    addAction(
      state,
      actionChanges,
      id,
      "emergencyCredit",
      ACTION_LABELS.emergencyCredit,
      "completed",
      turn,
      turn,
      "Credit proceeds were received; principal and weekly interest remain due.",
    );
  }

  if (decision.copperPlan.acceptEarlyPayment) {
    const id = actionId(turn, "copperPlan", "early-payment");
    postLedger(
      state,
      turn,
      "early-payment",
      "Copper buyer early-payment advance",
      EARLY_PAYMENT_ADVANCE_CENTS,
      EARLY_PAYMENT_ADVANCE_CENTS,
      id,
      null,
    );
    state.finance.contractAdvanceLiabilityCents +=
      EARLY_PAYMENT_ADVANCE_CENTS;
    state.earlyPaymentOffer.status = "accepted";
    state.earlyPaymentObligation = {
      acceptedTurn: turn,
      dueTurn: turn + 2,
      originalKt: EARLY_PAYMENT_CARGO_KT,
      remainingKt: EARLY_PAYMENT_CARGO_KT,
      advanceCents: EARLY_PAYMENT_ADVANCE_CENTS,
    };
    addAction(
      state,
      actionChanges,
      id,
      "copperPlan",
      "Accept costly early-payment contract",
      "active",
      turn,
      turn,
      `Advance received against ${EARLY_PAYMENT_CARGO_KT} kt due by turn ${turn + 2}.`,
    );
  }

  decision.imports.forEach((order, index) => {
    const id = actionId(turn, "imports", String(index + 1));
    const extraDelay =
      order.supplier === "distant-discount"
        ? deterministicInt(state.seed, `shipment-delay:${turn}:${index}`, 0, 1)
        : 0;
    const arrivalTurn = turn + IMPORT_LEAD_TURNS[order.supplier] + extraDelay;
    const earliestArrivalTurn = turn + IMPORT_LEAD_TURNS[order.supplier];
    const expectedArrival =
      order.supplier === "distant-discount"
        ? `turns ${earliestArrivalTurn}–${earliestArrivalTurn + 1}`
        : `turn ${earliestArrivalTurn}`;
    const unitCost = IMPORT_UNIT_COST_CENTS_PER_KT[order.cargo][order.supplier];
    const shipment: Shipment = {
      id: `shipment:${turn}:${index + 1}:${order.cargo}`,
      cargo: order.cargo,
      supplier: order.supplier,
      orderedTurn: turn,
      arrivalTurn,
      quantityKt: round(order.quantityKt),
      remainingKt: round(order.quantityKt),
      unitCostCentsPerKt: unitCost,
      status: "sailing",
      actionId: id,
    };
    state.shipments.push(shipment);
    postLedger(
      state,
      turn,
      "imports",
      `${order.quantityKt} kt ${order.cargo} contract with ${order.supplier}`,
      -Math.round(order.quantityKt * unitCost),
      0,
      id,
      null,
    );
    addAction(
      state,
      actionChanges,
      id,
      "imports",
      `${order.cargo} import — ${order.supplier}`,
      "queued",
      turn,
      arrivalTurn,
      `Paid on signing; expected at the port in ${expectedArrival}.`,
    );
  });

  const repair = REPAIR_ASSUMPTIONS[decision.repairIntensity];
  if (decision.repairIntensity !== "none") {
    const id = actionId(turn, "repairIntensity");
    postLedger(
      state,
      turn,
      "port-repair",
      `${decision.repairIntensity} port repair programme`,
      -repair.costCents,
      0,
      id,
      null,
    );
    addAction(
      state,
      actionChanges,
      id,
      "repairIntensity",
      `${decision.repairIntensity} port repair`,
      "implementing",
      turn,
      turn,
      "Progress depends on the equipment berth allocation and diesel availability.",
    );
  }

  const policyAtStart = {
    capital: state.regions.capital.activeRation,
    north: state.regions.north.activeRation,
    interior: state.regions.interior.activeRation,
  };
  if (stableHash(policyAtStart) !== stableHash(decision.rationPolicy)) {
    const id = actionId(turn, "rationPolicy");
    state.pendingRationPolicy = {
      levels: cloneJson(decision.rationPolicy),
      effectiveTurn: turn + 1,
      actionId: id,
    };
    state.metrics.policyChurn += 1;
    addAction(
      state,
      actionChanges,
      id,
      "rationPolicy",
      ACTION_LABELS.rationPolicy,
      "queued",
      turn,
      turn + 1,
      "Regional instructions require one week to implement.",
    );
  }

  if (decision.audit !== "none") {
    const id = actionId(turn, "audit");
    state.observations.pendingAudits.push({
      id: `audit:${turn}:${decision.audit}`,
      kind: decision.audit,
      requestedTurn: turn,
      completionTurn: turn + 1,
      actionId: id,
    });
    state.metrics.informationActionsUsed += 1;
    addAction(
      state,
      actionChanges,
      id,
      "audit",
      `${ACTION_LABELS.audit}: ${decision.audit}`,
      "queued",
      turn,
      turn + 1,
      "The targeted report will arrive after one weekly step.",
    );
  }
}

function releaseExogenousEvents(
  state: WorldState,
  turn: number,
  events: SimulationEvent[],
): boolean {
  let portClosed = false;
  if (turn === state.variant.closureTurn - 1) {
    events.push(
      event(
        turn,
        "weather-warning",
        "Port closure forecast",
        `Severe weather is expected to close the Main Port during turn ${state.variant.closureTurn}.`,
        "warning",
        ["capacity.port"],
      ),
    );
  }
  if (turn === state.variant.closureTurn) {
    portClosed = true;
    events.push(
      event(
        turn,
        "port-closure",
        "Main Port closed for one week",
        "The forecast storm prevents unloading, loading, and repair-equipment handling.",
        "critical",
        ["capacity.port", "pipelines.imports", "exports.copper"],
      ),
    );
  }
  if (turn === state.variant.cropRevisionTurn) {
    const direction = state.variant.cropMultiplier < 1 ? "below" : "above";
    events.push(
      event(
        turn,
        "crop-revision",
        "Crop estimate revised",
        `Completed field returns put weekly domestic grain output ${direction} the opening estimate.`,
        state.variant.cropMultiplier < 1 ? "warning" : "info",
        ["grain.domestic-output"],
      ),
    );
  }
  if (turn === state.variant.stockRevisionTurn) {
    events.push(
      event(
        turn,
        "regional-stock-revision",
        "Regional stock return revised",
        `${state.regions[state.variant.stockRevisionRegion].label} corrected an earlier unaudited return.`,
        "warning",
        [`grain.region.${state.variant.stockRevisionRegion}`],
      ),
    );
  }
  if (turn === state.variant.earlyPaymentOfferTurn) {
    state.earlyPaymentOffer.status = "available";
    events.push(
      event(
        turn,
        "early-payment-offer",
        "Copper buyer offers an advance",
        `A buyer offers an immediate advance against ${EARLY_PAYMENT_CARGO_KT} kt due within two turns, at a discount.`,
        "info",
        ["finance.fx", "exports.copper"],
      ),
    );
  }
  return portClosed;
}

function arriveShipments(
  state: WorldState,
  turn: number,
  actionChanges: ActionStatus[],
): void {
  for (const shipment of state.shipments) {
    if (shipment.status === "sailing" && shipment.arrivalTurn <= turn) {
      shipment.status = "arrived";
      updateAction(
        state,
        actionChanges,
        shipment.actionId,
        "implementing",
        turn,
        "The vessel has arrived and is waiting for its cargo allocation.",
      );
    }
    if (shipment.status === "arrived") shipment.status = "queued-at-port";
  }
}

function unloadCargo(
  state: WorldState,
  turn: number,
  cargo: "grain" | "diesel",
  allocationKt: number,
  actionChanges: ActionStatus[],
): number {
  let remainingCapacity = allocationKt;
  let unloaded = 0;
  const queue = state.shipments
    .filter(
      (shipment) =>
        shipment.cargo === cargo &&
        shipment.remainingKt > 0 &&
        shipment.arrivalTurn <= turn,
    )
    .sort((left, right) => {
      const arrivalOrder = left.arrivalTurn - right.arrivalTurn;
      if (arrivalOrder !== 0) return arrivalOrder;
      const commitmentOrder = left.orderedTurn - right.orderedTurn;
      if (commitmentOrder !== 0) return commitmentOrder;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  for (const shipment of queue) {
    if (remainingCapacity <= 1e-6) break;
    const moved = Math.min(shipment.remainingKt, remainingCapacity);
    shipment.remainingKt = round(shipment.remainingKt - moved);
    remainingCapacity = round(remainingCapacity - moved);
    unloaded = round(unloaded + moved);
    if (shipment.remainingKt <= 1e-6) {
      shipment.remainingKt = 0;
      shipment.status = "unloaded";
      updateAction(
        state,
        actionChanges,
        shipment.actionId,
        "completed",
        turn,
        "The contracted cargo has cleared the port and entered national stocks.",
      );
    } else {
      shipment.status = "queued-at-port";
    }
  }
  return unloaded;
}

function distributeRailGrain(
  state: WorldState,
  quantityKt: number,
  shares: Record<RegionId, number>,
): Record<RegionId, number> {
  const delivered = { capital: 0, north: 0, interior: 0 };
  if (quantityKt <= 1e-9) return delivered;
  const shareTotal = REGION_IDS.reduce(
    (total, region) => total + shares[region],
    0,
  );
  let assigned = 0;
  REGION_IDS.forEach((region, index) => {
    const amount =
      index === REGION_IDS.length - 1
        ? round(quantityKt - assigned)
        : round(quantityKt * (shares[region] / shareTotal));
    delivered[region] = Math.max(0, amount);
    assigned = round(assigned + delivered[region]);
    state.regions[region].grainKt = round(
      state.regions[region].grainKt + delivered[region],
    );
  });
  return delivered;
}

function releaseReports(
  state: WorldState,
  turn: number,
  reports: ObservationReport[],
): void {
  const asOfTurn = Math.max(0, turn - 1);
  const truth =
    state.truthHistory.find((item) => item.turn === asOfTurn) ??
    state.truthHistory[state.truthHistory.length - 1];

  const regionalValues: Record<string, number> = {};
  for (const region of REGION_IDS) {
    regionalValues[region] = round(
      truth.regionalGrainKt[region] *
        (1 + state.variant.regularReportBias[region]),
      3,
    );
    state.regions[region].reportedGrainKt = regionalValues[region];
  }
  const regionalReport: ObservationReport = {
    id: `report:regional-stock:regular:${turn}`,
    kind: "regional-stock",
    title: "Weekly regional stock returns",
    source: "Provincial supply offices",
    eventTurn: asOfTurn,
    asOfTurn,
    publishedTurn: turn,
    status: "preliminary",
    revisesReportId: null,
    values: regionalValues,
    methodology: "One-week-lagged administrative returns; unaudited regions retain known bias.",
    confidence: "medium",
  };
  reports.push(regionalReport);

  const cropKnown = turn > state.variant.cropRevisionTurn;
  const cropValue = cropKnown ? truth.domesticGrainOutputKt : 3;
  state.observations.reportedDomesticOutputKt = cropValue;
  reports.push({
    id: `report:crop:regular:${turn}`,
    kind: "crop",
    title: "Weekly domestic grain estimate",
    source: "Agricultural Statistics Office",
    eventTurn: asOfTurn,
    asOfTurn,
    publishedTurn: turn,
    status: cropKnown ? "final" : "preliminary",
    revisesReportId: null,
    values: { weeklyOutputKt: cropValue },
    methodology: "Published with a one-week lag from field and mill returns.",
    confidence: cropKnown ? "high" : "medium",
  });

  if (turn === state.variant.cropRevisionTurn) {
    reports.push({
      id: `report:crop:revision:${turn}`,
      kind: "crop",
      title: "Revised crop assessment",
      source: "Agricultural Statistics Office",
      eventTurn: asOfTurn,
      asOfTurn,
      publishedTurn: turn,
      status: "revised",
      revisesReportId: `report:crop:regular:${turn}`,
      values: { weeklyOutputKt: truth.domesticGrainOutputKt },
      methodology: "Completed field returns replace the preliminary cyclone estimate.",
      confidence: "high",
    });
    state.observations.reportedDomesticOutputKt = truth.domesticGrainOutputKt;
  }

  if (turn === state.variant.stockRevisionTurn) {
    const region = state.variant.stockRevisionRegion;
    reports.push({
      id: `report:regional-stock:revision:${turn}:${region}`,
      kind: "regional-stock",
      title: `${state.regions[region].label} corrected return`,
      source: "Provincial supply office audit desk",
      eventTurn: asOfTurn,
      asOfTurn,
      publishedTurn: turn,
      status: "revised",
      revisesReportId: regionalReport.id,
      values: { region, grainKt: truth.regionalGrainKt[region] },
      methodology: "Depot-level reconciliation replaces the preliminary return.",
      confidence: "high",
    });
    state.regions[region].reportedGrainKt = truth.regionalGrainKt[region];
  }
  // A commissioned audit is a precise point-in-time observation, not a
  // permanent telemetry upgrade. Make it the latest estimate for this turn.
  for (const report of reports) {
    if (!report.id.startsWith("report:audit:")) continue;
    if (typeof report.values.region === "string") {
      const region = report.values.region as RegionId;
      if (typeof report.values.grainKt === "number") {
        state.regions[region].reportedGrainKt = report.values.grainKt;
      }
    }
    if (
      report.values.auditKind === "crop" &&
      typeof report.values.weeklyOutputKt === "number"
    ) {
      state.observations.reportedDomesticOutputKt =
        report.values.weeklyOutputKt;
    }
  }
  state.observations.lastReportedTurn = turn;
}

function invariant(
  id: string,
  ok: boolean,
  message: string,
  expected: number | null = null,
  actual: number | null = null,
): InvariantCheck {
  return { id, ok, message, expected, actual };
}

interface FlowAccounting {
  oldGrainKt: number;
  oldDieselKt: number;
  oldCopperKt: number;
  domesticGrainKt: number;
  domesticDieselKt: number;
  importedGrainKt: number;
  importedDieselKt: number;
  grainConsumedKt: number;
  dieselUsedKt: number;
  copperProducedKt: number;
  copperExportedKt: number;
  openingFxCents: number;
  ledgerStartIndex: number;
}

function checkInvariants(state: WorldState, flow: FlowAccounting): InvariantCheck[] {
  const tolerance = 1e-5;
  const expectedGrain = round(
    flow.oldGrainKt +
      flow.domesticGrainKt +
      flow.importedGrainKt -
      flow.grainConsumedKt,
  );
  const expectedDiesel = round(
    flow.oldDieselKt +
      flow.domesticDieselKt +
      flow.importedDieselKt -
      flow.dieselUsedKt,
  );
  const expectedCopper = round(
    flow.oldCopperKt + flow.copperProducedKt - flow.copperExportedKt,
  );
  const currentEntries = state.finance.ledger.slice(flow.ledgerStartIndex);
  const expectedFx =
    flow.openingFxCents +
    currentEntries.reduce((total, entry) => total + entry.cashDeltaCents, 0);
  const expectedLiabilities = state.finance.ledger.reduce(
    (total, entry) => total + entry.liabilityDeltaCents,
    0,
  );
  const actualLiabilities =
    state.finance.creditPrincipalCents +
    state.finance.contractAdvanceLiabilityCents +
    state.finance.arrearsCents;
  const numericValues = [
    state.grainCentralKt,
    state.dieselKt,
    state.copperAtPortKt,
    state.repairProgressPct,
    state.finance.fxCents,
    ...REGION_IDS.map((region) => state.regions[region].grainKt),
    ...state.shipments.map((shipment) => shipment.remainingKt),
  ];

  return [
    invariant(
      "stock:grain-conservation",
      Math.abs(trueTotalGrainKt(state) - expectedGrain) <= tolerance,
      "Opening grain plus production and unloading minus consumption equals closing grain.",
      expectedGrain,
      trueTotalGrainKt(state),
    ),
    invariant(
      "stock:diesel-conservation",
      Math.abs(state.dieselKt - expectedDiesel) <= tolerance,
      "Opening diesel plus supply and unloading minus recorded uses equals closing diesel.",
      expectedDiesel,
      state.dieselKt,
    ),
    invariant(
      "stock:copper-conservation",
      Math.abs(state.copperAtPortKt - expectedCopper) <= tolerance,
      "Opening copper plus mine output minus exports equals closing copper.",
      expectedCopper,
      state.copperAtPortKt,
    ),
    invariant(
      "ledger:cash-reconciliation",
      state.finance.fxCents === expectedFx,
      "Every cash movement is represented by a ledger entry.",
      expectedFx,
      state.finance.fxCents,
    ),
    invariant(
      "ledger:liability-reconciliation",
      actualLiabilities === expectedLiabilities,
      "Credit principal and unpaid settlements reconcile to recorded liability changes.",
      expectedLiabilities,
      actualLiabilities,
    ),
    invariant(
      "bounds:non-negative",
      numericValues.every((value) => value >= -tolerance),
      "Stocks, pipeline quantities, capacity, progress, and cash remain non-negative.",
    ),
    invariant(
      "numeric:finite",
      numericValues.every(Number.isFinite),
      "No model value is NaN or infinite.",
    ),
    invariant(
      "pipeline:bounded",
      state.shipments.every(
        (shipment) =>
          shipment.remainingKt >= -tolerance &&
          shipment.remainingKt <= shipment.quantityKt + tolerance,
      ),
      "Shipment remaining quantities stay between zero and their contracted quantities.",
    ),
    invariant(
      "trace:headline-complete",
      ["grain.totalKt", "diesel.stockKt", "copper.stockKt", "finance.fxCents"].every(
        (target) => state.lastTrace.some((entry) => entry.target === target),
      ),
      "Every headline stock has a causal contribution trace.",
    ),
  ];
}

export function stepWorld(
  inputState: WorldState,
  decision: DecisionPackage,
): StepResult {
  const validation = validateDecision(inputState, decision);
  if (!validation.valid) throw new DecisionValidationError(validation);

  const state = cloneJson(inputState);
  const turn = state.turn + 1;
  const events: SimulationEvent[] = [];
  const reports: ObservationReport[] = [];
  const actionChanges: ActionStatus[] = [];
  const trace: Contribution[] = [];
  const bindings: BindingRecord[] = [];
  const ledgerStartIndex = state.finance.ledger.length;
  const oldGrainKt = trueTotalGrainKt(state);
  const oldDieselKt = state.dieselKt;
  const oldCopperKt = state.copperAtPortKt;
  const openingFxCents = state.finance.fxCents;
  let traceIndex = 0;

  state.turn = turn;
  state.simulatedDate = addWeeks(state.simulatedDate, 1);
  state.portCapacityKt = portCapacityForRepair(state.repairProgressPct);
  applyOpeningMilestones(state, turn, reports, actionChanges);
  enactFinancialAndQueuedActions(state, decision, turn, actionChanges);

  const claimedTeams = decisionAdminClaims(inputState, decision);
  bindings.push(
    binding(
      turn,
      "implementation-teams",
      validation.preview.adminTeamsAlreadyCommitted + claimedTeams,
      state.implementationTeamsTotal,
      validation.preview.adminTeamsAlreadyCommitted + claimedTeams,
      "teams",
      "implementation-teams",
      "Procurement, policy changes, repair, audits, and credit draw on six shared teams.",
    ),
  );
  if (
    validation.preview.adminTeamsAlreadyCommitted + claimedTeams >=
    state.implementationTeamsTotal
  ) {
    state.metrics.implementationOverloadTurns += 1;
  }

  const portClosed = releaseExogenousEvents(state, turn, events);
  arriveShipments(state, turn, actionChanges);
  const effectivePortCapacity = portClosed ? 0 : state.portCapacityKt;
  const scheduleScale =
    state.portCapacityKt > 0 ? effectivePortCapacity / state.portCapacityKt : 0;
  const grainPortAllocation = decision.portSchedule.grainImportsKt * scheduleScale;
  const dieselPortAllocation = decision.portSchedule.dieselImportsKt * scheduleScale;
  const copperPortAllocation = decision.portSchedule.copperExportsKt * scheduleScale;
  const repairPortAllocation = decision.portSchedule.repairEquipmentKt * scheduleScale;

  const grainQueue = state.shipments
    .filter(
      (shipment) =>
        shipment.cargo === "grain" &&
        shipment.arrivalTurn <= turn &&
        shipment.remainingKt > 0,
    )
    .reduce((total, shipment) => total + shipment.remainingKt, 0);
  const dieselQueue = state.shipments
    .filter(
      (shipment) =>
        shipment.cargo === "diesel" &&
        shipment.arrivalTurn <= turn &&
        shipment.remainingKt > 0,
    )
    .reduce((total, shipment) => total + shipment.remainingKt, 0);
  const importedGrainKt = unloadCargo(
    state,
    turn,
    "grain",
    grainPortAllocation,
    actionChanges,
  );
  const importedDieselKt = unloadCargo(
    state,
    turn,
    "diesel",
    dieselPortAllocation,
    actionChanges,
  );
  state.grainCentralKt = round(state.grainCentralKt + importedGrainKt);
  state.dieselKt = round(state.dieselKt + importedDieselKt);
  bindings.push(
    binding(
      turn,
      "port-grain",
      grainQueue,
      grainPortAllocation,
      importedGrainKt,
      "kt",
      "port",
      portClosed ? "Weather closed the port." : "The grain berth allocation limited unloading.",
    ),
    binding(
      turn,
      "port-diesel",
      dieselQueue,
      dieselPortAllocation,
      importedDieselKt,
      "kt",
      "port",
      portClosed ? "Weather closed the port." : "The diesel berth allocation limited unloading.",
    ),
  );

  state.grainCentralKt = round(
    state.grainCentralKt + state.domesticGrainOutputKt,
  );
  state.dieselKt = round(state.dieselKt + state.domesticDieselSupplyKt);

  const essentialDieselUsed = Math.min(
    state.dieselKt,
    DIESEL_ESSENTIAL_REQUIREMENT_KT,
  );
  const essentialDieselLoss = round(
    DIESEL_ESSENTIAL_REQUIREMENT_KT - essentialDieselUsed,
  );
  state.dieselKt = round(state.dieselKt - essentialDieselUsed);
  state.metrics.essentialDieselServiceLossKt = round(
    state.metrics.essentialDieselServiceLossKt + essentialDieselLoss,
  );

  const requestedTruckKt =
    decision.railAndTruck.truckRegion === "none"
      ? 0
      : decision.railAndTruck.truckGrainKt;
  const truckKt = round(
    Math.min(
      requestedTruckKt,
      state.truckCapacityKt,
      state.grainCentralKt,
      state.dieselKt / DIESEL_PER_TRUCKED_GRAIN_KT,
    ),
  );
  const truckDieselKt = round(truckKt * DIESEL_PER_TRUCKED_GRAIN_KT);
  state.dieselKt = round(state.dieselKt - truckDieselKt);
  state.grainCentralKt = round(state.grainCentralKt - truckKt);
  if (truckKt > 0 && decision.railAndTruck.truckRegion !== "none") {
    const region = decision.railAndTruck.truckRegion;
    state.regions[region].grainKt = round(state.regions[region].grainKt + truckKt);
    state.metrics.emergencyActionCount += 1;
  }
  bindings.push(
    binding(
      turn,
      "emergency-trucking",
      requestedTruckKt,
      Math.min(
        state.truckCapacityKt,
        state.grainCentralKt + truckKt,
        (state.dieselKt + truckDieselKt) / DIESEL_PER_TRUCKED_GRAIN_KT,
      ),
      truckKt,
      "kt",
      truckKt + 1e-6 < requestedTruckKt
        ? state.dieselKt < DIESEL_PER_TRUCKED_GRAIN_KT
          ? "diesel"
          : "grain-stock"
        : "none",
      "Emergency trucking is limited by truck capacity, central grain, and diesel.",
    ),
  );

  const requestedRailGrain = decision.railAndTruck.railGrainKt;
  const railGrainKt = round(
    Math.min(
      requestedRailGrain,
      state.grainCentralKt,
      state.dieselKt / DIESEL_PER_RAIL_GRAIN_KT,
    ),
  );
  const railDieselKt = round(railGrainKt * DIESEL_PER_RAIL_GRAIN_KT);
  state.dieselKt = round(state.dieselKt - railDieselKt);
  state.grainCentralKt = round(state.grainCentralKt - railGrainKt);
  distributeRailGrain(
    state,
    railGrainKt,
    decision.railAndTruck.grainSharesPct,
  );
  bindings.push(
    binding(
      turn,
      "rail-grain",
      requestedRailGrain,
      Math.min(
        state.railCapacityKt,
        state.grainCentralKt + railGrainKt,
        (state.dieselKt + railDieselKt) / DIESEL_PER_RAIL_GRAIN_KT,
      ),
      railGrainKt,
      "kt",
      railGrainKt + 1e-6 < requestedRailGrain
        ? state.grainCentralKt <= 1e-6
          ? "grain-stock"
          : "diesel"
        : "none",
      "Rail grain movements require central inventory and traction diesel.",
    ),
  );

  const repairPlan = REPAIR_ASSUMPTIONS[decision.repairIntensity];
  const repairEquipmentFactor =
    repairPlan.equipmentKt > 0
      ? Math.min(1, repairPortAllocation / repairPlan.equipmentKt)
      : 1;
  const repairDieselUsed =
    repairPlan.dieselKt > 0
      ? Math.min(state.dieselKt, repairPlan.dieselKt * repairEquipmentFactor)
      : 0;
  state.dieselKt = round(state.dieselKt - repairDieselUsed);
  const repairDieselFactor =
    repairPlan.dieselKt > 0
      ? repairDieselUsed / repairPlan.dieselKt
      : 1;
  const repairProgress = round(
    repairPlan.progressPct *
      Math.min(repairEquipmentFactor, repairDieselFactor) *
      state.variant.repairEfficiency,
    3,
  );
  state.repairProgressPct = round(
    Math.min(100, state.repairProgressPct + repairProgress),
    3,
  );
  if (decision.repairIntensity !== "none") {
    const repairId = actionId(turn, "repairIntensity");
    updateAction(
      state,
      actionChanges,
      repairId,
      "completed",
      turn,
      repairProgress + 1e-6 >= repairPlan.progressPct * state.variant.repairEfficiency
        ? `Repair advanced ${repairProgress} percentage points.`
        : `Repair advanced only ${repairProgress} points because equipment or diesel was short.`,
    );
  }
  bindings.push(
    binding(
      turn,
      "repair-equipment",
      repairPlan.equipmentKt,
      repairPortAllocation,
      Math.min(repairPlan.equipmentKt, repairPortAllocation),
      "kt",
      "repair-equipment",
      "Repair progress requires both its planned berth allocation and diesel.",
    ),
  );

  const requestedCopper = decision.copperPlan.mineTargetKt;
  const copperProducedKt = round(
    Math.min(
      requestedCopper,
      decision.railAndTruck.railCopperKt,
      state.dieselKt / DIESEL_PER_COPPER_KT,
    ),
  );
  const copperDieselKt = round(copperProducedKt * DIESEL_PER_COPPER_KT);
  state.dieselKt = round(state.dieselKt - copperDieselKt);
  state.copperAtPortKt = round(state.copperAtPortKt + copperProducedKt);
  bindings.push(
    binding(
      turn,
      "copper-production",
      requestedCopper,
      Math.min(
        decision.railAndTruck.railCopperKt,
        (state.dieselKt + copperDieselKt) / DIESEL_PER_COPPER_KT,
      ),
      copperProducedKt,
      "kt",
      copperProducedKt + 1e-6 < requestedCopper
        ? decision.railAndTruck.railCopperKt < requestedCopper
          ? "rail"
          : "diesel"
        : "none",
      "Mine output must receive both rail allocation and diesel.",
    ),
  );

  const requestedCopperExport = Math.min(
    decision.portSchedule.copperExportsKt,
    state.copperAtPortKt,
  );
  const copperExportedKt = round(
    Math.min(requestedCopperExport, copperPortAllocation),
  );
  state.copperAtPortKt = round(state.copperAtPortKt - copperExportedKt);
  let advanceCargoKt = 0;
  if (state.earlyPaymentObligation) {
    advanceCargoKt = Math.min(
      copperExportedKt,
      state.earlyPaymentObligation.remainingKt,
    );
    state.earlyPaymentObligation.remainingKt = round(
      state.earlyPaymentObligation.remainingKt - advanceCargoKt,
    );
    if (advanceCargoKt > 0) {
      const releasedLiability =
        state.earlyPaymentObligation.remainingKt <= 1e-6
          ? state.finance.contractAdvanceLiabilityCents
          : Math.round(
              (state.earlyPaymentObligation.advanceCents /
                state.earlyPaymentObligation.originalKt) *
                advanceCargoKt,
            );
      state.finance.contractAdvanceLiabilityCents -= releasedLiability;
      postLedger(
        state,
        turn,
        "early-payment",
        `Recognize ${advanceCargoKt} kt against the prepaid copper cargo`,
        0,
        -releasedLiability,
        actionId(
          state.earlyPaymentObligation.acceptedTurn,
          "copperPlan",
          "early-payment",
        ),
        null,
      );
    }
  }
  const paidCopperKt = round(copperExportedKt - advanceCargoKt);
  if (paidCopperKt > 0) {
    postLedger(
      state,
      turn,
      "copper-exports",
      `${paidCopperKt} kt copper export receipts`,
      Math.round(paidCopperKt * COPPER_RECEIPT_CENTS_PER_KT),
      0,
      actionId(turn, "copperPlan"),
      null,
    );
  }
  bindings.push(
    binding(
      turn,
      "port-copper",
      requestedCopperExport,
      copperPortAllocation,
      copperExportedKt,
      "kt",
      "port",
      portClosed ? "Weather closed the port." : "The copper loading allocation limited exports.",
    ),
  );

  let totalConsumedKt = 0;
  let weeklyShortfallKt = 0;
  let weeklyPolicyAdjustedDemandKt = 0;
  for (const region of REGION_IDS) {
    const regional = state.regions[region];
    const multiplier =
      regional.activeRation === "moderate"
        ? 0.9
        : regional.activeRation === "severe"
          ? 0.78
          : 1;
    const demand = round(regional.weeklyDemandKt * multiplier);
    const consumed = round(Math.min(regional.grainKt, demand));
    const shortfall = round(demand - consumed);
    regional.grainKt = round(regional.grainKt - consumed);
    regional.cumulativeShortfallKt = round(
      regional.cumulativeShortfallKt + shortfall,
    );
    const rationHardship =
      regional.activeRation === "moderate"
        ? 0.5
        : regional.activeRation === "severe"
          ? 1.5
          : 0;
    regional.hardshipPoints = round(
      regional.hardshipPoints + rationHardship + shortfall * 2,
    );
    totalConsumedKt = round(totalConsumedKt + consumed);
    weeklyShortfallKt = round(weeklyShortfallKt + shortfall);
    weeklyPolicyAdjustedDemandKt = round(
      weeklyPolicyAdjustedDemandKt + demand,
    );
  }
  state.metrics.foodShortfallKt = round(
    state.metrics.foodShortfallKt + weeklyShortfallKt,
  );
  const weeklyFoodShortfallDays =
    weeklyPolicyAdjustedDemandKt > 0
      ? round((7 * weeklyShortfallKt) / weeklyPolicyAdjustedDemandKt)
      : 0;
  state.metrics.foodShortfallDays = round(
    state.metrics.foodShortfallDays + weeklyFoodShortfallDays,
  );
  state.metrics.hardshipPoints = round(
    REGION_IDS.reduce(
      (total, region) => total + state.regions[region].hardshipPoints,
      0,
    ),
  );

  if (
    state.earlyPaymentObligation &&
    state.earlyPaymentObligation.remainingKt <= 1e-6
  ) {
    updateAction(
      state,
      actionChanges,
      actionId(state.earlyPaymentObligation.acceptedTurn, "copperPlan", "early-payment"),
      "completed",
      turn,
      "The advanced copper cargo was delivered in full.",
    );
    state.earlyPaymentObligation = null;
  } else if (
    state.earlyPaymentObligation &&
    turn >= state.earlyPaymentObligation.dueTurn
  ) {
    const unearnedAdvanceCents =
      state.finance.contractAdvanceLiabilityCents;
    const penaltyEvent = event(
      turn,
      "contract-penalty",
      "Early-payment cargo missed its deadline",
      "The buyer assessed a penalty on the undelivered advanced copper cargo.",
      "critical",
      ["finance.fx", "contracts.copper"],
    );
    events.push(penaltyEvent);
    postLedger(
      state,
      turn,
      "contract-penalty",
      "Clawback of the unearned copper advance plus default penalty",
      -(unearnedAdvanceCents + EARLY_PAYMENT_PENALTY_CENTS),
      -unearnedAdvanceCents,
      actionId(
        state.earlyPaymentObligation.acceptedTurn,
        "copperPlan",
        "early-payment",
      ),
      penaltyEvent.id,
    );
    state.finance.contractAdvanceLiabilityCents = 0;
    state.finance.contractualPenaltiesCents += EARLY_PAYMENT_PENALTY_CENTS;
    state.metrics.contractualPenaltiesCents =
      state.finance.contractualPenaltiesCents;
    updateAction(
      state,
      actionChanges,
      actionId(state.earlyPaymentObligation.acceptedTurn, "copperPlan", "early-payment"),
      "failed",
      turn,
      "The delivery deadline was missed and a contractual penalty was paid or accrued.",
    );
    state.earlyPaymentObligation = null;
  }

  if (state.finance.creditPrincipalCents > 0) {
    const interest = Math.round(
      state.finance.creditPrincipalCents * WEEKLY_CREDIT_INTEREST_RATE,
    );
    postLedger(
      state,
      turn,
      "credit-interest",
      "Weekly emergency-credit interest",
      -interest,
      0,
      null,
      null,
    );
  }

  if (
    state.earlyPaymentOffer.status === "available" &&
    turn >= state.earlyPaymentOffer.availableUntilTurn
  ) {
    state.earlyPaymentOffer.status = "expired";
    events.push(
      event(
        turn,
        "offer-expired",
        "Copper advance offer expired",
        "The buyer withdrew the unaccepted early-payment offer.",
        "info",
        ["finance.fx"],
      ),
    );
  }

  addAction(
    state,
    actionChanges,
    actionId(turn, "portSchedule"),
    "portSchedule",
    ACTION_LABELS.portSchedule,
    "completed",
    turn,
    turn,
    portClosed ? "The committed schedule was blocked by closure." : "The weekly berth plan was executed.",
  );
  addAction(
    state,
    actionChanges,
    actionId(turn, "railAndTruck"),
    "railAndTruck",
    ACTION_LABELS.railAndTruck,
    "completed",
    turn,
    turn,
    "The weekly freight allocation was executed subject to stocks and diesel.",
  );
  addAction(
    state,
    actionChanges,
    actionId(turn, "copperPlan"),
    "copperPlan",
    ACTION_LABELS.copperPlan,
    "completed",
    turn,
    turn,
    "The mine and export plan was executed subject to rail, diesel, and port capacity.",
  );

  const ledgerEntries = state.finance.ledger.slice(ledgerStartIndex);
  trace.push(
    contribution(
      turn,
      ++traceIndex,
      "grain.totalKt",
      "domestic-production",
      state.domesticGrainOutputKt,
      "kt",
      "none",
      "Domestic grain entered the national stock.",
      [],
      [],
      ["grain.domestic-output"],
    ),
    contribution(
      turn,
      ++traceIndex,
      "grain.totalKt",
      "import-unloading",
      importedGrainKt,
      "kt",
      grainQueue > grainPortAllocation ? "port" : "none",
      "Arrived grain became usable only after unloading.",
      [actionId(turn, "portSchedule")],
      portClosed ? [`event:${turn}:port-closure`] : [],
      ["pipelines.grain", "capacity.port"],
    ),
    contribution(
      turn,
      ++traceIndex,
      "grain.totalKt",
      "regional-consumption",
      -totalConsumedKt,
      "kt",
      weeklyShortfallKt > 0 ? "regional-stock" : "none",
      "Regional households and essential institutions consumed available grain.",
      [],
      [],
      REGION_IDS.map((region) => `grain.region.${region}`),
    ),
    contribution(
      turn,
      ++traceIndex,
      "metrics.foodShortfallDays",
      "unmet-regional-food-service",
      weeklyFoodShortfallDays,
      "days",
      weeklyShortfallKt > 0 ? "regional-stock" : "none",
      `Equivalent service days = 7 × ${weeklyShortfallKt} kt unmet ÷ ${weeklyPolicyAdjustedDemandKt} kt policy-adjusted weekly demand.`,
      [],
      [],
      REGION_IDS.map((region) => `grain.region.${region}`),
    ),
    contribution(
      turn,
      ++traceIndex,
      "diesel.stockKt",
      "domestic-supply",
      state.domesticDieselSupplyKt,
      "kt",
      "none",
      "Domestic refining added its fixed weekly supply.",
    ),
    contribution(
      turn,
      ++traceIndex,
      "diesel.stockKt",
      "import-unloading",
      importedDieselKt,
      "kt",
      dieselQueue > dieselPortAllocation ? "port" : "none",
      "Arrived diesel entered stock after port handling.",
    ),
  );
  const dieselUsedKt = round(
    essentialDieselUsed +
      truckDieselKt +
      railDieselKt +
      repairDieselUsed +
      copperDieselKt,
  );
  trace.push(
    contribution(
      turn,
      ++traceIndex,
      "diesel.stockKt",
      "operational-use",
      -dieselUsedKt,
      "kt",
      essentialDieselLoss > 0 ? "diesel" : "none",
      `Essential services ${essentialDieselUsed} kt; trucking ${truckDieselKt}; rail ${railDieselKt}; repair ${round(repairDieselUsed)}; mine ${copperDieselKt}.`,
      [actionId(turn, "railAndTruck"), actionId(turn, "copperPlan")],
      [],
      ["diesel.stock", "transport.activity", "repair.intensity", "mine.output"],
    ),
    contribution(
      turn,
      ++traceIndex,
      "copper.stockKt",
      "mine-output",
      copperProducedKt,
      "kt",
      copperProducedKt < requestedCopper
        ? decision.railAndTruck.railCopperKt < requestedCopper
          ? "rail"
          : "diesel"
        : "none",
      "Mine output reached the port through the allocated rail path.",
      [actionId(turn, "copperPlan"), actionId(turn, "railAndTruck")],
    ),
    contribution(
      turn,
      ++traceIndex,
      "copper.stockKt",
      "exports",
      -copperExportedKt,
      "kt",
      requestedCopperExport > copperPortAllocation ? "port" : "none",
      "Copper loaded through the allocated export berth.",
      [actionId(turn, "portSchedule")],
    ),
    contribution(
      turn,
      ++traceIndex,
      "repair.progressPct",
      "port-repair",
      repairProgress,
      "percentage-points",
      repairProgress + 1e-6 <
      repairPlan.progressPct * state.variant.repairEfficiency
        ? "repair-equipment"
        : "none",
      "Repair progress reflects intensity, equipment handling, diesel, and true site efficiency.",
      decision.repairIntensity === "none"
        ? []
        : [actionId(turn, "repairIntensity")],
    ),
  );
  for (const entry of ledgerEntries) {
    trace.push(
      contribution(
        turn,
        ++traceIndex,
        "finance.fxCents",
        entry.account,
        entry.cashDeltaCents,
        "usd-cents",
        state.finance.fxCents < state.finance.emergencyFloorCents
          ? "foreign-exchange"
          : "none",
        entry.description,
        entry.relatedActionId ? [entry.relatedActionId] : [],
        entry.relatedEventId ? [entry.relatedEventId] : [],
        ["finance.fx"],
      ),
    );
  }
  if (!trace.some((entry) => entry.target === "finance.fxCents")) {
    trace.push(
      contribution(
        turn,
        ++traceIndex,
        "finance.fxCents",
        "no-cash-movement",
        0,
        "usd-cents",
        state.finance.fxCents < state.finance.emergencyFloorCents
          ? "foreign-exchange"
          : "none",
        "No contract, receipt, interest, or penalty changed cash this turn.",
      ),
    );
  }

  bindings.push(
    binding(
      turn,
      "foreign-exchange-floor",
      state.finance.emergencyFloorCents,
      state.finance.fxCents,
      state.finance.fxCents,
      "usd-cents",
      "foreign-exchange",
      "The mandate treats 10m USD as the emergency reserve floor.",
    ),
    binding(
      turn,
      "essential-diesel",
      DIESEL_ESSENTIAL_REQUIREMENT_KT,
      essentialDieselUsed,
      essentialDieselUsed,
      "kt",
      essentialDieselLoss > 0 ? "diesel" : "none",
      "Essential services receive first claim on diesel.",
    ),
  );

  state.truthHistory.push({
    turn,
    domesticGrainOutputKt: state.domesticGrainOutputKt,
    regionalGrainKt: {
      capital: state.regions.capital.grainKt,
      north: state.regions.north.grainKt,
      interior: state.regions.interior.grainKt,
    },
  } satisfies TruthRecord);
  releaseReports(state, turn, reports);
  state.observations.reports.push(...reports);
  state.events.push(...events);
  state.metrics.minimumFxCents = Math.min(
    state.metrics.minimumFxCents,
    state.finance.fxCents,
  );
  state.portCapacityKt = portCapacityForRepair(state.repairProgressPct);
  state.objectives = evaluateObjectives(state);
  state.complete = turn >= TOTAL_TURNS;
  state.lastTrace = trace;
  state.lastBindings = bindings;
  state.lastInvariants = [];
  const invariants = checkInvariants(state, {
    oldGrainKt,
    oldDieselKt,
    oldCopperKt,
    domesticGrainKt: state.domesticGrainOutputKt,
    domesticDieselKt: state.domesticDieselSupplyKt,
    importedGrainKt,
    importedDieselKt,
    grainConsumedKt: totalConsumedKt,
    dieselUsedKt,
    copperProducedKt,
    copperExportedKt,
    openingFxCents,
    ledgerStartIndex,
  });
  state.lastInvariants = invariants;

  const failed = invariants.filter((check) => !check.ok);
  if (failed.length > 0) {
    throw new Error(
      `Simulation invariant failure at turn ${turn}: ${failed
        .map((check) => check.id)
        .join(", ")}`,
    );
  }

  return {
    state,
    events,
    reports,
    actionStatusChanges: actionChanges,
    objectives: cloneJson(state.objectives),
    trace,
    bindingConstraints: bindings,
    invariants,
  };
}

export { createDefaultDecision };
