import type { SimulationMode } from "../../sim/types.ts";
import {
  clamp,
  cloneJson,
  decisionValue,
  deterministicFloat,
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
  ScenarioStepResult,
  ScenarioView,
} from "../types.ts";

type WorkstreamId =
  | "launch-vehicle"
  | "crew-spacecraft"
  | "landing-spacecraft"
  | "guidance-software"
  | "ground-systems"
  | "test-facilities"
  | "crew-operations";

type SpecialtyId =
  | "systems-interface"
  | "vehicle-mechanical"
  | "electrical-guidance-software"
  | "test-quality-safety"
  | "ground-operations";

type DefectSeverity = "critical" | "major" | "minor";
type DefectState =
  | "latent"
  | "known-open"
  | "analyzing"
  | "correcting"
  | "awaiting-retest"
  | "closed";
type TestStatus = "queued" | "completed" | "invalidated";

type Workstream = {
  id: WorkstreamId;
  label: string;
  remainingEpm: number;
  knownBacklogEpm: number;
  reworkEpm: number;
  maturity: number;
  configurationVersion: number;
};

type WorkforcePool = {
  id: SpecialtyId;
  label: string;
  nominalEpm: number;
  effectiveEpm: number;
  onboardingEpm: number;
  overloadMonths: number;
};

type InterfaceRecord = {
  id: string;
  label: string;
  from: WorkstreamId;
  to: WorkstreamId;
  debt: number;
  baselineFingerprint: string;
  currentFingerprint: string;
  divergent: boolean;
};

type Milestone = {
  id: string;
  label: string;
  dependencies: string[];
  progress: number;
  kind: "engineering" | "test" | "review";
  critical: boolean;
};

type TestRecord = {
  id: string;
  label: string;
  earliestTurn: number;
  prerequisites: string[];
  requiredEvidence: string[];
  coveredInterfaces: string[];
  coverage: number;
  standMonths: number;
  articleId: string;
  status: TestStatus;
  runTurn: number | null;
  configurationFingerprint: string | null;
  valid: boolean;
  discoveredDefectIds: string[];
  retestForDefectId: string | null;
};

type DefectRecord = {
  id: string;
  label: string;
  interfaceId: string;
  severity: DefectSeverity;
  detectability: number;
  correctionEpm: number;
  correctionRemainingEpm: number;
  state: DefectState;
  discoveredTurn: number | null;
  closedTurn: number | null;
};

type ArticleRecord = {
  id: string;
  label: string;
  configurationFingerprint: string;
  status: "preparing" | "available" | "in-test" | "rework";
  availableTurn: number;
};

type PendingTransfer = {
  id: string;
  committedTurn: number;
  effectiveTurn: number;
  epm: number;
};

type ApolloMetrics = {
  testsRun: number;
  defectsDiscovered: number;
  defectsClosed: number;
  evidenceInvalidations: number;
  scheduleRevisions: number;
  overloadMonths: number;
  cumulativeReworkEpm: number;
  reviewFindings: number;
};

export interface ApolloIntegrationState extends ScenarioState {
  committedGateMonth: number;
  earliestReadyMonth: number;
  earliestReadyBand: [number, number];
  scheduleMargin: number;
  budgetK: number;
  initialBudgetK: number;
  baselineProgress: number;
  trainingAlignment: number;
  safetyEvidence: number;
  safetyHold: boolean;
  knownCriticalHazard: boolean;
  configurationFrozen: boolean;
  freezeTurn: number | null;
  reportBias: number;
  reportedReadiness: number;
  trueReadiness: number;
  lastReportRevision: number;
  technicalRiskBand: "low" | "guarded" | "high" | "indeterminate";
  finalRecommendation: "pending" | "hold" | "uncrewed-step" | "crewed-readiness";
  redLineViolation: boolean;
  workstreams: Workstream[];
  workforce: WorkforcePool[];
  interfaces: InterfaceRecord[];
  milestones: Milestone[];
  tests: TestRecord[];
  defects: DefectRecord[];
  articles: ArticleRecord[];
  pendingTransfers: PendingTransfer[];
  metrics: ApolloMetrics;
}

const TOTAL_TURNS = 18;
const INITIAL_BUDGET_K = 7_200;

const ACTIONS: ScenarioActionSpec[] = [
  {
    id: "systems-reserve",
    label: "Systems reserve",
    description:
      "Transfer scarce systems/interface support; it onboards now and becomes partly effective next month.",
    commitment: "Central engineering reserve",
    unit: "EPM",
    min: 0,
    max: 8,
    step: 1,
    defaultValue: 4,
  },
  {
    id: "test-program",
    label: "Protected test program",
    description:
      "Reserve configured articles, preparation effort, and scarce stand time for eligible tests and retests.",
    commitment: "Test capacity",
    unit: "stand-month",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 2,
  },
  {
    id: "configuration-control",
    label: "Configuration control",
    description:
      "Use board and interface-review capacity to reconcile fingerprints; level 2 or 3 institutes a selective freeze.",
    commitment: "Configuration board",
    unit: "review-slot",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 2,
  },
  {
    id: "defect-recovery",
    label: "Defect recovery",
    description:
      "Fund root-cause analysis and correction of known defects; corrected items still require a later valid retest.",
    commitment: "Specialist recovery",
    unit: "EPM",
    min: 0,
    max: 10,
    step: 1,
    defaultValue: 5,
  },
  {
    id: "independent-review",
    label: "Independent reviews",
    description:
      "Commission evidence, interface, workforce, contractor, or safety reviews that revise reports rather than truth.",
    commitment: "Independent scrutiny",
    unit: "review-slot",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 1,
  },
  {
    id: "concurrency-support",
    label: "Concurrency and support",
    description:
      "Authorize parallel work with systems/quality support. It can gain activity now while creating propagation exposure.",
    commitment: "Concurrent execution",
    unit: "level",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 1,
  },
  {
    id: "mission-posture",
    label: "Mission posture",
    description:
      "0 holds or resequences, 1 protects an uncrewed staged gate, and 2 preserves the crewed-date claim.",
    commitment: "Sequence recommendation",
    unit: "posture",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 1,
  },
  {
    id: "safety-scope",
    label: "Safety, redundancy, and scope",
    description:
      "Apply test/quality/safety effort to hazard closure, redundancy studies, and configuration-valid evidence.",
    commitment: "Protected safety work",
    unit: "EPM",
    min: 0,
    max: 6,
    step: 1,
    defaultValue: 3,
  },
];

const WORKSTREAM_LABELS: Record<WorkstreamId, string> = {
  "launch-vehicle": "Launch vehicle",
  "crew-spacecraft": "Crew spacecraft",
  "landing-spacecraft": "Landing spacecraft",
  "guidance-software": "Guidance software",
  "ground-systems": "Ground systems",
  "test-facilities": "Test facilities",
  "crew-operations": "Crew operations",
};

const MONTH_LABELS = [
  "January 1966",
  "February 1966",
  "March 1966",
  "April 1966",
  "May 1966",
  "June 1966",
  "July 1966",
  "August 1966",
  "September 1966",
  "October 1966",
  "November 1966",
  "December 1966",
  "January 1967",
  "February 1967",
  "March 1967",
  "April 1967",
  "May 1967",
  "June 1967",
];

const PHASES = [
  { through: 3, name: "Baseline", description: "Separate evidence-backed dates from unowned claims." },
  { through: 6, name: "Converge", description: "Control interfaces and reserve typed bottlenecks." },
  { through: 9, name: "Qualify", description: "Turn uncertainty into defects, rework, and valid evidence." },
  { through: 12, name: "Integrate", description: "Protect coupled tests from local schedule pressure." },
  { through: 13, name: "Stress", description: "Independent findings test the credibility of the baseline." },
  { through: 15, name: "Recover", description: "Choose scope, sequence, correction, and option value." },
  { through: 16, name: "Demonstrate", description: "Run a pinned end-to-end uncrewed campaign." },
  { through: 17, name: "Gate", description: "Resolve findings and rehearse go/no-go reasoning." },
  { through: 18, name: "Handover", description: "Recommend proceed, hold, or resequence." },
];

function streamVersion(state: ApolloIntegrationState, id: WorkstreamId): number {
  return state.workstreams.find((stream) => stream.id === id)?.configurationVersion ?? 0;
}

function interfaceFingerprint(
  state: ApolloIntegrationState,
  record: Pick<InterfaceRecord, "from" | "to">,
): string {
  return `${record.from}@${streamVersion(state, record.from)}:${record.to}@${streamVersion(
    state,
    record.to,
  )}`;
}

function evidenceFingerprint(state: ApolloIntegrationState, interfaces: string[]): string {
  return interfaces
    .map((id) => {
      const record = state.interfaces.find((candidate) => candidate.id === id);
      return record ? `${id}[${interfaceFingerprint(state, record)}]` : `${id}[missing]`;
    })
    .sort()
    .join("|");
}

function makeWorkstream(
  id: WorkstreamId,
  remainingEpm: number,
  configurationVersion = 1,
): Workstream {
  return {
    id,
    label: WORKSTREAM_LABELS[id],
    remainingEpm,
    knownBacklogEpm: round(remainingEpm * 0.78, 1),
    reworkEpm: 0,
    maturity: round(clamp(1 - remainingEpm / 90, 0, 1), 3),
    configurationVersion,
  };
}

function initialInterfaces(state: ApolloIntegrationState): InterfaceRecord[] {
  const definitions: Array<
    Pick<InterfaceRecord, "id" | "label" | "from" | "to"> & { debt: number }
  > = [
    {
      id: "if-lv-cs",
      label: "Launch vehicle ↔ crew spacecraft",
      from: "launch-vehicle",
      to: "crew-spacecraft",
      debt: 14,
    },
    {
      id: "if-cs-ls",
      label: "Crew ↔ landing spacecraft",
      from: "crew-spacecraft",
      to: "landing-spacecraft",
      debt: 18,
    },
    {
      id: "if-cs-gsw",
      label: "Crew spacecraft ↔ guidance software",
      from: "crew-spacecraft",
      to: "guidance-software",
      debt: 20,
    },
    {
      id: "if-gsw-ground",
      label: "Guidance software ↔ ground systems",
      from: "guidance-software",
      to: "ground-systems",
      debt: 16,
    },
    {
      id: "if-ground-crew",
      label: "Ground systems ↔ crew operations",
      from: "ground-systems",
      to: "crew-operations",
      debt: 12,
    },
  ];
  return definitions.map((definition) => {
    const fingerprint = interfaceFingerprint(state, definition);
    return {
      ...definition,
      baselineFingerprint: fingerprint,
      currentFingerprint: fingerprint,
      divergent: false,
    };
  });
}

function createMilestones(): Milestone[] {
  return [
    {
      id: "requirements-baseline",
      label: "Owned requirements and interfaces",
      dependencies: [],
      progress: 82,
      kind: "engineering",
      critical: true,
    },
    {
      id: "launch-article",
      label: "Launch article ready",
      dependencies: ["requirements-baseline"],
      progress: 72,
      kind: "engineering",
      critical: true,
    },
    {
      id: "spacecraft-articles",
      label: "Spacecraft articles ready",
      dependencies: ["requirements-baseline"],
      progress: 68,
      kind: "engineering",
      critical: true,
    },
    {
      id: "guidance-ground-build",
      label: "Guidance and ground build",
      dependencies: ["requirements-baseline"],
      progress: 70,
      kind: "engineering",
      critical: true,
    },
    {
      id: "component-qualification",
      label: "Component qualification evidence",
      dependencies: ["launch-article", "spacecraft-articles", "guidance-ground-build"],
      progress: 0,
      kind: "test",
      critical: true,
    },
    {
      id: "integrated-article",
      label: "Cross-workstream article",
      dependencies: ["launch-article", "spacecraft-articles", "guidance-ground-build"],
      progress: 65,
      kind: "engineering",
      critical: true,
    },
    {
      id: "training-current",
      label: "Configuration-current training",
      dependencies: ["requirements-baseline"],
      progress: 50,
      kind: "engineering",
      critical: false,
    },
    {
      id: "integrated-checkout-gate",
      label: "Integrated checkout",
      dependencies: ["component-qualification", "integrated-article"],
      progress: 0,
      kind: "test",
      critical: true,
    },
    {
      id: "uncrewed-demonstration",
      label: "End-to-end uncrewed demonstration",
      dependencies: ["integrated-checkout-gate", "training-current"],
      progress: 0,
      kind: "test",
      critical: true,
    },
    {
      id: "independent-safety-gate",
      label: "Independent safety evidence gate",
      dependencies: ["uncrewed-demonstration"],
      progress: 0,
      kind: "review",
      critical: true,
    },
  ];
}

function makeTest(
  id: string,
  label: string,
  earliestTurn: number,
  prerequisites: string[],
  requiredEvidence: string[],
  coveredInterfaces: string[],
  coverage: number,
  articleId: string,
  standMonths = 1,
): TestRecord {
  return {
    id,
    label,
    earliestTurn,
    prerequisites,
    requiredEvidence,
    coveredInterfaces,
    coverage,
    standMonths,
    articleId,
    status: "queued",
    runTurn: null,
    configurationFingerprint: null,
    valid: false,
    discoveredDefectIds: [],
    retestForDefectId: null,
  };
}

function createTests(): TestRecord[] {
  return [
    makeTest(
      "test-launch-interface",
      "Launch/spacecraft interface qualification",
      6,
      ["launch-article"],
      [],
      ["if-lv-cs"],
      0.72,
      "article-launch",
    ),
    makeTest(
      "test-spacecraft-interface",
      "Spacecraft interface qualification",
      6,
      ["spacecraft-articles"],
      [],
      ["if-cs-ls", "if-cs-gsw"],
      0.7,
      "article-spacecraft",
    ),
    makeTest(
      "test-guidance-ground",
      "Guidance/ground closed-loop qualification",
      7,
      ["guidance-ground-build"],
      [],
      ["if-gsw-ground"],
      0.76,
      "article-guidance",
    ),
    makeTest(
      "test-integrated-checkout",
      "Pinned integrated checkout",
      10,
      ["integrated-article"],
      [],
      ["if-lv-cs", "if-cs-ls", "if-cs-gsw", "if-gsw-ground"],
      0.86,
      "article-integrated",
    ),
    makeTest(
      "test-mission-simulation",
      "Crew/mission configuration simulation",
      12,
      ["training-current", "integrated-checkout-gate"],
      ["test-integrated-checkout"],
      ["if-cs-gsw", "if-gsw-ground", "if-ground-crew"],
      0.82,
      "article-simulator",
    ),
    makeTest(
      "test-uncrewed-campaign",
      "End-to-end uncrewed readiness campaign",
      16,
      ["integrated-checkout-gate", "training-current"],
      ["test-integrated-checkout", "test-mission-simulation"],
      ["if-lv-cs", "if-cs-ls", "if-cs-gsw", "if-gsw-ground", "if-ground-crew"],
      0.96,
      "article-integrated",
      2,
    ),
  ];
}

function createDefects(seed: number): DefectRecord[] {
  const templates: Array<
    Pick<DefectRecord, "id" | "label" | "interfaceId" | "severity"> & {
      correction: [number, number];
      detectability: [number, number];
    }
  > = [
    {
      id: "asteria-defect-01",
      label: "Load-path tolerance mismatch",
      interfaceId: "if-lv-cs",
      severity: "major",
      correction: [8, 13],
      detectability: [0.55, 0.85],
    },
    {
      id: "asteria-defect-02",
      label: "Separation command timing conflict",
      interfaceId: "if-cs-ls",
      severity: "critical",
      correction: [12, 18],
      detectability: [0.5, 0.78],
    },
    {
      id: "asteria-defect-03",
      label: "Guidance word-length disagreement",
      interfaceId: "if-cs-gsw",
      severity: "major",
      correction: [7, 12],
      detectability: [0.6, 0.9],
    },
    {
      id: "asteria-defect-04",
      label: "Telemetry frame interpretation mismatch",
      interfaceId: "if-gsw-ground",
      severity: "major",
      correction: [8, 14],
      detectability: [0.58, 0.88],
    },
    {
      id: "asteria-defect-05",
      label: "Simulator procedure/configuration drift",
      interfaceId: "if-ground-crew",
      severity: "critical",
      correction: [10, 16],
      detectability: [0.45, 0.75],
    },
    {
      id: "asteria-defect-06",
      label: "Connector environmental sensitivity",
      interfaceId: "if-cs-gsw",
      severity: "minor",
      correction: [4, 8],
      detectability: [0.35, 0.68],
    },
    {
      id: "asteria-defect-07",
      label: "Checkout inhibit-state ambiguity",
      interfaceId: "if-gsw-ground",
      severity: "critical",
      correction: [11, 17],
      detectability: [0.42, 0.72],
    },
    {
      id: "asteria-defect-08",
      label: "Umbilical service tolerance stack",
      interfaceId: "if-lv-cs",
      severity: "minor",
      correction: [5, 9],
      detectability: [0.4, 0.7],
    },
  ];
  return templates.map((template) => {
    const correctionEpm = round(
      seededRange(
        seed,
        `${template.id}:correction`,
        template.correction[0],
        template.correction[1],
      ) * 0.68,
      1,
    );
    return {
      id: template.id,
      label: template.label,
      interfaceId: template.interfaceId,
      severity: template.severity,
      detectability: round(
        seededRange(
          seed,
          `${template.id}:detectability`,
          template.detectability[0],
          template.detectability[1],
        ),
        3,
      ),
      correctionEpm,
      correctionRemainingEpm: correctionEpm,
      state: "latent",
      discoveredTurn: null,
      closedTurn: null,
    };
  });
}

function getMilestone(state: ApolloIntegrationState, id: string): Milestone {
  const milestone = state.milestones.find((candidate) => candidate.id === id);
  if (!milestone) throw new Error(`Unknown Apollo milestone: ${id}.`);
  return milestone;
}

function prerequisitesComplete(state: ApolloIntegrationState, ids: string[]): boolean {
  return ids.every((id) => getMilestone(state, id).progress >= 100);
}

function phaseFor(turn: number): (typeof PHASES)[number] {
  return PHASES.find((phase) => turn <= phase.through) ?? PHASES[PHASES.length - 1];
}

function severityWeight(severity: DefectSeverity): number {
  if (severity === "critical") return 5;
  if (severity === "major") return 2;
  return 1;
}

function openDefects(state: ApolloIntegrationState): DefectRecord[] {
  return state.defects.filter(
    (defect) => defect.state !== "latent" && defect.state !== "closed",
  );
}

function validEvidence(state: ApolloIntegrationState): TestRecord[] {
  return state.tests.filter((test) => test.status === "completed" && test.valid);
}

function calculateReadiness(state: ApolloIntegrationState): number {
  const criticalMilestones = state.milestones.filter((milestone) => milestone.critical);
  const milestoneReadiness =
    criticalMilestones.reduce((sum, milestone) => sum + milestone.progress, 0) /
    Math.max(1, criticalMilestones.length);
  const evidenceCoverage =
    validEvidence(state).reduce((sum, test) => sum + test.coverage * 100, 0) /
    Math.max(1, state.tests.filter((test) => test.retestForDefectId === null).length);
  const defectPenalty = openDefects(state).reduce(
    (sum, defect) => sum + severityWeight(defect.severity) * 1.8,
    0,
  );
  const debtPenalty =
    state.interfaces.reduce((sum, record) => sum + record.debt, 0) /
    Math.max(1, state.interfaces.length) /
    3;
  return round(
    clamp(milestoneReadiness * 0.62 + evidenceCoverage * 0.25 + state.trainingAlignment * 13 - defectPenalty - debtPenalty, 0, 100),
    1,
  );
}

function recomputeSchedule(state: ApolloIntegrationState): void {
  const incomplete = state.milestones.filter((milestone) => milestone.progress < 100);
  const engineeringMonths = incomplete.reduce(
    (sum, milestone) =>
      sum + (milestone.kind === "engineering" ? (100 - milestone.progress) / 18 : 0),
    0,
  );
  const testMonths = incomplete.filter((milestone) => milestone.kind === "test").length * 0.85;
  const reviewMonths = incomplete.filter((milestone) => milestone.kind === "review").length * 0.5;
  const queueMonths =
    state.tests.filter((test) => test.status === "queued" && test.earliestTurn <= state.turn + 3)
      .length * 0.32;
  const defectMonths = openDefects(state).reduce(
    (sum, defect) => sum + defect.correctionRemainingEpm / 18 + severityWeight(defect.severity) * 0.12,
    0,
  );
  const debtMonths =
    state.interfaces.reduce((sum, record) => sum + record.debt, 0) / 115;
  const remaining = Math.max(
    0,
    engineeringMonths + testMonths + reviewMonths + queueMonths + defectMonths + debtMonths,
  );
  const median = Math.max(state.turn + Math.ceil(remaining), state.turn + (incomplete.length > 0 ? 1 : 0));
  const uncertainty = Math.max(
    1,
    Math.ceil(
      0.7 +
        state.defects.filter((defect) => defect.state === "latent").length * 0.17 +
        state.interfaces.filter((record) => record.divergent).length * 0.35,
    ),
  );
  state.earliestReadyMonth = median;
  state.earliestReadyBand = [Math.max(state.turn, median - 1), median + uncertainty];
  state.scheduleMargin = round(state.committedGateMonth - median, 1);
}

function updateDerivedState(state: ApolloIntegrationState): void {
  for (const stream of state.workstreams) {
    stream.remainingEpm = round(Math.max(0, stream.remainingEpm), 1);
    stream.knownBacklogEpm = round(Math.max(0, stream.knownBacklogEpm), 1);
    stream.reworkEpm = round(Math.max(0, stream.reworkEpm), 1);
    stream.maturity = round(
      clamp(1 - (stream.remainingEpm + stream.reworkEpm * 0.65) / 90, 0, 1),
      3,
    );
  }
  state.baselineProgress = round(clamp(getMilestone(state, "requirements-baseline").progress, 0, 100), 1);
  state.trueReadiness = calculateReadiness(state);
  const visibleBias = state.reportBias * (1 - Math.min(0.8, state.metrics.reviewFindings * 0.08));
  state.reportedReadiness = round(clamp(state.trueReadiness + visibleBias, 0, 100), 1);

  const criticalOpen = openDefects(state).some((defect) => defect.severity === "critical");
  const invalidEvidence = state.tests.some(
    (test) => test.status !== "queued" && !test.valid,
  );
  const divergent = state.interfaces.some((record) => record.divergent);
  if (criticalOpen || state.knownCriticalHazard || state.safetyEvidence < 55) {
    state.technicalRiskBand = "high";
  } else if (invalidEvidence || divergent || state.safetyEvidence < 80) {
    state.technicalRiskBand = "guarded";
  } else if (getMilestone(state, "uncrewed-demonstration").progress >= 100) {
    state.technicalRiskBand = "low";
  } else {
    state.technicalRiskBand = "indeterminate";
  }
  recomputeSchedule(state);
}

function addContribution(
  contributions: ScenarioContribution[],
  target: string,
  source: string,
  delta: number,
  unit: string,
  explanation: string,
): void {
  if (Math.abs(delta) < 0.000001) return;
  contributions.push({
    target,
    source,
    delta: round(delta, 2),
    unit,
    explanation,
  });
}

function createInitialState(seed: number, mode: SimulationMode): ApolloIntegrationState {
  const normalSeed = normaliseSeed(seed);
  const state: ApolloIntegrationState = {
    turn: 0,
    complete: false,
    seed: normalSeed,
    mode,
    committedGateMonth: 18,
    earliestReadyMonth: 20,
    earliestReadyBand: [19, 22],
    scheduleMargin: -2,
    budgetK: INITIAL_BUDGET_K,
    initialBudgetK: INITIAL_BUDGET_K,
    baselineProgress: 82,
    trainingAlignment: 0.5,
    safetyEvidence: 34,
    safetyHold: false,
    knownCriticalHazard: false,
    configurationFrozen: false,
    freezeTurn: null,
    reportBias:
      mode === "guided"
        ? 6
        : round(seededRange(normalSeed, "apollo:report-bias", 2.5, 10.5), 1),
    reportedReadiness: 0,
    trueReadiness: 0,
    lastReportRevision: 0,
    technicalRiskBand: "indeterminate",
    finalRecommendation: "pending",
    redLineViolation: false,
    workstreams: [
      makeWorkstream("launch-vehicle", 48),
      makeWorkstream("crew-spacecraft", 52),
      makeWorkstream("landing-spacecraft", 58),
      makeWorkstream("guidance-software", 46),
      makeWorkstream("ground-systems", 44),
      makeWorkstream("test-facilities", 36),
      makeWorkstream("crew-operations", 42),
    ],
    workforce: [
      {
        id: "systems-interface",
        label: "Systems and interface",
        nominalEpm: 10,
        effectiveEpm: 8,
        onboardingEpm: 0,
        overloadMonths: 0,
      },
      {
        id: "vehicle-mechanical",
        label: "Vehicle and mechanical",
        nominalEpm: 18,
        effectiveEpm: 16,
        onboardingEpm: 0,
        overloadMonths: 0,
      },
      {
        id: "electrical-guidance-software",
        label: "Electrical, guidance, and software",
        nominalEpm: 13,
        effectiveEpm: 11,
        onboardingEpm: 0,
        overloadMonths: 0,
      },
      {
        id: "test-quality-safety",
        label: "Test, quality, and safety",
        nominalEpm: 14,
        effectiveEpm: 12,
        onboardingEpm: 0,
        overloadMonths: 0,
      },
      {
        id: "ground-operations",
        label: "Ground and operations",
        nominalEpm: 12,
        effectiveEpm: 10,
        onboardingEpm: 0,
        overloadMonths: 0,
      },
    ],
    interfaces: [],
    milestones: createMilestones(),
    tests: createTests(),
    defects: createDefects(normalSeed),
    articles: [
      {
        id: "article-launch",
        label: "Launch interface article",
        configurationFingerprint: "",
        status: "preparing",
        availableTurn: 6,
      },
      {
        id: "article-spacecraft",
        label: "Spacecraft integration article",
        configurationFingerprint: "",
        status: "preparing",
        availableTurn: 6,
      },
      {
        id: "article-guidance",
        label: "Guidance/ground rig",
        configurationFingerprint: "",
        status: "preparing",
        availableTurn: 7,
      },
      {
        id: "article-integrated",
        label: "Integrated Asteria article",
        configurationFingerprint: "",
        status: "preparing",
        availableTurn: 10,
      },
      {
        id: "article-simulator",
        label: "Mission simulator",
        configurationFingerprint: "",
        status: "preparing",
        availableTurn: 11,
      },
    ],
    pendingTransfers: [],
    metrics: {
      testsRun: 0,
      defectsDiscovered: 0,
      defectsClosed: 0,
      evidenceInvalidations: 0,
      scheduleRevisions: 0,
      overloadMonths: 0,
      cumulativeReworkEpm: 0,
      reviewFindings: 0,
    },
  };
  state.interfaces = initialInterfaces(state);
  for (const article of state.articles) {
    article.configurationFingerprint = evidenceFingerprint(
      state,
      state.interfaces.map((record) => record.id),
    );
  }
  updateDerivedState(state);
  return state;
}

function defaultDecision(state: ApolloIntegrationState): ScenarioDecision {
  const open = openDefects(state);
  const awaitingRetest = open.some((defect) => defect.state === "awaiting-retest");
  const late = state.turn >= 12;
  const demonstrationComplete =
    getMilestone(state, "uncrewed-demonstration").progress >= 100;
  const values: Record<string, number> = {
    "systems-reserve": state.interfaces.some((record) => record.divergent) ? 6 : 4,
    "test-program": awaitingRetest || state.turn >= 5 ? 3 : 2,
    "configuration-control": state.turn >= 3 ? 2 : 1,
    "defect-recovery": open.length > 0 ? 9 : 3,
    "independent-review": state.turn === 2 || state.turn === 11 || state.safetyHold ? 2 : 1,
    "concurrency-support": state.scheduleMargin < -2 && !state.configurationFrozen ? 1 : 0,
    "mission-posture":
      late &&
      !demonstrationComplete &&
      (state.safetyHold || state.scheduleMargin < 0)
        ? 0
        : 1,
    "safety-scope": late || open.some((defect) => defect.severity === "critical") ? 5 : 3,
  };
  if (state.budgetK < 500) {
    values["systems-reserve"] = 0;
    values["test-program"] = awaitingRetest || late ? 1 : 0;
    values["configuration-control"] = state.interfaces.some((record) => record.divergent)
      ? 1
      : 0;
    values["defect-recovery"] = open.length > 0 ? 4 : 0;
    values["independent-review"] = 0;
    values["concurrency-support"] = 0;
    values["safety-scope"] = open.some((defect) => defect.severity === "critical") ? 2 : 1;
  }
  const sheddingOrder = [
    "concurrency-support",
    "independent-review",
    "systems-reserve",
    "safety-scope",
    "defect-recovery",
    "test-program",
    "configuration-control",
  ];
  const unitCosts: Record<string, number> = {
    "systems-reserve": 12,
    "test-program": 42,
    "configuration-control": 18,
    "defect-recovery": 10,
    "independent-review": 24,
    "concurrency-support": 55,
    "safety-scope": 16,
  };
  const packageCost = (): number =>
    Object.entries(unitCosts).reduce((sum, [id, unitCost]) => sum + values[id] * unitCost, 0);
  for (const id of sheddingOrder) {
    while (packageCost() > state.budgetK && values[id] > 0) values[id] -= 1;
  }
  return { values };
}

function validateDecision(
  state: ApolloIntegrationState,
  decision: ScenarioDecision,
): string[] {
  const errors: string[] = [];
  if (state.complete) errors.push("The 18-month handover is already complete.");
  const actionIds = new Set(ACTIONS.map((action) => action.id));
  for (const key of Object.keys(decision.values)) {
    if (!actionIds.has(key)) errors.push(`Unknown Apollo action: ${key}.`);
  }
  for (const action of ACTIONS) {
    const value = decision.values[action.id];
    if (!Number.isFinite(value)) {
      errors.push(`${action.label} must be a finite number.`);
      continue;
    }
    if (value < action.min || value > action.max) {
      errors.push(`${action.label} must be between ${action.min} and ${action.max} ${action.unit}.`);
    }
    const steps = (value - action.min) / action.step;
    if (Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) > 0.000001) {
      errors.push(`${action.label} must use increments of ${action.step} ${action.unit}.`);
    }
  }

  const configuration = decisionValue(decision, "configuration-control");
  const review = decisionValue(decision, "independent-review");
  if (configuration + review > 4) {
    errors.push("Configuration control and independent review exceed four review-slots this month.");
  }
  const epmClaim =
    decisionValue(decision, "systems-reserve") +
    decisionValue(decision, "defect-recovery") +
    decisionValue(decision, "safety-scope") +
    decisionValue(decision, "test-program") * 2;
  if (epmClaim > 26) {
    errors.push("The package exceeds the 26 EPM central specialist reserve.");
  }
  const projectedCost =
    decisionValue(decision, "systems-reserve") * 12 +
    decisionValue(decision, "test-program") * 42 +
    configuration * 18 +
    decisionValue(decision, "defect-recovery") * 10 +
    review * 24 +
    decisionValue(decision, "concurrency-support") * 55 +
    decisionValue(decision, "safety-scope") * 16;
  if (projectedCost > state.budgetK) {
    errors.push(`The package costs ${projectedCost} kFY66USD but only ${state.budgetK} remains.`);
  }
  if (
    state.mode === "guided" &&
    state.turn < 8 &&
    decisionValue(decision, "mission-posture") !== 1
  ) {
    errors.push("Guided mode holds the staged uncrewed posture through the baseline and qualification phases.");
  }
  return errors;
}

function advanceTransfers(
  state: ApolloIntegrationState,
  nextTurn: number,
  systemsReserve: number,
  contributions: ScenarioContribution[],
): number {
  const effective = state.pendingTransfers
    .filter((transfer) => transfer.effectiveTurn === nextTurn)
    .reduce((sum, transfer) => sum + transfer.epm * 0.65, 0);
  state.pendingTransfers = state.pendingTransfers.filter(
    (transfer) => transfer.effectiveTurn > nextTurn,
  );
  if (systemsReserve > 0) {
    state.pendingTransfers.push({
      id: `transfer-${nextTurn}`,
      committedTurn: nextTurn,
      effectiveTurn: nextTurn + 1,
      epm: systemsReserve,
    });
  }
  const systemsPool = state.workforce.find((pool) => pool.id === "systems-interface");
  if (systemsPool) {
    systemsPool.onboardingEpm = systemsReserve;
    systemsPool.effectiveEpm = round(8 + effective, 1);
  }
  addContribution(
    contributions,
    "effective systems capacity",
    "transfer-ramp",
    effective,
    "EPM",
    effective > 0
      ? "Last month's transfer completed onboarding; current commitments remain non-fungible until next month."
      : "No prior systems transfer completed onboarding this month.",
  );
  return effective;
}

function advanceEngineering(
  state: ApolloIntegrationState,
  nextTurn: number,
  effectiveTransfer: number,
  concurrency: number,
  missionPosture: number,
  contributions: ScenarioContribution[],
): void {
  const rates: Record<string, number> = {
    "requirements-baseline": 8 + effectiveTransfer * 0.7,
    "launch-article": 7.5,
    "spacecraft-articles": 7.2,
    "guidance-ground-build": 7,
    "integrated-article": 6.5,
    "training-current": 4.2 + (missionPosture === 1 ? 1.3 : 0),
  };
  const concurrencyGain = concurrency * 1.25;
  for (const milestone of state.milestones) {
    if (milestone.kind !== "engineering" || milestone.progress >= 100) continue;
    if (!prerequisitesComplete(state, milestone.dependencies)) continue;
    let gain = (rates[milestone.id] ?? 4) + concurrencyGain;
    if (milestone.id === "integrated-article") {
      gain += effectiveTransfer * 0.35;
    }
    const before = milestone.progress;
    milestone.progress = round(clamp(before + gain, 0, 100), 1);
    addContribution(
      contributions,
      milestone.label,
      "engineering-completion",
      milestone.progress - before,
      "percentage points",
      `${round(gain, 1)} points of prerequisite-ready work cleared within typed capacity.`,
    );
  }

  const streamOrder: WorkstreamId[] = [
    "launch-vehicle",
    "crew-spacecraft",
    "landing-spacecraft",
    "guidance-software",
    "ground-systems",
    "test-facilities",
    "crew-operations",
  ];
  const baseRates = [3.2, 3.1, 2.8, 3.2, 2.8, 2.2, 2.5];
  const requirementsReady = getMilestone(state, "requirements-baseline").progress >= 100;
  for (let index = 0; index < streamOrder.length; index += 1) {
    const stream = state.workstreams.find((candidate) => candidate.id === streamOrder[index]);
    if (!stream || !requirementsReady) continue;
    const completion = baseRates[index] + concurrency * 0.35;
    stream.remainingEpm = round(Math.max(0, stream.remainingEpm - completion), 1);
    stream.knownBacklogEpm = round(Math.max(0, stream.knownBacklogEpm - completion), 1);
  }

  state.trainingAlignment = round(
    clamp(
      state.trainingAlignment +
        (getMilestone(state, "training-current").progress >= 100 ? 0.055 : 0.025) +
        (missionPosture === 1 ? 0.018 : missionPosture === 2 ? -0.012 : 0.005),
      0,
      1,
    ),
    3,
  );

  for (const article of state.articles) {
    if (article.status === "preparing" && article.availableTurn <= nextTurn) {
      article.status = "available";
      article.configurationFingerprint = evidenceFingerprint(
        state,
        state.interfaces.map((record) => record.id),
      );
    }
  }
}

function applyConfigurationChange(
  state: ApolloIntegrationState,
  nextTurn: number,
  streamId: WorkstreamId,
  source: string,
  control: number,
  contributions: ScenarioContribution[],
  events: string[],
): void {
  const stream = state.workstreams.find((candidate) => candidate.id === streamId);
  if (!stream) return;
  stream.configurationVersion += 1;
  const affected = state.interfaces.filter(
    (record) => record.from === streamId || record.to === streamId,
  );
  let invalidated = 0;
  for (const record of affected) {
    record.currentFingerprint = interfaceFingerprint(state, record);
    record.divergent = record.currentFingerprint !== record.baselineFingerprint;
    record.debt = round(clamp(record.debt + Math.max(2, 8 - control * 1.5), 0, 100), 1);
    for (const test of state.tests) {
      if (
        test.valid &&
        test.coveredInterfaces.includes(record.id) &&
        test.configurationFingerprint !== evidenceFingerprint(state, test.coveredInterfaces)
      ) {
        test.valid = false;
        test.status = "invalidated";
        invalidated += 1;
      }
    }
  }
  state.metrics.evidenceInvalidations += invalidated;
  state.trainingAlignment = round(Math.max(0, state.trainingAlignment - affected.length * 0.025), 3);
  addContribution(
    contributions,
    "interface debt",
    "change-propagation",
    affected.reduce((sum, record) => sum + Math.max(2, 8 - control * 1.5), 0),
    "debt points",
    `${source} advanced ${stream.label} to configuration ${stream.configurationVersion}; dependent interfaces require reconciliation.`,
  );
  addContribution(
    contributions,
    "valid evidence",
    "evidence-invalidation",
    -invalidated,
    "test records",
    invalidated > 0
      ? "Only tests whose covered fingerprints changed were invalidated."
      : "No released test overlapped the changed fingerprint.",
  );
  events.push(
    `${stream.label} configuration ${stream.configurationVersion} propagated across ${affected.length} interfaces${invalidated > 0 ? ` and invalidated ${invalidated} evidence record${invalidated === 1 ? "" : "s"}` : ""}.`,
  );

  if (nextTurn >= 1) {
    for (const article of state.articles) {
      if (article.status === "available") article.status = "rework";
    }
  }
}

function reconcileInterfaces(
  state: ApolloIntegrationState,
  control: number,
  nextTurn: number,
  contributions: ScenarioContribution[],
  events: string[],
): void {
  if (control >= 2 && !state.configurationFrozen && nextTurn >= 4) {
    state.configurationFrozen = true;
    state.freezeTurn = nextTurn;
    events.push("The board instituted a selective interface freeze with a protected safety-reopen path.");
  }
  const candidates = [...state.interfaces].sort(
    (a, b) => Number(b.divergent) - Number(a.divergent) || b.debt - a.debt || a.id.localeCompare(b.id),
  );
  for (const record of candidates.slice(0, Math.floor(control))) {
    const before = record.debt;
    record.debt = round(Math.max(0, record.debt - (5 + control * 2)), 1);
    if (record.divergent) {
      record.baselineFingerprint = record.currentFingerprint;
      record.divergent = false;
    }
    addContribution(
      contributions,
      "interface debt",
      "configuration-control",
      record.debt - before,
      "debt points",
      `${record.label} was reconciled against its recorded current fingerprint.`,
    );
  }
}

function processKnownDefects(
  state: ApolloIntegrationState,
  nextTurn: number,
  recoveryEpm: number,
  configurationControl: number,
  contributions: ScenarioContribution[],
  events: string[],
): void {
  for (const defect of state.defects) {
    if (defect.state === "known-open" && defect.discoveredTurn !== nextTurn) {
      defect.state = "analyzing";
    }
  }
  let capacity = recoveryEpm;
  const recoverable = state.defects
    .filter((defect) => defect.state === "analyzing" || defect.state === "correcting")
    .sort(
      (a, b) =>
        severityWeight(b.severity) - severityWeight(a.severity) ||
        (a.discoveredTurn ?? 0) - (b.discoveredTurn ?? 0) ||
        a.id.localeCompare(b.id),
    );
  for (const defect of recoverable) {
    if (capacity <= 0) break;
    defect.state = "correcting";
    const applied = Math.min(capacity, defect.correctionRemainingEpm);
    defect.correctionRemainingEpm = round(defect.correctionRemainingEpm - applied, 1);
    capacity = round(capacity - applied, 1);
    state.metrics.cumulativeReworkEpm = round(state.metrics.cumulativeReworkEpm + applied, 1);
    const record = state.interfaces.find((candidate) => candidate.id === defect.interfaceId);
    if (record) {
      const stream = state.workstreams.find((candidate) => candidate.id === record.to);
      if (stream) {
        stream.reworkEpm = round(stream.reworkEpm + applied, 1);
        stream.reworkEpm = round(Math.max(0, stream.reworkEpm - applied), 1);
      }
    }
    addContribution(
      contributions,
      "known rework",
      "defect-rework",
      applied,
      "EPM",
      `${defect.label} consumed specialist correction effort; it cannot close before a later retest.`,
    );
    if (defect.correctionRemainingEpm <= 0) {
      defect.state = "awaiting-retest";
      const related = state.interfaces.find((candidate) => candidate.id === defect.interfaceId);
      if (related) {
        applyConfigurationChange(
          state,
          nextTurn,
          related.to,
          `Correction ${defect.id}`,
          configurationControl,
          contributions,
          events,
        );
      }
      const retestId = `retest-${defect.id}`;
      if (!state.tests.some((test) => test.id === retestId)) {
        const changedInterfaces = state.interfaces
          .filter(
            (candidate) =>
              candidate.from === related?.to || candidate.to === related?.to,
          )
          .map((candidate) => candidate.id);
        const retestInterfaces = new Set<string>([
          defect.interfaceId,
          ...changedInterfaces,
        ]);
        for (const invalidated of state.tests) {
          if (
            invalidated.status !== "queued" &&
            !invalidated.valid &&
            invalidated.coveredInterfaces.some((interfaceId) =>
              changedInterfaces.includes(interfaceId),
            )
          ) {
            for (const interfaceId of invalidated.coveredInterfaces) {
              retestInterfaces.add(interfaceId);
            }
          }
        }
        state.tests.push({
          ...makeTest(
            retestId,
            `Configuration-valid retest: ${defect.label}`,
            nextTurn + 1,
            [],
            [],
            [...retestInterfaces].sort(),
            0.9,
            "article-integrated",
          ),
          retestForDefectId: defect.id,
        });
      }
      events.push(`${defect.label} correction completed; a configuration-valid retest entered the queue.`);
    }
  }
}

function eligibleTest(state: ApolloIntegrationState, test: TestRecord, nextTurn: number): boolean {
  if (test.status !== "queued" || test.earliestTurn > nextTurn) return false;
  if (!prerequisitesComplete(state, test.prerequisites)) return false;
  if (
    !test.requiredEvidence.every((id) => {
      const evidence = state.tests.find((candidate) => candidate.id === id);
      if (evidence?.status === "completed" && evidence.valid) return true;
      if (!evidence) return false;
      return state.tests.some(
        (candidate) =>
          candidate.status === "completed" &&
          candidate.valid &&
          (candidate.runTurn ?? -1) >= (evidence.runTurn ?? -1) &&
          evidence.coveredInterfaces.every((interfaceId) =>
            candidate.coveredInterfaces.includes(interfaceId),
          ),
      );
    })
  ) {
    return false;
  }
  const article = state.articles.find((candidate) => candidate.id === test.articleId);
  return article?.status === "available" || article?.status === "rework";
}

function discoverDefects(
  state: ApolloIntegrationState,
  test: TestRecord,
  nextTurn: number,
): DefectRecord[] {
  const discoveries: DefectRecord[] = [];
  for (const defect of state.defects) {
    if (defect.state !== "latent" || !test.coveredInterfaces.includes(defect.interfaceId)) continue;
    if (test.retestForDefectId) {
      const corrected = state.defects.find(
        (candidate) => candidate.id === test.retestForDefectId,
      );
      if (corrected && defect.interfaceId !== corrected.interfaceId) continue;
    }
    const detectProbability = 1 - Math.exp(-test.coverage * defect.detectability * 1.9);
    const draw = deterministicFloat(state.seed, `${defect.id}:${test.id}:detect`);
    if (draw < detectProbability) {
      defect.state = "known-open";
      defect.discoveredTurn = nextTurn;
      discoveries.push(defect);
    }
  }
  return discoveries;
}

function refreshTestMilestones(state: ApolloIntegrationState): void {
  const baseIds = ["test-launch-interface", "test-spacecraft-interface", "test-guidance-ground"];
  const baseValid = baseIds.filter((id) => {
    const test = state.tests.find((candidate) => candidate.id === id);
    if (test?.status === "completed" && test.valid) return true;
    if (!test) return false;
    return state.tests.some(
      (candidate) =>
        candidate.status === "completed" &&
        candidate.valid &&
        test.coveredInterfaces.every((interfaceId) =>
          candidate.coveredInterfaces.includes(interfaceId),
        ),
    );
  }).length;
  const blockingComponentDefect = openDefects(state).some(
    (defect) =>
      defect.severity !== "minor" &&
      ["if-lv-cs", "if-cs-ls", "if-cs-gsw", "if-gsw-ground"].includes(defect.interfaceId),
  );
  getMilestone(state, "component-qualification").progress =
    baseValid === 3 && !blockingComponentDefect ? 100 : round((baseValid / 3) * 75, 1);

  const checkout = state.tests.find((test) => test.id === "test-integrated-checkout");
  const checkoutValid =
    checkout?.status === "completed" &&
    (checkout.valid ||
      state.tests.some(
        (candidate) =>
          candidate.status === "completed" &&
          candidate.valid &&
          checkout.coveredInterfaces.every((interfaceId) =>
            candidate.coveredInterfaces.includes(interfaceId),
          ),
      ));
  getMilestone(state, "integrated-checkout-gate").progress =
    checkoutValid && !blockingComponentDefect
      ? 100
      : checkout?.status === "completed"
        ? 60
        : 0;

  const demo = state.tests.find((test) => test.id === "test-uncrewed-campaign");
  const demoValid =
    demo?.status === "completed" &&
    (demo.valid ||
      state.tests.some(
        (candidate) =>
          candidate.status === "completed" &&
          candidate.valid &&
          demo.coveredInterfaces.every((interfaceId) =>
            candidate.coveredInterfaces.includes(interfaceId),
          ),
      ));
  getMilestone(state, "uncrewed-demonstration").progress =
    demoValid ? 100 : demo?.status === "completed" ? 55 : 0;
}

function runTests(
  state: ApolloIntegrationState,
  nextTurn: number,
  requestedStandMonths: number,
  contributions: ScenarioContribution[],
  events: string[],
): void {
  const interruptionTurn =
    state.mode === "guided"
      ? 11
      : 9 + Math.floor(deterministicFloat(state.seed, "facility-interruption-turn") * 4);
  const availableStandMonths = Math.max(
    0,
    requestedStandMonths - (nextTurn === interruptionTurn ? 1 : 0),
  );
  if (nextTurn === interruptionTurn && requestedStandMonths > 0) {
    events.push("An independent facility interruption removed one stand-month; the queue retained its order.");
  }
  let remaining = availableStandMonths;
  const queue = state.tests
    .filter((test) => eligibleTest(state, test, nextTurn))
    .sort(
      (a, b) =>
        Number(Boolean(b.retestForDefectId)) - Number(Boolean(a.retestForDefectId)) ||
        a.earliestTurn - b.earliestTurn ||
        a.id.localeCompare(b.id),
    );
  const usedArticles = new Set<string>();
  for (const test of queue) {
    if (test.standMonths > remaining || usedArticles.has(test.articleId)) continue;
    const article = state.articles.find((candidate) => candidate.id === test.articleId);
    if (!article) continue;
    usedArticles.add(test.articleId);
    remaining -= test.standMonths;
    article.status = "in-test";
    test.status = "completed";
    test.runTurn = nextTurn;
    test.configurationFingerprint = evidenceFingerprint(state, test.coveredInterfaces);
    test.valid = true;
    const discoveries = discoverDefects(state, test, nextTurn);
    test.discoveredDefectIds = discoveries.map((defect) => defect.id);
    if (discoveries.some((defect) => defect.severity !== "minor")) test.valid = false;
    state.metrics.testsRun += 1;
    state.metrics.defectsDiscovered += discoveries.length;
    article.status = discoveries.length > 0 ? "rework" : "available";
    article.configurationFingerprint = evidenceFingerprint(state, test.coveredInterfaces);

    if (test.retestForDefectId) {
      const defect = state.defects.find((candidate) => candidate.id === test.retestForDefectId);
      if (defect?.state === "awaiting-retest" && discoveries.length === 0) {
        defect.state = "closed";
        defect.closedTurn = nextTurn;
        state.metrics.defectsClosed += 1;
        article.status = "available";
        events.push(`${test.label} released valid evidence and closed ${defect.id}.`);
      }
    } else if (discoveries.length > 0) {
      const critical = discoveries.filter((defect) => defect.severity === "critical").length;
      events.push(
        `${test.label} revealed ${discoveries.length} keyed defect${discoveries.length === 1 ? "" : "s"}${critical > 0 ? `, including ${critical} critical finding${critical === 1 ? "" : "s"}` : ""}; the result added knowledge but not gate credit.`,
      );
    } else {
      events.push(`${test.label} released configuration-pinned evidence.`);
    }
    addContribution(
      contributions,
      "known defects",
      "test-discovery",
      discoveries.reduce((sum, defect) => sum + severityWeight(defect.severity), 0),
      "weighted defect points",
      discoveries.length > 0
        ? "Covered testing converted latent uncertainty into bounded, actionable rework."
        : "The covered test released evidence without discovering a seeded defect.",
    );
    addContribution(
      contributions,
      "valid evidence",
      "test-release",
      test.valid ? test.coverage * 100 : 0,
      "coverage points",
      test.valid
        ? "The result matches the article's recorded configuration fingerprint."
        : "The failed result remains knowledge but cannot satisfy a readiness gate.",
    );
  }
  refreshTestMilestones(state);
}

function handleReportsAndStress(
  state: ApolloIntegrationState,
  nextTurn: number,
  review: number,
  missionPosture: number,
  safetyScope: number,
  contributions: ScenarioContribution[],
  events: string[],
): void {
  const oldBias = state.reportBias;
  const pressure = Math.max(0, -state.scheduleMargin) + (missionPosture === 2 ? 2 : 0);
  state.reportBias = round(
    clamp(state.reportBias + pressure * 0.16 - review * 0.75, 0, 14),
    1,
  );
  if (review > 0) {
    state.metrics.reviewFindings += review;
    state.lastReportRevision = round(oldBias - state.reportBias, 1);
    if (Math.abs(state.lastReportRevision) >= 0.5) state.metrics.scheduleRevisions += 1;
    addContribution(
      contributions,
      "reported readiness bias",
      "report-revision",
      state.reportBias - oldBias,
      "percentage points",
      "Independent review revised the report's evidence and assumptions; it did not alter underlying work.",
    );
  } else {
    state.lastReportRevision = 0;
  }

  if (nextTurn === 6) {
    const backlogAddition = round(seededRange(state.seed, "delivery-reestimate", 7, 18), 1);
    const target = state.workstreams.find((stream) => stream.id === "landing-spacecraft");
    if (target) {
      const mitigated = round(backlogAddition * (review > 0 ? 0.72 : 1), 1);
      target.remainingEpm += mitigated;
      target.knownBacklogEpm += mitigated;
      events.push(
        `Acceptance data revised the landing-spacecraft backlog upward by ${mitigated} EPM${review > 0 ? "; prior review narrowed the surprise" : ""}.`,
      );
      addContribution(
        contributions,
        "remaining work",
        "contractor-acceptance",
        mitigated,
        "EPM",
        "Delivery evidence revised the estimate; no completed work was arbitrarily removed.",
      );
    }
  }

  state.safetyEvidence = round(
    clamp(state.safetyEvidence + safetyScope * 1.35 + review * 0.6, 0, 100),
    1,
  );
  if (nextTurn === 13) {
    const validCoverage = validEvidence(state).reduce((sum, test) => sum + test.coverage, 0);
    const criticalGap =
      validCoverage < 2.5 ||
      state.interfaces.some((record) => record.divergent) ||
      openDefects(state).some((defect) => defect.severity === "critical");
    if (criticalGap) {
      state.safetyHold = true;
      state.knownCriticalHazard = true;
      events.push(
        "Independent safety review issued a fictional evidence hold: critical coverage or configuration gaps remain. No injury event is modeled.",
      );
      addContribution(
        contributions,
        "safety gate",
        "safety-gate",
        -1,
        "gate state",
        "The finding blocks a crewed-readiness recommendation until configuration-valid evidence and critical corrections exist.",
      );
    } else {
      events.push("Independent safety review found no critical evidence gap in the modeled boundary.");
    }
  }
  if (
    state.safetyHold &&
    !openDefects(state).some((defect) => defect.severity === "critical") &&
    validEvidence(state).reduce((sum, test) => sum + test.coverage, 0) >= 3.4 &&
    state.interfaces.every((record) => !record.divergent) &&
    state.safetyEvidence >= 70
  ) {
    state.safetyHold = false;
    state.knownCriticalHazard = false;
    events.push("Configuration-valid evidence closed the fictional safety hold.");
  }
  if (
    nextTurn >= 17 &&
    review > 0 &&
    !state.safetyHold &&
    !state.knownCriticalHazard &&
    getMilestone(state, "uncrewed-demonstration").progress >= 100
  ) {
    getMilestone(state, "independent-safety-gate").progress = 100;
  }
}

function applySchedulePosture(
  state: ApolloIntegrationState,
  nextTurn: number,
  missionPosture: number,
  contributions: ScenarioContribution[],
  events: string[],
): void {
  if (missionPosture === 0 && nextTurn >= 9 && nextTurn % 3 === 0 && state.committedGateMonth < 22) {
    state.committedGateMonth += 1;
    events.push("Leadership accepted a one-month staged-gate rebaseline, preserving an uncrewed option.");
    addContribution(
      contributions,
      "committed gate",
      "critical-path-shift",
      1,
      "month",
      "The date moved through a declared rebaseline; underlying readiness did not jump.",
    );
  }
}

function finaliseRecommendation(
  state: ApolloIntegrationState,
  missionPosture: number,
  events: string[],
): void {
  if (state.turn !== TOTAL_TURNS) return;
  const demoValid =
    getMilestone(state, "uncrewed-demonstration").progress >= 100 &&
    validEvidence(state).some((test) => test.id === "test-uncrewed-campaign");
  const unsafe =
    state.safetyHold ||
    state.knownCriticalHazard ||
    openDefects(state).some((defect) => defect.severity === "critical") ||
    state.interfaces.some((record) => record.divergent) ||
    state.tests.some((test) => test.status === "invalidated");
  if (missionPosture === 2) {
    state.finalRecommendation = "crewed-readiness";
    state.redLineViolation = unsafe || !demoValid;
    events.push(
      state.redLineViolation
        ? "Handover recorded a red-line crewed-readiness recommendation unsupported by valid prerequisites."
        : "Handover recorded a crewed-readiness recommendation after all modeled gates; this is not a launch order or success probability.",
    );
  } else if (missionPosture === 1 && demoValid && !unsafe) {
    state.finalRecommendation = "uncrewed-step";
    events.push("Handover recommended the evidence-backed uncrewed step.");
  } else {
    state.finalRecommendation = "hold";
    events.push("Handover recommended hold/resequence while preserving the evidence and configuration record.");
  }
  state.complete = true;
}

function step(
  inputState: ApolloIntegrationState,
  decision: ScenarioDecision,
): ScenarioStepResult<ApolloIntegrationState> {
  const errors = validateDecision(inputState, decision);
  if (errors.length > 0) throw new Error(errors.join(" "));
  const state = cloneJson(inputState);
  const nextTurn = state.turn + 1;
  const events: string[] = [];
  const contributions: ScenarioContribution[] = [];
  const previousReadiness = state.trueReadiness;
  const previousMargin = state.scheduleMargin;
  const previousBudget = state.budgetK;

  const systemsReserve = decisionValue(decision, "systems-reserve");
  const testProgram = decisionValue(decision, "test-program");
  const configurationControl = decisionValue(decision, "configuration-control");
  const defectRecovery = decisionValue(decision, "defect-recovery");
  const independentReview = decisionValue(decision, "independent-review");
  const concurrency = decisionValue(decision, "concurrency-support");
  const missionPosture = decisionValue(decision, "mission-posture");
  const safetyScope = decisionValue(decision, "safety-scope");

  const cost =
    systemsReserve * 12 +
    testProgram * 42 +
    configurationControl * 18 +
    defectRecovery * 10 +
    independentReview * 24 +
    concurrency * 55 +
    safetyScope * 16;
  state.budgetK = round(state.budgetK - cost, 1);
  addContribution(
    contributions,
    "budget",
    "budget-settlement",
    -cost,
    "kFY66USD",
    "The ledger settled transfers, test bookings, review capacity, recovery, concurrency support, and safety work.",
  );

  const effectiveTransfer = advanceTransfers(
    state,
    nextTurn,
    systemsReserve,
    contributions,
  );
  reconcileInterfaces(
    state,
    configurationControl,
    nextTurn,
    contributions,
    events,
  );
  processKnownDefects(
    state,
    nextTurn,
    defectRecovery,
    configurationControl,
    contributions,
    events,
  );

  const routineChangeDraw = deterministicFloat(state.seed, `routine-change:${nextTurn}`);
  const routineThreshold = state.configurationFrozen ? 0.015 : 0.06 + concurrency * 0.055;
  if (nextTurn >= 4 && routineChangeDraw < routineThreshold) {
    const candidates: WorkstreamId[] = [
      "crew-spacecraft",
      "landing-spacecraft",
      "guidance-software",
      "ground-systems",
    ];
    const index = Math.floor(
      deterministicFloat(state.seed, `routine-change-target:${nextTurn}`) * candidates.length,
    );
    applyConfigurationChange(
      state,
      nextTurn,
      candidates[Math.min(index, candidates.length - 1)],
      "Concurrent engineering change",
      configurationControl,
      contributions,
      events,
    );
  }

  advanceEngineering(
    state,
    nextTurn,
    effectiveTransfer,
    concurrency,
    missionPosture,
    contributions,
  );
  runTests(state, nextTurn, testProgram, contributions, events);
  handleReportsAndStress(
    state,
    nextTurn,
    independentReview,
    missionPosture,
    safetyScope,
    contributions,
    events,
  );
  applySchedulePosture(state, nextTurn, missionPosture, contributions, events);

  const overloadClaim =
    systemsReserve +
    defectRecovery +
    safetyScope +
    testProgram * 2 +
    configurationControl +
    independentReview;
  if (overloadClaim > 22) {
    const pool = state.workforce.find((candidate) => candidate.id === "test-quality-safety");
    if (pool) pool.overloadMonths += 1;
    state.metrics.overloadMonths += 1;
    state.reportBias = round(clamp(state.reportBias + 0.4, 0, 14), 1);
    events.push("Specialist demand exceeded the sustainable central load; next-month quality/reporting exposure increased.");
    addContribution(
      contributions,
      "specialist overload",
      "coordination-load",
      1,
      "pool-month",
      "Nominal staffing did not become fungible effective capacity.",
    );
  }

  state.turn = nextTurn;
  updateDerivedState(state);
  addContribution(
    contributions,
    "true readiness",
    "readiness-recomputation",
    state.trueReadiness - previousReadiness,
    "percentage points",
    "Readiness was recomputed from milestones, valid evidence, configuration debt, training, and known defects; it was never directly edited.",
  );
  addContribution(
    contributions,
    "schedule margin",
    "critical-path-shift",
    state.scheduleMargin - previousMargin,
    "months",
    "The declared graph, queue, defect load, and gate calendar changed the earliest credible date.",
  );
  if (state.budgetK !== previousBudget - cost) {
    throw new Error("Apollo budget reconciliation invariant failed.");
  }
  finaliseRecommendation(state, missionPosture, events);

  const discoveredThisTurn = state.defects.filter(
    (defect) => defect.discoveredTurn === nextTurn,
  ).length;
  const headline =
    discoveredThisTurn > 0
      ? `${discoveredThisTurn} defect${discoveredThisTurn === 1 ? "" : "s"} became actionable; readiness evidence was recomputed.`
      : state.safetyHold
        ? "The independent evidence hold remains binding."
        : state.complete
          ? `Program Asteria handover recommends ${state.finalRecommendation.replaceAll("-", " ")}.`
          : `Earliest credible gate is month ${state.earliestReadyMonth}, with ${state.scheduleMargin >= 0 ? state.scheduleMargin : Math.abs(state.scheduleMargin)} month${Math.abs(state.scheduleMargin) === 1 ? "" : "s"} ${state.scheduleMargin >= 0 ? "of margin" : "late"}.`;

  return { state, headline, events, contributions };
}

function getView(state: ApolloIntegrationState): ScenarioView {
  const phase = phaseFor(Math.max(1, state.turn));
  const valid = validEvidence(state);
  const baseTests = state.tests.filter((test) => test.retestForDefectId === null);
  const validCoverage = round(
    valid.reduce((sum, test) => sum + test.coverage, 0) /
      Math.max(1, baseTests.reduce((sum, test) => sum + test.coverage, 0)) *
      100,
    1,
  );
  const known = openDefects(state);
  const critical = known.filter((defect) => defect.severity === "critical").length;
  const divergent = state.interfaces.filter((record) => record.divergent).length;
  const queueStandMonths = state.tests
    .filter((test) => test.status === "queued")
    .reduce((sum, test) => sum + test.standMonths, 0);
  const nominal = state.workforce.reduce((sum, pool) => sum + pool.nominalEpm, 0);
  const effective = state.workforce.reduce((sum, pool) => sum + pool.effectiveEpm, 0);
  const gateProgress = round(
    state.milestones.reduce((sum, milestone) => sum + milestone.progress, 0) /
      state.milestones.length,
    1,
  );

  const alerts = [];
  if (state.safetyHold) {
    alerts.push({
      id: "safety-hold",
      severity: "critical" as const,
      message: "Independent safety evidence hold blocks a crewed-readiness recommendation.",
    });
  }
  if (critical > 0) {
    alerts.push({
      id: "critical-defects",
      severity: "critical" as const,
      message: `${critical} known critical defect${critical === 1 ? "" : "s"} require correction and later retest.`,
    });
  }
  if (divergent > 0) {
    alerts.push({
      id: "configuration-divergence",
      severity: "warning" as const,
      message: `${divergent} interface fingerprint${divergent === 1 ? " is" : "s are"} divergent; overlapping evidence may be stale.`,
    });
  }
  if (state.scheduleMargin < 0) {
    alerts.push({
      id: "negative-margin",
      severity: "warning" as const,
      message: `The current committed gate precedes the median credible gate by ${Math.abs(state.scheduleMargin)} month${Math.abs(state.scheduleMargin) === 1 ? "" : "s"}.`,
    });
  }
  if (known.length > 0 && state.metrics.testsRun > 0) {
    alerts.push({
      id: "discovery-context",
      severity: "info" as const,
      message: "Known defects rose through covered testing; discovery is information, not lost physical progress.",
    });
  }
  if (state.complete && state.mode === "sandbox") {
    alerts.push({
      id: "aar-latent",
      severity: "info" as const,
      message: `${state.defects.filter((defect) => defect.state === "latent").length} seeded defects remained latent at handover.`,
    });
  }

  const unsafeRecommendation = state.complete && state.redLineViolation;
  return {
    dateLabel: MONTH_LABELS[Math.max(0, Math.min(TOTAL_TURNS - 1, state.turn - 1))],
    phase: phase.name,
    phaseDescription: phase.description,
    summary: state.complete
      ? `Handover: ${state.finalRecommendation.replaceAll("-", " ")}. This fictional analytic result is not a launch order, casualty probability, or claim about historical Apollo.`
      : `Program Asteria reports ${state.reportedReadiness}% readiness against ${validCoverage}% configuration-valid test coverage. The declared earliest-ready band is month ${state.earliestReadyBand[0]}–${state.earliestReadyBand[1]}.`,
    metrics: [
      {
        id: "gate-progress",
        label: "Milestone progress",
        value: gateProgress,
        unit: "%",
        status: gateProgress >= 80 ? "secure" : gateProgress >= 60 ? "watch" : "critical",
        detail: "Dependency-weighted milestone completion; not probability of success.",
      },
      {
        id: "earliest-ready",
        label: "Earliest ready",
        value: state.earliestReadyMonth,
        unit: "month",
        status: state.scheduleMargin >= 1 ? "secure" : state.scheduleMargin >= -1 ? "watch" : "critical",
        detail: `Current assumption band: month ${state.earliestReadyBand[0]}–${state.earliestReadyBand[1]}.`,
      },
      {
        id: "schedule-margin",
        label: "Schedule margin",
        value: state.scheduleMargin,
        unit: "months",
        status: state.scheduleMargin >= 1 ? "secure" : state.scheduleMargin >= 0 ? "watch" : "critical",
        detail: `Committed gate month ${state.committedGateMonth} minus median earliest-ready month.`,
      },
      {
        id: "critical-hazards",
        label: "Critical hazards/defects",
        value: critical + Number(state.knownCriticalHazard),
        unit: "open",
        status: critical + Number(state.knownCriticalHazard) === 0 ? "secure" : "critical",
        detail: "Known only; no casualty or mission-success probability is modeled.",
      },
      {
        id: "divergent-interfaces",
        label: "Divergent interfaces",
        value: divergent,
        unit: "interfaces",
        status: divergent === 0 ? "secure" : divergent <= 1 ? "watch" : "critical",
        detail: "Recorded baselines whose endpoint fingerprints no longer match current configurations.",
      },
      {
        id: "known-defects",
        label: "Known weighted defects",
        value: known.reduce((sum, defect) => sum + severityWeight(defect.severity), 0),
        unit: "points",
        status: critical > 0 ? "critical" : known.length > 2 ? "watch" : "secure",
        detail: `${known.length} open; defects and valid coverage must be read together.`,
      },
      {
        id: "valid-coverage",
        label: "Valid test coverage",
        value: validCoverage,
        unit: "%",
        status: validCoverage >= 75 ? "secure" : validCoverage >= 40 ? "watch" : "critical",
        detail: "Released evidence whose covered interface fingerprints still match.",
      },
      {
        id: "test-queue",
        label: "Test queue",
        value: queueStandMonths,
        unit: "stand-month",
        status: queueStandMonths <= 2 ? "secure" : queueStandMonths <= 5 ? "watch" : "critical",
        detail: "Queued eligible and prerequisite-blocked tests, including required retests.",
      },
      {
        id: "effective-workforce",
        label: "Effective / nominal workforce",
        value: round((effective / nominal) * 100, 1),
        unit: "%",
        status: effective / nominal >= 0.85 ? "secure" : effective / nominal >= 0.72 ? "watch" : "critical",
        detail: `${round(effective, 1)} of ${nominal} EPM/month effective after ramp; skills are not fungible.`,
      },
      {
        id: "budget",
        label: "Budget remaining",
        value: state.budgetK,
        unit: "kFY66USD",
        status: state.budgetK >= 900 ? "secure" : state.budgetK >= 350 ? "watch" : "critical",
        detail: `${round((state.budgetK / state.initialBudgetK) * 100, 1)}% of the bounded fictional reserve remains.`,
      },
    ],
    objectives: [
      {
        id: "red-line",
        label: "No unsupported crewed-readiness recommendation",
        priority: 1,
        value: unsafeRecommendation ? 0 : 1,
        unit: "binary",
        status: unsafeRecommendation ? "critical" : "secure",
        hard: true,
      },
      {
        id: "configuration-integrity",
        label: "Configuration and evidence integrity",
        priority: 2,
        value: divergent + state.tests.filter((test) => test.status === "invalidated").length,
        unit: "open gaps",
        status: divergent === 0 && state.tests.every((test) => test.status !== "invalidated") ? "secure" : "critical",
        hard: true,
      },
      {
        id: "uncrewed-gate",
        label: "Credible uncrewed integrated gate",
        priority: 3,
        value: getMilestone(state, "uncrewed-demonstration").progress,
        unit: "%",
        status: getMilestone(state, "uncrewed-demonstration").progress >= 100 ? "secure" : state.turn >= 16 ? "critical" : "watch",
        hard: true,
      },
      {
        id: "truthful-schedule",
        label: "Truthful recoverable schedule",
        priority: 4,
        value: round(Math.abs(state.reportedReadiness - state.trueReadiness), 1),
        unit: "report gap pp",
        status: Math.abs(state.reportedReadiness - state.trueReadiness) <= 2 ? "secure" : Math.abs(state.reportedReadiness - state.trueReadiness) <= 5 ? "watch" : "critical",
        hard: false,
      },
      {
        id: "capacity",
        label: "Budget and typed capacity",
        priority: 5,
        value: state.budgetK,
        unit: "kFY66USD",
        status: state.budgetK >= 900 ? "secure" : state.budgetK >= 350 ? "watch" : "critical",
        hard: false,
      },
      {
        id: "option-value",
        label: "Preserve staging option value",
        priority: 6,
        value: state.finalRecommendation === "crewed-readiness" ? 0 : 1,
        unit: "binary",
        status: state.finalRecommendation === "crewed-readiness" ? "watch" : "secure",
        hard: false,
      },
    ],
    alerts,
  };
}

const typedApolloIntegrationModel: ScenarioModel<ApolloIntegrationState> = {
  metadata: {
    id: "apollo-integration-1966",
    version: "1.0.0",
    title: "Apollo Integration, 1966",
    shortTitle: "Apollo Integration",
    deck:
      "Tests create information. Control a fictional Apollo-shaped development program where configuration-valid evidence matters more than green reports.",
    fidelity: "Fictional analytic; Apollo-derived mechanisms, uncalibrated and not historically predictive",
    role: "Composite Director of Program Control and Integration",
    period: "January 1966 – June 1967",
    turnLabel: "month",
    totalTurns: TOTAL_TURNS,
    sessionLength: "35–50 minutes",
    briefing: [
      "Program Asteria is a fictional tightly coupled development program, not a playable reconstruction of Apollo or Apollo 204.",
      "Seven workstreams share interfaces, typed engineers, articles, test stands, review capacity, and a bounded central budget.",
      "Tests may make the visible position look worse by exposing defects. Only evidence tied to the current configuration can satisfy a gate.",
      "You may recommend sequence and readiness, but you do not order a launch or waive a crew-safety prerequisite.",
    ],
    learningObjectives: [
      "Distinguish physical activity, reported progress, and configuration-valid evidence.",
      "Treat failed testing as information that can reduce latent uncertainty while increasing known rework.",
      "Predict how a change propagates into interfaces, articles, training, prior evidence, and the critical path.",
      "Protect typed bottlenecks and option value under schedule pressure.",
    ],
    modelNote:
      "Fictional analytic model with assumed parameters. Risk is an ordinal evidence band, never a casualty or mission-success probability. It makes no claim about Apollo accident preventability or historical optimality.",
    accent: "#d69a3a",
  },
  actions: ACTIONS,
  createInitialState,
  defaultDecision: (state) => defaultDecision(state),
  validateDecision: (state, decision) => validateDecision(state, decision),
  step: (state, decision) => step(state, decision),
  getView: (state) => getView(state),
};

/**
 * The registry intentionally erases scenario-owned state types. The typed model above
 * remains authoritative inside this module; this boundary is the generic plugin view.
 */
export const apolloIntegrationModel: AnyScenarioModel =
  typedApolloIntegrationModel as unknown as AnyScenarioModel;
