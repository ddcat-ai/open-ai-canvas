// 主进程直连渠道启动同步：激活后每次启动把服务器目录（换钥/增删模型无需发版）
// 写进本地后端。激活页请求主进程同步，本机桥的令牌不交给页面。
// 失败一律吞掉记日志：渠道同步不影响主流程。

const path = require("path");
const fs = require("fs");

async function syncDirectChannelsAtBoot(options) {
    const { backendBaseUrl, catalogUrl, activation, relayUrl, localChannels, activationDir, log, signal, fetchImpl = fetch } = options;
    signal?.throwIfAborted();
    const { username, password, apiKey } = activation || {};
    if (!username || !password) return { skipped: "not-activated" };
    if (!catalogUrl && !(relayUrl && apiKey)) return { skipped: "nothing-to-sync" };

    // seed-core.js 是无模块格式发行脚本：require 后挂到 globalThis（与激活页/e2e 同一份逻辑）
    // 路径解析（2026-11-10 修）：打包版里 activation/ 位于 resources/activation，
    // 不在 app.asar 内。旧代码用 __dirname/../activation 会落到 app.asar/activation（不存在）
    // → 启动同步静默 skipped:"no-seed"，目录更新永远进不来（本机 fast 模型缺失即由此导致）。
    // 这里优先用调用方给的 activationDir（resources.activationDir），再退回旧路径与 __dirname。
    const candidates = [
        activationDir && path.join(activationDir, "seed-core.js"),
        path.join(__dirname, "..", "activation", "seed-core.js"),
        path.join(__dirname, "activation", "seed-core.js"),
        process.resourcesPath && path.join(process.resourcesPath, "activation", "seed-core.js"),
    ].filter(Boolean);
    const seedPath = candidates.find((p) => {
        try { return fs.existsSync(p); } catch { return false; }
    });
    if (!seedPath) return { skipped: "no-seed" };
    require(seedPath);
    const seed = globalThis.PeekReelSeed;

    let cookie = "";
    const api = async (pathname, requestOptions = {}) => {
        signal?.throwIfAborted();
        const headers = { "Content-Type": "application/json", ...(requestOptions.headers || {}) };
        if (cookie) headers.Cookie = cookie;
        const res = await fetchImpl(`${backendBaseUrl}${pathname}`, { ...requestOptions, headers, signal });
        signal?.throwIfAborted();
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0];
        let body = null;
        try { body = await res.json(); } catch { throw new Error(`响应非 JSON（HTTP ${res.status}）`); }
        signal?.throwIfAborted();
        if (!res.ok || body.code !== 0) throw new Error(body.msg || `请求失败 HTTP ${res.status} code=${body.code}`);
        return body.data;
    };

    // 会话自愈：本地账户由应用托管，登录拿 cookie 后同步。
    try {
        await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    } catch (error) {
        signal?.throwIfAborted();
        log(`登录本地后端失败，跳过同步：${error.message}`);
        return { skipped: "login-failed" };
    }

    const lines = [];
    const results = {};

    // 1. 中转模型目录刷新：激活后 relay 新增模型（如图片渠道）自动补齐，密钥漂移自愈。
    if (relayUrl && apiKey) {
        try {
            results.relay = await seed.syncRelayModels(api, { relayUrl, apiKey }, (text) => lines.push(text));
        } catch (error) {
            signal?.throwIfAborted();
            lines.push(`中转模型刷新失败（下次启动重试）：${error.message}`);
        }
    }

    // 2. 直连渠道（服务器目录）。
    if (catalogUrl) {
        try {
            results.direct = await seed.syncDirectChannels(api, catalogUrl, (text) => lines.push(text), localChannels || {}, { signal, fetchImpl });
        } catch (error) {
            signal?.throwIfAborted();
            lines.push(`直连渠道同步失败（下次启动重试）：${error.message}`);
        }
    }
    lines.forEach((line) => log(line));
    return results;
}

module.exports = { syncDirectChannelsAtBoot };
