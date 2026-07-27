import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const executablePath =
  process.env.CHROMIUM_PATH ?? "/home/crw/.local/bin/chromium";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const failures = [];

page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") failures.push(`console: ${message.text()}`);
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("heading", { name: /History is a system/i }).waitFor();
  await page.screenshot({ path: "/tmp/control-room-library.png", fullPage: true });
  const scenarioCards = page.locator(".library-card");
  if ((await scenarioCards.count()) !== 6) {
    failures.push(`library: expected 6 playable scenarios, found ${await scenarioCards.count()}`);
  }

  const genericScenarios = [
    { name: /Controlled Materials/i, slug: "controlled-materials" },
    { name: /North Atlantic/i, slug: "north-atlantic" },
    { name: /Apollo Integration/i, slug: "apollo-integration" },
    { name: /Sterling/i, slug: "sterling" },
    { name: /Bottleneck Economy/i, slug: "bottleneck-economy" },
  ];
  for (const scenario of genericScenarios) {
    const card = page.locator(".library-card").filter({
      has: page.getByRole("heading", { name: scenario.name }),
    });
    await card.getByRole("button", { name: /Open scenario/i }).click();
    await page.getByRole("heading", { level: 1, name: scenario.name }).waitFor();
    await page.getByRole("button", { name: /Begin scenario/i }).click();
    await page.getByRole("button", { name: /Commit package/i }).click();
    await page.getByText("Last turn", { exact: true }).waitFor();
    await page.screenshot({
      path: `/tmp/control-room-theme-${scenario.slug}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const themedMobileLayout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    if (themedMobileLayout.scrollWidth > themedMobileLayout.viewport + 1) {
      failures.push(
        `${scenario.slug} mobile: horizontal overflow ${themedMobileLayout.scrollWidth}px > ${themedMobileLayout.viewport}px`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole("button", { name: "Control Room", exact: true }).click();
    await page.getByRole("heading", { name: /History is a system/i }).waitFor();
  }

  const narrowsCard = page.locator(".library-card").filter({
    has: page.getByRole("heading", { name: "The Narrows", exact: true }),
  });
  await narrowsCard.getByRole("button", { name: /Open scenario/i }).click();
  await page.getByRole("heading", { name: /Decisions have lead times/i }).waitFor();
  await page.getByRole("button", { name: "Professional" }).click();
  await page.getByRole("button", { name: /Begin briefing/i }).click();
  await page.getByRole("button", { name: /Enter the control room/i }).click();
  await page.getByRole("heading", { name: /National supply position/i }).waitFor();

  await page.getByRole("button", { name: "Mechanics", exact: true }).click();
  const rulebook = page.getByRole("dialog", { name: "Mechanics rulebook" });
  await rulebook.waitFor();
  await rulebook
    .getByRole("heading", { name: /A request is a ceiling/i })
    .waitFor();
  await rulebook.getByText(/berth time expires/i).waitFor();
  const activeRulebookControl = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label"),
  );
  if (activeRulebookControl !== "Close mechanics rulebook") {
    failures.push(
      `accessibility: rulebook did not move focus to Close (${activeRulebookControl})`,
    );
  }
  await rulebook.screenshot({ path: "/tmp/control-room-rulebook.png" });
  await rulebook
    .getByRole("button", { name: /Close mechanics rulebook/i })
    .click();
  const restoredControl = await page.evaluate(
    () => document.activeElement?.textContent?.trim(),
  );
  if (restoredControl !== "Mechanics") {
    failures.push(
      `accessibility: rulebook did not restore trigger focus (${restoredControl})`,
    );
  }

  const decisionBook = page.getByRole("complementary", {
    name: "Decision Book",
  });
  await decisionBook
    .getByRole("button", { name: /Port scheduling/i })
    .click();
  await decisionBook
    .getByRole("slider", { name: /Grain imports/i })
    .fill("6");
  const grainAvailability = decisionBook.getByRole("group", {
    name: "Grain imports availability",
  });
  const grainAvailabilityValues = await grainAvailability
    .locator("dd")
    .allTextContents();
  if (
    JSON.stringify(grainAvailabilityValues) !==
    JSON.stringify(["6.0 kt", "5.0 kt", "5.0 kt", "5.0 kt"])
  ) {
    failures.push(
      `mechanics: unexpected opening grain availability ${JSON.stringify(grainAvailabilityValues)}`,
    );
  }
  await decisionBook.screenshot({
    path: "/tmp/control-room-decision-book.png",
  });
  const decisionBookLayout = await decisionBook.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  if (decisionBookLayout.scrollWidth > decisionBookLayout.clientWidth + 1) {
    failures.push(
      `decision book: horizontal overflow ${decisionBookLayout.scrollWidth}px > ${decisionBookLayout.clientWidth}px`,
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open run menu" }).click();
  await page
    .getByRole("menuitem", { name: /Open mechanics rulebook/i })
    .click();
  await page.getByRole("dialog", { name: "Mechanics rulebook" }).waitFor();
  const mobileRulebookLayout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (mobileRulebookLayout.scrollWidth > mobileRulebookLayout.viewport + 1) {
    failures.push(
      `mechanics mobile: horizontal overflow ${mobileRulebookLayout.scrollWidth}px > ${mobileRulebookLayout.viewport}px`,
    );
  }
  await page
    .getByRole("button", { name: /Close mechanics rulebook/i })
    .click();
  await page.setViewportSize({ width: 1440, height: 960 });

  for (let turn = 1; turn <= 12; turn += 1) {
    await page.getByLabel(/Grain coverage next week/i).fill("3.0");
    await page.getByLabel(/FX next week/i).fill("25.0");
    await page.getByLabel(/Expected binding constraint/i).selectOption("port");
    await page
      .getByLabel(/Minister's note/i)
      .fill(`Week ${turn}: protect the import pipeline and preserve operating slack.`);

    await page.getByRole("button", { name: /Review & commit package/i }).click();
    await page.getByRole("heading", { name: /Review direct commitments/i }).waitFor();
    await page.getByRole("button", { name: /Commit package & advance/i }).click();
    const continueButton = page.getByRole("button", {
      name:
        turn === 12
          ? /Open after-action review/i
          : /Return to control room/i,
    });
    await continueButton.waitFor();
    await continueButton.click();

    if (turn === 2) {
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: /History is a system/i }).waitFor();
      const savedNarrowsCard = page.locator(".library-card").filter({
        has: page.getByRole("heading", { name: "The Narrows", exact: true }),
      });
      await savedNarrowsCard.getByRole("button", { name: /Open scenario/i }).click();
      await page.getByRole("button", { name: "Resume" }).waitFor();
      await page.getByRole("button", { name: "Resume" }).click();
      await page.getByText(/Autosave verified by deterministic replay/i).waitFor();
    }
  }

  await page.getByText("After-action review", { exact: true }).waitFor();
  await page.getByRole("heading", { name: /Compare interpretable policies/i }).waitFor();
  await page.getByRole("heading", { name: /Reveal hidden state/i }).waitFor();
  await page.getByRole("heading", { name: /Test transfer/i }).waitFor();

  await page.screenshot({
    path: "/tmp/control-room-aar.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    emptyButtons: [...document.querySelectorAll("button")].filter(
      (button) =>
        !button.textContent?.trim() &&
        !button.getAttribute("aria-label") &&
        !button.getAttribute("title"),
    ).length,
  }));
  if (layout.scrollWidth > layout.viewport + 1) {
    failures.push(
      `layout: horizontal overflow ${layout.scrollWidth}px > ${layout.viewport}px`,
    );
  }
  if (layout.emptyButtons > 0) {
    failures.push(`accessibility: ${layout.emptyButtons} unnamed button(s)`);
  }

  await page.getByRole("button", { name: /Create branch/i }).click();
  await page.getByText(/New branch created from week/i).waitFor();
  const stored = await page.evaluate(() =>
    window.localStorage.getItem("control-room:narrows:autosave:v1"),
  );
  if (!stored || !stored.includes('"parentRunId"')) {
    failures.push("persistence: branched run was not autosaved");
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  process.stdout.write(
    `Browser smoke passed: six-scenario library, five themed scenario turns, Narrows mechanics, quantity bounds, mobile layout, 12 turns, reload/replay, AAR, responsive layout, and branch persistence.\nTheme screenshots: /tmp/control-room-theme-{controlled-materials,north-atlantic,apollo-integration,sterling,bottleneck-economy}.png\nOther screenshots: /tmp/control-room-library.png, /tmp/control-room-rulebook.png, /tmp/control-room-decision-book.png, /tmp/control-room-aar.png\n`,
  );
} finally {
  await browser.close();
}
