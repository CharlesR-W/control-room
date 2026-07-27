import {
  cloneJson,
  deterministicFloat,
  normaliseSeed,
  round,
  stableHash,
} from "../sim/determinism.ts";
import type { SimulationMode } from "../sim/types.ts";
import type {
  AnyScenarioModel,
  ScenarioDecision,
  ScenarioRun,
  ScenarioState,
} from "./types.ts";

export { cloneJson, deterministicFloat, normaliseSeed, round, stableHash };

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function seededRange(
  seed: number,
  key: string,
  minimum: number,
  maximum: number,
): number {
  return minimum + deterministicFloat(seed, key) * (maximum - minimum);
}

export function decisionValue(
  decision: ScenarioDecision,
  id: string,
  fallback = 0,
): number {
  const value = decision.values[id];
  return Number.isFinite(value) ? value : fallback;
}

export function validateAgainstSpecs(
  model: AnyScenarioModel,
  state: ScenarioState,
  decision: ScenarioDecision,
): string[] {
  const errors: string[] = [];
  for (const action of model.actions) {
    if ((action.unlockTurn ?? 0) > state.turn) continue;
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
  }
  return errors;
}

export function createScenarioRun(
  model: AnyScenarioModel,
  seed: number,
  mode: SimulationMode,
): ScenarioRun {
  return {
    schemaVersion: 1,
    scenarioId: model.metadata.id,
    scenarioVersion: model.metadata.version,
    seed: normaliseSeed(seed),
    mode,
    state: model.createInitialState(normaliseSeed(seed), mode),
    history: [],
  };
}

export function stepScenarioRun(
  model: AnyScenarioModel,
  run: ScenarioRun,
  decision: ScenarioDecision,
): ScenarioRun {
  const errors = [
    ...validateAgainstSpecs(model, run.state, decision),
    ...model.validateDecision(run.state, decision),
  ];
  if (errors.length > 0) throw new Error(errors.join(" "));
  const result = model.step(cloneJson(run.state), cloneJson(decision));
  return {
    ...run,
    state: result.state,
    history: [
      ...run.history,
      {
        turn: result.state.turn,
        decision: cloneJson(decision),
        headline: result.headline,
        events: cloneJson(result.events),
        contributions: cloneJson(result.contributions),
        stateHash: stableHash(result.state),
      },
    ],
  };
}

export function replayScenarioRun(
  model: AnyScenarioModel,
  run: ScenarioRun,
): ScenarioRun {
  let replay = createScenarioRun(model, run.seed, run.mode);
  for (const record of run.history) {
    replay = stepScenarioRun(model, replay, record.decision);
    const replayed = replay.history.at(-1);
    if (replayed?.stateHash !== record.stateHash) {
      throw new Error(`Deterministic replay mismatch at turn ${record.turn}.`);
    }
  }
  return replay;
}
