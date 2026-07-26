# Model card: The Narrows

- **Scenario:** `narrows-supply-crisis`
- **Scenario version:** 0.1.0
- **Engine version:** 0.1.0
- **Fidelity:** fictional-analytic
- **Release status:** playable vertical slice

## Intended use

The Narrows is a bounded training simulation about operational reasoning under coupled constraints. The player serves as Selene’s Minister for National Supply for twelve weekly decision rounds after a cyclone damages the country’s main port.

The exercise is intended to help a player:

- distinguish stocks from net flows;
- reason backward from procurement and implementation lead times;
- identify a bottleneck that can move between port, rail, diesel, foreign exchange, and administrative capacity;
- see how import finance depends on export throughput;
- compare emergency relief with investment in later capacity;
- act on dated, incomplete, and revisable information; and
- state a forecast before seeing an outcome.

It can support individual learning, design discussion, and software experimentation. It has not been validated as a professional assessment instrument.

## Claim boundary

Selene, its institutions, its crisis, and every numerical parameter are fictional. The scenario is an analytically constructed microworld, not a reconstruction of a real country or event.

The model makes one narrow claim:

> Within the declared rules, delayed shipments and shared physical, financial, and administrative constraints create trade-offs that reward anticipatory, system-level reasoning.

It does **not** claim that its parameter values estimate real economies, that a successful in-game policy would work in practice, or that simulated counterfactuals establish what would happen in a real emergency. It must not be used for operational planning, forecasting, public-policy advice, or resource allocation affecting real people.

## System boundary

The modeled system contains:

- a central grain stock and three regional depots;
- domestic grain output and region-specific consumption;
- national diesel supply and use;
- delayed grain and diesel import shipments;
- a damaged port with a shared cargo-capacity envelope;
- shared rail capacity and a diesel-intensive emergency-trucking substitute;
- copper production and export receipts;
- integer-cent foreign-exchange, credit, interest, and penalty accounting;
- a repair project with discrete throughput thresholds;
- a finite pool of implementation teams;
- lagged regional and crop reports, targeted audits, and revisions; and
- scheduled or seeded disruptions and commercial offers.

The three regions are the Capital Region, Northern Industrial Belt, and Interior Agricultural Region. Their separate inventories matter: an adequate national total does not guarantee that every region receives service.

## Principal mechanisms

### Stocks, flows, and pipelines

Grain and diesel obey explicit stock accounting. An import order is paid for when signed, enters a supplier-specific shipping pipeline, arrives at the port after its lead time, and becomes usable only after the player assigns unloading capacity. Unused allocation is not silently reassigned.

Domestic grain enters the central stock. Regional service depends on allocation and transport, not only on national availability. Unmet regional demand accumulates as shortfall and hardship.

### Coupled capacity allocation

Grain imports, diesel imports, copper exports, and repair equipment share port throughput. Grain distribution and copper movements share rail capacity. Emergency trucking can move grain outside the rail allocation but consumes substantially more diesel.

These couplings are deliberate. Relieving one constraint can expose another rather than increasing every outcome at once.

When diesel requests exceed stock, the kernel allocates it in a fixed, inspectable order: protected essential services, emergency trucking, rail grain, repair, then copper production. This is a scenario design choice, not a claim about the ethically or operationally correct priority in a real emergency.

### Copper and foreign exchange

Copper production claims diesel and rail capacity. Copper earns foreign exchange only when it is moved and exported through the port. Import contracts and repair spending draw foreign exchange immediately.

An emergency credit line can prevent an immediate cash failure but creates principal and weekly interest. A seeded early-payment offer advances cash against a later copper-delivery obligation; failure to deliver creates an explicit penalty.

### Repair and implementation

Port repair claims foreign exchange, implementation teams, repair-equipment throughput, and diesel. Nominal progress depends on the selected intensity and a declared seed-specific efficiency factor. Port capacity rises from 12 to 16 kt per week at 40 percent progress and to 20 kt per week at 80 percent progress.

Import contracting, changed ration policy, audits, emergency borrowing, and repairs can all claim implementation capacity. The decision validator rejects packages that exceed the available team pool.

### Rationing

Moderate and severe rationing reduce regional demand after a one-turn implementation delay. They also add a visible hardship burden. This is a stylized policy lever, not a behavioral or political model of ration compliance.

## Objectives

The runtime evaluates a priority-ordered vector rather than presenting one commensurable score:

1. avoid severe regional food shortfalls;
2. preserve essential diesel services;
3. keep foreign exchange above the emergency floor;
4. restore port throughput;
5. limit hardship and contractual damage; and
6. finish with defensible food and fuel coverage.

Objective states are guardrails for interpretation. Their secure, at-risk, and breached thresholds are design choices, not externally validated welfare boundaries.

## Information, uncertainty, and visibility

The engine separates true state from player-visible reports.

| Information | Player visibility |
|---|---|
| Foreign-exchange ledger, diesel stock, port capacity, shipment status | Treated as current operational data; a distant shipment shows its declared arrival window until the realised arrival becomes observable |
| Regional grain holdings | Reported with a one-turn lag and a seed-specific persistent bias |
| Domestic crop output | Initially estimated; revised at a declared seeded turn |
| Port repair efficiency | Hidden until revealed by a relevant audit; realised progress can still permit partial inference before the audit |
| Future closure, revision, and offer timing | Fixed in guided mode or drawn from declared ranges in other modes |
| Full causal contributions and hidden truth | Retained by the run; disclosure depends on the current interface/debrief context |

Randomness is pseudo-random and reproducible. A run seed fixes the closure turn, crop revision, regional stock revision, commercial-offer timing, repair efficiency, and reporting biases. Guided mode fixes the main event schedule while retaining a reproducible run identity. The RNG algorithm and scenario content identifier are stored with a run.

This reproducibility is a software property. It does not make the fictional outcomes predictive.

The dashboard’s diesel-coverage figure divides stock by a nominal 3 kt/week planning requirement. Actual modeled depletion varies with the committed transport, repair, mining, and essential-service demands, so the figure is a reference indicator rather than a forecast.

## Parameter provenance

The [parameter register](../scenarios/narrows/parameter-register.csv) labels values as:

- `fictional-assumed` — a declared property of the fictional setting;
- `design-tuned` — chosen to produce a legible decision problem; or
- `seeded-design-variant` — selected reproducibly from a declared range or set.

There are no empirical estimates or historical calibrations in version 0.1.0. Currency values are stored as integer USD cents where ledger equality matters; physical quantities use kilotonnes and are rounded at explicit model boundaries.

## Declared omissions

The vertical slice does not model:

- household behavior, demographics, nutrition, disease, or mortality;
- political legitimacy, coercion, corruption, bargaining, or organized non-compliance;
- market-clearing prices, inflation, exchange-rate dynamics, or a banking system;
- supplier default, maritime routing, vessel availability, insurance, or international diplomacy;
- detailed mine, rail, truck-fleet, or port engineering;
- labor markets, wages, firm balance sheets, or distribution within a region;
- ecological effects or weather beyond the declared port disruption;
- an optimizing planner or a claim that one policy package is uniquely correct; or
- an LLM as part of the causal model.

These omissions are model boundaries, not claims that the omitted mechanisms are unimportant.

## Limitations and validation status

Version 0.1.0 is a first vertical slice. Its mechanisms are intentionally compact and its thresholds are primarily pedagogical. Notable limitations include:

- several relationships are fixed ratios or hard caps;
- supplier lead times are discrete and do not yet model reliability distributions;
- administrative burden is represented by team slots rather than an institutional process;
- hardship is an ordinal scenario measure, not a welfare estimate;
- the observation model is illustrative rather than statistically calibrated;
- causal traces are mechanism-level and do not yet attribute every regional effect;
- run identifiers and compact hashes support prototype replay checks, not cryptographic provenance;
- the after-action review compares baseline policies but does not yet implement the specification’s four-week epilogue or “same decisions two weeks earlier” counterfactual;
- scenario balance has not been established through a broad human playtest;
- no learning-gain or transfer study has been conducted; and
- a structured scenario package exists, but the current TypeScript scenario model remains the runtime authority.

Engineering verification can establish replay, conservation, ledger, bounds, and serialization properties of the software. It cannot establish realism, educational efficacy, or external validity. The structured causal trace explains why the program changed a modeled variable; it is not evidence of causation in the real world.

## Privacy and external services

The simulation step has no network access, wall-clock dependency, or LLM dependency. Player decisions and notes can be processed locally in the browser. A hosted copy still exposes ordinary web-request metadata to its hosting provider, and users should not enter sensitive operational information into this training prototype.
