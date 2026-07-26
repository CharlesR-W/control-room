import type { ReactNode } from "react";
import { Icon } from "./Icons";

export type StatusTone = "stable" | "watch" | "critical" | "info";

export function StatusLabel({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return <span className={`status-label status-label--${tone}`}>{children}</span>;
}

export function Panel({
  title,
  subtitle,
  tools,
  children,
  footer,
  raised = false,
  inset = false,
  flush = false,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  tools?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  raised?: boolean;
  inset?: boolean;
  flush?: boolean;
  className?: string;
}) {
  const classes = [
    "panel",
    raised ? "panel--raised" : "",
    inset ? "panel--inset" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes}>
      {title || tools ? (
        <header className="panel__header">
          <div className="panel__title">
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {tools ? <div className="panel__tools">{tools}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "panel__body panel__body--flush" : "panel__body"}>
        {children}
      </div>
      {footer ? <footer className="panel__footer">{footer}</footer> : null}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="workspace-header__actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div>
        <Icon name="info" width={26} height={26} aria-hidden="true" />
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function formatUsd(cents: number, compact = false): string {
  const dollars = cents / 100;
  if (compact) {
    if (Math.abs(dollars) >= 1_000_000) {
      return `$${(dollars / 1_000_000).toFixed(1)}m`;
    }
    if (Math.abs(dollars) >= 1_000) {
      return `$${(dollars / 1_000).toFixed(0)}k`;
    }
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}

export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function statusFromCoverage(weeks: number): StatusTone {
  if (weeks < 1.5) return "critical";
  if (weeks < 2.5) return "watch";
  return "stable";
}

export function statusFromObjective(
  status: "secure" | "at-risk" | "breached",
): StatusTone {
  return status === "secure" ? "stable" : status === "at-risk" ? "watch" : "critical";
}
