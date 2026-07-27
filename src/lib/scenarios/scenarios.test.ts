import assert from "node:assert/strict";
import test from "node:test";
import {
  createScenarioRun,
  replayScenarioRun,
  stepScenarioRun,
} from "./helpers.ts";
import { scenarioModels } from "./registry.ts";

function assertFiniteTree(value: unknown, path = "state"): void {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteTree(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      assertFiniteTree(item, `${path}.${key}`),
    );
  }
}

test("registry contains five distinct new scenarios with bounded action catalogs", () => {
  assert.equal(scenarioModels.length, 5);
  assert.equal(new Set(scenarioModels.map((model) => model.metadata.id)).size, 5);
  for (const model of scenarioModels) {
    assert.ok(model.actions.length > 0);
    assert.ok(model.actions.length <= 8);
    assert.ok(model.metadata.totalTurns > 0);
    assert.ok(model.metadata.modelNote.length > 30);
  }
});

for (const model of scenarioModels) {
  test(`${model.metadata.title} default policy replays exactly`, () => {
    let run = createScenarioRun(model, 1978, "guided");
    while (!run.state.complete) {
      run = stepScenarioRun(model, run, model.defaultDecision(run.state));
    }
    assert.equal(run.history.length, model.metadata.totalTurns);
    assertFiniteTree(run.state);
    const replay = replayScenarioRun(model, run);
    assert.deepEqual(
      replay.history.map((record) => record.stateHash),
      run.history.map((record) => record.stateHash),
    );
  });
}

test("100-seed cross-scenario smoke remains finite, bounded, and complete", () => {
  for (const model of scenarioModels) {
    for (let seed = 0; seed < 100; seed += 1) {
      let run = createScenarioRun(model, seed, "professional");
      while (!run.state.complete) {
        const decision = model.defaultDecision(run.state);
        const errors = model.validateDecision(run.state, decision);
        assert.deepEqual(errors, [], `${model.metadata.id} seed ${seed}`);
        run = stepScenarioRun(model, run, decision);
      }
      assert.equal(run.history.length, model.metadata.totalTurns);
      assertFiniteTree(run.state, `${model.metadata.id}:${seed}`);
    }
  }
});
