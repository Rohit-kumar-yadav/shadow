import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store, id } from "../server/store.js";
import { ToolBroker } from "../server/tools.js";
import { projectRoot } from "../server/files.js";
const root = await mkdtemp(path.join(tmpdir(), "shadow-tools-"));
const store = new Store(root),
  broker = new ToolBroker(store),
  taskId = id(),
  context = { taskId, signal: AbortSignal.timeout(60000) };
try {
  await mkdir(projectRoot(store, taskId), { recursive: true });
  const page = await broker.execute(
    {
      tool: "web.read",
      args: { url: "https://example.com" },
      summary: "Read a real public source",
    },
    context,
  );
  assert.equal(page.ok, true, JSON.stringify(page.output));
  const source = page.output as { url: string; title: string; text: string };
  assert.match(source.text, /documentation examples/i);
  const report = await broker.execute(
    {
      tool: "file.write",
      args: {
        path: "report.md",
        content:
          "# Live research check\n\n" +
          source.text +
          "\n\nSource: [" +
          source.title +
          "](" +
          source.url +
          ")\n\nRetrieved: " +
          new Date().toISOString() +
          "\n",
      },
      summary: "Save sourced report",
    },
    context,
  );
  assert.equal(report.ok, true);
  assert.match(
    await readFile(path.join(projectRoot(store, taskId), "report.md"), "utf8"),
    /https:\/\/example.com/,
  );
  const search = await broker.execute(
    {
      tool: "web.search",
      args: { query: "Tailscale Serve official documentation" },
      summary: "Check live search",
    },
    context,
  );
  assert.equal(search.ok, true, JSON.stringify(search.output));
  const result = search.output as { results: unknown[]; note?: string };
  console.log(
    "LIVE TOOLS VERIFIED: fetched a public source and saved a sourced report artifact.",
  );
  console.log(
    "Search: " +
      result.results.length +
      " results" +
      (result.note ? " · " + result.note : ""),
  );
} finally {
  await broker.browser.close();
  store.close();
  assert.ok(
    path
      .resolve(root)
      .startsWith(path.resolve(tmpdir()) + path.sep + "shadow-tools-"),
  );
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 6,
    retryDelay: 150,
  });
}
