import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_ACTION_FAMILIES,
  DecisionValidationError,
  TOTAL_TURNS,
  branchRun,
  createDefaultDecision,
  createInitialRun,
  deserializeRun,
  getVisibleSnapshot,
  replayRun,
  runBaseline,
  serializeRun,
  stableHash,
  stepRun,
  stepWorld,
  trueTotalGrainKt,
  validateDecision,
} from "./index.ts";
import type {
  Contribution,
  DecisionPackage,
  SimulationRun,
  WorldState,
} from "./index.ts";

function stepDefaults(run: SimulationRun, turns = 1): SimulationRun {
  let result = run;
  for (let count = 0; count < turns; count += 1) {
    result = stepRun(result, createDefaultDecision(result.state));
  }
  return result;
}

function sumTrace(trace: Contribution[], target: string): number {
  return trace
    .filter((entry) => entry.target === target)
    .reduce((total, entry) => total + entry.amount, 0);
}

function assertAllNumbersFinite(value: unknown): void {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertAllNumbersFinite);
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(
      assertAllNumbersFinite,
    );
  }
}

test("initial state is stable, JSON-safe, and matches the declared opening balance", () => {
  const first = createInitialRun(42, "guided");
  const second = createInitialRun(42, "guided");

  assert.equal(first.state.turn, 0);
  assert.equal(first.state.complete, false);
  assert.equal(trueTotalGrainKt(first.state), 28);
  assert.equal(first.state.dieselKt, 10);
  assert.equal(first.state.finance.fxCents, 3_000_000_000);
  assert.equal(first.state.portCapacityKt, 12);
  assert.equal(first.state.railCapacityKt, 10);
  assert.equal(first.state.implementationTeamsTotal, 6);
  assert.equal(first.state.shipments.length, 3);
  assert.equal(stableHash(first), stableHash(second));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

test("the default package validates and stepRun does not mutate its inputs", () => {
  const run = createInitialRun(7, "guided");
  const decision = createDefaultDecision(run.state);
  const beforeRun = JSON.stringify(run);
  const beforeDecision = JSON.stringify(decision);
  const validation = validateDecision(run.state, decision);

  assert.equal(validation.valid, true);
  const next = stepRun(run, decision);
  assert.equal(next.state.turn, 1);
  assert.equal(JSON.stringify(run), beforeRun);
  assert.equal(JSON.stringify(decision), beforeDecision);
  assert.equal(next.history.length, 1);
  assert.ok(next.history[0].invariants.every((check) => check.ok));
});

test("guided mode enforces staged action unlocks", () => {
  let run = createInitialRun(3, "guided");
  const locked = createDefaultDecision(run.state);
  locked.portSchedule.copperExportsKt = 3;
  const lockedResult = validateDecision(run.state, locked);
  assert.equal(lockedResult.valid, false);
  assert.ok(
    lockedResult.errors.some(
      (error) =>
        error.path === "portSchedule" && error.code === "guided-action-locked",
    ),
  );

  run = stepDefaults(run, 2);
  const unlocked = createDefaultDecision(run.state);
  unlocked.portSchedule.copperExportsKt = 3;
  assert.equal(validateDecision(run.state, unlocked).valid, true);
});

test("one feasible package exercises all eight action families and their lifecycles", () => {
  const run = createInitialRun(11, "professional");
  const decision = createDefaultDecision(run.state);
  decision.imports = [
    { cargo: "grain", supplier: "standard", quantityKt: 1 },
  ];
  decision.portSchedule.repairEquipmentKt = 0.6;
  decision.rationPolicy.capital = "moderate";
  decision.repairIntensity = "normal";
  decision.audit = "crop";
  decision.emergencyCreditUsdM = 0.5;
  decision.forecasts = {
    grainCoverageWeeks: 4,
    fxUsdM: 30,
    bindingConstraint: "port",
  };

  const validation = validateDecision(run.state, decision);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const next = stepRun(run, decision);
  const families = new Set(next.state.actions.map((action) => action.family));
  for (const family of ALL_ACTION_FAMILIES) {
    assert.ok(families.has(family), `missing action lifecycle for ${family}`);
  }
  assert.ok(
    next.state.shipments.some(
      (shipment) => shipment.actionId === "action:1:imports:1",
    ),
  );
  assert.equal(next.state.pendingRationPolicy?.effectiveTurn, 2);
  assert.equal(next.state.observations.pendingAudits[0].completionTurn, 2);
});

test("validation rejects impossible resources, ranges, precision, and stale turns", () => {
  const state = createInitialRun(1, "professional").state;
  const decision = createDefaultDecision(state);
  decision.forTurn = 3;
  decision.imports = [
    { cargo: "grain", supplier: "near-premium", quantityKt: 20.05 },
  ];
  decision.portSchedule.grainImportsKt = 20;
  decision.railAndTruck.railGrainKt = 11;
  decision.railAndTruck.grainSharesPct.capital = 90;
  decision.railAndTruck.truckGrainKt = 4;
  decision.copperPlan.mineTargetKt = 6;
  decision.repairIntensity = "emergency";
  decision.audit = "crop";
  decision.emergencyCreditUsdM = 4;

  const result = validateDecision(state, decision);
  assert.equal(result.valid, false);
  const codes = new Set(result.errors.map((error) => error.code));
  assert.ok(codes.has("wrong-turn"));
  assert.ok(codes.has("invalid-precision"));
  assert.ok(codes.has("capacity-exceeded"));
  assert.ok(codes.has("shares-must-total-100"));
  assert.ok(codes.has("out-of-range"));
  assert.throws(() => stepRun(createInitialRun(1, "professional"), decision), {
    name: DecisionValidationError.name,
  });
});

test("near-100 regional shares cannot create grain through a negative residual", () => {
  const run = createInitialRun(4, "professional");
  const decision = createDefaultDecision(run.state);
  decision.railAndTruck.railGrainKt = 10;
  decision.railAndTruck.railCopperKt = 0;
  decision.railAndTruck.grainSharesPct = {
    capital: 50.005,
    north: 50.004,
    interior: 0,
  };
  const validation = validateDecision(run.state, decision);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some(
      (error) =>
        error.code === "shares-must-total-100" ||
        error.code === "invalid-precision",
    ),
  );
});

test("prototype properties and unknown imports are rejected without crashing validation", () => {
  const state = createInitialRun(8, "professional").state;
  const inheritedRepair = createDefaultDecision(state);
  (inheritedRepair as { repairIntensity: string }).repairIntensity = "toString";
  const repairResult = validateDecision(
    state,
    inheritedRepair as DecisionPackage,
  );
  assert.equal(repairResult.valid, false);
  assert.ok(
    repairResult.errors.some(
      (error) =>
        error.path === "repairIntensity" && error.code === "invalid-enum",
    ),
  );

  const unknownImport = createDefaultDecision(state);
  unknownImport.imports = [
    {
      cargo: "widgets",
      supplier: "imaginary",
      quantityKt: 1,
    } as never,
  ];
  const importResult = validateDecision(state, unknownImport);
  assert.equal(importResult.valid, false);
  assert.ok(importResult.errors.some((error) => error.path.includes("cargo")));
  assert.ok(importResult.errors.some((error) => error.path.includes("supplier")));

  const emptyPort = createDefaultDecision(state);
  emptyPort.portSchedule = {} as DecisionPackage["portSchedule"];
  const portResult = validateDecision(state, emptyPort);
  assert.equal(portResult.valid, false);
  assert.equal(portResult.errors[0].code, "invalid-shape");

  const missingScalar = createDefaultDecision(state);
  delete (missingScalar as Partial<DecisionPackage>).notes;
  const scalarResult = validateDecision(
    state,
    missingScalar as DecisionPackage,
  );
  assert.equal(scalarResult.valid, false);
  assert.equal(scalarResult.errors[0].code, "invalid-shape");
});

test("zero rail movement permits zero shares without dividing by zero", () => {
  const run = createInitialRun(12, "professional");
  const decision = createDefaultDecision(run.state);
  decision.railAndTruck.railGrainKt = 0;
  decision.railAndTruck.railCopperKt = 0;
  decision.railAndTruck.grainSharesPct = {
    capital: 0,
    north: 0,
    interior: 0,
  };
  assert.equal(validateDecision(run.state, decision).valid, true);
  const next = stepRun(run, decision);
  assert.ok(next.history[0].invariants.every((check) => check.ok));
});

test("replay recomputes exactly from seed and committed decisions", () => {
  const run = runBaseline("competent", 27);
  const replay = replayRun(run);

  assert.equal(replay.state.turn, TOTAL_TURNS);
  assert.deepEqual(
    replay.history.map((record) => record.stateHash),
    run.history.map((record) => record.stateHash),
  );
  assert.equal(stableHash(replay.state), stableHash(run.state));

  const corrupted = JSON.parse(JSON.stringify(run)) as SimulationRun;
  corrupted.history[4].stateHash = "00000000";
  assert.throws(() => replayRun(corrupted), /replay mismatch/i);
});

test("save/load round trips by replay rather than trusting cached snapshots", () => {
  const run = runBaseline("reactive", 14);
  const restored = deserializeRun(serializeRun(run));
  assert.equal(stableHash(restored.state), stableHash(run.state));
  assert.deepEqual(
    restored.history.map((record) => record.stateHash),
    run.history.map((record) => record.stateHash),
  );

  const cachedStateTamper = JSON.parse(serializeRun(run)) as SimulationRun;
  cachedStateTamper.state.grainCentralKt = 99_999;
  cachedStateTamper.history[2].stateSnapshot.dieselKt = 99_999;
  const repaired = deserializeRun(JSON.stringify(cachedStateTamper));
  assert.equal(stableHash(repaired.state), stableHash(run.state));
});

test("branching preserves the exact replayed prefix at turn zero and later turns", () => {
  const original = runBaseline("competent", 82);
  const atZero = branchRun(original, 0);
  assert.equal(atZero.state.turn, 0);
  assert.equal(atZero.history.length, 0);
  assert.equal(atZero.branch.parentRunId, original.runId);

  const atFive = branchRun(original, 5);
  assert.equal(atFive.state.turn, 5);
  assert.equal(atFive.history.length, 5);
  assert.deepEqual(
    atFive.history.map((record) => record.stateHash),
    original.history.slice(0, 5).map((record) => record.stateHash),
  );

  const changed = createDefaultDecision(atFive.state);
  changed.railAndTruck.railGrainKt = 8;
  changed.railAndTruck.railCopperKt = 2;
  const divergent = stepRun(atFive, changed);
  assert.equal(divergent.history.length, 6);
  assert.notEqual(
    divergent.history[5].stateHash,
    original.history[5].stateHash,
  );
  assert.equal(original.history.length, TOTAL_TURNS);
});

test("scripted seeded events are announced, occur once, and release dated revisions", () => {
  const run = runBaseline("minimal", 5, "guided");
  const eventTurns = new Map(
    run.state.events.map((item) => [item.type, item.turn]),
  );

  assert.equal(eventTurns.get("early-payment-offer"), 4);
  assert.equal(eventTurns.get("regional-stock-revision"), 6);
  assert.equal(eventTurns.get("crop-revision"), 7);
  assert.equal(eventTurns.get("weather-warning"), 7);
  assert.equal(eventTurns.get("port-closure"), 8);

  const regularReports = run.state.observations.reports.filter((report) =>
    report.id.includes(":regular:"),
  );
  assert.ok(regularReports.length >= TOTAL_TURNS * 2);
  for (const report of regularReports) {
    assert.equal(report.asOfTurn, report.publishedTurn - 1);
  }
  const revisions = run.state.observations.reports.filter(
    (report) => report.status === "revised",
  );
  assert.ok(revisions.some((report) => report.kind === "crop"));
  assert.ok(revisions.some((report) => report.kind === "regional-stock"));
  assert.ok(revisions.every((report) => report.revisesReportId !== null));
});

test("the player snapshot does not reveal a future seeded event schedule", () => {
  const run = createInitialRun(123, "professional");
  const visible = getVisibleSnapshot(run);
  assert.equal(visible.earlyPaymentOffer.status, "not-offered");
  assert.equal(visible.earlyPaymentOffer.offeredTurn, -1);
  assert.equal(visible.earlyPaymentOffer.availableUntilTurn, -1);
  assert.equal(
    JSON.stringify(visible).includes("cropMultiplier"),
    false,
  );
  assert.equal(
    JSON.stringify(visible).includes("repairEfficiency"),
    false,
  );
  assert.equal(
    JSON.stringify(visible).includes("regularReportBias"),
    false,
  );
});

test("uncertain shipment timing is shown as a window until arrival", () => {
  let run = createInitialRun(123, "professional");
  const decision = createDefaultDecision(run.state);
  decision.imports = [
    {
      cargo: "grain",
      supplier: "distant-discount",
      quantityKt: 1,
    },
  ];
  run = stepRun(run, decision);

  const shipment = getVisibleSnapshot(run).shipments.find(
    (item) => item.supplier === "distant-discount",
  );
  assert.ok(shipment);
  assert.equal(shipment.arrivalTurn, null);
  assert.deepEqual(shipment.expectedArrivalWindow, {
    earliestTurn: 5,
    latestTurn: 6,
  });

  run = stepDefaults(run, 5);
  const arrived = getVisibleSnapshot(run).shipments.find(
    (item) => item.supplier === "distant-discount",
  );
  assert.ok(arrived);
  assert.notEqual(arrived.arrivalTurn, null);
});

test("stock and ledger traces reconcile every turn and headline traces are complete", () => {
  const run = runBaseline("competent", 44);
  let previous: WorldState = run.initialState;

  for (const record of run.history) {
    const current = record.stateSnapshot;
    assert.ok(record.invariants.every((check) => check.ok));
    assert.equal(
      record.trace.some((entry) => entry.target === "grain.totalKt"),
      true,
    );
    assert.equal(
      record.trace.some((entry) => entry.target === "diesel.stockKt"),
      true,
    );
    assert.equal(
      record.trace.some((entry) => entry.target === "copper.stockKt"),
      true,
    );
    assert.equal(
      record.trace.some((entry) => entry.target === "finance.fxCents"),
      true,
    );
    assert.ok(
      Math.abs(
        trueTotalGrainKt(current) -
          trueTotalGrainKt(previous) -
          sumTrace(record.trace, "grain.totalKt"),
      ) < 1e-5,
    );
    assert.ok(
      Math.abs(
        current.dieselKt -
          previous.dieselKt -
          sumTrace(record.trace, "diesel.stockKt"),
      ) < 1e-5,
    );
    assert.ok(
      Math.abs(
        current.copperAtPortKt -
          previous.copperAtPortKt -
          sumTrace(record.trace, "copper.stockKt"),
      ) < 1e-5,
    );
    assert.equal(
      current.finance.fxCents - previous.finance.fxCents,
      sumTrace(record.trace, "finance.fxCents"),
    );
    previous = current;
  }
});

test("early-payment copper is not paid twice and missed cargo incurs a penalty", () => {
  let run = createInitialRun(9, "professional");
  while (run.state.earlyPaymentOffer.status !== "available") {
    run = stepRun(run, createDefaultDecision(run.state));
  }
  const accept = createDefaultDecision(run.state);
  accept.copperPlan.acceptEarlyPayment = true;
  accept.portSchedule.copperExportsKt = 0;
  run = stepRun(run, accept);
  const acceptedTurn = run.state.turn;
  const entriesAtAcceptance = run.state.finance.ledger.filter(
    (entry) => entry.turn === acceptedTurn,
  );
  assert.ok(entriesAtAcceptance.some((entry) => entry.account === "early-payment"));
  assert.equal(
    entriesAtAcceptance.some((entry) => entry.account === "copper-exports"),
    false,
  );

  for (let count = 0; count < 2; count += 1) {
    const hold = createDefaultDecision(run.state);
    hold.portSchedule.copperExportsKt = 0;
    run = stepRun(run, hold);
  }
  assert.equal(run.state.earlyPaymentObligation, null);
  assert.equal(run.state.finance.contractAdvanceLiabilityCents, 0);
  assert.equal(run.state.finance.contractualPenaltiesCents, 80_000_000);
  assert.ok(
    run.state.events.some((item) => item.type === "contract-penalty"),
  );
  const defaultEntry = run.state.finance.ledger.find(
    (entry) =>
      entry.description ===
      "Clawback of the unearned copper advance plus default penalty",
  );
  assert.equal(defaultEntry?.cashDeltaCents, -340_000_000);
});

test("intra-turn FX lows survive later receipts and liabilities lower the mandate result", () => {
  const run = createInitialRun(31, "professional");
  const nearFloor = JSON.parse(JSON.stringify(run.state)) as WorldState;
  nearFloor.finance.fxCents = 1_020_000_000;
  nearFloor.metrics.minimumFxCents = 1_020_000_000;
  const decision = createDefaultDecision(nearFloor);
  decision.imports = [
    { cargo: "grain", supplier: "standard", quantityKt: 1 },
  ];
  const stepped = stepWorld(nearFloor, decision).state;
  assert.equal(stepped.finance.fxCents > 1_020_000_000, true);
  assert.equal(stepped.metrics.minimumFxCents, 970_000_000);
  const fxObjective = stepped.objectives.find(
    (objective) => objective.id === "fx-floor",
  );
  assert.equal(fxObjective?.value, 970_000_000);
  assert.equal(fxObjective?.status, "breached");

  const creditDecision = createDefaultDecision(run.state);
  creditDecision.emergencyCreditUsdM = 4;
  const indebted = stepRun(run, creditDecision);
  const burden = indebted.state.objectives.find(
    (objective) => objective.id === "hardship",
  );
  const resilience = indebted.state.objectives.find(
    (objective) => objective.id === "resilience",
  );
  assert.ok((burden?.value ?? 0) >= 2);
  assert.notEqual(resilience?.status, "secure");
});

test("audits are precise point-in-time reports, not permanent telemetry upgrades", () => {
  let run = createInitialRun(17, "professional");
  const audit = createDefaultDecision(run.state);
  audit.audit = "north-stock";
  run = stepRun(run, audit);
  run = stepRun(run, createDefaultDecision(run.state));
  const report = run.state.observations.reports.find(
    (item) => item.id === "report:audit:audit:1:north-stock",
  );
  assert.ok(report);
  assert.equal(report?.publishedTurn, 2);
  assert.equal(report?.asOfTurn, 1);
  assert.equal(
    run.state.regions.north.reportedGrainKt,
    report?.values.grainKt,
  );

  run = stepRun(run, createDefaultDecision(run.state));
  assert.notEqual(
    run.state.regions.north.reportedGrainKt,
    report?.values.grainKt,
  );
});

test("food shortfall days are national full-service-day equivalents", () => {
  const run = createInitialRun(24, "professional");
  const emptyDepots = JSON.parse(JSON.stringify(run.state)) as WorldState;
  emptyDepots.grainCentralKt = 0;
  for (const region of ["capital", "north", "interior"] as const) {
    emptyDepots.regions[region].grainKt = 0;
    emptyDepots.regions[region].activeRation = "severe";
  }
  const decision = createDefaultDecision(emptyDepots);
  decision.portSchedule = {
    grainImportsKt: 0,
    dieselImportsKt: 0,
    copperExportsKt: 0,
    repairEquipmentKt: 0,
  };
  decision.railAndTruck = {
    railGrainKt: 0,
    railCopperKt: 0,
    grainSharesPct: { capital: 0, north: 0, interior: 0 },
    truckRegion: "none",
    truckGrainKt: 0,
  };
  decision.copperPlan.mineTargetKt = 0;
  decision.rationPolicy = {
    capital: "severe",
    north: "severe",
    interior: "severe",
  };

  const result = stepWorld(emptyDepots, decision);
  assert.equal(result.state.metrics.foodShortfallKt, 5.46);
  assert.equal(result.state.metrics.foodShortfallDays, 7);
  assert.equal(sumTrace(result.trace, "metrics.foodShortfallDays"), 7);
});

test("arrived import cargo unloads FIFO regardless of array order", () => {
  const run = createInitialRun(25, "professional");
  const state = JSON.parse(JSON.stringify(run.state)) as WorldState;
  state.shipments = [
    {
      id: "shipment:later",
      cargo: "grain",
      supplier: "standard",
      orderedTurn: 0,
      arrivalTurn: 1,
      quantityKt: 2,
      remainingKt: 2,
      unitCostCentsPerKt: 0,
      status: "sailing",
      actionId: "opening-commitments",
    },
    {
      id: "shipment:older",
      cargo: "grain",
      supplier: "standard",
      orderedTurn: -2,
      arrivalTurn: 0,
      quantityKt: 2,
      remainingKt: 2,
      unitCostCentsPerKt: 0,
      status: "arrived",
      actionId: "opening-commitments",
    },
  ];
  const decision = createDefaultDecision(state);
  decision.portSchedule = {
    grainImportsKt: 2,
    dieselImportsKt: 0,
    copperExportsKt: 0,
    repairEquipmentKt: 0,
  };
  decision.railAndTruck = {
    railGrainKt: 0,
    railCopperKt: 0,
    grainSharesPct: { capital: 0, north: 0, interior: 0 },
    truckRegion: "none",
    truckGrainKt: 0,
  };
  decision.copperPlan.mineTargetKt = 0;

  const result = stepWorld(state, decision);
  assert.equal(
    result.state.shipments.find((shipment) => shipment.id === "shipment:older")
      ?.remainingKt,
    0,
  );
  assert.equal(
    result.state.shipments.find((shipment) => shipment.id === "shipment:later")
      ?.remainingKt,
    2,
  );
});

test("all reference policies finish and produce materially different outcomes", () => {
  const policies = ["minimal", "reactive", "competent", "adversary"] as const;
  const results = policies.map((policy) => runBaseline(policy, 2));
  assert.ok(results.every((run) => run.state.complete));
  assert.ok(results.every((run) => run.history.length === TOTAL_TURNS));
  assert.equal(
    new Set(results.map((run) => run.history.at(-1)?.stateHash)).size,
    policies.length,
  );
  assert.ok(
    results[2].state.metrics.foodShortfallKt <
      results[3].state.metrics.foodShortfallKt,
  );
});

test("extreme but valid operating allocations remain finite and conserved", () => {
  let run = createInitialRun(99, "professional");
  while (!run.state.complete) {
    const decision = createDefaultDecision(run.state);
    decision.portSchedule = {
      grainImportsKt: 0,
      dieselImportsKt: 0,
      copperExportsKt: 0,
      repairEquipmentKt: 0,
    };
    decision.railAndTruck = {
      railGrainKt: 0,
      railCopperKt: 0,
      grainSharesPct: { capital: 34, north: 33, interior: 33 },
      truckRegion: "none",
      truckGrainKt: 0,
    };
    decision.copperPlan.mineTargetKt = 0;
    decision.rationPolicy = {
      capital: "severe",
      north: "severe",
      interior: "severe",
    };
    run = stepRun(run, decision);
  }
  assert.ok(
    run.history.flatMap((record) => record.invariants).every((check) => check.ok),
  );
  assertAllNumbersFinite(run);
  assert.equal(JSON.stringify(run).includes("null"), true);
});

test("competent baseline completes a 100-seed Monte Carlo smoke test", () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const run = runBaseline("competent", seed);
    assert.equal(run.state.complete, true, `seed ${seed} did not finish`);
    assert.equal(run.history.length, TOTAL_TURNS, `seed ${seed} history length`);
    assert.ok(
      run.history
        .flatMap((record) => record.invariants)
        .every((check) => check.ok),
      `seed ${seed} failed an invariant`,
    );
    assert.ok(
      run.state.metrics.foodShortfallKt < 12,
      `competent baseline collapsed on ordinary seed ${seed}`,
    );
  }
});
