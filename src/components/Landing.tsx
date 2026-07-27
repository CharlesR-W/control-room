"use client";

import { useState } from "react";
import type { SimulationMode } from "@/lib/sim/types";
import { Icon } from "./Icons";

export const PUBLIC_SEEDS = [1978, 31415, 8601] as const;

type SavedRunSummary = {
  turn: number;
  simulatedDate: string;
  mode: SimulationMode;
  seed: number;
};

export function Landing({
  savedRun,
  onBegin,
  onResume,
  onImport,
  onLibrary,
}: {
  savedRun: SavedRunSummary | null;
  onBegin: (mode: SimulationMode, seed: number) => void;
  onResume: () => void;
  onImport: (file: File) => void;
  onLibrary?: () => void;
}) {
  const [mode, setMode] = useState<SimulationMode>("guided");
  const [seed, setSeed] = useState<number>(PUBLIC_SEEDS[0]);

  return (
    <main className="landing">
      <section className="landing__main" aria-labelledby="product-title">
        <div className="brand" aria-label="Control Room">
          <span className="brand__mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand__name">
            <strong>Control Room</strong>
            <small>Systems management simulations</small>
          </span>
        </div>

        <div className="landing__hero">
          <p className="eyebrow">A management flight simulator</p>
          <h1 id="product-title">
            Decisions have <em>lead times.</em>
          </h1>
          <p className="landing__lede">
            Sit at the supply minister&apos;s desk. Read an incomplete instrument panel,
            commit a coherent plan, and discover how bottlenecks move when the system
            pushes back.
          </p>
        </div>

        <div className="landing__principles" aria-label="Simulation principles">
          <div className="landing__principle">
            <strong>Inspect before acting</strong>
            <span>Reports are dated, delayed, and sometimes revised.</span>
          </div>
          <div className="landing__principle">
            <strong>Commit as a package</strong>
            <span>Money, capacity, and implementation teams are shared.</span>
          </div>
          <div className="landing__principle">
            <strong>Learn from the trace</strong>
            <span>Every headline outcome can be reconstructed after the turn.</span>
          </div>
        </div>
      </section>

      <aside className="landing__panel" aria-label="Scenario selection">
        <div className="scenario-card">
          {onLibrary ? (
            <button className="button button--ghost button--small" type="button" onClick={onLibrary}>
              ← Scenario library
            </button>
          ) : null}
          <div className="scenario-card__meta">
            <p className="eyebrow">Scenario 01 / Supply &amp; logistics</p>
            <span className="scenario-card__stamp">Fictional analytic</span>
          </div>

          <h2>The Narrows</h2>
          <p className="scenario-card__subtitle">
            Twelve weeks to stabilize the island republic of Selene after a cyclone
            damages its only deep-water port.
          </p>

          <dl className="scenario-card__facts">
            <div className="scenario-card__fact">
              <dt>Your role</dt>
              <dd>Supply Minister</dd>
            </div>
            <div className="scenario-card__fact">
              <dt>Horizon</dt>
              <dd>12 weekly turns</dd>
            </div>
            <div className="scenario-card__fact">
              <dt>Session</dt>
              <dd>40–60 minutes</dd>
            </div>
          </dl>

          <section className="scenario-card__section" aria-labelledby="learn-heading">
            <h3 id="learn-heading">You will manage</h3>
            <ul className="learning-list">
              <li>Food and diesel stocks whose import orders arrive weeks later</li>
              <li>A shared port and rail network serving both imports and copper exports</li>
              <li>Foreign exchange, repair capacity, and six implementation teams</li>
            </ul>
          </section>

          <div className="run-config">
            <fieldset className="field-label">
              <legend>Assistance</legend>
              <div className="segmented">
                <button
                  type="button"
                  aria-pressed={mode === "guided"}
                  onClick={() => setMode("guided")}
                >
                  Guided
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "professional"}
                  onClick={() => setMode("professional")}
                >
                  Professional
                </button>
              </div>
            </fieldset>

            <label className="field-label">
              Scenario seed
              <select
                className="select"
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value))}
              >
                {PUBLIC_SEEDS.map((value, index) => (
                  <option value={value} key={value}>
                    Variant {String.fromCharCode(65 + index)} · {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="scenario-card__actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => onBegin(mode, seed)}
            >
              Begin briefing
              <Icon name="arrow" />
            </button>
            <label className="button button--ghost" title="Import a Control Room run file">
              <Icon name="upload" />
              <span className="sr-only">Import saved run</span>
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImport(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          {savedRun ? (
            <div className="resume-card">
              <div className="resume-card__copy">
                <strong>Autosaved desk available</strong>
                <span>
                  Turn {savedRun.turn} · {savedRun.simulatedDate} ·{" "}
                  {savedRun.mode === "guided" ? "Guided" : "Professional"} · seed{" "}
                  {savedRun.seed}
                </span>
              </div>
              <button className="button button--small" type="button" onClick={onResume}>
                Resume
              </button>
            </div>
          ) : null}

          <p className="scenario-card__fineprint">
            Runs locally in your browser. Numerical outcomes are deterministic for the
            selected seed and your committed decisions. No AI is required.
          </p>
        </div>
      </aside>
    </main>
  );
}

export function Briefing({
  mode,
  seed,
  onEnter,
  onBack,
}: {
  mode: SimulationMode;
  seed: number;
  onEnter: () => void;
  onBack: () => void;
}) {
  return (
    <div className="briefing-overlay" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <article className="briefing">
        <section className="briefing__main">
          <p className="eyebrow">Emergency Economic Coordination Council</p>
          <h2 id="briefing-title">Minister, the port is operating at sixty percent.</h2>
          <p className="briefing__lead">
            Selene imports its grain and diesel through the Narrows. The cyclone damaged
            cranes, warehouses, and the rail apron. Copper must leave through the same
            port to earn the foreign exchange that pays for essential imports. Orders
            already at sea buy you a little time—nothing more.
          </p>

          <div className="system-loop" aria-label="Core system loop">
            <div className="system-loop__node">
              <strong>Copper exports</strong>
              <span>Earn foreign exchange after loading</span>
            </div>
            <div className="system-loop__node">
              <strong>Foreign exchange</strong>
              <span>Pays for imports and port repair</span>
            </div>
            <div className="system-loop__node">
              <strong>Grain &amp; diesel</strong>
              <span>Arrive through delayed pipelines</span>
            </div>
            <div className="system-loop__node">
              <strong>Port &amp; rail</strong>
              <span>Constrain every physical flow</span>
            </div>
          </div>

          <p className="scenario-card__fineprint">
            Desk mode: {mode === "guided" ? "Guided" : "Professional"} · scenario seed{" "}
            {seed}. Reports show institutional estimates, not hidden true state.
          </p>
        </section>

        <aside className="briefing__mandate">
          <p className="eyebrow">Your mandate / priority order</p>
          <ol className="mandate-list">
            <li>Avoid severe regional food shortfalls</li>
            <li>Preserve essential diesel services</li>
            <li>Keep foreign exchange above the $10m emergency floor</li>
            <li>Restore port throughput</li>
            <li>Limit hardship, penalties, and infrastructure damage</li>
            <li>Finish with defensible reserves, not merely survival</li>
          </ol>
          <button className="button button--primary" type="button" onClick={onEnter}>
            Enter the control room
            <Icon name="arrow" />
          </button>
          <button
            className="button button--ghost"
            style={{ marginTop: 8 }}
            type="button"
            onClick={onBack}
          >
            Back to scenario card
          </button>
        </aside>
      </article>
    </div>
  );
}
