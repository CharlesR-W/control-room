import {
  ACTION_LABELS,
  ALL_ACTION_FAMILIES,
  COPPER_RECEIPT_CENTS_PER_KT,
  CREDIT_LIMIT_CENTS,
  DOMESTIC_DIESEL_SUPPLY_KT,
  EARLY_PAYMENT_ADVANCE_CENTS,
  FX_EMERGENCY_FLOOR_CENTS,
  FX_INITIAL_CENTS,
  GUIDED_UNLOCK_TURN,
  IMPORT_UNIT_COST_CENTS_PER_KT,
  INITIAL_REGION_GRAIN_KT,
  REGION_IDS,
  REGION_LABELS,
  REGION_WEEKLY_DEMAND_KT,
  REPAIR_ASSUMPTIONS,
  START_DATE,
  TOTAL_TURNS,
} from "./constants.ts";
import { createScenarioVariant, round, stableHash } from "./determinism.ts";
import type {
  ActionFamily,
  DecisionPackage,
  ObjectiveMeasure,
  ObservationReport,
  RegionId,
  ResourcePreview,
  SimulationMode,
  ValidationIssue,
  ValidationResult,
  WorldState,
} from "./types.ts";

export const MODEL_ASSUMPTIONS = {
  quantities: "Physical quantities are represented in kilotonnes and rounded to 6 decimals.",
  finance: "Financial values are integer USD cents; import contracts are paid on signing.",
  port:
    "Port allocations are hard weekly cargo caps. Unused allocation is not silently reassigned.",
  rail:
    "Rail allocations are hard weekly caps; grain is split by the player's regional percentages.",
  production:
    "Domestic grain appears at the central depot. Copper production requires rail and diesel.",
  repair:
    "Repair equipment is staged offshore but occupies the player's port allocation before use.",
  observations:
    "Regional returns and crop reports are delayed one turn and can be revised later.",
  foodShortfallDays:
    "Each turn adds 7 × unmet grain demand ÷ total policy-adjusted weekly grain demand, yielding national full-service-day equivalents.",
  actions:
    "Ration changes take one turn; weekly operating schedules otherwise apply in the committed turn.",
} as const;

export function importCostCents(decision: DecisionPackage["imports"]): number {
  return decision.reduce((total, order) => {
    if (!Object.hasOwn(IMPORT_UNIT_COST_CENTS_PER_KT, order.cargo)) return total;
    const table = IMPORT_UNIT_COST_CENTS_PER_KT[order.cargo];
    if (!Object.hasOwn(table, order.supplier)) return total;
    const unitCost = table[order.supplier];
    if (!Number.isFinite(order.quantityKt) || typeof unitCost !== "number") {
      return total;
    }
    return total + Math.round(order.quantityKt * unitCost);
  }, 0);
}

export function portCapacityForRepair(repairProgressPct: number): number {
  if (repairProgressPct >= 80) return 20;
  if (repairProgressPct >= 40) return 16;
  return 12;
}

export function trueTotalGrainKt(state: WorldState): number {
  return round(
    state.grainCentralKt +
      REGION_IDS.reduce((total, region) => total + state.regions[region].grainKt, 0),
  );
}

export function reportedTotalGrainKt(state: WorldState): number {
  return round(
    state.grainCentralKt +
      REGION_IDS.reduce(
        (total, region) => total + state.regions[region].reportedGrainKt,
        0,
      ),
  );
}

export function totalWeeklyDemandKt(state: WorldState): number {
  return round(
    REGION_IDS.reduce(
      (total, region) => total + state.regions[region].weeklyDemandKt,
      0,
    ),
  );
}

export function availableActionsForState(state: WorldState): ActionFamily[] {
  if (state.mode !== "guided") return [...ALL_ACTION_FAMILIES];
  return ALL_ACTION_FAMILIES.filter(
    (family) => state.turn >= GUIDED_UNLOCK_TURN[family],
  );
}

function initialRegionReport(
  seed: number,
  variant: ReturnType<typeof createScenarioVariant>,
): ObservationReport {
  const values: Record<string, number> = {};
  for (const region of REGION_IDS) {
    values[region] = round(
      INITIAL_REGION_GRAIN_KT[region] * (1 + variant.regularReportBias[region]),
      3,
    );
  }
  return {
    id: `report:regional-stock:opening:${seed}`,
    kind: "regional-stock",
    title: "Opening regional stock returns",
    source: "Provincial supply offices",
    eventTurn: 0,
    asOfTurn: 0,
    publishedTurn: 0,
    status: "preliminary",
    revisesReportId: null,
    values,
    methodology: "Unaudited depot returns compiled during cyclone recovery.",
    confidence: "low",
  };
}

function initialCropReport(seed: number): ObservationReport {
  return {
    id: `report:crop:opening:${seed}`,
    kind: "crop",
    title: "Opening domestic grain estimate",
    source: "Agricultural Statistics Office",
    eventTurn: 0,
    asOfTurn: 0,
    publishedTurn: 0,
    status: "preliminary",
    revisesReportId: null,
    values: { weeklyOutputKt: 3 },
    methodology: "Pre-cyclone weekly output estimate; field returns are incomplete.",
    confidence: "medium",
  };
}

export function evaluateObjectives(state: WorldState): ObjectiveMeasure[] {
  const foodShortfall = state.metrics.foodShortfallKt;
  const dieselLoss = state.metrics.essentialDieselServiceLossKt;
  const hardship = state.metrics.hardshipPoints;
  const minimumFx = state.metrics.minimumFxCents;
  const burden =
    hardship +
    state.finance.contractualPenaltiesCents / 100_000_000 +
    state.finance.creditPrincipalCents / 200_000_000 +
    state.finance.contractAdvanceLiabilityCents / 100_000_000 +
    state.finance.arrearsCents / 100_000_000;
  const grainWeeks = trueTotalGrainKt(state) / Math.max(0.01, totalWeeklyDemandKt(state));
  const dieselWeeks = state.dieselKt / 3;

  return [
    {
      id: "food-service",
      label: "Avoid severe regional food shortfalls",
      priority: 1,
      value: round(foodShortfall, 3),
      unit: "kt cumulative shortfall",
      status: foodShortfall > 2 ? "breached" : foodShortfall > 0.25 ? "at-risk" : "secure",
      hardConstraint: true,
    },
    {
      id: "diesel-service",
      label: "Preserve essential diesel services",
      priority: 2,
      value: round(dieselLoss, 3),
      unit: "kt service deficit",
      status: dieselLoss > 0.5 ? "breached" : dieselLoss > 0 ? "at-risk" : "secure",
      hardConstraint: true,
    },
    {
      id: "fx-floor",
      label: "Keep foreign-exchange reserves above the emergency floor",
      priority: 3,
      value: minimumFx,
      unit: "USD cents",
      status:
        minimumFx < state.finance.emergencyFloorCents
          ? "breached"
          : minimumFx < state.finance.emergencyFloorCents * 1.2
            ? "at-risk"
            : "secure",
      hardConstraint: true,
    },
    {
      id: "port-repair",
      label: "Restore port throughput",
      priority: 4,
      value: round(state.repairProgressPct, 2),
      unit: "percent",
      status:
        state.repairProgressPct >= 80
          ? "secure"
          : state.turn >= 9 && state.repairProgressPct < 40
            ? "breached"
            : "at-risk",
      hardConstraint: false,
    },
    {
      id: "hardship",
      label: "Limit hardship and contractual damage",
      priority: 5,
      value: round(burden, 3),
      unit: "burden index",
      status:
        burden > 24 ? "breached" : burden > 12 ? "at-risk" : "secure",
      hardConstraint: false,
    },
    {
      id: "resilience",
      label: "Finish with defensible reserves",
      priority: 6,
      value: round(Math.min(grainWeeks, dieselWeeks), 3),
      unit: "minimum weeks coverage",
      status:
        grainWeeks >= 2.5 &&
        dieselWeeks >= 2 &&
        state.finance.creditPrincipalCents === 0 &&
        state.finance.contractAdvanceLiabilityCents === 0 &&
        state.finance.arrearsCents === 0
          ? "secure"
          : grainWeeks < 1 || dieselWeeks < 0.75
            ? "breached"
            : "at-risk",
      hardConstraint: false,
    },
  ];
}

export function createInitialWorldState(seed: number, mode: SimulationMode): WorldState {
  const variant = createScenarioVariant(seed, mode);
  const openingRegionReport = initialRegionReport(seed, variant);
  const openingCropReport = initialCropReport(seed);

  const regions = Object.fromEntries(
    REGION_IDS.map((region) => {
      const reported = Number(openingRegionReport.values[region]);
      return [
        region,
        {
          id: region,
          label: REGION_LABELS[region],
          grainKt: INITIAL_REGION_GRAIN_KT[region],
          weeklyDemandKt: REGION_WEEKLY_DEMAND_KT[region],
          reportedGrainKt: reported,
          cumulativeShortfallKt: 0,
          hardshipPoints: 0,
          activeRation: "none" as const,
        },
      ];
    }),
  ) as WorldState["regions"];

  const domesticOutputKt = round(3 * variant.cropMultiplier, 3);
  const state: WorldState = {
    turn: 0,
    simulatedDate: START_DATE,
    complete: false,
    seed,
    mode,
    variant,
    grainCentralKt: 14,
    dieselKt: 10,
    copperAtPortKt: 4,
    domesticGrainOutputKt: domesticOutputKt,
    domesticDieselSupplyKt: DOMESTIC_DIESEL_SUPPLY_KT,
    regions,
    portCapacityKt: 12,
    railCapacityKt: 10,
    truckCapacityKt: 3,
    repairProgressPct: 0,
    implementationTeamsTotal: 6,
    shipments: [
      {
        id: "shipment:opening:grain:1",
        cargo: "grain",
        supplier: "opening-pipeline",
        orderedTurn: -2,
        arrivalTurn: 1,
        quantityKt: 5,
        remainingKt: 5,
        unitCostCentsPerKt: 0,
        status: "sailing",
        actionId: "opening-commitments",
      },
      {
        id: "shipment:opening:diesel:1",
        cargo: "diesel",
        supplier: "opening-pipeline",
        orderedTurn: -1,
        arrivalTurn: 2,
        quantityKt: 2.5,
        remainingKt: 2.5,
        unitCostCentsPerKt: 0,
        status: "sailing",
        actionId: "opening-commitments",
      },
      {
        id: "shipment:opening:grain:2",
        cargo: "grain",
        supplier: "opening-pipeline",
        orderedTurn: -1,
        arrivalTurn: 3,
        quantityKt: 4,
        remainingKt: 4,
        unitCostCentsPerKt: 0,
        status: "sailing",
        actionId: "opening-commitments",
      },
    ],
    pendingRationPolicy: null,
    earlyPaymentOffer: {
      status: "not-offered",
      offeredTurn: variant.earlyPaymentOfferTurn,
      availableUntilTurn: variant.earlyPaymentOfferTurn + 2,
    },
    earlyPaymentObligation: null,
    finance: {
      initialFxCents: FX_INITIAL_CENTS,
      fxCents: FX_INITIAL_CENTS,
      emergencyFloorCents: FX_EMERGENCY_FLOOR_CENTS,
      creditPrincipalCents: 0,
      creditLimitCents: CREDIT_LIMIT_CENTS,
      contractAdvanceLiabilityCents: 0,
      arrearsCents: 0,
      contractualPenaltiesCents: 0,
      ledger: [],
    },
    observations: {
      reports: [openingRegionReport, openingCropReport],
      pendingAudits: [],
      reportedDomesticOutputKt: 3,
      knownPortRepairEfficiency: null,
      lastReportedTurn: 0,
    },
    truthHistory: [
      {
        turn: 0,
        domesticGrainOutputKt: domesticOutputKt,
        regionalGrainKt: {
          capital: regions.capital.grainKt,
          north: regions.north.grainKt,
          interior: regions.interior.grainKt,
        },
      },
    ],
    actions: [],
    events: [],
    objectives: [],
    metrics: {
      foodShortfallKt: 0,
      foodShortfallDays: 0,
      essentialDieselServiceLossKt: 0,
      minimumFxCents: FX_INITIAL_CENTS,
      policyChurn: 0,
      emergencyActionCount: 0,
      implementationOverloadTurns: 0,
      informationActionsUsed: 0,
      contractualPenaltiesCents: 0,
      hardshipPoints: 0,
    },
    lastTrace: [],
    lastBindings: [],
    lastInvariants: [],
  };
  state.objectives = evaluateObjectives(state);
  return state;
}

export function createDefaultDecision(state: WorldState): DecisionPackage {
  const ration =
    state.pendingRationPolicy?.levels ??
    ({
      capital: state.regions.capital.activeRation,
      north: state.regions.north.activeRation,
      interior: state.regions.interior.activeRation,
    } satisfies Record<RegionId, "none" | "moderate" | "severe">);

  return {
    id: `decision:turn:${state.turn + 1}`,
    forTurn: state.turn + 1,
    imports: [],
    portSchedule: {
      grainImportsKt: 4,
      dieselImportsKt: 2,
      copperExportsKt: 4,
      repairEquipmentKt: 0,
    },
    railAndTruck: {
      railGrainKt: 6,
      railCopperKt: 4,
      grainSharesPct: {
        capital: 43,
        north: 36,
        interior: 21,
      },
      truckRegion: "none",
      truckGrainKt: 0,
    },
    rationPolicy: { ...ration },
    copperPlan: {
      mineTargetKt: 4,
      acceptEarlyPayment: false,
    },
    repairIntensity: "none",
    audit: "none",
    emergencyCreditUsdM: 0,
    forecasts: {
      grainCoverageWeeks: null,
      fxUsdM: null,
      bindingConstraint: null,
    },
    notes: "",
  };
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasDecisionRuntimeShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.forTurn !== "number" ||
    typeof value.repairIntensity !== "string" ||
    typeof value.audit !== "string" ||
    typeof value.emergencyCreditUsdM !== "number" ||
    typeof value.notes !== "string"
  ) {
    return false;
  }
  if (
    !Array.isArray(value.imports) ||
    !value.imports.every(
      (order) =>
        isRecord(order) &&
        typeof order.cargo === "string" &&
        typeof order.supplier === "string" &&
        typeof order.quantityKt === "number",
    )
  ) {
    return false;
  }
  if (!isRecord(value.portSchedule)) return false;
  if (
    typeof value.portSchedule.grainImportsKt !== "number" ||
    typeof value.portSchedule.dieselImportsKt !== "number" ||
    typeof value.portSchedule.copperExportsKt !== "number" ||
    typeof value.portSchedule.repairEquipmentKt !== "number"
  ) {
    return false;
  }
  if (!isRecord(value.railAndTruck)) return false;
  if (!isRecord(value.railAndTruck.grainSharesPct)) return false;
  if (
    typeof value.railAndTruck.railGrainKt !== "number" ||
    typeof value.railAndTruck.railCopperKt !== "number" ||
    typeof value.railAndTruck.truckRegion !== "string" ||
    typeof value.railAndTruck.truckGrainKt !== "number" ||
    typeof value.railAndTruck.grainSharesPct.capital !== "number" ||
    typeof value.railAndTruck.grainSharesPct.north !== "number" ||
    typeof value.railAndTruck.grainSharesPct.interior !== "number"
  ) {
    return false;
  }
  if (!isRecord(value.rationPolicy)) return false;
  if (
    typeof value.rationPolicy.capital !== "string" ||
    typeof value.rationPolicy.north !== "string" ||
    typeof value.rationPolicy.interior !== "string"
  ) {
    return false;
  }
  if (!isRecord(value.copperPlan)) return false;
  if (
    typeof value.copperPlan.mineTargetKt !== "number" ||
    typeof value.copperPlan.acceptEarlyPayment !== "boolean"
  ) {
    return false;
  }
  if (!isRecord(value.forecasts)) return false;
  if (
    !(
      value.forecasts.grainCoverageWeeks === null ||
      typeof value.forecasts.grainCoverageWeeks === "number"
    ) ||
    !(
      value.forecasts.fxUsdM === null ||
      typeof value.forecasts.fxUsdM === "number"
    ) ||
    !(
      value.forecasts.bindingConstraint === null ||
      typeof value.forecasts.bindingConstraint === "string"
    )
  ) {
    return false;
  }
  return true;
}

function malformedDecisionResult(state: WorldState): ValidationResult {
  return {
    valid: false,
    errors: [
      issue(
        "decision",
        "invalid-shape",
        "Decision package is missing one or more required action-family objects.",
      ),
    ],
    warnings: [],
    preview: {
      importCostCents: 0,
      repairCostCents: 0,
      availableFxCents: state.finance.fxCents,
      projectedFxAfterDirectCommitmentsCents: state.finance.fxCents,
      adminTeamsAlreadyCommitted: 0,
      adminTeamsClaimed: 0,
      adminTeamsAvailable: state.implementationTeamsTotal,
    },
  };
}

export function ongoingAdminClaimsForNextTurn(state: WorldState): number {
  const nextTurn = state.turn + 1;
  const audits = state.observations.pendingAudits.filter(
    (audit) => audit.completionTurn > nextTurn,
  ).length;
  const ration =
    state.pendingRationPolicy && state.pendingRationPolicy.effectiveTurn > nextTurn
      ? 1
      : 0;
  return audits + ration;
}

function rationTargetAtStartOfNextTurn(
  state: WorldState,
): DecisionPackage["rationPolicy"] {
  if (
    state.pendingRationPolicy &&
    state.pendingRationPolicy.effectiveTurn <= state.turn + 1
  ) {
    return state.pendingRationPolicy.levels;
  }
  return {
    capital: state.regions.capital.activeRation,
    north: state.regions.north.activeRation,
    interior: state.regions.interior.activeRation,
  };
}

export function decisionAdminClaims(state: WorldState, decision: DecisionPackage): number {
  let teams = 0;
  if (decision.imports.length > 0) teams += 1;
  if (decision.audit !== "none") teams += 1;
  if (decision.emergencyCreditUsdM > 0) teams += 1;
  teams += REPAIR_ASSUMPTIONS[decision.repairIntensity]?.teams ?? 0;

  const startPolicy = rationTargetAtStartOfNextTurn(state);
  if (stableHash(startPolicy) !== stableHash(decision.rationPolicy)) {
    teams += 1;
  }
  return teams;
}

export function validateDecision(
  state: WorldState,
  decision: DecisionPackage,
): ValidationResult {
  if (!hasDecisionRuntimeShape(decision)) {
    return malformedDecisionResult(state);
  }
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (state.complete || state.turn >= TOTAL_TURNS) {
    errors.push(issue("forTurn", "run-complete", "The twelve-turn run is complete."));
  }
  if (decision.forTurn !== state.turn + 1) {
    errors.push(
      issue(
        "forTurn",
        "wrong-turn",
        `Decision is for turn ${decision.forTurn}; expected ${state.turn + 1}.`,
      ),
    );
  }
  if (typeof decision.id !== "string" || decision.id.trim().length === 0) {
    errors.push(issue("id", "required", "Decision package must have an id."));
  }
  if (decision.imports.length > 4) {
    errors.push(issue("imports", "too-many-orders", "At most four import orders may be signed."));
  }
  decision.imports.forEach((order, index) => {
    if (!["grain", "diesel"].includes(order.cargo)) {
      errors.push(issue(`imports.${index}.cargo`, "invalid-enum", "Unknown import cargo."));
    }
    if (!["near-premium", "standard", "distant-discount"].includes(order.supplier)) {
      errors.push(
        issue(`imports.${index}.supplier`, "invalid-enum", "Unknown import supplier."),
      );
    }
    if (!finite(order.quantityKt) || order.quantityKt <= 0 || order.quantityKt > 20) {
      errors.push(
        issue(
          `imports.${index}.quantityKt`,
          "out-of-range",
          "Import quantity must be greater than 0 and no more than 20 kt.",
        ),
      );
    }
    if (
      finite(order.quantityKt) &&
      Math.abs(order.quantityKt * 10 - Math.round(order.quantityKt * 10)) > 1e-6
    ) {
      errors.push(
        issue(
          `imports.${index}.quantityKt`,
          "invalid-precision",
          "Import quantity must use increments of 0.1 kt.",
        ),
      );
    }
  });

  const portEntries = Object.entries(decision.portSchedule) as Array<[string, number]>;
  for (const [key, value] of portEntries) {
    if (!finite(value) || value < 0) {
      errors.push(issue(`portSchedule.${key}`, "out-of-range", "Port allocation cannot be negative."));
    } else if (Math.abs(value * 10 - Math.round(value * 10)) > 1e-6) {
      errors.push(
        issue(
          `portSchedule.${key}`,
          "invalid-precision",
          "Port allocations must use increments of 0.1 kt.",
        ),
      );
    }
  }
  const portTotal = portEntries.reduce((total, [, value]) => total + value, 0);
  if (portTotal > state.portCapacityKt + 1e-6) {
    errors.push(
      issue(
        "portSchedule",
        "capacity-exceeded",
        `Port allocations total ${round(portTotal, 2)} kt against ${state.portCapacityKt} kt capacity.`,
      ),
    );
  }

  const rail = decision.railAndTruck;
  if (
    !finite(rail.railGrainKt) ||
    !finite(rail.railCopperKt) ||
    rail.railGrainKt < 0 ||
    rail.railCopperKt < 0
  ) {
    errors.push(issue("railAndTruck", "out-of-range", "Rail allocations cannot be negative."));
  }
  if (
    [rail.railGrainKt, rail.railCopperKt].some(
      (value) =>
        finite(value) &&
        Math.abs(value * 10 - Math.round(value * 10)) > 1e-6,
    )
  ) {
    errors.push(
      issue(
        "railAndTruck",
        "invalid-precision",
        "Rail allocations must use increments of 0.1 kt.",
      ),
    );
  }
  if (rail.railGrainKt + rail.railCopperKt > state.railCapacityKt + 1e-6) {
    errors.push(
      issue(
        "railAndTruck",
        "capacity-exceeded",
        `Rail allocations exceed ${state.railCapacityKt} kt.`,
      ),
    );
  }
  const shares = REGION_IDS.map((region) => rail.grainSharesPct[region]);
  if (shares.some((value) => !finite(value) || value < 0 || value > 100)) {
    errors.push(
      issue(
        "railAndTruck.grainSharesPct",
        "out-of-range",
        "Regional grain shares must each be between 0 and 100.",
      ),
    );
  }
  if (
    shares.some(
      (value) =>
        finite(value) &&
        Math.abs(value * 100 - Math.round(value * 100)) > 1e-6,
    )
  ) {
    errors.push(
      issue(
        "railAndTruck.grainSharesPct",
        "invalid-precision",
        "Regional shares may use at most two decimal places.",
      ),
    );
  }
  if (
    rail.railGrainKt > 0 &&
    Math.abs(shares.reduce((total, value) => total + value, 0) - 100) > 1e-6
  ) {
    errors.push(
      issue(
        "railAndTruck.grainSharesPct",
        "shares-must-total-100",
        "Regional grain shares must total 100%.",
      ),
    );
  }
  if (!["capital", "north", "interior", "none"].includes(rail.truckRegion)) {
    errors.push(issue("railAndTruck.truckRegion", "invalid-enum", "Unknown truck destination."));
  }
  if (
    !finite(rail.truckGrainKt) ||
    rail.truckGrainKt < 0 ||
    rail.truckGrainKt > state.truckCapacityKt
  ) {
    errors.push(
      issue(
        "railAndTruck.truckGrainKt",
        "out-of-range",
        `Emergency trucking must be between 0 and ${state.truckCapacityKt} kt.`,
      ),
    );
  }
  if (
    finite(rail.truckGrainKt) &&
    Math.abs(rail.truckGrainKt * 10 - Math.round(rail.truckGrainKt * 10)) > 1e-6
  ) {
    errors.push(
      issue(
        "railAndTruck.truckGrainKt",
        "invalid-precision",
        "Truck allocations must use increments of 0.1 kt.",
      ),
    );
  }
  if (rail.truckGrainKt > 0 && rail.truckRegion === "none") {
    errors.push(
      issue(
        "railAndTruck.truckRegion",
        "destination-required",
        "Choose a destination for emergency trucking.",
      ),
    );
  }

  for (const region of REGION_IDS) {
    if (!["none", "moderate", "severe"].includes(decision.rationPolicy[region])) {
      errors.push(
        issue(`rationPolicy.${region}`, "invalid-enum", "Unknown ration level."),
      );
    }
  }
  if (
    !finite(decision.copperPlan.mineTargetKt) ||
    decision.copperPlan.mineTargetKt < 0 ||
    decision.copperPlan.mineTargetKt > 5
  ) {
    errors.push(
      issue(
        "copperPlan.mineTargetKt",
        "out-of-range",
        "Copper mine target must be between 0 and 5 kt.",
      ),
    );
  }
  if (
    finite(decision.copperPlan.mineTargetKt) &&
    Math.abs(
      decision.copperPlan.mineTargetKt * 10 -
        Math.round(decision.copperPlan.mineTargetKt * 10),
    ) >
      1e-6
  ) {
    errors.push(
      issue(
        "copperPlan.mineTargetKt",
        "invalid-precision",
        "The mine target must use increments of 0.1 kt.",
      ),
    );
  }
  if (
    decision.copperPlan.acceptEarlyPayment &&
    state.earlyPaymentOffer.status !== "available"
  ) {
    errors.push(
      issue(
        "copperPlan.acceptEarlyPayment",
        "offer-unavailable",
        "The early-payment contract is not currently available.",
      ),
    );
  }
  if (!Object.hasOwn(REPAIR_ASSUMPTIONS, decision.repairIntensity)) {
    errors.push(
      issue("repairIntensity", "invalid-enum", "Unknown port repair intensity."),
    );
  }
  if (
    ![
      "none",
      "capital-stock",
      "north-stock",
      "interior-stock",
      "crop",
      "port-damage",
    ].includes(decision.audit)
  ) {
    errors.push(issue("audit", "invalid-enum", "Unknown audit type."));
  }
  if (
    !finite(decision.emergencyCreditUsdM) ||
    decision.emergencyCreditUsdM < 0 ||
    decision.emergencyCreditUsdM > 4 ||
    Math.abs(decision.emergencyCreditUsdM * 2 - Math.round(decision.emergencyCreditUsdM * 2)) >
      1e-6
  ) {
    errors.push(
      issue(
        "emergencyCreditUsdM",
        "out-of-range",
        "Credit draw must be 0–4 million USD in 0.5m increments.",
      ),
    );
  }
  const creditDrawCents = Math.round(decision.emergencyCreditUsdM * 100_000_000);
  if (
    state.finance.creditPrincipalCents + creditDrawCents >
    state.finance.creditLimitCents
  ) {
    errors.push(
      issue(
        "emergencyCreditUsdM",
        "credit-limit",
        "The proposed draw exceeds the remaining emergency credit line.",
      ),
    );
  }

  const availableActions = availableActionsForState(state);
  if (state.mode === "guided") {
    const defaultDecision = createDefaultDecision(state);
    for (const family of ALL_ACTION_FAMILIES) {
      if (availableActions.includes(family)) continue;
      const actual =
        family === "emergencyCredit"
          ? decision.emergencyCreditUsdM
          : decision[family as keyof DecisionPackage];
      const expected =
        family === "emergencyCredit"
          ? defaultDecision.emergencyCreditUsdM
          : defaultDecision[family as keyof DecisionPackage];
      if (stableHash(actual) !== stableHash(expected)) {
        errors.push(
          issue(
            family,
            "guided-action-locked",
            `${ACTION_LABELS[family]} unlocks in a later guided phase.`,
          ),
        );
      }
    }
  }

  const ongoing = ongoingAdminClaimsForNextTurn(state);
  const claimed = decisionAdminClaims(state, decision);
  if (ongoing + claimed > state.implementationTeamsTotal) {
    errors.push(
      issue(
        "implementationTeams",
        "implementation-capacity",
        `${ongoing + claimed} implementation teams are claimed but only ${state.implementationTeamsTotal} exist.`,
      ),
    );
  }

  const imports = importCostCents(decision.imports);
  const repair = REPAIR_ASSUMPTIONS[decision.repairIntensity]?.costCents ?? 0;
  const offerAdvance =
    decision.copperPlan.acceptEarlyPayment &&
    state.earlyPaymentOffer.status === "available"
      ? EARLY_PAYMENT_ADVANCE_CENTS
      : 0;
  const availableFx = state.finance.fxCents + creditDrawCents + offerAdvance;
  const afterCommitments = availableFx - imports - repair;
  if (afterCommitments < 0) {
    errors.push(
      issue(
        "finance",
        "insufficient-fx",
        "Direct import and repair commitments exceed available foreign exchange.",
      ),
    );
  } else if (afterCommitments < state.finance.emergencyFloorCents) {
    warnings.push(
      issue(
        "finance",
        "fx-floor-risk",
        "Direct commitments take foreign exchange below the emergency floor.",
      ),
    );
  }

  if (decision.repairIntensity !== "none") {
    const needed = REPAIR_ASSUMPTIONS[decision.repairIntensity].equipmentKt;
    if (decision.portSchedule.repairEquipmentKt + 1e-6 < needed) {
      warnings.push(
        issue(
          "portSchedule.repairEquipmentKt",
          "repair-equipment-shortfall",
          `This repair intensity needs ${needed} kt of equipment for full progress.`,
        ),
      );
    }
  }
  if (
    decision.forecasts.grainCoverageWeeks === null ||
    decision.forecasts.fxUsdM === null ||
    decision.forecasts.bindingConstraint === null
  ) {
    warnings.push(
      issue(
        "forecasts",
        "forecast-incomplete",
        "Record the coverage, FX, and binding-constraint forecasts for a stronger debrief.",
      ),
    );
  }
  if (decision.notes.length > 4_000) {
    errors.push(issue("notes", "too-long", "Decision notes cannot exceed 4,000 characters."));
  }

  const preview: ResourcePreview = {
    importCostCents: imports,
    repairCostCents: repair,
    availableFxCents: availableFx,
    projectedFxAfterDirectCommitmentsCents: afterCommitments,
    adminTeamsAlreadyCommitted: ongoing,
    adminTeamsClaimed: claimed,
    adminTeamsAvailable: state.implementationTeamsTotal - ongoing,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    preview,
  };
}

export function copperReceiptCents(quantityKt: number): number {
  return Math.round(quantityKt * COPPER_RECEIPT_CENTS_PER_KT);
}
