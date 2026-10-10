import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { chromium } from "playwright-core";
import { Store, id, now } from "../server/store.js";
import { ToolBroker } from "../server/tools.js";
import { Engine } from "../server/engine.js";
import {
  ProviderError,
  Providers,
  PLANNER_AGENT,
  NATIVE_GATE_SCRIPT,
  type Provider,
} from "../server/providers.js";
import { Auth, Secrets, digest } from "../server/security.js";
import { projectRoot, within } from "../server/files.js";
import { publicAddress, validateUrl } from "../server/network.js";
import { parseDecision } from "../server/validation.js";
import { createApp } from "../server/app.js";
import { runProcess } from "../server/process.js";
test("reviewed code stays inside task files and receives no provider credentials", async () => {
  const f = await fixture();
  const previous = process.env.SHADOW_GROQ_KEY;
  process.env.SHADOW_GROQ_KEY = "test-only-secret";
  try {
    const taskId = id(),
      root = projectRoot(f.store, taskId);
    await mkdir(root, { recursive: true });
    const outside = path.join(f.root, "private.txt");
    await writeFile(outside, "private");
    await writeFile(
      path.join(root, "check.mjs"),
      `import fs from 'node:fs';import {spawnSync} from 'node:child_process';let outsideBlocked=false,childBlocked=false;try{fs.readFileSync(${JSON.stringify(outside)});}catch(e){outsideBlocked=e.code==='ERR_ACCESS_DENIED';}try{spawnSync(process.execPath,['--version']);}catch(e){childBlocked=e.code==='ERR_ACCESS_DENIED';}fs.writeFileSync('output.txt','verified');console.log(JSON.stringify({outsideBlocked,childBlocked,keyHidden:!process.env.SHADOW_GROQ_KEY}));`,
    );
    const context = { taskId, signal: new AbortController().signal };
    const prepared = await f.broker.prepare(
      {
        tool: "code.run",
        args: { path: "check.mjs" },
        summary: "Test reviewed code",
      },
      context,
    );
    const result = await f.broker.execute(prepared.request, context);
    assert.deepEqual(JSON.parse((result.output as { stdout: string }).stdout), {
      outsideBlocked: true,
      childBlocked: true,
      keyHidden: true,
    });
    const collected = await f.broker.execute(
      {
        tool: "file.collect",
        args: { path: "output.txt" },
        summary: "Collect output",
      },
      context,
    );
    assert.equal(collected.artifacts?.length, 1);
    await writeFile(path.join(root, "check.mjs"), 'console.log("changed");');
    await assert.rejects(
      () => f.broker.execute(prepared.request, context),
      /changed after review/,
    );
  } finally {
    if (previous === undefined) delete process.env.SHADOW_GROQ_KEY;
    else process.env.SHADOW_GROQ_KEY = previous;
    await f.close();
  }
});
test("expired website sessions request manual login and keep passwords out of snapshots", async () => {
  const f = await fixture();
  try {
    f.broker.browser.context = await chromium.launchPersistentContext(
      path.join(f.root, "profile"),
      { channel: "chrome", headless: true },
    );
    const taskId = id(),
      page = await f.broker.browser.page(taskId);
    await page.setContent(
      '<title>Account</title><p>Your session has expired. Please sign in.</p><input type="password" value="test-password"><button>Sign in</button>',
    );
    const snapshot = await f.broker.browser.snapshot(taskId);
    assert.equal(snapshot.needsLogin, true);
    assert.ok(!JSON.stringify(snapshot).includes("test-password"));
  } finally {
    await f.close();
  }
});
test("native CLI gate denies execution tools and permits only completion", async () => {
  const f = await fixture();
  try {
    const p = path.join(f.root, "gate.cjs");
    await writeFile(p, NATIVE_GATE_SCRIPT);
    for (const name of [
      "run_command",
      "write_to_file",
      "browser_subagent",
      "ask_permission",
      "",
      "finish",
    ]) {
      const r = await runProcess(process.execPath, [p], {
        cwd: f.root,
        input: JSON.stringify({ toolCall: { name } }),
      });
      assert.equal(r.code, 0);
      assert.equal(
        JSON.parse(r.stdout).decision,
        name === "finish" ? "allow" : "deny",
      );
    }
    const provider = new Providers(f.store, new Secrets(f.root), f.broker);
    await provider.init();
    await writeFile(
      path.join(f.root, "planner", ".agents", "hooks.json"),
      "{}",
    );
    await assert.rejects(
      () => provider.agy("hello", "irrelevant", new AbortController().signal),
      /gate changed/,
    );
  } finally {
    await f.close();
  }
});
test("planner receives registered command IDs without exposing their arguments", async () => {
  const f = await fixture();
  try {
    f.store.put("command", {
      id: "registered-launcher",
      name: "Shorts",
      description: "Local video tool",
      expectedOutputs: ["draft.mp4"],
      executable: process.execPath,
      args: ["--api-key", "test-credential"],
      cwd: f.root,
    } satisfies CommandRegistration);
    const task = await f.engine.create("Inspect my shorts connection", {
      defer: true,
    });
    const prompt = new Providers(f.store, new Secrets(f.root), f.broker).prompt(
      task,
    );
    assert.match(prompt, /registered-launcher/);
    assert.match(prompt, /draft.mp4/);
    assert.ok(!prompt.includes("test-credential"));
  } finally {
    await f.close();
  }
});
test("browser approvals bind the reviewed page and creative actions require verified connections", async () => {
  const f = await fixture();
  try {
    f.broker.browser.context = await chromium.launchPersistentContext(
      path.join(f.root, "profile"),
      { channel: "chrome", headless: true },
    );
    await f.broker.browser.context.route("https://elevenlabs.io/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<p>Voice workspace</p>",
      }),
    );
    const taskId = id(),
      page = await f.broker.browser.page(taskId),
      ctx = { taskId, signal: new AbortController().signal };
    await page.goto("https://elevenlabs.io/app");
    const prepared = await f.broker.prepare(
      {
        tool: "browser.press",
        args: { key: "Escape" },
        summary: "Close dialog",
      },
      ctx,
    );
    assert.equal(prepared.request.args._pageUrl, "https://elevenlabs.io/app");
    await assert.rejects(
      () => f.broker.execute(prepared.request, ctx),
      /Verify the signed-in/,
    );
    f.store.put("connection", { id: "elevenlabs", status: "ready" });
    assert.equal((await f.broker.execute(prepared.request, ctx)).ok, true);
    await page.goto("https://elevenlabs.io/app/changed");
    await assert.rejects(
      () => f.broker.execute(prepared.request, ctx),
      /page changed after review/,
    );
  } finally {
    await f.close();
  }
});
test("completed conversations accept follow-ups without losing task files", async () => {
  const f = await fixture(
    scripted([
      {
        kind: "tool",
        tool: "file.write",
        args: { path: "draft.md", content: "First draft" },
        summary: "Write",
      },
      done,
      done,
      {
        kind: "tool",
        tool: "file.read",
        args: { path: "draft.md" },
        summary: "Read prior draft",
      },
      done,
      done,
    ]),
  );
  try {
    const t = await f.engine.create("Write a draft");
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    f.engine.reply(t.id, "Read the draft again");
    await until(
      () =>
        f.store.get<Task>("task", t.id)?.status === "completed" &&
        f.store.get<Task>("task", t.id)?.turn === 1,
    );
    const task = f.store.get<Task>("task", t.id)!;
    assert.equal(task.messages.filter((m) => m.role === "user").length, 2);
    assert.equal(task.steps, 2);
    assert.equal(
      await readFile(path.join(projectRoot(f.store, t.id), "draft.md"), "utf8"),
      "First draft",
    );
  } finally {
    await f.close();
  }
});
import type {
  AgentDecision,
  Approval,
  CommandRegistration,
  Memory,
  Skill,
  Step,
  Task,
  ToolRequest,
} from "../shared/types.js";
async function fixture(
  provider: Provider = {
    decide: async () => ({ kind: "done", message: "Done." }),
  },
) {
  const root = await mkdtemp(path.join(tmpdir(), "shadow-test-"));
  const store = new Store(root),
    broker = new ToolBroker(store),
    engine = new Engine(store, broker, provider);
  return {
    root,
    store,
    broker,
    engine,
    close: async () => {
      await engine.close();
      store.close();
      await cleanup(root);
    },
  };
}
async function cleanup(root: string) {
  assert.ok(
    path
      .resolve(root)
      .startsWith(path.resolve(tmpdir()) + path.sep + "shadow-"),
  );
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 100,
  });
}
async function until(check: () => boolean, timeout = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("Condition timed out.");
    await new Promise((r) => setTimeout(r, 15));
  }
}
function scripted(actions: AgentDecision[]): Provider {
  let cursor = 0;
  return {
    decide: async () => actions[Math.min(cursor++, actions.length - 1)],
  };
}
const done: AgentDecision = { kind: "done", message: "Verified." };
test("task file boundary rejects traversal, absolute paths, and junctions", async () => {
  const f = await fixture();
  try {
    const root = projectRoot(f.store, id());
    await mkdir(root, { recursive: true });
    for (const p of [
      "../secrets.key",
      "a/../../secret",
      "C:\\Windows\\test",
      "/etc/passwd",
      "file.txt:secret",
    ])
      await assert.rejects(() => within(root, p));
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(
      outside,
      path.join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(() => within(root, "link/secret.txt"), /links|leaves/);
    const valid = await within(root, "nested/report.md", true);
    await writeFile(valid, "safe");
    assert.equal(await readFile(valid, "utf8"), "safe");
  } finally {
    await f.close();
  }
});
test("public URL guard blocks local, metadata, credentials, and reserved ranges", async () => {
  for (const a of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.2",
    "169.254.169.254",
    "100.64.0.1",
    "192.168.1.1",
    "203.0.113.2",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
  ])
    assert.equal(publicAddress(a), false, a);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  for (const u of [
    "http://127.0.0.1",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "http://1.1.1.1:8080",
  ])
    await assert.rejects(() => validateUrl(u));
});
test("structured model decisions reject unknown types and malformed tool arguments", () => {
  assert.equal(parseDecision('{"kind":"done","message":"Hello"}').kind, "done");
  assert.throws(() => parseDecision({ kind: "execute", command: "danger" }));
  assert.throws(() =>
    parseDecision({ kind: "tool", tool: "file.write", args: "oops" }),
  );
});
test("pairing codes are one use, sessions are revocable, and keys are encrypted", async () => {
  const f = await fixture();
  try {
    const auth = new Auth(f.store),
      code = auth.code,
      token = auth.pair(code, "Phone");
    assert.equal(auth.valid(token), true);
    assert.throws(() => auth.pair(code, "Other"));
    f.store.delete("session", digest(token));
    assert.equal(auth.valid(token), false);
    auth.expires = 0;
    assert.throws(() => auth.pair(auth.code, "Late"));
    const secrets = new Secrets(f.root);
    secrets.set("groq", "a-secret-api-key");
    assert.equal(secrets.get("groq"), "a-secret-api-key");
    assert.ok(
      !(await readFile(path.join(f.root, "secrets.json"), "utf8")).includes(
        "a-secret-api-key",
      ),
    );
    secrets.set("groq", "");
    assert.equal(secrets.get("groq"), "");
  } finally {
    await f.close();
  }
});
test("roadmaps persist decisions and reject unsupported completion or foreign artifacts", async () => {
  const f = await fixture();
  try {
    const task = await f.engine.create("Build my product", { defer: true });
    const ctx = { taskId: task.id, signal: AbortSignal.timeout(10000) };
    const args = { goal: "Build a product", assumptions: ["Local draft first"], decisions: ["Research before choosing an audience"], stages: [{ title: "Research", status: "active", evidence: "", artifactIds: [] as string[] }] };
    const request = { tool: "plan.update", args, summary: "Record roadmap" };
    const result = await f.broker.execute(request, ctx);
    assert.equal(result.ok, true);
    const p = new Providers(f.store, new Secrets(f.root), f.broker);
    assert.match(p.prompt(task), /Research before choosing an audience/);
    args.stages[0].status = "completed";
    await assert.rejects(f.broker.execute(request, ctx), /require observed evidence/);
    args.stages[0].evidence = "Research saved";
    args.stages[0].artifactIds = [id()];
    await assert.rejects(f.broker.execute(request, ctx), /must belong to this task/);
    assert.equal(f.store.get<any>("plan", task.id).stages[0].status, "active");
  } finally { await f.close(); }
});
test("research output becomes a persisted artifact with source links", async () => {
  const f = await fixture(
    scripted([
      {
        kind: "tool",
        tool: "file.write",
        args: {
          path: "report.md",
          content: "# Findings\n\nSource: https://example.com/source\n",
        },
        summary: "Save the sourced report",
      },
      done,
    ]),
  );
  try {
    const t = await f.engine.create(
      "Save a sourced report from the provided evidence",
    );
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    const steps = f.store.list<Step>("step");
    assert.equal(steps.length, 1);
    assert.equal(steps[0].result?.ok, true);
    assert.match(
      await readFile(
        path.join(projectRoot(f.store, t.id), "report.md"),
        "utf8",
      ),
      /https:\/\/example.com\/source/,
    );
    assert.equal(f.store.list("artifact").length, 1);
    const check = new Store(f.root);
    assert.equal(check.get<Task>("task", t.id)?.status, "completed");
    check.close();
  } finally {
    await f.close();
  }
});
test("registered command runs only after approval and verifies real output", async () => {
  const f = await fixture(
    scripted([
      {
        kind: "tool",
        tool: "command.run",
        args: { commandId: "fixture" },
        summary: "Run registered fixture",
      },
      done,
    ]),
  );
  try {
    const cwd = path.join(f.root, "command");
    await mkdir(cwd);
    await writeFile(
      path.join(cwd, "make.mjs"),
      "import{writeFileSync}from'node:fs';writeFileSync('output.txt','verified');console.log('created');",
    );
    f.store.put("command", {
      id: "fixture",
      name: "Fixture",
      executable: process.execPath,
      args: ["make.mjs"],
      cwd,
      expectedOutputs: ["output.txt"],
      description: "Test fixture",
    } satisfies CommandRegistration);
    const t = await f.engine.create("Run my registered fixture");
    await until(
      () => f.store.get<Task>("task", t.id)?.status === "waiting_approval",
    );
    await assert.rejects(() => readFile(path.join(cwd, "output.txt")));
    f.engine.decideApproval(f.store.list<Approval>("approval")[0].id, true);
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    assert.equal(
      await readFile(
        path.join(projectRoot(f.store, t.id), "command-output", "output.txt"),
        "utf8",
      ),
      "verified",
    );
  } finally {
    await f.close();
  }
});
test("changing command after approval invalidates the reviewed registration", async () => {
  const f = await fixture(
    scripted([
      {
        kind: "tool",
        tool: "command.run",
        args: { commandId: "fixture" },
        summary: "Run fixture",
      },
      done,
    ]),
  );
  try {
    const c: CommandRegistration = {
      id: "fixture",
      name: "Fixture",
      executable: process.execPath,
      args: ["-e", 'console.log("first")'],
      cwd: f.root,
      expectedOutputs: [],
      description: "Test",
    };
    f.store.put("command", c);
    const t = await f.engine.create("Run fixture");
    await until(
      () => f.store.get<Task>("task", t.id)?.status === "waiting_approval",
    );
    f.store.put("command", { ...c, args: ["-e", 'console.log("changed")'] });
    f.engine.decideApproval(f.store.list<Approval>("approval")[0].id, true);
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    const result = f.store.list<Step>("step")[0].result;
    assert.equal(result?.ok, false);
    assert.match(JSON.stringify(result), /changed after review/);
  } finally {
    await f.close();
  }
});
test("identical reviewed external actions are not executed twice", async () => {
  const request: AgentDecision = {
    kind: "tool",
    tool: "test.external",
    args: { target: "one" },
    summary: "External action",
  };
  const f = await fixture(
    scripted([
      request,
      { ...request, summary: "Same action with different wording" },
      done,
    ]),
  );
  let calls = 0;
  f.broker.tools["test.external"] = {
    description: "Fixture effect",
    schema: z.object({ target: z.string() }),
    review: "Review external effect",
    run: async () => {
      calls++;
      return { ok: true, output: "sent" };
    },
  };
  try {
    const t = await f.engine.create("Perform a reviewed action");
    await until(
      () => f.store.get<Task>("task", t.id)?.status === "waiting_approval",
    );
    f.engine.decideApproval(f.store.list<Approval>("approval")[0].id, true);
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    assert.equal(calls, 1);
    assert.equal(f.store.list<Step>("step").length, 2);
    assert.match(JSON.stringify(f.store.list<Step>("step")), /not repeated/);
  } finally {
    await f.close();
  }
});
test("denied actions are not executed or repeatedly re-requested", async () => {
  const request: AgentDecision = {
    kind: "tool",
    tool: "test.external",
    args: {},
    summary: "External action",
  };
  const f = await fixture(scripted([request, request, done]));
  let calls = 0;
  f.broker.tools["test.external"] = {
    description: "Fixture",
    schema: z.object({}),
    review: "Review",
    run: async () => {
      calls++;
      return { ok: true, output: "sent" };
    },
  };
  try {
    const t = await f.engine.create("Try reviewed action");
    await until(
      () => f.store.get<Task>("task", t.id)?.status === "waiting_approval",
    );
    f.engine.decideApproval(f.store.list<Approval>("approval")[0].id, false);
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    assert.equal(calls, 0);
    assert.equal(f.store.list<Approval>("approval").length, 1);
  } finally {
    await f.close();
  }
});
test("interrupted actions require a fresh approval, even if previously approved", async () => {
  const f = await fixture();
  try {
    const t = await f.engine.create("Interrupted task", { defer: true });
    const a: Approval = {
      id: id(),
      taskId: t.id,
      stepId: "interrupted",
      request: {
        tool: "file.write",
        args: { path: "out.txt", content: "x" },
        summary: "Write",
      },
      reason: "Earlier review",
      status: "approved",
      createdAt: now(),
    };
    f.store.put("approval", a);
    f.store.put("step", {
      id: "interrupted",
      taskId: t.id,
      index: 0,
      request: a.request,
      fingerprint: digest(JSON.stringify(a.request)),
      status: "running",
      approvalId: a.id,
      startedAt: now(),
    } satisfies Step);
    f.store.put("task", { ...t, status: "running" });
    const recovered = new Engine(f.store, f.broker, scripted([done]));
    assert.equal(f.store.get<Task>("task", t.id)?.status, "paused");
    recovered.control(t.id, "resume");
    await until(
      () => f.store.get<Task>("task", t.id)?.status === "waiting_approval",
    );
    const pending = f.store
      .list<Approval>("approval")
      .find((a) => a.status === "pending")!;
    assert.notEqual(pending.id, a.id);
    await assert.rejects(() =>
      readFile(path.join(projectRoot(f.store, t.id), "out.txt")),
    );
    recovered.decideApproval(pending.id, true);
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    assert.equal(
      await readFile(path.join(projectRoot(f.store, t.id), "out.txt"), "utf8"),
      "x",
    );
    await recovered.close();
  } finally {
    await f.close();
  }
});
test("quota and authentication failures pause tasks without buying credits or retry loops", async () => {
  let calls = 0;
  const f = await fixture({
    decide: async () => {
      calls++;
      throw new ProviderError("Quota exhausted", "quota");
    },
  });
  try {
    const t = await f.engine.create("Do work");
    await until(() => f.store.get<Task>("task", t.id)?.status === "paused");
    assert.equal(calls, 1);
    assert.match(f.store.get<Task>("task", t.id)?.error || "", /Quota/);
  } finally {
    await f.close();
  }
});
test("legacy settings gain initiative defaults and selected policy reaches planner without removing approvals", async () => {
  const f = await fixture();
  try {
    f.store.put("settings", { id: "main", value: { provider: "agy" } });
    assert.equal(f.store.settings().initiative, "recommend");
    assert.equal(f.store.settings().companionEnabled, true);
    assert.equal(f.store.settings().companionVoice, false);
    const t = await f.engine.create("Research a digital product business", { defer: true });
    const p = new Providers(f.store, new Secrets(f.root), f.broker);
    for (const mode of ["ask", "recommend", "decide"] as const) {
      f.store.saveSettings({ ...f.store.settings(), initiative: mode });
      const prompt = p.prompt(t);
      assert.match(prompt, /require application approval/);
      assert.match(prompt, /business-plan.md/);
      assert.match(prompt, mode === "ask" ? /ask the user to choose/ : mode === "recommend" ? /Recommend and continue:/ : /Choose evidence-backed approaches/);
    }
  } finally { await f.close(); }
});
test("corrections are stored and included in a later planner context", async () => {
  const f = await fixture(
    scripted([
      {
        kind: "tool",
        tool: "memory.save",
        args: {
          text: "Use short English paragraphs.",
          source: "Owner correction",
        },
        summary: "Remember writing preference",
      },
      done,
    ]),
  );
  try {
    const t = await f.engine.create(
      "Remember my preference: use short English paragraphs.",
    );
    await until(() => f.store.get<Task>("task", t.id)?.status === "completed");
    assert.equal(
      f.store.list<Memory>("memory")[0].text,
      "Use short English paragraphs.",
    );
    const p = new Providers(f.store, new Secrets(f.root), f.broker);
    assert.match(
      p.prompt({ ...t, prompt: "Write an English report" }),
      /Use short English paragraphs/,
    );
  } finally {
    await f.close();
  }
});
test("skill testing cannot activate an invalid recipe or a changed version", async () => {
  const f = await fixture();
  try {
    const skill: Skill = {
      id: id(),
      name: "Example",
      description: "Example",
      triggers: ["example"],
      instructions: "Create draft",
      version: 1,
      enabled: false,
      status: "draft",
      recipe: [{ tool: "missing.tool", args: {}, summary: "Invalid" }],
      history: [],
      createdAt: now(),
    };
    f.store.put("skill", skill);
    const t = await f.engine.create("Test invalid recipe", {
      recipe: skill.recipe,
      skillTestId: skill.id,
    });
    await until(() => f.store.get<Task>("task", t.id)?.status === "failed");
    assert.equal(f.store.get<Skill>("skill", skill.id)?.enabled, false);
    const valid = {
      ...skill,
      recipe: [
        {
          tool: "file.write",
          args: { path: "check.md", content: "ok" },
          summary: "Check",
        },
      ],
    };
    f.store.put("skill", valid);
    const t2 = await f.engine.create("Test stale recipe", {
      defer: true,
      recipe: valid.recipe,
      skillTestId: valid.id,
    });
    f.store.put("skill", { ...valid, version: 2 });
    f.engine.control(t2.id, "resume");
    await until(() => f.store.get<Task>("task", t2.id)?.status === "completed");
    assert.equal(f.store.get<Skill>("skill", skill.id)?.enabled, false);
  } finally {
    await f.close();
  }
});
test("HTTP API requires pairing, verifies origins, serves artifacts and revokes sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shadow-api-"));
  const { app, auth, store } = await createApp({
    root,
    provider: scripted([
      {
        kind: "tool",
        tool: "file.write",
        args: { path: "note.txt", content: "Hello from Shadow" },
        summary: "Save note",
      },
      done,
    ]),
  });
  const headers = { host: "localhost:4310", origin: "http://localhost:4310" };
  try {
    assert.equal(
      (await app.inject({ url: "/api/state", headers })).statusCode,
      401,
    );
    const pair = await app.inject({
      method: "POST",
      url: "/api/auth/pair",
      headers,
      payload: { code: auth.code, label: "Test phone" },
    });
    assert.equal(pair.statusCode, 200);
    const cookie = String(pair.headers["set-cookie"]).split(";")[0];
    const authenticated = { ...headers, cookie };
    assert.equal(
      (await app.inject({ url: "/api/state", headers: authenticated }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          headers: { ...authenticated, origin: "https://attacker.example" },
          payload: { prompt: "No" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/state",
          headers: { ...authenticated, host: "attacker.example" },
        })
      ).statusCode,
      403,
    );
    const r = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: authenticated,
      payload: { prompt: "Create a note" },
    });
    assert.equal(r.statusCode, 200);
    await until(
      () => store.get<Task>("task", r.json().id)?.status === "completed",
    );
    const a = store.list<{ id: string }>("artifact")[0];
    assert.equal(
      (
        await app.inject({
          url: `/api/artifacts/${a.id}/content`,
          headers: authenticated,
        })
      ).body,
      "Hello from Shadow",
    );
    const devices = await app.inject({
      url: "/api/auth/devices",
      headers: authenticated,
    });
    assert.equal(devices.json()[0].label, "Test phone");
    await app.inject({
      method: "DELETE",
      url: "/api/auth/devices/" + devices.json()[0].id,
      headers: authenticated,
      payload: {},
    });
    assert.equal(
      (await app.inject({ url: "/api/state", headers: authenticated }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
    await cleanup(root);
  }
});
test(
  "local FFmpeg creates playable landscape and portrait drafts with narration and captions",
  { timeout: 120000 },
  async () => {
    const f = await fixture();
    try {
      const taskId = id(),
        root = projectRoot(f.store, taskId);
      await mkdir(root, { recursive: true });
      let r = await runProcess("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x819768:s=320x240",
        "-frames:v",
        "1",
        "-threads",
        "1",
        path.join(root, "scene.png"),
      ]);
      assert.equal(r.code, 0, r.stderr);
      r = await runProcess("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1.2",
        path.join(root, "voice.wav"),
      ]);
      assert.equal(r.code, 0, r.stderr);
      await writeFile(
        path.join(root, "captions.srt"),
        "1\n00:00:00,000 --> 00:00:01,000\nShadow render test\n",
      );
      for (const aspect of ["landscape", "portrait"]) {
        const result = await f.broker.execute(
          {
            tool: "media.render",
            args: {
              scenes: [{ image: "scene.png", duration: 1.8 }],
              aspect,
              voiceover: "voice.wav",
              captions: "captions.srt",
              output: aspect + ".mp4",
            },
            summary: "Render test",
          },
          { taskId, signal: new AbortController().signal },
        );
        assert.equal(result.ok, true);
        const p = await runProcess("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,width,height:format=duration",
          "-of",
          "json",
          path.join(root, aspect + ".mp4"),
        ]);
        assert.equal(p.code, 0, p.stderr);
        const probe = JSON.parse(p.stdout),
          streams = probe.streams;
        assert.ok(
          Number(probe.format.duration) >= 1.7,
          "Short narration must not cut the video timeline.",
        );
        assert.equal(
          streams.find((s: any) => s.codec_type === "video").width,
          aspect === "landscape" ? 1920 : 1080,
        );
        assert.ok(streams.some((s: any) => s.codec_type === "audio"));
      }
    } finally {
      await f.close();
    }
  },
);
