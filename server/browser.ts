import { chromium, type BrowserContext, type Page } from "playwright-core";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { validateUrl } from "./network.js";
import { Store } from "./store.js";
export class BrowserManager {
  context?: BrowserContext;
  pages = new Map<string, Page>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(public store: Store) {}
  private profileRoot() {
    return path.join(this.store.root, "browser-profile");
  }

  private browserExecutable() {
    const channel = this.store.settings().browserChannel;
    if (process.platform === "win32") {
      const roots = [
        process.env.PROGRAMFILES,
        process.env["PROGRAMFILES(X86)"],
        process.env.LOCALAPPDATA,
      ].filter((value): value is string => Boolean(value));
      const relative =
        channel === "msedge"
          ? path.join("Microsoft", "Edge", "Application", "msedge.exe")
          : path.join("Google", "Chrome", "Application", "chrome.exe");
      const executable = roots
        .map((root) => path.join(root, relative))
        .find(existsSync);
      if (executable) return executable;
      throw new Error(
        `${channel === "msedge" ? "Microsoft Edge" : "Google Chrome"} is not installed in a standard location.`,
      );
    }
    return channel === "msedge" ? "microsoft-edge" : "google-chrome";
  }

  async openManualLogin(url = "https://accounts.google.com/") {
    await this.close();
    const root = this.profileRoot();
    await mkdir(root, { recursive: true });
    const child = spawn(
      this.browserExecutable(),
      [
        `--user-data-dir=${root}`,
        "--profile-directory=Default",
        "--no-first-run",
        "--no-default-browser-check",
        url,
      ],
      { detached: true, stdio: "ignore", windowsHide: false },
    );
    child.unref();
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => {
      release = r;
    });
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }
  async launch() {
    if (this.context) return this.context;
    const root = this.profileRoot();
    await mkdir(root, { recursive: true });
    this.context = await chromium.launchPersistentContext(root, {
      channel: this.store.settings().browserChannel,
      headless: false,
      viewport: { width: 1365, height: 900 },
      acceptDownloads: true,
      args: [
        "--disable-extensions",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
      serviceWorkers: "block",
    });
    await this.context.route("**/*", async (route) => {
      try {
        const u = route.request().url();
        if (u.startsWith("data:") || u.startsWith("blob:"))
          return route.continue();
        await validateUrl(u);
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    this.context.on("close", () => {
      this.context = undefined;
      this.pages.clear();
    });
    return this.context;
  }
  async page(taskId: string) {
    const context = await this.launch();
    let page = this.pages.get(taskId);
    if (!page || page.isClosed()) {
      page = await context.newPage();
      this.pages.set(taskId, page);
    }
    page.setDefaultTimeout(15000);
    return page;
  }
  async snapshot(taskId: string) {
    const page = await this.page(taskId);
    const text = (
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    ).slice(0, 14000);
    const controls = await page
      .locator('a,button,input,textarea,select,[role="button"]')
      .evaluateAll((els) =>
        els.slice(0, 100).map((el, i) => ({
          index: i,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 100),
          label:
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("name") ||
            "",
          type: el.getAttribute("type"),
          href: el.getAttribute("href"),
        })),
      );
    return {
      url: page.url(),
      title: await page.title(),
      text,
      controls,
      needsLogin:
        /sign in to continue|log in to continue|please (?:sign|log) in|session (?:has )?expired|verify you are human|captcha/i.test(
          text,
        ),
    };
  }
  async close() {
    await this.context?.close();
    this.context = undefined;
  }
}
