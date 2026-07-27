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

type CapacitySector =
  | "coal"
  | "power"
  | "rail"
  | "fertilizer"
  | "consumer"
  | "construction";
type ProjectSector =
  | CapacitySector
  | "renovation"
  | "local-small-scale";
type ProjectStatus = "active" | "suspended" | "completed";

type CapacityLedger = Record<CapacitySector, number>;

type PhysicalLedger = {
  mineCoal: number;
  powerCoal: number;
  stateGrain: number;
  fertilizer: number;
  steel: number;
  consumerGoods: number;
};

type FinancialLedger = {
  creditOutstanding: number;
  creditCeiling: number;
  fiscalPressure: number;
  retainedFunds: number;
  localFunds: number;
  fx: number;
};

type PolicyState = {
  priceProcurementStep: number;
  eligibleResidualShare: number;
  retentionShare: number;
  creditPosture: number;
  conservationEffort: number;
};

type PendingPolicy = {
  dueTurn: number;
  priceProcurementStep: number;
  eligibleResidualShare: number;
  retentionShare: number;
  creditPosture: number;
};

type Project = {
  id: string;
  sector: ProjectSector;
  origin: "central" | "local";
  status: ProjectStatus;
  startedTurn: number;
  progress: number;
  workRequired: number;
  steelClaim: number;
  powerClaim: number;
  railClaim: number;
  creditClaim: number;
  capacityGain: number;
};

type TradeCohort = {
  id: string;
  kind: "grain" | "fertilizer" | "equipment" | "export";
  dueTurn: number;
  quantity: number;
  fxCost: number;
};

type FlowSnapshot = {
  coalMined: number;
  coalToPower: number;
  electricityAvailable: number;
  electricityServed: number;
  unservedElectricity: number;
  railCapacity: number;
  railRealised: number;
  railBacklog: number;
  fertilizerOutput: number;
  fertilizerToAgriculture: number;
  cropOutput: number;
  procurement: number;
  planConsumerDelivery: number;
  negotiatedConsumerDelivery: number;
  consumerDemand: number;
  projectLoad: number;
  projectProgress: number;
  commissionedCapacity: number;
  creditDraw: number;
  subsidyClaim: number;
  binding: string[];
};

type VisibleReport = {
  asOfTurn: number;
  publishedTurn: number;
  status: "opening" | "preliminary" | "revised";
  confidence: number;
  grainCover: number;
  procurementFulfilment: number;
  deliveredCoal: number;
  unservedElectricity: number;
  railBacklog: number;
  fertilizerDelivery: number;
  consumerFit: number;
  projectLoad: number;
  suspectedProjectStarts: number;
  creditDraw: number;
  fiscalPressure: number;
};

export interface BottleneckEconomyState extends ScenarioState {
  physical: PhysicalLedger;
  capacity: CapacityLedger;
  financial: FinancialLedger;
  policy: PolicyState;
  pendingPolicies: PendingPolicy[];
  projects: Project[];
  tradePipeline: TradeCohort[];
  flow: FlowSnapshot;
  report: VisibleReport;
  lastDecision: Record<string, number>;
  cwuUsed: number;
  compliance: number;
  dataQuality: number;
  projectSequence: number;
  tradeSequence: number;
  procurementObligation: number;
  planConsumerObligation: number;
  grainUse: number;
  cumulativePlanShortfall: number;
  cumulativeUnservedPower: number;
  provisioningBreachTurns: number;
  powerBreachTurns: number;
  stabilizationBreachTurns: number;
  recentEvents: string[];
}

const TOTAL_TURNS = 12;
const QUARTER_LABELS = [
  "1981 Q1",
  "1981 Q2",
  "1981 Q3",
  "1981 Q4",
  "1982 Q1",
  "1982 Q2",
  "1982 Q3",
  "1982 Q4",
  "1983 Q1",
  "1983 Q2",
  "1983 Q3",
  "1983 Q4",
] as const;

const ACTIONS = [
  {
    id: "energy-freight-priority",
    label: "Coal-to-power freight priority",
    description:
      "Coordinate the share of executable rail capacity reserved for generator coal; fertilizer, steel, grain, and basic goods use the remainder.",
    commitment:
      "Dispatches this quarter. A higher share has an explicit donor cost and cannot create mined coal or rail capacity.",
    unit: "% rail",
    min: 30,
    max: 70,
    step: 5,
    defaultValue: 45,
  },
  {
    id: "price-procurement-step",
    label: "Price and procurement package",
    description:
      "Recommend a bounded administered producer/procurement index step; positive steps support delivery incentives but raise subsidy exposure.",
    commitment:
      "Takes effect next quarter. Physical response is delayed, bounded, and may change diversion and crop mix.",
    unit: "% index",
    min: -5,
    max: 15,
    step: 5,
    defaultValue: 0,
    unlockTurn: 3,
  },
  {
    id: "eligible-channel-share",
    label: "Eligible above-plan channel",
    description:
      "Authorize the share of residual eligible output that may use negotiated/direct channels after plan obligations.",
    commitment:
      "Takes effect next quarter; plan and negotiated ledgers remain separate and territorial friction limits realization.",
    unit: "% residual",
    min: 0,
    max: 20,
    step: 5,
    defaultValue: 5,
    unlockTurn: 3,
  },
  {
    id: "credit-project-posture",
    label: "Credit and local-project posture",
    description:
      "−2 suspend/tighten; −1 complete registered work; 0 hold; +1 permissive; +2 expansive local starts.",
    commitment:
      "Bank guidance and project review are partial. Easier posture raises present credit and input claims before capacity.",
    unit: "posture",
    min: -2,
    max: 2,
    step: 1,
    defaultValue: 0,
  },
  {
    id: "strategic-portfolio",
    label: "Strategic capacity portfolio",
    description:
      "0 completion-first; 1 coal; 2 power; 3 rail; 4 fertilizer; 5 consumer goods; 6 broad new construction.",
    commitment:
      "Authorizes one reviewed cohort. It consumes construction service, steel, power, rail, credit, and CWU before commissioning.",
    unit: "code",
    min: 0,
    max: 6,
    step: 1,
    defaultValue: 0,
  },
  {
    id: "conservation-small-scale",
    label: "Conservation and small-scale program",
    description:
      "0 none; 1 conservation audit; 2 technical renovation; 3 approved local small-scale capacity.",
    commitment:
      "Audit precedes savings; renovation and small-scale capacity have downtime, input, quality, and commissioning costs.",
    unit: "code",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 0,
  },
  {
    id: "trade-package",
    label: "Trade and foreign-exchange package",
    description:
      "−2 export drive; −1 hold FX; 0 balanced; +1 commodity imports; +2 equipment imports.",
    commitment:
      "Contracts use FX now; arrivals take two quarters and still require port, rail, or absorptive project capacity.",
    unit: "package",
    min: -2,
    max: 2,
    step: 1,
    defaultValue: 0,
  },
  {
    id: "information-coordination",
    label: "Information and coordination",
    description:
      "0 routine; 1 material audit; 2 project census; 3 crop/procurement survey; 4 joint coal–rail–grid study.",
    commitment:
      "Consumes CWU and improves a later report or compliance response; it never changes physical truth directly.",
    unit: "code",
    min: 0,
    max: 4,
    step: 1,
    defaultValue: 0,
  },
] satisfies ScenarioActionSpec[];

const PROJECT_PARAMETERS: Record<
  ProjectSector,
  Omit<
    Project,
    "id" | "sector" | "origin" | "status" | "startedTurn" | "progress"
  >
> = {
  coal: {
    workRequired: 3.8,
    steelClaim: 7,
    powerClaim: 3.2,
    railClaim: 5,
    creditClaim: 9,
    capacityGain: 5,
  },
  power: {
    workRequired: 4.5,
    steelClaim: 8,
    powerClaim: 3.8,
    railClaim: 5,
    creditClaim: 11,
    capacityGain: 5.5,
  },
  rail: {
    workRequired: 4.2,
    steelClaim: 8.5,
    powerClaim: 2.8,
    railClaim: 6,
    creditClaim: 10,
    capacityGain: 6,
  },
  fertilizer: {
    workRequired: 3.7,
    steelClaim: 6.5,
    powerClaim: 4.2,
    railClaim: 4,
    creditClaim: 8,
    capacityGain: 4,
  },
  consumer: {
    workRequired: 3.2,
    steelClaim: 4.5,
    powerClaim: 3.7,
    railClaim: 3,
    creditClaim: 7,
    capacityGain: 5,
  },
  construction: {
    workRequired: 4,
    steelClaim: 7,
    powerClaim: 3,
    railClaim: 5,
    creditClaim: 9,
    capacityGain: 4,
  },
  renovation: {
    workRequired: 2.4,
    steelClaim: 3.5,
    powerClaim: 2.5,
    railClaim: 2,
    creditClaim: 5,
    capacityGain: 3,
  },
  "local-small-scale": {
    workRequired: 3,
    steelClaim: 5,
    powerClaim: 3.5,
    railClaim: 3,
    creditClaim: 7,
    capacityGain: 3,
  },
};

function emptyFlow(): FlowSnapshot {
  return {
    coalMined: 0,
    coalToPower: 0,
    electricityAvailable: 0,
    electricityServed: 0,
    unservedElectricity: 0,
    railCapacity: 0,
    railRealised: 0,
    railBacklog: 0,
    fertilizerOutput: 0,
    fertilizerToAgriculture: 0,
    cropOutput: 0,
    procurement: 0,
    planConsumerDelivery: 0,
    negotiatedConsumerDelivery: 0,
    consumerDemand: 0,
    projectLoad: 0,
    projectProgress: 0,
    commissionedCapacity: 0,
    creditDraw: 0,
    subsidyClaim: 0,
    binding: ["opening-balance"],
  };
}

function openingReport(): VisibleReport {
  return {
    asOfTurn: 0,
    publishedTurn: 0,
    status: "opening",
    confidence: 0.56,
    grainCover: 2.8,
    procurementFulfilment: 91,
    deliveredCoal: 52,
    unservedElectricity: 7,
    railBacklog: 18,
    fertilizerDelivery: 18,
    consumerFit: 78,
    projectLoad: 30,
    suspectedProjectStarts: 2,
    creditDraw: 14,
    fiscalPressure: 22,
  };
}

function createProject(
  state: BottleneckEconomyState,
  sector: ProjectSector,
  origin: "central" | "local",
  turn: number,
): Project {
  state.projectSequence += 1;
  return {
    id: `${origin}-${sector}-${state.projectSequence}`,
    sector,
    origin,
    status: "active",
    startedTurn: turn,
    progress: 0,
    ...PROJECT_PARAMETERS[sector],
  };
}

function initialState(
  seed: number,
  mode: SimulationMode,
): BottleneckEconomyState {
  const state: BottleneckEconomyState = {
    turn: 0,
    complete: false,
    seed: normaliseSeed(seed),
    mode,
    physical: {
      mineCoal: 17,
      powerCoal: 14,
      stateGrain: 34,
      fertilizer: 9,
      steel: 25,
      consumerGoods: 18,
    },
    capacity: {
      coal: 64,
      power: 60,
      rail: 91,
      fertilizer: 24,
      consumer: 48,
      construction: 31,
    },
    financial: {
      creditOutstanding: 46,
      creditCeiling: 92,
      fiscalPressure: 22,
      retainedFunds: 17,
      localFunds: 13,
      fx: 36,
    },
    policy: {
      priceProcurementStep: 0,
      eligibleResidualShare: 5,
      retentionShare: 12,
      creditPosture: 0,
      conservationEffort: 0,
    },
    pendingPolicies: [],
    projects: [],
    tradePipeline: [],
    flow: emptyFlow(),
    report: openingReport(),
    lastDecision: {
      "energy-freight-priority": 45,
      "price-procurement-step": 0,
      "eligible-channel-share": 5,
      "credit-project-posture": 0,
      "strategic-portfolio": 0,
      "conservation-small-scale": 0,
      "trade-package": 0,
      "information-coordination": 0,
    },
    cwuUsed: 0,
    compliance:
      mode === "guided"
        ? 0.74
        : seededRange(normaliseSeed(seed), "actor-compliance", 0.62, 0.86),
    dataQuality: mode === "sandbox" ? 1 : 0.56,
    projectSequence: 0,
    tradeSequence: 0,
    procurementObligation: 29,
    planConsumerObligation: 38,
    grainUse: 12,
    cumulativePlanShortfall: 0,
    cumulativeUnservedPower: 0,
    provisioningBreachTurns: 0,
    powerBreachTurns: 0,
    stabilizationBreachTurns: 0,
    recentEvents: [
      "Inherited plan balances reconcile nationally, but coal-node stocks, rail requests, and local starts remain uncertain.",
    ],
  };
  state.projects.push(createProject(state, "rail", "central", -2));
  state.projects[0].progress = 1.4;
  state.projects.push(createProject(state, "power", "central", -1));
  state.projects[1].progress = 0.8;
  return state;
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

function cwuClaim(
  state: BottleneckEconomyState,
  decision: ScenarioDecision,
): number {
  const values = decision.values;
  let claim = 1;
  claim +=
    Math.abs(
      decisionValue(
        decision,
        "energy-freight-priority",
        state.lastDecision["energy-freight-priority"],
      ) - state.lastDecision["energy-freight-priority"],
    ) / 12;
  claim +=
    Math.abs(
      decisionValue(
        decision,
        "price-procurement-step",
        state.policy.priceProcurementStep,
      ) - state.policy.priceProcurementStep,
    ) / 8;
  claim +=
    Math.abs(
      decisionValue(
        decision,
        "eligible-channel-share",
        state.policy.eligibleResidualShare,
      ) - state.policy.eligibleResidualShare,
    ) / 12;
  claim += Math.abs(decisionValue(decision, "credit-project-posture", 0)) * 0.8;
  claim += decisionValue(decision, "strategic-portfolio", 0) === 0 ? 0 : 2.5;
  claim += [0, 1.5, 2.5, 3][
    Math.trunc(decisionValue(decision, "conservation-small-scale", 0))
  ] ?? 99;
  claim += Math.abs(decisionValue(decision, "trade-package", 0)) * 0.8;
  claim += [0, 1.5, 2.2, 2, 2.5][
    Math.trunc(decisionValue(decision, "information-coordination", 0))
  ] ?? 99;
  if (!values) return 99;
  return round(claim, 3);
}

function validateDecision(
  state: BottleneckEconomyState,
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
    if ((action.unlockTurn ?? 0) > state.turn) continue;
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
    const steps = (value - action.min) / action.step;
    if (Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) > 1e-8) {
      errors.push(`${action.label} must use increments of ${action.step} ${action.unit}.`);
    }
  }
  for (const id of [
    "credit-project-posture",
    "strategic-portfolio",
    "conservation-small-scale",
    "trade-package",
    "information-coordination",
  ]) {
    if (Number.isFinite(values[id]) && !Number.isInteger(values[id])) {
      errors.push(`${id} must be an integer code.`);
    }
  }
  if (
    decisionValue(decision, "credit-project-posture", 0) <= -2 &&
    decisionValue(decision, "strategic-portfolio", 0) === 6
  ) {
    errors.push(
      "An across-the-board suspension posture cannot authorize broad new construction in the same package.",
    );
  }
  if (
    decisionValue(decision, "trade-package", 0) > 0 &&
    state.financial.fx < 8
  ) {
    errors.push("The foreign-exchange balance cannot fund another import package.");
  }
  const activeProjects = state.projects.filter(
    (project) => project.status === "active",
  ).length;
  if (
    activeProjects >= 7 &&
    decisionValue(decision, "strategic-portfolio", 0) > 0
  ) {
    errors.push(
      "Seven active cohorts already claim the construction ledger; complete or suspend work before another strategic start.",
    );
  }
  const claim = cwuClaim(state, decision);
  if (claim > 10) {
    errors.push(
      `The package claims ${round(claim, 1)} CWU, above the quarterly limit of 10.`,
    );
  }
  if (state.complete) {
    errors.push("The 1983 Q4 balance is closed; no further package can be committed.");
  }
  return errors;
}

function defaultDecision(state: BottleneckEconomyState): ScenarioDecision {
  return {
    values: {
      "energy-freight-priority":
        state.lastDecision["energy-freight-priority"] ?? 45,
      "price-procurement-step": state.policy.priceProcurementStep,
      "eligible-channel-share": state.policy.eligibleResidualShare,
      "credit-project-posture": 0,
      "strategic-portfolio": 0,
      "conservation-small-scale": 0,
      "trade-package": 0,
      "information-coordination": 0,
    },
  };
}

function addContribution(
  contributions: ScenarioContribution[],
  target: string,
  source: string,
  delta: number,
  unit: string,
  explanation: string,
): void {
  contributions.push({
    target,
    source,
    delta: round(delta, 3),
    unit,
    explanation,
  });
}

function enactDuePolicies(
  state: BottleneckEconomyState,
  turn: number,
  events: string[],
): void {
  const due = state.pendingPolicies.filter((policy) => policy.dueTurn <= turn);
  state.pendingPolicies = state.pendingPolicies.filter(
    (policy) => policy.dueTurn > turn,
  );
  if (due.length === 0) return;
  const policy = due.at(-1);
  if (!policy) return;
  state.policy.priceProcurementStep = policy.priceProcurementStep;
  state.policy.eligibleResidualShare = policy.eligibleResidualShare;
  state.policy.retentionShare = policy.retentionShare;
  state.policy.creditPosture = policy.creditPosture;
  events.push(
    "The prior quarter's price, procurement, channel, and credit concurrence became effective; response remains bounded by physical delivery.",
  );
}

function enqueuePolicy(
  state: BottleneckEconomyState,
  decision: ScenarioDecision,
  turn: number,
): void {
  const channel = decisionValue(
    decision,
    "eligible-channel-share",
    state.policy.eligibleResidualShare,
  );
  const credit = decisionValue(decision, "credit-project-posture", 0);
  state.pendingPolicies.push({
    dueTurn: turn + 1,
    priceProcurementStep: decisionValue(
      decision,
      "price-procurement-step",
      state.policy.priceProcurementStep,
    ),
    eligibleResidualShare: channel,
    retentionShare: clamp(12 + channel * 0.45 + Math.max(0, credit) * 3, 8, 27),
    creditPosture: credit,
  });
}

function commissionProject(
  state: BottleneckEconomyState,
  project: Project,
): number {
  project.status = "completed";
  if (project.sector === "renovation") {
    state.capacity.power = round(state.capacity.power + project.capacityGain * 0.55, 4);
    state.capacity.consumer = round(
      state.capacity.consumer + project.capacityGain * 0.45,
      4,
    );
  } else if (project.sector === "local-small-scale") {
    state.capacity.consumer = round(
      state.capacity.consumer + project.capacityGain * 0.65,
      4,
    );
    state.capacity.fertilizer = round(
      state.capacity.fertilizer + project.capacityGain * 0.35,
      4,
    );
  } else {
    state.capacity[project.sector] = round(
      state.capacity[project.sector] + project.capacityGain,
      4,
    );
  }
  return project.capacityGain;
}

function advanceTrade(
  state: BottleneckEconomyState,
  turn: number,
  events: string[],
  contributions: ScenarioContribution[],
): number {
  let equipmentBonus = 0;
  const remaining: TradeCohort[] = [];
  for (const cohort of state.tradePipeline) {
    if (cohort.dueTurn > turn) {
      remaining.push(cohort);
      continue;
    }
    if (cohort.kind === "grain") {
      state.physical.stateGrain += cohort.quantity;
      addContribution(
        contributions,
        "state grain stock",
        "trade-pipeline / commodity-import",
        cohort.quantity,
        "grain units",
        "The contracted commodity shipment arrived after its trade and transport delay.",
      );
    } else if (cohort.kind === "fertilizer") {
      state.physical.fertilizer += cohort.quantity;
    } else if (cohort.kind === "equipment") {
      equipmentBonus += cohort.quantity;
    } else {
      state.physical.consumerGoods = Math.max(
        0,
        state.physical.consumerGoods - cohort.quantity,
      );
      state.financial.fx += cohort.fxCost;
    }
    events.push(
      `${cohort.kind === "export" ? "Export" : "Import"} cohort ${cohort.id} cleared its pipeline.`,
    );
  }
  state.tradePipeline = remaining;
  return equipmentBonus;
}

function contractTrade(
  state: BottleneckEconomyState,
  packageCode: number,
  turn: number,
  events: string[],
): void {
  if (packageCode === 0 || packageCode === -1) return;
  state.tradeSequence += 1;
  if (packageCode === 1) {
    const cost = Math.min(8, state.financial.fx);
    state.financial.fx -= cost;
    state.tradePipeline.push({
      id: `commodity-${state.tradeSequence}`,
      kind: turn % 3 === 1 ? "fertilizer" : "grain",
      dueTurn: turn + 2,
      quantity: cost * 0.9,
      fxCost: -cost,
    });
    events.push("A commodity import contracted now will arrive in two quarters.");
  } else if (packageCode === 2) {
    const cost = Math.min(10, state.financial.fx);
    state.financial.fx -= cost;
    state.tradePipeline.push({
      id: `equipment-${state.tradeSequence}`,
      kind: "equipment",
      dueTurn: turn + 2,
      quantity: cost * 0.16,
      fxCost: -cost,
    });
    events.push(
      "An equipment import contracted now will accelerate eligible project work only after arrival.",
    );
  } else if (packageCode === -2) {
    state.tradePipeline.push({
      id: `export-${state.tradeSequence}`,
      kind: "export",
      dueTurn: turn + 1,
      quantity: 5,
      fxCost: 6,
    });
    events.push(
      "The export package promises foreign exchange next quarter but removes domestic consumer supply.",
    );
  }
}

function applyProjectControl(
  state: BottleneckEconomyState,
  posture: number,
  strategicCode: number,
  conservationCode: number,
  turn: number,
  events: string[],
): void {
  if (posture <= -2) {
    const candidates = state.projects
      .filter(
        (project) =>
          project.status === "active" &&
          project.progress / project.workRequired < 0.68,
      )
      .sort(
        (a, b) =>
          a.progress / a.workRequired - b.progress / b.workRequired,
      );
    const project = candidates[0];
    if (project) {
      project.status = "suspended";
      events.push(
        `${project.id} was suspended; its embedded work remains sunk and adds no capacity.`,
      );
    }
  } else if (posture === -1) {
    const suspended = state.projects
      .filter((project) => project.status === "suspended")
      .sort(
        (a, b) =>
          b.progress / b.workRequired - a.progress / a.workRequired,
      )[0];
    if (suspended) {
      suspended.status = "active";
      events.push(`${suspended.id} resumed under completion-first guidance.`);
    }
  }

  const strategicSector: Record<number, ProjectSector> = {
    1: "coal",
    2: "power",
    3: "rail",
    4: "fertilizer",
    5: "consumer",
    6: "construction",
  };
  const sector = strategicSector[strategicCode];
  if (sector) {
    const project = createProject(state, sector, "central", turn);
    state.projects.push(project);
    events.push(
      `${project.id} was authorized; its present input claim precedes any commissioned capacity.`,
    );
  }

  if (conservationCode === 2) {
    const project = createProject(state, "renovation", "central", turn);
    state.projects.push(project);
    events.push(
      `${project.id} entered technical renovation, including a short current-service penalty.`,
    );
  } else if (conservationCode === 3) {
    const project = createProject(
      state,
      "local-small-scale",
      "local",
      turn,
    );
    state.projects.push(project);
    events.push(
      `${project.id} was registered; local scale does not exempt it from finance, inputs, or commissioning.`,
    );
  }
}

function maybeRealiseUnregisteredStart(
  state: BottleneckEconomyState,
  turn: number,
  events: string[],
): number {
  const impulse =
    Math.max(0, state.policy.creditPosture) * 0.22 +
    state.policy.retentionShare / 100 +
    state.policy.eligibleResidualShare / 180;
  const threshold = seededRange(
    state.seed,
    `local-start-threshold:${turn}`,
    0.38,
    0.72,
  );
  if (impulse * (1.35 - state.compliance * 0.55) <= threshold) return 0;
  const project = createProject(
    state,
    "local-small-scale",
    "local",
    turn,
  );
  state.projects.push(project);
  events.push(
    "A locally financed project began outside the complete central return; its claims are physical even before the census catches it.",
  );
  return 1;
}

function advanceProjects(
  state: BottleneckEconomyState,
  equipmentBonus: number,
  posture: number,
  flow: FlowSnapshot,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  const active = state.projects.filter(
    (project) => project.status === "active",
  );
  if (active.length === 0) return;
  const completionFirst = posture < 0;
  active.sort((a, b) =>
    completionFirst
      ? b.progress / b.workRequired - a.progress / a.workRequired
      : a.startedTurn - b.startedTurn,
  );
  const constructionPool = state.capacity.construction * 0.36;
  const steelPool = Math.max(0, state.physical.steel);
  const powerPool = Math.max(0, flow.electricityAvailable * 0.2);
  const railPool = Math.max(0, flow.railCapacity * 0.15);
  const postureFinance =
    posture <= -2 ? 0.55 : posture === -1 ? 0.85 : 1 + posture * 0.17;
  const financePool = Math.max(
    0,
    (state.financial.creditCeiling - state.financial.creditOutstanding) *
      0.45 *
      postureFinance,
  );
  const count = active.length;
  let constructionLeft = constructionPool;
  let steelLeft = steelPool;
  let powerLeft = powerPool;
  let railLeft = railPool;
  let financeLeft = financePool;
  let equipmentLeft = equipmentBonus;

  for (const project of active) {
    const remaining = project.workRequired - project.progress;
    const fairConstruction = constructionLeft / Math.max(1, count);
    const work = clamp(
      Math.min(
        remaining,
        fairConstruction,
        steelLeft / project.steelClaim,
        powerLeft / project.powerClaim,
        railLeft / project.railClaim,
        financeLeft / project.creditClaim,
      ) + Math.min(remaining, equipmentLeft * 0.25),
      0,
      1,
    );
    if (work <= 0) continue;
    const steelUsed = work * project.steelClaim;
    const powerUsed = work * project.powerClaim;
    const railUsed = work * project.railClaim;
    const creditUsed = work * project.creditClaim;
    project.progress = round(project.progress + work, 6);
    constructionLeft = Math.max(0, constructionLeft - work);
    steelLeft = Math.max(0, steelLeft - steelUsed);
    powerLeft = Math.max(0, powerLeft - powerUsed);
    railLeft = Math.max(0, railLeft - railUsed);
    financeLeft = Math.max(0, financeLeft - creditUsed);
    equipmentLeft = Math.max(0, equipmentLeft - work);
    state.physical.steel = Math.max(0, state.physical.steel - steelUsed);
    state.financial.creditOutstanding += creditUsed;
    flow.projectLoad += steelUsed + powerUsed + railUsed;
    flow.projectProgress += work;
    flow.creditDraw += creditUsed;
    addContribution(
      contributions,
      "active construction load",
      "project-input-claim",
      steelUsed + powerUsed + railUsed,
      "input-load units",
      `${project.id} embedded current steel, electricity, and rail service before adding capacity.`,
    );
    if (project.progress + 1e-8 >= project.workRequired) {
      const gain = commissionProject(state, project);
      flow.commissionedCapacity += gain;
      events.push(
        `${project.id} commissioned after completing its complementary works; ${round(gain, 1)} capacity units begin service.`,
      );
      addContribution(
        contributions,
        "commissioned useful capacity",
        "commissioned-capacity",
        gain,
        "capacity units",
        "Only a completed milestone added productive capacity.",
      );
    }
  }
}

function seasonalCropBase(turn: number): number {
  const quarter = ((turn - 1) % 4) + 1;
  return [17, 23, 43, 31][quarter - 1] ?? 25;
}

function computePhysicalSystem(
  state: BottleneckEconomyState,
  decision: ScenarioDecision,
  turn: number,
  flow: FlowSnapshot,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  const weather =
    state.mode === "guided" && turn === 6
      ? 0.87
      : seededRange(state.seed, `weather:${turn}`, 0.88, 1.09);
  const hydrology =
    state.mode === "guided" && turn === 9
      ? 0.79
      : seededRange(state.seed, `hydrology:${turn}`, 0.82, 1.08);
  const conservation = state.policy.conservationEffort;
  const minePowerNeed = 8;
  const minePowerFactor = clamp(
    (state.capacity.power - minePowerNeed) / (state.capacity.power * 0.9),
    0.72,
    1,
  );
  const incentive =
    1 +
    clamp(state.policy.priceProcurementStep, -5, 15) * 0.0035 +
    state.policy.retentionShare * 0.001;
  flow.coalMined = round(
    Math.min(
      state.capacity.coal,
      state.capacity.coal * minePowerFactor * incentive,
    ),
    4,
  );
  state.physical.mineCoal += flow.coalMined;

  flow.railCapacity = round(
    state.capacity.rail *
      seededRange(state.seed, `rail-availability:${turn}`, 0.88, 1.02),
    4,
  );
  const freightPriority =
    decisionValue(decision, "energy-freight-priority", 45) / 100;
  const powerRailEnvelope = flow.railCapacity * freightPriority;
  const generatorRequest =
    state.capacity.power * 0.92 - state.physical.powerCoal;
  flow.coalToPower = round(
    Math.min(
      Math.max(0, generatorRequest),
      state.physical.mineCoal,
      powerRailEnvelope / 0.72,
    ),
    4,
  );
  state.physical.mineCoal -= flow.coalToPower;
  state.physical.powerCoal += flow.coalToPower;

  const fuelEnvelope = state.physical.powerCoal * 1.04;
  const hydroEnvelope = state.capacity.power * hydrology;
  flow.electricityAvailable = round(
    Math.min(state.capacity.power, fuelEnvelope + 8, hydroEnvelope),
    4,
  );
  const demand =
    66 +
    state.projects.filter((project) => project.status === "active").length *
      1.7 -
    conservation * 2.2;
  flow.electricityServed = round(
    Math.min(flow.electricityAvailable, demand),
    4,
  );
  flow.unservedElectricity = round(
    Math.max(0, demand - flow.electricityServed),
    4,
  );
  const coalBurn = Math.min(
    state.physical.powerCoal,
    Math.max(0, flow.electricityAvailable - 8) / 1.04,
  );
  state.physical.powerCoal -= coalBurn;

  const nonPowerRail = Math.max(
    0,
    flow.railCapacity - flow.coalToPower * 0.72,
  );
  const fertilizerRail = nonPowerRail * 0.25;
  const consumerRail = nonPowerRail * 0.28;
  const steelRail = nonPowerRail * 0.22;
  flow.railRealised = round(
    flow.coalToPower * 0.72 +
      fertilizerRail +
      consumerRail +
      steelRail,
    4,
  );
  const railRequest =
    105 +
    state.projects.filter((project) => project.status === "active").length *
      4;
  flow.railBacklog = round(Math.max(0, railRequest - flow.railRealised), 4);

  const powerServiceRatio = flow.electricityServed / Math.max(1, demand);
  const fertilizerPotential = Math.min(
    state.capacity.fertilizer,
    fertilizerRail / 0.78,
    state.capacity.fertilizer * powerServiceRatio,
  );
  flow.fertilizerOutput = round(Math.max(0, fertilizerPotential), 4);
  state.physical.fertilizer += flow.fertilizerOutput;
  flow.fertilizerToAgriculture = round(
    Math.min(state.physical.fertilizer, 19 + turn * 0.35),
    4,
  );
  state.physical.fertilizer -= flow.fertilizerToAgriculture;

  const agInputFactor = clamp(
    0.7 + flow.fertilizerToAgriculture / 65 + powerServiceRatio * 0.08,
    0.76,
    1.06,
  );
  const procurementIncentive =
    1 + clamp(state.policy.priceProcurementStep, -5, 15) * 0.0025;
  flow.cropOutput = round(
    seasonalCropBase(turn) * weather * agInputFactor * procurementIncentive,
    4,
  );
  const procurementShare = clamp(
    0.52 +
      state.policy.priceProcurementStep * 0.002 -
      state.policy.eligibleResidualShare * 0.001,
    0.45,
    0.59,
  );
  flow.procurement = round(
    Math.min(flow.cropOutput * procurementShare, state.procurementObligation),
    4,
  );
  state.physical.stateGrain += flow.procurement;
  const grainIssued = Math.min(state.grainUse, state.physical.stateGrain);
  state.physical.stateGrain -= grainIssued;

  const steelOutput = Math.min(
    31,
    28 * powerServiceRatio,
    steelRail / 0.62,
  );
  state.physical.steel += Math.max(0, steelOutput);
  const consumerPotential = Math.min(
    state.capacity.consumer,
    state.capacity.consumer * powerServiceRatio,
    consumerRail / 0.52,
  );
  state.physical.consumerGoods += Math.max(0, consumerPotential);
  const planAvailable = Math.min(
    state.physical.consumerGoods,
    state.planConsumerObligation,
  );
  flow.planConsumerDelivery = round(planAvailable, 4);
  state.physical.consumerGoods -= flow.planConsumerDelivery;
  const eligibleResidual = Math.min(
    state.physical.consumerGoods,
    Math.max(
      0,
      consumerPotential - flow.planConsumerDelivery,
    ) *
      (state.policy.eligibleResidualShare / 100) *
      state.compliance,
  );
  flow.negotiatedConsumerDelivery = round(eligibleResidual, 4);
  state.physical.consumerGoods -= flow.negotiatedConsumerDelivery;
  flow.consumerDemand = round(
    44 +
      state.policy.retentionShare * 0.14 +
      state.policy.priceProcurementStep * 0.08,
    4,
  );

  const planShortfall =
    Math.max(0, state.procurementObligation - flow.procurement) +
    Math.max(0, state.planConsumerObligation - flow.planConsumerDelivery);
  state.cumulativePlanShortfall += planShortfall;
  state.cumulativeUnservedPower += flow.unservedElectricity;
  flow.binding = [];
  if (flow.coalToPower + 0.01 >= powerRailEnvelope / 0.72) {
    flow.binding.push("rail-haul-to-generator");
  }
  if (flow.electricityAvailable + 0.01 >= hydroEnvelope) {
    flow.binding.push("hydrology-generation-envelope");
  } else if (flow.electricityAvailable + 0.01 >= fuelEnvelope + 8) {
    flow.binding.push("generator-coal-stock");
  } else {
    flow.binding.push("installed-generation-capacity");
  }
  if (fertilizerPotential + 0.01 >= fertilizerRail / 0.78) {
    flow.binding.push("fertilizer-rail-service");
  } else if (fertilizerPotential + 0.01 >= state.capacity.fertilizer) {
    flow.binding.push("fertilizer-capacity");
  }
  if (state.physical.steel < 8) flow.binding.push("project-steel");
  if (
    state.financial.creditOutstanding >
    state.financial.creditCeiling * 0.9
  ) {
    flow.binding.push("credit-ceiling");
  }

  addContribution(
    contributions,
    "delivered generator coal",
    "rail-haul",
    flow.coalToPower,
    "coal units",
    "Mine output entered the power node only through the reserved tonne-kilometre envelope.",
  );
  addContribution(
    contributions,
    "electricity service loss",
    "load-shedding",
    -flow.unservedElectricity,
    "service units",
    "Demand above the fuel, hydrology, and installed-capacity minimum was unserved.",
  );
  addContribution(
    contributions,
    "crop output",
    "fertilizer-to-crop",
    flow.cropOutput - seasonalCropBase(turn),
    "crop units",
    "Weather, delivered fertilizer, irrigation service, and a bounded incentive term modified the seasonal base.",
  );
  addContribution(
    contributions,
    "state provisioning",
    "procurement-delivery",
    flow.procurement,
    "grain units",
    "Only realized state procurement entered the provisioning stock.",
  );
  addContribution(
    contributions,
    "consumer supply",
    "negotiated-release",
    flow.negotiatedConsumerDelivery,
    "goods units",
    "Eligible residual output entered the bounded negotiated channel only after plan delivery.",
  );
  if (turn === 6) {
    events.push(
      "The crop and procurement return revised the seasonal picture; the revision changes belief, not the past harvest.",
    );
  }
  if (turn === 9 && flow.unservedElectricity > 4) {
    events.push(
      "The coal–rail–power squeeze materialized: additional mine stock alone could not bypass freight and hydrology limits.",
    );
  }
}

function settleFinance(
  state: BottleneckEconomyState,
  flow: FlowSnapshot,
  posture: number,
  contributions: ScenarioContribution[],
): void {
  const repayment = Math.min(
    state.financial.creditOutstanding,
    5 + Math.max(0, -posture) * 2,
  );
  state.financial.creditOutstanding = Math.max(
    0,
    state.financial.creditOutstanding - repayment,
  );
  const procurementSubsidy =
    flow.procurement * Math.max(0, state.policy.priceProcurementStep) * 0.07;
  const administeredEnergySubsidy =
    flow.electricityServed *
    Math.max(0, state.policy.priceProcurementStep) *
    0.018;
  flow.subsidyClaim = round(
    procurementSubsidy + administeredEnergySubsidy,
    4,
  );
  state.financial.fiscalPressure = round(
    clamp(
      state.financial.fiscalPressure +
        flow.subsidyClaim +
        Math.max(0, flow.creditDraw - 12) * 0.16 -
        3.5,
      0,
      100,
    ),
    4,
  );
  const retainedIncrement =
    (flow.planConsumerDelivery + flow.negotiatedConsumerDelivery) *
    (state.policy.retentionShare / 100) *
    0.22;
  state.financial.retainedFunds += retainedIncrement;
  state.financial.localFunds += retainedIncrement * (1 - state.compliance * 0.35);
  addContribution(
    contributions,
    "fiscal pressure",
    "price-fiscal-subsidy",
    flow.subsidyClaim,
    "fiscal units",
    "Producer and procurement price support without full retail pass-through generated a subsidy claim.",
  );
}

function updateInformation(
  state: BottleneckEconomyState,
  informationCode: number,
  turn: number,
  unregisteredStarts: number,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  const inquiryGain = [0, 0.08, 0.14, 0.1, 0.13][informationCode] ?? 0;
  state.dataQuality = clamp(
    state.dataQuality * 0.94 + 0.015 + inquiryGain,
    0.35,
    0.96,
  );
  if (informationCode === 2) {
    state.compliance = clamp(state.compliance + 0.045, 0.45, 0.94);
    events.push(
      "The project census improved the registered/local comparison; it did not cancel real input claims.",
    );
  } else if (informationCode === 4) {
    events.push(
      "The joint mine–rail–grid study narrowed the location of the physical binding set.",
    );
  } else if (informationCode === 3) {
    events.push(
      "The crop/procurement survey improves the next report vintage without changing output.",
    );
  } else if (informationCode === 1) {
    events.push(
      "The material audit reconciled part of the plan and negotiated ledgers.",
    );
  }

  const width = state.mode === "sandbox" ? 0 : (1 - state.dataQuality) * 0.16;
  const reportBias =
    (seededRange(state.seed, `report-bias:${turn}`, -1, 1) * width);
  const grainCover = state.physical.stateGrain / Math.max(1, state.grainUse);
  const procurementFulfilment =
    (state.flow.procurement / Math.max(1, state.procurementObligation)) * 100;
  const consumerFit =
    ((state.flow.planConsumerDelivery +
      state.flow.negotiatedConsumerDelivery) /
      Math.max(1, state.flow.consumerDemand)) *
    100;
  const suspectedProjects =
    state.projects.filter(
      (project) =>
        project.origin === "local" &&
        project.status === "active" &&
        (project.startedTurn >= turn - 2 || informationCode === 2),
    ).length + unregisteredStarts;
  const status =
    informationCode > 0 || turn === 6 || turn === 8
      ? "revised"
      : "preliminary";
  state.report = {
    asOfTurn: turn,
    publishedTurn: turn,
    status,
    confidence: round(state.dataQuality, 3),
    grainCover: round(Math.max(0, grainCover * (1 + reportBias)), 2),
    procurementFulfilment: round(
      clamp(procurementFulfilment * (1 - reportBias), 0, 120),
      1,
    ),
    deliveredCoal: round(Math.max(0, state.flow.coalToPower * (1 + reportBias)), 2),
    unservedElectricity: round(
      Math.max(0, state.flow.unservedElectricity * (1 - reportBias)),
      2,
    ),
    railBacklog: round(Math.max(0, state.flow.railBacklog * (1 + reportBias)), 2),
    fertilizerDelivery: round(
      Math.max(0, state.flow.fertilizerToAgriculture * (1 - reportBias)),
      2,
    ),
    consumerFit: round(clamp(consumerFit * (1 + reportBias), 0, 120), 1),
    projectLoad: round(Math.max(0, state.flow.projectLoad * (1 + reportBias)), 2),
    suspectedProjectStarts: suspectedProjects,
    creditDraw: round(Math.max(0, state.flow.creditDraw * (1 - reportBias)), 2),
    fiscalPressure: round(
      clamp(state.financial.fiscalPressure * (1 + reportBias), 0, 100),
      1,
    ),
  };
  if (status === "revised") {
    addContribution(
      contributions,
      "visible report confidence",
      "report-revision",
      inquiryGain * 100,
      "confidence points",
      "The revised vintage changes the desk's estimate, not the underlying physical ledger.",
    );
  }
}

function assertState(state: BottleneckEconomyState): void {
  const numbers = [
    state.turn,
    state.cwuUsed,
    state.compliance,
    state.dataQuality,
    ...Object.values(state.physical),
    ...Object.values(state.capacity),
    ...Object.values(state.financial),
    ...Object.values(state.policy),
    ...Object.values(state.flow).filter(
      (value): value is number => typeof value === "number",
    ),
  ];
  if (numbers.some((value) => !Number.isFinite(value))) {
    throw new Error(
      "Bottleneck Economy invariant failed: a ledger value is non-finite.",
    );
  }
  if (
    Object.values(state.physical).some((value) => value < -0.001) ||
    Object.values(state.capacity).some((value) => value < 0) ||
    state.financial.creditOutstanding < 0 ||
    state.financial.fx < -0.001
  ) {
    throw new Error(
      "Bottleneck Economy invariant failed: a physical, capacity, credit, or FX ledger is negative.",
    );
  }
  if (
    state.compliance < 0 ||
    state.compliance > 1 ||
    state.dataQuality < 0 ||
    state.dataQuality > 1
  ) {
    throw new Error(
      "Bottleneck Economy invariant failed: a bounded share left [0, 1].",
    );
  }
  for (const project of state.projects) {
    if (
      !Number.isFinite(project.progress) ||
      project.progress < 0 ||
      project.progress > project.workRequired + 0.001
    ) {
      throw new Error(
        `Bottleneck Economy project invariant failed for ${project.id}.`,
      );
    }
    if (
      project.status === "completed" &&
      project.progress + 0.001 < project.workRequired
    ) {
      throw new Error(
        `Bottleneck Economy commissioning invariant failed for ${project.id}.`,
      );
    }
  }
}

function step(
  current: BottleneckEconomyState,
  decision: ScenarioDecision,
): ScenarioStepResult<BottleneckEconomyState> {
  const state = cloneJson(current);
  const turn = state.turn + 1;
  const events: string[] = [];
  const contributions: ScenarioContribution[] = [];
  const flow = emptyFlow();
  state.cwuUsed = cwuClaim(state, decision);

  enactDuePolicies(state, turn, events);
  enqueuePolicy(state, decision, turn);
  const tradeCode = decisionValue(decision, "trade-package", 0);
  contractTrade(state, tradeCode, turn, events);
  const equipmentBonus = advanceTrade(
    state,
    turn,
    events,
    contributions,
  );
  const posture = decisionValue(decision, "credit-project-posture", 0);
  const strategic = decisionValue(decision, "strategic-portfolio", 0);
  const conservation = decisionValue(
    decision,
    "conservation-small-scale",
    0,
  );
  state.policy.conservationEffort =
    conservation === 1 ? 1 : state.policy.conservationEffort * 0.72;
  applyProjectControl(
    state,
    posture,
    strategic,
    conservation,
    turn,
    events,
  );
  const unregisteredStarts = maybeRealiseUnregisteredStart(
    state,
    turn,
    events,
  );

  computePhysicalSystem(
    state,
    decision,
    turn,
    flow,
    events,
    contributions,
  );
  advanceProjects(
    state,
    equipmentBonus,
    posture,
    flow,
    events,
    contributions,
  );
  state.flow = flow;
  settleFinance(state, flow, posture, contributions);
  if (state.financial.creditOutstanding > state.financial.creditCeiling) {
    state.stabilizationBreachTurns += 1;
    events.push(
      "Realized credit draw exceeded the guidance ceiling; the breach remains even if the next package tightens.",
    );
  } else if (state.financial.fiscalPressure > 70) {
    state.stabilizationBreachTurns += 1;
  }
  if (state.physical.stateGrain / state.grainUse < 1.5) {
    state.provisioningBreachTurns += 1;
  }
  if (flow.unservedElectricity > 9) state.powerBreachTurns += 1;

  updateInformation(
    state,
    decisionValue(decision, "information-coordination", 0),
    turn,
    unregisteredStarts,
    events,
    contributions,
  );
  state.lastDecision = cloneJson(decision.values);
  state.turn = turn;
  state.complete = turn >= TOTAL_TURNS;
  state.recentEvents = events.slice(-5);
  assertState(state);

  const principalBinding = flow.binding[0] ?? "material balance";
  const headline =
    flow.commissionedCapacity > 0
      ? `${round(flow.commissionedCapacity, 1)} useful capacity units commissioned; ${principalBinding} now leads the binding set.`
      : `${principalBinding} constrained the quarter; ${round(flow.projectLoad, 1)} current input units went to active projects.`;
  return { state, headline, events, contributions };
}

function statusHigh(
  value: number,
  secure: number,
  critical: number,
): ScenarioStatus {
  return value >= secure ? "secure" : value >= critical ? "watch" : "critical";
}

function statusLow(
  value: number,
  secure: number,
  critical: number,
): ScenarioStatus {
  return value <= secure ? "secure" : value <= critical ? "watch" : "critical";
}

function phaseForTurn(turn: number): {
  phase: string;
  description: string;
} {
  const nextTurn = Math.min(turn + 1, TOTAL_TURNS);
  if (nextTurn <= 3) {
    return {
      phase: "Balance Desk",
      description:
        "Reconcile coal nodes, executable rail service, stocks, and inherited projects before promising output.",
    };
  }
  if (nextTurn <= 6) {
    return {
      phase: "Incentives and Channels",
      description:
        "Use bounded price, procurement, retention, and above-plan rules while protecting plan delivery and fiscal space.",
    };
  }
  if (nextTurn <= 9) {
    return {
      phase: "Investment Cascade",
      description:
        "Read credit and project discrepancies, triage WIP, and anticipate how construction claims move the bottleneck.",
    };
  }
  return {
    phase: "Resilience",
    description:
      "Commission complementary capacity, preserve stocks and credit headroom, and leave a feasible next-year balance.",
  };
}

function getView(state: BottleneckEconomyState): ScenarioView {
  const phase = phaseForTurn(state.turn);
  const report = state.report;
  const activeProjects = state.projects.filter(
    (project) => project.status === "active",
  );
  const unfinishedWork = activeProjects.reduce(
    (sum, project) => sum + project.workRequired - project.progress,
    0,
  );
  const creditHeadroom =
    state.financial.creditCeiling - state.financial.creditOutstanding;
  const alerts = [];
  if (report.grainCover < 1.5) {
    alerts.push({
      id: "grain-floor",
      severity: "critical" as const,
      message:
        "Reported state grain cover is below the basic-provisioning floor; the next crop vintage may revise the estimate.",
    });
  }
  if (report.unservedElectricity > 8) {
    alerts.push({
      id: "power-service",
      severity: "critical" as const,
      message:
        "Essential power service is under severe pressure; inspect fuel-at-node, freight, and hydrology together.",
    });
  }
  if (creditHeadroom < 12) {
    alerts.push({
      id: "credit",
      severity: creditHeadroom < 0 ? ("critical" as const) : ("warning" as const),
      message:
        "Credit headroom is thin while active projects retain physical claims.",
    });
  }
  if (state.cwuUsed > 8) {
    alerts.push({
      id: "coordination",
      severity: "warning" as const,
      message:
        "The last package nearly saturated quarterly coordination capacity; concurrent changes may dilute implementation.",
    });
  }
  if (
    activeProjects.length >= 5 &&
    state.flow.commissionedCapacity === 0
  ) {
    alerts.push({
      id: "wip-tail",
      severity: "warning" as const,
      message:
        "The active portfolio is widening without a commission this quarter; starts are current claims, not capacity.",
    });
  }
  if (state.flow.binding.length > 1) {
    alerts.push({
      id: "binding-set",
      severity: "info" as const,
      message: `Reported near-binding set: ${state.flow.binding.join(" → ")}. The bottleneck may migrate after intervention.`,
    });
  }

  const procurementStatus = statusHigh(
    report.procurementFulfilment,
    90,
    76,
  );
  const energyStatus = statusLow(report.unservedElectricity, 4, 9);
  const consumerStatus = statusHigh(report.consumerFit, 88, 70);
  const fiscalStatus = statusLow(report.fiscalPressure, 50, 72);
  const planIntegrity = clamp(
    100 - state.cumulativePlanShortfall / Math.max(1, state.turn) * 1.1,
    0,
    100,
  );
  const capacityReadiness = clamp(
    100 -
      unfinishedWork * 4 +
      state.projects.filter((project) => project.status === "completed").length *
        7,
    0,
    100,
  );
  const resilience = clamp(
    report.grainCover * 15 +
      Math.max(0, creditHeadroom) * 0.8 +
      Math.max(0, state.financial.fx) * 0.7 -
      unfinishedWork * 2,
    0,
    100,
  );
  const summary =
    state.turn === 0
      ? "The inherited national balance conceals where coal, freight, power, and project claims actually bind."
      : `${report.status[0].toUpperCase()}${report.status.slice(1)} Q${report.asOfTurn} returns place ${state.flow.binding[0] ?? "the material balance"} at the front of the constraint set.`;

  return {
    dateLabel:
      state.turn >= TOTAL_TURNS
        ? "1983 Q4 close"
        : QUARTER_LABELS[state.turn] ?? "1983 Q4",
    phase: phase.phase,
    phaseDescription: phase.description,
    summary,
    metrics: [
      {
        id: "grain-cover",
        label: "State grain cover",
        value: report.grainCover,
        unit: "quarters",
        status: statusHigh(report.grainCover, 2.3, 1.5),
        detail: `${report.status} return, as of Q${report.asOfTurn}; procurement and stocks are not household welfare.`,
      },
      {
        id: "procurement",
        label: "Procurement fulfilment",
        value: report.procurementFulfilment,
        unit: "%",
        status: procurementStatus,
        detail:
          "Realized plan delivery after crop, incentive, input, and bounded channel effects.",
      },
      {
        id: "coal-delivered",
        label: "Coal delivered to power",
        value: report.deliveredCoal,
        unit: "coal units",
        status: statusHigh(report.deliveredCoal, 48, 38),
        detail:
          "Mine output is excluded until rail service places coal at the generator node.",
      },
      {
        id: "unserved-power",
        label: "Unserved electricity",
        value: report.unservedElectricity,
        unit: "service units",
        status: energyStatus,
        detail:
          "Minimum of installed capacity, fuel-at-node, hydrology/grid availability, and demand.",
      },
      {
        id: "rail-backlog",
        label: "Rail priority backlog",
        value: report.railBacklog,
        unit: "freight units",
        status: statusLow(report.railBacklog, 30, 48),
        detail:
          "Requested movement minus realized tonne-kilometre service; tonnes are not interchangeable across distance.",
      },
      {
        id: "fertilizer",
        label: "Fertilizer to agriculture",
        value: report.fertilizerDelivery,
        unit: "input units",
        status: statusHigh(report.fertilizerDelivery, 18, 13),
        detail:
          "Delivered agricultural input after plant power and rail constraints.",
      },
      {
        id: "consumer-fit",
        label: "Consumer supply fit",
        value: report.consumerFit,
        unit: "%",
        status: consumerStatus,
        detail:
          "Plan plus eligible negotiated delivery relative to a demand-pressure index; not utility or welfare.",
      },
      {
        id: "project-load",
        label: "Active construction load",
        value: report.projectLoad,
        unit: "input-load units",
        status: statusLow(report.projectLoad, 35, 58),
        detail: `${activeProjects.length} active cohorts; ${round(unfinishedWork, 1)} work units remain before commissioning.`,
      },
      {
        id: "credit-headroom",
        label: "Credit headroom",
        value: round(creditHeadroom, 1),
        unit: "credit units",
        status: statusHigh(creditHeadroom, 25, 0),
        detail:
          "Ceiling less outstanding draw; retained and local funds are separate ledgers.",
      },
      {
        id: "fiscal-pressure",
        label: "Fiscal/subsidy pressure",
        value: report.fiscalPressure,
        unit: "index",
        status: fiscalStatus,
        detail:
          "A provisional signed ledger, not a general-equilibrium budget or monetary model.",
      },
      {
        id: "fx-cover",
        label: "Foreign-exchange cover",
        value: round(state.financial.fx, 1),
        unit: "FX units",
        status: statusHigh(state.financial.fx, 22, 8),
        detail:
          "Imports have contract and transit delays; equipment also needs an eligible project.",
      },
      {
        id: "report-confidence",
        label: "Report confidence",
        value: round(report.confidence * 100, 0),
        unit: "%",
        status: statusHigh(report.confidence, 0.72, 0.48),
        detail:
          "Confidence describes the current vintage. Revisions never rewrite past true state.",
      },
    ],
    objectives: [
      {
        id: "basic-provisioning",
        label: "P1 Basic provisioning",
        priority: 1,
        value: report.grainCover,
        unit: "quarters cover",
        status: statusHigh(report.grainCover, 2.3, 1.5),
        hard: true,
      },
      {
        id: "essential-energy",
        label: "P2 Essential energy service",
        priority: 2,
        value: report.unservedElectricity,
        unit: "unserved units",
        status: energyStatus,
        hard: true,
      },
      {
        id: "stabilization",
        label: "P3 Stabilization",
        priority: 3,
        value: report.fiscalPressure,
        unit: "pressure index",
        status: fiscalStatus,
        hard: true,
      },
      {
        id: "plan-integrity",
        label: "P4 Essential plan integrity",
        priority: 4,
        value: round(planIntegrity, 0),
        unit: "index",
        status: statusHigh(planIntegrity, 85, 65),
        hard: false,
      },
      {
        id: "living-supply",
        label: "P5 Living-standard supply fit",
        priority: 5,
        value: report.consumerFit,
        unit: "%",
        status: consumerStatus,
        hard: false,
      },
      {
        id: "efficient-capacity",
        label: "P6 Useful capacity / WIP",
        priority: 6,
        value: round(capacityReadiness, 0),
        unit: "readiness index",
        status: statusHigh(capacityReadiness, 75, 52),
        hard: false,
      },
      {
        id: "terminal-resilience",
        label: "P7 Terminal resilience",
        priority: 7,
        value: round(resilience, 0),
        unit: "buffer index",
        status: statusHigh(resilience, 65, 42),
        hard: false,
      },
    ],
    alerts,
  };
}

const bottleneckEconomyTypedModel: ScenarioModel<BottleneckEconomyState> = {
  metadata: {
    id: "bottleneck-economy-1981",
    version: "0.1.0-candidate",
    title: "Bottleneck Economy, 1981",
    shortTitle: "Bottleneck Economy",
    deck:
      "Manage a moving, coupled constraint system while adjustment, bounded market channels, local initiative, credit, and incomplete reports coexist.",
    fidelity:
      "Historically grounded counterfactual with a composite central role and uncalibrated analytic mechanisms",
    role:
      "Deputy Convenor, Joint National Economic Adjustment Desk (composite)",
    period: "1981 Q1–1983 Q4",
    turnLabel: "Quarter",
    totalTurns: TOTAL_TURNS,
    sessionLength: "45–65 minutes",
    briefing: [
      "Your mandate is adjustment and stabilization: protect agriculture and basic supply, conserve scarce service, and sequence selected energy, transport, renovation, and consumer capacity.",
      "Coal must be mined, hauled to the right node, and converted through available generation and grid service. A national balance can coexist with a local shortage.",
      "Planned obligations and administered prices remain central. Eligible above-plan, negotiated, direct, and rural-market channels are bounded additions after obligations, not automatic market clearing.",
      "Credit, retained funds, and local initiative can start projects the desk does not fully observe. Every start claims current steel, power, rail, construction, finance, and coordination before commissioning.",
    ],
    learningObjectives: [
      "Locate a bottleneck as it migrates through coal extraction, rail haulage, generation, inputs, and end use.",
      "Distinguish a price or retention incentive from the delayed physical channel through which it can respond.",
      "Sequence completion, renovation, and new starts while accounting for WIP, sunk work, and complementary infrastructure.",
      "Use dated, revisable reports without confusing improved information with changed physical truth.",
    ],
    modelNote:
      "This is explicitly an incipient, bounded two-channel system under 1979–83 adjustment and stabilization—not the mature mid-1980s industrial dual-price regime. The role, sector aggregation, CWU, behavioral response, local compliance, report error, project coefficients, thresholds, and all numerical quantities are fictional or assumed teaching constructs pending historian review, calibration, game validation, and learning validation. The model does not resolve contested attribution of agricultural gains, infer welfare or justice, simulate coercion/politics/safety/environment, or establish an alternative history.",
    accent: "#c28a52",
  },
  actions: ACTIONS,
  createInitialState: initialState,
  defaultDecision,
  validateDecision,
  step,
  getView,
};

export const bottleneckEconomyModel =
  bottleneckEconomyTypedModel as unknown as AnyScenarioModel;

export { bottleneckEconomyTypedModel };
