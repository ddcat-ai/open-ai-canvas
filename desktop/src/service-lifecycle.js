const http = require("http");
const pendingTerminations = new WeakMap();

// taskkill finishing only means Windows accepted the request. Wait for Node's exit
// event before allowing Electron to quit or a replacement child to start.
function terminateChild(child, killTree, timeoutMs = 5000) {
    if (!child || child.exitCode !== null || child.signalCode || child.spawnError) return Promise.resolve();
    const pending = pendingTerminations.get(child);
    if (pending) return pending;
    const termination = new Promise((resolve, reject) => {
        let settled = false;
        let killError;
        const timer = setTimeout(() => finish(new Error(killError
            ? `结束服务进程失败且进程未退出：${killError.message}`
            : "等待服务进程退出超时")), timeoutMs);
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.removeListener("exit", onExit);
            child.removeListener("error", onError);
            error ? reject(error) : resolve();
        };
        const onExit = () => finish();
        const onError = () => {
            if (child.spawnError || !child.pid) finish();
        };
        child.once("exit", onExit);
        child.once("error", onError);
        try {
            killTree((error) => {
                if (child.exitCode !== null || child.signalCode || child.spawnError) return finish();
                if (error) killError = error;
            });
        } catch (error) {
            killError = error;
        }
    });
    pendingTerminations.set(child, termination);
    termination.then(
        () => { if (pendingTerminations.get(child) === termination) pendingTerminations.delete(child); },
        () => { if (pendingTerminations.get(child) === termination) pendingTerminations.delete(child); },
    );
    return termination;
}

// One request and one retry timer per probe. A stopped or superseded child cannot become ready.
function waitForService({ url, child, signal, validate = () => true, timeoutMs = 30000 }) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        let request;
        const deadlineTimer = setTimeout(() => finish(new Error("服务健康检查超时，请查看日志")), timeoutMs);
        const exited = () => finish(new Error("服务进程提前退出，请查看日志"));
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(deadlineTimer);
            child.removeListener("exit", exited);
            child.removeListener("error", exited);
            signal?.removeEventListener("abort", abort);
            request?.destroy();
            error ? reject(error) : resolve();
        };
        const abort = () => finish(new Error("服务启动已取消"));
        const attempt = () => {
            if (settled) return;
            if (signal?.aborted) return abort();
            if (child.exitCode !== null || child.signalCode || child.spawnError) {
                return finish(new Error("服务进程提前退出，请查看日志"));
            }
            if (Date.now() >= deadline) return finish(new Error("服务健康检查超时，请查看日志"));
            let retried = false;
            const retry = () => {
                if (retried || settled) return;
                retried = true;
                timer = setTimeout(attempt, Math.min(400, Math.max(0, deadline - Date.now())));
            };
            const current = http.get(url, (response) => {
                let body = "";
                response.on("data", (chunk) => {
                    body += chunk;
                    if (body.length > 65536) response.destroy();
                });
                response.on("error", retry);
                response.on("aborted", retry);
                response.on("end", () => {
                    if (settled) return;
                    let valid = false;
                    try { valid = response.statusCode === 200 && validate(body); } catch {}
                    if (valid) finish();
                    else retry();
                });
            });
            request = current;
            current.on("error", retry);
            current.setTimeout(Math.min(2000, Math.max(1, deadline - Date.now())), () => current.destroy(new Error("health timeout")));
        };
        child.once("exit", exited);
        child.once("error", exited);
        signal?.addEventListener("abort", abort, { once: true });
        attempt();
    });
}

// Fast health success does not reset the budget: at most three restarts in five minutes.
class ServiceRestarter {
    constructor(start, { cooldownMs = 5000, windowMs = 300000, limit = 3, onError = () => {}, now = Date.now } = {}) {
        Object.assign(this, { start, cooldownMs, windowMs, limit, onError, now });
        this.attempts = [];
        this.stopped = false;
        this.running = false;
        this.timer = null;
    }
    schedule() {
        if (this.stopped || this.timer) return false;
        if (this.running) { this.pending = true; return true; }
        const now = this.now();
        this.attempts = this.attempts.filter((at) => now - at < this.windowMs);
        if (this.attempts.length >= this.limit) return false;
        this.attempts.push(now);
        this.timer = setTimeout(async () => {
            this.timer = null;
            if (this.stopped) return;
            this.running = true;
            try { await this.start(); }
            catch (error) {
                this.onError(error);
                this.pending = true;
            } finally {
                this.running = false;
                if (this.pending) { this.pending = false; this.schedule(); }
            }
        }, this.cooldownMs);
        this.timer.unref?.();
        return true;
    }
    stop() {
        this.stopped = true;
        clearTimeout(this.timer);
        this.timer = null;
    }
}

module.exports = { waitForService, ServiceRestarter, terminateChild };
