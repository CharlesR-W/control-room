import type { SimulationMode } from "../../sim/types.ts";
import {
  clamp,
  cloneJson,
  decisionValue,
  deterministicFloat,
  normaliseSeed,
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

type MonetaryRegime =
  | "gold_convertible"
  | "suspension_pending"
  | "floating";

type ExpectationVariant =
  | "declared-median"
  | "balance-sheet-contagion"
  | "unemployment-and-commitment"
  | "fiscal-credibility-orthodoxy"
  | "external-balance-correction";

type ReportKind =
  | "reserve-reconciliation"
  | "maturity-survey"
  | "capital-flow-classification"
  | "fiscal-reestimate"
  | "acceptance-exposure";

type PendingReport = {
  kind: ReportKind;
  requestedTurn: number;
  dueTurn: number;
};

type ReportRecord = {
  id: string;
  kind: ReportKind;
  asOfTurn: number;
  publishedTurn: number;
  coveragePermille: number;
  errorBandMinor: number;
  revisionOf: string | null;
  observedMinor: number;
};

type FiscalEffect = {
  dueTurn: number;
  cashMinor: number;
  demandPoints: number;
};

type ReserveLedger = {
  openingMinor: number;
  creditDrawMinor: number;
  otherInflowMinor: number;
  conversionSettlementMinor: number;
  externalPaymentMinor: number;
  interventionMinor: number;
  closingMinor: number;
  unpaidEligibleMinor: number;
  regimeAtSettlement: MonetaryRegime;
};

type ObjectiveSnapshot = {
  settlementFailure: boolean;
  paymentsBreakdown: boolean;
  externalArrears: boolean;
  cumulativeDomesticCost: number;
  truthfulReporting: number;
  transitionOrderliness: number;
  profile: string;
};

type VariantParameters = {
  id: ExpectationVariant;
  freezeWeight: number;
  unemploymentWeight: number;
  fiscalSignalWeight: number;
  externalWeight: number;
  rateEffect: number;
  coordinationThreshold: number;
};

export interface Sterling1931State extends ScenarioState {
  monetaryRegime: MonetaryRegime;

  // Monetary values use exact integer £10,000 units. Signed flows are named as flows.
  goldFxReservesMinor: number;
  earmarkedReservesMinor: number;
  undrawnExternalCreditMinor: number;
  drawnExternalLiabilityMinor: number;
  cumulativeCreditDrawsMinor: number;
  creditServiceDueMinor: number;
  externalArrearsMinor: number;
  conversionOrdersPendingMinor: number;
  foreignSterlingLiabilitiesMinor: number;
  frozenCentralEuropeClaimsMinor: number;
  fiscalCashBalanceMinor: number;
  projectedBudgetGapMinor: number;
  publicDebtShortMaturityMinor: number;

  sterlingSpotMilliDollars: number;
  sterlingForwardPressureBps: number;
  bankRateBps: number;
  acceptanceMarketLiquidity: number;
  clearingBankLiquidity: number;
  domesticDemandGap: number;
  registeredUnemploymentBps: number;
  competitivenessIndex: number;
  importPriceIndex: number;

  // These named model mechanisms are never exposed as live KPIs.
  exitBeliefPermille: number;
  policyConsistency: number;
  expectationVariant: ExpectationVariant;
  variantParameters: VariantParameters;

  legalReadiness: number;
  committeeCapacity: number;
  contingentSuspensionPrepared: boolean;
  suspensionEffectiveTurn: number | null;
  pendingSuspensionTurn: number | null;
  controlsActive: boolean;

  creditNegotiationDueTurn: number | null;
  creditFacilityMaximumMinor: number;
  creditFacilityExpiryTurn: number | null;
  firstCreditDrawTurn: number | null;
  pendingFiscalEffects: FiscalEffect[];
  pendingReports: PendingReport[];
  reports: ReportRecord[];

  observedReserveMinor: number;
  observedReserveAsOfTurn: number;
  observedLiabilitiesMinor: number;
  observedLiabilitiesAsOfTurn: number;
  observedUnemploymentBps: number;
  observedUnemploymentAsOfTurn: number;
  observedProjectedGapMinor: number;
  observedProjectedGapAsOfTurn: number;
  reserveErrorBandMinor: number;
  liabilityErrorBandMinor: number;

  centralEuropeWarningIssued: boolean;
  centralEuropeFreezeOccurred: boolean;
  mayReportPublished: boolean;
  withdrawalWarningIssued: boolean;
  withdrawalCoordinationOccurred: boolean;
  unsupportedAssurances: number;
  lowLiquidityStreak: number;
  cumulativeDomesticCost: number;
  lastGrossReserveLossMinor: number;
  lastNetReserveChangeMinor: number;
  lastCapacityUsed: number;
  lastReserveLedger: ReserveLedger;
  objectiveSnapshot: ObjectiveSnapshot;
  recentEvents: string[];

  epilogueExchangeDirection: "not-run" | "fixed" | "lower" | "mixed";
  epilogueImportPriceDirection: "not-run" | "flat" | "higher";
  epilogueCompetitivenessDirection: "not-run" | "flat" | "improving";
  epilogueUnemploymentDirection: "not-run" | "higher" | "easing" | "mixed";
}

const TOTAL_TURNS = 14;
const MONEY_PER_MILLION = 100;
const PARITY_MILLI_DOLLARS = 4_860;
const INITIAL_RESERVES_MINOR = 18_000;
const INITIAL_LIABILITIES_MINOR = 62_000;

const DATES = [
  "22–28 June 1931",
  "29 June–5 July 1931",
  "6–12 July 1931",
  "13–19 July 1931",
  "20–26 July 1931",
  "27 July–2 August 1931",
  "3–9 August 1931",
  "10–16 August 1931",
  "17–23 August 1931",
  "24–30 August 1931",
  "31 August–6 September 1931",
  "7–13 September 1931",
  "14–20 September 1931",
  "21–27 September 1931",
] as const;

const PHASES = [
  ["Opening ledger", "Separate usable reserves, earmarked assets, flows, and liabilities."],
  ["Observation gaps", "External-liability estimates remain partial and dated."],
  ["Frozen claims", "Merchant and acceptance-market exposures are not reserve cash."],
  ["Settlement pressure", "The Central European disruption reaches settlement channels."],
  ["Rate and liquidity", "Exchange defence and domestic market operation can diverge."],
  ["Fiscal vintage", "A published estimate changes information, not the reserve ledger."],
  ["Credit window", "A negotiated cash buffer creates an equal external liability."],
  ["Implementation", "Lead times and contractual terms constrain the apparent buffer."],
  ["Government crisis", "Fiscal arithmetic, hardship, and interpretation remain distinct."],
  ["Policy consistency", "Claims are compared with material policy and reserve coverage."],
  ["Maturity risk", "Preparation has option value as withdrawal risk becomes nonlinear."],
  ["Coordination risk", "Observable pressure may bunch otherwise modelled withdrawals."],
  ["Defend or prepare", "The next legal milestone can determine the settlement regime."],
  ["Regime decision", "Suspension can avert conversion failure but cannot erase obligations."],
] as const;

const VARIANTS: Record<ExpectationVariant, VariantParameters> = {
  "declared-median": {
    id: "declared-median",
    freezeWeight: 12,
    unemploymentWeight: 8,
    fiscalSignalWeight: 7,
    externalWeight: 9,
    rateEffect: 8,
    coordinationThreshold: 640,
  },
  "balance-sheet-contagion": {
    id: "balance-sheet-contagion",
    freezeWeight: 19,
    unemploymentWeight: 5,
    fiscalSignalWeight: 3,
    externalWeight: 12,
    rateEffect: 7,
    coordinationThreshold: 620,
  },
  "unemployment-and-commitment": {
    id: "unemployment-and-commitment",
    freezeWeight: 8,
    unemploymentWeight: 15,
    fiscalSignalWeight: 7,
    externalWeight: 8,
    rateEffect: 5,
    coordinationThreshold: 610,
  },
  "fiscal-credibility-orthodoxy": {
    id: "fiscal-credibility-orthodoxy",
    freezeWeight: 8,
    unemploymentWeight: 6,
    fiscalSignalWeight: 16,
    externalWeight: 8,
    rateEffect: 9,
    coordinationThreshold: 650,
  },
  "external-balance-correction": {
    id: "external-balance-correction",
    freezeWeight: 10,
    unemploymentWeight: 5,
    fiscalSignalWeight: 3,
    externalWeight: 18,
    rateEffect: 4,
    coordinationThreshold: 600,
  },
};

const ACTIONS: ScenarioActionSpec[] = [
  {
    id: "bank-rate-stance",
    label: "Recommend Bank Rate stance",
    description:
      "Choose −1, 0, or +1 percentage point. A rise may reduce later conversion demand but tightens domestic conditions.",
    commitment: "Recommendation jointly considered with the Bank",
    unit: "percentage-point step",
    min: -1,
    max: 1,
    step: 1,
    defaultValue: 0,
  },
  {
    id: "fiscal-package",
    label: "Design fiscal package",
    description:
      "0 none; 1 mixed revenue package; 2 deeper expenditure package; 3 temporary borrowing and relief.",
    commitment: "Recommendation requiring legislation and delayed cash effects",
    unit: "authored option",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 0,
    unlockTurn: 4,
  },
  {
    id: "external-credit",
    label: "Negotiate or draw external credit",
    description:
      "0 none; 1 negotiate within the visible envelope; 2 draw £50m from an agreed facility.",
    commitment: "Negotiation or contractual draw with matching liability",
    unit: "authored option",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 0,
    unlockTurn: 6,
  },
  {
    id: "funding-liquidity",
    label: "Domestic funding and liquidity",
    description:
      "0 conservative; 1 targeted eligible-collateral support; 2 broad open-market and acceptance support.",
    commitment: "Bank liaison operation; never an FX-reserve creation action",
    unit: "operation level",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 0,
    unlockTurn: 2,
  },
  {
    id: "emergency-preparation",
    label: "Prepare exchange emergency",
    description:
      "Draft legislation, bank circulars, dealer instructions, and legally contingent exchange orders.",
    commitment: "Preparation only; does not block conversion before legal effect",
    unit: "preparation level",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 0,
    unlockTurn: 8,
  },
  {
    id: "public-communication",
    label: "Issue public communication",
    description:
      "0 none; 1 unconditional parity defence; 2 factual reserve briefing; 3 conditional defence or transition statement.",
    commitment: "Public claim retained for consistency review",
    unit: "authored option",
    min: 0,
    max: 3,
    step: 1,
    defaultValue: 0,
  },
  {
    id: "regime-recommendation",
    label: "Make regime recommendation",
    description:
      "0 continue; 1 prepare contingent suspension; 2 recommend immediate emergency legislation.",
    commitment: "Cabinet and Parliament recommendation; irreversible after effect",
    unit: "authored option",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: 0,
    unlockTurn: 10,
  },
  {
    id: "information-audit",
    label: "Commission information or audit",
    description:
      "1 reserves; 2 maturities; 3 flow classification; 4 fiscal re-estimate; 5 acceptance exposure.",
    commitment: "Dated report delivered after a one- or two-week lag",
    unit: "report option",
    min: 0,
    max: 5,
    step: 1,
    defaultValue: 0,
  },
];

function moneyMillions(minor: number): number {
  return Math.round(minor) / MONEY_PER_MILLION;
}

function integer(value: number): number {
  return Math.round(value);
}

function selectedVariant(seed: number, mode: SimulationMode): ExpectationVariant {
  if (mode === "guided") return "declared-median";
  const ids: ExpectationVariant[] = [
    "balance-sheet-contagion",
    "unemployment-and-commitment",
    "fiscal-credibility-orthodoxy",
    "external-balance-correction",
  ];
  return ids[Math.floor(deterministicFloat(seed, "expectation-variant-v1") * ids.length)]!;
}

function capacityCost(decision: ScenarioDecision): number {
  const rate = Math.abs(decisionValue(decision, "bank-rate-stance"));
  const fiscal = decisionValue(decision, "fiscal-package");
  const credit = decisionValue(decision, "external-credit");
  const liquidity = decisionValue(decision, "funding-liquidity");
  const preparation = decisionValue(decision, "emergency-preparation");
  const communication = decisionValue(decision, "public-communication");
  const regime = decisionValue(decision, "regime-recommendation");
  const audit = decisionValue(decision, "information-audit");
  return (
    (rate === 0 ? 0 : 1) +
    (fiscal === 0 ? 0 : fiscal === 2 ? 3 : 2) +
    (credit === 0 ? 0 : credit === 1 ? 2 : 1) +
    liquidity +
    preparation +
    (communication === 0 ? 0 : 1) +
    (regime === 0 ? 0 : 2) +
    (audit === 0 ? 0 : 1)
  );
}

function actionValues(decision: ScenarioDecision): Record<string, number> {
  return Object.fromEntries(
    ACTIONS.map((action) => [
      action.id,
      decisionValue(decision, action.id, Number.NaN),
    ]),
  );
}

function validateDecision(
  state: Sterling1931State,
  decision: ScenarioDecision,
): string[] {
  const errors: string[] = [];
  const known = new Set(ACTIONS.map((action) => action.id));
  for (const key of Object.keys(decision.values)) {
    if (!known.has(key)) errors.push(`Unknown action "${key}".`);
  }
  for (const action of ACTIONS) {
    const value = decision.values[action.id];
    if (!Number.isFinite(value)) {
      errors.push(`${action.label} must be a finite number.`);
      continue;
    }
    if (!Number.isInteger(value)) {
      errors.push(`${action.label} must use an authored integer option.`);
    }
    if (value < action.min || value > action.max) {
      errors.push(
        `${action.label} must be between ${action.min} and ${action.max} ${action.unit}.`,
      );
    }
    if (
      state.mode === "guided" &&
      (action.unlockTurn ?? 0) > state.turn &&
      value !== 0
    ) {
      errors.push(`${action.label} is not yet available on the Analytic Desk.`);
    }
  }
  if (state.complete) errors.push("The fourteen decision weeks are complete.");
  const values = actionValues(decision);
  const used = capacityCost(decision);
  if (used > state.committeeCapacity) {
    errors.push(
      `Committee capacity exceeded: requested ${used}, available ${state.committeeCapacity} team-weeks.`,
    );
  }
  if (values["external-credit"] === 1) {
    if (
      state.creditNegotiationDueTurn !== null ||
      state.undrawnExternalCreditMinor > 0 ||
      state.drawnExternalLiabilityMinor > 0
    ) {
      errors.push(
        "A credit negotiation, agreed facility, or outstanding facility principal already exists.",
      );
    }
    if (state.turn < 6) errors.push("No authored foreign-credit window is open yet.");
  }
  if (values["external-credit"] === 2) {
    if (state.undrawnExternalCreditMinor < 5_000) {
      errors.push(
        `Requested £50m draw exceeds the agreed undrawn facility of £${moneyMillions(state.undrawnExternalCreditMinor)}m.`,
      );
    }
    if (
      state.creditFacilityExpiryTurn !== null &&
      state.turn + 1 > state.creditFacilityExpiryTurn
    ) {
      errors.push("The agreed credit facility has expired.");
    }
  }
  if (values["regime-recommendation"] > 0 && state.monetaryRegime !== "gold_convertible") {
    errors.push("Convertibility has already entered an irreversible transition.");
  }
  const requestedRate =
    state.bankRateBps + values["bank-rate-stance"]! * 100;
  if (requestedRate < 200 || requestedRate > 800) {
    errors.push(
      `Requested Bank Rate of ${requestedRate / 100}% is outside the authored 2–8% catalogue.`,
    );
  }
  if (values["regime-recommendation"] === 2) {
    if (state.turn < 10) errors.push("The emergency legislative gateway is not open.");
    if (state.legalReadiness < 350) {
      errors.push(
        `Immediate legislation requires 350 readiness points; ${state.legalReadiness} are available.`,
      );
    }
  }
  if (values["fiscal-package"] > 0 && state.pendingFiscalEffects.length > 0) {
    errors.push("An incompatible fiscal package is already in its implementation slot.");
  }
  if (values["information-audit"] > 0) {
    const kind = reportKind(values["information-audit"]);
    if (state.pendingReports.some((report) => report.kind === kind)) {
      errors.push("That institutional return is already in production.");
    }
  }
  return errors;
}

function reportKind(option: number): ReportKind {
  switch (option) {
    case 1:
      return "reserve-reconciliation";
    case 2:
      return "maturity-survey";
    case 3:
      return "capital-flow-classification";
    case 4:
      return "fiscal-reestimate";
    default:
      return "acceptance-exposure";
  }
}

function initialObjective(): ObjectiveSnapshot {
  return {
    settlementFailure: false,
    paymentsBreakdown: false,
    externalArrears: false,
    cumulativeDomesticCost: 0,
    truthfulReporting: 850,
    transitionOrderliness: 500,
    profile: "open / obligations-current",
  };
}

function createInitialState(
  seedInput: number,
  mode: SimulationMode,
): Sterling1931State {
  const seed = normaliseSeed(seedInput);
  const variant = selectedVariant(seed, mode);
  const liabilityOffset = integer(
    (deterministicFloat(seed, "opening-liability-uncertainty") - 0.5) * 5_000,
  );
  const state: Sterling1931State = {
    turn: 0,
    complete: false,
    seed,
    mode,
    monetaryRegime: "gold_convertible",
    goldFxReservesMinor: INITIAL_RESERVES_MINOR,
    earmarkedReservesMinor: 3_000,
    undrawnExternalCreditMinor: 0,
    drawnExternalLiabilityMinor: 0,
    cumulativeCreditDrawsMinor: 0,
    creditServiceDueMinor: 0,
    externalArrearsMinor: 0,
    conversionOrdersPendingMinor: 1_000,
    foreignSterlingLiabilitiesMinor: INITIAL_LIABILITIES_MINOR + liabilityOffset,
    frozenCentralEuropeClaimsMinor: 3_000,
    fiscalCashBalanceMinor: -120,
    projectedBudgetGapMinor: 12_000,
    publicDebtShortMaturityMinor: 40_000,
    sterlingSpotMilliDollars: PARITY_MILLI_DOLLARS,
    sterlingForwardPressureBps: 180,
    bankRateBps: 250,
    acceptanceMarketLiquidity: 760,
    clearingBankLiquidity: 820,
    domesticDemandGap: -80,
    registeredUnemploymentBps: 1_520,
    competitivenessIndex: 10_000,
    importPriceIndex: 10_000,
    exitBeliefPermille: 220,
    policyConsistency: 650,
    expectationVariant: variant,
    variantParameters: cloneJson(VARIANTS[variant]),
    legalReadiness: 0,
    committeeCapacity: 4,
    contingentSuspensionPrepared: false,
    suspensionEffectiveTurn: null,
    pendingSuspensionTurn: null,
    controlsActive: false,
    creditNegotiationDueTurn: null,
    creditFacilityMaximumMinor: 0,
    creditFacilityExpiryTurn: null,
    firstCreditDrawTurn: null,
    pendingFiscalEffects: [],
    pendingReports: [],
    reports: [],
    observedReserveMinor: 17_700,
    observedReserveAsOfTurn: 0,
    observedLiabilitiesMinor: 55_000,
    observedLiabilitiesAsOfTurn: 0,
    observedUnemploymentBps: 1_500,
    observedUnemploymentAsOfTurn: 0,
    observedProjectedGapMinor: 12_000,
    observedProjectedGapAsOfTurn: 0,
    reserveErrorBandMinor: 900,
    liabilityErrorBandMinor: 7_000,
    centralEuropeWarningIssued: false,
    centralEuropeFreezeOccurred: false,
    mayReportPublished: false,
    withdrawalWarningIssued: false,
    withdrawalCoordinationOccurred: false,
    unsupportedAssurances: 0,
    lowLiquidityStreak: 0,
    cumulativeDomesticCost: 0,
    lastGrossReserveLossMinor: 0,
    lastNetReserveChangeMinor: 0,
    lastCapacityUsed: 0,
    lastReserveLedger: {
      openingMinor: INITIAL_RESERVES_MINOR,
      creditDrawMinor: 0,
      otherInflowMinor: 0,
      conversionSettlementMinor: 0,
      externalPaymentMinor: 0,
      interventionMinor: 0,
      closingMinor: INITIAL_RESERVES_MINOR,
      unpaidEligibleMinor: 0,
      regimeAtSettlement: "gold_convertible",
    },
    objectiveSnapshot: initialObjective(),
    recentEvents: [],
    epilogueExchangeDirection: "not-run",
    epilogueImportPriceDirection: "not-run",
    epilogueCompetitivenessDirection: "not-run",
    epilogueUnemploymentDirection: "not-run",
  };
  assertState(state);
  return state;
}

function addContribution(
  contributions: ScenarioContribution[],
  target: string,
  source: string,
  delta: number,
  unit: string,
  explanation: string,
): void {
  contributions.push({ target, source, delta, unit, explanation });
}

function applyOpeningMilestones(
  state: Sterling1931State,
  turn: number,
  events: string[],
): void {
  if (
    state.creditNegotiationDueTurn !== null &&
    state.creditNegotiationDueTurn <= turn
  ) {
    const maximum = 10_000;
    state.creditFacilityMaximumMinor = maximum;
    state.undrawnExternalCreditMinor = maximum;
    state.creditFacilityExpiryTurn = Math.min(TOTAL_TURNS, turn + 5);
    state.creditNegotiationDueTurn = null;
    events.push(
      "A £100m external-credit envelope is agreed for this model run. Cash remains undrawn; no reserves or net worth have been created.",
    );
  }
  if (
    state.pendingSuspensionTurn !== null &&
    state.pendingSuspensionTurn <= turn &&
    state.monetaryRegime === "suspension_pending"
  ) {
    state.monetaryRegime = "floating";
    state.suspensionEffectiveTurn = turn;
    state.pendingSuspensionTurn = null;
    events.push(
      "Emergency legislation takes effect before this settlement window. Bullion-conversion settlement ends; external payments and credit service remain due.",
    );
  }
}

function releaseReports(
  state: Sterling1931State,
  turn: number,
  events: string[],
): void {
  const due = state.pendingReports.filter((report) => report.dueTurn <= turn);
  state.pendingReports = state.pendingReports.filter(
    (report) => report.dueTurn > turn,
  );
  for (const pending of due) {
    const errorSign =
      deterministicFloat(
        state.seed,
        `report-${pending.kind}-${pending.requestedTurn}`,
      ) -
      0.5;
    let observed = 0;
    let errorBand = 0;
    let coverage = 780;
    if (pending.kind === "reserve-reconciliation") {
      errorBand = Math.max(150, integer(state.reserveErrorBandMinor * 0.55));
      observed = Math.max(
        0,
        state.goldFxReservesMinor + integer(errorSign * errorBand),
      );
      state.observedReserveMinor = observed;
      state.observedReserveAsOfTurn = turn - 1;
      state.reserveErrorBandMinor = errorBand;
      coverage = 900;
    } else if (
      pending.kind === "maturity-survey" ||
      pending.kind === "capital-flow-classification"
    ) {
      errorBand = Math.max(1_200, integer(state.liabilityErrorBandMinor * 0.72));
      observed = Math.max(
        0,
        state.foreignSterlingLiabilitiesMinor +
          integer(errorSign * errorBand),
      );
      state.observedLiabilitiesMinor = observed;
      state.observedLiabilitiesAsOfTurn = turn - 1;
      state.liabilityErrorBandMinor = errorBand;
      coverage = pending.kind === "maturity-survey" ? 760 : 820;
    } else if (pending.kind === "fiscal-reestimate") {
      errorBand = 700;
      observed = Math.max(
        0,
        state.projectedBudgetGapMinor + integer(errorSign * errorBand),
      );
      state.observedProjectedGapMinor = observed;
      state.observedProjectedGapAsOfTurn = turn - 1;
      coverage = 880;
    } else {
      errorBand = 70;
      observed = clamp(
        state.acceptanceMarketLiquidity + integer(errorSign * errorBand),
        0,
        1_000,
      );
      coverage = 720;
    }
    const previous = [...state.reports]
      .reverse()
      .find((report) => report.kind === pending.kind);
    const record: ReportRecord = {
      id: `${pending.kind}-t${turn}`,
      kind: pending.kind,
      asOfTurn: turn - 1,
      publishedTurn: turn,
      coveragePermille: coverage,
      errorBandMinor: errorBand,
      revisionOf: previous?.id ?? null,
      observedMinor: integer(observed),
    };
    state.reports.push(record);
    events.push(
      `${pending.kind.replaceAll("-", " ")} published: dated to week ${record.asOfTurn}, ${coverage / 10}% coverage, ±${pending.kind === "acceptance-exposure" ? errorBand + " index points" : "£" + moneyMillions(errorBand) + "m"}.`,
    );
  }
}

function scheduledEvents(
  state: Sterling1931State,
  turn: number,
  events: string[],
): void {
  if (turn === 2 && !state.centralEuropeWarningIssued) {
    state.centralEuropeWarningIssued = true;
    events.push(
      "Central European payments warning: reported claims may be frozen assets rather than usable reserve cash.",
    );
  }
  if (turn === 4 && !state.centralEuropeFreezeOccurred) {
    state.centralEuropeFreezeOccurred = true;
    state.frozenCentralEuropeClaimsMinor += 4_000;
    state.foreignSterlingLiabilitiesMinor += 1_400;
    state.acceptanceMarketLiquidity = Math.max(
      0,
      state.acceptanceMarketLiquidity - 150,
    );
    state.liabilityErrorBandMinor += 1_500;
    events.push(
      "Central European payments freeze: acceptance-market strain and recalled foreign balances rise through named settlement channels; no arbitrary reserve lump sum is removed.",
    );
  }
  if (turn === 6 && !state.mayReportPublished) {
    state.mayReportPublished = true;
    state.observedProjectedGapMinor = 17_000;
    state.observedProjectedGapAsOfTurn = 5;
    state.projectedBudgetGapMinor = Math.max(
      state.projectedBudgetGapMinor,
      16_500,
    );
    events.push(
      "May Committee report publication: a dated fiscal-gap estimate enters the public information set. Its market effect is variant-dependent, not historical proof.",
    );
  }
}

function updatePolicyAndQueue(
  state: Sterling1931State,
  decision: ScenarioDecision,
  turn: number,
  events: string[],
  contributions: ScenarioContribution[],
): { creditDrawMinor: number; communicationEffect: number } {
  const values = actionValues(decision);
  const openingReadiness = state.legalReadiness;
  const oldRate = state.bankRateBps;
  state.bankRateBps = clamp(
    state.bankRateBps + values["bank-rate-stance"]! * 100,
    200,
    800,
  );
  if (state.bankRateBps !== oldRate) {
    addContribution(
      contributions,
      "bank_rate",
      "bank-rate-stance",
      (state.bankRateBps - oldRate) / 100,
      "percentage points",
      "The committee recommended an authored rate step; the model applies it at the next-business-day milestone.",
    );
  }

  const fiscal = values["fiscal-package"]!;
  if (fiscal > 0) {
    const projectedChange = fiscal === 1 ? -1_600 : fiscal === 2 ? -2_900 : 900;
    const cash = fiscal === 1 ? 80 : fiscal === 2 ? 145 : -110;
    const demand = fiscal === 1 ? -35 : fiscal === 2 ? -70 : 35;
    const oldGap = state.projectedBudgetGapMinor;
    state.projectedBudgetGapMinor = Math.max(
      0,
      state.projectedBudgetGapMinor + projectedChange,
    );
    state.pendingFiscalEffects.push(
      { dueTurn: turn + 2, cashMinor: cash, demandPoints: demand },
      {
        dueTurn: turn + 3,
        cashMinor: fiscal === 3 ? -60 : integer(cash * 0.8),
        demandPoints: integer(demand * 0.7),
      },
    );
    addContribution(
      contributions,
      "projected_budget_gap",
      "fiscal-package-announcement",
      moneyMillions(state.projectedBudgetGapMinor - oldGap),
      "£m annual estimate",
      `The authored package changes the published projection before cash. Interpretation uses ${state.expectationVariant}, one disputed model variant.`,
    );
  }

  if (values["external-credit"] === 1) {
    state.creditNegotiationDueTurn = turn + 2;
    events.push(
      "External-credit negotiation opened. Capacity is spent now; agreement and cash remain contingent on the visible envelope.",
    );
  }
  let creditDrawMinor = 0;
  if (values["external-credit"] === 2) {
    creditDrawMinor = 5_000;
    state.undrawnExternalCreditMinor -= creditDrawMinor;
    state.drawnExternalLiabilityMinor += creditDrawMinor;
    state.cumulativeCreditDrawsMinor += creditDrawMinor;
    if (state.firstCreditDrawTurn === null) state.firstCreditDrawTurn = turn;
    state.creditServiceDueMinor = integer(
      state.drawnExternalLiabilityMinor * 0.002,
    );
    addContribution(
      contributions,
      "drawn_external_liability",
      "external-credit-draw",
      moneyMillions(creditDrawMinor),
      "£m principal",
      "The contractual draw increases cash and matching external principal by exactly the same amount.",
    );
  }

  const preparation = values["emergency-preparation"]!;
  if (preparation > 0) {
    state.legalReadiness = clamp(
      state.legalReadiness + preparation * 180,
      0,
      1_000,
    );
    if (
      state.monetaryRegime === "floating" &&
      preparation === 2 &&
      openingReadiness >= 350
    ) {
      state.controlsActive = true;
      events.push(
        "A narrow temporary exchange order is activated under post-suspension authority. It cannot reverse prior settlement and carries administrative trade friction.",
      );
    }
  } else if (state.legalReadiness > 0 && state.monetaryRegime === "gold_convertible") {
    state.legalReadiness = Math.max(0, state.legalReadiness - 15);
  }

  const regime = values["regime-recommendation"]!;
  if (regime === 1) {
    state.contingentSuspensionPrepared = true;
    state.policyConsistency = Math.min(1_000, state.policyConsistency + 25);
  } else if (regime === 2) {
    state.monetaryRegime = "suspension_pending";
    state.pendingSuspensionTurn = openingReadiness >= 700 ? turn : turn + 1;
    events.push(
      openingReadiness >= 700
        ? "Emergency legislation is prepared for an opening-of-week milestone before settlement."
        : "Emergency legislation is queued; current eligible settlements remain payable until legal effect.",
    );
    applyOpeningMilestones(state, turn, events);
  }

  let communicationEffect = 0;
  const communication = values["public-communication"]!;
  const usable = state.goldFxReservesMinor - state.earmarkedReservesMinor;
  if (communication === 1) {
    const supported = usable > state.conversionOrdersPendingMinor * 5;
    if (supported) {
      communicationEffect = -25;
      state.policyConsistency = Math.min(1_000, state.policyConsistency + 15);
    } else {
      state.unsupportedAssurances += 1;
      communicationEffect = 35 + state.unsupportedAssurances * 15;
      state.policyConsistency = Math.max(0, state.policyConsistency - 90);
    }
  } else if (communication === 2) {
    communicationEffect = -10;
    state.policyConsistency = Math.min(1_000, state.policyConsistency + 30);
  } else if (communication === 3) {
    const prepared = state.legalReadiness >= 350;
    communicationEffect = prepared ? -20 : 20;
    state.policyConsistency = clamp(
      state.policyConsistency + (prepared ? 35 : -35),
      0,
      1_000,
    );
  }

  const audit = values["information-audit"]!;
  if (audit > 0) {
    const kind = reportKind(audit);
    state.pendingReports.push({
      kind,
      requestedTurn: turn,
      dueTurn: turn + (kind === "maturity-survey" ? 2 : 1),
    });
  }
  return { creditDrawMinor, communicationEffect };
}

function updateLatentBelief(
  state: Sterling1931State,
  communicationEffect: number,
  contributions: ScenarioContribution[],
): void {
  const oldBelief = state.exitBeliefPermille;
  const p = state.variantParameters;
  const usable = Math.max(
    1,
    state.goldFxReservesMinor - state.earmarkedReservesMinor,
  );
  const coverageStress = clamp(
    integer((state.conversionOrdersPendingMinor * 4 * 1_000) / usable) - 350,
    0,
    500,
  );
  const freezeStress = state.centralEuropeFreezeOccurred
    ? integer(
        (state.frozenCentralEuropeClaimsMinor * p.freezeWeight) / 10_000,
      )
    : 0;
  const unemploymentStress = integer(
    (Math.max(0, state.registeredUnemploymentBps - 1_400) *
      p.unemploymentWeight) /
      100,
  );
  const fiscalStress = state.mayReportPublished
    ? integer(
        (Math.max(0, state.observedProjectedGapMinor - 11_000) *
          p.fiscalSignalWeight) /
          10_000,
      )
    : 0;
  const externalStress = integer(
    (state.foreignSterlingLiabilitiesMinor * p.externalWeight) /
      Math.max(40_000, usable * 25),
  );
  const consistencyRelief = integer((state.policyConsistency - 500) / 18);
  const delta = clamp(
    integer(
      -8 +
        coverageStress / 16 +
        freezeStress +
        unemploymentStress +
        fiscalStress +
        externalStress +
        communicationEffect -
        consistencyRelief,
    ),
    -80,
    130,
  );
  state.exitBeliefPermille = clamp(oldBelief + delta, 20, 980);
  addContribution(
    contributions,
    "exit_belief",
    `named-variant:${state.expectationVariant}`,
    state.exitBeliefPermille - oldBelief,
    "latent permille",
    "Post-run-only trace: observable reserve coverage, forward pressure, unemployment, fiscal vintage, communications, and policy consistency enter the declared expectation mechanism.",
  );
}

function maybeTriggerCoordination(
  state: Sterling1931State,
  turn: number,
  events: string[],
): number {
  if (turn < 11 || state.withdrawalCoordinationOccurred) return 0;
  const usable = Math.max(
    1,
    state.goldFxReservesMinor - state.earmarkedReservesMinor,
  );
  const coverage = integer(
    (usable * 1_000) / Math.max(1, state.foreignSterlingLiabilitiesMinor),
  );
  const signal =
    state.exitBeliefPermille +
    integer(state.sterlingForwardPressureBps / 2) +
    Math.max(0, 240 - coverage);
  const seededThreshold =
    state.variantParameters.coordinationThreshold +
    integer(
      (deterministicFloat(state.seed, "coordination-threshold-v1") - 0.5) *
        90,
    );
  if (!state.withdrawalWarningIssued && signal >= seededThreshold - 100) {
    state.withdrawalWarningIssued = true;
    events.push(
      "Dealer pressure and withdrawal notices bunch above their recent range. This is an observable warning proxy, not a confidence gauge.",
    );
  }
  if (signal >= seededThreshold) {
    state.withdrawalCoordinationOccurred = true;
    events.push(
      "Withdrawal coordination event: the named expectation mechanism bunches already-modelled foreign withdrawals. The threshold is a seeded assumption, not a uniquely decisive historical cause.",
    );
    return 1_100 + integer((signal - seededThreshold) * 3);
  }
  return 0;
}

function realiseConversionDemand(
  state: Sterling1931State,
  turn: number,
  coordinationMinor: number,
  contributions: ScenarioContribution[],
): number {
  if (state.monetaryRegime === "floating") {
    state.conversionOrdersPendingMinor = 0;
    return 0;
  }
  const p = state.variantParameters;
  const fundamental = 620 + turn * 35;
  const foreignWithdrawal = integer(
    (state.exitBeliefPermille *
      (420 + p.externalWeight * 18)) /
      1_000,
  );
  const assetRecall = state.centralEuropeFreezeOccurred
    ? integer((state.frozenCentralEuropeClaimsMinor * p.freezeWeight) / 18_000)
    : 0;
  const expectationDemand = Math.max(
    0,
    integer((state.exitBeliefPermille - 360) * 2.2),
  );
  const rateResponse = integer(
    (Math.max(0, state.bankRateBps - 250) * p.rateEffect) / 10,
  );
  const controlEffect = state.controlsActive ? 300 : 0;
  const demand = Math.max(
    0,
    fundamental +
      foreignWithdrawal +
      assetRecall +
      expectationDemand +
      coordinationMinor -
      rateResponse -
      controlEffect,
  );
  state.conversionOrdersPendingMinor = demand;
  addContribution(
    contributions,
    "conversion_demand",
    "fundamental-external-settlement",
    moneyMillions(fundamental),
    "£m / week",
    "Ordinary external settlement pressure is a signed contribution before the non-negative demand floor.",
  );
  addContribution(
    contributions,
    "conversion_demand",
    "foreign-balance-withdrawal",
    moneyMillions(foreignWithdrawal),
    "£m / week",
    `Foreign withdrawals respond to observable stress through ${state.expectationVariant}; this is model behaviour, not a historical measurement.`,
  );
  addContribution(
    contributions,
    "conversion_demand",
    "asset-freeze-recall",
    moneyMillions(assetRecall),
    "£m / week",
    "Frozen Central European claims raise recall pressure but remain separate from reserve cash.",
  );
  addContribution(
    contributions,
    "conversion_demand",
    "expectation-coordination",
    moneyMillions(expectationDemand + coordinationMinor),
    "£m / week",
    "A named latent-belief mechanism contributes only through realised withdrawal orders.",
  );
  addContribution(
    contributions,
    "conversion_demand",
    "bank-rate-response",
    -moneyMillions(rateResponse),
    "£m / week",
    "The active variant permits an uncertain, diminishing rate response; rate changes do not create reserves.",
  );
  return demand;
}

function settleReserveLedger(
  state: Sterling1931State,
  creditDrawMinor: number,
  demandMinor: number,
  contributions: ScenarioContribution[],
): void {
  const opening = state.goldFxReservesMinor;
  const regimeAtSettlement = state.monetaryRegime;
  let available = opening + creditDrawMinor;
  const usable = Math.max(0, available - state.earmarkedReservesMinor);
  const eligible =
    regimeAtSettlement === "gold_convertible" ? demandMinor : 0;
  const conversion = Math.min(eligible, usable);
  available -= conversion;
  const unpaidEligible = eligible - conversion;

  const ordinaryExternalPayment = 90;
  const service =
    state.firstCreditDrawTurn !== null &&
    state.turn - state.firstCreditDrawTurn >= 3
      ? state.creditServiceDueMinor
      : 0;
  const paymentDue = ordinaryExternalPayment + service;
  const paymentCapacity = Math.max(0, available - state.earmarkedReservesMinor);
  const externalPayment = Math.min(paymentDue, paymentCapacity);
  const arrears = paymentDue - externalPayment;
  state.externalArrearsMinor += arrears;
  available -= externalPayment;
  state.goldFxReservesMinor = available;
  state.lastGrossReserveLossMinor = conversion + externalPayment;
  state.lastNetReserveChangeMinor =
    state.goldFxReservesMinor - opening;
  state.lastReserveLedger = {
    openingMinor: opening,
    creditDrawMinor,
    otherInflowMinor: 0,
    conversionSettlementMinor: conversion,
    externalPaymentMinor: externalPayment,
    interventionMinor: 0,
    closingMinor: state.goldFxReservesMinor,
    unpaidEligibleMinor: unpaidEligible,
    regimeAtSettlement,
  };
  if (creditDrawMinor !== 0) {
    addContribution(
      contributions,
      "gold_fx_reserves",
      "external-credit-cash",
      moneyMillions(creditDrawMinor),
      "£m",
      "Credit cash enters official reserves with an exactly matching external principal contribution.",
    );
  }
  if (conversion !== 0) {
    addContribution(
      contributions,
      "gold_fx_reserves",
      "eligible-conversion-settlement",
      -moneyMillions(conversion),
      "£m",
      `Eligible orders settled under ${regimeAtSettlement}; no later legal change can reverse this entry.`,
    );
  }
  addContribution(
    contributions,
    "gold_fx_reserves",
    "ordinary-payments-and-credit-service",
    -moneyMillions(externalPayment),
    "£m",
    "Ordinary external payments and any due credit service remain payable in either monetary regime.",
  );
}

function executeDomesticAndFiscal(
  state: Sterling1931State,
  decision: ScenarioDecision,
  turn: number,
  contributions: ScenarioContribution[],
): void {
  const liquidity = decisionValue(decision, "funding-liquidity");
  const oldAcceptance = state.acceptanceMarketLiquidity;
  const oldClearing = state.clearingBankLiquidity;
  const freezeDrag = state.centralEuropeFreezeOccurred ? 32 : 8;
  state.acceptanceMarketLiquidity = clamp(
    state.acceptanceMarketLiquidity - freezeDrag + liquidity * 70,
    0,
    1_000,
  );
  state.clearingBankLiquidity = clamp(
    state.clearingBankLiquidity -
      10 -
      Math.max(0, state.bankRateBps - 350) / 20 +
      liquidity * 42,
    0,
    1_000,
  );
  addContribution(
    contributions,
    "acceptance_market_liquidity",
    "freeze-and-eligible-support",
    state.acceptanceMarketLiquidity - oldAcceptance,
    "index points",
    "Central European exposure strains specialist finance; eligible-collateral support can offset liquidity strain without adding FX.",
  );
  addContribution(
    contributions,
    "clearing_bank_liquidity",
    "funding-conditions-and-support",
    state.clearingBankLiquidity - oldClearing,
    "index points",
    "Domestic funding operations affect the clearing-bank proxy, which remains distinct from acceptance-market strain and official reserves.",
  );

  const due = state.pendingFiscalEffects.filter(
    (effect) => effect.dueTurn <= turn,
  );
  state.pendingFiscalEffects = state.pendingFiscalEffects.filter(
    (effect) => effect.dueTurn > turn,
  );
  const fiscalCashDelta = due.reduce(
    (sum, effect) => sum + effect.cashMinor,
    0,
  );
  const fiscalDemand = due.reduce(
    (sum, effect) => sum + effect.demandPoints,
    0,
  );
  const oldCash = state.fiscalCashBalanceMinor;
  state.fiscalCashBalanceMinor += fiscalCashDelta;
  addContribution(
    contributions,
    "fiscal_cash_balance",
    "implemented-fiscal-cash",
    moneyMillions(state.fiscalCashBalanceMinor - oldCash),
    "£m / week",
    "Legislated package cash posts after its authored delay; this signed flow is not official FX.",
  );

  const oldDemand = state.domesticDemandGap;
  const rateDrag = Math.max(0, state.bankRateBps - 250) / 18;
  state.domesticDemandGap = clamp(
    integer(state.domesticDemandGap * 0.88 + fiscalDemand - rateDrag - 5),
    -1_000,
    300,
  );
  const demandDelta = state.domesticDemandGap - oldDemand;
  addContribution(
    contributions,
    "domestic_demand_gap",
    "lagged-rate-and-fiscal-channel",
    demandDelta,
    "index points",
    "Bank Rate and realised fiscal measures enter a compact distributed domestic-demand lag.",
  );

  const oldUnemployment = state.registeredUnemploymentBps;
  const unemploymentDelta = clamp(
    integer(Math.max(0, -oldDemand - 80) / 24),
    0,
    24,
  );
  state.registeredUnemploymentBps = clamp(
    state.registeredUnemploymentBps + unemploymentDelta,
    0,
    10_000,
  );
  addContribution(
    contributions,
    "registered_unemployment",
    "lagged-domestic-demand",
    (state.registeredUnemploymentBps - oldUnemployment) / 100,
    "percentage points",
    "The dated unemployment series responds gradually to the prior demand gap, never fully within one week.",
  );
  state.cumulativeDomesticCost += Math.max(
    0,
    state.registeredUnemploymentBps - 1_450,
  );
}

function updateMarketsAndObservations(
  state: Sterling1931State,
  openingReserveMinor: number,
  contributions: ScenarioContribution[],
): void {
  const oldPressure = state.sterlingForwardPressureBps;
  state.sterlingForwardPressureBps = clamp(
    integer(
      state.sterlingForwardPressureBps * 0.72 +
        state.exitBeliefPermille * 0.45 +
        (state.withdrawalCoordinationOccurred ? 80 : 0) -
        Math.max(0, state.bankRateBps - 250) * 0.12,
    ),
    0,
    1_500,
  );
  if (state.monetaryRegime === "floating") {
    const oldSpot = state.sterlingSpotMilliDollars;
    const fall = clamp(
      45 + integer(state.exitBeliefPermille / 9) - integer(state.legalReadiness / 20),
      20,
      150,
    );
    state.sterlingSpotMilliDollars = Math.max(3_400, oldSpot - fall);
    addContribution(
      contributions,
      "sterling_spot_rate",
      "post-suspension-adjustment",
      (state.sterlingSpotMilliDollars - oldSpot) / 1_000,
      "USD / GBP",
      "The model's post-suspension exchange adjustment is an assumed short-run mechanism, not a forecast.",
    );
    const oldImport = state.importPriceIndex;
    const oldCompetitiveness = state.competitivenessIndex;
    state.importPriceIndex += integer(fall * 0.35);
    state.competitivenessIndex += integer(fall * 0.22);
    addContribution(
      contributions,
      "import_price_index",
      "lagged-exchange-pass-through",
      state.importPriceIndex - oldImport,
      "index points",
      "A deliberately partial four-week pass-through follows suspension; it is not a welfare claim.",
    );
    addContribution(
      contributions,
      "competitiveness_index",
      "lagged-relative-price-adjustment",
      state.competitivenessIndex - oldCompetitiveness,
      "index points",
      "The short epilogue permits only directional competitiveness adjustment.",
    );
  } else {
    state.sterlingSpotMilliDollars = clamp(
      PARITY_MILLI_DOLLARS -
        integer(state.sterlingForwardPressureBps / 80),
      4_840,
      PARITY_MILLI_DOLLARS,
    );
  }
  addContribution(
    contributions,
    "sterling_forward_pressure",
    "observable-market-proxy",
    state.sterlingForwardPressureBps - oldPressure,
    "basis points",
    "Forward pressure is observable model output; it is not labelled confidence.",
  );

  const reserveError = integer(
    (deterministicFloat(state.seed, `weekly-reserve-return-${state.turn}`) -
      0.5) *
      state.reserveErrorBandMinor,
  );
  state.observedReserveMinor = Math.max(0, openingReserveMinor + reserveError);
  state.observedReserveAsOfTurn = Math.max(0, state.turn - 1);
  if (state.turn % 2 === 0) {
    state.observedUnemploymentBps =
      state.registeredUnemploymentBps -
      clamp(integer((state.registeredUnemploymentBps - 1_450) / 8), 0, 30);
    state.observedUnemploymentAsOfTurn = Math.max(0, state.turn - 2);
  }
}

function evaluateObjectives(state: Sterling1931State): void {
  const ledger = state.lastReserveLedger;
  const settlementFailure =
    ledger.regimeAtSettlement === "gold_convertible" &&
    ledger.unpaidEligibleMinor > 0;
  state.lowLiquidityStreak =
    state.clearingBankLiquidity < 180
      ? state.lowLiquidityStreak + 1
      : 0;
  const paymentsBreakdown = state.lowLiquidityStreak >= 2;
  const externalArrears = state.externalArrearsMinor > 0;
  const transitionOrderliness =
    state.monetaryRegime === "floating"
      ? clamp(
          state.legalReadiness -
            ledger.unpaidEligibleMinor / 10 -
            Math.max(0, 350 - state.clearingBankLiquidity),
          0,
          1_000,
        )
      : clamp(
          500 +
            state.legalReadiness / 3 -
            state.sterlingForwardPressureBps / 3,
          0,
          1_000,
        );
  let profile = "parity-maintained / obligations-current";
  if (settlementFailure) profile = "disorderly-settlement-failure";
  else if (paymentsBreakdown) profile = "payments-breakdown";
  else if (externalArrears) profile = "external-arrears";
  else if (state.monetaryRegime === "floating") {
    profile =
      transitionOrderliness >= 500
        ? "orderly-transition / obligations-current"
        : "late-transition / operational-disruption";
  } else if (state.cumulativeDomesticCost > 2_800) {
    profile = "parity-preserved / severe-domestic-cost";
  }
  state.objectiveSnapshot = {
    settlementFailure,
    paymentsBreakdown,
    externalArrears,
    cumulativeDomesticCost: state.cumulativeDomesticCost,
    truthfulReporting: clamp(
      850 - state.unsupportedAssurances * 180 + state.reports.length * 12,
      0,
      1_000,
    ),
    transitionOrderliness: integer(transitionOrderliness),
    profile,
  };
}

function runEpilogue(state: Sterling1931State, events: string[]): void {
  if (state.monetaryRegime === "floating") {
    state.epilogueExchangeDirection = "lower";
    state.epilogueImportPriceDirection = "higher";
    state.epilogueCompetitivenessDirection = "improving";
    state.epilogueUnemploymentDirection =
      state.domesticDemandGap < -300 ? "mixed" : "easing";
  } else {
    state.epilogueExchangeDirection = "fixed";
    state.epilogueImportPriceDirection = "flat";
    state.epilogueCompetitivenessDirection = "flat";
    state.epilogueUnemploymentDirection =
      state.domesticDemandGap < -180 ? "higher" : "mixed";
  }
  events.push(
    `Model epilogue (four directional weeks): exchange ${state.epilogueExchangeDirection}; import prices ${state.epilogueImportPriceDirection}; competitiveness ${state.epilogueCompetitivenessDirection}; unemployment pressure ${state.epilogueUnemploymentDirection}. These are generated sensitivities, not claims about what would have happened.`,
  );
}

function assertFinite(value: unknown, path = "state"): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${path} contains a non-finite number.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFinite(item, `${path}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertFinite(child, `${path}.${key}`);
    }
  }
}

function assertState(state: Sterling1931State): void {
  assertFinite(state);
  const integerMoney: Array<[string, number]> = [
    ["goldFxReservesMinor", state.goldFxReservesMinor],
    ["earmarkedReservesMinor", state.earmarkedReservesMinor],
    ["undrawnExternalCreditMinor", state.undrawnExternalCreditMinor],
    ["drawnExternalLiabilityMinor", state.drawnExternalLiabilityMinor],
    ["cumulativeCreditDrawsMinor", state.cumulativeCreditDrawsMinor],
    ["conversionOrdersPendingMinor", state.conversionOrdersPendingMinor],
    ["foreignSterlingLiabilitiesMinor", state.foreignSterlingLiabilitiesMinor],
    ["frozenCentralEuropeClaimsMinor", state.frozenCentralEuropeClaimsMinor],
    ["publicDebtShortMaturityMinor", state.publicDebtShortMaturityMinor],
  ];
  for (const [name, value] of integerMoney) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer £10,000 stock.`);
    }
  }
  if (state.drawnExternalLiabilityMinor !== state.cumulativeCreditDrawsMinor) {
    throw new Error("Credit cash and matching principal do not reconcile.");
  }
  if (
    state.creditFacilityMaximumMinor > 0 &&
    state.undrawnExternalCreditMinor + state.drawnExternalLiabilityMinor !==
      state.creditFacilityMaximumMinor
  ) {
    throw new Error("Drawn and undrawn credit do not reconcile to the facility.");
  }
  const ledger = state.lastReserveLedger;
  const reconciled =
    ledger.openingMinor +
    ledger.creditDrawMinor +
    ledger.otherInflowMinor -
    ledger.conversionSettlementMinor -
    ledger.externalPaymentMinor -
    ledger.interventionMinor;
  if (reconciled !== ledger.closingMinor) {
    throw new Error("Opening reserves plus ledger entries do not equal closing reserves.");
  }
  if (
    ledger.regimeAtSettlement === "floating" &&
    ledger.conversionSettlementMinor !== 0
  ) {
    throw new Error("Convertibility settlement occurred after legal suspension.");
  }
  if (
    state.suspensionEffectiveTurn !== null &&
    state.monetaryRegime !== "floating"
  ) {
    throw new Error("Suspension is irreversible within the scenario horizon.");
  }
}

function defaultDecision(): ScenarioDecision {
  return {
    values: Object.fromEntries(
      ACTIONS.map((action) => [action.id, action.defaultValue]),
    ),
  };
}

function step(
  sourceState: Sterling1931State,
  decision: ScenarioDecision,
): ScenarioStepResult<Sterling1931State> {
  const errors = validateDecision(sourceState, decision);
  if (errors.length > 0) throw new Error(errors.join(" "));
  const state = cloneJson(sourceState);
  const turn = state.turn + 1;
  state.turn = turn;
  state.lastCapacityUsed = capacityCost(decision);
  const events: string[] = [];
  const contributions: ScenarioContribution[] = [];
  const openingReserveMinor = state.goldFxReservesMinor;

  if (turn === 1) {
    events.push(
      "Model-risk boundary: this is a compressed counterfactual teaching model. The expectation variant is a declared hypothesis family, not historical truth or a forecast.",
    );
  }

  // Ordered weekly phases: opening milestones and reports precede belief and settlement.
  applyOpeningMilestones(state, turn, events);
  releaseReports(state, turn, events);
  scheduledEvents(state, turn, events);
  const policy = updatePolicyAndQueue(
    state,
    decision,
    turn,
    events,
    contributions,
  );
  updateLatentBelief(state, policy.communicationEffect, contributions);
  const coordinationMinor = maybeTriggerCoordination(state, turn, events);
  const conversionDemandMinor = realiseConversionDemand(
    state,
    turn,
    coordinationMinor,
    contributions,
  );
  settleReserveLedger(
    state,
    policy.creditDrawMinor,
    conversionDemandMinor,
    contributions,
  );
  executeDomesticAndFiscal(state, decision, turn, contributions);
  updateMarketsAndObservations(state, openingReserveMinor, contributions);
  evaluateObjectives(state);
  state.complete = turn >= TOTAL_TURNS;
  if (state.complete) runEpilogue(state, events);
  state.recentEvents = cloneJson(events);
  assertState(state);

  const ledger = state.lastReserveLedger;
  const headline =
    ledger.unpaidEligibleMinor > 0
      ? `Settlement failure: £${moneyMillions(ledger.unpaidEligibleMinor)}m of eligible orders remains unpaid.`
      : `${state.objectiveSnapshot.profile}; reserves changed by ${moneyMillions(state.lastNetReserveChangeMinor)}m to £${moneyMillions(state.goldFxReservesMinor)}m.`;
  return { state, headline, events, contributions };
}

function metricStatus(
  value: number,
  watch: number,
  critical: number,
  lowerIsWorse = false,
): ScenarioStatus {
  if (lowerIsWorse) {
    return value <= critical ? "critical" : value <= watch ? "watch" : "secure";
  }
  return value >= critical ? "critical" : value >= watch ? "watch" : "secure";
}

function objectives(state: Sterling1931State): ScenarioView["objectives"] {
  const usable = Math.max(
    0,
    state.goldFxReservesMinor - state.earmarkedReservesMinor,
  );
  return [
    {
      id: "settlement",
      label: "P1 Avoid disorderly settlement failure",
      priority: 1,
      value: moneyMillions(state.lastReserveLedger.unpaidEligibleMinor),
      unit: "£m unpaid",
      status: state.objectiveSnapshot.settlementFailure ? "critical" : "secure",
      hard: true,
    },
    {
      id: "payments",
      label: "P2 Maintain payments and money-market operation",
      priority: 2,
      value: state.clearingBankLiquidity,
      unit: "liquidity index",
      status: metricStatus(state.clearingBankLiquidity, 400, 180, true),
      hard: true,
    },
    {
      id: "arrears",
      label: "P3 Keep external obligations current",
      priority: 3,
      value: moneyMillions(state.externalArrearsMinor),
      unit: "£m arrears",
      status: state.externalArrearsMinor > 0 ? "critical" : "secure",
      hard: true,
    },
    {
      id: "domestic-cost",
      label: "P4 Limit cumulative domestic contraction",
      priority: 4,
      value: state.cumulativeDomesticCost,
      unit: "stress-weeks",
      status: metricStatus(state.cumulativeDomesticCost, 1_500, 3_000),
      hard: false,
    },
    {
      id: "fiscal-reporting",
      label: "P5 Preserve fiscal capacity and truthful reporting",
      priority: 5,
      value: state.objectiveSnapshot.truthfulReporting,
      unit: "integrity index",
      status: metricStatus(
        state.objectiveSnapshot.truthfulReporting,
        600,
        350,
        true,
      ),
      hard: false,
    },
    {
      id: "regime-path",
      label: "P6 Feasible parity or orderly transition",
      priority: 6,
      value:
        state.monetaryRegime === "gold_convertible"
          ? moneyMillions(usable)
          : state.objectiveSnapshot.transitionOrderliness,
      unit:
        state.monetaryRegime === "gold_convertible"
          ? "£m usable"
          : "orderliness index",
      status:
        state.monetaryRegime === "gold_convertible"
          ? metricStatus(usable, 5_000, 1_500, true)
          : metricStatus(
              state.objectiveSnapshot.transitionOrderliness,
              550,
              300,
              true,
            ),
      hard: false,
    },
  ];
}

function getView(state: Sterling1931State): ScenarioView {
  const phase = PHASES[Math.min(state.turn, TOTAL_TURNS - 1)]!;
  const usableObserved = Math.max(
    0,
    state.observedReserveMinor - state.earmarkedReservesMinor,
  );
  const alerts: ScenarioView["alerts"] = [
    {
      id: "model-boundary",
      severity: "info",
      message:
        "Model-risk boundary: this counterfactual uses disputed named expectation mechanisms. No policy response is presented as historical truth.",
    },
  ];
  if (usableObserved < 5_000) {
    alerts.push({
      id: "reserve-coverage",
      severity: usableObserved < 1_500 ? "critical" : "warning",
      message: `The dated reserve return implies only £${moneyMillions(usableObserved)}m usable after earmarking, with ±£${moneyMillions(state.reserveErrorBandMinor)}m uncertainty.`,
    });
  }
  if (state.acceptanceMarketLiquidity < 450) {
    alerts.push({
      id: "acceptance-strain",
      severity:
        state.acceptanceMarketLiquidity < 220 ? "critical" : "warning",
      message:
        "Specialist acceptance-market strain is elevated; this is not evidence that clearing banks are insolvent.",
    });
  }
  if (state.lastReserveLedger.unpaidEligibleMinor > 0) {
    alerts.push({
      id: "unpaid-settlement",
      severity: "critical",
      message: `£${moneyMillions(state.lastReserveLedger.unpaidEligibleMinor)}m of eligible conversion orders could not be settled.`,
    });
  }
  if (state.withdrawalWarningIssued) {
    alerts.push({
      id: "withdrawal-proxy",
      severity: "warning",
      message:
        "Observable withdrawal notices and forward pressure are bunching. The latent belief and trigger remain hidden during play.",
    });
  }
  if (state.mode === "sandbox") {
    alerts.push({
      id: "sandbox-variant",
      severity: "info",
      message: `Sandbox inspection: active expectation-model variant is ${state.expectationVariant}. Sandbox runs are non-comparable.`,
    });
  } else if (state.mode === "guided") {
    alerts.push({
      id: "guided-variant",
      severity: "info",
      message:
        "Analytic Desk uses the declared-median expectation variant. Alternative interpretations are reserved for sensitivity comparison.",
    });
  }
  if (state.complete) {
    alerts.push({
      id: "epilogue-boundary",
      severity: "info",
      message:
        "The four-week epilogue is directional model output, too short to establish recovery, welfare, or what would have happened.",
    });
  }

  return {
    dateLabel: state.complete
      ? "Model epilogue · four directional weeks after 27 September 1931"
      : `${DATES[Math.min(state.turn, TOTAL_TURNS - 1)]} · week ${Math.min(state.turn + 1, TOTAL_TURNS)} of ${TOTAL_TURNS}`,
    phase: phase[0],
    phaseDescription: phase[1],
    summary: state.complete
      ? `${state.objectiveSnapshot.profile}. Epilogue: exchange ${state.epilogueExchangeDirection}, import prices ${state.epilogueImportPriceDirection}, competitiveness ${state.epilogueCompetitivenessDirection}, unemployment pressure ${state.epilogueUnemploymentDirection}.`
      : `${state.monetaryRegime.replaceAll("_", " ")}; ${state.committeeCapacity - state.lastCapacityUsed} team-weeks uncommitted; latest reserve return is dated week ${state.observedReserveAsOfTurn}.`,
    metrics: [
      {
        id: "usable-reserve",
        label: "Estimated usable reserve buffer",
        value: moneyMillions(usableObserved),
        unit: "£m",
        status: metricStatus(usableObserved, 5_000, 1_500, true),
        detail: `Report as of week ${state.observedReserveAsOfTurn}; ±£${moneyMillions(state.reserveErrorBandMinor)}m. Earmarked assets are excluded.`,
      },
      {
        id: "gross-reserve-loss",
        label: "Last gross reserve loss",
        value: moneyMillions(state.lastGrossReserveLossMinor),
        unit: "£m / week",
        status: metricStatus(state.lastGrossReserveLossMinor, 1_500, 3_000),
        detail: `Net change was £${moneyMillions(state.lastNetReserveChangeMinor)}m; gross and net are not interchangeable.`,
      },
      {
        id: "forward-pressure",
        label: "Sterling forward pressure",
        value: state.sterlingForwardPressureBps,
        unit: "basis points",
        status: metricStatus(state.sterlingForwardPressureBps, 350, 700),
        detail: "Observable market proxy; deliberately not labelled confidence.",
      },
      {
        id: "bank-rate",
        label: "Bank Rate",
        value: state.bankRateBps / 100,
        unit: "% p.a.",
        status: metricStatus(state.bankRateBps, 500, 700),
        detail: "Public policy rate. It neither creates gold nor guarantees lower withdrawals.",
      },
      {
        id: "credit-buffer",
        label: "Undrawn credit / next service",
        value: moneyMillions(state.undrawnExternalCreditMinor),
        unit: "£m undrawn",
        status:
          state.drawnExternalLiabilityMinor > 0 &&
          state.undrawnExternalCreditMinor === 0
            ? "watch"
            : "secure",
        detail: `£${moneyMillions(state.drawnExternalLiabilityMinor)}m principal outstanding; £${moneyMillions(state.creditServiceDueMinor)}m contractual weekly service after grace.`,
      },
      {
        id: "budget-gap",
        label: "Latest projected budget gap",
        value: moneyMillions(state.observedProjectedGapMinor),
        unit: "£m / year",
        status: metricStatus(state.observedProjectedGapMinor, 13_000, 17_000),
        detail: `Published estimate vintage as of week ${state.observedProjectedGapAsOfTurn}; not realised weekly cash.`,
      },
      {
        id: "unemployment",
        label: "Latest registered unemployment",
        value: state.observedUnemploymentBps / 100,
        unit: "%",
        status: metricStatus(state.observedUnemploymentBps, 1_600, 1_750),
        detail: `Delayed public observation as of week ${state.observedUnemploymentAsOfTurn}.`,
      },
      {
        id: "domestic-liquidity",
        label: "Domestic money-market liquidity",
        value: state.clearingBankLiquidity,
        unit: "index",
        status: metricStatus(state.clearingBankLiquidity, 400, 180, true),
        detail: `Clearing-bank proxy; acceptance-market proxy is ${state.acceptanceMarketLiquidity}. Neither is official FX.`,
      },
    ],
    objectives: objectives(state),
    alerts,
  };
}

const typedSterling1931Model: ScenarioModel<Sterling1931State> = {
  metadata: {
    id: "sterling-1931",
    version: "0.1.0-model-risk-preview",
    title: "Sterling, 1931: The Promise and the Ledger",
    shortTitle: "Sterling, 1931",
    deck:
      "Keep an exact reserve and credit ledger while dated reports, domestic costs, and a disputed expectations mechanism test a fixed exchange-rate promise.",
    fidelity:
      "Historically grounded, uncalibrated counterfactual teaching model; high model risk",
    role: "Chair, Emergency Sterling Committee (fictional composite analytical role)",
    period: "22 June–27 September 1931, plus a four-week model epilogue",
    turnLabel: "week",
    totalTurns: TOTAL_TURNS,
    sessionLength: "35–50 minutes",
    briefing: [
      "You occupy a composite coordination role created for this simulation. No individual or committee in 1931 possessed all of these powers or all of this information.",
      "Reserve settlements and matching credit liabilities are exact accounts. Domestic bank liquidity, frozen claims, fiscal cash, and official foreign reserves are separate stocks and flows.",
      "Opening money stocks, facility envelopes, response coefficients, committee capacity, and lead times are explicit analytic assumptions pending calibration against a pinned historical dataset; they are not quoted historical measurements.",
      "Reports are dated, revised, incomplete estimates. Market pressure is observable; “confidence” is a latent modelling device and never a live historical meter.",
      "Leaving gold is a legal regime transition, not an automatic win or failure. Completed settlements, external debt service, import-price exposure, and domestic hardship remain.",
      "Four named expectation variants encode contested causal interpretations. A successful strategy is conditional on assumptions and is not evidence of what would have happened.",
    ],
    learningObjectives: [
      "Distinguish reserve stocks, settlement flows, and matching credit liabilities.",
      "Trace how fixed-parity defence can improve one objective while worsening domestic demand, unemployment, or liquidity.",
      "Keep acceptance-market strain, clearing-bank liquidity, and official reserves conceptually separate.",
      "Use dated reports and uncertainty bands to discriminate among competing causal stories.",
      "Value legal preparation without treating suspension as costless or historically predetermined.",
      "Defend a priority-ordered objective vector rather than a scalar score.",
    ],
    modelNote:
      "HIGH MODEL-RISK BOUNDARY: this is a compressed, uncalibrated weekly counterfactual—not a forecast, welfare model, or claim that a policy would have changed history. Opening money stocks, credit terms, coefficients, capacity, and lead times are assumed preview parameters pending a pinned historical calibration register. Its explicit named variants (balance-sheet contagion, unemployment and commitment, fiscal-credibility orthodoxy, and external-balance correction) are disputable hypotheses sharing one deterministic engine. “Confidence” is latent model state inferred through behaviour, never observed historical fact. British clearing banks, merchant banks, and the acceptance market are not collapsed into one system; fiscal packages carry contraction and hardship costs; the epilogue cannot establish long-run recovery.",
    accent: "#c8a45c",
  },
  actions: ACTIONS,
  createInitialState,
  defaultDecision,
  validateDecision,
  step,
  getView,
};

/**
 * Scenario-owned state remains strongly typed in this module and is widened only at
 * the registry boundary.
 */
export const sterling1931Model: AnyScenarioModel =
  typedSterling1931Model as unknown as AnyScenarioModel;

export { typedSterling1931Model };
