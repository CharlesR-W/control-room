import type { SimulationMode } from "../../sim/types.ts";
import {
  clamp,
  cloneJson,
  decisionValue,
  normaliseSeed,
  round,
  seededRange,
} from "../helpers.ts";
import type {
  AnyScenarioModel,
  ScenarioActionSpec,
  ScenarioContribution,
  ScenarioDecision,
  ScenarioModel,
  ScenarioState,
  ScenarioStatus,
  ScenarioStepResult,
  ScenarioView,
} from "../types.ts";

type ProgramId =
  | "aircraft"
  | "ships"
  | "vehicles"
  | "munitions"
  | "essential-civilian";
type MaterialId =
  | "carbon-steel"
  | "alloy-steel"
  | "copper-products"
  | "aluminum-products";
type StageId = "fabrication" | "component-assembly" | "final-test";

type MaterialRecord = Record<MaterialId, number>;

type WipCohort = {
  id: string;
  quantity: number;
  stage: 0 | 1 | 2;
  startedTurn: number;
  enteredStageTurn: number;
  designVersion: number;
  embedded: MaterialRecord;
};

type FlowSnapshot = {
  requestedStarts: number;
  realisedStarts: number;
  fabrication: number;
  componentAssembly: number;
  completed: number;
  requestedCompletion: number;
  bindingSet: string[];
  oldestWipMonths: number;
};

type ProgramState = {
  raw: MaterialRecord;
  pipeline: MaterialRecord;
  wip: WipCohort[];
  components: number;
  componentPipeline: number;
  rubber: number;
  rubberPipeline: number;
  condition: number;
  maintenanceBacklog: number;
  experience: number;
  designVersion: number;
  bomFactor: number;
  stabilityAge: number;
  capacityBonus: number;
  retoolTurns: number;
  cumulativeCompleted: number;
  cumulativeTarget: number;
  cumulativeShortfall: number;
  deliveredMaterial: MaterialRecord;
  unrecoveredScrap: MaterialRecord;
  lastFlow: FlowSnapshot;
  outageThisTurn: boolean;
};

type PendingIntervention = {
  kind: "component-expedite" | "standardisation";
  program: ProgramId;
  dueTurn: number;
};

type ConversionProject = {
  id: string;
  program: ProgramId;
  monthsRemaining: number;
  totalMonths: number;
};

export type ControlledMaterialsState = ScenarioState & {
  programs: Record<ProgramId, ProgramState>;
  reserveAuthority: MaterialRecord;
  cumulativeForecastAuthority: MaterialRecord;
  cumulativeIssuedAuthority: MaterialRecord;
  cumulativePhysicalArrivals: MaterialRecord;
  pendingInterventions: PendingIntervention[];
  activeConversion: ConversionProject | null;
  dataQuality: number;
  rubberSupplyFactor: number;
  lastStarts: Record<ProgramId, number>;
  lastReservePct: number;
  lastMaintenancePct: number;
  implementationUsed: number;
  civilianBreachMonths: number;
  criticalPrograms: ProgramId[];
  recentEvents: string[];
  currentQuarter: number;
};

const PROGRAMS: ProgramId[] = [
  "aircraft",
  "ships",
  "vehicles",
  "munitions",
  "essential-civilian",
];
const MATERIALS: MaterialId[] = [
  "carbon-steel",
  "alloy-steel",
  "copper-products",
  "aluminum-products",
];
const STAGES: StageId[] = [
  "fabrication",
  "component-assembly",
  "final-test",
];

const PROGRAM_LABEL: Record<ProgramId, string> = {
  aircraft: "Aircraft",
  ships: "Ships",
  vehicles: "Vehicles",
  munitions: "Munitions",
  "essential-civilian": "Essential civilian",
};

const MATERIAL_LABEL: Record<MaterialId, string> = {
  "carbon-steel": "carbon steel",
  "alloy-steel": "alloy steel",
  "copper-products": "copper products",
  "aluminum-products": "aluminum products",
};

const BOM: Record<ProgramId, MaterialRecord> = {
  aircraft: {
    "carbon-steel": 0.8,
    "alloy-steel": 0.65,
    "copper-products": 0.42,
    "aluminum-products": 1.45,
  },
  ships: {
    "carbon-steel": 3.8,
    "alloy-steel": 0.75,
    "copper-products": 0.55,
    "aluminum-products": 0.18,
  },
  vehicles: {
    "carbon-steel": 1.55,
    "alloy-steel": 0.42,
    "copper-products": 0.22,
    "aluminum-products": 0.16,
  },
  munitions: {
    "carbon-steel": 1.2,
    "alloy-steel": 0.7,
    "copper-products": 0.48,
    "aluminum-products": 0.08,
  },
  "essential-civilian": {
    "carbon-steel": 1.3,
    "alloy-steel": 0.15,
    "copper-products": 0.62,
    "aluminum-products": 0.12,
  },
};

const NOMINAL_CAPACITY: Record<ProgramId, [number, number, number]> = {
  aircraft: [17, 13, 11],
  ships: [8, 6.5, 5.5],
  vehicles: [24, 18, 16],
  munitions: [27, 22, 20],
  "essential-civilian": [15, 12, 10],
};

const LABOUR_HOURS: Record<ProgramId, [number, number, number]> = {
  aircraft: [64, 57, 50],
  ships: [43, 39, 31],
  vehicles: [74, 60, 51],
  munitions: [77, 69, 61],
  "essential-civilian": [51, 47, 40],
};

const BASE_HOURS_PER_UNIT: Record<ProgramId, [number, number, number]> = {
  aircraft: [4.8, 4.9, 4.5],
  ships: [6.6, 6.8, 5.5],
  vehicles: [3.8, 3.9, 3.5],
  munitions: [3.4, 3.5, 3.2],
  "essential-civilian": [4.1, 4.3, 3.8],
};

const TOOL_HOURS: Record<ProgramId, [number, number, number]> = {
  aircraft: [42, 38, 32],
  ships: [33, 29, 25],
  vehicles: [58, 48, 42],
  munitions: [62, 54, 49],
  "essential-civilian": [42, 38, 34],
};

const TOOL_HOURS_PER_UNIT: Record<ProgramId, [number, number, number]> = {
  aircraft: [3, 3.1, 2.8],
  ships: [4.7, 4.5, 4.1],
  vehicles: [2.7, 2.8, 2.5],
  munitions: [2.5, 2.6, 2.35],
  "essential-civilian": [3.1, 3.2, 2.9],
};

const COMPONENTS_PER_UNIT: Record<ProgramId, number> = {
  aircraft: 1.5,
  ships: 1.2,
  vehicles: 0.9,
  munitions: 0.75,
  "essential-civilian": 0.85,
};

const RUBBER_PER_UNIT: Record<ProgramId, number> = {
  aircraft: 0.45,
  ships: 0.18,
  vehicles: 1.15,
  munitions: 0.16,
  "essential-civilian": 0.62,
};

const COMPONENT_ARRIVALS: Record<ProgramId, number> = {
  aircraft: 16,
  ships: 7,
  vehicles: 17,
  munitions: 18,
  "essential-civilian": 10,
};

const RUBBER_ARRIVALS: Record<ProgramId, number> = {
  aircraft: 5.6,
  ships: 1.4,
  vehicles: 18,
  munitions: 2.8,
  "essential-civilian": 6.8,
};

const START_DEFAULTS: Record<ProgramId, number> = {
  aircraft: 13,
  ships: 6,
  vehicles: 19,
  munitions: 22,
  "essential-civilian": 11,
};

const START_ACTION: Record<ProgramId, string> = {
  aircraft: "aircraft-starts",
  ships: "ship-starts",
  vehicles: "vehicle-starts",
  munitions: "munitions-starts",
  "essential-civilian": "civilian-starts",
};

const MONTHLY_TARGETS: Record<ProgramId, number[]> = {
  aircraft: [9, 9, 10, 10, 10, 11, 12, 12, 13, 13, 14, 14],
  ships: [4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7],
  vehicles: [13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18],
  munitions: [16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21],
  "essential-civilian": [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const TURN_PHASES = [
  ["Q2 determination", "Reconcile bills, schedules, and the first bulk determinations."],
  ["Allotment cascade", "Authorisation is passing through claimants and prime consumers."],
  ["Transition orders", "Mill orders move while inherited work in process remains binding."],
  ["Q2 transition", "The first complementarity diagnosis arrives with partial CMP operation."],
  ["Q3 cascade", "Conversions mature while current capacity pays their near-term cost."],
  ["Audit and return", "Unused authority can be identified before the full-system gate."],
  ["CMP fully effective", "Metals ease and the constraint migrates toward complements."],
  ["Reprogramming", "A revised requirement tests reserve, stability, and configuration choices."],
  ["Maintenance warning", "Condition proxies worsen under sustained high utilisation."],
  ["Q4 operation", "Localized shortages replace the appearance of one universal constraint."],
  ["Advance commitments", "Late revisions test whether earlier slack preserved options."],
  ["Ledger close", "December output and the inherited productive system are both assessed."],
] as const;

const ACTIONS: ScenarioActionSpec[] = [
  {
    id: "aircraft-starts",
    label: "Aircraft starts",
    description: "Release aircraft work into fabrication. Starts embed all four CMP materials.",
    commitment: "Monthly release; completion requires three delayed stage advances.",
    unit: "aircraft SPU",
    min: 0,
    max: 22,
    step: 1,
    defaultValue: 13,
  },
  {
    id: "ship-starts",
    label: "Ship starts",
    description: "Release ship work; carbon-steel demand is especially heavy.",
    commitment: "Monthly release; excess starts remain as material-bearing WIP.",
    unit: "ship SPU",
    min: 0,
    max: 11,
    step: 1,
    defaultValue: 6,
  },
  {
    id: "vehicle-starts",
    label: "Vehicle starts",
    description: "Release vehicle work; rubber remains outside CMP and can bind assembly.",
    commitment: "Monthly release through contractors; it is not a completion order.",
    unit: "vehicle SPU",
    min: 0,
    max: 30,
    step: 1,
    defaultValue: 19,
  },
  {
    id: "munitions-starts",
    label: "Munitions starts",
    description: "Release munitions work into a tool- and alloy-intensive line.",
    commitment: "Monthly release; downstream labour and tools remain separate constraints.",
    unit: "munitions SPU",
    min: 0,
    max: 34,
    step: 1,
    defaultValue: 22,
  },
  {
    id: "civilian-starts",
    label: "Essential civilian starts",
    description: "Release work supporting essential civilian systems and their service floor.",
    commitment: "Monthly release; low starts can breach the dated civilian mandate later.",
    unit: "civilian SPU",
    min: 0,
    max: 20,
    step: 1,
    defaultValue: 11,
  },
  {
    id: "contingency-reserve-pct",
    label: "Contingency reserve",
    description: "Hold part of each material forecast as auditable authority, not physical stock.",
    commitment: "Issued authority cascades into next-month mill deliveries; releases also lag.",
    unit: "%",
    min: 0,
    max: 20,
    step: 1,
    defaultValue: 8,
  },
  {
    id: "maintenance-pct",
    label: "Maintenance protection",
    description: "Reserve MRO, skilled time, and planned downtime to reduce future backlog.",
    commitment: "Downtime is paid now; condition recovery and avoided outages arrive later.",
    unit: "% capacity",
    min: 0,
    max: 25,
    step: 1,
    defaultValue: 12,
  },
  {
    id: "intervention",
    label: "Staff intervention",
    description:
      "0 stability; 1 audit; 2 component expedite; 3 final-test conversion; 4 standardise the current critical program.",
    commitment: "Categorical SWU-intensive action with its stated investigation, delivery, or retooling delay.",
    unit: "code",
    min: 0,
    max: 4,
    step: 1,
    defaultValue: 0,
  },
];

function zeroMaterials(value = 0): MaterialRecord {
  return {
    "carbon-steel": value,
    "alloy-steel": value,
    "copper-products": value,
    "aluminum-products": value,
  };
}

function mapMaterials(
  mapper: (material: MaterialId) => number,
): MaterialRecord {
  return {
    "carbon-steel": mapper("carbon-steel"),
    "alloy-steel": mapper("alloy-steel"),
    "copper-products": mapper("copper-products"),
    "aluminum-products": mapper("aluminum-products"),
  };
}

function emptyFlow(): FlowSnapshot {
  return {
    requestedStarts: 0,
    realisedStarts: 0,
    fabrication: 0,
    componentAssembly: 0,
    completed: 0,
    requestedCompletion: 0,
    bindingSet: ["opening-WIP"],
    oldestWipMonths: 0,
  };
}

function createCohort(
  id: string,
  program: ProgramId,
  quantity: number,
  stage: 0 | 1 | 2,
  startedTurn: number,
): WipCohort {
  return {
    id,
    quantity,
    stage,
    startedTurn,
    enteredStageTurn: startedTurn + stage,
    designVersion: 1,
    embedded: mapMaterials((material) => quantity * BOM[program][material]),
  };
}

function initialProgram(program: ProgramId): ProgramState {
  const scale = START_DEFAULTS[program];
  return {
    raw: mapMaterials((material) => BOM[program][material] * scale * 1.35),
    pipeline: zeroMaterials(),
    wip: [
      createCohort(`opening-${program}-fabrication`, program, scale * 0.72, 0, -2),
      createCohort(`opening-${program}-assembly`, program, scale * 0.54, 1, -3),
      createCohort(`opening-${program}-test`, program, scale * 0.38, 2, -4),
    ],
    components: COMPONENTS_PER_UNIT[program] * scale * 1.1,
    componentPipeline: 0,
    rubber: RUBBER_PER_UNIT[program] * scale * 1.15,
    rubberPipeline: 0,
    condition: 0.89,
    maintenanceBacklog: 2.5,
    experience: scale * 7,
    designVersion: 1,
    bomFactor: 1,
    stabilityAge: 5,
    capacityBonus: 0,
    retoolTurns: 0,
    cumulativeCompleted: 0,
    cumulativeTarget: 0,
    cumulativeShortfall: 0,
    deliveredMaterial: zeroMaterials(),
    unrecoveredScrap: zeroMaterials(),
    lastFlow: emptyFlow(),
    outageThisTurn: false,
  };
}

function criticalProgramsForTurn(turn: number): ProgramId[] {
  if (turn >= 11) return ["ships", "munitions", "essential-civilian"];
  if (turn >= 7) return ["aircraft", "munitions"];
  return ["aircraft", "vehicles"];
}

function selectedCriticalProgram(state: ControlledMaterialsState): ProgramId {
  const candidates = state.criticalPrograms;
  let selected = candidates[0] ?? "aircraft";
  let largestGap = -Infinity;
  for (const program of candidates) {
    const entry = state.programs[program];
    const gap =
      entry.cumulativeTarget -
      entry.cumulativeCompleted +
      entry.lastFlow.oldestWipMonths * 0.1;
    if (gap > largestGap) {
      selected = program;
      largestGap = gap;
    }
  }
  return selected;
}

function initialState(seed: number, mode: SimulationMode): ControlledMaterialsState {
  const normalisedSeed = normaliseSeed(seed);
  const programs = Object.fromEntries(
    PROGRAMS.map((program) => [program, initialProgram(program)]),
  ) as Record<ProgramId, ProgramState>;
  return {
    turn: 0,
    complete: false,
    seed: normalisedSeed,
    mode,
    programs,
    reserveAuthority: zeroMaterials(),
    cumulativeForecastAuthority: zeroMaterials(),
    cumulativeIssuedAuthority: zeroMaterials(),
    cumulativePhysicalArrivals: zeroMaterials(),
    pendingInterventions: [],
    activeConversion: null,
    dataQuality: mode === "sandbox" ? 1 : 0.56,
    rubberSupplyFactor:
      mode === "guided"
        ? 0.88
        : seededRange(normalisedSeed, "rubber-commissioning-factor", 0.8, 1.08),
    lastStarts: { ...START_DEFAULTS },
    lastReservePct: 8,
    lastMaintenancePct: 12,
    implementationUsed: 0,
    civilianBreachMonths: 0,
    criticalPrograms: criticalProgramsForTurn(1),
    recentEvents: ["Q2 requirements and inherited WIP are ready for review."],
    currentQuarter: 1,
  };
}

function finiteDecisionRecord(
  decision: ScenarioDecision,
): Record<string, number> | null {
  if (
    decision === null ||
    typeof decision !== "object" ||
    decision.values === null ||
    typeof decision.values !== "object" ||
    Array.isArray(decision.values)
  ) {
    return null;
  }
  return decision.values;
}

function swuClaim(
  state: ControlledMaterialsState,
  decision: ScenarioDecision,
): number {
  let claim = 1;
  for (const program of PROGRAMS) {
    claim +=
      Math.abs(
        decisionValue(decision, START_ACTION[program], state.lastStarts[program]) -
          state.lastStarts[program],
      ) / 12;
  }
  claim +=
    Math.abs(
      decisionValue(
        decision,
        "contingency-reserve-pct",
        state.lastReservePct,
      ) - state.lastReservePct,
    ) / 10;
  claim +=
    Math.abs(
      decisionValue(decision, "maintenance-pct", state.lastMaintenancePct) -
        state.lastMaintenancePct,
    ) / 14;
  const intervention = decisionValue(decision, "intervention", 0);
  claim += [0, 3, 4, 6, 5][intervention] ?? 99;
  return round(claim, 3);
}

function validateDecision(
  state: ControlledMaterialsState,
  decision: ScenarioDecision,
): string[] {
  const values = finiteDecisionRecord(decision);
  if (!values) return ["Decision values must be a numeric record."];
  const errors: string[] = [];
  const knownIds = new Set(ACTIONS.map((action) => action.id));
  for (const id of Object.keys(values)) {
    if (!knownIds.has(id)) errors.push(`Unknown action "${id}".`);
  }
  for (const action of ACTIONS) {
    const value = values[action.id];
    if (!Number.isFinite(value)) {
      errors.push(`${action.label} must be a finite number.`);
      continue;
    }
    if (value < action.min || value > action.max) {
      errors.push(
        `${action.label} must be between ${action.min} and ${action.max} ${action.unit}.`,
      );
    }
    const stepOffset = (value - action.min) / action.step;
    if (Number.isFinite(stepOffset) && Math.abs(stepOffset - Math.round(stepOffset)) > 1e-8) {
      errors.push(`${action.label} must use increments of ${action.step} ${action.unit}.`);
    }
  }
  const intervention = values.intervention;
  if (Number.isFinite(intervention) && !Number.isInteger(intervention)) {
    errors.push("Staff intervention must be an integer code from 0 to 4.");
  }
  if (intervention === 3 && state.activeConversion !== null) {
    errors.push(
      `A conversion for ${PROGRAM_LABEL[state.activeConversion.program]} is already implementing.`,
    );
  }
  if (state.complete) errors.push("The December ledger is closed; no further package can be committed.");
  const claim = swuClaim(state, decision);
  if (claim > 10) {
    errors.push(
      `The package claims ${round(claim, 1)} SWU, above the 10 SWU monthly implementation limit.`,
    );
  }
  return errors;
}

function defaultDecision(state: ControlledMaterialsState): ScenarioDecision {
  return {
    values: {
      "aircraft-starts": state.lastStarts.aircraft,
      "ship-starts": state.lastStarts.ships,
      "vehicle-starts": state.lastStarts.vehicles,
      "munitions-starts": state.lastStarts.munitions,
      "civilian-starts": state.lastStarts["essential-civilian"],
      "contingency-reserve-pct": state.lastReservePct,
      "maintenance-pct": state.lastMaintenancePct,
      intervention: 0,
    },
  };
}

function materialForecast(
  state: ControlledMaterialsState,
  material: MaterialId,
  month: number,
): number {
  const base: MaterialRecord = {
    "carbon-steel": 143,
    "alloy-steel": 43,
    "copper-products": 35,
    "aluminum-products": 34,
  };
  const transition = month < 4 ? 0.88 + month * 0.025 : 0.99 + month * 0.008;
  const variation = seededRange(
    state.seed,
    `metal-supply:${material}:turn:${month}`,
    0.94,
    1.06,
  );
  return round(base[material] * transition * variation, 6);
}

function allocateAuthority(
  state: ControlledMaterialsState,
  decision: ScenarioDecision,
  month: number,
  events: string[],
): void {
  const reservePct = decisionValue(decision, "contingency-reserve-pct", 8);
  for (const material of MATERIALS) {
    const forecast = materialForecast(state, material, month);
    state.cumulativeForecastAuthority[material] += forecast;
    const newlyReserved = forecast * (reservePct / 100);
    state.reserveAuthority[material] += newlyReserved;
    let issuePool = forecast - newlyReserved;

    if (reservePct < state.lastReservePct && state.reserveAuthority[material] > 0) {
      const releaseFraction = Math.min(
        0.35,
        (state.lastReservePct - reservePct) / 20,
      );
      const released = state.reserveAuthority[material] * releaseFraction;
      state.reserveAuthority[material] -= released;
      issuePool += released;
    }

    const requirements = PROGRAMS.map((program) => {
      const starts = decisionValue(decision, START_ACTION[program], 0);
      return (
        BOM[program][material] *
        state.programs[program].bomFactor *
        Math.max(1, starts)
      );
    });
    const totalRequirement = requirements.reduce((sum, value) => sum + value, 0);
    PROGRAMS.forEach((program, index) => {
      const authorised = issuePool * (requirements[index] / totalRequirement);
      const attrition =
        0.915 +
        state.dataQuality * 0.055 +
        seededRange(
          state.seed,
          `cascade:${material}:${program}:turn:${month}`,
          -0.012,
          0.012,
        );
      const physicalDelivery = authorised * clamp(attrition, 0.88, 0.99);
      state.programs[program].pipeline[material] += physicalDelivery;
      state.cumulativeIssuedAuthority[material] += authorised;
    });
  }
  if (reservePct < state.lastReservePct) {
    events.push("A recorded reserve release entered the allotment cascade; physical metal still waits one month.");
  }
}

function applyArrivals(
  state: ControlledMaterialsState,
  month: number,
): void {
  for (const program of PROGRAMS) {
    const entry = state.programs[program];
    for (const material of MATERIALS) {
      const arrival = entry.pipeline[material];
      entry.raw[material] += arrival;
      state.cumulativePhysicalArrivals[material] += arrival;
      entry.pipeline[material] = 0;
    }
    entry.components += entry.componentPipeline;
    entry.componentPipeline = 0;
    entry.rubber += entry.rubberPipeline;
    entry.rubberPipeline = 0;

    const ramp = month < 4 ? 0.9 : 1 + Math.min(0.08, (month - 4) * 0.01);
    entry.componentPipeline += COMPONENT_ARRIVALS[program] * ramp;
    const commissioningFactor = month >= 3 ? state.rubberSupplyFactor : 0.94;
    entry.rubberPipeline += RUBBER_ARRIVALS[program] * commissioningFactor;
  }
}

function applyPendingInterventions(
  state: ControlledMaterialsState,
  month: number,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  const remaining: PendingIntervention[] = [];
  for (const intervention of state.pendingInterventions) {
    if (intervention.dueTurn > month) {
      remaining.push(intervention);
      continue;
    }
    const entry = state.programs[intervention.program];
    if (intervention.kind === "component-expedite") {
      const boost = COMPONENT_ARRIVALS[intervention.program] * 1.35;
      entry.componentPipeline += boost;
      events.push(
        `${PROGRAM_LABEL[intervention.program]} component expediting secured ${round(boost, 1)} equivalent units for next month's pipeline.`,
      );
      contributions.push({
        target: `supply.components.${intervention.program}`,
        source: "intervention.component-expedite",
        delta: round(boost, 3),
        unit: "component-equivalent",
        explanation: "A separately governed component schedule improved after its administrative lead time.",
      });
    } else {
      entry.designVersion += 1;
      entry.bomFactor = clamp(entry.bomFactor * 0.92, 0.78, 1);
      entry.experience *= 0.72;
      entry.stabilityAge = 0;
      entry.retoolTurns = Math.max(entry.retoolTurns, 1);
      let recovered = 0;
      for (const cohort of entry.wip) {
        const scrapFraction = 0.03;
        for (const material of MATERIALS) {
          const scrapped = cohort.embedded[material] * scrapFraction;
          const recovery = scrapped * 0.6;
          cohort.embedded[material] -= scrapped;
          entry.raw[material] += recovery;
          entry.unrecoveredScrap[material] += scrapped - recovery;
          recovered += recovery;
        }
        cohort.quantity *= 1 - scrapFraction;
        cohort.designVersion = entry.designVersion;
      }
      events.push(
        `${PROGRAM_LABEL[intervention.program]} standardisation cut future BOM demand 8%, but retooling, rework, and partial learning loss begin now.`,
      );
      contributions.push({
        target: `configuration.${intervention.program}`,
        source: "intervention.standardisation",
        delta: -28,
        unit: "% inherited experience",
        explanation: `The new design retained 72% of modeled experience; ${round(recovered, 1)} tons were recovered from rework scrap.`,
      });
    }
  }
  state.pendingInterventions = remaining;
}

function applyInterventionDecision(
  state: ControlledMaterialsState,
  decision: ScenarioDecision,
  month: number,
  events: string[],
): void {
  const intervention = decisionValue(decision, "intervention", 0);
  const target = selectedCriticalProgram(state);
  if (intervention === 1) {
    state.dataQuality = clamp(state.dataQuality + 0.17, 0, 0.95);
    events.push(
      `A targeted ${PROGRAM_LABEL[target]} WIP and allotment audit narrowed reporting error; future cascade attrition is lower, but no authority or metal was created.`,
    );
  } else if (intervention === 2) {
    state.pendingInterventions.push({
      kind: "component-expedite",
      program: target,
      dueTurn: month + 1,
    });
    events.push(
      `${PROGRAM_LABEL[target]} component priority was requested outside CMP; implementation is due next month.`,
    );
  } else if (intervention === 3) {
    state.activeConversion = {
      id: `conversion-${target}-${month}`,
      program: target,
      monthsRemaining: 3,
      totalMonths: 3,
    };
    events.push(
      `${PROGRAM_LABEL[target]} final-test conversion began: near-term capacity and tool time fall before commissioning.`,
    );
  } else if (intervention === 4) {
    state.pendingInterventions.push({
      kind: "standardisation",
      program: target,
      dueTurn: month + 1,
    });
    events.push(
      `${PROGRAM_LABEL[target]} standardisation entered engineering review; the configuration change is due next month.`,
    );
  }
}

function learningFactor(entry: ProgramState): number {
  const experienceGain = Math.log2(Math.max(1, entry.experience) / 40);
  return clamp(1 - experienceGain * 0.045, 0.76, 1.08);
}

function stageLimits(
  state: ControlledMaterialsState,
  program: ProgramId,
  stage: 0 | 1 | 2,
  eligibleWip: number,
  maintenancePct: number,
  month: number,
): { flow: number; binders: string[]; limits: Record<string, number> } {
  const entry = state.programs[program];
  const plannedDowntime = 1 - maintenancePct * 0.0055;
  const retoolFactor = entry.retoolTurns > 0 ? 0.72 : 1;
  const conversionFactor =
    state.activeConversion?.program === program ? 0.86 : 1;
  const outageFactor = entry.outageThisTurn ? 0.62 : 1;
  const nominal =
    NOMINAL_CAPACITY[program][stage] *
    (stage === 2 ? 1 + entry.capacityBonus : 1);
  const capacity =
    nominal *
    entry.condition *
    plannedDowntime *
    retoolFactor *
    conversionFactor *
    outageFactor;
  const labour =
    LABOUR_HOURS[program][stage] /
    (BASE_HOURS_PER_UNIT[program][stage] * learningFactor(entry));
  const tools =
    TOOL_HOURS[program][stage] / TOOL_HOURS_PER_UNIT[program][stage];
  const limits: Record<string, number> = {
    "eligible-WIP": eligibleWip,
    "effective-capacity": capacity,
    "skilled-labour": labour,
    "machine-tools": tools,
  };
  if (stage === 1) {
    limits["critical-components"] =
      entry.components / COMPONENTS_PER_UNIT[program];
    limits["rubber-outside-CMP"] = entry.rubber / RUBBER_PER_UNIT[program];
  }
  const flow = Math.max(0, Math.min(...Object.values(limits)));
  const epsilon = Math.max(0.03, flow * 0.01);
  const binders = Object.entries(limits)
    .filter(([, value]) => value <= flow + epsilon)
    .map(([key]) => key);
  if (month === 1 && binders.length === 0) binders.push("opening-WIP");
  return { flow, binders, limits };
}

function advanceCohorts(
  entry: ProgramState,
  stage: 0 | 1 | 2,
  quantity: number,
  month: number,
): number {
  let remaining = quantity;
  let moved = 0;
  const eligible = entry.wip
    .filter(
      (cohort) =>
        cohort.stage === stage &&
        cohort.enteredStageTurn < month &&
        cohort.quantity > 1e-9,
    )
    .sort(
      (left, right) =>
        left.startedTurn - right.startedTurn ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  const additions: WipCohort[] = [];
  for (const cohort of eligible) {
    if (remaining <= 1e-9) break;
    const before = cohort.quantity;
    const take = Math.min(before, remaining);
    const embedded = mapMaterials(
      (material) => cohort.embedded[material] * (take / before),
    );
    cohort.quantity -= take;
    for (const material of MATERIALS) cohort.embedded[material] -= embedded[material];
    if (stage < 2) {
      additions.push({
        ...cohort,
        id: `${cohort.id}:advance-${month}-${stage + 1}`,
        quantity: take,
        stage: (stage + 1) as 1 | 2,
        enteredStageTurn: month,
        embedded,
      });
    } else {
      for (const material of MATERIALS) {
        entry.deliveredMaterial[material] += embedded[material];
      }
    }
    remaining -= take;
    moved += take;
  }
  entry.wip = entry.wip
    .filter((cohort) => cohort.quantity > 1e-8)
    .concat(additions);
  return moved;
}

function realiseProgramFlow(
  state: ControlledMaterialsState,
  program: ProgramId,
  decision: ScenarioDecision,
  month: number,
  maintenancePct: number,
  contributions: ScenarioContribution[],
): void {
  const entry = state.programs[program];
  const requestedStarts = decisionValue(decision, START_ACTION[program], 0);
  const requestedCompletion = MONTHLY_TARGETS[program][month - 1] ?? 0;
  const stageFlows: [number, number, number] = [0, 0, 0];
  const bindingSet: string[] = [];

  for (const stage of [2, 1, 0] as const) {
    const eligible = entry.wip
      .filter(
        (cohort) =>
          cohort.stage === stage && cohort.enteredStageTurn < month,
      )
      .reduce((sum, cohort) => sum + cohort.quantity, 0);
    const result = stageLimits(
      state,
      program,
      stage,
      eligible,
      maintenancePct,
      month,
    );
    const moved = advanceCohorts(entry, stage, result.flow, month);
    stageFlows[stage] = moved;
    if (stage === 1) {
      entry.components = Math.max(
        0,
        entry.components - moved * COMPONENTS_PER_UNIT[program],
      );
      entry.rubber = Math.max(
        0,
        entry.rubber - moved * RUBBER_PER_UNIT[program],
      );
    }
    if (stage === 2) {
      entry.cumulativeCompleted += moved;
      entry.experience += moved;
      contributions.push({
        target: `output.completed.${program}`,
        source: `flow.${STAGES[stage]}`,
        delta: round(moved, 3),
        unit: `${program} SPU`,
        explanation: `${round(eligible, 1)} eligible SPU faced ${result.binders.join(
          " + ",
        )}; ${round(moved, 1)} passed final test.`,
      });
      if (moved + 1e-8 < requestedCompletion) {
        contributions.push({
          target: `objective.critical-delivery.${program}`,
          source: `binding.${result.binders.join("+")}`,
          delta: round(moved - requestedCompletion, 3),
          unit: `${program} SPU`,
          explanation: `The dated request was ${requestedCompletion}; the complete candidate limit set was ${Object.entries(
            result.limits,
          )
            .map(([name, limit]) => `${name} ${round(limit, 1)}`)
            .join(", ")}.`,
        });
      }
    }
    for (const binder of result.binders) {
      if (!bindingSet.includes(binder)) bindingSet.push(binder);
    }
  }

  const materialLimits = MATERIALS.map((material) => ({
    material,
    limit:
      entry.raw[material] /
      (BOM[program][material] * entry.bomFactor),
  }));
  const releaseLimit = NOMINAL_CAPACITY[program][0] * 1.35;
  const realisedStarts = Math.max(
    0,
    Math.min(requestedStarts, releaseLimit, ...materialLimits.map(({ limit }) => limit)),
  );
  for (const material of MATERIALS) {
    entry.raw[material] = Math.max(
      0,
      entry.raw[material] -
        realisedStarts * BOM[program][material] * entry.bomFactor,
    );
  }
  if (realisedStarts > 1e-9) {
    entry.wip.push({
      id: `${program}-cohort-${month}`,
      quantity: realisedStarts,
      stage: 0,
      startedTurn: month,
      enteredStageTurn: month,
      designVersion: entry.designVersion,
      embedded: mapMaterials(
        (material) =>
          realisedStarts * BOM[program][material] * entry.bomFactor,
      ),
    });
  }
  if (realisedStarts + 1e-8 < requestedStarts) {
    const startBinders = materialLimits
      .filter(({ limit }) => limit <= realisedStarts + 0.03)
      .map(({ material }) => MATERIAL_LABEL[material]);
    if (releaseLimit <= realisedStarts + 0.03) startBinders.push("release control");
    contributions.push({
      target: `wip.starts.${program}`,
      source: `raw.${startBinders.join("+") || "material-balance"}`,
      delta: round(realisedStarts - requestedStarts, 3),
      unit: `${program} SPU`,
      explanation: `${round(requestedStarts, 1)} starts were authorised, but complementary material/release limits admitted ${round(realisedStarts, 1)}.`,
    });
  }

  entry.cumulativeTarget += requestedCompletion;
  entry.cumulativeShortfall += Math.max(0, requestedCompletion - stageFlows[2]);
  const oldestWipMonths = entry.wip.reduce(
    (oldest, cohort) => Math.max(oldest, month - cohort.startedTurn),
    0,
  );
  entry.lastFlow = {
    requestedStarts,
    realisedStarts,
    fabrication: stageFlows[0],
    componentAssembly: stageFlows[1],
    completed: stageFlows[2],
    requestedCompletion,
    bindingSet,
    oldestWipMonths,
  };
}

function updateMaintenance(
  state: ControlledMaterialsState,
  maintenancePct: number,
  month: number,
  contributions: ScenarioContribution[],
  events: string[],
): void {
  for (const program of PROGRAMS) {
    const entry = state.programs[program];
    const utilisation = clamp(
      entry.lastFlow.fabrication / NOMINAL_CAPACITY[program][0],
      0,
      1.4,
    );
    const wear = 0.75 + utilisation * 1.8;
    const completedMaintenance = maintenancePct * 0.145;
    const openingBacklog = entry.maintenanceBacklog;
    entry.maintenanceBacklog = Math.max(
      0,
      openingBacklog + wear - completedMaintenance,
    );
    const conditionDelta =
      completedMaintenance * 0.006 -
      wear * 0.0045 -
      Math.max(0, entry.maintenanceBacklog - 8) * 0.0018;
    entry.condition = clamp(entry.condition + conditionDelta, 0.5, 0.97);
    contributions.push({
      target: `maintenance.backlog.${program}`,
      source: "maintenance-policy-and-run-hours",
      delta: round(entry.maintenanceBacklog - openingBacklog, 3),
      unit: "thousand hours",
      explanation: `${round(wear, 1)} wear-hours accrued and ${round(completedMaintenance, 1)} were completed; availability effects carry forward.`,
    });
    if (entry.outageThisTurn) {
      events.push(
        `${PROGRAM_LABEL[program]} suffered a condition-dependent stage outage; repair work was added to the backlog.`,
      );
      entry.maintenanceBacklog += 1.8;
    }
    entry.stabilityAge += 1;
    if (entry.retoolTurns > 0) entry.retoolTurns -= 1;
  }

  if (state.activeConversion) {
    state.activeConversion.monthsRemaining -= 1;
    if (state.activeConversion.monthsRemaining <= 0) {
      const program = state.activeConversion.program;
      state.programs[program].capacityBonus += 0.18;
      events.push(
        `${PROGRAM_LABEL[program]} final-test conversion commissioned with an 18% nominal capacity increment.`,
      );
      contributions.push({
        target: `capacity.nominal.${program}.final-test`,
        source: state.activeConversion.id,
        delta: 18,
        unit: "%",
        explanation: "The multi-month conversion completed after its earlier capacity withdrawal.",
      });
      state.activeConversion = null;
    }
  }

  for (const program of PROGRAMS) {
    const entry = state.programs[program];
    const risk =
      entry.condition < 0.73
        ? clamp((0.73 - entry.condition) * 2.8 + entry.maintenanceBacklog * 0.008, 0, 0.45)
        : 0;
    entry.outageThisTurn =
      month < 12 &&
      seededRange(state.seed, `outage:${program}:turn:${month + 1}`, 0, 1) < risk;
  }
}

function step(
  inputState: ControlledMaterialsState,
  decision: ScenarioDecision,
): ScenarioStepResult<ControlledMaterialsState> {
  const errors = validateDecision(inputState, decision);
  if (errors.length > 0) throw new Error(errors.join(" "));

  const state = cloneJson(inputState);
  const month = state.turn + 1;
  const events: string[] = [];
  const contributions: ScenarioContribution[] = [];
  const maintenancePct = decisionValue(decision, "maintenance-pct", 12);

  state.criticalPrograms = criticalProgramsForTurn(month);
  state.currentQuarter = Math.floor((month - 1) / 3) + 1;
  state.implementationUsed = swuClaim(state, decision);

  applyArrivals(state, month);
  applyPendingInterventions(state, month, events, contributions);
  applyInterventionDecision(state, decision, month, events);
  allocateAuthority(state, decision, month, events);

  if (month === 3) {
    events.push(
      `Rubber Director commissioning reports resolve at ${round(state.rubberSupplyFactor * 100)}% of the modeled reference flow; rubber remains outside CMP.`,
    );
  }
  if (month === 7) {
    events.push(
      "Midyear claimant reprogramming designates aircraft and munitions; existing WIP and allotment accounts do not move automatically.",
    );
  }
  if (month === 11) {
    events.push(
      "A late requirement revision raises ship and essential-system urgency for the handover period.",
    );
  }

  for (const program of PROGRAMS) {
    realiseProgramFlow(
      state,
      program,
      decision,
      month,
      maintenancePct,
      contributions,
    );
  }
  updateMaintenance(
    state,
    maintenancePct,
    month,
    contributions,
    events,
  );

  const civilian = state.programs["essential-civilian"];
  if (civilian.lastFlow.completed + 1e-8 < MONTHLY_TARGETS["essential-civilian"][month - 1]) {
    state.civilianBreachMonths += 1;
  }

  for (const program of PROGRAMS) {
    state.lastStarts[program] = decisionValue(
      decision,
      START_ACTION[program],
      state.lastStarts[program],
    );
  }
  state.lastReservePct = decisionValue(
    decision,
    "contingency-reserve-pct",
    state.lastReservePct,
  );
  state.lastMaintenancePct = maintenancePct;
  state.turn = month;
  state.complete = month >= 12;
  state.recentEvents = events.length > 0 ? events : ["The monthly package advanced without a discrete institutional event."];

  const criticalSummary = state.criticalPrograms
    .map((program) => {
      const flow = state.programs[program].lastFlow;
      return `${PROGRAM_LABEL[program]} ${round(flow.completed, 1)}/${flow.requestedCompletion}`;
    })
    .join("; ");
  const headline = state.complete
    ? `December ledger closed — ${criticalSummary}.`
    : `${MONTH_NAMES[month - 1]} completions — ${criticalSummary}.`;

  return { state, headline, events, contributions };
}

function totalWipPressure(state: ControlledMaterialsState): number {
  const ratios = PROGRAMS.map((program) => {
    const wip = state.programs[program].wip.reduce(
      (sum, cohort) => sum + cohort.quantity,
      0,
    );
    return wip / (NOMINAL_CAPACITY[program][2] * 3);
  });
  return ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
}

function oldestWip(state: ControlledMaterialsState): {
  age: number;
  program: ProgramId;
} {
  let age = 0;
  let oldestProgram: ProgramId = "aircraft";
  for (const program of PROGRAMS) {
    const candidate = state.programs[program].lastFlow.oldestWipMonths;
    if (candidate > age) {
      age = candidate;
      oldestProgram = program;
    }
  }
  return { age, program: oldestProgram };
}

function minimumRawCoverage(state: ControlledMaterialsState): {
  months: number;
  program: ProgramId;
  material: MaterialId;
} {
  let minimum = Infinity;
  let limitingProgram: ProgramId = "aircraft";
  let limitingMaterial: MaterialId = "aluminum-products";
  for (const program of PROGRAMS) {
    for (const material of MATERIALS) {
      const monthlyNeed =
        Math.max(1, state.lastStarts[program]) *
        BOM[program][material] *
        state.programs[program].bomFactor;
      const coverage = state.programs[program].raw[material] / monthlyNeed;
      if (coverage < minimum) {
        minimum = coverage;
        limitingProgram = program;
        limitingMaterial = material;
      }
    }
  }
  return {
    months: Number.isFinite(minimum) ? minimum : 0,
    program: limitingProgram,
    material: limitingMaterial,
  };
}

function minimumComponentCoverage(state: ControlledMaterialsState): {
  months: number;
  program: ProgramId;
} {
  let minimum = Infinity;
  let limitingProgram: ProgramId = "aircraft";
  for (const program of PROGRAMS) {
    const entry = state.programs[program];
    const starts = Math.max(1, state.lastStarts[program]);
    const componentCoverage =
      entry.components / (COMPONENTS_PER_UNIT[program] * starts);
    const rubberCoverage = entry.rubber / (RUBBER_PER_UNIT[program] * starts);
    const coverage = Math.min(componentCoverage, rubberCoverage);
    if (coverage < minimum) {
      minimum = coverage;
      limitingProgram = program;
    }
  }
  return {
    months: Number.isFinite(minimum) ? minimum : 0,
    program: limitingProgram,
  };
}

function metricStatus(
  value: number,
  watchThreshold: number,
  criticalThreshold: number,
  higherIsBetter = true,
): ScenarioStatus {
  if (higherIsBetter) {
    if (value < criticalThreshold) return "critical";
    if (value < watchThreshold) return "watch";
    return "secure";
  }
  if (value > criticalThreshold) return "critical";
  if (value > watchThreshold) return "watch";
  return "secure";
}

function getView(state: ControlledMaterialsState): ScenarioView {
  const phaseIndex = clamp(state.turn === 0 ? 0 : state.turn - 1, 0, 11);
  const [phase, phaseDescription] = TURN_PHASES[phaseIndex];
  const oldest = oldestWip(state);
  const rawCoverage = minimumRawCoverage(state);
  const complementCoverage = minimumComponentCoverage(state);
  const wipPressure = totalWipPressure(state);
  const averageCondition =
    PROGRAMS.reduce(
      (sum, program) => sum + state.programs[program].condition,
      0,
    ) / PROGRAMS.length;
  const averageLearning =
    PROGRAMS.reduce(
      (sum, program) => sum + (1 - learningFactor(state.programs[program])),
      0,
    ) / PROGRAMS.length;
  const criticalAttainment = Math.min(
    ...state.criticalPrograms.map((program) => {
      const entry = state.programs[program];
      return entry.cumulativeTarget > 0
        ? entry.cumulativeCompleted / entry.cumulativeTarget
        : 1;
    }),
  );
  const reserveShare = Math.min(
    ...MATERIALS.map((material) => {
      const authority = state.cumulativeForecastAuthority[material];
      return authority > 0
        ? state.reserveAuthority[material] / authority
        : state.lastReservePct / 100;
    }),
  );
  const civilian = state.programs["essential-civilian"];
  const civilianAttainment =
    civilian.cumulativeTarget > 0
      ? civilian.cumulativeCompleted / civilian.cumulativeTarget
      : 1;
  const activeCritical = selectedCriticalProgram(state);
  const binding = state.programs[activeCritical].lastFlow.bindingSet.join(" + ");

  const alerts = [];
  if (state.turn === 0) {
    alerts.push({
      id: "transition-briefing",
      severity: "info" as const,
      message:
        "Allotment is authorization, not delivery. January metal issued now enters a delayed cascade.",
    });
  }
  if (wipPressure > 1.15) {
    alerts.push({
      id: "wip-congestion",
      severity: wipPressure > 1.55 ? ("critical" as const) : ("warning" as const),
      message:
        "Normalized WIP exceeds downstream three-month capacity; more starts may lengthen queues.",
    });
  }
  if (averageCondition < 0.76) {
    alerts.push({
      id: "condition-warning",
      severity: averageCondition < 0.66 ? ("critical" as const) : ("warning" as const),
      message:
        "Condition proxies indicate elevated outage risk. Planned maintenance pays downtime before recovery.",
    });
  }
  if (complementCoverage.months < 0.75) {
    alerts.push({
      id: "non-cmp-complement",
      severity: "warning" as const,
      message: `${PROGRAM_LABEL[complementCoverage.program]} has under one month of component/rubber coverage; priority cannot create physical supply.`,
    });
  }
  if (state.activeConversion) {
    alerts.push({
      id: "conversion-active",
      severity: "info" as const,
      message: `${PROGRAM_LABEL[state.activeConversion.program]} conversion has ${state.activeConversion.monthsRemaining} implementation month(s) remaining.`,
    });
  }
  if (state.complete) {
    alerts.push({
      id: "run-complete",
      severity: state.civilianBreachMonths > 0 ? ("critical" as const) : ("info" as const),
      message:
        "The December ledger is closed. End condition, WIP, and reserves remain part of the handover.",
    });
  }

  const monthLabel =
    state.turn === 0 ? "January 1943 — before commitment" : `${MONTH_NAMES[state.turn - 1]} 1943`;
  const summary =
    state.turn === 0
      ? "Reconcile Q2 authorisations against inherited queues. Every SPU is program-specific and cannot be added across programs."
      : `${PROGRAM_LABEL[activeCritical]} currently reports ${binding || "no single"} binding limit; its ${round(
          state.programs[activeCritical].lastFlow.realisedStarts,
          1,
        )} starts and ${round(
          state.programs[activeCritical].lastFlow.completed,
          1,
        )} completions are different flows.`;

  return {
    dateLabel: monthLabel,
    phase,
    phaseDescription,
    summary,
    metrics: [
      {
        id: "aircraft-completions",
        label: "Aircraft completions",
        value: round(state.programs.aircraft.lastFlow.completed, 1),
        unit: "aircraft SPU/month",
        status: metricStatus(
          state.programs.aircraft.lastFlow.completed,
          state.programs.aircraft.lastFlow.requestedCompletion * 0.9,
          state.programs.aircraft.lastFlow.requestedCompletion * 0.72,
        ),
        detail: `${round(state.programs.aircraft.lastFlow.realisedStarts, 1)} starts; binding set ${state.programs.aircraft.lastFlow.bindingSet.join(" + ")}.`,
      },
      {
        id: "ship-completions",
        label: "Ship completions",
        value: round(state.programs.ships.lastFlow.completed, 1),
        unit: "ship SPU/month",
        status: metricStatus(
          state.programs.ships.lastFlow.completed,
          state.programs.ships.lastFlow.requestedCompletion * 0.9,
          state.programs.ships.lastFlow.requestedCompletion * 0.72,
        ),
        detail: "Ship SPUs are not commensurable with any other program SPU.",
      },
      {
        id: "civilian-completions",
        label: "Essential civilian completions",
        value: round(civilian.lastFlow.completed, 1),
        unit: "civilian SPU/month",
        status: metricStatus(civilian.lastFlow.completed, 8, 6),
        detail: `${state.civilianBreachMonths} month(s) below the analytic service floor.`,
      },
      {
        id: "wip-pressure",
        label: "Queue pressure",
        value: round(wipPressure * 100, 0),
        unit: "% of 3-month capacity",
        status: metricStatus(wipPressure, 1.15, 1.55, false),
        detail:
          "Average of program-normalized queues; unlike a raw SPU sum, it does not add incomparable outputs.",
      },
      {
        id: "oldest-wip",
        label: "Oldest cohort",
        value: oldest.age,
        unit: "months",
        status: metricStatus(oldest.age, 4, 7, false),
        detail: `${PROGRAM_LABEL[oldest.program]} has the oldest material-bearing cohort.`,
      },
      {
        id: "raw-coverage",
        label: "Tightest raw coverage",
        value: round(rawCoverage.months, 1),
        unit: "months",
        status: metricStatus(rawCoverage.months, 1, 0.55),
        detail: `${PROGRAM_LABEL[rawCoverage.program]} ${MATERIAL_LABEL[rawCoverage.material]}; distinct forms are not substitutable.`,
      },
      {
        id: "complement-coverage",
        label: "Tightest non-CMP coverage",
        value: round(complementCoverage.months, 1),
        unit: "months",
        status: metricStatus(complementCoverage.months, 1, 0.55),
        detail: `${PROGRAM_LABEL[complementCoverage.program]} components/rubber; these are outside the CMP metal ledger.`,
      },
      {
        id: "plant-condition",
        label: "Average availability proxy",
        value: round(averageCondition * 100, 0),
        unit: "%",
        status: metricStatus(averageCondition, 0.8, 0.68),
        detail: "Condition is inferred from backlog and downtime; audits improve confidence, not the machine itself.",
      },
      {
        id: "learning",
        label: "Stable-design labour gain",
        value: round(averageLearning * 100, 1),
        unit: "%",
        status: averageLearning >= 0 ? "secure" : "watch",
        detail: "Analytic Wright-form candidate; design changes transfer only part of experience.",
      },
      {
        id: "reserve",
        label: "Tightest reserve share",
        value: round(reserveShare * 100, 1),
        unit: "% authority",
        status: metricStatus(reserveShare, 0.045, 0.015),
        detail: "This is auditable allotment authority, not physical material inventory.",
      },
      {
        id: "implementation",
        label: "Free implementation capacity",
        value: round(10 - state.implementationUsed, 1),
        unit: "SWU",
        status: metricStatus(10 - state.implementationUsed, 2, 0.5),
        detail: "Schedule churn, audits, projects, and coordination share the monthly staff-work limit.",
      },
    ],
    objectives: [
      {
        id: "essential-service",
        label: "Preserve essential civilian systems",
        priority: 1,
        value: state.civilianBreachMonths,
        unit: "breach months",
        status:
          state.civilianBreachMonths === 0
            ? "secure"
            : state.civilianBreachMonths <= 1
              ? "watch"
              : "critical",
        hard: true,
      },
      {
        id: "critical-deliveries",
        label: "Meet designated critical deliveries",
        priority: 2,
        value: round(criticalAttainment * 100, 0),
        unit: "% weakest program",
        status: metricStatus(criticalAttainment, 0.9, 0.75),
        hard: true,
      },
      {
        id: "auditable-allotments",
        label: "Keep allotments lawful and auditable",
        priority: 3,
        value: round(state.dataQuality * 100, 0),
        unit: "% ledger confidence",
        status: metricStatus(state.dataQuality, 0.68, 0.48),
        hard: true,
      },
      {
        id: "productive-capacity",
        label: "Preserve productive capacity",
        priority: 4,
        value: round(averageCondition * 100, 0),
        unit: "% availability proxy",
        status: metricStatus(averageCondition, 0.8, 0.68),
        hard: false,
      },
      {
        id: "flow-efficiency",
        label: "Convert inputs into completed flow",
        priority: 5,
        value: round(100 / Math.max(1, wipPressure), 0),
        unit: "flow index",
        status: metricStatus(wipPressure, 1.2, 1.6, false),
        hard: false,
      },
      {
        id: "adaptability",
        label: "Preserve options for handover",
        priority: 6,
        value: round(
          clamp(
            reserveShare * 500 +
              averageCondition * 50 +
              Math.min(rawCoverage.months, 1.5) * 15,
            0,
            100,
          ),
          0,
        ),
        unit: "readiness index",
        status: metricStatus(
          reserveShare * 500 +
            averageCondition * 50 +
            Math.min(rawCoverage.months, 1.5) * 15,
          58,
          42,
        ),
        hard: false,
      },
    ],
    alerts,
  };
}

const controlledMaterialsTypedModel: ScenarioModel<ControlledMaterialsState> = {
  metadata: {
    id: "controlled-materials-1943",
    version: "0.1.0-candidate",
    title: "Controlled Materials, 1943",
    shortTitle: "Controlled Materials",
    deck: "Balance authorisation, physical flow, WIP, complements, and productive capacity through the 1943 CMP transition.",
    fidelity:
      "Historically grounded counterfactual with an analytically simplified production system; not historically, empirically, or educationally validated.",
    role: "Composite WPB Deputy Director for Program Determination and Controlled-Materials Allocations",
    period: "January–December 1943",
    turnLabel: "month",
    totalTurns: 12,
    sessionLength: "35–50 minutes",
    briefing: [
      "Steel, copper, and aluminum allotments are accounts and authorisations; mill delivery, inventory, starts, and completions remain separate.",
      "Every output requires complementary materials and three delayed production stages. Rubber, components, tools, and labour remain outside direct CMP control.",
      "Protect dated critical deliveries and essential civilian systems without leaving an exhausted, congested production system in December.",
      "Program SPUs are synthetic and incomparable. This model does not estimate historical counterfactual production or military effectiveness.",
    ],
    learningObjectives: [
      "Distinguish allotment, physical arrival, production start, WIP, and completion.",
      "Anticipate bottleneck migration across materials, components, labour, tools, and final test.",
      "Explain why controlled starts, maintenance headroom, stable designs, and reserves can be productive.",
      "Recognize the delays and donor costs of conversion, coordination, audits, and design changes.",
    ],
    modelNote:
      "WIP, learning, maintenance, event, and SPU parameters are analytic teaching assumptions pending calibration and human validation.",
    accent: "#d39a49",
  },
  actions: ACTIONS,
  createInitialState: initialState,
  defaultDecision,
  validateDecision,
  step,
  getView,
};

/**
 * The generic run envelope stores only the shared ScenarioState surface. The
 * model remains strongly typed internally and is widened only at this registry
 * boundary.
 */
export const controlledMaterialsModel =
  controlledMaterialsTypedModel as unknown as AnyScenarioModel;

export { controlledMaterialsTypedModel };
