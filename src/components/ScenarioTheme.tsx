const THEME_LABELS: Record<string, { label: string; code: string }> = {
  "the-narrows": { label: "National supply desk", code: "SEL / 01" },
  "controlled-materials-1943": { label: "Allocation board", code: "CMP / 43" },
  "north-atlantic-1942": { label: "Convoy plot", code: "NATL / 42" },
  "apollo-integration-1966": { label: "Integration console", code: "PGM / 66" },
  "sterling-1931": { label: "Reserve ledger", code: "STG / 31" },
  "bottleneck-economy-1981": { label: "Adjustment network", code: "BNE / 81" },
};

export function themeLabelForScenario(scenarioId: string) {
  return THEME_LABELS[scenarioId] ?? { label: "Control desk", code: "CR / 00" };
}

export function ScenarioEmblem({
  scenarioId,
  compact = false,
}: {
  scenarioId: string;
  compact?: boolean;
}) {
  const copy = themeLabelForScenario(scenarioId);
  return (
    <div
      className="scenario-emblem"
      data-scenario={scenarioId}
      data-compact={compact || undefined}
      aria-hidden="true"
    >
      <span className="scenario-emblem__shape">
        <i />
        <i />
        <i />
      </span>
      {!compact ? (
        <span className="scenario-emblem__copy">
          <strong>{copy.label}</strong>
          <small>{copy.code}</small>
        </span>
      ) : null}
    </div>
  );
}
