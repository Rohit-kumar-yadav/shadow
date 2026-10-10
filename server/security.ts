import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { Store, id, now } from "./store.js";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export class Auth {
  code = "";
  expires = 0;
  constructor(public store: Store) {
    this.rotate();
  }
  rotate() {
    this.code = randomBytes(9).toString("hex");
    this.expires = Date.now() + 10 * 60_000;
    return this.code;
  }
  pair(code: string, label: string) {
    if (
      this.expires < Date.now() ||
      code.length !== this.code.length ||
      !timingSafeEqual(Buffer.from(code), Buffer.from(this.code))
    )
      throw new Error(
        "Pairing code is invalid or expired. Generate a new one from a paired device or restart Shadow.",
      );
    const token = randomBytes(32).toString("base64url");
    this.store.put("session", {
      id: digest(token),
      label,
      createdAt: now(),
      expires: Date.now() + 30 * 86400_000,
    });
    this.rotate();
    return token;
  }
  valid(token: string | undefined) {
    const s =
      token && this.store.get<{ expires: number }>("session", digest(token));
    return !!s && s.expires > Date.now();
  }
}
export async function secureApp(app: FastifyInstance, auth: Auth) {
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 240,
    timeWindow: "1 minute",
    global: true,
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header("Cache-Control", "no-store");
    const host = req.headers.host || "";
    const settings = auth.store.settings();
    const allowed = new Set([
      "localhost:4310",
      "127.0.0.1:4310",
      "localhost:5173",
      "127.0.0.1:5173",
      ...(settings.publicUrl ? [new URL(settings.publicUrl).host] : []),
    ]);
    if (!allowed.has(host))
      return reply.code(403).send({
        error:
          "Unrecognized host. Set SHADOW_PUBLIC_URL for your private Tailscale address.",
      });
    if (!req.url.startsWith("/api/")) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const origins = new Set(
        [
          "http://localhost:4310",
          "http://127.0.0.1:4310",
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          settings.publicUrl,
        ].filter(Boolean),
      );
      if (!origin || !origins.has(origin))
        return reply
          .code(403)
          .send({ error: "Request origin is not trusted." });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return reply.code(415).send({ error: "JSON request required." });
    }
    if (req.url.split("?")[0] === "/api/auth/pair" || req.url === "/api/health")
      return;
    if (!auth.valid(req.cookies.shadow_session))
      return reply.code(401).send({ error: "Pair this device to continue." });
  });
  app.post(
    "/api/auth/pair",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const b = req.body as { code?: string; label?: string };
      try {
        const token = auth.pair(
          String(b.code || ""),
          String(b.label || "Personal device").slice(0, 80),
        );
        const secure =
          !!auth.store.settings().publicUrl &&
          req.headers.origin === auth.store.settings().publicUrl;
        reply.setCookie("shadow_session", token, {
          httpOnly: true,
          sameSite: "strict",
          secure,
          path: "/",
          maxAge: 30 * 86400,
        });
        return { ok: true };
      } catch (e) {
        return reply.code(401).send({ error: (e as Error).message });
      }
    },
  );
  app.post("/api/auth/pair-code", async () => ({
    code: auth.rotate(),
    expiresAt: auth.expires,
  }));
  app.get("/api/auth/devices", async () =>
    auth.store
      .list<{
        id: string;
        label: string;
        createdAt: string;
        expires: number;
      }>("session")
      .filter((s) => s.expires > Date.now()),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/auth/devices/:id",
    async (req) => {
      auth.store.delete("session", req.params.id);
      return { ok: true };
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies.shadow_session)
      auth.store.delete("session", digest(req.cookies.shadow_session));
    reply.clearCookie("shadow_session", { path: "/" });
    return { ok: true };
  });
}
export class Secrets {
  key: Buffer;
  constructor(public root: string) {
    const p = path.join(root, "secrets.key");
    if (!existsSync(p)) writeFileSync(p, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(p);
  }
  set(name: string, value: string) {
    const p = path.join(this.root, "secrets.json");
    const all: Record<string, string> = existsSync(p)
      ? JSON.parse(readFileSync(p, "utf8"))
      : {};
    if (!value) delete all[name];
    else {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      all[name] = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString(
        "base64",
      );
    }
    writeFileSync(p, JSON.stringify(all), { mode: 0o600 });
  }
  get(name: string) {
    const env = process.env[`SHADOW_${name.toUpperCase()}_KEY`];
    if (env) return env;
    const p = path.join(this.root, "secrets.json");
    if (!existsSync(p)) return "";
    const val = JSON.parse(readFileSync(p, "utf8"))[name];
    if (!val) return "";
    const data = Buffer.from(val, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
}
