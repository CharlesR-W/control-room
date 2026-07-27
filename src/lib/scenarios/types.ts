import type { SimulationMode } from "../sim/types.ts";

export type ScenarioStatus = "secure" | "watch" | "critical";

export type ScenarioActionSpec = {
  id: string;
  label: string;
  description: string;
  commitment: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unlockTurn?: number;
};

export type ScenarioDecision = {
  values: Record<string, number>;
};

export type ScenarioMetric = {
  id: string;
  label: string;
  value: number;
  unit: string;
  status: ScenarioStatus;
  detail: string;
};

export type ScenarioObjective = {
  id: string;
  label: string;
  priority: number;
  value: number;
  unit: string;
  status: ScenarioStatus;
  hard: boolean;
};

export type ScenarioAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

export type ScenarioContribution = {
  target: string;
  source: string;
  delta: number;
  unit: string;
  explanation: string;
};

export type ScenarioView = {
  dateLabel: string;
  phase: string;
  phaseDescription: string;
  summary: string;
  metrics: ScenarioMetric[];
  objectives: ScenarioObjective[];
  alerts: ScenarioAlert[];
};

export type ScenarioState = {
  turn: number;
  complete: boolean;
  seed: number;
  mode: SimulationMode;
};

export type ScenarioStepResult<S extends ScenarioState> = {
  state: S;
  headline: string;
  events: string[];
  contributions: ScenarioContribution[];
};

export type ScenarioMetadata = {
  id: string;
  version: string;
  title: string;
  shortTitle: string;
  deck: string;
  fidelity: string;
  role: string;
  period: string;
  turnLabel: string;
  totalTurns: number;
  sessionLength: string;
  briefing: string[];
  learningObjectives: string[];
  modelNote: string;
  accent: string;
};

export interface ScenarioModel<S extends ScenarioState = ScenarioState> {
  metadata: ScenarioMetadata;
  actions: ScenarioActionSpec[];
  createInitialState(seed: number, mode: SimulationMode): S;
  defaultDecision(state: S): ScenarioDecision;
  validateDecision(state: S, decision: ScenarioDecision): string[];
  step(state: S, decision: ScenarioDecision): ScenarioStepResult<S>;
  getView(state: S): ScenarioView;
}

export type AnyScenarioModel = ScenarioModel<ScenarioState>;

export type ScenarioTurnRecord = {
  turn: number;
  decision: ScenarioDecision;
  headline: string;
  events: string[];
  contributions: ScenarioContribution[];
  stateHash: string;
};

export type ScenarioRun = {
  schemaVersion: 1;
  scenarioId: string;
  scenarioVersion: string;
  seed: number;
  mode: SimulationMode;
  state: ScenarioState;
  history: ScenarioTurnRecord[];
};
