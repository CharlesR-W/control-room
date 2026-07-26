"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ACTION_LABELS,
  IMPORT_LEAD_TURNS,
  REGION_LABELS,
  REPAIR_ASSUMPTIONS,
} from "@/lib/sim/constants";
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
  decision,
  onChange,
}: {
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
            return (
              <li key={`${order.cargo}-${index}`}>
                {order.quantityKt.toFixed(1)} kt {order.cargo} reserves FX on
                signing; expected arrival week {arrival}.
              </li>
            );
          })
        ) : (
          <li>No new foreign exchange or administrative claim.</li>
        )}
        <li>Arrival does not guarantee an unloading slot or usable stock.</li>
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
  return (
    <>
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
              step="0.5"
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
          </label>
        ))}
      </div>
      <div className="capacity-summary">
        <div>
          <div className="capacity-summary__copy">
            <span>Total weekly claim</span>
            <strong>
              {total.toFixed(1)} / {visible.headline.portCapacityKt.toFixed(0)} kt
            </strong>
          </div>
          <Meter
            value={total}
            max={visible.headline.portCapacityKt}
            label="Draft port capacity claim"
            tone={total > visible.headline.portCapacityKt ? "red" : "teal"}
          />
        </div>
        <StatusLabel tone={total > visible.headline.portCapacityKt ? "critical" : "stable"}>
          {total > visible.headline.portCapacityKt ? "Overbooked" : "Feasible"}
        </StatusLabel>
      </div>
      <ul className="book-action__preview">
        <li>Allocations are hard cargo caps for the coming week.</li>
        <li>Unused capacity is not silently reassigned between cargo classes.</li>
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
  return (
    <>
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
            max={3}
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
        <li>Rail grain and copper share a {visible.headline.railCapacityKt.toFixed(0)} kt ceiling.</li>
        <li>
          Trucking delivers immediately but consumes about{" "}
          {(decision.railAndTruck.truckGrainKt * 0.28).toFixed(2)} kt diesel.
        </li>
      </ul>
    </>
  );
}

function RationForm({
  decision,
  onChange,
}: {
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
            <span>{REGION_LABELS[region]}</span>
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
        <li>Policy changes claim one implementation team and take one week.</li>
        <li>Stricter rationing lowers demand but increases hardship and non-compliance.</li>
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
  return (
    <>
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
        <li>Export receipts settle only for cargo actually loaded through the port.</li>
      </ul>
    </>
  );
}

function RepairForm({
  decision,
  onChange,
}: {
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  const intensities: RepairIntensity[] = ["none", "normal", "accelerated", "emergency"];
  return (
    <>
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
          </ul>
        );
      })()}
    </>
  );
}

function AuditForm({
  decision,
  onChange,
}: {
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
  return (
    <>
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
        <li>Produces a future dated report; it does not reveal hidden state instantly.</li>
      </ul>
    </>
  );
}

function CreditForm({
  decision,
  onChange,
}: {
  decision: DecisionPackage;
  onChange: (decision: DecisionPackage) => void;
}) {
  return (
    <>
      <label className="field-label">
        Credit draw
        <span className="field-label__hint">
          Up to $4m this week; the remaining facility is validated before commitment
        </span>
        <input
          className="field"
          type="number"
          min="0"
          max={4}
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
        <li>Creates weekly interest and weakens the end-state reserve evaluation.</li>
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
    return <ImportsForm decision={decision} onChange={onChange} />;
  }
  if (family === "portSchedule") {
    return <PortForm visible={visible} decision={decision} onChange={onChange} />;
  }
  if (family === "railAndTruck") {
    return <RailForm visible={visible} decision={decision} onChange={onChange} />;
  }
  if (family === "rationPolicy") {
    return <RationForm decision={decision} onChange={onChange} />;
  }
  if (family === "copperPlan") {
    return <CopperForm visible={visible} decision={decision} onChange={onChange} />;
  }
  if (family === "repairIntensity") {
    return <RepairForm decision={decision} onChange={onChange} />;
  }
  if (family === "audit") {
    return <AuditForm decision={decision} onChange={onChange} />;
  }
  return <CreditForm decision={decision} onChange={onChange} />;
}

export function DecisionBook({
  visible,
  decision,
  validation,
  open,
  requestedSection,
  onChange,
  onReview,
  onClose,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  validation: ValidationResult;
  open: boolean;
  requestedSection: string | null;
  onChange: (decision: DecisionPackage) => void;
  onReview: () => void;
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
        <button
          className="icon-button decision-book__mobile-close"
          type="button"
          onClick={onClose}
          aria-label="Close Decision Book"
        >
          <Icon name="close" />
        </button>
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
              <span className="field-label__hint">Your estimate, weeks</span>
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
              <span className="field-label__hint">Your estimate, $m</span>
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
