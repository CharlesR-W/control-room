#!/usr/bin/env node

import { readFileSync } from "node:fs";
import {
  branchRun,
  deserializeRun,
  replayRun,
  runBaseline,
  serializeRun,
  trueTotalGrainKt,
  type BaselinePolicy,
  type SimulationMode,
  type SimulationRun,
} from "./lib/sim/index.ts";

const POLICIES = new Set<BaselinePolicy>([
  "minimal",
  "reactive",
  "competent",
  "adversary",
]);
const MODES = new Set<SimulationMode>(["guided", "professional", "sandbox"]);

function policy(raw: string | undefined): BaselinePolicy {
  if (raw && POLICIES.has(raw as BaselinePolicy)) return raw as BaselinePolicy;
  if (raw) throw new Error(`Unknown policy "${raw}".`);
  return "competent";
}

function mode(raw: string | undefined): SimulationMode {
  if (raw && MODES.has(raw as SimulationMode)) return raw as SimulationMode;
  if (raw) throw new Error(`Unknown mode "${raw}".`);
  return "professional";
}

function integer(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function summary(run: SimulationRun) {
  return {
    runId: run.runId,
    branch: run.branch,
    seed: run.seed,
    mode: run.mode,
    turns: run.history.length,
    final: {
      grainKt: trueTotalGrainKt(run.state),
      dieselKt: run.state.dieselKt,
      foreignExchangeUsdM: run.state.finance.fxCents / 100_000_000,
      repairProgressPct: run.state.repairProgressPct,
    },
    outcomes: {
      foodShortfallKt: run.state.metrics.foodShortfallKt,
      essentialDieselLossKt: run.state.metrics.essentialDieselServiceLossKt,
      minimumForeignExchangeUsdM: run.state.metrics.minimumFxCents / 100_000_000,
      hardshipPoints: run.state.metrics.hardshipPoints,
      contractualPenaltiesUsdM:
        run.state.metrics.contractualPenaltiesCents / 100_000_000,
    },
    invariantFailures: run.history.flatMap((record) =>
      record.invariants.filter((check) => !check.ok).map((check) => check.id),
    ),
  };
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readRun(path: string | undefined): SimulationRun {
  if (!path) throw new Error("A run JSON path is required.");
  return deserializeRun(readFileSync(path, "utf8"));
}

function monteCarlo(selectedPolicy: BaselinePolicy, count: number) {
  const runs = Array.from({ length: count }, (_, index) =>
    runBaseline(selectedPolicy, index + 1, "professional"),
  );
  const values = runs.map((run) => summary(run).outcomes);
  const mean = (items: number[]) =>
    items.reduce((total, value) => total + value, 0) / Math.max(1, items.length);
  return {
    policy: selectedPolicy,
    seeds: count,
    foodShortfallKt: {
      mean: mean(values.map((item) => item.foodShortfallKt)),
      minimum: Math.min(...values.map((item) => item.foodShortfallKt)),
      maximum: Math.max(...values.map((item) => item.foodShortfallKt)),
    },
    minimumForeignExchangeUsdM: {
      mean: mean(values.map((item) => item.minimumForeignExchangeUsdM)),
      minimum: Math.min(...values.map((item) => item.minimumForeignExchangeUsdM)),
    },
    invariantFailures: runs.reduce(
      (total, run) => total + summary(run).invariantFailures.length,
      0,
    ),
  };
}

function usage() {
  return `Control Room headless runner

Usage:
  npm run sim -- run [policy] [seed] [mode]
  npm run sim -- replay <run.json>
  npm run sim -- branch <run.json> <completed-turn>
  npm run sim -- monte-carlo [policy] [seed-count]
  npm run sim -- validate

Policies: minimal, reactive, competent, adversary
Modes: guided, professional, sandbox`;
}

const [command = "help", ...args] = process.argv.slice(2);

try {
  if (command === "run") {
    const selectedPolicy = policy(args[0]);
    const seed = integer(args[1], 7, "Seed");
    print(summary(runBaseline(selectedPolicy, seed, mode(args[2]))));
  } else if (command === "replay") {
    print(summary(replayRun(readRun(args[0]))));
  } else if (command === "branch") {
    const run = readRun(args[0]);
    process.stdout.write(
      `${serializeRun(branchRun(run, integer(args[1], run.history.length, "Turn")))}\n`,
    );
  } else if (command === "monte-carlo") {
    print(monteCarlo(policy(args[0]), integer(args[1], 100, "Seed count")));
  } else if (command === "validate") {
    print({
      policies: [...POLICIES].map((name) =>
        summary(runBaseline(name, 7, "professional")),
      ),
      smoke: monteCarlo("competent", 100),
    });
  } else {
    process.stdout.write(`${usage()}\n`);
  }
} catch (error) {
  process.stderr.write(
    `Control Room CLI error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
