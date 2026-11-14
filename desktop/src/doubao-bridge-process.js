const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { waitForService, ServiceRestarter, terminateChild } = require("./service-lifecycle");

function startupDetail(stderr) {
    const codes = {
        ACCOUNT_STORE_INVALID: "账号存档损坏，原文件已保留；请检查存档和备份。",
        ACCOUNT_STORE_MISSING: "账号存档缺失，备份已保留；请核对账号后恢复存档。",
        PORT_IN_USE: "豆包服务端口已被占用，请检查端口后重试。",
    };
    const match = /\[bridge-startup\] (ACCOUNT_STORE_INVALID|ACCOUNT_STORE_MISSING|PORT_IN_USE)\b/.exec(stderr);
    return match ? codes[match[1]] : "豆包服务启动失败，请查看日志后重试。";
}

// Electron runs the bridge as Node; Chromium windows belong to the desktop host.
class DoubaoBridgeProcess {
    constructor(bridgeDir, logDir, chromeProfileDir, options = {}) {
        Object.assign(this, { bridgeDir, logDir, chromeProfileDir, options });
        this.child = null;
        this.port = Number(process.env.BRIDGE_PORT) || 8787;
        this.logStream = null;
        this.token = "";
        this.stopping = false;
        this.status = { phase: "preparing" };
        this.restarter = new ServiceRestarter(() => this.start(), {
            onError: (error) => console.error(`[doubao-bridge] restart failed: ${error.message}`),
        });
    }

    setStatus(phase, detail) {
        if (this.status.phase === phase && this.status.detail === detail) return;
        this.status = { phase, ...(detail ? { detail } : {}) };
        this.options.onStatus?.(this.status);
    }

    async start() {
        if (this.stopping) throw new Error("豆包桥已停止");
        if (this.starting) return this.starting;
        this.starting = this.launch();
        try { return await this.starting; }
        finally { this.starting = null; }
    }

    async launch() {
        let stderr = "";
        let childClosed;
        this.setStatus("preparing");
        clearTimeout(this.monitorTimer);
        this.monitorAbort?.abort();
        await this.killChild();
        if (this.stopping) throw new Error("豆包桥已停止");
        try {
            if (!fs.existsSync(path.join(this.bridgeDir, "src", "server.js"))) throw new Error("缺少豆包桥运行资源");
            fs.mkdirSync(this.logDir, { recursive: true });
            fs.mkdirSync(this.chromeProfileDir, { recursive: true });
            if (!this.logStream) {
                const logFile = path.join(this.logDir, "doubao-bridge.log");
                if (fs.existsSync(logFile) && fs.statSync(logFile).size > 10 * 1024 * 1024) {
                    fs.rmSync(logFile + ".old", { force: true });
                    fs.renameSync(logFile, logFile + ".old");
                }
                this.logStream = fs.createWriteStream(logFile, { flags: "a" });
            }
            this.token = this.options.getToken?.() || "";
            if (!this.token) {
                this.token = crypto.randomBytes(12).toString("hex");
                this.options.saveToken?.(this.token);
            }
            const instanceId = crypto.randomUUID();
            clearTimeout(this.monitorTimer);
            this.instanceId = instanceId;
            const browserHost = await this.options.getBrowserHostInfo?.();
            if (!browserHost?.url || !browserHost?.token || !browserHost?.cdpPort) {
                throw new Error("客户端 Chromium 宿主尚未就绪");
            }
            let loginNeeded = false;
            const child = spawn(process.execPath, [path.join(this.bridgeDir, "src", "server.js")], {
                cwd: this.bridgeDir,
                windowsHide: true,
                env: {
                    ...process.env,
                    ELECTRON_RUN_AS_NODE: "1",
                    BRIDGE_PORT: String(this.port),
                    BRIDGE_HOST: "127.0.0.1",
                    BRIDGE_ADMIN_TOKEN: this.token,
                    BRIDGE_INSTANCE_ID: instanceId,
                    BRIDGE_ALLOWED_ORIGIN: this.options.allowedOrigin || "",
                    BRIDGE_DATA_DIR: this.options.dataDir,
                    BRIDGE_PROFILE_DIR: this.options.profileDir,
                    DOUBAO_BROWSER_HOST_URL: browserHost.url,
                    DOUBAO_BROWSER_HOST_TOKEN: browserHost.token,
                    DOUBAO_BROWSER_CDP_PORT: String(browserHost.cdpPort),
                },
                stdio: ["ignore", "pipe", "pipe"],
            });
            this.child = child;
            childClosed = new Promise((resolve) => child.once("close", resolve));
            const write = (chunk) => { if (!this.logStream.writableEnded) this.logStream.write(chunk); };
            child.stdout.on("data", write);
            child.stderr.on("data", (chunk) => { write(chunk); stderr = (stderr + chunk.toString("utf8")).slice(-16384); });
            child.on("error", (error) => { child.spawnError = error; });
            child.on("exit", (code) => {
                write(`\n[desktop] doubao-bridge exited code=${code}\n`);
                if (this.child !== child || this.stopping) return;
                this.setStatus("unavailable", "豆包服务已退出，请重试或查看日志");
                if (!this.starting) this.scheduleRestart();
            });
            this.probe?.abort();
            this.probe = new AbortController();
            await waitForService({
                url: `${this.baseUrl}/healthz`, child, signal: this.probe.signal,
                validate: (body) => {
                    const health = JSON.parse(body);
                    loginNeeded = health.loginNeeded;
                    return health.service === "doubao-bridge" && health.instanceId === instanceId;
                },
            });
            if (this.stopping || this.child !== child) throw new Error("豆包桥启动已取消");
            this.setStatus(loginNeeded ? "login-needed" : "ready");
            this.monitor(child, instanceId);
            return this.baseUrl;
        } catch (error) {
            this.probe?.abort();
            await this.killChild();
            if (childClosed) await Promise.race([childClosed, new Promise((resolve) => setTimeout(resolve, 1000))]);
            if (!this.stopping) this.setStatus("unavailable", startupDetail(stderr));
            throw error;
        }
    }

    scheduleRestart() {
        return !this.stopping && this.restarter.schedule();
    }
    monitor(child, instanceId) {
        this.monitorTimer = setTimeout(async () => {
            if (this.stopping || this.child !== child || child.exitCode !== null) return;
            const controller = new AbortController();
            this.monitorAbort = controller;
            const timeout = setTimeout(() => controller.abort(), 3000);
            try {
                const response = await fetch(`${this.baseUrl}/healthz`, { signal: controller.signal });
                if (!response.ok) throw new Error("health status");
                const health = await response.json();
                if (health.service !== "doubao-bridge" || health.instanceId !== instanceId) throw new Error("health instance");
                if (!this.stopping && this.child === child) this.setStatus(health.loginNeeded ? "login-needed" : "ready");
            } catch {
                if (!this.stopping && this.child === child) this.setStatus("unavailable", "豆包服务暂时无响应，可重试或查看日志");
            } finally {
                clearTimeout(timeout);
                if (!this.stopping && this.child === child && child.exitCode === null) this.monitor(child, instanceId);
            }
        }, 15000);
        this.monitorTimer.unref?.();
    }
    get baseUrl() { return `http://127.0.0.1:${this.port}`; }
    get adminToken() { return this.token; }
    killChild() {
        const child = this.child;
        if (!child?.pid) return Promise.resolve();
        return terminateChild(child, (done) => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, done));
    }
    async stop() {
        this.stopping = true;
        this.restarter.stop();
        clearTimeout(this.monitorTimer);
        this.monitorAbort?.abort();
        this.probe?.abort();
        await this.killChild();
        await this.starting?.catch(() => {});
        this.logStream?.end();
    }
}

module.exports = { DoubaoBridgeProcess, startupDetail };
