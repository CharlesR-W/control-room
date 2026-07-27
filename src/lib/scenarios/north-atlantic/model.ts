import type { SimulationMode } from "../../sim/types.ts";
import {
  clamp,
  cloneJson,
  decisionValue,
  deterministicFloat,
  normaliseSeed,
  round,
} from "../helpers.ts";
import type {
  AnyScenarioModel,
  ScenarioActionSpec,
  ScenarioContribution,
  ScenarioDecision,
  ScenarioModel,
  ScenarioObjective,
  ScenarioState,
  ScenarioStatus,
  ScenarioStepResult,
  ScenarioView,
} from "../types.ts";

type CargoClass = "food" | "petroleum" | "dry";
type Service = "HX" | "SC";
type RoutePosture = 0 | 1 | 2;
type CargoLedger = Record<CargoClass, number>;

type Assembly = {
  id: string;
  service: Service;
  createdTurn: number;
  age: number;
  targetShips: number;
  ships: number;
  cargo: CargoLedger;
};

type Convoy = {
  id: string;
  service: Service;
  sailedTurn: number;
  assemblyWeeks: number;
  posture: RoutePosture;
  ships: number;
  damagedShips: number;
  cargo: CargoLedger;
  escorts: number;
  transitWeek: number;
  passageRemaining: number;
};

type PortCall = {
  id: string;
  service: Service;
  arrivalTurn: number;
  queueAge: number;
  ships: number;
  damagedShips: number;
  cargo: CargoLedger;
};

type WestboundCohort = {
  id: string;
  service: Service;
  createdTurn: number;
  ships: number;
  remaining: number;
};

type EscortReturn = {
  id: string;
  createdTurn: number;
  escorts: number;
  remaining: number;
};

type RepairJob = {
  id: string;
  service: Service;
  createdTurn: number;
  age: number;
  ships: number;
  workRemaining: number;
};

type OperationalSnapshot = {
  turn: number;
  coverageWeeks: number;
  portQueueKlt: number;
  repairShips: number;
  usefulDeliveryKlt: number;
};

type VisibleReport = {
  asOfTurn: number;
  publishedTurn: number;
  status: "preliminary" | "revised" | "final";
  coverageWeeks: number;
  portQueueKlt: number;
  repairShips: number;
  threatLow: number;
  threatHigh: number;
};

export interface NorthAtlanticState extends ScenarioState {
  initialMerchantShips: number;
  initialEscortHulls: number;
  availableMerchant: Record<Service, number>;
  availableEscorts: number;
  assemblies: Assembly[];
  eastbound: Convoy[];
  portQueue: PortCall[];
  westbound: WestboundCohort[];
  escortReturns: EscortReturn[];
  repairs: RepairJob[];
  originCargo: CargoLedger;
  destinationInventory: CargoLedger;
  cargoGenerated: CargoLedger;
  cargoConsumed: CargoLedger;
  cargoLost: CargoLedger;
  cargoExternal: CargoLedger;
  cumulativeDelivered: CargoLedger;
  merchantLostShips: number;
  externalMerchantShips: number;
  externalEscorts: number;
  externalTargetShips: number;
  externalTargetEscorts: number;
  portFatigue: number;
  nextScheduleTurn: number;
  scheduleSequence: number;
  convoySequence: number;
  cumulativeAssemblyWeeks: number;
  completedCycles: number;
  weeklyDeliveries: number[];
  criticalCoverageStreak: number;
  planChanges: number;
  lastDecision: Record<string, number> | null;
  lastThreatIndex: number;
  lastWeatherIndex: number;
  snapshots: OperationalSnapshot[];
  report: VisibleReport;
}

const CARGO_CLASSES: CargoClass[] = ["food", "petroleum", "dry"];
const SERVICES: Service[] = ["HX", "SC"];
const SHIP_KDWT = 10;
const LOAD_PER_SHIP_KLT = 7.5;
const TOTAL_TURNS = 26;
const WEEKLY_USE: CargoLedger = { food: 38, petroleum: 28, dry: 32 };
const WEEKLY_ORIGIN_SUPPLY: CargoLedger = { food: 44, petroleum: 35, dry: 45 };

const actionSpecs = [
  {
    id: "release-cadence",
    label: "Release cadence",
    description:
      "Weeks between paired HX/SC release windows. Longer cadence forms larger batches but increases assembly and port pressure.",
    commitment: "Schedules ship, cargo, escort, and staff claims through the next release window.",
    unit: "weeks",
    min: 1,
    max: 3,
    step: 1,
    defaultValue: 1,
  },
  {
    id: "fast-service-share",
    label: "Fast-service share",
    description: "Share of each scheduled merchant batch reserved for the faster HX service.",
    commitment: "Reserves compatible fast and slow merchant cohorts until sailing.",
    unit: "%",
    min: 30,
    max: 70,
    step: 5,
    defaultValue: 50,
  },
  {
    id: "fast-escort-share",
    label: "HX escort priority",
    description: "Distributes escort readiness between HX and SC sailing candidates.",
    commitment: "Claims escort hulls, fuel, and their return-cycle time.",
    unit: "%",
    min: 25,
    max: 75,
    step: 5,
    defaultValue: 50,
  },
  {
    id: "route-posture",
    label: "Route posture",
    description: "0 is cautious, 1 balanced, and 2 expedited; delay and exposure move in opposite directions.",
    commitment: "Locks route posture when a convoy sails.",
    unit: "index",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 1,
  },
  {
    id: "food-priority",
    label: "Food stowage priority",
    description: "Sets the target food share of new manifests; petroleum retains a protected floor.",
    commitment: "Reserves origin cargo and displaces other cargo before sailing.",
    unit: "%",
    min: 25,
    max: 65,
    step: 5,
    defaultValue: 40,
  },
  {
    id: "port-surge",
    label: "Port surge effort",
    description: "Adds temporary discharge teams now, with congestion fatigue carried into later weeks.",
    commitment: "Claims port-team weeks and overtime headroom.",
    unit: "teams",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 1,
  },
  {
    id: "repair-effort",
    label: "Repair effort",
    description: "Allocates yard teams to damaged merchant cohorts and preserves future serviceability.",
    commitment: "Claims yard-team weeks and repair capacity.",
    unit: "teams",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 1,
  },
  {
    id: "intelligence-effort",
    label: "Coordination inquiry",
    description: "Buys a timelier, narrower report without changing the hidden hazard directly.",
    commitment: "Claims staff-team weeks and displaces other coordination work.",
    unit: "teams",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 1,
  },
] satisfies ScenarioActionSpec[];

function emptyCargo(): CargoLedger {
  return { food: 0, petroleum: 0, dry: 0 };
}

function cargoTotal(cargo: CargoLedger): number {
  return round(cargo.food + cargo.petroleum + cargo.dry, 3);
}

function addCargo(target: CargoLedger, source: CargoLedger): void {
  for (const cargoClass of CARGO_CLASSES) {
    target[cargoClass] = round(target[cargoClass] + source[cargoClass], 3);
  }
}

function takeCargo(
  origin: CargoLedger,
  total: number,
  foodPriorityPct: number,
): CargoLedger {
  const allocation = emptyCargo();
  const nonFoodShare = 1 - foodPriorityPct / 100;
  const desired: CargoLedger = {
    food: total * (foodPriorityPct / 100),
    petroleum: total * nonFoodShare * 0.45,
    dry: total * nonFoodShare * 0.55,
  };
  let remaining = total;
  for (const cargoClass of CARGO_CLASSES) {
    const amount = round(
      Math.min(origin[cargoClass], Math.max(0, desired[cargoClass])),
      3,
    );
    allocation[cargoClass] = amount;
    origin[cargoClass] = round(origin[cargoClass] - amount, 3);
    remaining = round(remaining - amount, 3);
  }
  for (const cargoClass of CARGO_CLASSES) {
    if (remaining <= 0) break;
    const amount = round(Math.min(origin[cargoClass], remaining), 3);
    allocation[cargoClass] = round(allocation[cargoClass] + amount, 3);
    origin[cargoClass] = round(origin[cargoClass] - amount, 3);
    remaining = round(remaining - amount, 3);
  }
  return allocation;
}

function postureValue(decision: ScenarioDecision): RoutePosture {
  return decisionValue(decision, "route-posture", 1) as RoutePosture;
}

function threatForTurn(state: Pick<NorthAtlanticState, "seed">, turn: number): number {
  const seasonal = turn >= 9 && turn <= 18 ? 0.08 : turn >= 22 ? 0.04 : 0;
  const variation =
    (deterministicFloat(
      state.seed,
      `north-atlantic-1942/${state.seed}/route-threat/${turn}`,
    ) -
      0.5) *
    0.28;
  return clamp(0.34 + seasonal + variation, 0.16, 0.62);
}

function weatherForTurn(state: Pick<NorthAtlanticState, "seed">, turn: number): number {
  const autumn = turn >= 9 ? 0.16 : 0;
  return clamp(
    0.22 +
      autumn +
      deterministicFloat(
        state.seed,
        `north-atlantic-1942/${state.seed}/weather/${turn}`,
      ) *
        0.58,
    0,
    1,
  );
}

function coverageWeeks(inventory: CargoLedger): number {
  return round(
    Math.min(
      inventory.food / WEEKLY_USE.food,
      inventory.petroleum / WEEKLY_USE.petroleum,
      inventory.dry / WEEKLY_USE.dry,
    ),
    2,
  );
}

function statusForCoverage(coverage: number): ScenarioStatus {
  return coverage < 2 ? "critical" : coverage < 3.25 ? "watch" : "secure";
}

function decisionErrors(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
): string[] {
  const errors: string[] = [];
  if (state.complete) errors.push("The 26-week scenario is already complete.");
  const knownIds = new Set(actionSpecs.map((action) => action.id));
  for (const id of Object.keys(decision.values)) {
    if (!knownIds.has(id)) errors.push(`Unknown action "${id}".`);
  }
  for (const action of actionSpecs) {
    const value = decision.values[action.id];
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
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      errors.push(`${action.label} must use increments of ${action.step} ${action.unit}.`);
    }
  }
  const staff =
    decisionValue(decision, "port-surge") +
    decisionValue(decision, "repair-effort") +
    decisionValue(decision, "intelligence-effort");
  if (staff > 5) {
    errors.push(`Port, repair, and inquiry commitments claim ${staff} of 5 staff teams.`);
  }
  return errors;
}

function reserveExternalClaim(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  if (state.turn < 14 || state.turn > 18) return;
  const remainingShips = state.externalTargetShips - state.externalMerchantShips;
  const stagedShips = Math.min(5, remainingShips);
  const preferred: Service =
    decisionValue(decision, "fast-service-share", 50) >= 50 ? "SC" : "HX";
  const other: Service = preferred === "SC" ? "HX" : "SC";
  const fromPreferred = Math.min(stagedShips, state.availableMerchant[preferred]);
  const fromOther = Math.min(stagedShips - fromPreferred, state.availableMerchant[other]);
  state.availableMerchant[preferred] -= fromPreferred;
  state.availableMerchant[other] -= fromOther;
  let transferredShips = fromPreferred + fromOther;

  // The dated national claim outranks delegated, unsailed reservations. If ready
  // ships are already assembling, displace the newest manifests and return their
  // cargo to the origin ledger before selecting the ships.
  const assemblies = [...state.assemblies].sort(
    (a, b) => b.createdTurn - a.createdTurn || b.id.localeCompare(a.id),
  );
  for (const service of [preferred, other]) {
    for (const assembly of assemblies) {
      if (assembly.service !== service || transferredShips >= stagedShips) continue;
      const taken = Math.min(assembly.ships, stagedShips - transferredShips);
      if (taken <= 0) continue;
      const fraction = taken / assembly.ships;
      for (const cargoClass of CARGO_CLASSES) {
        const released = round(assembly.cargo[cargoClass] * fraction, 3);
        assembly.cargo[cargoClass] = round(assembly.cargo[cargoClass] - released, 3);
        state.originCargo[cargoClass] = round(
          state.originCargo[cargoClass] + released,
          3,
        );
      }
      assembly.ships -= taken;
      transferredShips += taken;
    }
  }
  state.externalMerchantShips += transferredShips;

  const escortNeed = Math.min(
    2,
    state.externalTargetEscorts - state.externalEscorts,
  );
  const transferredEscorts = Math.min(escortNeed, state.availableEscorts);
  state.availableEscorts -= transferredEscorts;
  state.externalEscorts += transferredEscorts;

  const externalCargo = takeCargo(
    state.originCargo,
    transferredShips * 5,
    decisionValue(decision, "food-priority", 40),
  );
  addCargo(state.cargoExternal, externalCargo);
  if (transferredShips < stagedShips || transferredEscorts < escortNeed) {
    events.push("The external-theater tranche was only partly realized because ready assets were unavailable.");
  } else {
    events.push("A scheduled external-theater tranche left the delegated Atlantic pool.");
  }
  contributions.push({
    target: "mandatory-claim",
    source: `external-claim-week-${state.turn}`,
    delta: transferredShips,
    unit: "ships",
    explanation: `${transferredShips} merchant ships and ${transferredEscorts} escorts were irreversibly reserved for the dated external claim.`,
  });
}

function scheduleAssemblies(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
  events: string[],
): void {
  if (state.turn < state.nextScheduleTurn) return;
  const cadence = decisionValue(decision, "release-cadence", 1);
  const targetShips = 18 * cadence;
  const fastTarget = Math.round(
    targetShips * (decisionValue(decision, "fast-service-share", 50) / 100),
  );
  const targets: Record<Service, number> = {
    HX: Math.max(5, fastTarget),
    SC: Math.max(5, targetShips - fastTarget),
  };
  state.scheduleSequence += 1;
  for (const service of SERVICES) {
    state.assemblies.push({
      id: `A-${state.scheduleSequence}-${service}`,
      service,
      createdTurn: state.turn,
      age: 0,
      targetShips: targets[service],
      ships: 0,
      cargo: emptyCargo(),
    });
  }
  state.nextScheduleTurn = state.turn + cadence;
  events.push(
    `Release window ${state.scheduleSequence} opened for ${targetShips} ships across HX and SC.`,
  );
}

function fillAssemblies(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
): void {
  const foodPriority = decisionValue(decision, "food-priority", 40);
  const ordered = [...state.assemblies].sort(
    (a, b) => a.createdTurn - b.createdTurn || a.id.localeCompare(b.id),
  );
  for (const assembly of ordered) {
    const needed = assembly.targetShips - assembly.ships;
    const added = Math.min(needed, state.availableMerchant[assembly.service]);
    if (added <= 0) continue;
    state.availableMerchant[assembly.service] -= added;
    assembly.ships += added;
    addCargo(
      assembly.cargo,
      takeCargo(state.originCargo, added * LOAD_PER_SHIP_KLT, foodPriority),
    );
  }
}

function escortRequest(service: Service, decision: ScenarioDecision): number {
  const fastShare = decisionValue(decision, "fast-escort-share", 50);
  const serviceShare = service === "HX" ? fastShare : 100 - fastShare;
  return clamp(Math.round(3 + serviceShare / 25), 4, 6);
}

function releaseConvoys(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  const posture = postureValue(decision);
  const fastPriority = decisionValue(decision, "fast-escort-share", 50) >= 50;
  const ordered = [...state.assemblies].sort((a, b) => {
    const priorityA = a.service === "HX" ? (fastPriority ? 0 : 1) : fastPriority ? 1 : 0;
    const priorityB = b.service === "HX" ? (fastPriority ? 0 : 1) : fastPriority ? 1 : 0;
    return (
      a.createdTurn - b.createdTurn ||
      priorityA - priorityB ||
      a.id.localeCompare(b.id)
    );
  });
  const sailed = new Set<string>();
  for (const assembly of ordered) {
    const minimumShips = Math.max(5, Math.ceil(assembly.targetShips * 0.75));
    const escorts = escortRequest(assembly.service, decision);
    if (
      assembly.age < 1 ||
      assembly.ships < minimumShips ||
      state.availableEscorts < escorts
    ) {
      continue;
    }
    state.availableEscorts -= escorts;
    state.convoySequence += 1;
    const passage =
      (assembly.service === "HX" ? 3 : 4) + (posture === 0 ? 1 : posture === 2 ? -1 : 0);
    const convoy: Convoy = {
      id: `${assembly.service}-${state.convoySequence}`,
      service: assembly.service,
      sailedTurn: state.turn,
      assemblyWeeks: assembly.age,
      posture,
      ships: assembly.ships,
      damagedShips: 0,
      cargo: cloneJson(assembly.cargo),
      escorts,
      transitWeek: 0,
      passageRemaining: Math.max(2, passage),
    };
    state.eastbound.push(convoy);
    state.cumulativeAssemblyWeeks += assembly.age * assembly.ships;
    sailed.add(assembly.id);
    events.push(
      `${convoy.id} sailed with ${convoy.ships} ships, ${escorts} escorts, and ${cargoTotal(convoy.cargo)} kLT.`,
    );
    contributions.push({
      target: "scheduled-capacity",
      source: convoy.id,
      delta: convoy.ships * SHIP_KDWT,
      unit: "kDWT",
      explanation: `${convoy.service} capacity left after ${convoy.assemblyWeeks} weeks assembling.`,
    });
  }
  state.assemblies = state.assemblies.filter((assembly) => !sailed.has(assembly.id));
  for (const assembly of state.assemblies) assembly.age += 1;
}

function resolveConvoyHazard(
  state: NorthAtlanticState,
  convoy: Convoy,
  threat: number,
  weather: number,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  const postureExposure = convoy.posture === 0 ? 0.72 : convoy.posture === 2 ? 1.22 : 1;
  const speedExposure = convoy.service === "HX" ? 0.84 : 1.08;
  const encounterProbability = clamp(
    threat * (0.35 + weather * 0.25) * postureExposure * speedExposure,
    0.025,
    0.42,
  );
  const encounterDraw = deterministicFloat(
    state.seed,
    `north-atlantic-1942/${state.seed}/${convoy.id}/encounter/${convoy.transitWeek}`,
  );
  if (encounterDraw >= encounterProbability || convoy.ships <= 0) return;

  const escortDensity = convoy.escorts / Math.max(5, convoy.ships);
  const cohesionPenalty = Math.max(0, convoy.ships - 24) / 80;
  const severityDraw = deterministicFloat(
    state.seed,
    `north-atlantic-1942/${state.seed}/${convoy.id}/severity/${convoy.transitWeek}`,
  );
  const severity = clamp(
    0.04 +
      weather * 0.06 +
      cohesionPenalty -
      escortDensity * 0.22 +
      severityDraw * 0.08,
    0.015,
    0.18,
  );
  const beforeShips = convoy.ships;
  const lossOccurs = severityDraw < 0.26 + threat * 0.22;
  const lossShips = lossOccurs
    ? Math.min(convoy.ships, Math.max(1, Math.floor(convoy.ships * severity)))
    : 0;
  const cargoFraction = lossShips / beforeShips;
  const lostCargo = emptyCargo();
  for (const cargoClass of CARGO_CLASSES) {
    lostCargo[cargoClass] = round(convoy.cargo[cargoClass] * cargoFraction, 3);
    convoy.cargo[cargoClass] = round(
      convoy.cargo[cargoClass] - lostCargo[cargoClass],
      3,
    );
  }
  addCargo(state.cargoLost, lostCargo);
  convoy.ships -= lossShips;
  convoy.damagedShips = Math.min(convoy.damagedShips, convoy.ships);
  state.merchantLostShips += lossShips;

  const undamagedShips = convoy.ships - convoy.damagedShips;
  const damageDraw = deterministicFloat(
    state.seed,
    `north-atlantic-1942/${state.seed}/${convoy.id}/damage/${convoy.transitWeek}`,
  );
  const damaged = Math.min(
    undamagedShips,
    damageDraw < 0.72
      ? Math.max(1, Math.round(Math.max(1, lossShips) * (0.7 + weather)))
      : 0,
  );
  convoy.damagedShips += damaged;
  events.push(
    `${convoy.id} reported an encounter: ${lossShips} merchant ship${lossShips === 1 ? "" : "s"} lost and ${damaged} damaged.`,
  );
  if (lossShips > 0) {
    contributions.push({
      target: "lost-capacity",
      source: `${convoy.id}/hazard/${convoy.transitWeek}`,
      delta: lossShips * SHIP_KDWT,
      unit: "kDWT",
      explanation: `A keyed convoy-level encounter and conditional-severity draw produced the reported loss.`,
    });
  }
}

function progressTransit(
  state: NorthAtlanticState,
  events: string[],
  contributions: ScenarioContribution[],
): void {
  const threat = threatForTurn(state, state.turn);
  const weather = weatherForTurn(state, state.turn);
  state.lastThreatIndex = round(threat, 4);
  state.lastWeatherIndex = round(weather, 4);
  const arrivals: Convoy[] = [];
  for (const convoy of [...state.eastbound].sort((a, b) => a.id.localeCompare(b.id))) {
    convoy.transitWeek += 1;
    resolveConvoyHazard(state, convoy, threat, weather, events, contributions);
    const weatherDelayDraw = deterministicFloat(
      state.seed,
      `north-atlantic-1942/${state.seed}/${convoy.id}/delay/${convoy.transitWeek}`,
    );
    if (weather > 0.72 && weatherDelayDraw < weather * 0.28) {
      events.push(`${convoy.id} widened its dated arrival window after heavy weather.`);
      contributions.push({
        target: "cycle-time",
        source: `${convoy.id}/weather-delay/${convoy.transitWeek}`,
        delta: 1,
        unit: "weeks",
        explanation: "Observed route weather delayed eastbound progress for one phase.",
      });
    } else {
      convoy.passageRemaining -= 1;
    }
    if (convoy.passageRemaining <= 0) arrivals.push(convoy);
  }
  const arrivedIds = new Set(arrivals.map((convoy) => convoy.id));
  state.eastbound = state.eastbound.filter((convoy) => !arrivedIds.has(convoy.id));
  for (const convoy of arrivals) {
    state.portQueue.push({
      id: `P-${convoy.id}`,
      service: convoy.service,
      arrivalTurn: state.turn,
      queueAge: 0,
      ships: convoy.ships,
      damagedShips: convoy.damagedShips,
      cargo: cloneJson(convoy.cargo),
    });
    state.escortReturns.push({
      id: `ER-${convoy.id}`,
      createdTurn: state.turn,
      escorts: convoy.escorts,
      remaining: 2,
    });
    events.push(`${convoy.id} entered the destination port queue.`);
  }
}

function dischargePorts(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
  weather: number,
  events: string[],
  contributions: ScenarioContribution[],
): number {
  const surge = decisionValue(decision, "port-surge", 1);
  const disruption = weather > 0.78 ? 55 : 0;
  const effectiveCapacity = Math.max(
    90,
    230 + surge * 35 - state.portFatigue * 12 - disruption,
  );
  state.portFatigue = round(clamp(state.portFatigue * 0.55 + surge * 0.7, 0, 6), 2);
  let handling = effectiveCapacity;
  let delivered = 0;
  const completed = new Set<string>();
  const ordered = [...state.portQueue].sort(
    (a, b) => a.arrivalTurn - b.arrivalTurn || a.id.localeCompare(b.id),
  );
  for (const call of ordered) {
    if (handling <= 0) break;
    for (const cargoClass of CARGO_CLASSES) {
      const amount = Math.min(call.cargo[cargoClass], handling);
      call.cargo[cargoClass] = round(call.cargo[cargoClass] - amount, 3);
      state.destinationInventory[cargoClass] = round(
        state.destinationInventory[cargoClass] + amount,
        3,
      );
      state.cumulativeDelivered[cargoClass] = round(
        state.cumulativeDelivered[cargoClass] + amount,
        3,
      );
      handling = round(handling - amount, 3);
      delivered = round(delivered + amount, 3);
    }
    if (cargoTotal(call.cargo) <= 0.001) {
      const soundShips = call.ships - call.damagedShips;
      if (soundShips > 0) {
        state.westbound.push({
          id: `W-${call.id}`,
          service: call.service,
          createdTurn: state.turn,
          ships: soundShips,
          remaining: call.service === "HX" ? 3 : 4,
        });
      }
      if (call.damagedShips > 0) {
        const scopeDraw = deterministicFloat(
          state.seed,
          `north-atlantic-1942/${state.seed}/${call.id}/repair-scope/0`,
        );
        state.repairs.push({
          id: `R-${call.id}`,
          service: call.service,
          createdTurn: state.turn,
          age: 0,
          ships: call.damagedShips,
          workRemaining: round(
            call.damagedShips * SHIP_KDWT * (0.75 + scopeDraw * 1.15),
            3,
          ),
        });
      }
      completed.add(call.id);
    } else {
      call.queueAge += 1;
    }
  }
  state.portQueue = state.portQueue.filter((call) => !completed.has(call.id));
  if (delivered > 0) {
    contributions.push({
      target: "useful-delivery",
      source: `port-handling-week-${state.turn}`,
      delta: delivered,
      unit: "kLT",
      explanation: `${delivered} kLT cleared the FIFO port queue within ${round(effectiveCapacity, 1)} kLT of effective handling capacity.`,
    });
  }
  if (disruption > 0) {
    events.push("Heavy weather reduced effective destination handling capacity.");
  }
  return delivered;
}

function consumeDestination(
  state: NorthAtlanticState,
  contributions: ScenarioContribution[],
): void {
  let consumed = 0;
  for (const cargoClass of CARGO_CLASSES) {
    const amount = Math.min(state.destinationInventory[cargoClass], WEEKLY_USE[cargoClass]);
    state.destinationInventory[cargoClass] = round(
      state.destinationInventory[cargoClass] - amount,
      3,
    );
    state.cargoConsumed[cargoClass] = round(
      state.cargoConsumed[cargoClass] + amount,
      3,
    );
    consumed += amount;
  }
  contributions.push({
    target: "essential-coverage",
    source: `destination-use-week-${state.turn}`,
    delta: -round(consumed, 3),
    unit: "kLT",
    explanation: "Destination stocks met weekly food, petroleum, and dry-cargo use where inventory allowed.",
  });
}

function progressReturns(state: NorthAtlanticState): void {
  const returnedWest = new Set<string>();
  for (const cohort of state.westbound) {
    if (cohort.createdTurn === state.turn) continue;
    cohort.remaining -= 1;
    if (cohort.remaining <= 0) {
      state.availableMerchant[cohort.service] += cohort.ships;
      state.completedCycles += cohort.ships;
      returnedWest.add(cohort.id);
    }
  }
  state.westbound = state.westbound.filter((cohort) => !returnedWest.has(cohort.id));

  const returnedEscorts = new Set<string>();
  for (const escort of state.escortReturns) {
    if (escort.createdTurn === state.turn) continue;
    escort.remaining -= 1;
    if (escort.remaining <= 0) {
      state.availableEscorts += escort.escorts;
      returnedEscorts.add(escort.id);
    }
  }
  state.escortReturns = state.escortReturns.filter(
    (escort) => !returnedEscorts.has(escort.id),
  );
}

function processRepairs(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
  contributions: ScenarioContribution[],
): void {
  const effort = decisionValue(decision, "repair-effort", 1);
  let yardCapacity = 12 + effort * 14;
  const completed = new Set<string>();
  const ordered = [...state.repairs].sort(
    (a, b) => b.age - a.age || a.workRemaining - b.workRemaining || a.id.localeCompare(b.id),
  );
  let realized = 0;
  for (const job of ordered) {
    if (job.createdTurn === state.turn) continue;
    const applied = Math.min(job.workRemaining, yardCapacity);
    job.workRemaining = round(job.workRemaining - applied, 3);
    yardCapacity = round(yardCapacity - applied, 3);
    realized += applied;
    job.age += 1;
    if (job.workRemaining <= 0.001) {
      state.availableMerchant[job.service] += job.ships;
      completed.add(job.id);
    }
  }
  state.repairs = state.repairs.filter((job) => !completed.has(job.id));
  if (realized > 0) {
    contributions.push({
      target: "serviceable-capacity",
      source: `yard-allocation-week-${state.turn}`,
      delta: round(realized, 3),
      unit: "kDWT",
      explanation: "Yard capacity reduced declared repair work; completed cohorts returned to their speed pool.",
    });
  }
}

function updateObservation(
  state: NorthAtlanticState,
  decision: ScenarioDecision,
): void {
  const trueSnapshot: OperationalSnapshot = {
    turn: state.turn,
    coverageWeeks: coverageWeeks(state.destinationInventory),
    portQueueKlt: round(
      state.portQueue.reduce((sum, call) => sum + cargoTotal(call.cargo), 0),
      2,
    ),
    repairShips: state.repairs.reduce((sum, job) => sum + job.ships, 0),
    usefulDeliveryKlt: state.weeklyDeliveries.at(-1) ?? 0,
  };
  state.snapshots.push(trueSnapshot);

  const inquiry = decisionValue(decision, "intelligence-effort", 1);
  const methodRevision = state.turn >= 24 ? 1 : 0;
  const lag = Math.max(0, 2 - inquiry - methodRevision);
  const requestedTurn = Math.max(0, state.turn - lag);
  const source =
    [...state.snapshots].reverse().find((snapshot) => snapshot.turn <= requestedTurn) ??
    state.snapshots[0];
  const width = Math.max(0.04, 0.16 - inquiry * 0.04 - methodRevision * 0.03);
  const bias =
    (deterministicFloat(
      state.seed,
      `north-atlantic-1942/${state.seed}/report/${state.turn}/${source.turn}`,
    ) -
      0.5) *
    width;
  const reportedThreat = clamp(state.lastThreatIndex + bias, 0, 1);
  state.report = {
    asOfTurn: source.turn,
    publishedTurn: state.turn,
    status: lag === 0 ? "preliminary" : inquiry > 0 ? "revised" : "final",
    coverageWeeks: round(Math.max(0, source.coverageWeeks * (1 + bias)), 2),
    portQueueKlt: round(Math.max(0, source.portQueueKlt * (1 - bias)), 1),
    repairShips: Math.max(0, Math.round(source.repairShips * (1 + bias))),
    threatLow: round(Math.max(0, reportedThreat - width), 2),
    threatHigh: round(Math.min(1, reportedThreat + width), 2),
  };
}

function assertState(state: NorthAtlanticState): void {
  const numbers: number[] = [
    state.turn,
    state.availableMerchant.HX,
    state.availableMerchant.SC,
    state.availableEscorts,
    state.merchantLostShips,
    state.externalMerchantShips,
    state.externalEscorts,
    state.portFatigue,
    ...Object.values(state.originCargo),
    ...Object.values(state.destinationInventory),
    ...Object.values(state.cargoGenerated),
    ...Object.values(state.cargoConsumed),
    ...Object.values(state.cargoLost),
    ...Object.values(state.cargoExternal),
  ];
  if (numbers.some((value) => !Number.isFinite(value) || value < -0.001)) {
    throw new Error("North Atlantic invariant failed: a ledger value is non-finite or negative.");
  }
  const merchantShips =
    state.availableMerchant.HX +
    state.availableMerchant.SC +
    state.assemblies.reduce((sum, entity) => sum + entity.ships, 0) +
    state.eastbound.reduce((sum, entity) => sum + entity.ships, 0) +
    state.portQueue.reduce((sum, entity) => sum + entity.ships, 0) +
    state.westbound.reduce((sum, entity) => sum + entity.ships, 0) +
    state.repairs.reduce((sum, entity) => sum + entity.ships, 0) +
    state.merchantLostShips +
    state.externalMerchantShips;
  if (merchantShips !== state.initialMerchantShips) {
    throw new Error(
      `North Atlantic merchant ledger failed: ${merchantShips} of ${state.initialMerchantShips} ships reconciled.`,
    );
  }
  const escorts =
    state.availableEscorts +
    state.eastbound.reduce((sum, entity) => sum + entity.escorts, 0) +
    state.escortReturns.reduce((sum, entity) => sum + entity.escorts, 0) +
    state.externalEscorts;
  if (escorts !== state.initialEscortHulls) {
    throw new Error(
      `North Atlantic escort ledger failed: ${escorts} of ${state.initialEscortHulls} hulls reconciled.`,
    );
  }
  for (const cargoClass of CARGO_CLASSES) {
    const expected =
      (cargoClass === "food" ? 500 + 270 : cargoClass === "petroleum" ? 370 + 280 : 460 + 215) +
      state.cargoGenerated[cargoClass];
    const actual =
      state.originCargo[cargoClass] +
      state.destinationInventory[cargoClass] +
      state.cargoConsumed[cargoClass] +
      state.cargoLost[cargoClass] +
      state.cargoExternal[cargoClass] +
      state.assemblies.reduce((sum, entity) => sum + entity.cargo[cargoClass], 0) +
      state.eastbound.reduce((sum, entity) => sum + entity.cargo[cargoClass], 0) +
      state.portQueue.reduce((sum, entity) => sum + entity.cargo[cargoClass], 0);
    if (Math.abs(expected - actual) > 0.02) {
      throw new Error(
        `North Atlantic ${cargoClass} ledger failed: ${round(actual, 3)} of ${round(expected, 3)} kLT reconciled.`,
      );
    }
  }
}

function currentPhase(state: NorthAtlanticState): {
  phase: string;
  description: string;
} {
  const turn = Math.min(state.turn + 1, TOTAL_TURNS);
  if (turn <= 4) {
    return {
      phase: "Establish the flow",
      description: "Build a regular release cadence while the first full ship cycles become visible.",
    };
  }
  if (turn <= 8) {
    return {
      phase: "Escort scarcity",
      description: "Dated readiness and route uncertainty now constrain nominal sailing plans.",
    };
  }
  if (turn <= 13) {
    return {
      phase: "Queues and defects",
      description: "Batch arrivals shift the bottleneck toward destination handling and repair.",
    };
  }
  if (turn <= 18) {
    return {
      phase: "External claim",
      description: "The dated theater commitment removes ships, escorts, and cargo from the delegated pool.",
    };
  }
  if (turn <= 22) {
    return {
      phase: "Recover the cycle",
      description: "Restore cadence without concealing maintenance and terminal queue debt.",
    };
  }
  return {
    phase: "Winter resilience",
    description: "Use improved report methods to leave a viable fleet and defensible inventory position.",
  };
}

function objectives(state: NorthAtlanticState): ScenarioObjective[] {
  const coverage = state.report.coverageWeeks;
  const externalPct = round(
    Math.min(
      state.externalMerchantShips / state.externalTargetShips,
      state.externalEscorts / state.externalTargetEscorts,
    ) * 100,
    1,
  );
  const recentDelivery = round(state.weeklyDeliveries.slice(-4).reduce((a, b) => a + b, 0), 1);
  const repairShips = state.repairs.reduce((sum, job) => sum + job.ships, 0);
  const portQueue = state.portQueue.reduce((sum, call) => sum + cargoTotal(call.cargo), 0);
  return [
    {
      id: "essential-coverage",
      label: "P1 Essential coverage",
      priority: 1,
      value: coverage,
      unit: "weeks",
      status: statusForCoverage(coverage),
      hard: true,
    },
    {
      id: "mandatory-claim",
      label: "P2 External-theater commitment",
      priority: 2,
      value: externalPct,
      unit: "%",
      status:
        state.turn < 18
          ? externalPct >= (Math.max(0, state.turn - 13) / 5) * 90
            ? "secure"
            : "watch"
          : externalPct >= 100
            ? "secure"
            : "critical",
      hard: true,
    },
    {
      id: "irreversible-exposure",
      label: "P3 Irreversible merchant loss",
      priority: 3,
      value: state.merchantLostShips * SHIP_KDWT,
      unit: "kDWT",
      status:
        state.merchantLostShips >= 14 ? "critical" : state.merchantLostShips >= 7 ? "watch" : "secure",
      hard: false,
    },
    {
      id: "useful-delivery",
      label: "P4 Trailing useful delivery",
      priority: 4,
      value: recentDelivery,
      unit: "kLT / 4 weeks",
      status: recentDelivery < 300 ? "critical" : recentDelivery < 390 ? "watch" : "secure",
      hard: false,
    },
    {
      id: "resilient-capacity",
      label: "P5 Terminal queue load",
      priority: 5,
      value: round(repairShips * SHIP_KDWT + portQueue, 1),
      unit: "capacity index",
      status:
        repairShips * SHIP_KDWT + portQueue > 350
          ? "critical"
          : repairShips * SHIP_KDWT + portQueue > 180
            ? "watch"
            : "secure",
      hard: false,
    },
    {
      id: "process-quality",
      label: "P6 Plan stability",
      priority: 6,
      value: state.planChanges,
      unit: "material changes",
      status: state.planChanges > 12 ? "critical" : state.planChanges > 7 ? "watch" : "secure",
      hard: false,
    },
  ];
}

const model: ScenarioModel<NorthAtlanticState> = {
  metadata: {
    id: "north-atlantic-1942",
    version: "0.1.0",
    title: "North Atlantic, 1942: The Throughput Ledger",
    shortTitle: "The Throughput Ledger",
    deck: "Protect a full shipping cycle, not merely this week's sailings.",
    fidelity: "Historically grounded logistics counterfactual; fictional analytic outcomes",
    role: "Secretary, Combined North Atlantic Shipping Coordination Staff (composite)",
    period: "6 July 1942–3 January 1943",
    turnLabel: "Week",
    totalTurns: TOTAL_TURNS,
    sessionLength: "35–50 minutes",
    briefing: [
      "Your delegated fleet must assemble, cross, queue, discharge, return, and sometimes repair before it can carry again.",
      "Fewer, larger releases reduce encounter opportunities but lengthen assembly and create destination surges.",
      "A fixed external-theater claim arrives during weeks 14–18 and ranks above loss and gross-throughput preferences.",
      "Threat, weather, and repair scope are keyed model draws. Reports are dated estimates, never tactical tracks.",
    ],
    learningObjectives: [
      "Distinguish stock protection from useful flow and full-cycle management.",
      "Identify a bottleneck migrating among escorts, ports, repair, and cargo mix.",
      "Explain why lower loss can coexist with lower useful delivery.",
      "Use dated, uncertain reports without mistaking them for hidden truth.",
    ],
    modelNote:
      "Generated cohorts and outcomes are uncalibrated analytic content. The model omits tactical ASW, casualties, global shipping allocation, and claims of historical causation.",
    accent: "#79a9c7",
  },
  actions: actionSpecs,

  createInitialState(seed: number, mode: SimulationMode): NorthAtlanticState {
    const state: NorthAtlanticState = {
      turn: 0,
      complete: false,
      seed: normaliseSeed(seed),
      mode,
      initialMerchantShips: 144,
      initialEscortHulls: 44,
      availableMerchant: { HX: 70, SC: 74 },
      availableEscorts: 44,
      assemblies: [],
      eastbound: [],
      portQueue: [],
      westbound: [],
      escortReturns: [],
      repairs: [],
      originCargo: { food: 500, petroleum: 370, dry: 460 },
      destinationInventory: { food: 270, petroleum: 280, dry: 215 },
      cargoGenerated: emptyCargo(),
      cargoConsumed: emptyCargo(),
      cargoLost: emptyCargo(),
      cargoExternal: emptyCargo(),
      cumulativeDelivered: emptyCargo(),
      merchantLostShips: 0,
      externalMerchantShips: 0,
      externalEscorts: 0,
      externalTargetShips: 25,
      externalTargetEscorts: 8,
      portFatigue: 0,
      nextScheduleTurn: 1,
      scheduleSequence: 0,
      convoySequence: 0,
      cumulativeAssemblyWeeks: 0,
      completedCycles: 0,
      weeklyDeliveries: [],
      criticalCoverageStreak: 0,
      planChanges: 0,
      lastDecision: null,
      lastThreatIndex: threatForTurn({ seed: normaliseSeed(seed) }, 0),
      lastWeatherIndex: 0,
      snapshots: [
        {
          turn: 0,
          coverageWeeks: coverageWeeks({ food: 270, petroleum: 280, dry: 215 }),
          portQueueKlt: 0,
          repairShips: 0,
          usefulDeliveryKlt: 0,
        },
      ],
      report: {
        asOfTurn: 0,
        publishedTurn: 0,
        status: "final",
        coverageWeeks: coverageWeeks({ food: 270, petroleum: 280, dry: 215 }),
        portQueueKlt: 0,
        repairShips: 0,
        threatLow: 0.18,
        threatHigh: 0.52,
      },
    };
    assertState(state);
    return state;
  },

  defaultDecision(): ScenarioDecision {
    return {
      values: Object.fromEntries(
        actionSpecs.map((action) => [action.id, action.defaultValue]),
      ),
    };
  },

  validateDecision(
    state: NorthAtlanticState,
    decision: ScenarioDecision,
  ): string[] {
    return decisionErrors(state, decision);
  },

  step(
    sourceState: NorthAtlanticState,
    decision: ScenarioDecision,
  ): ScenarioStepResult<NorthAtlanticState> {
    const errors = decisionErrors(sourceState, decision);
    if (errors.length > 0) throw new Error(errors.join(" "));
    const state = cloneJson(sourceState);
    state.turn += 1;
    const events: string[] = [];
    const contributions: ScenarioContribution[] = [];

    for (const cargoClass of CARGO_CLASSES) {
      state.originCargo[cargoClass] = round(
        state.originCargo[cargoClass] + WEEKLY_ORIGIN_SUPPLY[cargoClass],
        3,
      );
      state.cargoGenerated[cargoClass] = round(
        state.cargoGenerated[cargoClass] + WEEKLY_ORIGIN_SUPPLY[cargoClass],
        3,
      );
    }

    reserveExternalClaim(state, decision, events, contributions);
    scheduleAssemblies(state, decision, events);
    fillAssemblies(state, decision);
    releaseConvoys(state, decision, events, contributions);
    progressTransit(state, events, contributions);
    const delivered = dischargePorts(
      state,
      decision,
      state.lastWeatherIndex,
      events,
      contributions,
    );
    state.weeklyDeliveries.push(delivered);
    consumeDestination(state, contributions);
    progressReturns(state);
    processRepairs(state, decision, contributions);

    const currentCoverage = coverageWeeks(state.destinationInventory);
    state.criticalCoverageStreak =
      currentCoverage < 2 ? state.criticalCoverageStreak + 1 : 0;
    if (state.lastDecision) {
      const changed = actionSpecs.some(
        (action) => state.lastDecision?.[action.id] !== decision.values[action.id],
      );
      if (changed) state.planChanges += 1;
    }
    state.lastDecision = cloneJson(decision.values);
    updateObservation(state, decision);
    state.complete = state.turn >= TOTAL_TURNS;
    assertState(state);

    const queueKlt = round(
      state.portQueue.reduce((sum, call) => sum + cargoTotal(call.cargo), 0),
      1,
    );
    const headline =
      delivered > 0
        ? `${delivered} kLT discharged; destination queue now ${queueKlt} kLT.`
        : `No useful cargo discharged; ${queueKlt} kLT remains queued.`;
    return { state, headline, events, contributions };
  },

  getView(state: NorthAtlanticState): ScenarioView {
    const phase = currentPhase(state);
    const activeConvoys = state.eastbound.length;
    const assembledShips = state.assemblies.reduce((sum, item) => sum + item.ships, 0);
    const repairShips = state.repairs.reduce((sum, job) => sum + job.ships, 0);
    const serviceable =
      (state.availableMerchant.HX + state.availableMerchant.SC) * SHIP_KDWT;
    const fourWeekDelivery = round(
      state.weeklyDeliveries.slice(-4).reduce((a, b) => a + b, 0),
      1,
    );
    const oldestPort = state.portQueue.reduce(
      (oldest, call) => Math.max(oldest, call.queueAge),
      0,
    );
    const oldestRepair = state.repairs.reduce(
      (oldest, job) => Math.max(oldest, job.age),
      0,
    );
    const averageAssembly =
      state.completedCycles > 0
        ? round(state.cumulativeAssemblyWeeks / state.completedCycles, 1)
        : 0;
    const objectiveVector = objectives(state);
    const alerts: ScenarioView["alerts"] = [];
    if (state.report.coverageWeeks < 2) {
      alerts.push({
        id: "coverage-critical",
        severity: "critical",
        message: "The latest stock return places at least one essential class below two weeks of coverage.",
      });
    }
    if (state.turn >= 12 && state.turn < 19) {
      alerts.push({
        id: "external-claim",
        severity:
          state.turn >= 18 &&
          state.externalMerchantShips < state.externalTargetShips
            ? "critical"
            : "warning",
        message: `External claim: ${state.externalMerchantShips}/${state.externalTargetShips} merchant ships and ${state.externalEscorts}/${state.externalTargetEscorts} escorts transferred.`,
      });
    }
    if (state.report.portQueueKlt > 260) {
      alerts.push({
        id: "port-congestion",
        severity: state.report.portQueueKlt > 450 ? "critical" : "warning",
        message: "The dated port return shows a material discharge queue; further batch arrivals may extend the cycle.",
      });
    }
    if (oldestRepair >= 3) {
      alerts.push({
        id: "aged-repair",
        severity: oldestRepair >= 6 ? "critical" : "warning",
        message: `The oldest repair cohort has waited ${oldestRepair} weeks.`,
      });
    }
    if (state.lastWeatherIndex > 0.72) {
      alerts.push({
        id: `weather-${state.turn}`,
        severity: "warning",
        message: "The observed route-band weather widened arrival windows and may reduce destination handling.",
      });
    }
    if (alerts.length === 0) {
      alerts.push({
        id: "dated-report",
        severity: "info",
        message: `Situation report is ${state.report.status} and reflects operations through week ${state.report.asOfTurn}.`,
      });
    }

    return {
      dateLabel: `Week ${Math.min(state.turn + 1, TOTAL_TURNS)} of ${TOTAL_TURNS} · 1942 staff calendar`,
      phase: phase.phase,
      phaseDescription: phase.description,
      summary: state.complete
        ? "The 26-week ledger is closed. Terminal queues and serviceability remain part of the result."
        : `${activeConvoys} convoy${activeConvoys === 1 ? "" : "s"} eastbound; ${assembledShips} ships assembling; report as of week ${state.report.asOfTurn}.`,
      metrics: [
        {
          id: "lowest-coverage",
          label: "Lowest essential coverage",
          value: state.report.coverageWeeks,
          unit: "weeks",
          status: statusForCoverage(state.report.coverageWeeks),
          detail: `${state.report.status} stock return, as of week ${state.report.asOfTurn}.`,
        },
        {
          id: "useful-delivery",
          label: "Trailing useful delivery",
          value: fourWeekDelivery,
          unit: "kLT / 4 weeks",
          status: fourWeekDelivery < 300 ? "critical" : fourWeekDelivery < 390 ? "watch" : "secure",
          detail: "Cargo discharged into destination inventory, not merely sailed or arrived.",
        },
        {
          id: "serviceable-capacity",
          label: "Serviceable merchant capacity",
          value: serviceable,
          unit: "kDWT",
          status: serviceable < 250 ? "critical" : serviceable < 500 ? "watch" : "secure",
          detail: "Immediately available delegated HX and SC cohorts.",
        },
        {
          id: "cycle-time",
          label: "Mean assembly component",
          value: averageAssembly,
          unit: "ship-weeks / return",
          status: averageAssembly > 3 ? "critical" : averageAssembly > 2 ? "watch" : "secure",
          detail: "Completed-cycle assembly time; in-progress and repair cohorts remain censored.",
        },
        {
          id: "origin-queue",
          label: "Origin cargo queue",
          value: cargoTotal(state.originCargo),
          unit: "kLT",
          status: cargoTotal(state.originCargo) > 1900 ? "critical" : cargoTotal(state.originCargo) > 1350 ? "watch" : "secure",
          detail: "Unreserved food, petroleum, and dry cargo awaiting ship capacity.",
        },
        {
          id: "destination-queue",
          label: "Destination port queue",
          value: state.report.portQueueKlt,
          unit: "kLT",
          status: state.report.portQueueKlt > 450 ? "critical" : state.report.portQueueKlt > 260 ? "watch" : "secure",
          detail: `${state.report.status} return; oldest known call is ${oldestPort} weeks.`,
        },
        {
          id: "escort-availability",
          label: "Escort availability",
          value: state.availableEscorts,
          unit: "hulls",
          status: state.availableEscorts < 4 ? "critical" : state.availableEscorts < 9 ? "watch" : "secure",
          detail: `${state.escortReturns.reduce((sum, item) => sum + item.escorts, 0)} hulls on return cycles; ${state.externalEscorts} externally claimed.`,
        },
        {
          id: "repair-queue",
          label: "Repair queue",
          value: state.report.repairShips,
          unit: "ships",
          status: state.report.repairShips > 14 ? "critical" : state.report.repairShips > 7 ? "watch" : "secure",
          detail: `${state.report.status} yard return; oldest known job is ${oldestRepair} weeks.`,
        },
        {
          id: "lost-capacity",
          label: "Cumulative lost capacity",
          value: state.merchantLostShips * SHIP_KDWT,
          unit: "kDWT",
          status: state.merchantLostShips >= 14 ? "critical" : state.merchantLostShips >= 7 ? "watch" : "secure",
          detail: "Generated analytic loss, reported without casualty estimates.",
        },
        {
          id: "threat-estimate",
          label: "Route threat estimate",
          value: round((state.report.threatLow + state.report.threatHigh) / 2, 2),
          unit: "index",
          status: state.report.threatHigh > 0.65 ? "critical" : state.report.threatHigh > 0.48 ? "watch" : "secure",
          detail: `Dated range ${state.report.threatLow}–${state.report.threatHigh}; not a tactical position map.`,
        },
      ],
      objectives: objectiveVector,
      alerts,
    };
  },
};

export const northAtlanticModel: AnyScenarioModel = model;
