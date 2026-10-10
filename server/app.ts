import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import path from "node:path";
import { existsSync, createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import type {
  Activity,
  Approval,
  Artifact,
  CommandRegistration,
  Connection,
  Memory,
  Settings,
  Skill,
  Snapshot,
  Step,
  Task,
  TaskPlan,
} from "../shared/types.js";
import { Store, id, now } from "./store.js";
import { Auth, Secrets, secureApp } from "./security.js";
import { ToolBroker } from "./tools.js";
import { Providers, type Provider } from "./providers.js";
import { Engine } from "./engine.js";
import { artifact, projectRoot, within } from "./files.js";
import { runProcess } from "./process.js";
import { seed } from "./seeds.js";
import { toolRequestSchema } from "./validation.js";
const uuid = z.uuid();
const commandSchema = z.object({
  name: z.string().min(1).max(100),
  executable: z.string().min(1).max(1000),
  args: z.array(z.string().max(2000)).max(30),
  cwd: z.string().min(1).max(1000),
  expectedOutputs: z.array(z.string().min(1).max(300)).max(20),
  description: z.string().max(1000),
});
const skillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  triggers: z.array(z.string().min(1).max(80)).min(1).max(20),
  instructions: z.string().min(1).max(16000),
  recipe: z.array(toolRequestSchema).min(1).max(24),
});
const settingsSchema = z.object({
  initiative: z.enum(["ask", "recommend", "decide"]).default("recommend"),
  companionEnabled: z.boolean().default(true),
  companionVoice: z.boolean().default(false),
  provider: z.enum(["agy", "gemini", "groq", "openrouter"]),
  plannerModel: z.string().min(1).max(100),
  workerModel: z.string().min(1).max(100),
  maxSteps: z.number().int().min(4).max(100),
  maxDailyCalls: z.number().int().min(1).max(2000),
  publicUrl: z.string().refine((s) => {
    if (!s) return true;
    try {
      const u = new URL(s);
      return (
        u.protocol === "https:" &&
        u.hostname.endsWith(".ts.net") &&
        u.origin === s
      );
    } catch {
      return false;
    }
  }, "Use the HTTPS origin of your private .ts.net address, without a trailing slash."),
  agyPath: z.string().min(1).max(1000),
  browserChannel: z.enum(["chrome", "msedge"]),
  apiModels: z.object({
    gemini: z.string().min(1).max(100),
    groq: z.string().min(1).max(100),
    openrouter: z.string().min(1).max(100),
  }),
  freeAllowanceConfirmed: z.object({
    gemini: z.boolean(),
    groq: z.boolean(),
    openrouter: z.boolean(),
  }),
});
export async function createApp(
  options: {
    root?: string;
    staticRoot?: string;
    provider?: Provider;
    logger?: boolean;
  } = {},
) {
  const root = path.resolve(
    options.root || process.env.SHADOW_DATA_DIR || "data",
  );
  const store = new Store(root);
  seed(store);
  if (process.env.SHADOW_PUBLIC_URL) {
    const value = settingsSchema.parse({
      ...store.settings(),
      publicUrl: process.env.SHADOW_PUBLIC_URL,
    });
    store.saveSettings(value);
  }
  const auth = new Auth(store),
    secrets = new Secrets(root),
    broker = new ToolBroker(store),
    providers = new Providers(store, secrets, broker);
  await providers.init();
  const engine = new Engine(store, broker, options.provider || providers);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 30_000_000,
    trustProxy: ["127.0.0.1", "::1"],
  });
  await secureApp(app, auth);
  app.addHook("onSend", async (_req, reply, payload) => {
    if (!_req.url.startsWith("/api/"))
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    return payload;
  });
  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    const validation = e instanceof z.ZodError;
    reply.code(validation ? 400 : e.statusCode || 400).send({
      error: validation
        ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : e.message,
    });
  });
  const connections = (): Connection[] => {
    const saved = store.list<Connection>("connection");
    const get = (id: string, fallback: Connection) =>
      saved.find((c) => c.id === id) || fallback;
    return [
      get("agy", {
        id: "agy",
        name: "Antigravity CLI",
        category: "Intelligence",
        status: existsSync(store.settings().agyPath) ? "unconfigured" : "error",
        detail:
          "Check login and available models. Uses your existing account allowance.",
      }),
      ...(["gemini", "groq", "openrouter"] as const).map((id) =>
        get(id, {
          id,
          name:
            id === "gemini"
              ? "Gemini API"
              : id === "groq"
                ? "Groq"
                : "OpenRouter",
          category: "Intelligence",
          status: "unconfigured",
          detail: secrets.get(id)
            ? "Key saved. Allowance confirmation and model configuration required."
            : "Optional. Add a key from a free or existing-allowance project.",
        }),
      ),
      {
        id: "browser",
        name: "Dedicated browser",
        category: "Tools",
        status: broker.browser.context ? "ready" : "unconfigured",
        detail: broker.browser.context
          ? "Browser session is running."
          : "Launch a separate Chrome/Edge profile; sign in yourself.",
      },
      get("ffmpeg", {
        id: "ffmpeg",
        name: "FFmpeg renderer",
        category: "Creative",
        status: "unconfigured",
        detail: "Check local video and audio rendering availability.",
      }),
      get("flow", {
        id: "flow",
        name: "Google Flow",
        category: "Creative",
        status: "needs_login",
        detail:
          "Open the browser, sign in with your Google AI Pro account, then check the workspace.",
      }),
      get("elevenlabs", {
        id: "elevenlabs",
        name: "ElevenLabs",
        category: "Creative",
        status: "needs_login",
        detail: "Browser workflow. Uses your signed-in account allowance.",
      }),
      {
        id: "omnistudio",
        name: "OmniStudio",
        category: "Creative",
        status: "unconfigured",
        detail:
          "Register its executable or local launcher below once its installation is identified.",
      },
      get("shorts", {
        id: "shorts",
        name: "Your shorts launcher",
        category: "Tools",
        status: "unconfigured",
        detail:
          "Discover a launcher on PATH or register the exact program, arguments, and working folder.",
      }),
      get("tailscale", {
        id: "tailscale",
        name: "Private phone access",
        category: "Access",
        status: store.settings().publicUrl ? "unconfigured" : "unconfigured",
        detail: store.settings().publicUrl
          ? "Private URL configured. Verify Tailscale Serve on your PC."
          : "Set up Tailscale on your PC and phone; see Settings → Phone access.",
      }),
    ];
  };
  const snapshot = (): Snapshot => ({
    plans: store.list<TaskPlan>("plan").slice(0, 100),
    tasks: store.list<Task>("task").slice(0, 100),
    approvals: store.list<Approval>("approval"),
    memories: store.list<Memory>("memory"),
    skills: store.list<Skill>("skill"),
    artifacts: store.list<Artifact>("artifact").slice(0, 500),
    activity: store.list<Activity>("activity").slice(0, 150),
    commands: store.list<CommandRegistration>("command"),
    settings: store.settings(),
    connections: connections(),
  });
  app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));
  app.get("/api/state", async () => snapshot());
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    let timer: NodeJS.Timeout | undefined;
    const send = () => {
      if (!auth.valid(req.cookies.shadow_session)) {
        reply.raw.end();
        return;
      }
      if (!reply.raw.destroyed)
        reply.raw.write(
          `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`,
        );
    };
    const notify = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        send();
      }, 80);
    };
    engine.listeners.add(notify);
    send();
    const keep = setInterval(() => {
      if (!auth.valid(req.cookies.shadow_session)) {
        reply.raw.end();
        return;
      }
      reply.raw.write(": heartbeat\n\n");
    }, 20000);
    keep.unref();
    reply.raw.on("close", () => {
      engine.listeners.delete(notify);
      clearInterval(keep);
      clearTimeout(timer);
    });
  });
  app.post("/api/tasks", async (req) => {
    const b = z
      .object({
        prompt: z.string().min(1).max(20000),
        files: z
          .array(
            z.object({
              name: z.string().min(1).max(300),
              base64: z.string().max(14_000_000),
            }),
          )
          .max(12)
          .default([]),
      })
      .parse(req.body);
    if (
      store
        .list<Task>("task")
        .filter((t) => ["queued", "running"].includes(t.status)).length >= 30
    )
      throw new Error("The task queue is full.");
    const task = await engine.create(b.prompt, { defer: true });
    try {
      let total = 0;
      for (const f of b.files) {
        const buffer = Buffer.from(f.base64, "base64");
        total += buffer.length;
        if (total > 20_000_000) throw new Error("Attached files exceed 20 MB.");
        await writeFile(
          await within(projectRoot(store, task.id), f.name, true),
          buffer,
        );
        await artifact(store, task.id, f.name);
      }
      task.status = "queued";
      engine.save(task);
      void engine.pump();
      return task;
    } catch (e) {
      task.status = "failed";
      task.error = (e as Error).message;
      engine.save(task);
      throw e;
    }
  });
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/control",
    async (req) => {
      uuid.parse(req.params.id);
      const { action } = z
        .object({ action: z.enum(["pause", "cancel", "resume", "retry"]) })
        .parse(req.body);
      return engine.control(req.params.id, action);
    },
  );
  app.post<{ Params: { id: string } }>("/api/tasks/:id/reply", async (req) => {
    uuid.parse(req.params.id);
    const { message, files } = z
      .object({
        message: z.string().min(1).max(20000),
        files: z
          .array(
            z.object({
              name: z.string().min(1).max(300),
              base64: z.string().max(14_000_000),
            }),
          )
          .max(12)
          .default([]),
      })
      .parse(req.body);
    const task = store.get<Task>("task", req.params.id);
    if (
      !task ||
      !["waiting_input", "paused", "failed", "completed"].includes(task.status)
    )
      throw new Error("Pause this task before adding a follow-up.");
    let total = 0;
    const attachments = await Promise.all(
      files.map(async (f) => {
        const buffer = Buffer.from(f.base64, "base64");
        total += buffer.length;
        if (total > 20_000_000) throw new Error("Attached files exceed 20 MB.");
        return {
          file: await within(projectRoot(store, task.id), f.name, true),
          name: f.name,
          buffer,
        };
      }),
    );
    for (const attachment of attachments) {
      await writeFile(attachment.file, attachment.buffer);
      await artifact(store, task.id, attachment.name);
    }
    return engine.reply(req.params.id, message);
  });
  app.get<{ Params: { id: string } }>("/api/tasks/:id/steps", async (req) => {
    uuid.parse(req.params.id);
    return store
      .list<Step>("step")
      .filter((s) => s.taskId === req.params.id)
      .sort((a, b) => a.index - b.index);
  });
  app.post<{ Params: { id: string } }>("/api/approvals/:id", async (req) => {
    uuid.parse(req.params.id);
    const b = z.object({ approve: z.boolean() }).parse(req.body);
    return engine.decideApproval(req.params.id, b.approve);
  });
  app.get<{ Params: { id: string } }>(
    "/api/approvals/:id/code",
    async (req) => {
      const a = store.get<{
        request: { tool: string; args: Record<string, unknown> };
        taskId: string;
      }>("approval", uuid.parse(req.params.id));
      if (!a || a.request.tool !== "code.run")
        throw new Error("No code preview for this action.");
      const p = await within(
        projectRoot(store, a.taskId),
        String(a.request.args.path),
      );
      if ((await stat(p)).size > 200000)
        throw new Error("Code exceeds preview limit.");
      return { content: await readFile(p, "utf8") };
    },
  );
  app.post("/api/memories", async (req) => {
    const b = z
      .object({
        text: z.string().min(1).max(4000),
        source: z.string().max(1000).default("Owner edit"),
      })
      .parse(req.body);
    store.put("memory", { id: id(), ...b, createdAt: now(), updatedAt: now() });
    engine.changed();
    return { ok: true };
  });
  app.put<{ Params: { id: string } }>("/api/memories/:id", async (req) => {
    const key = uuid.parse(req.params.id),
      old = store.get<Memory>("memory", key);
    if (!old) throw new Error("Memory not found.");
    const b = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    store.put("memory", {
      ...old,
      ...b,
      source: "Owner edit",
      updatedAt: now(),
    });
    engine.changed();
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/memories/:id", async (req) => {
    store.delete("memory", uuid.parse(req.params.id));
    engine.changed();
    return { ok: true };
  });
  app.post("/api/skills", async (req) => {
    const b = skillSchema.parse(req.body);
    for (const r of b.recipe) {
      if (!broker.tools[r.tool] || r.tool === "skill.propose")
        throw new Error("Unknown or recursive recipe tool.");
      broker.tools[r.tool].schema.parse(r.args);
    }
    store.put("skill", {
      id: id(),
      ...b,
      version: 1,
      enabled: false,
      status: "draft",
      history: [],
      createdAt: now(),
    });
    engine.changed();
    return { ok: true };
  });
  app.put<{ Params: { id: string } }>("/api/skills/:id", async (req) => {
    const key = uuid.parse(req.params.id),
      old = store.get<Skill>("skill", key);
    if (!old) throw new Error("Skill not found.");
    const b = skillSchema.parse(req.body);
    for (const r of b.recipe) {
      if (!broker.tools[r.tool] || r.tool === "skill.propose")
        throw new Error("Unknown or recursive recipe tool.");
      broker.tools[r.tool].schema.parse(r.args);
    }
    store.put("skill", {
      ...old,
      ...b,
      version: old.version + 1,
      status: "draft",
      enabled: false,
      history: [
        ...old.history,
        {
          version: old.version,
          instructions: old.instructions,
          recipe: old.recipe,
          at: now(),
        },
      ],
    });
    engine.changed();
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/toggle",
    async (req) => {
      const skill = store.get<Skill>("skill", uuid.parse(req.params.id));
      if (!skill) throw new Error("Skill not found.");
      if (skill.status !== "tested")
        throw new Error("Test this skill before enabling it.");
      skill.enabled = !skill.enabled;
      store.put("skill", skill);
      engine.changed();
      return skill;
    },
  );
  app.post<{ Params: { id: string } }>("/api/skills/:id/test", async (req) => {
    const skill = store.get<Skill>("skill", uuid.parse(req.params.id));
    if (!skill) throw new Error("Skill not found.");
    return engine.create(`Test skill: ${skill.name}`, {
      recipe: skill.recipe,
      skillTestId: skill.id,
    });
  });
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/rollback",
    async (req) => {
      const skill = store.get<Skill>("skill", uuid.parse(req.params.id));
      if (!skill) throw new Error("Skill not found.");
      const { version } = z
        .object({ version: z.number().int() })
        .parse(req.body);
      const previous = skill.history.find((h) => h.version === version);
      if (!previous) throw new Error("Version not found.");
      store.put("skill", {
        ...skill,
        instructions: previous.instructions,
        recipe: previous.recipe,
        version: skill.version + 1,
        status: "draft",
        enabled: false,
        history: [
          ...skill.history,
          {
            version: skill.version,
            instructions: skill.instructions,
            recipe: skill.recipe,
            at: now(),
          },
        ],
      });
      engine.changed();
      return { ok: true };
    },
  );
  app.post("/api/commands", async (req) => {
    const b = commandSchema.parse(req.body);
    if (!path.isAbsolute(b.cwd) || (await stat(b.cwd)).isDirectory() === false)
      throw new Error("Working folder must be an existing absolute directory.");
    if (/[\r\n\0]/.test(b.executable)) throw new Error("Invalid program path.");
    for (const output of b.expectedOutputs) await within(b.cwd, output);
    const value: CommandRegistration = { id: id(), ...b };
    store.put("command", value);
    engine.changed();
    return value;
  });
  app.delete<{ Params: { id: string } }>("/api/commands/:id", async (req) => {
    store.delete("command", uuid.parse(req.params.id));
    engine.changed();
    return { ok: true };
  });
  app.get("/api/tools", async () => broker.definitions());
  app.put("/api/settings", async (req) => {
    const settings = settingsSchema.parse(req.body);
    const previous = store.settings();
    for (const provider of ["gemini", "groq", "openrouter"] as const)
      if (
        previous.apiModels[provider] !== settings.apiModels[provider] ||
        previous.freeAllowanceConfirmed[provider] !==
          settings.freeAllowanceConfirmed[provider]
      )
        store.delete("connection", provider);
    if (previous.agyPath !== settings.agyPath)
      store.delete("connection", "agy");
    if (previous.publicUrl !== settings.publicUrl)
      store.delete("connection", "tailscale");
    store.saveSettings(settings);
    engine.changed();
    return settings;
  });
  app.post<{ Params: { id: string } }>(
    "/api/connections/:id/key",
    async (req) => {
      const provider = z
        .enum(["gemini", "groq", "openrouter"])
        .parse(req.params.id);
      const { key } = z.object({ key: z.string().max(1000) }).parse(req.body);
      secrets.set(provider, key);
      store.delete("connection", provider);
      engine.changed();
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/connections/:id/check",
    async (req) => {
      const key = z
        .enum([
          "agy",
          "ffmpeg",
          "shorts",
          "tailscale",
          "flow",
          "elevenlabs",
          "gemini",
          "groq",
          "openrouter",
        ])
        .parse(req.params.id);
      let detail = "",
        status: Connection["status"] = "ready";
      let models: string[] = [];
      try {
        if (key === "agy") {
          const r = await runProcess(store.settings().agyPath, ["models"], {
            timeout: 30000,
          });
          if (r.code !== 0) throw new Error(r.stderr.slice(-500) || r.stdout);
          models = r.stdout
            .split(/\r?\n/)
            .filter((l) => l.includes("\t"))
            .map((l) => l.split("\t")[0]);
          if (!models.length)
            throw new Error("No available model catalog returned.");
          await providers.verifyGate(AbortSignal.timeout(30000));
          detail = `Signed in · ${models.length} models available. Quotas are checked by the provider at runtime.`;
          store.put("catalog", { id: "models", models });
        } else if (key === "ffmpeg") {
          const r = await runProcess("ffmpeg", ["-version"], {
            timeout: 10000,
          });
          if (r.code !== 0) throw new Error("FFmpeg could not run.");
          detail = r.stdout.split(/\r?\n/)[0].slice(0, 130);
        } else if (key === "shorts") {
          const r = await runProcess(
            process.platform === "win32" ? "where.exe" : "which",
            ["shorts"],
            { timeout: 10000 },
          );
          if (r.code !== 0)
            throw new Error(
              "No shorts launcher found on PATH. Register its exact program or PowerShell script below.",
            );
          detail = `Found ${r.stdout.trim()}. Register its arguments and working directory before use.`;
          status = "unconfigured";
        } else if (key === "tailscale") {
          const r = await runProcess(
            process.platform === "win32"
              ? existsSync("C:\\Program Files\\Tailscale\\tailscale.exe")
                ? "C:\\Program Files\\Tailscale\\tailscale.exe"
                : "tailscale"
              : "tailscale",
            ["status", "--json"],
            { timeout: 12000 },
          );
          if (r.code !== 0) throw new Error("Tailscale is not connected.");
          const state = JSON.parse(r.stdout);
          if (state.BackendState !== "Running")
            throw new Error("Sign in to Tailscale on your PC first.");
          const hostname = String(state.Self?.DNSName || "").replace(/\.$/, "");
          detail = `Connected · ${hostname}. Configure Serve and the private URL in Settings.`;
          status = "unconfigured";
          if (store.settings().publicUrl) {
            const executable =
              process.platform === "win32" &&
              existsSync("C:\\Program Files\\Tailscale\\tailscale.exe")
                ? "C:\\Program Files\\Tailscale\\tailscale.exe"
                : "tailscale";
            const serve = await runProcess(
              executable,
              ["serve", "status", "--json"],
              { timeout: 12000 },
            );
            const origin = new URL(store.settings().publicUrl),
              config = JSON.parse(serve.stdout || "{}");
            const handler =
              config.Web?.[origin.host + ":443"]?.Handlers?.["/"] ||
              config.Web?.[origin.host]?.Handlers?.["/"];
            if (
              serve.code === 0 &&
              handler?.Proxy === "http://127.0.0.1:4310" &&
              origin.hostname === hostname
            ) {
              status = "ready";
              detail = `Private Serve proxy verified · ${hostname}. Pair your phone in Settings.`;
            } else
              detail =
                "Tailscale is connected, but Serve has not been verified for the configured URL and local port 4310.";
          }
        } else if (key === "flow" || key === "elevenlabs") {
          if (!broker.browser.context)
            throw new Error("Launch the dedicated browser and sign in first.");
          const host = key === "flow" ? "labs.google" : "elevenlabs.io";
          const page = broker.browser.context.pages().find((p) => {
            try {
              const hostname = new URL(p.url()).hostname;
              return hostname === host || hostname.endsWith("." + host);
            } catch {
              return false;
            }
          });
          if (!page)
            throw new Error(
              "Open this service in the dedicated browser first.",
            );
          const text = (await page.locator("body").innerText()).slice(0, 20000);
          if (
            /sign in to continue|log in to continue|verify you are human|captcha/i.test(
              text,
            ) ||
            !/new project|scenebuilder|generate|text to speech|workspace/i.test(
              text,
            )
          )
            throw new Error(
              "The signed-in workspace has not been verified. Complete login or verification manually.",
            );
          detail =
            "Workspace detected. Generation and downloads still need verification for each task.";
        } else {
          if (!secrets.get(key)) throw new Error("Add a key first.");
          if (!store.settings().freeAllowanceConfirmed[key])
            throw new Error(
              "Confirm your account/model uses free or existing allowance in Settings.",
            );
          detail =
            "Key and allowance configuration saved. The first task will verify provider authentication.";
          status = "unconfigured";
        }
      } catch (e) {
        status =
          key === "flow" || key === "elevenlabs" ? "needs_login" : "error";
        detail = (e as Error).message.slice(0, 1000);
      }
      const value: Connection = {
        id: key,
        name: connections().find((c) => c.id === key)?.name || key,
        category: connections().find((c) => c.id === key)?.category || "Tools",
        status,
        detail,
      };
      store.put("connection", value);
      engine.changed();
      return { ...value, models };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/connections/:id/open",
    async (req) => {
      const key = z
        .enum(["browser", "flow", "elevenlabs"])
        .parse(req.params.id);
      await broker.browser.exclusive(async () => {
        const p = await broker.browser.page("manual-" + key);
        await p.goto(
          key === "flow"
            ? "https://labs.google/fx/tools/flow"
            : key === "elevenlabs"
              ? "https://elevenlabs.io/app"
              : "https://www.google.com",
          { waitUntil: "domcontentloaded", timeout: 30000 },
        );
        await p.bringToFront();
      });
      engine.changed();
      return { ok: true };
    },
  );
  app.post("/api/connections/browser/login", async () => {
    await broker.browser.exclusive(async () => {
      await broker.browser.openManualLogin();
    });
    const current = connections().find((c) => c.id === "browser")!;
    store.put("connection", {
      ...current,
      status: "needs_login",
      detail:
        "Sign in to Google in the normal Chrome window, then close that Chrome window before opening Flow or the dedicated browser.",
    });
    engine.changed();
    return { ok: true };
  });
  app.get(
    "/api/models",
    async () => store.get("catalog", "models") || { models: [] },
  );
  app.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    "/api/artifacts/:id/content",
    async (req, reply) => {
      const a = store.get<Artifact>("artifact", uuid.parse(req.params.id));
      if (!a) return reply.code(404).send({ error: "Artifact not found." });
      const file = await within(projectRoot(store, a.taskId), a.relativePath);
      const size = (await stat(file)).size;
      reply
        .type(a.mime)
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header("Accept-Ranges", "bytes");
      if (req.query.download === "1")
        reply.header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
        );
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match)
          return reply
            .code(416)
            .header("Content-Range", `bytes */${size}`)
            .send();
        const start = Number(match[1]),
          end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start >= size || end < start)
          return reply
            .code(416)
            .header("Content-Range", `bytes */${size}`)
            .send();
        reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${size}`)
          .header("Content-Length", end - start + 1);
        return reply.send(createReadStream(file, { start, end }));
      }
      reply.header("Content-Length", size);
      return reply.send(createReadStream(file));
    },
  );
  const dist = path.resolve(options.staticRoot || "dist");
  if (existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist, prefix: "/" });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Endpoint not found." })
        : reply.sendFile("index.html"),
    );
  } else
    app.get("/", async (_req, reply) =>
      reply
        .type("text/plain")
        .send(
          "Build the interface with npm run build, or use npm run dev:ui during development.",
        ),
    );
  app.addHook("onClose", async () => {
    await engine.close();
    store.close();
  });
  await app.ready();
  return { app, store, auth, broker, providers, engine, snapshot };
}
