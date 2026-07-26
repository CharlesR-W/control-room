import { round } from "./determinism.ts";
import type {
  Cargo,
  VisibleCargoAvailability,
  VisibleSnapshot,
} from "./types.ts";

/**
 * Derives only from the player-visible pipeline. A delayed shipment contributes
 * to the confirmed amount only once its latest disclosed arrival is no later
 * than the decision turn; otherwise it contributes only to the possible amount.
 */
export function visibleCargoAvailability(
  snapshot: VisibleSnapshot,
  cargo: Cargo,
  forTurn = snapshot.turn + 1,
): VisibleCargoAvailability {
  let queuedNowKt = 0;
  let confirmedByTurnKt = 0;
  let possibleByTurnKt = 0;

  for (const shipment of snapshot.shipments) {
    if (
      shipment.cargo !== cargo ||
      shipment.remainingKt <= 0 ||
      shipment.status === "unloaded"
    ) {
      continue;
    }

    const queued =
      shipment.status === "arrived" ||
      shipment.status === "queued-at-port";
    if (queued) {
      queuedNowKt += shipment.remainingKt;
      confirmedByTurnKt += shipment.remainingKt;
      possibleByTurnKt += shipment.remainingKt;
      continue;
    }

    if (shipment.expectedArrivalWindow.latestTurn <= forTurn) {
      confirmedByTurnKt += shipment.remainingKt;
      possibleByTurnKt += shipment.remainingKt;
    } else if (shipment.expectedArrivalWindow.earliestTurn <= forTurn) {
      possibleByTurnKt += shipment.remainingKt;
    }
  }

  const confirmed = round(confirmedByTurnKt);
  const possible = round(Math.max(confirmed, possibleByTurnKt));
  return {
    cargo,
    forTurn,
    queuedNowKt: round(queuedNowKt),
    confirmedByTurnKt: confirmed,
    possibleByTurnKt: possible,
    uncertainKt: round(possible - confirmed),
  };
}
