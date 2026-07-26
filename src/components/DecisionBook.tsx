"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ACTION_LABELS,
  COPPER_RECEIPT_CENTS_PER_KT,
  DIESEL_ESSENTIAL_REQUIREMENT_KT,
  DIESEL_PER_RAIL_GRAIN_KT,
  DIESEL_PER_TRUCKED_GRAIN_KT,
  EARLY_PAYMENT_ADVANCE_CENTS,
  EARLY_PAYMENT_CARGO_KT,
  EARLY_PAYMENT_PENALTY_CENTS,
  IMPORT_LEAD_TURNS,
  IMPORT_UNIT_COST_CENTS_PER_KT,
  RATION_DEMAND_MULTIPLIER,
  RATION_HARDSHIP_POINTS,
  REGION_LABELS,
  REPAIR_ASSUMPTIONS,
  WEEKLY_CREDIT_INTEREST_RATE,
} from "@/lib/sim/constants";
import {
  importCostCents,
  visibleCargoAvailability,
} from "@/lib/sim";
import type {
  ActionFamily,
  AuditKind,
  BindingConstraint,
  Cargo,
  DecisionPackage,
  ImportDecision,
  RationLevel,
  RegionId,
  RepairIntensity,
  Supplier,
  ValidationResult,
  VisibleSnapshot,
} from "@/lib/sim/types";
import { Icon } from "./Icons";
import { formatUsd, StatusLabel } from "./Panels";
import { Meter } from "./Visuals";

const SECTION_ORDER: ActionFamily[] = [
  "imports",
  "portSchedule",
  "railAndTruck",
  "rationPolicy",
  "copperPlan",
  "repairIntensity",
  "audit",
  "emergencyCredit",
];

const ACTION_SUMMARIES: Record<ActionFamily, string> = {
  imports: "Orders, suppliers & arrival windows",
  portSchedule: "Weekly unloading and loading slots",
  railAndTruck: "Freight routes and regional shares",
  rationPolicy: "Delayed demand management",
  copperPlan: "Mine output and export receipts",
  repairIntensity: "Cost, teams and equipment",
  audit: "Targeted information actions",
  emergencyCredit: "Liquidity with later liabilities",
};

const BINDING_OPTIONS: BindingConstraint[] = [
  "port",
  "rail",
  "diesel",
  "foreign-exchange",
  "implementation-teams",
  "grain-stock",
  "regional-stock",
  "repair-equipment",
  "none",
];

function numericValue(raw: string) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function KnownQuantity({
  label,
  value,
  detail,
  tone = "measured",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "measured" | "reported" | "uncertain" | "warning";
}) {
  return (
    <div className={`known-quantity known-quantity--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function availabilityValue(
  availability: ReturnType<typeof visibleCargoAvailability>,
) {
  if (availability.uncertainKt <= 0) {
    return `${availability.confirmedByTurnKt.toFixed(1)} kt`;
  }
  return `${availability.confirmedByTurnKt.toFixed(1)}–${availability.possibleByTurnKt.toFixed(1)} kt`;
}

function cargoRealizationCopy(
  requestedKt: number,
  availability: ReturnType<typeof visibleCargoAvailability>,
  portClosed: boolean,
) {
  if (portClosed) {
    return "0.0 kt realizable: the disclosed closure overrides this allocation.";
  }
  const guaranteed = Math.min(requestedKt, availability.confirmedByTurnKt);
  const possible = Math.min(requestedKt, availability.possibleByTurnKt);
  if (possible < requestedKt - 1e-6) {
    return `${possible.toFixed(1)} kt maximum from disclosed cargo; ${(requestedKt - possible).toFixed(1)} kt of the request would expire unused.`;
  }
  if (guaranteed < possible - 1e-6) {
    return `${guaranteed.toFixed(1)} kt guaranteed; up to ${possible.toFixed(1)} kt if windowed cargo arrives.`;
  }
  return `${guaranteed.toFixed(1)} kt backed by confirmed cargo.`;
}

function CargoAvailabilityReadout({
  label,
  requestedKt,
  availability,
  portClosed,
}: {
  label: string;
  requestedKt: number;
  availability: ReturnType<typeof visibleCargoAvailability>;
  portClosed: boolean;
}) {
  const confirmedRealizable = portClosed
    ? 0
    : Math.min(requestedKt, availability.confirmedByTurnKt);
  const possibleRealizable = portClosed
    ? 0
    : Math.min(requestedKt, availability.possibleByTurnKt);
  return (
    <div
      className="cargo-availability"
      role="group"
      aria-label={`${label} availability`}
    >
      <div className="cargo-availability__header">
        <strong>{label}</strong>
        <span>{cargoRealizationCopy(requestedKt, availability, portClosed)}</span>
      </div>
      <dl>
        <div>
          <dt>Berth requested</dt>
          <dd>{requestedKt.toFixed(1)} kt</dd>
        </div>
        <div>
          <dt>Confirmed cargo by W{availability.forTurn}</dt>
          <dd>{availability.confirmedByTurnKt.toFixed(1)} kt</dd>
        </div>
        <div>
          <dt>Possible within window</dt>
          <dd>{availability.possibleByTurnKt.toFixed(1)} kt</dd>
        </div>
        <div>
          <dt>Realizable range</dt>
          <dd>
            {confirmedRealizable.toFixed(1)}
            {possibleRealizable > confirmedRealizable + 1e-6
              ? `–${possibleRealizable.toFixed(1)}`
              : ""}{" "}
            kt
          </dd>
        </div>
      </dl>
    </div>
  );
}

function isConfigured(family: ActionFamily, decision: DecisionPackage) {
  if (family === "imports") return decision.imports.length > 0;
  if (family === "repairIntensity") return decision.repairIntensity !== "none";
  if (family === "audit") return decision.audit !== "none";
  if (family === "emergencyCredit") return decision.emergencyCreditUsdM > 0;
  if (family === "rationPolicy") {
    return Object.values(decision.rationPolicy).some((level) => level !== "none");
  }
  if (family === "copperPlan") {
    return decision.copperPlan.mineTargetKt !== 4 || decision.copperPlan.acceptEarlyPayment;
  }
  return true;
}

function SectionIssues({
  family,
  validation,
}: {
  family: ActionFamily;
  validation: ValidationResult;
}) {
  const prefixes =
    family === "emergencyCredit"
      ? ["emergencyCreditUsdM", "finance"]
      : family === "imports"
        ? ["imports", "finance"]
        : [family];
  const errors = validation.errors.filter((item) =>
    prefixes.some((prefix) => item.path.startsWith(prefix)),
  );
  const warnings = validation.warnings.filter((item) =>
    prefixes.some((prefix) => item.path.startsWith(prefix)),
  );
  if (!errors.length && !warnings.length) return null;
  return (
    <div className={`validation-box ${errors.length ? "validation-box--error" : ""}`}>
      {[...errors, ...warnings].map((item, index) => (
        <span className="validation-issue" key={`${item.code}-${item.path}-${index}`}>
          <Icon name="alert" />
          <span>{item.message}</span>
        </span>
      ))}
    </div>
  );
}

function ImportsForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const updateOrder = (
    index: number,
    patch: Partial<ImportDecision>,
  ) => {
    onChange({
      ...decision,
      imports: decision.imports.map((order, orderIndex) =>
        orderIndex === index ? { ...order, ...patch } : order,
      ),
    });
  };

  const addOrder = () => {
    if (decision.imports.length >= 4) return;
    onChange({
      ...decision,
      imports: [
        ...decision.imports,
        { cargo: "grain", supplier: "standard", quantityKt: 5 },
      ],
    });
  };

  return (
    <>
      <div className="known-quantity-grid">
        <KnownQuantity
          label="FX before draft"
          value={formatUsd(visible.headline.fxCents, true)}
          detail={`${formatUsd(visible.headline.emergencyFloorCents, true)} emergency floor`}
        />
        <KnownQuantity
          label="Draft import cost"
          value={formatUsd(importCostCents(decision.imports), true)}
          detail="Paid now on signing"
          tone={decision.imports.length ? "warning" : "measured"}
        />
        <KnownQuantity
          label="Order slots"
          value={`${decision.imports.length} / 4`}
          detail="One team for the whole non-empty batch"
        />
      </div>
      {decision.imports.map((order, index) => (
        <div className="import-order" key={`${index}-${order.cargo}-${order.supplier}`}>
          <label className="field-label">
            Cargo
            <select
              className="select"
              value={order.cargo}
              onChange={(event) =>
                updateOrder(index, { cargo: event.target.value as Cargo })
              }
            >
              <option value="grain">Grain</option>
              <option value="diesel">Diesel</option>
            </select>
          </label>
          <label className="field-label">
            Supplier
            <select
              className="select"
              value={order.supplier}
              onChange={(event) =>
                updateOrder(index, { supplier: event.target.value as Supplier })
              }
            >
              <option value="near-premium">Near / premium</option>
              <option value="standard">Standard</option>
              <option value="distant-discount">Distant / discount</option>
            </select>
          </label>
          <label className="field-label">
            Quantity
            <input
              className="field"
              type="number"
              min="0.1"
              max="20"
              step="0.1"
              value={order.quantityKt}
              onChange={(event) =>
                updateOrder(index, { quantityKt: numericValue(event.target.value) })
              }
            />
          </label>
          <button
            className="icon-button"
            type="button"
            aria-label={`Remove ${order.cargo} order`}
            onClick={() =>
              onChange({
                ...decision,
                imports: decision.imports.filter((_, orderIndex) => orderIndex !== index),
              })
            }
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
      <button
        className="add-action"
        type="button"
        disabled={decision.imports.length >= 4}
        onClick={addOrder}
      >
        <span aria-hidden="true">＋</span>
        Add import contract
      </button>
      <ul className="book-action__preview">
        {decision.imports.length ? (
          decision.imports.map((order, index) => {
            const earliest =
              decision.forTurn + IMPORT_LEAD_TURNS[order.supplier];
            const arrival =
              order.supplier === "distant-discount"
                ? `${earliest}–${earliest + 1}`
                : String(earliest);
            const unitCost =
              IMPORT_UNIT_COST_CENTS_PER_KT[order.cargo][order.supplier];
            const orderCost = Math.round(order.quantityKt * unitCost);
            return (
              <li key={`${order.cargo}-${index}`}>
                {order.quantityKt.toFixed(1)} kt {order.cargo} at{" "}
                {formatUsd(unitCost, true)}/kt = {formatUsd(orderCost, true)},
                paid on signing; expected arrival week {arrival}.
              </li>
            );
          })
        ) : (
          <li>No new foreign exchange or administrative claim.</li>
        )}
        <li>
          Arrival does not reserve an unloading slot. Cargo remains unusable until
          a later port schedule clears it.
        </li>
      </ul>
    </>
  );
}

function PortForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const fields: Array<{
    key: keyof DecisionPackage["portSchedule"];
    label: string;
    hint: string;
    className: string;
  }> = [
    { key: "grainImportsKt", label: "Grain imports", hint: "Unload", className: "range--grain" },
    { key: "dieselImportsKt", label: "Diesel imports", hint: "Unload", className: "range--diesel" },
    { key: "copperExportsKt", label: "Copper exports", hint: "Load", className: "range--copper" },
    { key: "repairEquipmentKt", label: "Repair equipment", hint: "Unload", className: "" },
  ];
  const total = Object.values(decision.portSchedule).reduce((sum, value) => sum + value, 0);
  const grain = visibleCargoAvailability(visible, "grain", decision.forTurn);
  const diesel = visibleCargoAvailability(visible, "diesel", decision.forTurn);
  const portClosed =
    visible.operations.knownPortClosureTurn === decision.forTurn;
  const repairNeed = REPAIR_ASSUMPTIONS[decision.repairIntensity].equipmentKt;
  const fieldConstraint = (
    key: keyof DecisionPackage["portSchedule"],
  ) => {
    if (key === "grainImportsKt") {
      return cargoRealizationCopy(
        decision.portSchedule.grainImportsKt,
        grain,
        portClosed,
      );
    }
    if (key === "dieselImportsKt") {
      return cargoRealizationCopy(
        decision.portSchedule.dieselImportsKt,
        diesel,
        portClosed,
      );
    }
    if (key === "copperExportsKt") {
      if (portClosed) {
        return "0.0 kt realizable: the disclosed closure blocks loading; copper remains at port.";
      }
      const current = visible.operations.copperAtPortKt;
      const sameWeekPotential = Math.min(
        decision.copperPlan.mineTargetKt,
        decision.railAndTruck.railCopperKt,
      );
      return `${current.toFixed(1)} kt is at port now; up to ${sameWeekPotential.toFixed(1)} kt more can arrive from this week’s mine plan before diesel limits.`;
    }
    if (repairNeed <= 0) {
      return "No repair equipment is required by the selected intensity.";
    }
    if (portClosed) {
      return `0.0 kt realizable: the disclosed closure blocks the ${repairNeed.toFixed(1)} kt equipment requirement.`;
    }
    return `${repairNeed.toFixed(1)} kt is required for full nominal repair input; equipment is staged offshore, not held in stock.`;
  };
  return (
    <>
      <div className="known-quantity-grid">
        <KnownQuantity
          label={`Grain cargo by W${decision.forTurn}`}
          value={availabilityValue(grain)}
          detail={
            grain.uncertainKt > 0
              ? `${grain.confirmedByTurnKt.toFixed(1)} confirmed + ${grain.uncertainKt.toFixed(1)} windowed`
              : `${grain.queuedNowKt.toFixed(1)} kt queued now`
          }
          tone={grain.uncertainKt > 0 ? "uncertain" : "measured"}
        />
        <KnownQuantity
          label={`Diesel cargo by W${decision.forTurn}`}
          value={availabilityValue(diesel)}
          detail={
            diesel.uncertainKt > 0
              ? `${diesel.confirmedByTurnKt.toFixed(1)} confirmed + ${diesel.uncertainKt.toFixed(1)} windowed`
              : `${diesel.queuedNowKt.toFixed(1)} kt queued now`
          }
          tone={diesel.uncertainKt > 0 ? "uncertain" : "measured"}
        />
        <KnownQuantity
          label="Copper ready now"
          value={`${visible.operations.copperAtPortKt.toFixed(1)} kt`}
          detail="Same-week mine output can load after production"
        />
        <KnownQuantity
          label="Effective throughput"
          value={`${portClosed ? "0.0" : visible.headline.portCapacityKt.toFixed(1)} kt`}
          detail={
            portClosed
              ? `Forecast closure in W${decision.forTurn}`
              : "Measured physical weekly capacity"
          }
          tone={portClosed ? "warning" : "measured"}
        />
      </div>
      <div className="cargo-availability-grid">
        <CargoAvailabilityReadout
          label="Grain imports"
          requestedKt={decision.portSchedule.grainImportsKt}
          availability={grain}
          portClosed={portClosed}
        />
        <CargoAvailabilityReadout
          label="Diesel imports"
          requestedKt={decision.portSchedule.dieselImportsKt}
          availability={diesel}
          portClosed={portClosed}
        />
      </div>
      <div className="schedule-grid">
        {fields.map((field) => (
          <label className="schedule-row" key={field.key}>
            <span className="schedule-row__label">
              <strong>{field.label}</strong>
              <span>{field.hint}</span>
            </span>
            <input
              className={`range ${field.className}`}
              type="range"
              min="0"
              max={visible.headline.portCapacityKt}
              step="0.1"
              value={decision.portSchedule[field.key]}
              onChange={(event) =>
                onChange({
                  ...decision,
                  portSchedule: {
                    ...decision.portSchedule,
                    [field.key]: numericValue(event.target.value),
                  },
                })
              }
            />
            <output>{decision.portSchedule[field.key].toFixed(1)} kt</output>
            <small className="schedule-row__constraint">
              {fieldConstraint(field.key)}
            </small>
          </label>
        ))}
      </div>
      <div className="capacity-summary">
        <div>
          <div className="capacity-summary__copy">
            <span>
              {portClosed
                ? "Nominal claim / effective throughput"
                : "Total weekly claim"}
            </span>
            <strong>
              {portClosed
                ? `${total.toFixed(1)} kt / 0.0 kt`
                : `${total.toFixed(1)} / ${visible.headline.portCapacityKt.toFixed(0)} kt`}
            </strong>
          </div>
          <Meter
            value={total}
            max={visible.headline.portCapacityKt}
            label="Draft port capacity claim"
            tone={total > visible.headline.portCapacityKt ? "red" : "teal"}
          />
        </div>
        <StatusLabel
          tone={
            portClosed || total > visible.headline.portCapacityKt
              ? "critical"
              : "stable"
          }
        >
          {portClosed
            ? "Closed · 0 realizable"
            : total > visible.headline.portCapacityKt
              ? "Overbooked"
              : "Feasible"}
        </StatusLabel>
      </div>
      <ul className="book-action__preview">
        <li>
          Each allocation is a hard cargo cap. Actual movement is the smaller of
          that cap and eligible cargo or inputs.
        </li>
        <li>
          Unused capacity expires and is never silently reassigned between cargo
          classes.
        </li>
      </ul>
    </>
  );
}

function RailForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const regions: RegionId[] = ["capital", "north", "interior"];
  const totalRail =
    decision.railAndTruck.railGrainKt + decision.railAndTruck.railCopperKt;
  const shareTotal = regions.reduce(
    (sum, region) => sum + decision.railAndTruck.grainSharesPct[region],
    0,
  );
  const grainCargo = visibleCargoAvailability(
    visible,
    "grain",
    decision.forTurn,
  );
  const dieselCargo = visibleCargoAvailability(
    visible,
    "diesel",
    decision.forTurn,
  );
  const portClosed =
    visible.operations.knownPortClosureTurn === decision.forTurn;
  const confirmedGrainUnload = portClosed
    ? 0
    : Math.min(
        decision.portSchedule.grainImportsKt,
        grainCargo.confirmedByTurnKt,
      );
  const possibleGrainUnload = portClosed
    ? 0
    : Math.min(
        decision.portSchedule.grainImportsKt,
        grainCargo.possibleByTurnKt,
      );
  const confirmedDieselUnload = portClosed
    ? 0
    : Math.min(
        decision.portSchedule.dieselImportsKt,
        dieselCargo.confirmedByTurnKt,
      );
  const planningGrainFloor =
    visible.operations.centralGrainKt +
    visible.operations.reportedDomesticGrainOutputKt +
    confirmedGrainUnload;
  const planningGrainCeiling =
    visible.operations.centralGrainKt +
    visible.operations.reportedDomesticGrainOutputKt +
    possibleGrainUnload;
  const dieselBeforeDiscretionary = Math.max(
    0,
    visible.headline.dieselKt +
      visible.operations.domesticDieselSupplyKt +
      confirmedDieselUnload -
      DIESEL_ESSENTIAL_REQUIREMENT_KT,
  );
  return (
    <>
      <div className="known-quantity-grid">
        <KnownQuantity
          label="Central dispatch stock"
          value={`${visible.operations.centralGrainKt.toFixed(1)} kt`}
          detail="Measured before this week’s production and unloading"
        />
        <KnownQuantity
          label="Planning grain before freight"
          value={
            planningGrainFloor === planningGrainCeiling
              ? `${planningGrainFloor.toFixed(1)} kt`
              : `${planningGrainFloor.toFixed(1)}–${planningGrainCeiling.toFixed(1)} kt`
          }
          detail={`Uses reported ${visible.operations.reportedDomesticGrainOutputKt.toFixed(1)} kt output + draft unload`}
          tone={
            planningGrainFloor === planningGrainCeiling
              ? "reported"
              : "uncertain"
          }
        />
        <KnownQuantity
          label="Diesel before truck / rail"
          value={`${dieselBeforeDiscretionary.toFixed(2)} kt confirmed`}
          detail={`After +${visible.operations.domesticDieselSupplyKt.toFixed(1)} routine supply and ${DIESEL_ESSENTIAL_REQUIREMENT_KT.toFixed(2)} essential claim`}
        />
        <KnownQuantity
          label="Truck ceiling"
          value={`${visible.operations.truckCapacityKt.toFixed(1)} kt`}
          detail={`${DIESEL_PER_TRUCKED_GRAIN_KT.toFixed(2)} kt diesel per kt; executes first`}
        />
      </div>
      <div className="form-grid">
        <label className="field-label">
          Grain by rail
          <input
            className="field"
            type="number"
            min="0"
            max={visible.headline.railCapacityKt}
            step="0.5"
            value={decision.railAndTruck.railGrainKt}
            onChange={(event) =>
              onChange({
                ...decision,
                railAndTruck: {
                  ...decision.railAndTruck,
                  railGrainKt: numericValue(event.target.value),
                },
              })
            }
          />
        </label>
        <label className="field-label">
          Copper by rail
          <input
            className="field"
            type="number"
            min="0"
            max={visible.headline.railCapacityKt}
            step="0.5"
            value={decision.railAndTruck.railCopperKt}
            onChange={(event) =>
              onChange({
                ...decision,
                railAndTruck: {
                  ...decision.railAndTruck,
                  railCopperKt: numericValue(event.target.value),
                },
              })
            }
          />
        </label>
      </div>
      <div className="capacity-summary">
        <div>
          <div className="capacity-summary__copy">
            <span>Rail claim</span>
            <strong>
              {totalRail.toFixed(1)} / {visible.headline.railCapacityKt.toFixed(0)} kt
            </strong>
          </div>
          <Meter
            value={totalRail}
            max={visible.headline.railCapacityKt}
            label="Draft rail claim"
            tone={totalRail > visible.headline.railCapacityKt ? "red" : "amber"}
          />
        </div>
      </div>
      <div className="form-grid form-grid--3">
        {regions.map((region) => (
          <label className="field-label" key={region}>
            {REGION_LABELS[region]} share
            <span className="field-label__hint">
              {(decision.railAndTruck.railGrainKt *
                (decision.railAndTruck.grainSharesPct[region] / 100)).toFixed(1)}{" "}
              kt if the full rail request runs
            </span>
            <input
              className="field"
              type="number"
              min="0"
              max="100"
              step="1"
              value={decision.railAndTruck.grainSharesPct[region]}
              onChange={(event) =>
                onChange({
                  ...decision,
                  railAndTruck: {
                    ...decision.railAndTruck,
                    grainSharesPct: {
                      ...decision.railAndTruck.grainSharesPct,
                      [region]: numericValue(event.target.value),
                    },
                  },
                })
              }
            />
          </label>
        ))}
      </div>
      <div
        className={`share-total ${
          Math.abs(shareTotal - 100) > 1e-6 &&
          decision.railAndTruck.railGrainKt > 0
            ? "share-total--warning"
            : ""
        }`}
      >
        <span>Regional shares</span>
        <strong>{shareTotal.toFixed(0)} / 100%</strong>
      </div>
      <div className="form-grid">
        <label className="field-label">
          Emergency truck destination
          <select
            className="select"
            value={decision.railAndTruck.truckRegion}
            onChange={(event) =>
              onChange({
                ...decision,
                railAndTruck: {
                  ...decision.railAndTruck,
                  truckRegion: event.target.value as RegionId | "none",
                },
              })
            }
          >
            <option value="none">No trucking</option>
            {regions.map((region) => (
              <option value={region} key={region}>
                {REGION_LABELS[region]}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Trucked grain
          <input
            className="field"
            type="number"
            min="0"
            max={visible.operations.truckCapacityKt}
            step="0.1"
            value={decision.railAndTruck.truckGrainKt}
            onChange={(event) =>
              onChange({
                ...decision,
                railAndTruck: {
                  ...decision.railAndTruck,
                  truckGrainKt: numericValue(event.target.value),
                },
              })
            }
          />
        </label>
      </div>
      <ul className="book-action__preview">
        <li>
          Execution priority is essential diesel → trucking → rail grain → repair
          → copper mine. A later use receives only the fuel left by earlier uses.
        </li>
        <li>
          Rail grain and copper share a{" "}
          {visible.headline.railCapacityKt.toFixed(0)} kt ceiling. Rail grain
          consumes about{" "}
          {(decision.railAndTruck.railGrainKt *
            DIESEL_PER_RAIL_GRAIN_KT).toFixed(2)}{" "}
          kt diesel if fully realized.
        </li>
        <li>
          Trucking delivers immediately and requests{" "}
          {(decision.railAndTruck.truckGrainKt *
            DIESEL_PER_TRUCKED_GRAIN_KT).toFixed(2)}{" "}
          kt diesel.
        </li>
      </ul>
    </>
  );
}

function RationForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const regions: RegionId[] = ["capital", "north", "interior"];
  const levels: RationLevel[] = ["none", "moderate", "severe"];
  return (
    <>
      <div className="ration-grid">
        {regions.map((region) => (
          <div className="ration-row" key={region}>
            <span className="ration-row__label">
              <strong>{REGION_LABELS[region]}</strong>
              <small>
                {visible.regions[region].reportedGrainKt.toFixed(1)} kt reported
                {" · "}
                {visible.regions[region].weeklyDemandKt.toFixed(1)} kt base demand
              </small>
              <small>
                Active now: {visible.regions[region].activeRation}
                {visible.pendingRationPolicy
                  ? ` · queued for W${visible.pendingRationPolicy.effectiveTurn}: ${visible.pendingRationPolicy.levels[region]}`
                  : ""}
              </small>
            </span>
            <div className="radio-cards">
              {levels.map((level) => (
                <label className="radio-card" key={level}>
                  <input
                    type="radio"
                    name={`ration-${region}`}
                    value={level}
                    checked={decision.rationPolicy[region] === level}
                    onChange={() =>
                      onChange({
                        ...decision,
                        rationPolicy: {
                          ...decision.rationPolicy,
                          [region]: level,
                        },
                      })
                    }
                  />
                  <span>{level}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <ul className="book-action__preview">
        {regions.map((region) => {
          const level = decision.rationPolicy[region];
          const pendingAtStart =
            visible.pendingRationPolicy &&
            visible.pendingRationPolicy.effectiveTurn <= decision.forTurn
              ? visible.pendingRationPolicy
              : null;
          const startLevel =
            pendingAtStart?.levels[region] ??
            visible.regions[region].activeRation;
          const changed = level !== startLevel;
          return (
            <li key={region}>
              {REGION_LABELS[region]}: {level} means{" "}
              {(RATION_DEMAND_MULTIPLIER[level] * 100).toFixed(0)}% of base
              demand and +{RATION_HARDSHIP_POINTS[level].toFixed(1)} hardship
              points per active week
              {changed
                ? `; this new change claims a team and becomes effective W${decision.forTurn + 1}`
                : pendingAtStart &&
                    startLevel !== visible.regions[region].activeRation
                  ? `; already queued for W${pendingAtStart.effectiveTurn}, with no new change`
                  : "; holds the opening band"}.
            </li>
          );
        })}
        <li>
          A newly changed package claims one team. It does not affect consumption
          in the committed operating week; it becomes active one week later.
        </li>
      </ul>
    </>
  );
}

function CopperForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const offerAvailable = visible.earlyPaymentOffer.status === "available";
  const mineRailCap = Math.min(
    decision.copperPlan.mineTargetKt,
    decision.railAndTruck.railCopperKt,
  );
  const copperBeforeLoadingCeiling =
    visible.operations.copperAtPortKt + mineRailCap;
  const obligation = visible.earlyPaymentObligation;
  return (
    <>
      <div className="known-quantity-grid">
        <KnownQuantity
          label="Copper at port now"
          value={`${visible.operations.copperAtPortKt.toFixed(1)} kt`}
          detail="Measured; no rail needed to load this stock"
        />
        <KnownQuantity
          label="Mine / rail ceiling"
          value={`${mineRailCap.toFixed(1)} kt`}
          detail={`${decision.copperPlan.mineTargetKt.toFixed(1)} kt target vs ${decision.railAndTruck.railCopperKt.toFixed(1)} kt rail`}
          tone={
            decision.railAndTruck.railCopperKt <
            decision.copperPlan.mineTargetKt
              ? "warning"
              : "measured"
          }
        />
        <KnownQuantity
          label="Copper before loading"
          value={`up to ${copperBeforeLoadingCeiling.toFixed(1)} kt`}
          detail="Before the remaining-diesel constraint"
        />
        <KnownQuantity
          label="Ordinary export rate"
          value={`${formatUsd(COPPER_RECEIPT_CENTS_PER_KT, true)} / kt`}
          detail="Only cargo actually loaded earns cash"
        />
      </div>
      <label className="field-label">
        Mine output target
        <span className="field-label__hint">
          0–5 kt; output needs diesel and rail before it can earn FX
        </span>
        <input
          className="range range--copper"
          type="range"
          min="0"
          max="5"
          step="0.5"
          value={decision.copperPlan.mineTargetKt}
          onChange={(event) =>
            onChange({
              ...decision,
              copperPlan: {
                ...decision.copperPlan,
                mineTargetKt: numericValue(event.target.value),
              },
            })
          }
        />
        <output>{decision.copperPlan.mineTargetKt.toFixed(1)} kt</output>
      </label>
      <label className="radio-card">
        <input
          type="checkbox"
          checked={decision.copperPlan.acceptEarlyPayment}
          disabled={!offerAvailable}
          onChange={(event) =>
            onChange({
              ...decision,
              copperPlan: {
                ...decision.copperPlan,
                acceptEarlyPayment: event.target.checked,
              },
            })
          }
        />
        <span>
          {offerAvailable
            ? "Accept buyer’s early-payment offer"
            : "No early-payment offer currently available"}
        </span>
      </label>
      <ul className="book-action__preview">
        <li>
          Target uses roughly {(decision.copperPlan.mineTargetKt * 0.16).toFixed(2)} kt
          diesel before rail and export capacity.
        </li>
        <li>
          Export receipts settle only for cargo actually loaded through the port.
          Same-week mine output is available to load after production.
        </li>
        {offerAvailable ? (
          <li>
            Offer terms: {formatUsd(EARLY_PAYMENT_ADVANCE_CENTS, true)} now
            against {EARLY_PAYMENT_CARGO_KT} kt due two turns after acceptance.
            Default claws back the unearned advance and adds{" "}
            {formatUsd(EARLY_PAYMENT_PENALTY_CENTS, true)}.
          </li>
        ) : null}
        {obligation ? (
          <li>
            Active obligation: {obligation.remainingKt.toFixed(1)} kt remains
            due in W{obligation.dueTurn}; exports service it before earning new
            cash.
          </li>
        ) : null}
      </ul>
    </>
  );
}

function RepairForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const intensities: RepairIntensity[] = ["none", "normal", "accelerated", "emergency"];
  const selected = REPAIR_ASSUMPTIONS[decision.repairIntensity];
  const equipmentAllocated = decision.portSchedule.repairEquipmentKt;
  const knownEfficiency = visible.operations.knownPortRepairEfficiency;
  const portClosed =
    visible.operations.knownPortClosureTurn === decision.forTurn;
  const inputFraction =
    selected.equipmentKt > 0
      ? portClosed
        ? 0
        : Math.min(1, equipmentAllocated / selected.equipmentKt)
      : 1;
  const equipmentLimitedProgress = selected.progressPct * inputFraction;
  const knownProgress =
    knownEfficiency === null
      ? null
      : equipmentLimitedProgress * knownEfficiency;
  return (
    <>
      <div className="known-quantity-grid">
        <KnownQuantity
          label="Equipment handling"
          value={`${equipmentAllocated.toFixed(1)} / ${selected.equipmentKt.toFixed(1)} kt`}
          detail="Staged offshore; this is port throughput, not stock"
          tone={
            equipmentAllocated + 1e-6 < selected.equipmentKt
              ? "warning"
              : "measured"
          }
        />
        <KnownQuantity
          label="Repair diesel"
          value={`${selected.dieselKt.toFixed(2)} kt requested`}
          detail={`${visible.headline.dieselKt.toFixed(1)} kt in stock before weekly inflows and prior uses`}
        />
        <KnownQuantity
          label="Team claim"
          value={`${selected.teams} / ${visible.headline.implementationTeamsAvailable}`}
          detail="Selected / available for this package"
          tone={
            selected.teams > visible.headline.implementationTeamsAvailable
              ? "warning"
              : "measured"
          }
        />
        <KnownQuantity
          label="Progress"
          value={
            portClosed
              ? "0.0 pp"
              : knownProgress === null
                ? `up to ${equipmentLimitedProgress.toFixed(1)} pp`
                : `up to ${knownProgress.toFixed(1)} pp`
          }
          detail={
            portClosed
              ? `Forecast closure blocks equipment handling in W${decision.forTurn}`
              : knownEfficiency === null
                ? "Before unaudited site efficiency and remaining-diesel limits"
                : `At known efficiency ${knownEfficiency.toFixed(2)}; remaining diesel can still reduce progress`
          }
          tone={
            portClosed || equipmentAllocated + 1e-6 < selected.equipmentKt
              ? "warning"
              : knownEfficiency === null
                ? "uncertain"
                : "measured"
          }
        />
      </div>
      <div className="radio-cards">
        {intensities.map((intensity) => (
          <label className="radio-card" key={intensity}>
            <input
              type="radio"
              name="repair-intensity"
              value={intensity}
              checked={decision.repairIntensity === intensity}
              onChange={() => onChange({ ...decision, repairIntensity: intensity })}
            />
            <span>{intensity}</span>
          </label>
        ))}
      </div>
      {(() => {
        const assumptions = REPAIR_ASSUMPTIONS[decision.repairIntensity];
        return (
          <ul className="book-action__preview">
            <li>
              Reserves {formatUsd(assumptions.costCents, true)} and{" "}
              {assumptions.teams} implementation team
              {assumptions.teams === 1 ? "" : "s"}.
            </li>
            <li>
              Needs {assumptions.equipmentKt.toFixed(1)} kt equipment through the port
              and {assumptions.dieselKt.toFixed(2)} kt diesel.
            </li>
            <li>
              Direct engineering plan: up to {assumptions.progressPct} percentage points
              before scenario-specific efficiency.
            </li>
            <li>
              Cost and teams are committed even if the equipment allocation or
              remaining diesel is short. A capacity threshold reached this week
              changes throughput from the following week.
            </li>
          </ul>
        );
      })()}
    </>
  );
}

function AuditForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const audits: Array<{ value: AuditKind; label: string }> = [
    { value: "none", label: "No information action" },
    { value: "capital-stock", label: "Audit Capital stock" },
    { value: "north-stock", label: "Audit Northern stock" },
    { value: "interior-stock", label: "Audit Interior stock" },
    { value: "crop", label: "Commission crop reassessment" },
    { value: "port-damage", label: "Inspect port damage" },
  ];
  const reveal =
    decision.audit === "none"
      ? "No new report"
      : decision.audit.endsWith("-stock")
        ? "Precise point stock for the selected region"
        : decision.audit === "crop"
          ? "Point-in-time weekly crop output reassessment"
          : "Port repair site-efficiency assessment";
  const pendingAudits = visible.activeActions.filter(
    (action) => action.family === "audit",
  );
  return (
    <>
      <div className="known-quantity-grid">
        <KnownQuantity
          label="Delivery"
          value={
            decision.audit === "none"
              ? "No commission"
              : `Week ${decision.forTurn + 1}`
          }
          detail="One weekly step after this operating package"
          tone={decision.audit === "none" ? "measured" : "reported"}
        />
        <KnownQuantity
          label="Team claim"
          value={decision.audit === "none" ? "0" : "1"}
          detail={`${visible.headline.implementationTeamsAvailable} available for this package`}
        />
        <KnownQuantity
          label="Report content"
          value={reveal}
          detail="A point observation, not permanent telemetry"
        />
        <KnownQuantity
          label="Already in flight"
          value={`${pendingAudits.length}`}
          detail={
            pendingAudits.at(-1)
              ? `Latest due W${pendingAudits.at(-1)?.effectiveTurn}`
              : "No pending targeted inquiry"
          }
        />
      </div>
      <label className="field-label">
        Targeted inquiry
        <select
          className="select"
          value={decision.audit}
          onChange={(event) =>
            onChange({ ...decision, audit: event.target.value as AuditKind })
          }
        >
          {audits.map((audit) => (
            <option value={audit.value} key={audit.value}>
              {audit.label}
            </option>
          ))}
        </select>
      </label>
      <ul className="book-action__preview">
        <li>Claims one implementation team when commissioned.</li>
        <li>
          Produces its precise point-in-time report in W{decision.forTurn + 1};
          it does not reveal hidden state instantly or permanently.
        </li>
      </ul>
    </>
  );
}

function CreditForm({
  visible,
  decision,
  onChange,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const remainingUsdM =
    visible.finance.creditRemainingCents / 100_000_000;
  const maximumDraw = Math.max(0, Math.min(4, remainingUsdM));
  const principalAfter =
    visible.finance.creditPrincipalCents +
    decision.emergencyCreditUsdM * 100_000_000;
  const weeklyInterest = Math.round(
    principalAfter * WEEKLY_CREDIT_INTEREST_RATE,
  );
  return (
    <>
      <div className="known-quantity-grid">
        <KnownQuantity
          label="Principal now"
          value={formatUsd(visible.finance.creditPrincipalCents, true)}
          detail="No principal-repayment action in this scenario"
        />
        <KnownQuantity
          label="Facility remaining"
          value={formatUsd(visible.finance.creditRemainingCents, true)}
          detail={`${formatUsd(visible.finance.creditLimitCents, true)} total line`}
        />
        <KnownQuantity
          label="Interest after draft"
          value={`${formatUsd(weeklyInterest, true)} / week`}
          detail={`${(WEEKLY_CREDIT_INTEREST_RATE * 100).toFixed(1)}% of total principal`}
          tone={principalAfter > 0 ? "warning" : "measured"}
        />
        <KnownQuantity
          label="Other liabilities"
          value={formatUsd(
            visible.finance.contractAdvanceLiabilityCents +
              visible.finance.arrearsCents,
            true,
          )}
          detail={`${formatUsd(visible.finance.arrearsCents, true)} arrears`}
          tone={
            visible.finance.contractAdvanceLiabilityCents +
                visible.finance.arrearsCents >
              0
              ? "warning"
              : "measured"
          }
        />
      </div>
      <label className="field-label">
        Credit draw
        <span className="field-label__hint">
          Up to {formatUsd(maximumDraw * 100_000_000, true)} this week in
          $0.5m steps
        </span>
        <input
          className="field"
          type="number"
          min="0"
          max={maximumDraw}
          step="0.5"
          value={decision.emergencyCreditUsdM}
          onChange={(event) =>
            onChange({
              ...decision,
              emergencyCreditUsdM: numericValue(event.target.value),
            })
          }
        />
      </label>
      <ul className="book-action__preview">
        <li>Adds liquidity immediately and claims one implementation team.</li>
        <li>
          Charges {(WEEKLY_CREDIT_INTEREST_RATE * 100).toFixed(1)}% of all
          outstanding principal every week and weakens the end-state reserve
          evaluation.
        </li>
      </ul>
    </>
  );
}

function ActionForm({
  family,
  visible,
  decision,
  onChange,
}: {
  family: ActionFamily;
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  if (family === "imports") {
    return (
      <ImportsForm
        visible={visible}
        decision={decision}
        onChange={onChange}
      />
    );
  }
  if (family === "portSchedule") {
    return <PortForm visible={visible} decision={decision} onChange={onChange} />;
  }
  if (family === "railAndTruck") {
    return <RailForm visible={visible} decision={decision} onChange={onChange} />;
  }
  if (family === "rationPolicy") {
    return (
      <RationForm
        visible={visible}
        decision={decision}
        onChange={onChange}
      />
    );
  }
  if (family === "copperPlan") {
    return <CopperForm visible={visible} decision={decision} onChange={onChange} />;
  }
  if (family === "repairIntensity") {
    return (
      <RepairForm
        visible={visible}
        decision={decision}
        onChange={onChange}
      />
    );
  }
  if (family === "audit") {
    return (
      <AuditForm
        visible={visible}
        decision={decision}
        onChange={onChange}
      />
    );
  }
  return (
    <CreditForm
      visible={visible}
      decision={decision}
      onChange={onChange}
    />
  );
}

export function DecisionBook({
  visible,
  decision,
  validation,
  open,
  requestedSection,
  onChange,
  onReview,
  onOpenMechanics,
  onClose,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  validation: ValidationResult;
  open: boolean;
  requestedSection: string | null;
  onChange: (decision: DecisionPackage) => void;
  onReview: () => void;
  onOpenMechanics: () => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<ActionFamily | null>("imports");
  useEffect(() => {
    if (requestedSection && SECTION_ORDER.includes(requestedSection as ActionFamily)) {
      setExpanded(requestedSection as ActionFamily);
    }
  }, [requestedSection]);

  const forecastsComplete =
    decision.forecasts.grainCoverageWeeks !== null &&
    decision.forecasts.fxUsdM !== null &&
    decision.forecasts.bindingConstraint !== null;
  const rationaleComplete = decision.notes.trim().length >= 3;
  const configured = useMemo(
    () => SECTION_ORDER.filter((family) => isConfigured(family, decision)).length,
    [decision],
  );
  const preview = validation.preview;
  const implementationTeamsTotal =
    preview.adminTeamsAlreadyCommitted + preview.adminTeamsAvailable;

  return (
    <aside className="decision-book" data-open={open} aria-label="Decision Book">
      <header className="decision-book__header">
        <div className="decision-book__title">
          <span className="decision-book__title-icon">
            <Icon name="briefcase" />
          </span>
          <span>
            <strong>Decision Book</strong>
            <span>Draft package · week {decision.forTurn}</span>
          </span>
        </div>
        <div className="decision-book__header-actions">
          <button
            className="text-button decision-book__rules"
            type="button"
            onClick={onOpenMechanics}
          >
            <Icon name="info" />
            Rules
          </button>
          <button
            className="icon-button decision-book__mobile-close"
            type="button"
            onClick={onClose}
            aria-label="Close Decision Book"
          >
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div className="decision-book__scroll">
        <div className="book-summary">
          <div
            className={`book-summary__item ${
              preview.projectedFxAfterDirectCommitmentsCents <
              visible.headline.emergencyFloorCents
                ? "book-summary__item--watch"
                : ""
            }`}
          >
            <span>FX after direct claims</span>
            <strong>{formatUsd(preview.projectedFxAfterDirectCommitmentsCents, true)}</strong>
          </div>
          <div
            className={`book-summary__item ${
              preview.adminTeamsAlreadyCommitted + preview.adminTeamsClaimed >
              implementationTeamsTotal
                ? "book-summary__item--watch"
                : ""
            }`}
          >
            <span>Teams claimed</span>
            <strong>
              {preview.adminTeamsAlreadyCommitted + preview.adminTeamsClaimed} /{" "}
              {implementationTeamsTotal}
            </strong>
          </div>
        </div>

        <div className="book-sections">
          {SECTION_ORDER.map((family, index) => {
            const unlocked = visible.availableActions.includes(family);
            const isOpen = expanded === family;
            return (
              <section
                className={`book-action ${
                  !unlocked ? "book-action--locked" : ""
                } ${isConfigured(family, decision) ? "book-action--configured" : ""}`}
                key={family}
              >
                <button
                  className="book-action__toggle"
                  type="button"
                  aria-expanded={isOpen}
                  disabled={!unlocked}
                  onClick={() => setExpanded(isOpen ? null : family)}
                >
                  <span className="book-action__number">
                    {unlocked ? index + 1 : "—"}
                  </span>
                  <span className="book-action__title">
                    <strong>{ACTION_LABELS[family]}</strong>
                    <span>
                      {unlocked
                        ? ACTION_SUMMARIES[family]
                        : `Locked in guided phase · available after week ${
                            family === "portSchedule" || family === "copperPlan"
                              ? 2
                              : family === "railAndTruck" || family === "rationPolicy"
                                ? 4
                                : 6
                          }`}
                    </span>
                  </span>
                  <Icon name="chevron" />
                </button>
                {isOpen && unlocked ? (
                  <>
                    <div className="book-action__body">
                      <ActionForm
                        family={family}
                        visible={visible}
                        decision={decision}
                        onChange={onChange}
                      />
                    </div>
                    <SectionIssues family={family} validation={validation} />
                  </>
                ) : null}
              </section>
            );
          })}
        </div>

        <section className="book-forecast" aria-labelledby="forecast-heading">
          <div className="book-forecast__header">
            <strong id="forecast-heading">Forecast &amp; rationale</strong>
            <span>{forecastsComplete && rationaleComplete ? "Complete" : "Required to commit"}</span>
          </div>
          <div className="form-grid">
            <label className="field-label">
              Grain coverage next week
              <span className="field-label__hint">
                Your estimate of closing reported national coverage, weeks
              </span>
              <input
                className="field"
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={decision.forecasts.grainCoverageWeeks ?? ""}
                onChange={(event) =>
                  onChange({
                    ...decision,
                    forecasts: {
                      ...decision.forecasts,
                      grainCoverageWeeks:
                        event.target.value === "" ? null : numericValue(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field-label">
              FX next week
              <span className="field-label__hint">
                Your estimate of closing settled reserves, $m
              </span>
              <input
                className="field"
                type="number"
                min="-20"
                max="100"
                step="0.1"
                value={decision.forecasts.fxUsdM ?? ""}
                onChange={(event) =>
                  onChange({
                    ...decision,
                    forecasts: {
                      ...decision.forecasts,
                      fxUsdM:
                        event.target.value === "" ? null : numericValue(event.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
          <label className="field-label">
            Expected binding constraint
            <span className="field-label__hint">
              Primary limiter you expect to reduce requested realization
            </span>
            <select
              className="select"
              value={decision.forecasts.bindingConstraint ?? ""}
              onChange={(event) =>
                onChange({
                  ...decision,
                  forecasts: {
                    ...decision.forecasts,
                    bindingConstraint: event.target.value as BindingConstraint,
                  },
                })
              }
            >
              <option value="" disabled>
                Select your diagnosis
              </option>
              {BINDING_OPTIONS.map((constraint) => (
                <option value={constraint} key={constraint}>
                  {constraint.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Minister&apos;s note
            <span className="field-label__hint">
              Record the diagnosis behind this package for the debrief
            </span>
            <textarea
              className="textarea"
              maxLength={4000}
              value={decision.notes}
              onChange={(event) => onChange({ ...decision, notes: event.target.value })}
              placeholder="I expect… because…"
            />
          </label>
        </section>

        {validation.errors.length ? (
          <div className="validation-box validation-box--error">
            {validation.errors.slice(0, 4).map((item, index) => (
              <span className="validation-issue" key={`${item.code}-${index}`}>
                <Icon name="alert" />
                <span>{item.message}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="decision-book__footer">
        <button
          className="button button--primary"
          type="button"
          disabled={!validation.valid || !forecastsComplete || !rationaleComplete}
          onClick={onReview}
        >
          Review &amp; commit package
          <Icon name="arrow" />
        </button>
        <div className="decision-book__footer-note">
          <span>
            {!forecastsComplete
              ? "Complete all three forecasts"
              : !rationaleComplete
                ? "Add a brief rationale"
                : validation.errors.length
                  ? "Resolve package conflicts"
                  : "Commit is immutable on this branch"}
          </span>
          <span>{configured} / 8 configured</span>
        </div>
      </footer>
    </aside>
  );
}
