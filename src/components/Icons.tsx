import type { SVGProps } from "react";

export type IconName =
  | "alert"
  | "arrow"
  | "branch"
  | "briefcase"
  | "check"
  | "chevron"
  | "close"
  | "download"
  | "finance"
  | "info"
  | "menu"
  | "pause"
  | "play"
  | "repair"
  | "reports"
  | "situation"
  | "supply"
  | "timeline"
  | "transport"
  | "upload";

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    alert: (
      <>
        <path d="M12 3.5 21 20H3L12 3.5Z" />
        <path d="M12 9v5" />
        <path d="M12 17.3h.01" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m14 7 5 5-5 5" />
      </>
    ),
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 5h3a4 4 0 0 1 4 4v5a4 4 0 0 0 1 2.7" />
        <path d="M8 5v9a4 4 0 0 0 4 4h4" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V4h6v3" />
        <path d="M3 12h18" />
        <path d="M10 12v2h4v-2" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.6 2.6L16.5 9" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    close: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7.5 11 4.5 4.5 4.5-4.5" />
        <path d="M4 20h16" />
      </>
    ),
    finance: (
      <>
        <path d="M3 9h18" />
        <path d="M5 9v9M9 9v9M15 9v9M19 9v9" />
        <path d="M2.5 20h19" />
        <path d="m12 3 9 4H3l9-4Z" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6" />
        <path d="M12 7.3h.01" />
      </>
    ),
    menu: (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </>
    ),
    pause: (
      <>
        <rect x="5" y="4" width="5" height="16" rx="1" />
        <rect x="14" y="4" width="5" height="16" rx="1" />
      </>
    ),
    play: <path d="m7 4 13 8-13 8V4Z" />,
    repair: (
      <>
        <path d="M14.5 6.5a4 4 0 0 0-5-5l2.2 2.2-2.8 2.8-2.2-2.2a4 4 0 0 0 5 5L20 17.6 17.6 20l-8.2-8.3" />
        <path d="m4 20 6.2-6.2" />
      </>
    ),
    reports: (
      <>
        <path d="M6 3h9l4 4v14H6V3Z" />
        <path d="M15 3v5h4" />
        <path d="M9 12h6M9 16h6" />
      </>
    ),
    situation: (
      <>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19V3" />
        <path d="M2 19h21" />
      </>
    ),
    supply: (
      <>
        <path d="m4 7 8-4 8 4-8 4-8-4Z" />
        <path d="M4 7v10l8 4 8-4V7" />
        <path d="M12 11v10" />
      </>
    ),
    timeline: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    transport: (
      <>
        <circle cx="5" cy="17" r="2" />
        <circle cx="19" cy="17" r="2" />
        <path d="M7 17h10M5 15V8h10l4 4v3" />
        <path d="M15 8v4h4" />
        <path d="M8 5h7" />
      </>
    ),
    upload: (
      <>
        <path d="M12 17V5" />
        <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
        <path d="M4 20h16" />
      </>
    ),
  };

  return (
    <svg {...common} {...props}>
      {paths[name]}
    </svg>
  );
}
