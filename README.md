# Control Room

Control Room is a browser-local serious-systems simulation about making consequential decisions in a world of delays, queues, bottlenecks, accounting constraints, and incomplete reports.

[Play Control Room in your browser](https://selene-control-room.karolvsavgvstvs.chatgpt.site).

The current release is a **playable scenario library**, not the full platform described by the product specification. It includes the original fictional vertical slice plus five design-stage historical and fictional-analytic models:

> **The Narrows: Twelve Weeks to Stabilize Selene**
>
> As Minister for National Supply, keep food and essential fuel moving after a cyclone damages the country’s only deep-water port. Imports, copper exports, repairs, and regional distribution compete for the same transport, foreign exchange, and implementation capacity.

- **Controlled Materials, 1943** — allocate complementary materials across production programs while conversion, maintenance, WIP, and learning move the bottleneck.
- **North Atlantic, 1942** — schedule convoys, escorts, ports, and repair cycles under keyed loss hazards and delayed reports.
- **Apollo Integration, 1966** — a fictional-analytic program-integration model of dependencies, testing, defects, configuration, and workforce pressure.
- **Sterling, 1931** — compare explicitly named behavioural variants around reserves, external balance, policy, and regime stress.
- **Bottleneck Economy, 1981** — a deliberately bounded capstone model of an incipient two-channel allocation system under adjustment and stabilization.

The historical scenarios are simplified teaching models with explicit claims boundaries. They explain their declared mechanisms; they do not establish what would have happened.

## What this is

- A bounded management “flight simulator” built to teach systems reasoning through decisions and consequences.
- A deterministic or seeded-reproducible model in which typed numerical rules—not prose or an LLM—control the world state.
- A local-first web application with a professional dashboard, a weekly Decision Book, dated reports, and inspectable causal traces.
- A first implementation of reusable ideas: stocks, delayed shipments, capacity allocation, ledgers, partial observation, event-sourced replay, and branching.

## What this is not

- It is not a forecast, policy recommendation, historical reconstruction, or model of any real country.
- It is not a universal nation simulator or a general-purpose scenario DSL.
- It is not “choose the designer’s one correct answer”: objectives remain a priority-ordered vector with visible trade-offs.
- It does not use an LLM to invent outcomes, mutate state, or generate official data.
- It is not yet the complete v1 scenario platform, authoring environment, instructor product, or validated learning assessment.

See the [model card](docs/model-card.md) for the exact claim boundary and declared omissions.

## The playable loop

Each scenario uses its own declared clock. On each turn:

1. **Inspect** the mandate, dated reports, stock coverage, incoming shipments, regional service, finance, and current constraints.
2. **Diagnose** which resource is likely to bind next—not only which headline number is lowest now.
3. **Draft** one decision package covering available procurement, port, rail/truck, rationing, copper, repair, audit, and emergency-finance actions.
4. **Forecast** grain coverage, foreign exchange, and the next binding constraint; add a rationale if useful.
5. **Validate and commit** the package. Direct costs, capacity conflicts, action locks, and implementation-team claims are checked before time advances.
6. **Advance one week**, then inspect new events, revised reports, objective guardrails, ledger effects, and the structured “why did this change?” trace.
7. **Replay or branch** to compare a different decision from an earlier turn without rewriting the original run.

Doing nothing or holding a policy steady can be a legitimate choice. An import order is not instant inventory: it must be funded, shipped, unloaded through the port, and distributed inland.

## Implemented

### Simulation

- Twelve weekly turns starting 4 September 1978.
- Guided, professional, and sandbox modes.
- Seeded scenario variants with recorded engine, RNG, scenario, and content versions.
- Explicit central and regional grain stocks, diesel stock, domestic supply, and demand.
- Supplier-specific grain and diesel import prices and lead times.
- Shared port capacity, shared rail capacity, and diesel-intensive emergency trucking.
- Copper production/export receipts and integer-cent foreign-exchange accounting.
- Emergency credit, weekly interest, an early-payment obligation, and contractual penalties.
- Delayed ration-policy changes, hardship, limited implementation teams, and staged port repair.
- Lagged and revisable reports plus targeted information actions.
- Priority-ordered objective guardrails rather than one opaque score.
- Structured contributions, binding-constraint records, events, reports, action lifecycles, and invariant results.

### Run handling

- A typed decision package and whole-package validation.
- Reproducible initialization and keyed deterministic scenario variation.
- Event-sourced turn history with state hashes and version-pinned run metadata.
- Exact replay checks and branch ancestry.
- Serializable run records suitable for local save/export and later inspection.

### Browser interface

- A six-scenario library with scenario-specific briefings, roles, fidelity labels, modes, and seeds.
- A reusable scenario desk for the five new models with live metrics, mandate priorities, alerts, bounded action controls, direct commitments, deterministic autosave/replay, export, causal traces, and after-action reviews.
- A desktop-first control-room shell with situation, supply, transport, finance, repair, reports, and timeline views.
- A persistent Decision Book with requested/confirmed/possible flow bounds, measured source stocks, liabilities, timing, resource previews, and validation feedback.
- An in-game mechanics rulebook that declares resolution order, capping and non-reassignment rules, costs, lags, fuel priority, and the boundary between measured, reported, windowed, and hidden information.
- A stylized, data-driven SVG logistics map; stock/flow, capacity, trend, and binding-constraint views.
- Keyboard-visible focus styles, textual chart/map descriptions, and reduced-motion support.

The structured files under [`scenarios/narrows`](scenarios/narrows) are a documentation-forward package skeleton. The TypeScript scenario models remain the runtime authority; a declarative package loader and authoring CLI are future platform work.

## Not implemented yet

- A declarative scenario-package loader; the current shared boundary is a typed model plugin registry.
- A visual authoring studio, schema migrations, or scenario marketplace.
- Instructor cohorts, accounts, cloud saves, multiplayer, or public leaderboards.
- A calibrated historical model or empirical parameter set.
- An LLM staff analyst or LLM-generated debrief.
- Formal accessibility certification, broad cross-browser coverage, or learning-effect validation.

## Run locally

Requirements: a current Node.js release (Node 24 or newer is recommended) and npm.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For a production-mode local run:

```bash
npm run build
npm start
```

The interaction model runs in the browser. Vinext serves the Next-compatible application shell; it does not adjudicate turns or store run state in a server database.

## Test and verify

Run the complete local gate:

```bash
npm run check
```

Or run its parts:

```bash
npm run typecheck
npm test
npm run build
```

The test suite covers deterministic initialization and replay, branch equivalence, save/load round trips, decision validation, bounds and conservation, ledger reconciliation, event and observation behavior, baseline policies, cross-scenario 100-seed smoke tests, and causal-trace completeness. A passing software suite verifies the implementation’s internal contract; it does not establish real-world validity or educational effectiveness.

The headless runner can execute reference policies or a Monte Carlo smoke without
opening a browser:

```bash
npm run sim -- run competent 7 professional
npm run sim -- monte-carlo competent 100
```

For a full browser play-through, start the production server and run
`npm run test:e2e` in another terminal. The smoke test uses the locally installed
Chromium path by default; override `CHROMIUM_PATH` or `E2E_BASE_URL` when needed.

## Architecture

The core dependency rule is simple:

```text
seed + versioned scenario + prior state + committed decision
                              │
                              ▼
                    pure simulation step
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
      next state       reports / events      causal trace
          │
          ▼
    versioned run record ──► replay / branch / visible snapshot
                                      │
                                      ▼
                                  browser UI
```

The simulation code has no React dependency, network access, wall-clock dependency, or unseeded randomness. The UI drafts typed actions and renders a visibility-filtered snapshot; it does not contain the causal rules.

Read [the architecture note](docs/architecture.md) for the step boundary, event-sourced run format, replay and branching semantics, causal traces, and UI trust boundary.

## Scenario documentation

- [Player briefing](scenarios/narrows/briefing.md)
- [Scenario manifest](scenarios/narrows/manifest.json)
- [Action catalog](scenarios/narrows/actions.json)
- [Objectives](scenarios/narrows/objectives.json)
- [Observations](scenarios/narrows/observations.json)
- [Events](scenarios/narrows/events.json)
- [Parameter register](scenarios/narrows/parameter-register.csv)
- [Model card](docs/model-card.md)
- [Launch-scenario design suite](docs/scenarios/README.md)

Scenario values are fictional assumptions, sourced structural claims, or design-tuned parameters as labeled in the specifications. Numerical calibration and historical validation remain unfinished.

## Determinism, replay, and privacy

A run pins its engine version, scenario version, scenario content identifier, RNG version, mode, and seed. Deterministic variation is keyed by seed and purpose, so adding an unrelated draw does not silently shift every later event. Each committed turn records the decision, outputs, state snapshot, and stable state hash. Replay rebuilds the run from its initial conditions and decisions; branching retains parent and fork metadata while creating a new future.

Determinism means “the same declared inputs reproduce the same modeled run.” It does not mean the simulation predicts reality.

The numerical simulation and run handling are local-first and require no account, analytics service, or LLM call. A hosted deployment still receives ordinary HTTP metadata at the hosting layer. Do not enter sensitive operational information into this prototype.

## Deployment and source availability

The application uses the Next.js App Router API and pinned vinext/Cloudflare adapters to produce the host’s Worker artifact. A deployment should run `npm run check`, build the exact public commit, and expose that commit/version in the release record.

The source repository is public for inspection. **No reuse license has been selected yet.** Public visibility alone does not grant permission to copy, redistribute, or create derivative works; a future license decision should be recorded explicitly rather than inferred.
