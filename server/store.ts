import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Activity, Settings } from "../shared/types.js";
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export class Store {
  db: DatabaseSync;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, "shadow.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS records_kind ON records(kind,updated);",
    );
  }
  get<T>(kind: string, key: string): T | undefined {
    const row = this.db
      .prepare("SELECT json FROM records WHERE kind=? AND id=?")
      .get(kind, key) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }
  list<T>(kind: string): T[] {
    return (
      this.db
        .prepare("SELECT json FROM records WHERE kind=? ORDER BY updated DESC")
        .all(kind) as { json: string }[]
    ).map((r) => JSON.parse(r.json));
  }
  put<T extends { id: string }>(kind: string, item: T): T {
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,updated=excluded.updated",
      )
      .run(kind, item.id, JSON.stringify(item), now());
    return item;
  }
  delete(kind: string, key: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, key);
  }
  activity(message: string, type = "info", taskId?: string) {
    const item: Activity = { id: id(), message, type, taskId, at: now() };
    this.put("activity", item);
    const old = this.list<Activity>("activity").slice(1000);
    for (const r of old) this.delete("activity", r.id);
    return item;
  }
  settings(): Settings {
    return {
      ...DEFAULT_SETTINGS,
      ...this.get<{ id: string; value: Partial<Settings> }>("settings", "main")
        ?.value,
    };
  }
  saveSettings(value: Settings) {
    this.put("settings", { id: "main", value });
  }
  close() {
    this.db.close();
  }
}
export const DEFAULT_SETTINGS: Settings = {
  initiative: "recommend",
  companionEnabled: true,
  companionVoice: false,
  provider: "agy",
  plannerModel: "gemini-3.1-pro-high",
  workerModel: "gemini-3.8-flash-medium",
  maxSteps: 24,
  maxDailyCalls: 80,
  publicUrl: "",
  agyPath:
    process.env.SHADOW_AGY_PATH ||
    (process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe")
      : "agy"),
  browserChannel: "chrome",
  apiModels: {
    gemini: "gemini-3.8-flash",
    groq: "openai/gpt-oss-120b",
    openrouter: "openrouter/free",
  },
  freeAllowanceConfirmed: { gemini: false, groq: false, openrouter: false },
};
