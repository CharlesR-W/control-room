import type { ScenarioVariant, SimulationMode } from "./types.ts";

export function normaliseSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error("Seed must be a finite number.");
  }
  return Math.trunc(seed) >>> 0;
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function deterministicUint(seed: number, key: string): number {
  return hashText(`${normaliseSeed(seed)}:${key}`);
}

export function deterministicFloat(seed: number, key: string): number {
  return deterministicUint(seed, key) / 0x1_0000_0000;
}

export function deterministicInt(
  seed: number,
  key: string,
  minimum: number,
  maximum: number,
): number {
  if (maximum < minimum) {
    throw new Error("Invalid deterministic integer range.");
  }
  const width = maximum - minimum + 1;
  return minimum + (deterministicUint(seed, key) % width);
}

export function round(value: number, decimalPlaces = 6): number {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalise(object[key])}`)
    .join(",")}}`;
}

export function stableHash(value: unknown): string {
  return hashText(canonicalise(value)).toString(16).padStart(8, "0");
}

export function addWeeks(isoDate: string, weeks: number): string {
  const milliseconds = Date.parse(`${isoDate}T00:00:00.000Z`) + weeks * 7 * 86_400_000;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function createScenarioVariant(
  seed: number,
  mode: SimulationMode,
): ScenarioVariant {
  const guided = mode === "guided";
  const cropOptions = [0.82, 0.92, 1.08, 1.16];
  const repairOptions = [0.9, 1, 1.1];
  const regions = ["capital", "north", "interior"] as const;

  return {
    closureTurn: guided ? 8 : deterministicInt(seed, "closure-turn", 7, 9),
    cropRevisionTurn: guided ? 7 : deterministicInt(seed, "crop-revision-turn", 5, 7),
    cropMultiplier: guided
      ? 0.92
      : cropOptions[deterministicInt(seed, "crop-multiplier", 0, cropOptions.length - 1)],
    stockRevisionTurn: guided ? 6 : deterministicInt(seed, "stock-revision-turn", 4, 6),
    stockRevisionRegion: guided
      ? "north"
      : regions[deterministicInt(seed, "stock-revision-region", 0, regions.length - 1)],
    earlyPaymentOfferTurn: guided
      ? 4
      : deterministicInt(seed, "early-offer-turn", 3, 5),
    repairEfficiency: guided
      ? 1
      : repairOptions[
          deterministicInt(seed, "repair-efficiency", 0, repairOptions.length - 1)
        ],
    regularReportBias: {
      capital: round((deterministicFloat(seed, "report-bias-capital") - 0.5) * 0.24, 4),
      north: guided
        ? 0.18
        : round((deterministicFloat(seed, "report-bias-north") - 0.5) * 0.3, 4),
      interior: round((deterministicFloat(seed, "report-bias-interior") - 0.5) * 0.24, 4),
    },
  };
}
