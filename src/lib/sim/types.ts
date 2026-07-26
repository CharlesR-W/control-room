export type SimulationMode = "guided" | "professional" | "sandbox";

export type RegionId = "capital" | "north" | "interior";
export type Cargo = "grain" | "diesel";
export type Supplier = "near-premium" | "standard" | "distant-discount";
export type RationLevel = "none" | "moderate" | "severe";
export type RepairIntensity = "none" | "normal" | "accelerated" | "emergency";
export type AuditKind =
  | "none"
  | "capital-stock"
  | "north-stock"
  | "interior-stock"
  | "crop"
  | "port-damage";
export type BaselinePolicy = "minimal" | "reactive" | "competent" | "adversary";

export type ActionFamily =
  | "imports"
  | "portSchedule"
  | "railAndTruck"
  | "rationPolicy"
  | "copperPlan"
  | "repairIntensity"
  | "audit"
  | "emergencyCredit";

export type ActionLifecycle =
  | "committed"
  | "queued"
  | "implementing"
  | "active"
  | "completed"
  | "expired"
  | "cancelled"
  | "failed";

export type BindingConstraint =
  | "port"
  | "rail"
  | "diesel"
  | "foreign-exchange"
  | "implementation-teams"
  | "grain-stock"
  | "regional-stock"
  | "repair-equipment"
  | "none";

export interface ImportDecision {
  cargo: Cargo;
  supplier: Supplier;
  quantityKt: number;
}

export interface PortScheduleDecision {
  grainImportsKt: number;
  dieselImportsKt: number;
  copperExportsKt: number;
  repairEquipmentKt: number;
}

export interface RailAndTruckDecision {
  railGrainKt: number;
  railCopperKt: number;
  grainSharesPct: Record<RegionId, number>;
  truckRegion: RegionId | "none";
  truckGrainKt: number;
}

export interface CopperPlanDecision {
  mineTargetKt: number;
  acceptEarlyPayment: boolean;
}

export interface Forecasts {
  grainCoverageWeeks: number | null;
  fxUsdM: number | null;
  bindingConstraint: BindingConstraint | null;
}

export interface DecisionPackage {
  id: string;
  forTurn: number;
  imports: ImportDecision[];
  portSchedule: PortScheduleDecision;
  railAndTruck: RailAndTruckDecision;
  rationPolicy: Record<RegionId, RationLevel>;
  copperPlan: CopperPlanDecision;
  repairIntensity: RepairIntensity;
  audit: AuditKind;
  emergencyCreditUsdM: number;
  forecasts: Forecasts;
  notes: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

export interface ResourcePreview {
  importCostCents: number;
  repairCostCents: number;
  availableFxCents: number;
  projectedFxAfterDirectCommitmentsCents: number;
  adminTeamsAlreadyCommitted: number;
  adminTeamsClaimed: number;
  adminTeamsAvailable: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  preview: ResourcePreview;
}

export interface Shipment {
  id: string;
  cargo: Cargo;
  supplier: Supplier | "opening-pipeline";
  orderedTurn: number;
  arrivalTurn: number;
  quantityKt: number;
  remainingKt: number;
  unitCostCentsPerKt: number;
  status: "sailing" | "arrived" | "queued-at-port" | "unloaded";
  actionId: string;
}

export interface VisibleShipment extends Omit<Shipment, "arrivalTurn"> {
  /**
   * Withheld while a shipment remains subject to an unobserved seeded delay.
   * Deterministic and already-arrived shipments expose the realised turn.
   */
  arrivalTurn: number | null;
  expectedArrivalWindow: {
    earliestTurn: number;
    latestTurn: number;
  };
}

export interface RegionState {
  id: RegionId;
  label: string;
  grainKt: number;
  weeklyDemandKt: number;
  reportedGrainKt: number;
  cumulativeShortfallKt: number;
  hardshipPoints: number;
  activeRation: RationLevel;
}

export interface PendingRationPolicy {
  levels: Record<RegionId, RationLevel>;
  effectiveTurn: number;
  actionId: string;
}

export interface PendingAudit {
  id: string;
  kind: Exclude<AuditKind, "none">;
  requestedTurn: number;
  completionTurn: number;
  actionId: string;
}

export interface EarlyPaymentOffer {
  status: "not-offered" | "available" | "accepted" | "expired";
  offeredTurn: number;
  availableUntilTurn: number;
}

export interface EarlyPaymentObligation {
  acceptedTurn: number;
  dueTurn: number;
  originalKt: number;
  remainingKt: number;
  advanceCents: number;
}

export interface ScenarioVariant {
  closureTurn: number;
  cropRevisionTurn: number;
  cropMultiplier: number;
  stockRevisionTurn: number;
  stockRevisionRegion: RegionId;
  earlyPaymentOfferTurn: number;
  repairEfficiency: number;
  regularReportBias: Record<RegionId, number>;
}

export interface LedgerEntry {
  id: string;
  turn: number;
  account:
    | "imports"
    | "copper-exports"
    | "port-repair"
    | "emergency-credit"
    | "credit-interest"
    | "early-payment"
    | "contract-penalty";
  description: string;
  cashDeltaCents: number;
  liabilityDeltaCents: number;
  balanceAfterCents: number;
  relatedActionId: string | null;
  relatedEventId: string | null;
}

export interface FinancialState {
  initialFxCents: number;
  fxCents: number;
  emergencyFloorCents: number;
  creditPrincipalCents: number;
  creditLimitCents: number;
  contractAdvanceLiabilityCents: number;
  arrearsCents: number;
  contractualPenaltiesCents: number;
  ledger: LedgerEntry[];
}

export interface ActionStatus {
  id: string;
  family: ActionFamily;
  label: string;
  lifecycle: ActionLifecycle;
  committedTurn: number;
  effectiveTurn: number;
  completedTurn: number | null;
  reason: string;
}

export interface SimulationEvent {
  id: string;
  turn: number;
  type:
    | "weather-warning"
    | "port-closure"
    | "crop-revision"
    | "regional-stock-revision"
    | "early-payment-offer"
    | "offer-expired"
    | "contract-penalty"
    | "objective-alert"
    | "tutorial";
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  relatedVariables: string[];
}

export type ReportStatus = "preliminary" | "revised" | "final";

export interface ObservationReport {
  id: string;
  kind: "crop" | "regional-stock" | "port-engineering" | "audit" | "operations";
  title: string;
  source: string;
  eventTurn: number;
  asOfTurn: number;
  publishedTurn: number;
  status: ReportStatus;
  revisesReportId: string | null;
  values: Record<string, string | number | boolean | null>;
  methodology: string;
  confidence: "low" | "medium" | "high";
}

export interface TruthRecord {
  turn: number;
  domesticGrainOutputKt: number;
  regionalGrainKt: Record<RegionId, number>;
}

export interface ObservationState {
  reports: ObservationReport[];
  pendingAudits: PendingAudit[];
  reportedDomesticOutputKt: number;
  knownPortRepairEfficiency: number | null;
  lastReportedTurn: number;
}

export interface Contribution {
  id: string;
  turn: number;
  target: string;
  mechanism: string;
  sourceVariables: string[];
  actionIds: string[];
  eventIds: string[];
  amount: number;
  unit: "kt" | "percentage-points" | "usd-cents" | "days" | "points";
  bindingConstraint: BindingConstraint;
  note: string;
}

export interface BindingRecord {
  id: string;
  turn: number;
  system: string;
  requested: number;
  available: number;
  realized: number;
  unit: "kt" | "teams" | "usd-cents";
  constraint: BindingConstraint;
  binding: boolean;
  note: string;
}

export interface InvariantCheck {
  id: string;
  ok: boolean;
  message: string;
  expected: number | null;
  actual: number | null;
}

export interface ObjectiveMeasure {
  id:
    | "food-service"
    | "diesel-service"
    | "fx-floor"
    | "port-repair"
    | "hardship"
    | "resilience";
  label: string;
  priority: number;
  value: number;
  unit: string;
  status: "secure" | "at-risk" | "breached";
  hardConstraint: boolean;
}

export interface RunMetrics {
  foodShortfallKt: number;
  foodShortfallDays: number;
  essentialDieselServiceLossKt: number;
  minimumFxCents: number;
  policyChurn: number;
  emergencyActionCount: number;
  implementationOverloadTurns: number;
  informationActionsUsed: number;
  contractualPenaltiesCents: number;
  hardshipPoints: number;
}

export interface WorldState {
  turn: number;
  simulatedDate: string;
  complete: boolean;
  seed: number;
  mode: SimulationMode;
  variant: ScenarioVariant;
  grainCentralKt: number;
  dieselKt: number;
  copperAtPortKt: number;
  domesticGrainOutputKt: number;
  domesticDieselSupplyKt: number;
  regions: Record<RegionId, RegionState>;
  portCapacityKt: number;
  railCapacityKt: number;
  truckCapacityKt: number;
  repairProgressPct: number;
  implementationTeamsTotal: number;
  shipments: Shipment[];
  pendingRationPolicy: PendingRationPolicy | null;
  earlyPaymentOffer: EarlyPaymentOffer;
  earlyPaymentObligation: EarlyPaymentObligation | null;
  finance: FinancialState;
  observations: ObservationState;
  truthHistory: TruthRecord[];
  actions: ActionStatus[];
  events: SimulationEvent[];
  objectives: ObjectiveMeasure[];
  metrics: RunMetrics;
  lastTrace: Contribution[];
  lastBindings: BindingRecord[];
  lastInvariants: InvariantCheck[];
}

export interface StepResult {
  state: WorldState;
  events: SimulationEvent[];
  reports: ObservationReport[];
  actionStatusChanges: ActionStatus[];
  objectives: ObjectiveMeasure[];
  trace: Contribution[];
  bindingConstraints: BindingRecord[];
  invariants: InvariantCheck[];
}

export interface TurnRecord {
  turn: number;
  simulatedDate: string;
  decision: DecisionPackage;
  events: SimulationEvent[];
  reports: ObservationReport[];
  actionStatusChanges: ActionStatus[];
  objectives: ObjectiveMeasure[];
  trace: Contribution[];
  bindingConstraints: BindingRecord[];
  invariants: InvariantCheck[];
  stateHash: string;
  stateSnapshot: WorldState;
}

export interface BranchMetadata {
  id: string;
  parentRunId: string | null;
  forkTurn: number | null;
}

export interface SimulationRun {
  schemaVersion: string;
  engineVersion: string;
  scenarioId: string;
  scenarioVersion: string;
  scenarioContentHash: string;
  rngVersion: string;
  seed: number;
  mode: SimulationMode;
  runId: string;
  branch: BranchMetadata;
  initialStateHash: string;
  initialState: WorldState;
  state: WorldState;
  history: TurnRecord[];
}

export interface VisibleAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface VisibleSnapshot {
  scenarioId: string;
  title: string;
  role: string;
  turn: number;
  turnsTotal: number;
  simulatedDate: string;
  mode: SimulationMode;
  complete: boolean;
  headline: {
    reportedGrainKt: number;
    reportedGrainCoverageWeeks: number;
    dieselKt: number;
    dieselCoverageWeeks: number;
    fxCents: number;
    emergencyFloorCents: number;
    portCapacityKt: number;
    portRepairProgressPct: number;
    railCapacityKt: number;
    implementationTeamsAvailable: number;
  };
  regions: Record<
    RegionId,
    {
      id: RegionId;
      label: string;
      reportedGrainKt: number;
      reportedCoverageWeeks: number;
      activeRation: RationLevel;
      serviceStatus: "secure" | "at-risk" | "shortfall";
    }
  >;
  shipments: VisibleShipment[];
  reports: ObservationReport[];
  events: SimulationEvent[];
  objectives: ObjectiveMeasure[];
  availableActions: ActionFamily[];
  activeActions: ActionStatus[];
  pendingRationPolicy: PendingRationPolicy | null;
  earlyPaymentOffer: EarlyPaymentOffer;
  alerts: VisibleAlert[];
  latestTrace: Contribution[];
  latestBindings: BindingRecord[];
  history: Array<{
    turn: number;
    simulatedDate: string;
    decisionId: string;
    events: SimulationEvent[];
    objectives: ObjectiveMeasure[];
  }>;
}
