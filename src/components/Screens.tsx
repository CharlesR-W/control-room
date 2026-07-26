"use client";

import type {
  Contribution,
  DecisionPackage,
  ObservationReport,
  SimulationRun,
  VisibleSnapshot,
} from "@/lib/sim/types";
import { branchRun, getVisibleSnapshot } from "@/lib/sim";
import { REGION_WEEKLY_DEMAND_KT } from "@/lib/sim/constants";
import { Icon } from "./Icons";
import {
  EmptyState,
  formatDate,
  formatUsd,
  PageHeader,
  Panel,
  StatusLabel,
  statusFromCoverage,
  statusFromObjective,
} from "./Panels";
import {
  ConstraintMatrix,
  Meter,
  RingGauge,
  Sparkline,
  SystemMap,
  Waterfall,
  type NetworkValues,
  type Tone,
} from "./Visuals";

export type ViewId =
  | "situation"
  | "supply"
  | "transport"
  | "finance"
  | "repair"
  | "reports"
  | "timeline";

function shipmentArrivalLabel(
  shipment: VisibleSnapshot["shipments"][number],
): string {
  if (shipment.arrivalTurn !== null) {
    return `W${shipment.arrivalTurn}`;
  }
  const { earliestTurn, latestTurn } = shipment.expectedArrivalWindow;
  return earliestTurn === latestTurn
    ? `W${earliestTurn}`
    : `W${earliestTurn}–W${latestTurn}`;
}

export type MetricInspection = {
  id: string;
  label: string;
  value: string;
  unit: string;
  definition: string;
  source: string;
  asOf: string;
  status: string;
  history: number[];
  traces: Contribution[];
};

export type ScreenProps = {
  run: SimulationRun;
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onInspect: (inspection: MetricInspection) => void;
  onOpenReport: (report: ObservationReport) => void;
  onOpenTrace: (title: string, traces: Contribution[]) => void;
  onNavigate: (view: ViewId) => void;
  onBranch: (turn: number) => void;
  onOpenBook: (section?: string) => void;
};

function historySeries(
  run: SimulationRun,
  field: "grain" | "diesel" | "fx" | "repair",
): number[] {
  const snapshots = Array.from({ length: run.history.length + 1 }, (_, turn) =>
    getVisibleSnapshot(branchRun(run, turn)),
  );
  return snapshots.map((snapshot) => {
    if (field === "grain") return snapshot.headline.reportedGrainKt;
    if (field === "diesel") return snapshot.headline.dieselKt;
    if (field === "fx") return snapshot.headline.fxCents / 100_000_000;
    return snapshot.headline.portRepairProgressPct;
  });
}

function safeSnapshotAt(run: SimulationRun, turn: number) {
  return getVisibleSnapshot(branchRun(run, turn));
}

function coverageClass(weeks: number) {
  const status = statusFromCoverage(weeks);
  return status === "stable"
    ? "coverage-cell"
    : `coverage-cell coverage-cell--${status}`;
}

function valueTone(status: "stable" | "watch" | "critical" | "info"): Tone {
  return status === "stable"
    ? "teal"
    : status === "watch"
      ? "amber"
      : status === "critical"
        ? "red"
        : "blue";
}

function metricTraces(visible: VisibleSnapshot, patterns: string[]) {
  return visible.latestTrace.filter((trace) =>
    patterns.some(
      (pattern) =>
        trace.target.toLowerCase().includes(pattern) ||
        trace.mechanism.toLowerCase().includes(pattern),
    ),
  );
}

function GuidedCue({ turn }: { turn: number }) {
  const phase =
    turn < 2
      ? {
          title: "Phase 1 · Stocks and pipelines",
          copy: "Inspect coverage and the opening shipments. Place an import order before the visible shortage arrives.",
        }
      : turn < 4
        ? {
            title: "Phase 2 · Shared port capacity",
            copy: "Port scheduling and copper exports are now available. A contract at sea still needs an unloading slot.",
          }
        : turn < 6
          ? {
              title: "Phase 3 · Regional distribution",
              copy: "The transport desk is unlocked. Find the binding route before using diesel-intensive emergency trucks.",
            }
          : turn < 9
            ? {
                title: "Phase 4 · Repair and uncertainty",
                copy: "Repair and audits are available. Information has value only while there is still time to act on it.",
              }
            : {
                title: "Phase 5 · Independent stabilization",
                copy: "Guidance is withdrawn. Build a resilient final reserve and repair plan, not merely a turn-12 rescue.",
              };

  return (
    <aside className="guided-cue" aria-label="Guided tutorial cue">
      <span className="guided-cue__icon">
        <Icon name="info" />
      </span>
      <span className="guided-cue__copy">
        <strong>{phase.title}</strong>
        <span>{phase.copy}</span>
      </span>
      <StatusLabel tone="info">Desk note</StatusLabel>
    </aside>
  );
}

export function SituationScreen(props: ScreenProps) {
  const { run, visible, onInspect, onOpenTrace, onNavigate } = props;
  const grainStatus = statusFromCoverage(visible.headline.reportedGrainCoverageWeeks);
  const dieselStatus = statusFromCoverage(visible.headline.dieselCoverageWeeks);
  const fxStatus =
    visible.headline.fxCents < visible.headline.emergencyFloorCents
      ? "critical"
      : visible.headline.fxCents < visible.headline.emergencyFloorCents * 1.25
        ? "watch"
        : "stable";
  const repairStatus =
    visible.headline.portRepairProgressPct >= 80
      ? "stable"
      : visible.turn >= 9 && visible.headline.portRepairProgressPct < 40
        ? "critical"
        : "watch";
  const engineeringReport = [...visible.reports]
    .reverse()
    .find((report) => report.kind === "port-engineering");

  const inspections: Record<string, MetricInspection> = {
    grain: {
      id: "reports.grain.coverage",
      label: "Reported grain coverage",
      value: visible.headline.reportedGrainCoverageWeeks.toFixed(1),
      unit: "weeks",
      definition:
        "Reported national edible grain divided by current weekly demand. Regional shortages can occur before this national measure reaches zero.",
      source: "Central depot ledger and provincial supply returns",
      asOf: visible.simulatedDate,
      status: "Institutional estimate · latest provincial returns",
      history: historySeries(run, "grain"),
      traces: metricTraces(visible, ["grain"]),
    },
    diesel: {
      id: "supply.diesel.coverage",
      label: "Diesel coverage",
      value: visible.headline.dieselCoverageWeeks.toFixed(1),
      unit: "weeks",
      definition:
        "Physical diesel stock divided by normal weekly use. Trucking, mine output, and repair intensity change actual drawdown.",
      source: "National Fuel Board tank ledger",
      asOf: visible.simulatedDate,
      status: "Measured operational stock",
      history: historySeries(run, "diesel"),
      traces: metricTraces(visible, ["diesel"]),
    },
    fx: {
      id: "finance.fx.reserves",
      label: "Foreign-exchange reserves",
      value: formatUsd(visible.headline.fxCents, true),
      unit: "USD",
      definition:
        "Settled foreign-exchange balance. Import contracts and repair are paid on signing; copper earns receipts when exported.",
      source: "Treasury foreign-exchange ledger",
      asOf: visible.simulatedDate,
      status: "Reconciled ledger balance",
      history: historySeries(run, "fx"),
      traces: metricTraces(visible, ["foreign", "ledger", "import", "export"]),
    },
    repair: {
      id: "operations.port.repair",
      label: "Port repair progress",
      value: visible.headline.portRepairProgressPct.toFixed(0),
      unit: "%",
      definition:
        "Cumulative engineering work completed. Throughput rises discretely at 40% and 80%, conditional on equipment and teams.",
      source: "Port engineering office",
      asOf: visible.simulatedDate,
      status:
        !engineeringReport
          ? "Efficiency not yet audited"
          : "Engineering efficiency assessed",
      history: historySeries(run, "repair"),
      traces: metricTraces(visible, ["repair", "port"]),
    },
  };

  return (
    <>
      <PageHeader
        eyebrow={`Situation report / Week ${visible.turn + 1}`}
        title="National supply position"
        description="Guardrails are ordered by mandate priority. Values below are the latest institutional estimates available at your desk."
        actions={
          <button className="button button--small" type="button" onClick={() => onNavigate("reports")}>
            <Icon name="reports" />
            <span>Open reports</span>
          </button>
        }
      />

      {visible.mode === "guided" ? <GuidedCue turn={visible.turn} /> : null}

      <div className="kpi-grid">
        {[
          {
            key: "grain",
            label: "Reported grain coverage",
            value: visible.headline.reportedGrainCoverageWeeks.toFixed(1),
            unit: "weeks",
            context: `${visible.headline.reportedGrainKt.toFixed(1)} kt reported nationally`,
            status: grainStatus,
            history: historySeries(run, "grain"),
          },
          {
            key: "diesel",
            label: "Diesel coverage",
            value: visible.headline.dieselCoverageWeeks.toFixed(1),
            unit: "weeks",
            context: `${visible.headline.dieselKt.toFixed(1)} kt operational stock`,
            status: dieselStatus,
            history: historySeries(run, "diesel"),
          },
          {
            key: "fx",
            label: "Foreign exchange",
            value: formatUsd(visible.headline.fxCents, true),
            unit: "settled",
            context: `${formatUsd(visible.headline.emergencyFloorCents, true)} emergency floor`,
            status: fxStatus,
            history: historySeries(run, "fx"),
          },
          {
            key: "repair",
            label: "Port repair",
            value: visible.headline.portRepairProgressPct.toFixed(0),
            unit: "%",
            context: `${visible.headline.portCapacityKt.toFixed(0)} kt weekly throughput`,
            status: repairStatus,
            history: historySeries(run, "repair"),
          },
        ].map((metric) => (
          <article className={`kpi-card kpi-card--${metric.status}`} key={metric.key}>
            <div className="kpi-card__main">
              <div className="kpi-card__label">
                <span>{metric.label}</span>
                <button type="button" onClick={() => onInspect(inspections[metric.key])}>
                  <Icon name="info" />
                  <span className="sr-only">Inspect {metric.label}</span>
                </button>
              </div>
              <div className="kpi-card__value">
                <strong>{metric.value}</strong>
                <span>{metric.unit}</span>
              </div>
              <div className="kpi-card__context">{metric.context}</div>
            </div>
            <Sparkline
              values={metric.history}
              label={`${metric.label} history`}
              tone={valueTone(
                metric.status as "stable" | "watch" | "critical" | "info",
              )}
            />
          </article>
        ))}
      </div>

      <div className="grid grid--wide">
        <Panel
          title="Mandate dashboard"
          subtitle="A vector of guardrails, not a composite score"
          flush
        >
          <div className="mandate-dashboard">
            {visible.objectives.map((objective) => (
              <div className="mandate-row" key={objective.id}>
                <span className="mandate-row__rank">{objective.priority}</span>
                <span className="mandate-row__copy">
                  <strong>{objective.label}</strong>
                  <span>
                    {objective.value.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{" "}
                    {objective.unit}
                  </span>
                </span>
                <StatusLabel tone={statusFromObjective(objective.status)}>
                  {objective.status}
                </StatusLabel>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Priority desk alerts"
          subtitle={`${visible.alerts.length} unresolved`}
          flush
        >
          {visible.alerts.length ? (
            <div className="alert-stack">
              {visible.alerts.slice(0, 5).map((alert) => (
                <div className={`alert-item alert-item--${alert.severity}`} key={alert.id}>
                  <span className="alert-item__icon">
                    <Icon name={alert.severity === "info" ? "info" : "alert"} />
                  </span>
                  <span className="alert-item__copy">
                    <strong>
                      {alert.severity === "critical"
                        ? "Mandate guardrail"
                        : alert.severity === "warning"
                          ? "Attention required"
                          : "Desk update"}
                    </strong>
                    <span>{alert.message}</span>
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => onOpenTrace("Latest causal trace", visible.latestTrace)}
                    aria-label={`Inspect cause of ${alert.message}`}
                  >
                    <Icon name="chevron" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No unresolved critical alerts">
              This does not mean the system has slack. Inspect coverage and upcoming
              commitments before advancing.
            </EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid grid--2" style={{ marginTop: 14 }}>
        <Panel
          title="Upcoming physical commitments"
          subtitle="Shipments occupy the pipeline before they become usable stock"
          tools={
            <button className="text-button" type="button" onClick={() => onNavigate("supply")}>
              Full pipeline
            </button>
          }
          flush
        >
          <div className="commitment-list">
            {visible.shipments
              .filter((shipment) => shipment.status !== "unloaded")
              .slice(0, 5)
              .map((shipment) => (
                <div className="commitment-row" key={shipment.id}>
                  <span className="commitment-row__turn">
                    <span>
                      <strong>{shipmentArrivalLabel(shipment)}</strong>
                    </span>
                  </span>
                  <span className="commitment-row__copy">
                    <strong>
                      {shipment.quantityKt.toFixed(1)} kt {shipment.cargo}
                    </strong>
                    <span>
                      {shipment.supplier === "opening-pipeline"
                        ? "Opening commitment"
                        : shipment.supplier.replaceAll("-", " ")}
                    </span>
                  </span>
                  <StatusLabel
                    tone={shipment.status === "queued-at-port" ? "watch" : "info"}
                  >
                    {shipment.status.replaceAll("-", " ")}
                  </StatusLabel>
                </div>
              ))}
          </div>
        </Panel>

        <Panel
          title="Latest outcome trace"
          subtitle="Visible direct contributors from the last completed week"
          tools={
            <button
              className="text-button"
              type="button"
              onClick={() => onOpenTrace("Latest causal trace", visible.latestTrace)}
            >
              Why?
            </button>
          }
          flush
        >
          {visible.latestTrace.length ? (
            <div className="trace-list" style={{ padding: 12 }}>
              {visible.latestTrace.slice(0, 3).map((trace) => (
                <div
                  className={`trace-item ${trace.amount < 0 ? "trace-item--negative" : ""}`}
                  key={trace.id}
                >
                  <span className="trace-item__marker" />
                  <span className="trace-item__copy">
                    <strong>{trace.mechanism}</strong>
                    <span>{trace.note}</span>
                  </span>
                  <strong className="trace-item__value">
                    {trace.amount > 0 ? "+" : ""}
                    {trace.amount.toFixed(1)} {trace.unit === "usd-cents" ? "¢" : trace.unit}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No completed turn yet">
              Commit your first package and advance one week to generate an auditable
              causal trace.
            </EmptyState>
          )}
        </Panel>
      </div>
    </>
  );
}

export function SupplyScreen(props: ScreenProps) {
  const { visible, onOpenBook, onOpenTrace } = props;
  const grainTrace = metricTraces(visible, ["grain"]);
  const dieselTrace = metricTraces(visible, ["diesel"]);
  const latestCropReport = [...visible.reports]
    .reverse()
    .find((report) => report.kind === "crop");
  const reportedDomesticOutput =
    typeof latestCropReport?.values.weeklyOutputKt === "number"
      ? latestCropReport.values.weeklyOutputKt
      : 3;

  function waterfallItems(
    closing: number,
    traces: Contribution[],
    fallbackInflow: number,
    fallbackOutflow: number,
  ) {
    const material = traces
      .filter((trace) => trace.unit === "kt" && Math.abs(trace.amount) > 0.001)
      .slice(0, 4);
    const contributions = material.length
      ? material
      : [
          {
            id: "fallback-in",
            mechanism: "Routine inflow",
            amount: fallbackInflow,
          },
          {
            id: "fallback-out",
            mechanism: "Routine use",
            amount: -fallbackOutflow,
          },
        ];
    const net = contributions.reduce((sum, trace) => sum + trace.amount, 0);
    return [
      { label: "Opening", value: Math.max(0, closing - net), kind: "opening" as const },
      ...contributions.map((trace) => ({
        label: trace.mechanism,
        value: trace.amount,
        kind: trace.amount < 0 ? ("outflow" as const) : ("inflow" as const),
      })),
      { label: "Closing", value: closing, kind: "closing" as const },
    ];
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations / Stocks & flows"
        title="Supply position"
        description="Separate what is in stock now from what has been ordered, arrived, unloaded, and distributed."
        actions={
          <button className="button button--primary button--small" type="button" onClick={() => onOpenBook("imports")}>
            Draft import order
          </button>
        }
      />

      <div className="grid grid--2">
        <Panel
          title="Reported grain accounting"
          subtitle="Opening + inflows − outflows = closing stock"
          tools={
            <button className="text-button" type="button" onClick={() => onOpenTrace("Grain contributors", grainTrace)}>
              Why?
            </button>
          }
          flush
        >
          <Waterfall
            label="Reported national grain stock accounting"
            unit="kt"
            items={waterfallItems(
              visible.headline.reportedGrainKt,
              grainTrace,
              reportedDomesticOutput,
              7,
            )}
          />
        </Panel>

        <Panel
          title="Diesel accounting"
          subtitle="Physical tank ledger; emergency use appears immediately"
          tools={
            <button className="text-button" type="button" onClick={() => onOpenTrace("Diesel contributors", dieselTrace)}>
              Why?
            </button>
          }
          flush
        >
          <Waterfall
            label="Diesel stock accounting"
            unit="kt"
            items={waterfallItems(visible.headline.dieselKt, dieselTrace, 1, 3)}
          />
        </Panel>
      </div>

      <Panel
        title="Import pipeline"
        subtitle="A signed contract is neither an arrival nor available stock"
        tools={<StatusLabel tone="info">{visible.shipments.length} consignments</StatusLabel>}
        flush
        className="panel--raised"
      >
        <div className="pipeline">
          <div className="pipeline__axis" aria-hidden="true">
            <span />
            <span>Ordered</span>
            <span>Sailing</span>
            <span>Arrived</span>
            <span>Unloaded</span>
            <span>Available</span>
          </div>
          {visible.shipments.map((shipment) => {
            const stage =
              shipment.status === "sailing"
                ? 1
                : shipment.status === "arrived" || shipment.status === "queued-at-port"
                  ? 2
                  : 4;
            return (
              <div className="pipeline__row" key={shipment.id}>
                <span className="pipeline__label">
                  <strong>
                    {shipment.quantityKt.toFixed(1)} kt {shipment.cargo}
                  </strong>
                  <span>
                    Arrival {shipmentArrivalLabel(shipment)} ·{" "}
                    {shipment.supplier.replaceAll("-", " ")}
                  </span>
                </span>
                {[0, 1, 2, 3, 4].map((index) => (
                  <span className="pipeline__cell" key={index}>
                    {index <= stage ? (
                      <span
                        className={`pipeline__milestone ${
                          index === stage
                            ? shipment.status === "queued-at-port"
                              ? "pipeline__milestone--queued"
                              : "pipeline__milestone--active"
                            : ""
                        }`}
                      >
                        {index < stage ? "✓" : index + 1}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Regional depot returns"
        subtitle="National adequacy can conceal a local service failure"
        tools={<StatusLabel tone="watch">Reported with lag</StatusLabel>}
        flush
      >
        <div className="data-table-wrap">
          <table className="data-table">
            <caption className="sr-only">Latest regional grain stock returns</caption>
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col">Reported stock</th>
                <th scope="col">Weekly demand</th>
                <th scope="col">Coverage</th>
                <th scope="col">Ration regime</th>
                <th scope="col">Service</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(visible.regions).map((region) => (
                <tr key={region.id}>
                  <td>
                    <strong>{region.label}</strong>
                    <span className="data-table__sub">Provincial supply return</span>
                  </td>
                  <td>{region.reportedGrainKt.toFixed(1)} kt</td>
                  <td>{REGION_WEEKLY_DEMAND_KT[region.id].toFixed(1)} kt</td>
                  <td>
                    <span className={coverageClass(region.reportedCoverageWeeks)}>
                      {region.reportedCoverageWeeks.toFixed(1)} wk
                    </span>
                  </td>
                  <td>{region.activeRation}</td>
                  <td>
                    <StatusLabel
                      tone={
                        region.serviceStatus === "secure"
                          ? "stable"
                          : region.serviceStatus === "at-risk"
                            ? "watch"
                            : "critical"
                      }
                    >
                      {region.serviceStatus}
                    </StatusLabel>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function TransportScreen(props: ScreenProps) {
  const { visible, decision, onOpenBook, onOpenTrace } = props;
  const [layer, setLayer] = React.useState<"grain" | "diesel" | "copper">("grain");
  const portRequested =
    decision.portSchedule.grainImportsKt +
    decision.portSchedule.dieselImportsKt +
    decision.portSchedule.copperExportsKt +
    decision.portSchedule.repairEquipmentKt;
  const railRequested =
    decision.railAndTruck.railGrainKt + decision.railAndTruck.railCopperKt;
  const mapValues: NetworkValues = {
    portUtilization: Math.min(
      1,
      portRequested / Math.max(1, visible.headline.portCapacityKt),
    ),
    railUtilization: Math.min(
      1,
      railRequested / Math.max(1, visible.headline.railCapacityKt),
    ),
    capitalCoverage: visible.regions.capital.reportedCoverageWeeks,
    northCoverage: visible.regions.north.reportedCoverageWeeks,
    interiorCoverage: visible.regions.interior.reportedCoverageWeeks,
    mineOutput: decision.copperPlan.mineTargetKt,
    truckActive: decision.railAndTruck.truckGrainKt > 0,
  };

  return (
    <>
      <PageHeader
        eyebrow="Operations / Network"
        title="Port & transport"
        description="Grain, diesel, copper, and repair equipment compete for one port; grain and copper then compete for one rail trunk."
        actions={
          <button className="button button--primary button--small" type="button" onClick={() => onOpenBook("portSchedule")}>
            Edit allocations
          </button>
        }
      />

      <Panel
        title="Selene freight network"
        subtitle="Node labels show reported regional coverage; route width indicates proposed use"
        tools={
          <button className="text-button" type="button" onClick={() => onOpenTrace("Network constraints", visible.latestTrace)}>
            Inspect constraints
          </button>
        }
      >
        <div className="map-toolbar">
          <div className="layer-tabs" aria-label="Cargo layer">
            {(["grain", "diesel", "copper"] as const).map((cargo) => (
              <button
                type="button"
                aria-pressed={layer === cargo}
                onClick={() => setLayer(cargo)}
                key={cargo}
              >
                {cargo}
              </button>
            ))}
          </div>
          <div className="map-legend-inline" aria-label="Map status legend">
            <span>
              <i /> Secure
            </span>
            <span>
              <i /> At risk
            </span>
            <span>
              <i /> Shortfall
            </span>
          </div>
        </div>
        <SystemMap values={mapValues} layer={layer} />
      </Panel>

      <div className="grid grid--2" style={{ marginTop: 14 }}>
        <Panel
          title="Proposed port schedule"
          subtitle={`Weekly throughput ${visible.headline.portCapacityKt.toFixed(0)} kt`}
          tools={
            <StatusLabel
              tone={portRequested > visible.headline.portCapacityKt ? "critical" : portRequested > visible.headline.portCapacityKt * 0.9 ? "watch" : "stable"}
            >
              {portRequested.toFixed(1)} / {visible.headline.portCapacityKt.toFixed(0)} kt
            </StatusLabel>
          }
        >
          <div
            className="allocation-bar"
            aria-label={`Proposed port allocation totals ${portRequested.toFixed(1)} of ${visible.headline.portCapacityKt} kilotonnes`}
          >
            <span className="allocation-bar__grain">
              Grain {decision.portSchedule.grainImportsKt}
            </span>
            <span className="allocation-bar__diesel">
              Diesel {decision.portSchedule.dieselImportsKt}
            </span>
            <span className="allocation-bar__copper">
              Copper {decision.portSchedule.copperExportsKt}
            </span>
            <span className="allocation-bar__repair">
              Repair {decision.portSchedule.repairEquipmentKt}
            </span>
          </div>
          <div className="capacity-summary">
            <div>
              <div className="capacity-summary__copy">
                <span>Capacity claimed</span>
                <strong>{Math.round((portRequested / visible.headline.portCapacityKt) * 100)}%</strong>
              </div>
              <Meter
                value={portRequested}
                max={visible.headline.portCapacityKt}
                label="Proposed port capacity use"
                tone={portRequested > visible.headline.portCapacityKt ? "red" : "amber"}
              />
            </div>
            <StatusLabel tone={portRequested <= visible.headline.portCapacityKt ? "stable" : "critical"}>
              {portRequested <= visible.headline.portCapacityKt ? "Feasible" : "Overbooked"}
            </StatusLabel>
          </div>
        </Panel>

        <Panel
          title="Proposed rail & truck plan"
          subtitle={`Rail capacity ${visible.headline.railCapacityKt.toFixed(0)} kt · truck ceiling 3 kt`}
          tools={
            <StatusLabel
              tone={railRequested > visible.headline.railCapacityKt ? "critical" : railRequested > visible.headline.railCapacityKt * 0.9 ? "watch" : "stable"}
            >
              {railRequested.toFixed(1)} / {visible.headline.railCapacityKt.toFixed(0)} kt
            </StatusLabel>
          }
        >
          <div className="schedule-grid">
            <div className="schedule-row">
              <span className="schedule-row__label">
                <strong>Grain by rail</strong>
                <span>Regional distribution</span>
              </span>
              <Meter
                value={decision.railAndTruck.railGrainKt}
                max={visible.headline.railCapacityKt}
                label="Rail grain allocation"
                tone="amber"
              />
              <output>{decision.railAndTruck.railGrainKt.toFixed(1)} kt</output>
            </div>
            <div className="schedule-row">
              <span className="schedule-row__label">
                <strong>Copper by rail</strong>
                <span>Mine to port</span>
              </span>
              <Meter
                value={decision.railAndTruck.railCopperKt}
                max={visible.headline.railCapacityKt}
                label="Rail copper allocation"
                tone="red"
              />
              <output>{decision.railAndTruck.railCopperKt.toFixed(1)} kt</output>
            </div>
            <div className="schedule-row">
              <span className="schedule-row__label">
                <strong>Emergency truck</strong>
                <span>{decision.railAndTruck.truckRegion}</span>
              </span>
              <Meter
                value={decision.railAndTruck.truckGrainKt}
                max={3}
                label="Emergency truck allocation"
                tone="teal"
              />
              <output>{decision.railAndTruck.truckGrainKt.toFixed(1)} kt</output>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function FinanceScreen(props: ScreenProps) {
  const { run, visible, decision, onOpenBook, onOpenTrace } = props;
  const fxTrace = metricTraces(visible, [
    "foreign",
    "import",
    "export",
    "credit",
    "repair",
  ]).filter((trace) => trace.unit === "usd-cents");
  const opening =
    visible.turn === 0
      ? visible.headline.fxCents
      : safeSnapshotAt(run, visible.turn - 1).headline.fxCents;
  const entries = fxTrace.slice(0, 5).map((trace) => ({
    label: trace.mechanism.replaceAll("-", " "),
    value: trace.amount / 100_000_000,
    kind: trace.amount < 0 ? ("outflow" as const) : ("inflow" as const),
  }));
  const releasedSettlements = Array.from({ length: visible.turn }, (_, index) => {
    const turn = index + 1;
    return safeSnapshotAt(run, turn).latestTrace
      .filter((trace) => trace.unit === "usd-cents")
      .map((trace) => ({ ...trace, turn }));
  })
    .flat()
    .reverse();

  return (
    <>
      <PageHeader
        eyebrow="Treasury / Foreign exchange"
        title="Finance & obligations"
        description="The ledger is auditable. Import contracts and repair reserve foreign exchange immediately; copper receipts settle only after export."
        actions={
          <button className="button button--primary button--small" type="button" onClick={() => onOpenBook("emergencyCredit")}>
            Review finance actions
          </button>
        }
      />

      <div className="grid grid--wide">
        <Panel raised>
          <div className="balance-hero">
            <div>
              <p className="eyebrow">Settled reserve balance</p>
              <div className="balance-hero__value">{formatUsd(visible.headline.fxCents, true)}</div>
              <div className="balance-hero__context">
                Emergency floor {formatUsd(visible.headline.emergencyFloorCents, true)} ·
                latest reconciled Treasury release
              </div>
            </div>
            <div className="balance-hero__gauge">
              <div className="capacity-summary__copy">
                <span>Floor buffer</span>
                <strong>
                  {formatUsd(
                    Math.max(
                      0,
                      visible.headline.fxCents -
                        visible.headline.emergencyFloorCents,
                    ),
                    true,
                  )}
                </strong>
              </div>
              <Meter
                value={visible.headline.fxCents}
                max={42_000_000_00}
                marker={visible.headline.emergencyFloorCents}
                label="Foreign-exchange reserves against emergency floor"
                tone={
                  visible.headline.fxCents < visible.headline.emergencyFloorCents
                    ? "red"
                    : visible.headline.fxCents < visible.headline.emergencyFloorCents * 1.25
                      ? "amber"
                      : "teal"
                }
              />
            </div>
          </div>
        </Panel>

        <Panel title="Draft direct commitments" subtitle="Before operational consequences">
          <div className="commitment-list">
            <div className="commitment-row">
              <span className="commitment-row__turn">
                W<strong>{decision.forTurn}</strong>
              </span>
              <span className="commitment-row__copy">
                <strong>Emergency credit draw</strong>
                <span>Interest and end-state covenant</span>
              </span>
              <strong>{formatUsd(decision.emergencyCreditUsdM * 100_000_000, true)}</strong>
            </div>
            <div className="commitment-row">
              <span className="commitment-row__turn">
                W<strong>{decision.forTurn}</strong>
              </span>
              <span className="commitment-row__copy">
                <strong>Signed import orders</strong>
                <span>{decision.imports.length} new contracts</span>
              </span>
              <StatusLabel tone={decision.imports.length ? "watch" : "info"}>
                {decision.imports.length ? "Drafted" : "None"}
              </StatusLabel>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid--2" style={{ marginTop: 14 }}>
        <Panel
          title="Weekly FX waterfall"
          subtitle="Opening + receipts − settlements = closing"
          tools={
            <button className="text-button" type="button" onClick={() => onOpenTrace("Foreign-exchange contributors", fxTrace)}>
              Why?
            </button>
          }
          flush
        >
          <Waterfall
            label="Foreign exchange accounting for current turn"
            unit="$m"
            items={[
              { label: "Opening", value: opening / 100_000_000, kind: "opening" },
              ...(entries.length
                ? entries
                : [{ label: "No settlements", value: 0, kind: "inflow" as const }]),
              { label: "Closing", value: visible.headline.fxCents / 100_000_000, kind: "closing" },
            ]}
          />
        </Panel>

        <Panel title="Released settlement trace" subtitle="Player-visible Treasury entries" flush>
          {releasedSettlements.length ? (
            <div className="ledger-list">
              {releasedSettlements.slice(0, 6).map((entry) => (
                  <div className="ledger-row" key={entry.id}>
                    <time>Week {entry.turn}</time>
                    <span className="ledger-row__copy">
                      <strong>{entry.note}</strong>
                      <span>{entry.mechanism.replaceAll("-", " ")}</span>
                    </span>
                    <strong
                      className={`ledger-row__amount ledger-row__amount--${entry.amount >= 0 ? "inflow" : "outflow"}`}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {formatUsd(entry.amount, true)}
                    </strong>
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState title="No ledger movements yet">
              Contract settlements, repair charges, copper receipts, and credit movements
              will appear here after commitment.
            </EmptyState>
          )}
        </Panel>
      </div>
    </>
  );
}

export function RepairScreen(props: ScreenProps) {
  const { visible, decision, onOpenBook, onOpenTrace } = props;
  const implementationTeamsTotal = 6;
  const claimed =
    implementationTeamsTotal - visible.headline.implementationTeamsAvailable;
  const engineeringReport = [...visible.reports]
    .reverse()
    .find((report) => report.kind === "port-engineering");
  const knownEfficiency =
    typeof engineeringReport?.values.repairEfficiency === "number"
      ? engineeringReport.values.repairEfficiency
      : null;
  return (
    <>
      <PageHeader
        eyebrow="Port authority / Recovery programme"
        title="Port repair"
        description="Repair consumes foreign exchange, equipment, diesel, and implementation teams before it expands the feasible set."
        actions={
          <button className="button button--primary button--small" type="button" onClick={() => onOpenBook("repairIntensity")}>
            Set repair intensity
          </button>
        }
      />

      <div className="grid grid--wide">
        <Panel
          title="Engineering progress"
          subtitle={
            knownEfficiency === null
              ? "Efficiency estimate remains unaudited"
              : `Known efficiency factor ${knownEfficiency.toFixed(2)}`
          }
          tools={
            <button className="text-button" type="button" onClick={() => onOpenTrace("Repair contributors", metricTraces(visible, ["repair", "equipment"]))}>
              Why?
            </button>
          }
        >
          <div className="repair-hero">
            <RingGauge
              value={visible.headline.portRepairProgressPct}
              max={100}
              label="Port repair progress"
              display={`${visible.headline.portRepairProgressPct.toFixed(0)}%`}
              tone={visible.headline.portRepairProgressPct >= 80 ? "teal" : "amber"}
            />
            <div className="repair-hero__copy">
              <h3>{visible.headline.portCapacityKt.toFixed(0)} kt weekly capacity</h3>
              <p>
                The port gains discrete throughput at 40% and 80%. Draft intensity is{" "}
                <strong>{decision.repairIntensity}</strong>; full progress requires a
                matching equipment allocation at the port.
              </p>
              <div className="thresholds">
                <div className="threshold threshold--reached">
                  <strong>12 kt</strong>
                  <span>Damaged baseline</span>
                </div>
                <div className={`threshold ${visible.headline.portRepairProgressPct >= 40 ? "threshold--reached" : ""}`}>
                  <strong>16 kt at 40%</strong>
                  <span>Crane &amp; apron release</span>
                </div>
                <div className={`threshold ${visible.headline.portRepairProgressPct >= 80 ? "threshold--reached" : ""}`}>
                  <strong>20 kt at 80%</strong>
                  <span>Near-normal throughput</span>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Implementation teams" subtitle="Shared across emergency initiatives">
          <div className="team-grid" aria-label={`${claimed} of ${implementationTeamsTotal} teams committed`}>
            {Array.from({ length: implementationTeamsTotal }, (_, index) => (
              <div className={`team-slot ${index < claimed ? "team-slot--claimed" : ""}`} key={index}>
                <span>
                  <Icon name={index < claimed ? "repair" : "briefcase"} />
                  <span>{index < claimed ? "Committed" : "Available"}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="capacity-summary">
            <div>
              <div className="capacity-summary__copy">
                <span>Ongoing commitments</span>
                <strong>
                  {claimed} / {implementationTeamsTotal} teams
                </strong>
              </div>
              <Meter
                value={claimed}
                max={implementationTeamsTotal}
                label="Implementation teams committed"
                tone={claimed >= implementationTeamsTotal ? "red" : "teal"}
              />
            </div>
            <StatusLabel
              tone={claimed >= implementationTeamsTotal ? "critical" : claimed >= 4 ? "watch" : "stable"}
            >
              {visible.headline.implementationTeamsAvailable} free
            </StatusLabel>
          </div>
        </Panel>
      </div>

      <Panel
        title="Active repair and information commitments"
        subtitle="Lifecycle and delay are explicit"
        flush
        className="panel--raised"
      >
        {visible.activeActions.filter((action) => action.family === "repairIntensity" || action.family === "audit").length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Committed</th>
                  <th scope="col">Effective</th>
                  <th scope="col">Lifecycle</th>
                  <th scope="col">Reason / dependency</th>
                </tr>
              </thead>
              <tbody>
                {visible.activeActions
                  .filter((action) => action.family === "repairIntensity" || action.family === "audit")
                  .map((action) => (
                    <tr key={action.id}>
                      <td>
                        <strong>{action.label}</strong>
                      </td>
                      <td>Week {action.committedTurn}</td>
                      <td>Week {action.effectiveTurn}</td>
                      <td>
                        <StatusLabel
                          tone={
                            action.lifecycle === "failed"
                              ? "critical"
                              : action.lifecycle === "completed" || action.lifecycle === "active"
                                ? "stable"
                                : "info"
                          }
                        >
                          {action.lifecycle}
                        </StatusLabel>
                      </td>
                      <td>{action.reason}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No repair or audit action committed">
            These initiatives share teams. Drafting both in the same package makes the
            burden visible before commitment.
          </EmptyState>
        )}
      </Panel>
    </>
  );
}

export function ReportsScreen(props: ScreenProps) {
  const { visible, onOpenReport, onOpenBook } = props;
  const reports = [...visible.reports].sort(
    (a, b) => b.publishedTurn - a.publishedTurn,
  );
  return (
    <>
      <PageHeader
        eyebrow="Institutional information / Inbox"
        title="Reports & revisions"
        description="Reports remain inspectable objects. Event date, “as of” date, publication date, confidence, and revision status are distinct."
        actions={
          <button className="button button--primary button--small" type="button" onClick={() => onOpenBook("audit")}>
            Commission audit
          </button>
        }
      />

      <div className="reports-list">
        {reports.map((report) => (
          <article className="report-card" key={report.id}>
            <span className="report-card__icon">
              <Icon name="reports" />
            </span>
            <div className="report-card__copy">
              <div className="report-card__meta">
                <StatusLabel
                  tone={
                    report.status === "revised"
                      ? "watch"
                      : report.confidence === "low"
                        ? "critical"
                        : "info"
                  }
                >
                  {report.status}
                </StatusLabel>
                <span className="micro-label">{report.confidence} confidence</span>
              </div>
              <h3>{report.title}</h3>
              <p>{report.methodology}</p>
              <div className="report-card__dates">
                <span>
                  <strong>Source:</strong> {report.source}
                </span>
                <span>
                  <strong>Event:</strong> week {report.eventTurn}
                </span>
                <span>
                  <strong>As of:</strong> week {report.asOfTurn}
                </span>
                <span>
                  <strong>Published:</strong> week {report.publishedTurn}
                </span>
              </div>
            </div>
            <button className="button button--small report-card__action" type="button" onClick={() => onOpenReport(report)}>
              Inspect
              <Icon name="chevron" />
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

export function TimelineScreen(props: ScreenProps) {
  const { run, visible, onBranch, onOpenTrace } = props;
  const items = run.history
    .flatMap((record) => {
      const releasedTrace = safeSnapshotAt(run, record.turn).latestTrace;
      return [
        {
          id: `decision-${record.turn}`,
          turn: record.turn,
          date: record.simulatedDate,
          type: "decision" as const,
          title: `Decision package committed for week ${record.turn}`,
          description: `${record.decision.imports.length} import orders · ${record.decision.repairIntensity} repair · ${record.decision.audit === "none" ? "no audit" : record.decision.audit}`,
          traces: releasedTrace,
        },
        ...record.events.map((event) => ({
          id: event.id,
          turn: record.turn,
          date: record.simulatedDate,
          type: "event" as const,
          title: event.title,
          description: event.description,
          severity: event.severity,
          traces: releasedTrace.filter((trace) => trace.eventIds.includes(event.id)),
        })),
      ];
    })
    .reverse();

  return (
    <>
      <PageHeader
        eyebrow="Run record / Event sourced"
        title="Decision & event timeline"
        description="Committed history is immutable. Branch from a pre-commit state to test a different diagnosis without rewriting the original run."
        actions={
          visible.turn > 0 ? (
            <button className="button button--primary button--small" type="button" onClick={() => onBranch(Math.max(0, visible.turn - 1))}>
              <Icon name="branch" />
              Branch previous turn
            </button>
          ) : null
        }
      />

      <div className="grid grid--wide">
        <Panel
          title="Run chronology"
          subtitle={`Run ${run.runId} · seed ${run.seed}`}
          flush
        >
          {items.length ? (
            <div className="timeline">
              {items.map((item) => (
                <div
                  className={`timeline-entry timeline-entry--${item.type} ${
                    "severity" in item && item.severity === "critical"
                      ? "timeline-entry--critical"
                      : ""
                  }`}
                  key={item.id}
                >
                  <span className="timeline-entry__marker" />
                  <span className="timeline-entry__copy">
                    <time>
                      Week {item.turn} · {formatDate(item.date)}
                    </time>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </span>
                  {item.traces.length ? (
                    <button className="button button--small timeline-entry__action" type="button" onClick={() => onOpenTrace(item.title, item.traces)}>
                      Why?
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No committed history">
              The initial state is pinned. Your first committed package will create the
              first immutable turn record.
            </EmptyState>
          )}
        </Panel>

        <Panel title="Branch points" subtitle="Fork from the state after a completed week" flush>
          <div className="commitment-list">
            {Array.from({ length: visible.turn + 1 }, (_, turn) => (
              <div className="commitment-row" key={turn}>
                <span className="commitment-row__turn">
                  W<strong>{turn}</strong>
                </span>
                <span className="commitment-row__copy">
                  <strong>{turn === 0 ? "Opening state" : `After week ${turn}`}</strong>
                  <span>
                    {turn === visible.turn
                      ? "Current branch head"
                      : "Immutable decision point"}
                  </span>
                </span>
                <button className="button button--small" type="button" onClick={() => onBranch(turn)} disabled={turn === visible.turn}>
                  <Icon name="branch" />
                  Branch
                </button>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        title="Latest binding constraints"
        subtitle="The realized flow records the constraint that actually bound it"
        flush
        className="panel--raised"
      >
        {visible.latestBindings.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">System</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Available</th>
                  <th scope="col">Realized</th>
                  <th scope="col">Binding constraint</th>
                </tr>
              </thead>
              <tbody>
                {visible.latestBindings.map((binding) => (
                  <tr key={binding.id}>
                    <td>
                      <strong>{binding.system}</strong>
                      <span className="data-table__sub">{binding.note}</span>
                    </td>
                    <td>{binding.requested.toFixed(1)} {binding.unit}</td>
                    <td>{binding.available.toFixed(1)} {binding.unit}</td>
                    <td>{binding.realized.toFixed(1)} {binding.unit}</td>
                    <td>
                      <StatusLabel tone={binding.binding ? "watch" : "stable"}>
                        {binding.constraint}
                      </StatusLabel>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No flow allocation completed">
            Binding constraints are emitted during each pure simulation step.
          </EmptyState>
        )}
      </Panel>
    </>
  );
}

export function ScreenRouter(props: ScreenProps & { view: ViewId }) {
  if (props.view === "situation") return <SituationScreen {...props} />;
  if (props.view === "supply") return <SupplyScreen {...props} />;
  if (props.view === "transport") return <TransportScreen {...props} />;
  if (props.view === "finance") return <FinanceScreen {...props} />;
  if (props.view === "repair") return <RepairScreen {...props} />;
  if (props.view === "reports") return <ReportsScreen {...props} />;
  return <TimelineScreen {...props} />;
}

// React is intentionally imported as a namespace here for the compact local map
// layer state while keeping the rest of the file hook-free.
import * as React from "react";

export function DebriefConstraintExhibit({ run }: { run: SimulationRun }) {
  const constraints = [
    "port",
    "rail",
    "diesel",
    "foreign-exchange",
    "implementation-teams",
  ] as const;
  const turns = run.history.map((record) => record.turn);
  return (
    <ConstraintMatrix
      turns={turns}
      rows={constraints.map((constraint) => ({
        label: constraint.replaceAll("-", " "),
        values: run.history.map((record) => {
          const bindings = record.bindingConstraints.filter(
            (binding) => binding.constraint === constraint,
          );
          if (bindings.some((binding) => binding.binding)) return 2 as const;
          if (bindings.length) return 1 as const;
          return 0 as const;
        }),
      }))}
    />
  );
}
