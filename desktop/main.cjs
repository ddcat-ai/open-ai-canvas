const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");

// 固定端口 = 固定 origin。Electron 的 localStorage / IndexedDB 按 origin 隔离，
// 换端口会看起来像“作品全丢了”，所以这里绝不做随机端口兜底。
// 固定端口 = 固定 origin；测试时可用环境变量换独立 profile / 端口，不影响用户数据。
const PORT = Number(process.env.DMC_PORT || 47821);
const HOST = "127.0.0.1";
const APP_NAME = "DMC";
const APP_URL = "http://" + HOST + ":" + PORT + "/";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function webRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, "web-dist");
  return path.resolve(__dirname, "..", "web", "dist");
}

function serveStatic(req, res) {
  try {
    const root = webRoot();
    const url = new URL(req.url || "/", APP_URL);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    let filePath = path.normalize(path.join(root, pathname));
    if (!filePath.startsWith(path.normalize(root + path.sep)) && filePath !== path.normalize(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA 路由回退；静态资源 404 仍然回 404，避免把 JS 当 HTML 返回。
      if (path.extname(pathname)) {
        res.writeHead(404).end("Not found");
        return;
      }
      filePath = path.join(root, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500).end("Internal error");
    console.error("[dmc] static server error", error);
  }
}

let server = null;
let mainWindow = null;

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer(serveStatic);
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve());
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#0b0b0d",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(APP_URL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setName(APP_NAME);
  app.setPath("userData", process.env.DMC_USER_DATA_DIR ? path.resolve(process.env.DMC_USER_DATA_DIR) : path.join(app.getPath("appData"), APP_NAME));
  app.setAppUserModelId("cn.ll2.dmc");

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (error) {
      const busy = error && error.code === "EADDRINUSE";
      dialog.showErrorBox(
        "DMC 无法启动",
        busy
          ? "本机端口 47821 被其它程序占用了。请先关闭占用该端口的程序，再重新打开 DMC。"
          : "本地页面服务启动失败：" + (error && error.message ? error.message : String(error)),
      );
      app.quit();
      return;
    }
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (server) server.close();
    app.quit();
  });
}
