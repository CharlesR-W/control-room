import type {
  ActionFamily,
  RegionId,
  RepairIntensity,
  RationLevel,
  Supplier,
} from "./types.ts";

export const ENGINE_VERSION = "0.1.0";
export const RUN_SCHEMA_VERSION = "1";
export const RNG_VERSION = "control-room-hash32-v1";
export const SCENARIO_ID = "narrows-supply-crisis";
export const SCENARIO_VERSION = "0.1.0";
export const SCENARIO_CONTENT_HASH = "narrows-v0.1.0-explicit-assumptions-1";
export const SCENARIO_TITLE = "The Narrows: Twelve Weeks to Stabilize Selene";
export const ROLE_TITLE = "Minister for National Supply";
export const START_DATE = "1978-09-04";
export const TOTAL_TURNS = 12;

export const REGION_IDS: RegionId[] = ["capital", "north", "interior"];

export const REGION_LABELS: Record<RegionId, string> = {
  capital: "Capital Region",
  north: "Northern Industrial Belt",
  interior: "Interior Agricultural Region",
};

export const REGION_WEEKLY_DEMAND_KT: Record<RegionId, number> = {
  capital: 3,
  north: 2.5,
  interior: 1.5,
};

export const INITIAL_REGION_GRAIN_KT: Record<RegionId, number> = {
  capital: 7,
  north: 4,
  interior: 3,
};

export const RATION_DEMAND_MULTIPLIER: Record<RationLevel, number> = {
  none: 1,
  moderate: 0.9,
  severe: 0.78,
};

export const RATION_HARDSHIP_POINTS: Record<RationLevel, number> = {
  none: 0,
  moderate: 0.5,
  severe: 1.5,
};

export const IMPORT_LEAD_TURNS: Record<Supplier, number> = {
  "near-premium": 2,
  standard: 3,
  "distant-discount": 4,
};

export const IMPORT_UNIT_COST_CENTS_PER_KT = {
  grain: {
    "near-premium": 620_000_00,
    standard: 500_000_00,
    "distant-discount": 410_000_00,
  },
  diesel: {
    "near-premium": 920_000_00,
    standard: 760_000_00,
    "distant-discount": 650_000_00,
  },
} as const;

export const REPAIR_ASSUMPTIONS: Record<
  RepairIntensity,
  {
    progressPct: number;
    costCents: number;
    teams: number;
    equipmentKt: number;
    dieselKt: number;
  }
> = {
  none: { progressPct: 0, costCents: 0, teams: 0, equipmentKt: 0, dieselKt: 0 },
  normal: {
    progressPct: 7,
    costCents: 400_000_00,
    teams: 1,
    equipmentKt: 0.6,
    dieselKt: 0.08,
  },
  accelerated: {
    progressPct: 12,
    costCents: 850_000_00,
    teams: 2,
    equipmentKt: 1.1,
    dieselKt: 0.18,
  },
  emergency: {
    progressPct: 17,
    costCents: 1_450_000_00,
    teams: 3,
    equipmentKt: 1.8,
    dieselKt: 0.32,
  },
};

export const ACTION_LABELS: Record<ActionFamily, string> = {
  imports: "Import procurement",
  portSchedule: "Port scheduling",
  railAndTruck: "Rail and truck priority",
  rationPolicy: "Reserve and ration policy",
  copperPlan: "Copper operating plan",
  repairIntensity: "Port repair intensity",
  audit: "Information and audit",
  emergencyCredit: "Emergency finance",
};

export const ALL_ACTION_FAMILIES: ActionFamily[] = [
  "imports",
  "portSchedule",
  "railAndTruck",
  "rationPolicy",
  "copperPlan",
  "repairIntensity",
  "audit",
  "emergencyCredit",
];

export const GUIDED_UNLOCK_TURN: Record<ActionFamily, number> = {
  imports: 0,
  portSchedule: 2,
  copperPlan: 2,
  railAndTruck: 4,
  rationPolicy: 4,
  repairIntensity: 6,
  audit: 6,
  emergencyCredit: 6,
};

export const FX_INITIAL_CENTS = 30_000_000_00;
export const FX_EMERGENCY_FLOOR_CENTS = 10_000_000_00;
export const CREDIT_LIMIT_CENTS = 12_000_000_00;
export const COPPER_RECEIPT_CENTS_PER_KT = 650_000_00;
export const EARLY_PAYMENT_ADVANCE_CENTS = 2_600_000_00;
export const EARLY_PAYMENT_CARGO_KT = 5;
export const EARLY_PAYMENT_PENALTY_CENTS = 800_000_00;
export const WEEKLY_CREDIT_INTEREST_RATE = 0.004;

export const DIESEL_ESSENTIAL_REQUIREMENT_KT = 1.25;
export const DIESEL_PER_TRUCKED_GRAIN_KT = 0.28;
export const DIESEL_PER_RAIL_GRAIN_KT = 0.03;
export const DIESEL_PER_COPPER_KT = 0.16;
export const DOMESTIC_DIESEL_SUPPLY_KT = 1;
