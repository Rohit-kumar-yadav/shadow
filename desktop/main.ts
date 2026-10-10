import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} from "electron";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createApp } from "../server/app.js";

const APP_URL = "http://127.0.0.1:4310";
const backgroundLaunch = process.argv.includes("--background");
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let fastify: Awaited<ReturnType<typeof createApp>> | undefined;
let quitting = false;

app.setName("Shadow");
app.setAppUserModelId("com.shadow.assistant");

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function loginSettings() {
  return { path: process.execPath, args: ["--background"] };
}

function startupPreferencePath() {
  return path.join(app.getPath("userData"), "startup.json");
}

function setLaunchAtLogin(enabled: boolean) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginSettings() });
  writeFileSync(startupPreferencePath(), JSON.stringify({ enabled }));
  refreshTrayMenu();
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow?.show();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
}

function refreshTrayMenu() {
  if (!tray) return;
  const startsAtLogin =
    app.isPackaged && app.getLoginItemSettings(loginSettings()).openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Shadow", click: showWindow },
      {
        label: "Open in browser",
        click: () => void shell.openExternal(APP_URL),
      },
      { type: "separator" },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: startsAtLogin,
        click: (item) => setLaunchAtLogin(item.checked),
      },
      { type: "separator" },
      {
        label: "Quit Shadow",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createWindow() {
  const icon = path.join(app.getAppPath(), "build-assets", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 860,
    minHeight: 620,
    show: false,
    backgroundColor: "#171a16",
    title: "Shadow",
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.once("ready-to-show", () => {
    if (!backgroundLaunch) mainWindow?.show();
  });
  void mainWindow.loadURL(`${APP_URL}/pair#code=${fastify!.auth.code}`);
}

async function start() {
  const dataRoot = path.join(app.getPath("userData"), "data");
  await mkdir(dataRoot, { recursive: true });
  fastify = await createApp({
    root: dataRoot,
    staticRoot: path.join(app.getAppPath(), "dist"),
  });
  try {
    await fastify.app.listen({ port: 4310, host: "127.0.0.1" });
  } catch (error) {
    await fastify.app.close().catch(() => {});
    throw new Error(
      "Port 4310 is already in use. Close the terminal version of Shadow, then open the desktop app again.",
      { cause: error },
    );
  }
  void fastify.engine.pump();
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  const icon = nativeImage
    .createFromPath(path.join(app.getAppPath(), "build-assets", "icon.png"))
    .resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip("Shadow · Personal assistant");
  tray.on("double-click", showWindow);
  refreshTrayMenu();
  if (app.isPackaged) {
    let enabled = true;
    try {
      enabled =
        JSON.parse(await readFile(startupPreferencePath(), "utf8")).enabled !==
        false;
    } catch {}
    setLaunchAtLogin(enabled);
  }
  createWindow();
}

let shutdownStarted = false;
if (!hasSingleInstanceLock) app.quit();
else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", (event) => {
    quitting = true;
    if (fastify && !shutdownStarted) {
      event.preventDefault();
      shutdownStarted = true;
      void fastify.app.close().finally(() => {
        fastify = undefined;
        app.quit();
      });
    }
  });
  app.on("window-all-closed", () => {});
  app
    .whenReady()
    .then(start)
    .catch(async (error) => {
      await dialog.showMessageBox({
        type: "error",
        title: "Shadow could not start",
        message: error instanceof Error ? error.message : String(error),
      });
      fastify = undefined;
      app.quit();
    });
}
