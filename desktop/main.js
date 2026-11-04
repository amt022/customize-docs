// FormEasy desktop: runs the same engine + UI fully offline.
// The Python engine is started on a random loopback port and only accepts
// requests carrying a per-launch token, which this process injects.
const { app, BrowserWindow, Menu, dialog, shell, session } = require("electron");
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const TOKEN = crypto.randomBytes(24).toString("hex");
const isDev = !app.isPackaged;
let server = null;
let base = null;
let win = null;
let pendingFile = process.argv.slice(1).find((a) => a.toLowerCase().endsWith(".pdf"));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function serverCommand(port) {
  if (!isDev) {
    const exe = path.join(process.resourcesPath, "server", process.platform === "win32" ? "pdfmaster-server.exe" : "pdfmaster-server");
    const tesseract = path.join(process.resourcesPath, "tesseract", "tesseract.exe");
    return { cmd: exe, args: ["--port", String(port)], cwd: path.dirname(exe), web: path.join(process.resourcesPath, "web"),
      env: fs.existsSync(tesseract) ? { PDFMASTER_TESSERACT: tesseract } : {} };
  }
  const backend = path.resolve(__dirname, "..", "backend");
  const py = process.env.PDFMASTER_PYTHON ||
    path.join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return { cmd: py, args: ["-m", "pdfmaster", "--port", String(port)], cwd: backend, web: path.resolve(__dirname, "..", "web", "dist") };
}

async function startServer() {
  const port = await freePort();
  const { cmd, args, cwd, web, env = {} } = serverCommand(port);
  if (!fs.existsSync(cmd)) throw new Error(`PDF engine not found at ${cmd}`);
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const log = fs.createWriteStream(path.join(app.getPath("userData"), "engine.log"), { flags: "a" });
  server = spawn(cmd, args, {
    cwd,
    env: { ...process.env, PDFMASTER_DATA: dataDir, PDFMASTER_TOKEN: TOKEN, PDFMASTER_WEB: web, PDFMASTER_CORS: "", ...env },
    windowsHide: true,
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on("exit", (code) => {
    server = null;
    if (!app.isQuitting) dialog.showErrorBox("FormEasy", `The PDF engine stopped (code ${code}). See engine.log in ${app.getPath("userData")}.`);
  });
  base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/v1/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The PDF engine did not start within 60 seconds");
}

function stopServer() {
  if (!server) return;
  if (process.platform === "win32") execFile("taskkill", ["/pid", String(server.pid), "/T", "/F"], () => {});
  else server.kill();
}

async function openPdf(file) {
  const data = fs.readFileSync(file);
  const form = new FormData();
  form.append("file", new Blob([data], { type: "application/pdf" }), path.basename(file));
  const res = await fetch(`${base}/api/v1/documents`, { method: "POST", body: form, headers: { "X-PDFMaster-Token": TOKEN } });
  const body = await res.json();
  if (!res.ok || !body.success) {
    if (res.status === 401) {
      // password-protected: let the in-app dialog handle it
      win.loadURL(`${base}/`);
      dialog.showMessageBox(win, { message: "This PDF is password protected. Drop it on the start page to enter its password." });
      return;
    }
    throw new Error(body.message || `Could not open ${file}`);
  }
  await win.loadURL(`${base}/#doc=${body.data.id}`);
}

async function chooseAndOpen() {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!r.canceled && r.filePaths[0]) openPdf(r.filePaths[0]).catch((e) => dialog.showErrorBox("FormEasy", e.message));
}

function buildMenu() {
  const template = [
    {
      label: "&File",
      submenu: [
        { label: "Open PDF…", accelerator: "CmdOrCtrl+O", click: chooseAndOpen },
        { label: "All documents", accelerator: "CmdOrCtrl+Shift+H", click: () => win.loadURL(`${base}/`) },
        { type: "separator" },
        { label: "Show data folder", click: () => shell.openPath(app.getPath("userData")) },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "&Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "&View",
      submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
        ...(isDev ? [{ role: "toggleDevTools" }] : [])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "FormEasy",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  // only the local engine gets the token
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${base}/*`] }, (details, cb) => {
    details.requestHeaders["X-PDFMaster-Token"] = TOKEN;
    cb({ requestHeaders: details.requestHeaders });
  });
  // never navigate away from the app; external links open in the browser
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(base)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(base)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.once("ready-to-show", () => win.show());
  buildMenu();
  if (pendingFile) {
    const f = pendingFile;
    pendingFile = null;
    await openPdf(f).catch((e) => dialog.showErrorBox("FormEasy", e.message));
  } else {
    await win.loadURL(`${base}/`);
  }
  if (process.env.PDFMASTER_SMOKE) {
    // CI/self-check: prove the UI loaded and the API answers through the token, then exit
    const out = await win.webContents.executeJavaScript(
      `fetch("/api/v1/documents").then(r => r.status).then(s => document.title + " | api " + s)`);
    console.log("SMOKE", out, "| sandboxed node:", await win.webContents.executeJavaScript("typeof require"));
    app.isQuitting = true;
    stopServer();
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const f = argv.slice(1).find((a) => a.toLowerCase().endsWith(".pdf"));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) openPdf(f).catch((e) => dialog.showErrorBox("FormEasy", e.message));
    }
  });
  app.whenReady().then(async () => {
    try {
      await startServer();
      await createWindow();
    } catch (e) {
      dialog.showErrorBox("FormEasy could not start", String(e.message || e));
      app.isQuitting = true;
      stopServer();
      app.quit();
    }
  });
  app.on("before-quit", () => {
    app.isQuitting = true;
    stopServer();
  });
  app.on("window-all-closed", () => app.quit());
}
