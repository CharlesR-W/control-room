# Control Room scenario design suite

**Status:** Playable deterministic prototypes implemented; not numerically calibrated or historically validated  
**Platform baseline:** Control Room 0.1.0 and *The Narrows* vertical slice  
**Purpose:** Turn the launch-set sketches in the platform specification into buildable scenario contracts, while using the differences between scenarios to decide what the shared engine should actually generalize.

## Recommendation

Specify the full launch set now, but implement it in dependency order:

The prototypes were implemented in the recommended dependency order at the model boundary, while keeping scenario mechanisms owned by each plugin:

1. **Controlled Materials, 1943** — complementary resource allocation, bill-of-materials, work-in-process, conversion, maintenance, and learning.
2. **North Atlantic, 1942** — moving entities, network cycles, keyed stochastic loss, repair queues, and congestion.
3. **Apollo Integration, 1966** — an analytically fictionalized program with project dependencies, tests, defects, configuration, and workforce.
4. **Sterling, 1931** — explicit financial accounting with disputed confidence and expectation mechanisms shipped as named alternatives.
5. **Bottleneck Economy, 1981** — the capstone sectoral network with a bounded two-channel allocation system, prices, credit, investment, and declared political-institutional simplifications.

This order differs from a simple public-library priority list because implementation risk matters. A scenario can be fully specified before the engine is ready to support it.

## Scenario specifications

| Scenario | Fidelity | Primary engine test | Software status |
|---|---|---|---|
| [Controlled Materials, 1943](controlled-materials-1943.md) | Simplified historical structure | complementary inputs, WIP, conversion, learning, bottleneck migration | **Playable prototype** |
| [North Atlantic, 1942](north-atlantic-1942.md) | Historically grounded logistics | network cycles, convoy schedules, loss hazards, congestion, repair | **Playable prototype** |
| [Apollo Integration, 1966](apollo-integration-1966.md) | Fictional analytic first; historical variant later | dependency graph, tests, defects, configuration, workforce | **Playable fictional-analytic prototype** |
| [Sterling, 1931](sterling-1931.md) | Historically grounded counterfactual | signed financial stocks, balance identities, regimes, model variants | **Playable prototype; model-risk gate remains** |
| [Bottleneck Economy, 1981](bottleneck-economy-1981.md) | Historically grounded counterfactual | sectoral network, bounded two-channel allocation, credit, investment feedback | **Playable capstone prototype; validation gates remain** |

*The Narrows* remains the high-fidelity tutorial and reference contract. The five new models are thinner shared-desk prototypes and do not replace its [model card](../model-card.md) or package under `scenarios/narrows/`.

## What the current repository can genuinely share

The existing vertical slice already establishes useful invariants:

- pure, deterministic steps from versioned state, decision, mode, and seed;
- immutable committed decisions and event-sourced run history;
- exact replay and branch lineage;
- distinct true state and player-visible projection;
- dated reports with preliminary, revised, and final status;
- whole-package validation with direct commitments shown before commit;
- structured causal contributions and binding-constraint records;
- priority-ordered objective vectors; and
- headless baseline policies and multi-seed verification.

These are platform contracts. The current concrete TypeScript types are not yet platform contracts: `WorldState`, `DecisionPackage`, `VisibleSnapshot`, action families, binding constraints, regions, units, and most UI screens directly encode *The Narrows*.

## Extraction sequence

The current implementation establishes the Gate A model/registry boundary and a shared
scenario desk, but deliberately leaves each scenario's detailed state and update order in
its TypeScript plugin. The remaining items below are architectural extraction gates, not
claims that the prototypes are historically calibrated or feature-complete.

### Gate A — model boundary established

Introduce only the boundaries needed to host a second model:

- a `ScenarioModel<State, Decision, Visible>` plugin contract;
- scenario-owned state, decision, objective, forecast, and visibility types;
- a generic run envelope containing opaque serializable scenario state;
- generic report, event, action-status, invariant, contribution, and binding records;
- package identity, version, content hash, clock, modes, role, views, and model-card references;
- a scenario registry selected by `scenarioId`; and
- UI routing from declared views to scenario-provided view models.

Do not first build a universal variable DSL or formula evaluator.

### Gate B — deeper primitive extraction

Extract only demonstrated common primitives:

- bounded and signed stocks with explicit reconciliation;
- resource pools and dated claims;
- fixed and staged delays;
- FIFO and priority queues;
- capacity availability and utilization;
- allocation tables with requested, available, realized, and binding values;
- action lifecycles and implementation claims;
- objective-vector evaluation;
- baseline-policy and Monte Carlo harnesses; and
- parameter/source-register validation.

Production recipes, learning curves, and conversion projects may be shared helpers, but their update order remains scenario-declared.

### Gate C — optional shared network and project primitives

Add:

- graph/network state and typed moving entities;
- schedules, transit cycles, port and repair queues;
- keyed hazards attached to stable entity/event identifiers;
- project dependency graphs and milestones;
- test queues, defect discovery, rework, and configuration propagation;
- resource-calendar and Gantt view models; and
- distribution/fan-chart summaries derived from declared model variants.

### Gate D — accounting and model-variant hardening

Add only with explicit accounting and interpretation boundaries:

- multi-account ledgers with signed balances and reconciliation identities;
- regime state machines;
- swappable, named behavioural parameterizations;
- sectoral input-output or recipe networks;
- administered and market-channel allocation rules;
- credit and investment project pipelines; and
- sensitivity ensembles that compare variants rather than hide disagreement.

## Shared package additions implied by the suite

The Narrows package shape is a useful start, but the next package schema should also require:

- `learning-design.md` — thesis, misconceptions, transfer task, and assessment;
- `causal-model.md` — phase order, accounting identities, dependency diagram, and trace contract;
- `views.json` — declared pages, headline KPIs, decision questions, and view-model requirements;
- `forecasts.json` — prompts, units, horizons, and scoring rules;
- `baselines.ts` or a scenario-owned equivalent — minimal, reactive, competent, and adversarial policies;
- `validation.md` — invariants, expected qualitative patterns, seed tests, and model-risk gates;
- `sources.md` — categorized claims and source access;
- `model-card.md` — intended use, claims boundary, omissions, alternatives, and validation status; and
- a machine-readable parameter register with provenance, uncertainty, sensitivity priority, and version introduced.

The model plugin should remain authoritative until at least three materially different scenarios demonstrate that a declarative mechanism is stable.

## Cross-scenario design rules

All five specifications apply the same rules:

1. The player occupies a bounded operational role; composite authority is labeled.
2. The numerical model, never an LLM, adjudicates state.
3. Each scenario teaches no more than three central dynamic intuitions.
4. There are at most eight primary action families, with progressive disclosure where needed.
5. Every action has a direct commitment, implementation path, delay or opportunity cost, and traceable effect.
6. Every consequential hidden state has a dated proxy, an information action, or an explicit reason it is unknowable.
7. Events stress modeled mechanisms and normally provide warning; they are not punishment cards.
8. Objectives remain a priority-ordered vector, with hard constraints separated from softer priorities.
9. Historical facts, derived quantities, calibrated values, design assumptions, and fictional elements are visibly distinct.
10. Counterfactual output explains the declared model; it does not establish what would have happened historically.

## Review and implementation gates

A specification is ready for package/model implementation only when:

- every state variable supports a decision, accounting identity, observation, event, objective, or causal trace;
- every action can be validated without previewing its full outcome;
- update order and allocation rules are unambiguous;
- the player’s authority and period information set are coherent;
- at least three baseline policies have expected qualitative behaviour;
- likely dominant strategies and perverse incentives have explicit tests;
- major historical mechanisms have sources and disputed mechanisms have alternatives;
- headline changes can be reconstructed from contributions and binding records; and
- the model card makes clear that “implemented,” “verified,” “calibrated,” and “validated” are different statuses.

None of the five specifications is self-validating. Historical review, parameterization, implementation, Monte Carlo testing, adversarial play, accessibility review, and learning-transfer testing remain separate gates.
