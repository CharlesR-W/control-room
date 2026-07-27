"use client";

import { useState } from "react";
import { scenarioModels } from "@/lib/scenarios/registry";
import { ControlRoomGame } from "./ControlRoomGame";
import { GenericScenarioGame } from "./GenericScenarioGame";

type Selection = "library" | "narrows" | string;

const narrows = {
  id: "the-narrows",
  title: "The Narrows",
  period: "Fictional present",
  fidelity: "Fictional analytic",
  role: "Minister for National Supply",
  deck: "Stabilize an island economy after a cyclone damages its only deep-water port.",
  learning: ["Lead times", "Shared bottlenecks", "Delayed information"],
  accent: "#85d8c4",
};

function compactFidelity(label: string) {
  if (label.toLowerCase().includes("fictional analytic")) return "Fictional analytic";
  if (label.toLowerCase().includes("logistics")) return "Historically grounded logistics";
  if (label.toLowerCase().includes("historically grounded")) return "Historically grounded";
  return label;
}

export function ScenarioLibrary() {
  const [selection, setSelection] = useState<Selection>("library");
  if (selection === narrows.id) return <ControlRoomGame onExit={() => setSelection("library")} />;
  const selectedModel = scenarioModels.find((model) => model.metadata.id === selection);
  if (selectedModel) {
    return <GenericScenarioGame model={selectedModel} onExit={() => setSelection("library")} />;
  }

  const cards = [
    narrows,
    ...scenarioModels.map((model) => ({
      id: model.metadata.id,
      title: model.metadata.title,
      period: model.metadata.period,
      fidelity: compactFidelity(model.metadata.fidelity),
      role: model.metadata.role,
      deck: model.metadata.deck,
      learning: model.metadata.learningObjectives,
      accent: model.metadata.accent,
    })),
  ];

  return (
    <main className="scenario-library">
      <header className="scenario-library__hero">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true"><span /></span>
          <span className="brand__name"><strong>Control Room</strong><small>Systems management simulations</small></span>
        </div>
        <div>
          <p className="eyebrow">A management flight simulator</p>
          <h1>History is a system.<br /><em>Take the controls.</em></h1>
          <p>Six deterministic, browser-local scenarios about lead times, bottlenecks, uncertainty, and decisions whose consequences arrive later.</p>
        </div>
      </header>
      <section className="scenario-library__intro">
        <div><strong>Inspect before acting</strong><span>Reports are dated, delayed, and sometimes revised.</span></div>
        <div><strong>Commit as a package</strong><span>Every lever consumes capacity, time, or political room.</span></div>
        <div><strong>Learn from the trace</strong><span>Outcomes expose their declared causal contributions.</span></div>
      </section>
      <section className="scenario-library__grid" aria-label="Playable scenario library">
        {cards.map((card, index) => (
          <article className="library-card" key={card.id} style={{ "--card-accent": card.accent } as React.CSSProperties}>
            <div className="library-card__number">{String(index + 1).padStart(2, "0")}</div>
            <div className="library-card__meta"><span>{card.period}</span><span>{card.fidelity}</span></div>
            <h2>{card.title}</h2>
            <p>{card.deck}</p>
            <dl><dt>Your role</dt><dd>{card.role}</dd></dl>
            <ul>{card.learning.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
            <button className="button button--primary" type="button" onClick={() => setSelection(card.id)}>Open scenario →</button>
          </article>
        ))}
      </section>
      <footer className="scenario-library__footer">
        <p>Fictional and simplified historical models for learning—not predictions of what would have happened.</p>
        <a href="https://github.com/CharlesR-W/control-room">Source and model documentation ↗</a>
      </footer>
    </main>
  );
}
