"use client";

import { useEffect, useRef } from "react";
import {
  COPPER_RECEIPT_CENTS_PER_KT,
  DIESEL_ESSENTIAL_REQUIREMENT_KT,
  DIESEL_PER_COPPER_KT,
  DIESEL_PER_RAIL_GRAIN_KT,
  DIESEL_PER_TRUCKED_GRAIN_KT,
  EARLY_PAYMENT_ADVANCE_CENTS,
  EARLY_PAYMENT_CARGO_KT,
  EARLY_PAYMENT_PENALTY_CENTS,
  IMPORT_LEAD_TURNS,
  IMPORT_UNIT_COST_CENTS_PER_KT,
  RATION_DEMAND_MULTIPLIER,
  RATION_HARDSHIP_POINTS,
  REPAIR_ASSUMPTIONS,
  WEEKLY_CREDIT_INTEREST_RATE,
  visibleCargoAvailability,
} from "@/lib/sim";
import type {
  DecisionPackage,
  VisibleCargoAvailability,
  VisibleSnapshot,
} from "@/lib/sim";
import { Icon } from "./Icons";
import { formatUsd } from "./Panels";

function amountRange(availability: VisibleCargoAvailability) {
  if (availability.uncertainKt <= 0) {
    return `${availability.confirmedByTurnKt.toFixed(1)} kt confirmed`;
  }
  return `${availability.confirmedByTurnKt.toFixed(1)}–${availability.possibleByTurnKt.toFixed(1)} kt`;
}

function QuickQuantity({
  label,
  value,
  status,
  tone = "measured",
}: {
  label: string;
  value: string;
  status: string;
  tone?: "measured" | "reported" | "uncertain" | "warning";
}) {
  return (
    <div className={`rule-quantity rule-quantity--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{status}</small>
    </div>
  );
}

function RuleSection({
  title,
  summary,
  children,
  open = false,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="rule-section" open={open}>
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="rule-section__body">{children}</div>
    </details>
  );
}

export function MechanicsRulebook({
  visible,
  decision,
  onClose,
}: {
  visible: VisibleSnapshot;
  decision: DecisionPackage;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true",
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", listener);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", listener);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  const grain = visibleCargoAvailability(visible, "grain", decision.forTurn);
  const diesel = visibleCargoAvailability(visible, "diesel", decision.forTurn);
  const portClosed =
    visible.operations.knownPortClosureTurn === decision.forTurn;
  const operationalPortCapacity = portClosed
    ? 0
    : visible.headline.portCapacityKt;
  const activeObligation = visible.earlyPaymentObligation;

  return (
    <div
      className="modal-wrap mechanics-wrap"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mechanics-title"
      ref={dialogRef}
    >
      <article className="modal mechanics-rulebook">
        <header className="modal__header mechanics-rulebook__header">
          <div>
            <p className="eyebrow">Declared simulation mechanics</p>
            <h2 id="mechanics-title">Mechanics rulebook</h2>
            <p>
              Exact public rules and player-visible quantities for draft week{" "}
              {decision.forTurn}. Hidden scenario state remains hidden.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close mechanics rulebook"
            ref={closeButtonRef}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="mechanics-rulebook__scroll">
          <section className="rule-principle" aria-labelledby="request-rule">
            <div className="rule-principle__formula">
              realized = min(request, stock, upstream capacity, fuel)
            </div>
            <div>
              <h3 id="request-rule">A request is a ceiling, not a guarantee</h3>
              <p>
                If you reserve 4 kt for grain unloading and only 2 kt reaches the
                queue, 2 kt unloads. The other 2 kt of berth time expires; it is
                not reassigned to diesel, copper, or repair.
              </p>
            </div>
          </section>

          <section className="rule-live" aria-labelledby="known-now">
            <div className="rule-live__header">
              <div>
                <p className="micro-label">Live decision support</p>
                <h3 id="known-now">Known for week {decision.forTurn}</h3>
              </div>
              <span className="rule-live__legend">
                Confirmed values use only disclosed information
              </span>
            </div>
            <div className="rule-quantity-grid">
              <QuickQuantity
                label={`Grain cargo by W${decision.forTurn}`}
                value={amountRange(grain)}
                status={
                  grain.uncertainKt > 0
                    ? `${grain.uncertainKt.toFixed(1)} kt depends on a disclosed arrival window`
                    : `${grain.queuedNowKt.toFixed(1)} kt is already queued`
                }
                tone={grain.uncertainKt > 0 ? "uncertain" : "measured"}
              />
              <QuickQuantity
                label={`Diesel cargo by W${decision.forTurn}`}
                value={amountRange(diesel)}
                status={
                  diesel.uncertainKt > 0
                    ? `${diesel.uncertainKt.toFixed(1)} kt depends on a disclosed arrival window`
                    : `${diesel.queuedNowKt.toFixed(1)} kt is already queued`
                }
                tone={diesel.uncertainKt > 0 ? "uncertain" : "measured"}
              />
              <QuickQuantity
                label="Central grain"
                value={`${visible.operations.centralGrainKt.toFixed(1)} kt`}
                status="Measured dispatch stock before this week’s inflows"
              />
              <QuickQuantity
                label="Copper at port"
                value={`${visible.operations.copperAtPortKt.toFixed(1)} kt`}
                status="Measured stock; same-week mine output may add more"
              />
              <QuickQuantity
                label="Operational port"
                value={`${operationalPortCapacity.toFixed(1)} kt`}
                status={
                  portClosed
                    ? "Forecast closure overrides the physical schedule"
                    : `${visible.headline.portCapacityKt.toFixed(1)} kt physical weekly capacity`
                }
                tone={portClosed ? "warning" : "measured"}
              />
              <QuickQuantity
                label="Diesel in stock"
                value={`${visible.headline.dieselKt.toFixed(1)} kt`}
                status={`Then +${visible.operations.domesticDieselSupplyKt.toFixed(1)} kt routine supply; essential services claim up to ${DIESEL_ESSENTIAL_REQUIREMENT_KT.toFixed(2)} kt first`}
              />
              <QuickQuantity
                label="Implementation teams"
                value={`${visible.headline.implementationTeamsAvailable} / ${visible.operations.implementationTeamsTotal} available`}
                status={`${visible.operations.implementationTeamsInFlight} currently in flight; maturities are released before this package`}
              />
              <QuickQuantity
                label="Emergency credit"
                value={`${formatUsd(visible.finance.creditRemainingCents, true)} remaining`}
                status={`${formatUsd(visible.finance.creditPrincipalCents, true)} principal outstanding`}
              />
            </div>
          </section>

          <section className="rule-resolution" aria-labelledby="resolution-order">
            <div>
              <p className="micro-label">Why order matters</p>
              <h3 id="resolution-order">Weekly resolution order</h3>
              <p>
                Later activities receive only what earlier activities leave behind.
              </p>
            </div>
            <ol>
              <li>Earlier ration changes and audits mature.</li>
              <li>Credit and advances post; imports and repair are paid.</li>
              <li>Known or newly released events occur; ships arrive.</li>
              <li>Port unloads grain, then diesel, through their separate caps.</li>
              <li>Domestic grain and diesel inflows enter stock.</li>
              <li>Essential diesel services receive first claim.</li>
              <li>Emergency trucking runs before rail grain.</li>
              <li>Repair uses its berth allocation and diesel.</li>
              <li>Copper is mined, then loaded; only loaded cargo earns receipts.</li>
              <li>Regions consume grain; contracts and credit settle; reports publish.</li>
            </ol>
          </section>

          <div className="rule-sections">
            <RuleSection
              title="Imports & port"
              summary="Contracts create pipeline cargo; berth allocations make it usable"
              open
            >
              <p>
                Contracts are paid in full on signing and claim one implementation
                team per non-empty batch, not per order. Up to four orders may be
                signed in a week; each may contain 0.1–20.0 kt in 0.1 kt increments.
              </p>
              <div className="rule-table-wrap">
                <table className="rule-table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th>Lead time</th>
                      <th>Grain / kt</th>
                      <th>Diesel / kt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        "near-premium",
                        "standard",
                        "distant-discount",
                      ] as const
                    ).map((supplier) => (
                      <tr key={supplier}>
                        <td>{supplier.replaceAll("-", " ")}</td>
                        <td>
                          {IMPORT_LEAD_TURNS[supplier]}
                          {supplier === "distant-discount"
                            ? "–5 weeks"
                            : " weeks"}
                        </td>
                        <td>
                          {formatUsd(
                            IMPORT_UNIT_COST_CENTS_PER_KT.grain[supplier],
                            true,
                          )}
                        </td>
                        <td>
                          {formatUsd(
                            IMPORT_UNIT_COST_CENTS_PER_KT.diesel[supplier],
                            true,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul>
                <li>
                  Arrivals are processed before that week’s port schedule. Distant
                  cargo shows a truthful arrival window; its exact seeded arrival is
                  withheld until observable.
                </li>
                <li>
                  Grain and diesel unload oldest eligible cargo first. Actual
                  unloading is the smaller of cargo waiting and its berth allocation.
                </li>
                <li>
                  Copper loading uses copper already at port plus same-week mine
                  output. Repair equipment is staged offshore: its number is a
                  handling allocation, not a warehouse stock.
                </li>
                <li>
                  A forecast closure makes effective throughput zero. Otherwise the
                  four port allocations must fit the displayed physical capacity.
                </li>
              </ul>
            </RuleSection>

            <RuleSection
              title="Freight & diesel priority"
              summary="Truck, rail grain, repair, then copper compete for remaining fuel"
            >
              <ul>
                <li>
                  Trucked grain = minimum of request,{" "}
                  {visible.operations.truckCapacityKt.toFixed(1)} kt truck capacity,
                  central grain, and diesel ÷{" "}
                  {DIESEL_PER_TRUCKED_GRAIN_KT.toFixed(2)}. It serves one chosen
                  region immediately.
                </li>
                <li>
                  Rail grain uses {DIESEL_PER_RAIL_GRAIN_KT.toFixed(2)} kt diesel
                  per kt moved. Its realized quantity—not its requested quantity—is
                  split by the three percentages.
                </li>
                <li>
                  Rail grain and rail copper share the displayed{" "}
                  {visible.headline.railCapacityKt.toFixed(1)} kt ceiling. Rail
                  copper supports new mine output; copper already at port does not
                  need another rail allocation.
                </li>
                <li>
                  Copper output = minimum of the 0–5 kt mine target, rail-copper
                  allocation, and diesel ÷ {DIESEL_PER_COPPER_KT.toFixed(2)}.
                </li>
              </ul>
            </RuleSection>

            <RuleSection
              title="Repair"
              summary="Nominal progress is scaled by equipment, diesel, and site efficiency"
            >
              <div className="rule-table-wrap">
                <table className="rule-table">
                  <thead>
                    <tr>
                      <th>Intensity</th>
                      <th>Nominal progress</th>
                      <th>Cost</th>
                      <th>Teams</th>
                      <th>Equipment</th>
                      <th>Diesel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        "none",
                        "normal",
                        "accelerated",
                        "emergency",
                      ] as const
                    ).map((intensity) => {
                      const rule = REPAIR_ASSUMPTIONS[intensity];
                      return (
                        <tr key={intensity}>
                          <td>{intensity}</td>
                          <td>+{rule.progressPct} pp</td>
                          <td>{formatUsd(rule.costCents, true)}</td>
                          <td>{rule.teams}</td>
                          <td>{rule.equipmentKt.toFixed(1)} kt</td>
                          <td>{rule.dieselKt.toFixed(2)} kt</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p>
                Actual progress = nominal progress × the smaller input-fulfilment
                fraction × site efficiency. Cost and teams are committed even if
                equipment or diesel is short. Site efficiency is{" "}
                {visible.operations.knownPortRepairEfficiency === null
                  ? "hidden until a port-damage inspection reports it"
                  : `known to be ${visible.operations.knownPortRepairEfficiency.toFixed(2)}`}
                . Port capacity rises from 12 to 16 kt at 40% repair and to 20 kt
                at 80%; a threshold reached this week helps from the following week.
              </p>
            </RuleSection>

            <RuleSection
              title="Rationing, stocks & reports"
              summary="Policy changes lag; reported regional stock is not hidden truth"
            >
              <div className="rule-table-wrap">
                <table className="rule-table">
                  <thead>
                    <tr>
                      <th>Band</th>
                      <th>Demand</th>
                      <th>Weekly hardship</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["none", "moderate", "severe"] as const).map((level) => (
                      <tr key={level}>
                        <td>{level}</td>
                        <td>
                          {(RATION_DEMAND_MULTIPLIER[level] * 100).toFixed(0)}%
                          of base
                        </td>
                        <td>
                          +{RATION_HARDSHIP_POINTS[level].toFixed(1)} points /
                          region
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul>
                <li>
                  Base weekly demand is Capital 3.0 kt, North 2.5 kt, and Interior
                  1.5 kt. Each unmet kt adds 2 hardship points.
                </li>
                <li>
                  A changed ration package claims one team and takes effect one
                  week after its committed operating week. The current active band
                  governs consumption until then.
                </li>
                <li>
                  Central grain is a measured operational ledger. Regional stock
                  returns and crop estimates are normally one week old and may be
                  revised. An audit is a precise point-in-time report delivered one
                  weekly step later, not permanent perfect telemetry.
                </li>
              </ul>
            </RuleSection>

            <RuleSection
              title="Finance, copper & contracts"
              summary="Direct commitments settle first; exports earn only after loading"
            >
              <ul>
                <li>
                  Import and repair commitments must fit opening FX plus a same-week
                  credit draw or accepted advance. Expected copper receipts cannot
                  fund those direct commitments in validation.
                </li>
                <li>
                  The emergency line totals {formatUsd(visible.finance.creditLimitCents, true)}.
                  A weekly draw is 0–$4.0m in $0.5m steps and claims one team.
                  Interest is {(WEEKLY_CREDIT_INTEREST_RATE * 100).toFixed(1)}%
                  of all outstanding principal each week; there is no repayment
                  action in this scenario.
                </li>
                <li>
                  Ordinary copper earns{" "}
                  {formatUsd(COPPER_RECEIPT_CENTS_PER_KT, true)} per kt actually
                  loaded. Cash shortfalls on required settlements become arrears.
                </li>
                <li>
                  The buyer advance pays{" "}
                  {formatUsd(EARLY_PAYMENT_ADVANCE_CENTS, true)} immediately for{" "}
                  {EARLY_PAYMENT_CARGO_KT} kt due two turns later. Exports service
                  that cargo before earning new cash; default claws back the unearned
                  advance and adds a{" "}
                  {formatUsd(EARLY_PAYMENT_PENALTY_CENTS, true)} penalty.
                </li>
              </ul>
              {activeObligation ? (
                <div className="rule-obligation">
                  <span>Active advance obligation</span>
                  <strong>
                    {activeObligation.remainingKt.toFixed(1)} kt remaining · due
                    week {activeObligation.dueTurn}
                  </strong>
                </div>
              ) : null}
            </RuleSection>

            <RuleSection
              title="Teams, audits & forecasts"
              summary="Six shared teams constrain changes; forecasts score diagnosis only"
            >
              <ul>
                <li>
                  Shared team claims: any import batch 1; changed ration package 1;
                  audit 1; credit draw 1; repair 0–3. Port, rail, trucking, mine
                  schedules, and advance acceptance claim no team.
                </li>
                <li>
                  Audits complete after one weekly step. Stock audits reveal the
                  chosen region’s point stock; crop audit reassesses output; port
                  inspection reveals site efficiency.
                </li>
                <li>
                  Forecast fields never alter simulation causality. “Next week”
                  asks for the closing reported grain coverage and closing settled
                  FX you expect after this package; the binding constraint is your
                  predicted primary limiter of requested realization.
                </li>
              </ul>
            </RuleSection>
          </div>

          <section className="rule-information" aria-labelledby="information-boundary">
            <h3 id="information-boundary">Information boundary</h3>
            <div className="rule-information__grid">
              <div>
                <strong>Measured</strong>
                <p>
                  Central grain, diesel, copper at port, FX, liabilities, cargo
                  remaining, and physical capacities.
                </p>
              </div>
              <div>
                <strong>Reported</strong>
                <p>
                  Regional grain and crop output carry their displayed date,
                  method, confidence, and possible revisions.
                </p>
              </div>
              <div>
                <strong>Windowed</strong>
                <p>
                  Distant cargo exposes only the contracted arrival window until
                  its exact arrival becomes observable.
                </p>
              </div>
              <div>
                <strong>Hidden</strong>
                <p>
                  Future shocks, current regional truth, reporting bias, and
                  unaudited site efficiency are never exposed by decision support.
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer className="modal__footer">
          <span className="mechanics-rulebook__version">
            Scenario rules · {visible.scenarioId}
          </span>
          <button className="button button--primary" type="button" onClick={onClose}>
            Return to decisions
          </button>
        </footer>
      </article>
    </div>
  );
}
