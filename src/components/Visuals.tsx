import { useId } from "react";

export type Tone = "teal" | "amber" | "red" | "blue" | "neutral";

export function Sparkline({
  values,
  label,
  tone = "teal",
}: {
  values: number[];
  label: string;
  tone?: Tone;
}) {
  const gradientId = useId().replace(/:/g, "");
  const safeValues = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const range = max - min || 1;
  const points = safeValues
    .map((value, index) => {
      const x = (index / (safeValues.length - 1)) * 100;
      const y = 36 - ((value - min) / range) * 29;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className={`sparkline sparkline--${tone}`}
      viewBox="0 0 100 40"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".24" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M ${points} L 100,40 L 0,40 Z`} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function RingGauge({
  value,
  max,
  label,
  tone = "teal",
  display,
}: {
  value: number;
  max: number;
  label: string;
  tone?: Tone;
  display?: string;
}) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, max === 0 ? 0 : value / max));

  return (
    <div className={`ring-gauge ring-gauge--${tone}`}>
      <svg viewBox="0 0 60 60" role="img" aria-label={`${label}: ${display ?? value}`}>
        <circle className="ring-gauge__track" cx="30" cy="30" r={radius} />
        <circle
          className="ring-gauge__value"
          cx="30"
          cy="30"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <span className="ring-gauge__number">{display ?? Math.round(value)}</span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Meter({
  value,
  max,
  label,
  tone = "teal",
  marker,
}: {
  value: number;
  max: number;
  label: string;
  tone?: Tone;
  marker?: number;
}) {
  const width = Math.max(0, Math.min(100, max === 0 ? 0 : (value / max) * 100));
  const markerPosition =
    marker === undefined ? undefined : Math.max(0, Math.min(100, (marker / max) * 100));

  return (
    <div
      className={`meter meter--${tone}`}
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span className="meter__fill" style={{ width: `${width}%` }} />
      {markerPosition !== undefined ? (
        <span
          className="meter__marker"
          style={{ left: `${markerPosition}%` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

export type WaterfallItem = {
  label: string;
  value: number;
  kind?: "opening" | "inflow" | "outflow" | "closing";
};

export function Waterfall({
  items,
  unit,
  label,
}: {
  items: WaterfallItem[];
  unit: string;
  label: string;
}) {
  const max = Math.max(1, ...items.map((item) => Math.abs(item.value)));

  return (
    <div className="waterfall" role="img" aria-label={label}>
      <div className="waterfall__plot" aria-hidden="true">
        {items.map((item) => {
          const height = Math.max(5, (Math.abs(item.value) / max) * 100);
          return (
            <div className="waterfall__column" key={item.label}>
              <span
                className={`waterfall__bar waterfall__bar--${item.kind ?? (item.value < 0 ? "outflow" : "inflow")}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="waterfall__labels">
        {items.map((item) => (
          <div className="waterfall__label" key={item.label}>
            <strong>
              {item.value > 0 && item.kind !== "opening" && item.kind !== "closing" ? "+" : ""}
              {item.value.toFixed(1)}
            </strong>
            <span>{unit}</span>
            <small>{item.label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConstraintMatrix({
  turns,
  rows,
}: {
  turns: number[];
  rows: Array<{ label: string; values: Array<0 | 1 | 2> }>;
}) {
  return (
    <div className="constraint-matrix-wrap">
      <table className="constraint-matrix">
        <caption className="sr-only">
          Binding constraints by turn. Dots indicate pressure; squares indicate the
          binding constraint.
        </caption>
        <thead>
          <tr>
            <th scope="col">Constraint</th>
            {turns.map((turn) => (
              <th scope="col" key={turn}>
                {turn}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((value, index) => (
                <td key={`${row.label}-${turns[index] ?? index}`}>
                  <span
                    className={`constraint-cell constraint-cell--${value}`}
                    title={
                      value === 2
                        ? `${row.label} bound flow in turn ${turns[index]}`
                        : value === 1
                          ? `${row.label} was under pressure in turn ${turns[index]}`
                          : `${row.label} had slack in turn ${turns[index]}`
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type NetworkValues = {
  portUtilization: number;
  railUtilization: number;
  capitalCoverage: number;
  northCoverage: number;
  interiorCoverage: number;
  mineOutput: number;
  truckActive: boolean;
};

function coverageTone(coverage: number) {
  if (coverage < 1.5) return "critical";
  if (coverage < 2.5) return "watch";
  return "stable";
}

export function SystemMap({
  values,
  layer,
}: {
  values: NetworkValues;
  layer: "grain" | "diesel" | "copper";
}) {
  const edgeClass = `system-map__route system-map__route--${layer}`;
  return (
    <svg
      className="system-map"
      viewBox="0 0 760 410"
      role="img"
      aria-labelledby="map-title map-desc"
    >
      <title id="map-title">Selene freight and depot network</title>
      <desc id="map-desc">
        Main Port connects by rail to the Capital, Northern Industrial Belt, Interior
        Agricultural Region, and Copper Mine. Node labels include current stock coverage.
      </desc>
      <defs>
        <pattern id="sea-grid" width="36" height="36" patternUnits="userSpaceOnUse">
          <path d="M 36 0 L 0 0 0 36" fill="none" stroke="currentColor" opacity=".1" />
        </pattern>
        <filter id="soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="5" stdDeviation="7" floodOpacity=".2" />
        </filter>
      </defs>
      <rect className="system-map__sea" width="760" height="410" rx="18" />
      <rect className="system-map__grid" width="760" height="410" rx="18" fill="url(#sea-grid)" />
      <path
        className="system-map__island"
        d="M214 55c86-33 194-26 272 8 67 29 134 90 143 161 8 61-35 111-104 131-84 24-179 28-261-9-78-36-134-107-123-176 8-51 16-93 73-115Z"
      />

      <path className={edgeClass} d="M126 232 272 214 392 123" />
      <path className={edgeClass} d="M272 214 463 211 577 292" />
      <path className={edgeClass} d="M272 214 378 317" />
      <path
        className={`${edgeClass} ${values.railUtilization > 0.9 ? "system-map__route--busy" : ""}`}
        d="M463 211 577 292"
      />
      {values.truckActive ? (
        <path className="system-map__truck-route" d="M272 224Q335 283 378 317" />
      ) : null}

      <g className="system-map__node" transform="translate(126 232)">
        <circle r="35" filter="url(#soft-shadow)" />
        <path d="M-14 9h28M-10 9v-23h20V9M-16-14h32" />
        <text y="54">MAIN PORT</text>
        <text className="system-map__metric" y="70">
          {Math.round(values.portUtilization * 100)}% utilized
        </text>
      </g>

      <g
        className={`system-map__node system-map__node--${coverageTone(values.capitalCoverage)}`}
        transform="translate(272 214)"
      >
        <circle r="30" />
        <path d="m-13 8 13-19L13 8M-8 8V-2H8V8" />
        <text y="48">CAPITAL</text>
        <text className="system-map__metric" y="64">
          {values.capitalCoverage.toFixed(1)} wk
        </text>
      </g>

      <g
        className={`system-map__node system-map__node--${coverageTone(values.northCoverage)}`}
        transform="translate(392 123)"
      >
        <circle r="30" />
        <path d="M-13 9V-9h8v8l8-8v8l8-8V9Z" />
        <text y="48">NORTHERN BELT</text>
        <text className="system-map__metric" y="64">
          {values.northCoverage.toFixed(1)} wk
        </text>
      </g>

      <g
        className={`system-map__node system-map__node--${coverageTone(values.interiorCoverage)}`}
        transform="translate(378 317)"
      >
        <circle r="30" />
        <path d="M0 11V-11M0-2c-8 0-11-5-11-10 8 0 11 4 11 10ZM0 5c8 0 11-5 11-10C3-5 0-1 0 5Z" />
        <text y="48">INTERIOR</text>
        <text className="system-map__metric" y="64">
          {values.interiorCoverage.toFixed(1)} wk
        </text>
      </g>

      <g className="system-map__node" transform="translate(577 292)">
        <circle r="32" />
        <path d="m-11 9 6-20 6 12 5-8 7 16Z" />
        <text y="51">COPPER MINE</text>
        <text className="system-map__metric" y="67">
          {values.mineOutput.toFixed(1)} kt/wk
        </text>
      </g>

      <g className="system-map__legend" transform="translate(530 48)">
        <rect width="182" height="69" rx="9" />
        <text x="14" y="22">
          SELECTED FLOW
        </text>
        <line className={edgeClass} x1="14" y1="40" x2="52" y2="40" />
        <text className="system-map__legend-value" x="62" y="44">
          {layer.toUpperCase()}
        </text>
        <text className="system-map__legend-value" x="14" y="59">
          Rail {Math.round(values.railUtilization * 100)}% utilized
        </text>
      </g>
    </svg>
  );
}
