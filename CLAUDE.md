# Control Room

## Purpose

This repository implements a browser-local vertical slice of the Control Room
serious systems-simulation platform. The shipped scenario is **The Narrows**.

## Architecture

- Keep `src/lib/sim/` pure, deterministic, serializable, and independent of React.
- Never use `Math.random`, wall-clock time, network calls, or browser globals in the
  simulation kernel.
- The event-sourced decision history is authoritative; snapshots are replay caches.
- All player-facing explanations must come from structured causal contributions.
- The UI may persist run records in `localStorage`, but the core must remain headless.

## Verification

Run `npm run check` before publishing. This executes strict TypeScript checking,
the deterministic/invariant test suite (including the 100-seed smoke), and the
production Next.js build.

## Product boundaries

The simulation is fictional and analytic, not predictive. Do not add an LLM to the
causal loop or expose hidden state during live play. Prefer a transparent declared
mechanism over a broader but ambiguous model.
