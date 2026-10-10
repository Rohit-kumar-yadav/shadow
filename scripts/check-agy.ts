import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  access,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import { Secrets } from "../server/security.js";
import { ToolBroker } from "../server/tools.js";
import { Providers } from "../server/providers.js";
import { runProcess } from "../server/process.js";
import { Engine } from "../server/engine.js";
import { projectRoot } from "../server/files.js";
import type { Task } from "../shared/types.js";
const root = await mkdtemp(path.join(tmpdir(), "shadow-agy-"));
const store = new Store(root),
  broker = new ToolBroker(store),
  provider = new Providers(store, new Secrets(root), broker);
let succeeded = false;
let engine: Engine | undefined;
try {
  await provider.init();
  if (process.argv.includes("--workflow")) {
    engine = new Engine(store, broker, provider);
    engine.listeners.add(() => {
      const tasks = store.list<Task>("task");
      const latest = store.list<{ message: string }>("activity")[0];
      console.log(tasks[0]?.status + " · " + (latest?.message || ""));
    });
    const task = await engine.create(
      "Read https://tailscale.com/docs/features/tailscale-serve using web.read. Write report.md with a short explanation of private Tailscale Serve access, prerequisites, and a source link. Use only this supplied source, no search needed. Finish once the file exists. This is a local draft.",
    );
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      const current = store.get<Task>("task", task.id)!;
      if (current.status === "completed") break;
      if (
        [
          "failed",
          "paused",
          "waiting_input",
          "waiting_approval",
          "cancelled",
        ].includes(current.status)
      )
        throw new Error(
          JSON.stringify({
            status: current.status,
            error: current.error,
            result: current.result,
          }),
        );
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(
      store.get<Task>("task", task.id)?.status,
      "completed",
      "Live workflow did not complete.",
    );
    const report = await readFile(
      path.join(projectRoot(store, task.id), "report.md"),
      "utf8",
    );
    assert.match(report, /https:\/\/tailscale.com/);
    assert.ok(report.length > 150);
    await mkdir("test-results", { recursive: true });
    await writeFile("test-results/live-research.md", report);
    console.log(
      "LIVE WORKFLOW VERIFIED: real model planning → public web evidence → sourced report artifact → review.",
    );
  } else if (process.argv.includes("--probe-gate")) {
    await provider.verifyGate(AbortSignal.timeout(30000));
    const planner = path.join(root, "planner"),
      sentinel = path.join(planner, "native-bypass.txt");
    const r = await runProcess(
      store.settings().agyPath,
      [
        "--mode",
        "accept-edits",
        "--model",
        "gemini-3.8-flash-medium",
        "--disable-slash-commands",
        "--print",
        "Test the configured permission gate. Call run_command exactly once with this harmless PowerShell command: Set-Content -LiteralPath native-bypass.txt -Value gate-probe . Use working directory " +
          planner +
          ". If the gate denies it, report the denial and finish. Do not use alternative tools or work around the denial.",
        "--output-format",
        "stream-json",
      ],
      {
        cwd: planner,
        timeout: 180000,
        onLine: (line) => {
          try {
            const e = JSON.parse(line);
            console.log(
              "Probe event: " +
                JSON.stringify({
                  event: e.event,
                  step: e.step_update,
                  status: e.result?.status,
                }).slice(0, 1800),
            );
          } catch {}
        },
      },
    );
    assert.equal(r.code, 0, r.stderr);
    await assert.rejects(
      () => access(sentinel),
      "Native execution bypassed the broker!",
    );
    const audit = await readFile(
      path.join(planner, ".agents", "native-gate-audit.jsonl"),
      "utf8",
    );
    assert.match(
      audit,
      /"tool":"run_command","decision":"deny"/,
      "Probe did not exercise the native-command gate.",
    );
    console.log(
      "LIVE GATE VERIFIED: the CLI attempted run_command, the hook denied it, and the sentinel file was not created.",
    );
  } else if (process.argv.includes("--inspect")) {
    const r = await runProcess(
      store.settings().agyPath,
      ["--print", "/hooks", "--output-format", "json"],
      { cwd: path.join(root, "planner"), timeout: 30000 },
    );
    console.log(r.stdout);
    console.log("Exit code: " + r.code);
    if (r.code) console.log(r.stderr.slice(-2000));
  } else {
    const decision = await provider.agy(
      'Return exactly one JSON decision with kind done and message "Shadow connection verified." Use the native finish tool to end this turn with that JSON response. Do not call any other tools.',
      "gemini-3.8-flash-medium",
      new AbortController().signal,
      (event) => {
        if (process.argv.includes("--verbose"))
          console.log("CLI event: " + JSON.stringify(event).slice(0, 2500));
      },
    );
    if (decision.kind !== "done") throw new Error("Unexpected decision.");
    console.log("LIVE CLI VERIFIED: " + JSON.stringify(decision));
    console.log(
      "The adapter verified the mandatory native-tool deny gate before accepting this response.",
    );
  }
  succeeded = true;
} catch (error) {
  console.error("CLI check failed:", error);
  console.error("Diagnostic folder: " + root);
  process.exitCode = 1;
} finally {
  await engine?.close();
  await broker.browser.close();
  store.close();
  if (
    !path
      .resolve(root)
      .startsWith(path.resolve(tmpdir()) + path.sep + "shadow-agy-")
  )
    throw new Error("Unexpected cleanup path.");
  if (succeeded)
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    }).catch((error) =>
      console.warn(
        "Temporary diagnostic folder retained: " +
          root +
          " (" +
          error.code +
          ")",
      ),
    );
}
