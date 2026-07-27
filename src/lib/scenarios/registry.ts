import { apolloIntegrationModel } from "./apollo-integration/model.ts";
import { bottleneckEconomyModel } from "./bottleneck-economy/model.ts";
import { controlledMaterialsModel } from "./controlled-materials/model.ts";
import { northAtlanticModel } from "./north-atlantic/model.ts";
import { sterling1931Model } from "./sterling-1931/model.ts";
import type { AnyScenarioModel } from "./types.ts";

export const scenarioModels: AnyScenarioModel[] = [
  controlledMaterialsModel,
  northAtlanticModel,
  apolloIntegrationModel,
  sterling1931Model,
  bottleneckEconomyModel,
];

const scenarioRegistry = new Map(
  scenarioModels.map((model) => [model.metadata.id, model]),
);

export function getScenarioModel(scenarioId: string): AnyScenarioModel {
  const model = scenarioRegistry.get(scenarioId);
  if (!model) throw new Error(`Unknown scenario: ${scenarioId}.`);
  return model;
}
