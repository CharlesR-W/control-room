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

  await page.getByRole("heading", { name: /Decisions have lead times/i }).waitFor();
  await page.getByRole("button", { name: "Professional" }).click();
  await page.getByRole("button", { name: /Begin briefing/i }).click();
  await page.getByRole("button", { name: /Enter the control room/i }).click();
  await page.getByRole("heading", { name: /National supply position/i }).waitFor();

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
    `Browser smoke passed: 12 turns, reload/replay, AAR, responsive layout, and branch persistence.\nScreenshot: /tmp/control-room-aar.png\n`,
  );
} finally {
  await browser.close();
}
