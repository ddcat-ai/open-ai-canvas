const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ACCOUNT_ID = /^acct\d+$/;
const ENTRY_URL = "https://www.doubao.com/chat/";
const MARKER_PREFIX = "yingce-doubao:";

class DoubaoBrowserHost {
    constructor({ BrowserWindow, userDataDir, devToolsFile, accountScope, logger = console }) {
        if (accountScope !== undefined && !/^[a-f0-9]{64}$/.test(accountScope)) {
            throw new Error("豆包账户隔离标识无效");
        }
        this.BrowserWindow = BrowserWindow;
        this.userDataDir = userDataDir;
        this.accountScope = accountScope;
        this.devToolsFile = devToolsFile || path.join(userDataDir, "DevToolsActivePort");
        this.logger = logger;
        this.token = crypto.randomBytes(32).toString("hex");
        this.windows = new Map();
        this.pending = new Map();
        this.busyAccounts = new Set();
        this.server = null;
        this.info = null;
        this.stopping = false;
    }

    async start() {
        if (this.stopping) throw new Error("豆包浏览器宿主已停止");
        if (this.info) return this.info;
        const cdpPort = await this.waitForDevToolsPort();
        if (this.stopping) throw new Error("豆包浏览器宿主已停止");
        const server = http.createServer((req, res) => void this.handle(req, res));
        this.server = server;
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        if (this.stopping) {
            if (this.server === server) this.server = null;
            if (server.listening) await new Promise((resolve) => server.close(resolve));
            throw new Error("豆包浏览器宿主已停止");
        }
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("豆包浏览器控制端口分配失败");
        this.info = {
            url: `http://127.0.0.1:${address.port}`,
            token: this.token,
            cdpPort,
        };
        return this.info;
    }

    async waitForDevToolsPort(timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        let lastError;
        while (Date.now() < deadline) {
            try {
                const raw = await fs.promises.readFile(this.devToolsFile, "utf8");
                const port = Number(raw.split(/\r?\n/, 1)[0]);
                if (Number.isInteger(port) && port > 0 && port < 65536) {
                    await this.checkDevTools(port);
                    return port;
                }
            } catch (error) {
                lastError = error;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        throw new Error(`客户端 Chromium 调试接口未就绪${lastError ? `：${lastError.message}` : ""}`);
    }

    checkDevTools(port) {
        return new Promise((resolve, reject) => {
            const request = http.get({ hostname: "127.0.0.1", port, path: "/json/version", timeout: 1200 }, (response) => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => { body += chunk; });
                response.on("end", () => {
                    try {
                        const info = JSON.parse(body);
                        if (response.statusCode === 200 && info.webSocketDebuggerUrl) resolve();
                        else reject(new Error("Chromium CDP 响应无效"));
                    } catch (error) { reject(error); }
                });
            });
            request.on("error", reject);
            request.on("timeout", () => request.destroy(new Error("Chromium CDP 连接超时")));
        });
    }

    async handle(req, res) {
        res.setHeader("Cache-Control", "no-store");
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (req.method === "GET" && url.pathname === "/healthz") {
            return this.send(res, 200, { service: "doubao-browser-host", ready: Boolean(this.info) });
        }
        const authorization = req.headers.authorization || "";
        if (!this.authorized(authorization)) return this.send(res, 401, { error: "unauthorized" });

        if (req.method === "POST" && url.pathname === "/maintenance/close-idle") {
            const idleMs = Number(url.searchParams.get("idleMs"));
            if (!Number.isFinite(idleMs) || idleMs < 1000) return this.send(res, 400, { error: "invalid_idle_timeout" });
            return this.send(res, 200, { closed: this.closeIdle(idleMs) });
        }
        const match = url.pathname.match(/^\/accounts\/(acct\d+)(?:\/(ensure|touch|begin|end))?$/);
        if (!match) return this.send(res, 404, { error: "not_found" });
        const [, accountId, action] = match;
        if (req.method === "POST" && action === "begin") {
            this.busyAccounts.add(accountId);
            return this.send(res, 200, { ok: true });
        }
        if (req.method === "POST" && action === "end") {
            this.busyAccounts.delete(accountId);
            const entry = this.windows.get(accountId);
            if (entry && !entry.window.isDestroyed()) entry.lastUsedAt = Date.now();
            return this.send(res, 200, { ok: true });
        }
        if (req.method === "POST" && action === "ensure") {
            try {
                const entry = await this.ensure(accountId);
                return this.send(res, 200, { accountId, pageMarker: entry.marker, cdpPort: this.info.cdpPort, userAgent: entry.userAgent });
            } catch (error) {
                this.logger.error?.(`[doubao-browser] ${accountId}: ${error.message}`);
                return this.send(res, 503, { error: error.message || "browser_unavailable" });
            }
        }
        if (req.method === "POST" && action === "touch") {
            const entry = this.windows.get(accountId);
            if (entry && !entry.window.isDestroyed()) entry.lastUsedAt = Date.now();
            return this.send(res, 200, { ok: Boolean(entry) });
        }
        if (req.method === "DELETE" && !action) {
            this.close(accountId);
            return this.send(res, 200, { ok: true });
        }
        return this.send(res, 405, { error: "method_not_allowed" });
    }

    authorized(value) {
        const supplied = Buffer.from(value.replace(/^Bearer\s+/i, ""));
        const expected = Buffer.from(this.token);
        return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    }

    async ensure(accountId) {
        if (this.stopping) throw new Error("豆包浏览器宿主已停止");
        if (!ACCOUNT_ID.test(accountId)) throw new Error("豆包账号标识无效");
        const current = this.windows.get(accountId);
        if (current && !current.window.isDestroyed()) {
            current.lastUsedAt = Date.now();
            await this.setPageMarker(current.window, accountId);
            return current;
        }
        if (this.pending.has(accountId)) return this.pending.get(accountId);
        const pending = this.createWindow(accountId);
        this.pending.set(accountId, pending);
        try { return await pending; }
        finally { if (this.pending.get(accountId) === pending) this.pending.delete(accountId); }
    }

    async createWindow(accountId) {
        const marker = MARKER_PREFIX + accountId;
        const win = new this.BrowserWindow({
            width: 1440,
            height: 900,
            show: false,
            skipTaskbar: true,
            autoHideMenuBar: true,
            webPreferences: {
                partition: `persist:peekreel-doubao-${this.accountScope ? `${this.accountScope}-` : ""}${accountId}`,
                devTools: false,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                backgroundThrottling: false,
                paintWhenInitiallyHidden: true,
            },
        });
        // This window is a background automation surface. Keep it hidden even if
        // a future code path accidentally attempts to reveal it.
        for (const method of ["show", "showInactive", "showAndFocus"]) {
            if (typeof win[method] === "function") {
                win[method] = () => {
                    this.logger.warn?.(`[doubao-browser] ignored ${method}() for hidden account window ${accountId}`);
                    return win;
                };
            }
        }
        // Keep a final guard at Electron's visibility boundary as well. This
        // covers future calls that bypass the public show methods.
        win.on("show", () => win.hide());
        win.on("ready-to-show", () => win.hide());
        const chromeVersion = process.versions.chrome || "131.0.0.0";
        const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
        win.webContents.setUserAgent(userAgent);
        win.webContents.setAudioMuted(true);
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        const browserSession = win.webContents.session;
        browserSession?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
        browserSession?.setPermissionCheckHandler?.(() => false);
        const entry = { window: win, marker, userAgent, lastUsedAt: Date.now() };
        this.windows.set(accountId, entry);
        const applyMarker = () => void this.setPageMarker(win, accountId);
        win.webContents.on("did-navigate", applyMarker);
        win.webContents.on("did-navigate-in-page", applyMarker);
        win.webContents.on("render-process-gone", (_event, details) => {
            this.logger.warn?.(`[doubao-browser] renderer exited (${accountId}): ${details.reason}`);
        });
        win.on("closed", () => {
            if (this.windows.get(accountId)?.window === win) this.windows.delete(accountId);
        });
        try {
            await win.loadURL(ENTRY_URL);
            if (this.stopping || win.isDestroyed()) throw new Error("豆包浏览器宿主已停止");
            await this.setPageMarker(win, accountId);
            return entry;
        } catch (error) {
            if (this.windows.get(accountId)?.window === win) this.windows.delete(accountId);
            if (!win.isDestroyed()) win.destroy();
            throw new Error(`豆包页面加载失败：${error.message}`);
        }
    }

    async setPageMarker(win, accountId) {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
        const marker = JSON.stringify(MARKER_PREFIX + accountId);
        await win.webContents.executeJavaScript(`window.name = ${marker}; true`).catch(() => {});
    }

    close(accountId) {
        const entry = this.windows.get(accountId);
        if (!entry) return false;
        this.windows.delete(accountId);
        if (!entry.window.isDestroyed()) entry.window.destroy();
        return true;
    }

    closeIdle(idleMs) {
        const now = Date.now();
        const closed = [];
        // Keep one recently used window warm; active accounts are protected even
        // when a cleanup request races with task dispatch.
        const idleEntries = [...this.windows].filter(([id, entry]) =>
            !this.busyAccounts.has(id) && !entry.window.isDestroyed());
        idleEntries.sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt);
        const warmAccount = idleEntries[0]?.[0];
        for (const [accountId, entry] of this.windows) {
            if (accountId !== warmAccount && !this.busyAccounts.has(accountId) && now - entry.lastUsedAt >= idleMs) {
                this.close(accountId);
                closed.push(accountId);
            }
        }
        return closed;
    }

    async stop() {
        this.stopping = true;
        this.busyAccounts.clear();
        for (const accountId of this.windows.keys()) this.close(accountId);
        if (this.server) {
            const server = this.server;
            this.server = null;
            await new Promise((resolve) => server.close(resolve));
        }
        this.info = null;
    }

    send(res, status, payload) {
        const body = JSON.stringify(payload);
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
        res.end(body);
    }
}

module.exports = { DoubaoBrowserHost, ACCOUNT_ID, MARKER_PREFIX };
