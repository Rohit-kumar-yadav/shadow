import path from "node:path";
import { lstat, mkdir, realpath, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Store, id, now } from "./store.js";
import type { Artifact } from "../shared/types.js";
export const MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".srt": "text/plain",
  ".vtt": "text/vtt",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".html": "text/plain",
  ".js": "text/plain",
  ".mjs": "text/plain",
  ".ts": "text/plain",
  ".py": "text/plain",
};
export function projectRoot(store: Store, taskId: string) {
  if (!/^[a-f0-9-]{36}$/.test(taskId)) throw new Error("Invalid task ID.");
  return path.join(store.root, "projects", taskId);
}
export async function within(
  root: string,
  relative: string,
  createParent = false,
): Promise<string> {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\0") ||
    relative.includes(":") ||
    relative.split(/[\\/]/).includes("..")
  )
    throw new Error("Use a relative path inside the task folder.");
  const base = path.resolve(root),
    target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep))
    throw new Error("Path leaves the task folder.");
  await mkdir(base, { recursive: true });
  if ((await lstat(base)).isSymbolicLink())
    throw new Error("Symbolic task roots are not allowed.");
  const realBase = await realpath(base);
  let cursor = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const item = await lstat(cursor);
      if (item.isSymbolicLink())
        throw new Error("Symbolic links are not allowed.");
      const resolved = await realpath(cursor);
      if (resolved !== realBase && !resolved.startsWith(realBase + path.sep))
        throw new Error("Resolved path leaves the task folder.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  if (createParent) await mkdir(path.dirname(target), { recursive: true });
  return target;
}
export async function artifact(
  store: Store,
  taskId: string,
  relativePath: string,
) {
  const file = await within(projectRoot(store, taskId), relativePath);
  const s = await stat(file);
  if (!s.isFile()) throw new Error("Expected an output file.");
  const prior = store
    .list<Artifact>("artifact")
    .find((a) => a.taskId === taskId && a.relativePath === relativePath);
  const a: Artifact = {
    id: prior?.id || id(),
    taskId,
    name: path.basename(relativePath),
    relativePath,
    mime:
      MIME[path.extname(relativePath).toLowerCase()] ||
      "application/octet-stream",
    size: s.size,
    createdAt: now(),
  };
  store.put("artifact", a);
  return a;
}
export async function fileDigest(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
