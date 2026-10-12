/**
 * main.js — Electron entry point.
 *
 * Responsibilities:
 *  1. Pick a per-user data directory (config, cache, logs).
 *  2. Load GITHUB_TOKEN / GITHUB_ORG from <data dir>/.env.
 *  3. Make sure the `copilot` CLI can be found (GUI apps on macOS don't
 *     inherit the PATH from your shell).
 *  4. Start the Express server on a free port and show it in a window.
 */

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Data directory ──────────────────────────────────────────────────────────

const DATA_DIR = path.join(app.getPath("appData"), "Release Radar");
const ENV_FILE = path.join(DATA_DIR, ".env");

app.setPath("userData", DATA_DIR);
fs.mkdirSync(DATA_DIR, { recursive: true });

// Must be set before server.js / cache.js / logger.js are required.
process.env.RELEASE_RADAR_DATA_DIR = DATA_DIR;
process.env.PORT = "0"; // let the OS pick a free port

const ENV_TEMPLATE = `# Release Radar configuration
GITHUB_TOKEN=
GITHUB_ORG=
# COPILOT_BIN=copilot
`;

if (!fs.existsSync(ENV_FILE)) {
  fs.writeFileSync(ENV_FILE, ENV_TEMPLATE, { mode: 0o600 });
}
require("dotenv").config({ path: ENV_FILE });

// ── PATH fix for GUI launches ───────────────────────────────────────────────

function fixPath() {
  if (process.platform === "win32") return;

  try {
    const shellBin = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(
      shellBin,
      ["-ilc", 'printf "__RR_PATH__%s__RR_PATH__" "$PATH"'],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const match = out.match(/__RR_PATH__([\s\S]*?)__RR_PATH__/);
    if (match && match[1]) process.env.PATH = match[1];
  } catch {
    // Fall through to the static fallbacks below
  }

  const home = process.env.HOME || "";
  const extras = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
  ];
  const current = (process.env.PATH || "").split(":");
  for (const dir of extras) {
    if (!current.includes(dir)) current.push(dir);
  }
  process.env.PATH = current.join(":");
}

fixPath();

// ── Window & server ─────────────────────────────────────────────────────────

let mainWindow = null;
let server = null;

function configMissing() {
  return !process.env.GITHUB_TOKEN || !process.env.GITHUB_ORG;
}

async function promptForConfig() {
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: "Release Radar needs configuring",
    detail:
      `Set GITHUB_TOKEN and GITHUB_ORG in:\n\n${ENV_FILE}\n\n` +
      "Then relaunch the app.",
    buttons: ["Open Config File", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await shell.openPath(ENV_FILE);
}

function startServer() {
  server = require("./server");
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve(server.address().port);
    server.once("listening", () => resolve(server.address().port));
    server.once("error", reject);
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 900,
    title: "Release Radar",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Open external links (PR URLs, compare link) in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: "Release Radar",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Open Config File",
          click: () => shell.openPath(ENV_FILE),
        },
        {
          label: "Open Logs Folder",
          click: () => shell.openPath(path.join(DATA_DIR, "logs")),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" }, // required for Cmd+C / Cmd+V to work
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock.setIcon(path.join(__dirname, "build", "icon.png"));
  }
  buildMenu();

  if (configMissing()) {
    await promptForConfig();
    app.quit();
    return;
  }

  try {
    const port = await startServer();
    createWindow(port);
  } catch (err) {
    dialog.showErrorBox("Release Radar failed to start", err.message);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) {
      createWindow(server.address().port);
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (server) server.close();
});
