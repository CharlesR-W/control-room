# Sterling, 1931

Implementation-ready scenario design contract

Status: proposed scenario; historical calibration and play-balance work remain.

Scenario ID: `sterling-1931`

Default duration: 14 weekly decision turns, 22 June–27 September 1931.

Design risk: high. This is a historically grounded counterfactual, not a predictive
macroeconomic model or a claim that one policy could have produced a known outcome.

## Design verdict

Build this scenario after the lower-risk production, network, and project primitives
have established the multi-scenario runtime.

It is a strong finance/regime demonstration because its central problem is different
from the tutorial: the player must reconcile an exact reserve and credit ledger with
incomplete external-balance data, delayed domestic effects, institutional limits, and
a latent expectations process whose interpretation is disputed. It should not be the
second implementation: its high model risk warrants named behavioural variants,
historian review, and a sensitivity-first debrief before public release.

The scenario succeeds only if it keeps those layers separate. In particular:

- reserve settlements and credit liabilities are accounting facts;
- domestic banking liquidity is not the same thing as official foreign reserves;
- “confidence” is latent and appears only through observable market behaviour;
- fiscal, interest-rate, and communication effects vary across declared model regimes;
- leaving gold is a regime transition, not an automatic win or failure;
- the debrief may compare counterfactuals but must not identify “what would have
  happened.”

Do not ship a version in which austerity mechanically restores confidence, Bank Rate
increases always stop withdrawals, or British commercial banks collapse automatically
when official reserves fall.

## One-sentence thesis

Can a committee preserve an orderly payments and monetary system when defending a
fixed exchange-rate promise consumes scarce reserves, the remedies can deepen domestic
distress, and the information needed to judge the promise is late and incomplete?

## Player role and authority contract

The player chairs a fictional **Emergency Sterling Committee**. It is explicitly a
composite analytical role, not a historical institution.

The committee combines:

- Treasury coordination and fiscal-package design;
- recommendations to the Chancellor and Cabinet;
- liaison with the Bank of England on Bank Rate, liquidity, and foreign credits;
- debt-management and Treasury-bill recommendations;
- preparation of emergency legislation and exchange orders;
- commissioning and interpretation of fiscal, reserve, and banking reports.

The committee cannot directly:

- command the legally private and operationally independent Bank of England;
- bind Cabinet or Parliament;
- order foreign central banks or private creditors to lend;
- know the complete stock of short-term foreign sterling balances;
- guarantee how market participants interpret a policy;
- reverse settlements that occurred before a legal regime change took effect.

For playability, institutional acceptance is represented by visible eligibility rules
and lead times, not random hidden refusals. An action card must say whether the
committee is deciding, recommending, negotiating, or preparing. Exogenous approval is
named in the lifecycle milestone.

The briefing must include:

> You occupy a composite coordination role created for this simulation. No individual
> or committee in 1931 possessed all of these powers or all of this information.

## Learning objectives

By the end of a run, the player should be able to:

1. distinguish a reserve stock, a weekly settlement flow, and a matching credit
   liability;
2. explain why a fixed-parity defence can improve one objective while worsening
   unemployment, fiscal receipts, or money-market conditions;
3. distinguish exchange-market pressure from domestic bank insolvency or illiquidity;
4. reason from dated, revised, and incomplete observations rather than a live truth
   dashboard;
5. use reports and policy outcomes to discriminate between competing causal stories;
6. identify when contingency preparation creates option value without assuming that
   regime change is costless;
7. defend a decision using an objective vector rather than a scalar score.

## Historical and counterfactual boundary

The scenario starts from a historically calibrated state and includes a small number
of dated external disturbances. Player policy can then diverge.

Historically anchored:

- the statutory gold-convertibility obligation created by the Gold Standard Act 1925;
- the deterioration of Central European payments and the July German banking crisis;
- the publication date and information role of the May Committee report;
- the broad sequence of 1931 foreign-credit facilities;
- the actual Bank Rate series as a reference policy, not a forced path;
- the 21 September legislation suspending the bullion-sale obligation;
- contemporary limitations in external-liability and reserve reporting.

Counterfactual:

- rate, fiscal, liquidity, credit, communication, and preparation decisions;
- the timing and orderliness of a recommendation to suspend convertibility;
- market responses within a declared family of parameter regimes;
- whether a late withdrawal wave becomes self-reinforcing;
- domestic and external conditions at the end of the short epilogue.

The simulation does not claim to settle whether fiscal credibility, unemployment,
external-balance weakness, balance-sheet contagion, or expectations coordination was
the decisive cause of the historical exit.

## Calendar and run structure

| Turn | Week | Teaching emphasis | Historical anchor |
|---|---|---|---|
| 1 | 22–28 Jun | reserve identity and role limits | initial briefing |
| 2 | 29 Jun–5 Jul | external liabilities and observation gaps | market unease |
| 3 | 6–12 Jul | frozen claims and liquidity channels | Central Europe warning |
| 4 | 13–19 Jul | settlement pressure | German banking disruption |
| 5 | 20–26 Jul | rate defence versus domestic liquidity | rate-policy decision |
| 6 | 27 Jul–2 Aug | report vintages and fiscal news | May report publication |
| 7 | 3–9 Aug | emergency credit accounting | first credit facility window |
| 8 | 10–16 Aug | conditionality and implementation | continued reserve losses |
| 9 | 17–23 Aug | fiscal package and political feasibility | government crisis window |
| 10 | 24–30 Aug | policy consistency | National Government context |
| 11 | 31 Aug–6 Sep | maturity risk and option value | renewed pressure |
| 12 | 7–13 Sep | nonlinear withdrawal risk | late-crisis coordination |
| 13 | 14–20 Sep | defend versus prepare transition | severe reserve pressure |
| 14 | 21–27 Sep | orderly regime decision | historical suspension week |

After turn 14, run a deterministic four-week epilogue from the final state. The
epilogue reveals only directional, model-generated consequences for the exchange rate,
import prices, competitiveness, unemployment pressure, and credit servicing. It is
not another optimisation phase and must be labelled “model epilogue.”

## Play modes

The current runtime exposes `guided`, `professional`, and `sandbox`. Use those values
and store scenario-specific desk rules in scenario configuration.

### Guided: Analytic Desk

- staged action-family unlocks;
- fixed event timing and median stress parameters;
- clearer report annotations and causal vocabulary;
- forecast prompts with examples;
- no hidden selection among competing confidence regimes;
- pause points after turns 4, 8, 11, and 14.

### Professional: Historical Desk

- all legal action families available;
- historically plausible information delays and missing fields;
- a seeded, hidden parameter regime selected from the declared ensemble;
- no live confidence variable or future-event schedule;
- no advice about which policy is historically “correct.”

### Sandbox

- available after one completed run;
- state, parameter, and event inspection;
- regime selection and stress overrides;
- alternative start dates and action-capacity overrides;
- clearly labelled as non-comparable with scored run records.

## Simulation boundary

### Endogenous

- official gold and foreign-exchange reserve stocks;
- undrawn foreign credit and drawn external liabilities;
- weekly conversion and external-payment settlements;
- Bank Rate and domestic money-market liquidity;
- fiscal cash flows and published budget estimates;
- unemployment and a compact domestic-demand state;
- trade competitiveness and post-suspension import-price pressure;
- legal and operational readiness for regime transition;
- latent beliefs about whether parity will be maintained;
- report production, lag, revision, and player belief records.

### Exogenous or scenario-driven

- the Central European asset freeze;
- baseline world demand and foreign interest rates;
- scheduled publication of the May report;
- foreign counterparties’ maximum lending envelopes;
- a seed-dependent foreign-withdrawal disturbance;
- the legal background and parliamentary calendar.

### Outside the model

- a sector-complete national economy;
- household distribution beyond a limited hardship indicator;
- electoral outcomes and party strategy;
- empire-wide balance sheets;
- a full commercial-bank network;
- daily dealer microstructure;
- the long-run recovery after devaluation;
- a welfare theorem or historically unique optimal policy.

## Core causal map

The implementation must preserve this directional structure:

```text
Central European freeze ──> frozen external claims ──> merchant/acceptance-house strain
          │                                      └──> foreign balance withdrawals
          └──────────────────────────────────────────> settlement pressure

published fiscal gap ──> market interpretation ──┐
unemployment ────────> political/exit pressure ─┼──> conversion demand ──> reserves
communications ──────> policy consistency ──────┘           │
interest differential ────────────────┬─────────────────────┘
                                      └──> domestic demand ──> unemployment

external credit ──> reserves
        └─────────> external liability and future debt service

liquidity operations ──> domestic money-market liquidity
        └──────────────> not official reserves unless an explicit FX settlement follows

fiscal package ──> direct cash balance
       ├─────────> domestic demand and later receipts/benefits
       └─────────> regime-dependent market interpretation

suspension effective ──> end bullion-conversion settlement
       ├───────────────> floating exchange-rate adjustment
       ├───────────────> delayed import-price pressure
       └───────────────> delayed competitiveness change
```

No arrow labelled “confidence” may bypass a named observation, mechanism, parameter,
and causal contribution.

## State contract

All monetary ledger values are stored as integer minor units. The UI may display
`£m`, but calculations may not use binary floating point for money.

| State | Type and unit | Visibility | Notes |
|---|---|---|---|
| `monetary_regime` | enum | public | `gold_convertible`, `suspension_pending`, `floating` |
| `gold_fx_reserves` | money stock | estimated | official usable gold and FX |
| `earmarked_reserves` | money stock | committee | unavailable for ordinary settlement |
| `undrawn_external_credit` | money stock | committee | remaining facility |
| `drawn_external_liability` | money stock | committee | principal outstanding |
| `credit_service_due` | money flow/week | committee | contractual payment |
| `conversion_orders_pending` | money flow/week | hidden | realised next settlement |
| `foreign_sterling_liabilities` | money stock | hidden | incompletely surveyed |
| `frozen_central_europe_claims` | money stock | estimated | exposure, not reserve cash |
| `sterling_spot_rate` | USD/GBP or index | delayed public | fixed near parity before exit |
| `sterling_forward_pressure` | basis points/index | market proxy | confidence-related observation |
| `bank_rate` | percentage points p.a. | public | policy rate |
| `acceptance_market_liquidity` | bounded index | hidden | specialist external-finance strain |
| `clearing_bank_liquidity` | bounded index | estimated | separate from acceptance market |
| `fiscal_cash_balance` | money flow/week | Treasury | realised cash flow |
| `projected_budget_gap` | money/year | published estimate | vintage-specific forecast |
| `public_debt_short_maturity` | money stock | Treasury | refinancing exposure |
| `domestic_demand_gap` | index | hidden | slow state |
| `registered_unemployment` | persons or rate | delayed public | select one sourced series |
| `competitiveness_index` | index, base 100 | delayed | slow, reconstructed |
| `import_price_index` | index, base 100 | delayed | relevant after exit |
| `exit_belief` | probability-like latent state | never visible live | model mechanism, not fact |
| `policy_consistency` | bounded latent index | never visible live | traceable from actions |
| `legal_readiness` | bounded operational stock | committee | orders, bill, bank circulars |
| `committee_capacity` | integer team-weeks | public | shared action bottleneck |

### Headline dashboard limit

Show at most eight headline KPIs:

1. usable reserve buffer;
2. last week’s gross reserve loss and net change;
3. sterling market-pressure proxy;
4. Bank Rate;
5. undrawn credit and next debt service;
6. latest projected budget gap, with vintage;
7. latest unemployment observation, with observation date;
8. domestic money-market liquidity proxy.

Regime status, turn date, report freshness, and free committee capacity are persistent
status fields, not additional KPIs.

## Accounting and transition equations

The reserve ledger is exact:

$$
R_{t+1}
= R_t
+ C_t
+ I_t
- S_t
- P_t
- X_t,
$$

where $C_t$ is external-credit cash drawn, $I_t$ is other gold/FX inflow, $S_t$ is
convertibility settlement, $P_t$ is contractual external payment, and $X_t$ is
explicit intervention or operating use. A credit draw increases cash and matching
external principal by the same amount.

Realised conversion demand is:

$$
D_t
= F_t
+ W_t
+ A_t
+ E_t
- Q_t
- K_t,
$$

where $F_t$ is fundamental external settlement pressure, $W_t$ foreign-balance
withdrawal, $A_t$ asset-freeze-related recall, $E_t$ expectation/coordination demand,
$Q_t$ the rate-response term, and $K_t$ the legally active control effect. Terms are
floored at zero only after their signed contributions have been traced.

Under `gold_convertible`, eligible realised orders settle against usable reserves.
Under `floating`, bullion-conversion settlement is zero, although external debt
service and ordinary payments remain due.

Suspension never removes an external liability, adds reserves, or reverses a completed
settlement. It changes the legal conversion rule and activates a declared exchange-rate
adjustment mechanism.

The domestic-demand and unemployment equations are deliberately compact and lagged.
Bank Rate and fiscal changes enter distributed lags; unemployment cannot react fully
within one weekly turn. Fiscal tightening improves the direct cash projection but may
reduce later receipts or increase benefit spending through the cyclical channel.

## Action catalogue

There are exactly eight action families. Cards expose discrete packages and named
options rather than unconstrained continuous sliders.

| Family | Typical cost | Earliest effect | Persistence |
|---|---:|---|---|
| Bank Rate stance | 1 team | next business day | until changed |
| Fiscal package | 2–3 teams | announcement now; cash 2–4 weeks | package-specific |
| External credit | 2 teams | negotiation 1–3 weeks; draw after agreement | contractual |
| Funding and liquidity | 1–2 teams | same or next turn | operation-specific |
| Exchange-emergency preparation | 1–2 teams | readiness after 1–2 turns | decays slowly |
| Public commitment | 1 team/attention | immediate interpretation | short-lived |
| Regime recommendation | 2 teams plus legal gate | same/next turn when eligible | irreversible |
| Information and audit | 1 team | report after 1–2 turns | dated observation |

### 1. Bank Rate stance

Options: hold, increase by a listed increment, or reduce by a listed increment.

- The committee recommends a stance jointly with the Bank.
- The card shows the historical current rate and legal range.
- A rise can reduce conversion demand through an uncertain, lagged rate response.
- It tightens domestic demand and refinancing conditions through delayed channels.
- Repeated rises face diminishing exchange effects and increasing domestic costs.
- Rate changes never directly create gold or FX.

### 2. Fiscal package

Options are authored packages: tax measures, departmental reductions, transfer or
benefit changes, temporary borrowing, or a mixed package.

- Every package separates announcement, legislation, and realised weekly cash.
- Distributional and unemployment-pressure effects are named.
- The published projected gap may improve before cash does.
- The market-interpretation coefficient belongs to the active parameter regime.
- Package cancellation leaves sunk capacity and may reduce policy consistency.
- No card says “restore confidence”; it states the hypothesised signal.

### 3. External credit negotiation and draw

The player selects counterparty class, requested amount, maturity, and acceptable
conditions from authored offers.

- Negotiation reserves capacity before an agreement exists.
- A facility has a maximum, fee, rate, maturity, expiry, and draw schedule.
- Drawing increases reserves and external liabilities equally.
- Counterparty willingness responds to observable reserve coverage and the active
  regime, within a visible offer envelope.
- Exact political conditionality is not hard-coded as settled historical fact.
- Credit buys time; it does not improve net worth by the principal drawn.

### 4. Domestic funding and money-market liquidity

Options include Treasury-bill maturity adjustments, open-market purchases, eligible
collateral liquidity, or a conservative funding posture.

- Operations affect clearing-bank or acceptance-market liquidity.
- Balance-sheet entries and collateral limits are explicit.
- Supporting domestic liquidity can coexist with official reserve loss.
- Any exchange-market effect must travel through a named rate, expectations, or
  settlement mechanism.
- This family cannot be used to manufacture FX reserves.

### 5. Exchange-emergency preparation and controls

Options include drafting legislation, preparing exchange orders, surveying banks,
preparing dealer instructions, and activating legally authorised measures.

- Preparation raises `legal_readiness`; it does not itself block conversion.
- Before a statutory gateway, activation is invalid.
- After suspension, a narrow, temporary order can reduce eligible flows at an
  administrative and trade-friction cost.
- Broad pre-suspension “capital controls” are not available as a magic switch.
- Readiness reduces transition delay and operational disruption if suspension occurs.

### 6. Public commitment and communications

Options: unconditional parity defence, conditional defence, factual reserve briefing,
credit announcement, or prepare-the-public transition statement.

- Each communication has a factual precondition and an attention cost.
- Effects depend on consistency with reserves, legal readiness, and material policy.
- Repeating unsupported assurances has diminishing or negative effect.
- Communications modify belief formation only; they never write the reserve ledger.
- The decision record retains the exact claim for later calibration and debrief.

### 7. Regime recommendation

Options: continue convertibility, recommend contingent suspension, or recommend
immediate emergency legislation.

- Suspension requires a legal milestone and cannot be cancelled after effect.
- With sufficient readiness and emergency eligibility, legislation can take effect
  before the next settlement window.
- Without readiness, the bill takes a full turn and the current settlement still runs.
- Already completed orders are not reversed.
- Suspension ends the bullion-sale obligation but not debt service or ordinary
  external payments.
- Orderliness, preparation, import-price exposure, and banking continuity remain
  objectives after exit.

### 8. Information and audit

Reports: reserve reconciliation, maturity survey, capital-flow classification, fiscal
re-estimate, acceptance-house exposure return, or clearing-bank liquidity return.

- Every report has `as_of`, `published_at`, coverage, error band, and revision status.
- Reports reveal a noisy dated estimate, not the current truth.
- A survey may narrow uncertainty in later reports but never grants omniscience.
- Repeating a report too quickly returns little new information.
- The debrief can reveal hidden truth and compare it with each report vintage.

## Capacity, queues, and feasibility

Default weekly committee capacity is a calibration parameter, initially proposed as
four team-weeks. This number is `assumed` until playtesting.

All actions use the normal lifecycle:

`drafted → committed → queued → implementing → active → completed`

Terminal alternatives are `expired`, `cancelled`, or `failed`.

Validation must reject:

- spending more team capacity than available;
- drawing beyond an agreed undrawn facility;
- activating controls without legal authority;
- a second incompatible fiscal package in the same implementation slot;
- cancelling an irreversible or already settled milestone;
- rate values outside the authored catalogue;
- suspension after suspension;
- reports whose required institutional access is unavailable.

Binding records show requested, available, and realised capacity, reserves, credit,
collateral, legal readiness, and market-liquidity resources.

## Events

Use three scenario events, not a deck of arbitrary shocks.

### E1. Central European payments freeze

Scheduled warning in turns 2–3 and material disruption in turn 4.

Effects:

- raises frozen Central European claims;
- increases acceptance-market strain;
- increases the foreign-balance withdrawal component;
- widens uncertainty in incomplete external-liability estimates.

It stresses channels already in the model. It does not directly subtract an authored
lump sum from reserves without a corresponding settlement contribution.

### E2. May Committee report publication

Scheduled publication in turn 6, corresponding to 31 July.

Effects:

- releases a new projected-budget vintage;
- changes the public information set;
- may affect expectations according to the selected parameter regime;
- creates fiscal and communications options.

Publication itself does not mechanically remove reserves or raise unemployment.

### E3. Withdrawal coordination

State-triggered during turns 11–14 when reserve coverage, forward pressure, foreign
liability exposure, and latent exit belief cross a seeded threshold.

- A warning proxy appears before the full event unless the highest-stress seed applies.
- The event bunches otherwise modelled withdrawals; it does not invent a new stock.
- Preparatory policy can reduce disruption but cannot erase underlying obligations.
- Historical headlines may appear as flavour, but no single incident is coded as the
  uniquely decisive cause.

Event thresholds and magnitudes are pinned to the run seed and content hash.

## Weekly step order

The scenario model must execute this order:

1. validate submitted actions against opening state and legal authority;
2. reserve committee, collateral, fiscal, and credit resources;
3. create action records and enqueue milestones;
4. apply opening-of-week legal and implementation milestones;
5. release scheduled reports and public-information events;
6. update latent beliefs from the opening material state and public information;
7. realise foreign withdrawal and conversion demand;
8. settle convertibility orders, credit draws, and contractual external payments;
9. execute domestic funding and liquidity operations;
10. post fiscal cash, debt, interest, and facility-fee ledger entries;
11. update domestic demand, unemployment, competitiveness, and import prices;
12. create new estimates, reports, revisions, and market observations;
13. evaluate objectives, failure conditions, and lifecycle transitions;
14. emit binding records, invariants, and causal traces.

A regime change applied in step 4 can affect step 8. A recommendation that has not
completed its legal milestone cannot. Nothing submitted this turn can retroactively
cancel a settlement posted in an earlier turn.

## Observation model

The UI maintains three distinct layers:

- **truth**, used only by the engine and post-run debrief;
- **institutional estimate**, a dated report with uncertainty and coverage;
- **player belief**, a forecast or note stored in the Decision Book.

Historical Desk must not expose:

- `exit_belief`;
- current true conversion orders;
- the complete foreign-liability stock;
- future event timing or thresholds;
- the active confidence-regime label;
- exact future policy multipliers.

Observable proxies include:

- spot deviation or pressure at the gold points;
- forward discount or dealer-pressure index;
- gross versus net reserve changes from delayed returns;
- withdrawal notices and settlement queues;
- offered credit terms;
- acceptance-market spreads;
- clearing-bank liquidity returns;
- report revisions and coverage warnings.

The weekly Bank Return is not treated as a complete real-time statement of all usable
official FX resources. The report interface must explain omissions and vintage dates.

## Player-facing views

### Situation room

Objective vector, eight headline KPIs, data-freshness badges, current regime, capacity,
and the next legally meaningful deadline.

### Reserve ledger

Opening reserves, gross inflows, credit draws, conversions, ordinary external
payments, intervention, earmarking, and closing reserves. External principal is shown
alongside, never netted away invisibly.

### Sterling market

Parity, gold points or pressure band, spot observation, forward-pressure proxy, dealer
commentary, and known settlement notices. No confidence gauge.

### External balance sheet

Estimated short foreign sterling liabilities, frozen claims, credit facilities,
drawn principal, maturity ladder, coverage, and survey quality.

### Domestic economy

Bank Rate, money-market and acceptance-house liquidity proxies, fiscal cash and
forecast vintages, unemployment, and slow demand indicators.

### Policy pipeline

Action lifecycle, capacity reservations, legal milestones, dependencies, cancellation
costs, and expected earliest effects.

### Reports and Decision Book

Immutable reports by `as_of` and `published_at`, revision chains, player forecasts,
rationales, selected evidence, and later calibration.

## Forecast prompts

Before commitment, require at least two:

- expected next-week reserve change as a point or range;
- expected reserve coverage under the visible stress case;
- most likely binding constraint next turn;
- four-week direction of unemployment pressure;
- which incoming observation would discriminate between the player’s two leading
  causal explanations;
- conditions under which the current parity recommendation should be reconsidered.

The engine stores the forecast, uncertainty range, rationale, and information vintage.
Do not convert subjective forecasts into hidden-state truth.

## Objective vector and terminal states

Objectives are priority-ordered and never collapsed into one score:

1. **Avoid disorderly settlement failure** — hard constraint.
2. **Maintain payments and money-market operation** — hard constraint.
3. **Avoid arrears on external credit obligations** — hard constraint.
4. **Limit cumulative unemployment and domestic contraction** — high-priority soft
   objective.
5. **Preserve fiscal capacity and truthful reporting** — soft objective.
6. **Maintain parity while feasible or execute an orderly transition** — soft,
   path-dependent objective.

Failure conditions:

- usable reserves reach zero while eligible conversion settlements remain under
  `gold_convertible`;
- an eligible settlement queue is unpaid;
- the payments-system liquidity index remains below its failure floor for two turns;
- contractual external debt service enters arrears;
- a corrupt state violates a ledger or regime invariant.

Suspension is not failure. Continuing parity is not victory. The outcome label is a
profile such as:

- `parity-preserved / severe-domestic-cost`;
- `orderly-transition / obligations-current`;
- `late-transition / operational-disruption`;
- `disorderly-settlement-failure`;
- `payments-breakdown`;
- `external-arrears`.

## Guided learning arc

- Turns 1–2 unlock Bank Rate, audit, and factual communication.
- Turns 3–4 unlock liquidity and teach frozen claims versus reserves.
- Turns 5–6 unlock authored fiscal packages and report-vintage comparison.
- Turns 7–8 unlock credit negotiation and matching-liability accounting.
- Turns 9–10 unlock emergency preparation and policy-consistency inspection.
- Turns 11–12 expose contingent suspension planning and nonlinear withdrawal risk.
- Turns 13–14 require an explicit regime recommendation and transition plan.

Each pause asks the player to reconcile one trace before continuing.

## Debrief contract

The debrief follows this order:

1. outcome profile and hard-constraint status;
2. player forecasts versus observations, by vintage;
3. reserve and external-credit ledger reconciliation;
4. action lifecycle and implementation timeline;
5. objective trade-off paths;
6. revealed hidden state and report error;
7. causal contribution waterfalls for key turns;
8. comparison with baseline policies under the same seed;
9. sensitivity across competing parameter regimes;
10. historical comparison and source limitations;
11. transfer questions.

Required exhibits:

- gross and net reserve waterfall;
- credit cash versus matching liability;
- Bank Rate, domestic liquidity, and unemployment on aligned dates;
- fiscal estimate vintage chart;
- observed forward pressure versus latent exit belief, revealed only now;
- action Gantt chart;
- objective-vector trajectory;
- same-seed baseline comparison;
- one-at-a-time and regime-level sensitivity views.

Transfer questions:

- Which observation changed your view, and was it a flow, stock, or estimate?
- Did a policy buy time, improve solvency, or merely alter reported confidence?
- What evidence would distinguish balance-sheet contagion from a fiscal signal?
- At what point did preparation have more option value than another defence measure?
- Which harm was displaced across time or across objectives?

## Causal trace requirements

Every headline delta must reconcile through structured `Contribution` records.

Required trace targets:

- `gold_fx_reserves`;
- `conversion_demand`;
- `drawn_external_liability`;
- `acceptance_market_liquidity`;
- `clearing_bank_liquidity`;
- `fiscal_cash_balance`;
- `projected_budget_gap`;
- `domestic_demand_gap`;
- `registered_unemployment`;
- `sterling_spot_rate`;
- `competitiveness_index`;
- `import_price_index`;
- `exit_belief`, revealed only after the run.

Each contribution names:

- target and amount/unit;
- mechanism;
- source state and parameter IDs;
- related action and event IDs;
- active parameter-regime ID;
- any binding record;
- a concise explanation generated from those fields.

Prose may not claim a causal effect that is absent from the trace.

## Invariants

The implementation must test:

- opening plus ledger entries equals closing reserves exactly;
- a credit draw increases cash and matching principal equally;
- drawn, undrawn, expired, and maximum facility amounts reconcile;
- money stocks cannot become negative unless explicitly typed as signed flows;
- all weekly/annual fiscal conversions use one declared exact convention;
- convertibility settlements occur only while legally active;
- suspension is irreversible within the horizon;
- no legal change reverses an earlier settlement;
- liquidity operations do not directly add official FX;
- spot remains within the fixed-regime mechanism or creates a named failure;
- report vintages are immutable and revisions link to predecessors;
- visible snapshots contain no hidden state or future schedule;
- every committed action reaches a valid terminal or active lifecycle state;
- causal contributions sum to every displayed delta;
- all seeded runs are deterministic and replayable;
- save/load and branch preserve pinned content and RNG state;
- no state contains `NaN` or infinity.

## Parameter regimes and disagreement

Professional mode selects one regime from a versioned ensemble and does not reveal it
until debrief.

### R1. Balance-sheet contagion

- high sensitivity to frozen Central European claims and maturity recall;
- specialist acceptance-market stress exceeds clearing-bank stress;
- liquidity operations strongly protect domestic market functioning;
- fiscal communications have weak short-run withdrawal effects.

This regime reflects the mechanism emphasised in Accominotti’s full-text research and
is compatible with later work finding British clearing-bank stability.

### R2. Unemployment and commitment

- exit belief is more sensitive to unemployment and the domestic cost of defence;
- rate increases have diminishing external effect and stronger domestic lag effects;
- political inconsistency raises withdrawal coordination risk;
- fiscal tightening can weaken the medium-horizon fiscal position through contraction.

This is a model interpretation associated with the Eichengreen–Jeanne argument, whose
paper was available here only through abstract/catalogue metadata.

### R3. Fiscal-credibility orthodoxy

- the published fiscal gap and credible implementation have a larger short-run market
  interpretation effect;
- unsupported announcements still backfire;
- direct fiscal arithmetic remains separate from cyclical feedback;
- external balance-sheet pressure remains present.

This represents an influential contemporary causal view, not an endorsed truth.

### R4. External-balance correction

- trade and liability fundamentals dominate communication;
- rate and fiscal signals have limited capacity to offset withdrawals;
- parity is more vulnerable when competitiveness is weak;
- an orderly exit changes future trade channels only with a lag.

Use parameter ensembles, not separate bespoke engines. The parameter register must
allow low/high expectation sensitivity and low/high fiscal-signal weight to be varied
independently for sensitivity analysis.

## Parameter register and calibration

Every parameter is tagged `sourced`, `derived`, `calibrated`, `assumed`, or
`fictional`.

Sourced anchors:

- statutory regime and dates;
- parity convention;
- Bank Rate dates and values;
- dated credit-facility envelopes and terms where primary records support them;
- weekly Bank balance-sheet series;
- unemployment and fiscal report vintages where recoverable;
- event and publication dates.

Derived:

- reserve-coverage ratios;
- maturity buckets;
- weekly conversions from annual fiscal flows;
- pressure and liquidity indices built from sourced series.

Calibrated:

- withdrawal response to rates;
- domestic-demand and unemployment lags;
- expectation coordination thresholds;
- report error distributions;
- post-suspension exchange adjustment.

Assumed:

- committee capacity;
- action lead times not recoverable from records;
- deterministic institutional-acceptance rules;
- guided-mode warning strength.

Fictional:

- the committee itself;
- authored memo text and named staff;
- composite market-pressure observations where no weekly series exists.

Do not invent an exact initial reserve or liability number in prose. Extract the
opening calibration from the pinned weekly dataset and record the transformation.
Later official accounts and contemporary statements use different measures. Snowden’s
21 September statement described more than £200 million in gold and foreign-exchange
loss over two months and £70 million locked in Germany, while a later Bank of England
account described about £60 million of reserves lost and £130 million of credits used.
Treat these as different gross/official/credit measures and reconcile them; do not
average them into one stock.

## Baseline policies

Run every seed against:

- **Minimal:** hold settings, take no new credit, commission no reports.
- **Reactive defender:** raise Bank Rate and tighten fiscally after reserve-loss
  thresholds; no early preparation.
- **Competent buffer:** early liability survey, modest rate response, targeted
  liquidity, contingent credit, truthful communication, and prepared suspension when
  stressed coverage breaches a declared floor.
- **Adversary:** searches for action spam, free credit, last-turn suspension,
  cancellation, and observation-leak exploits.

Also provide a non-normative **historical-reference decision trace**. It follows the
broad actual sequence where data permit, but is not labelled competent or optimal.
Until the runtime generalises baseline enums, store it as a reference replay rather
than replacing the four standard baseline policies.

## Verification and 100-seed acceptance

Before release:

- initialise, step, save/load, replay, and branch exactly;
- validate every option and every invalid precondition;
- trigger each event once and only once;
- cover every action lifecycle;
- verify report lag, error, and revision behaviour;
- test all invariants at parameter extremes;
- reconcile every headline trace;
- verify that future schedules and hidden regimes never enter visible JSON;
- run all four standard baselines across at least 100 pinned seeds per regime.

Release gates, explicitly software-design targets rather than historical findings:

- zero invariant, replay, serialization, or non-finite-number failures;
- the competent baseline avoids disorderly settlement failure in at least 90 of 100
  ordinary-stress seeds after calibration;
- the adversary never creates reserves, erases liabilities, activates illegal controls,
  or retroactively avoids settlement;
- minimal and reactive policies expose meaningful failure modes under high stress;
- no policy weakly dominates every other policy on every objective and regime;
- at least one material policy ranking reverses across defensible regimes;
- extreme stress may defeat all policies, but through named constraints and traces;
- guided-mode median seeds remain completable without foreknowledge.

These targets must be revised if calibration evidence shows they can be met only by
distorting historical ranges.

## Exploit and misleading-model audit

Test explicitly for:

- communication spam producing free confidence;
- repeated fiscal announcements without implementation;
- treating external credit as reserve wealth without debt;
- monotonic Bank Rate increases as a dominant action;
- open-market operations manufacturing foreign exchange;
- a last-turn suspension erasing prior harm;
- controls operating before legislation;
- audit reports revealing current truth or future events;
- a confidence index telegraphing the hidden regime;
- unemployment moving implausibly within one week;
- policy churn avoiding capacity or sunk cost;
- event flavour text being mistaken for a causal coefficient;
- hard-coded historical suspension regardless of state;
- parity defence or fiscal retrenchment being presented as a moral good;
- devaluation being presented as painless or immediately expansionary.

## Package and runtime contract

The scenario package should contain:

- manifest and mode configuration;
- authored action catalogue and preconditions;
- observation/report definitions;
- event definitions;
- objective and terminal-state definitions;
- parameter register and regime ensembles;
- briefing and guided pause content;
- source register and model card;
- baseline policies and historical reference trace.

`initialize` creates pinned truth, empty decision history, initial reports, action
capacity, event schedule, parameter regime, and RNG state.

`validateAction` returns structured eligibility, capacity, legal, dependency, and
range errors.

`step` follows the ordered weekly phase contract above and emits state, observations,
reports, events, lifecycle transitions, objectives, invariants, bindings, and traces.

`visibleSnapshot` applies mode-specific visibility and must be safe to serialize
directly to the client.

`buildDebrief` may reveal truth and regime parameters only after the terminal state.

All state transitions remain pure, deterministic, serializable, and free of wall-clock,
browser, network, or unseeded-random dependencies.

## Source register and access status

Access status is recorded because abstract-only evidence must not be treated as if the
full argument or data were reviewed.

### Primary and official sources, full text accessed

- [Gold Standard Act 1925](https://www.legislation.gov.uk/ukpga/Geo5/15-16/29/pdfs/ukpga_19250029_en.pdf):
  statutory bullion-sale and parity context.
- [Gold Standard (Amendment) Act 1931](https://www.legislation.gov.uk/ukpga/Geo5/21-22/46/pdfs/ukpga_19310046_en.pdf):
  suspension and temporary Treasury exchange powers.
- [Hansard, Gold Standard Amendment Bill, 21 September 1931](https://api.parliament.uk/historic-hansard/commons/1931/sep/21/gold-standard-amendment-bill):
  contemporary government account of reserve losses, frozen assets, credit, and the
  decision to suspend. Treat causal claims as participant testimony.
- [Hansard, second reading, 21 September 1931](https://api.parliament.uk/historic-hansard/commons/1931/sep/21/gold-standard-amendment-bill-1):
  contemporary disagreement about powers, controls, and hardship.
- [Hansard, Bank Rate, 24 September 1931](https://api.parliament.uk/historic-hansard/lords/1931/sep/24/bank-rate):
  contemporary rate debate; use the official rate dataset for exact implementation.
- [Hansard, British Treasury credits, 30 September 1931](https://api.parliament.uk/historic-hansard/commons/1931/sep/30/british-treasury-credits-bank-of-england):
  political testimony on terms and alleged conditions, not neutral proof.
- [Hansard, National Economy Bill, 11 September 1931](https://hansard.parliament.uk/Commons/1931-09-11/debates/a519e565-0b98-4513-9b4d-597448c10669/NationalEconomyBill):
  contemporary dispute over contraction, unemployment, and the budget.
- [Bank of England, holdings of gold and foreign exchange 1924–31](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/1970/boes-holdings-of-gold-and-foreign-exchange-1924-31.pdf):
  reconstructed holdings, valuation, and omissions.
- [Bank of England, Exchange Equalisation Account origins](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/1968/the-exchange-equalisation-account-its-origins-and-development.pdf):
  parity, reserve loss, and credit measures.
- [Bank of England, interwar balance of payments](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/1972/the-balance-of-payments-in-the-inter-war-period.pdf):
  severe contemporary external-liability data limitations.
- [Bank of England research datasets](https://www.bankofengland.co.uk/statistics/research-datasets):
  weekly balance-sheet and millennium macro datasets.
- [Bank of England Bank Rate history](https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp?os=i):
  implementation source for exact rate dates.
- [Federal Reserve Bulletin, November 1931](https://fraser.stlouisfed.org/title/federal-reserve-bulletin-62/november-1931-20720/fulltext):
  contemporary description of the August central-bank credit arrangements.
- [Federal Reserve Bank of New York annual report, 1931](https://fraser.stlouisfed.org/files/docs/historical/frbny/1931_frb_newyork.pdf):
  contemporary New York institutional account.
- [BIS Second Annual Report, 1932](https://www.bis.org/publ/arpdf/archive/ar1932_en.pdf):
  contemporary account of short-credit withdrawal and maturity mismatch.

### Scholarship, full text accessed

- [Olivier Accominotti, “International Banking and the Transmission of the 1931
  Financial Crisis”](https://eprints.lse.ac.uk/87788/1/Accominotti_International%20Banking%20and%20Transmission_Accepted.pdf):
  London merchant-bank and acceptance-market transmission mechanism.
- [Matthias Römer, “Financial crisis of 1931? British banking stability and the role
  of open-market operations”](https://www.econstor.eu/bitstream/10419/330191/1/EHR_EHR13391.pdf):
  evidence on clearing-bank stability and Bank of England liquidity operations.
- [Michael Bordo, comment on sterling in
  1931](https://www.nber.org/system/files/chapters/c13085/c13085.pdf):
  critique emphasising overvaluation, the external account, and perceived deficits.
- [Lennard and Parker, “Devaluation, Exports, and Recovery from the Great
  Depression”](https://eprints.lse.ac.uk/126517/1/DevaluationExportsRecovery_LennardPaker.pdf):
  modern reconstruction of later export and employment effects; use only in epilogue
  sensitivity, not as a weekly crisis transition equation.

### Abstract or catalogue only

- [Eichengreen and Jeanne, “Currency Crisis and Unemployment: Sterling in
  1931”](https://ideas.repec.org/p/nbr/nberwo/6563.html): abstract/metadata only;
  informs a hypothesis regime, not numeric calibration.
- [Billings and Capie, “Financial crisis, contagion, and the British banking system
  between the world wars”](https://doi.org/10.1080/00076791.2011.555105):
  abstract/metadata only; use only for the existence of the banking-crisis dispute.
- May Committee Report, Cmd. 3920, Open Library work record OL36947288W:
  catalogue metadata only; do not infer detailed recommendations from this record.
- [Bank of England archive, Macmillan Committee foreign-balance
  return](https://www.bankofengland.co.uk/CalmView/Record.aspx?id=EID1%2F3&src=CalmView.Catalog):
  catalogue metadata only.

## Model-card warnings

Display before the first run and repeat in debrief:

- This is a compressed weekly teaching model, not a forecast.
- The player role is composite and counterfactual.
- “Confidence” is a latent modelling device inferred from behaviour, not an observed
  historical meter.
- Parameter regimes encode genuine scholarly and contemporary disagreement.
- British clearing banks, merchant banks, and the acceptance market are not one system.
- Fiscal packages represent real hardship and distributional choices, not cheap score
  modifiers.
- The epilogue is too short to establish long-run recovery or welfare.
- A successful run demonstrates internal strategy under assumptions, not historical
  proof.

## Open implementation decisions

Resolve and record before calibration freeze:

- exact opening reserve definition and the treatment of earmarked assets;
- sourced unemployment series and weekly interpolation rule;
- which forward-market proxy is defensible at weekly frequency;
- credit-offer dates, maturities, and fees supported by primary records;
- legal-readiness threshold for same-turn emergency effect;
- fiscal cash/annual forecast conversion convention;
- clearing-bank and acceptance-market liquidity index construction;
- post-suspension exchange adjustment range;
- ordinary versus extreme seed distribution;
- committee capacity and action lead times.

None of these may be silently buried in code. Each belongs in the parameter register,
with provenance and sensitivity range.

## Definition of done

The scenario is ready for content freeze when:

- the role and historical boundary appear verbatim in briefing and model card;
- all eight action families have complete lifecycle, resource, legal, and trace data;
- every displayed variable has a unit, visibility rule, and observation source;
- reserve, credit, fiscal, and liquidity accounts reconcile under extreme tests;
- all parameter regimes run through one shared engine;
- the 100-seed gates pass without distorting sourced anchors;
- debrief claims are generated from traces and labelled by evidence status;
- a historian can identify where the scenario is sourced, assumed, or fictional;
- a player cannot discover a universal dominant action or hidden-state leak;
- save/load, replay, and branch remain bit-for-bit deterministic.
