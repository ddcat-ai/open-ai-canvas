const { spawn, execFile } = require("child_process");
const { waitForService, ServiceRestarter, terminateChild } = require("./service-lifecycle");
const path = require("path");
const fs = require("fs");

// 后端进程生命周期：分配端口、拉起进程、健康检查、退出时连子进程树一起收掉。
//
// 2026-11-10 审计补强：此前 child.on("exit") 只写一行日志，后端一死（崩溃/OOM/被外部
// taskkill）客户端全功能不可用，而豆包桥仍在 8787 正常应答 /healthz——运维面板看起来
// 「服务在线」，实际画布/生成全断，只能靠用户自己发现再重启应用。现与桥同款自愈：
// 非主动停止的退出 → 冷却 5s 后原地拉起（复用同一端口，本地代理 URL 不变），
// 五分钟内最多自动拉起 3 次，避免短暂健康后反复崩溃造成无限重启。

class BackendProcess {
    // options.onUnexpectedExit(code)：非主动停止的退出回调（由 main.js 决策是否拉起）
    // options.onRecovered(baseUrl)：拉起成功回调
    constructor(exePath, dataDir, logDir, options = {}) {
        this.exePath = exePath;
        this.dataDir = dataDir;
        this.logDir = logDir;
        this.options = options || {};
        this.child = null;
        this.port = 0;
        this.logStream = null;
        this.stopping = false;
        this.probe = null;
        this.restarter = new ServiceRestarter(async () => {
            const base = await this.start({ reusePort: true });
            this.options.onRecovered?.(base);
        }, { onError: (error) => console.error(`[desktop] backend restart failed: ${error.message}`) });
        this.lastExitCode = null;
    }

    // 先占一个随机空闲端口再传给后端，避免固定端口冲突。
    async allocatePort() {
        return new Promise((resolve, reject) => {
            const server = net_createServer();
            server.on("error", reject);
            server.listen(0, "127.0.0.1", () => {
                this.port = server.address().port;
                server.close(() => resolve(this.port));
            });
        });
    }

    // 日志流只建一次：重启复用同一条 append 流，避免句柄泄漏与日志交错。
    ensureLogStream() {
        if (this.logStream) return this.logStream;
        fs.mkdirSync(this.logDir, { recursive: true });
        this.logStream = fs.createWriteStream(path.join(this.logDir, "backend.log"), { flags: "a" });
        return this.logStream;
    }

    // reusePort=true：重启时沿用上次端口（本地同源代理把 backend.baseUrl 固化在
    // startLocalServer 里，端口一变 /api 反代就指向旧地址）。
    async start({ reusePort = false } = {}) {
        if (this.stopping) throw new Error("后端已停止");
        if (this.starting) return this.starting;
        this.starting = this.launch(reusePort);
        try { return await this.starting; }
        finally { this.starting = null; }
    }

    async launch(reusePort) {
        await this.killChild();
        try {
        if (!reusePort || !this.port) {
            await this.allocatePort();
        }
        if (this.stopping) throw new Error("后端已停止");
        fs.mkdirSync(this.dataDir, { recursive: true });
        const logStream = this.ensureLogStream();

        // 官方插件包目录：打包版随安装分发（exe 同级 plugin-packages/）；
        // 开发模式未随 .local 分发时不设置，走后端向上搜索命中仓库目录。
        const packagedPluginDir = path.join(path.dirname(this.exePath), "plugin-packages");
        const pluginEnv = fs.existsSync(packagedPluginDir)
            ? { CANVAS_OFFICIAL_PLUGIN_DIR: packagedPluginDir }
            : {};

        this.child = spawn(this.exePath, [], {
            cwd: path.dirname(this.exePath),
            windowsHide: true,
            env: {
                ...process.env,
                CANVAS_BACKEND_ADDR: `127.0.0.1:${this.port}`,
                CANVAS_BACKEND_DATA_DIR: this.dataDir,
                CANVAS_DATABASE_DRIVER: "sqlite",
                CANVAS_AUTO_MIGRATE: "true",
                GIN_MODE: "release",
                CANVAS_LOG_LEVEL: "info",
                CANVAS_LOG_FORMAT: "text",
                // 直连渠道的上游在回环地址（本机/局域网服务）：
                // SSRF 防护默认拦回环地址，这里精确放行 127.0.0.1/localhost（不动全局开关）。
                CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS: "127.0.0.1,localhost",
                // Go 运行时内存上限（2026-11-11 实测后端常驻 212 MB）：
                // GOMEMLIMIT 让 GC 在逼近软上限时更积极，GOGC=50 把堆增长阈值从 100% 降到 50%。
                // 桌面客户端后端不是吞吐型服务，宁可多花一点 CPU 也要压住常驻内存；
                // 用户显式设置的环境变量优先（便于排查时临时放开）。
                ...(process.env.GOMEMLIMIT ? {} : { GOMEMLIMIT: "160MiB" }),
                ...(process.env.GOGC ? {} : { GOGC: "50" }),
                ...pluginEnv,
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        const child = this.child;
        const write = (chunk) => { if (!logStream.writableEnded) logStream.write(chunk); };
        child.stdout.on("data", write);
        child.stderr.on("data", write);
        child.on("error", (error) => { child.spawnError = error; });
        child.on("exit", (code, signal) => {
            if (this.child !== child) return;
            this.lastExitCode = code;
            write(`\n[desktop] backend exited code=${code} signal=${signal || "none"}\n`);
            // 主动 stop() 不算异常；stopping 期间退出直接返回
            if (this.stopping || this.starting) return;
            if (this.options.onUnexpectedExit) {
                try {
                    this.options.onUnexpectedExit(code);
                } catch {
                    /* 回调异常不影响进程状态 */
                }
            }
        });
        // First launch may migrate the database and import the bundled taxonomy.
        // Keep waiting for slow disks while waitForService still detects an early exit.
        return await this.waitForHealthy(180000);
        } catch (error) {
            this.ensureLogStream().write(`[desktop] backend startup failed: ${error.message}\n`);
            await this.killChild();
            throw error;
        }
    }

    /** 冷却后原地拉起（复用端口）。调用方负责判断是否该重试。 */
    scheduleRestart() {
        return !this.stopping && this.restarter.schedule();
    }

    async waitForHealthy(timeoutMs) {
        this.probe?.abort();
        this.probe = new AbortController();
        await waitForService({ url: `${this.baseUrl}/api/health`, child: this.child, signal: this.probe.signal, timeoutMs });
        return this.baseUrl;
    }

    get baseUrl() {
        return `http://127.0.0.1:${this.port}`;
    }

    killChild() {
        const child = this.child;
        if (!child?.pid) return Promise.resolve();
        return terminateChild(child, (done) => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, done));
    }

    async stop() {
        this.stopping = true;
        this.restarter.stop();
        this.probe?.abort();
        await this.killChild();
        await this.starting?.catch(() => {});
        if (this.logStream && !this.logStream.writableEnded) this.logStream.end();
    }
}

function net_createServer() {
    return require("net").createServer();
}

module.exports = { BackendProcess };
