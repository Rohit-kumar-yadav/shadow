import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
const root = await mkdtemp(path.join(tmpdir(), "shadow-ui-"));
const fixture = await createApp({
  root,
  provider: {
    decide: async (task, signal) => {
      if (task.prompt === "Wait until I stop you")
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("Stopped")), {
            once: true,
          });
        });
      if (task.steps === 0) return {
        kind: "tool", tool: "plan.update", summary: "Plan the draft",
        args: { goal: "Create a planning note", assumptions: ["Local draft"], decisions: ["Use Markdown"], stages: [{ title: "Write note", status: "active", evidence: "", artifactIds: [] }] },
      };
      return task.steps === 1
        ? {
            kind: "tool",
            tool: "file.write",
            args: {
              path: "planning-note.md",
              content:
                "# Planning note\n\nA verified local draft from the browser acceptance test.\n",
            },
            summary: "Create your planning note",
          }
        : {
            kind: "done",
            message:
              "Created **planning-note.md** in your task folder. You can preview and download it from Library.",
          };
    },
  },
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const baseUrl = await fixture.app.listen({ host: "127.0.0.1", port: 5173 });
  await mkdir("test-results", { recursive: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(baseUrl);
  await page
    .getByPlaceholder("Enter your one-time code")
    .fill(fixture.auth.code);
  await page.getByRole("button", { name: "Connect this device" }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page.getByRole("region", { name: "Shadow companion" }).waitFor();
  await page.getByRole("button", { name: "Collapse companion" }).click();
  assert.equal(await page.getByRole("img", { name: /original anime/ }).count(), 0);
  await page.getByRole("button", { name: "Expand companion" }).click();
  await page.getByRole("img", { name: /original anime/ }).waitFor();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page
    .getByRole("textbox", { name: "Message Shadow" })
    .fill("Create a planning note for my next project");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByText("Created planning-note.md", { exact: false })
    .waitFor({ timeout: 15000 });
  await page.getByRole("region", { name: "Task roadmap" }).waitFor();
  await page.getByText("Write note", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Library", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /planning-note.md/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "Planning note", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Memory", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Add memory" }).click();
  await page
    .getByRole("textbox", { name: "Memory", exact: true })
    .fill("Keep explanations concise and in English.");
  await page.getByRole("button", { name: "Save memory" }).click();
  await page.getByText("Keep explanations concise and in English.").waitFor();
  for (const view of ["Settings", "Connections", "Skills", "Tasks"]) {
    await page.locator(".sidebar").getByRole("button", { name: new RegExp(`^${view}`) }).first().click();
    await page.getByRole("heading", { name: view, exact: true }).waitFor();
    await page.screenshot({ path: `test-results/${view.toLowerCase()}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    phone = await mobile.newPage();
  await phone.goto(baseUrl);
  await phone
    .getByPlaceholder("Enter your one-time code")
    .fill(fixture.auth.code);
  await phone.getByRole("button", { name: "Connect this device" }).click();
  await phone.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await phone.getByRole("region", { name: "Shadow companion" }).waitFor();
  await phone.screenshot({ path: "test-results/mobile.png", fullPage: true });
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Mobile page must not overflow horizontally.",
  );
  await phone
    .getByRole("button", { name: "Tasks", exact: true })
    .last()
    .click();
  await phone
    .locator("main")
    .getByRole("button", { name: /Create a planning note/ })
    .click();
  await phone.getByText("Created planning-note.md", { exact: false }).waitFor();
  await phone
    .getByRole("button", { name: "Tasks", exact: true })
    .last()
    .click();
  await phone
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  await phone
    .getByRole("textbox", { name: "Message Shadow" })
    .fill("Wait until I stop you");
  await phone.getByRole("button", { name: "Send message" }).click();
  await phone.getByRole("button", { name: "Cancel task", exact: true }).click();
  await phone.getByText("Cancelled", { exact: true }).first().waitFor();
  assert.ok(
    fixture.store
      .list<{ status: string; prompt: string }>("task")
      .some(
        (t) => t.prompt === "Wait until I stop you" && t.status === "cancelled",
      ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser acceptance passed: pairing, live task, artifact preview, memory save, mobile layout, shared PC/phone task state, phone task submission and cancellation.",
  );
} finally {
  await browser.close();
  await fixture.app.close();
  assert.ok(
    path
      .resolve(root)
      .startsWith(path.resolve(tmpdir()) + path.sep + "shadow-ui-"),
  );
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 100,
  });
}
