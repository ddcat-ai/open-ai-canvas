const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// 本地同源服务器：静态托管 web/dist，/api 反代到本地后端。
// 前端用相对路径 /api，因此静态源与代理必须同端口，SSE 与 WebSocket 也要透传。
// 商业化扩展：
//   /peekreel-activation          激活引导页（首运行/换密钥/会话自愈）
//   /peekreel-activation/config   激活页运行参数（relayUrl/consoleUrl）
//   /peekreel-relay/*             反代到 PeekReel 中转站（激活时验证用户密钥）
//   /peekreel-passport/*          反代到中转站 NewAPI 用户侧端点（登录/注册/令牌/充值）
//   POST /api/auth/logout         拦截：本地账户由应用托管，退出无意义

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
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".map": "application/json",
};

/**
 * 稳定的本地端口（2026-11-12）。
 *
 * 原来 listen(0) 让系统随机分配端口，每次启动 web 界面的 origin 都不同
 * （http://127.0.0.1:<随机端口>）。而 Chromium 的 Cache API / Service Worker
 * 存储是按 origin 隔离的 —— 每换一次端口就新建一份缓存桶，旧桶永不回收。
 * 实测：本机 94 次启动 → Service Worker/CacheStorage 里 94 份 ffmpeg wasm
 * （每份 30.7 MB）→ 2.89 GB，全部占在 C 盘。
 *
 * 持久化实际端口，首次优先保留唯一历史 IndexedDB 来源；新装默认 17831。
 * 端口占用时明确报错，避免换来源后用户配置看起来丢失。
 */
const DEFAULT_PORT = 17831;

function startLocalServer(webDistDir, backendBaseUrl, options = {}) {
    let backend = backendBaseUrl ? new URL(backendBaseUrl) : null;
    const backendConnections = new Set();
    function trackBackendConnection(connection) {
        backendConnections.add(connection);
        connection.once("close", () => backendConnections.delete(connection));
    }
    function setBackend(baseUrl) {
        const next = baseUrl ? new URL(baseUrl) : null;
        // Invalidate the old target before closing streams, so no new request
        // can enter the previous account while the switch is in progress.
        backend = next;
        for (const connection of backendConnections) connection.destroy();
        backendConnections.clear();
    }
    const relay = options.relayUrl ? new URL(options.relayUrl) : null;
    const activationDir = options.activationDir || null;
    const onLogoutAttempt = options.onLogoutAttempt || null;
    const yingceSystemRelay = options.lite && options.yingceSystemRelay;
    const yingceAccountRelay = options.lite && options.yingceAccountRelay;

    const server = http.createServer((req, res) => {
        const pathname = req.url.split("?")[0];
        // Lite uses the Yingce account flow only. Do not leave the legacy
        // NewAPI endpoints or activation scripts reachable through the SPA.
        if (options.lite && /^\/peekreel-(?:relay|passport|remote)(?:\/|$)/.test(pathname)) {
            res.writeHead(404);
            return res.end();
        }
        if (pathname.startsWith("/doubao-bridge/")) {
            return proxyDoubao(req, res, backend && options.getDoubaoBridge?.(), server.address()?.port, trackBackendConnection);
        }
        if (req.url.startsWith("/api/")) {
            if (options.lite && /^\/api\/admin(?:\/|$)/.test(pathname)) {
                res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                return res.end(JSON.stringify({ code: 403, reason: "lite_read_only_configuration", msg: "此配置由影策服务管理" }));
            }
            if (options.lite && pathname.startsWith("/api/ecommerce/knowledge/") && pathname !== "/api/ecommerce/knowledge/orchestration") {
                res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                return res.end(JSON.stringify({ code: 403, reason: "lite_read_only_configuration", msg: "电商知识配置由影策服务管理" }));
            }
            if (options.lite && pathname === "/api/ecommerce/knowledge/orchestration" && req.method !== "GET") {
                res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                return res.end(JSON.stringify({ code: 403, reason: "lite_read_only_configuration", msg: "电商模型配置由影策服务管理" }));
            }
            if (options.lite && pathname === "/api/auth/session" && req.method === "GET") {
                if (!backend) {
                    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                    return res.end(JSON.stringify({ code: 503, reason: "account_unavailable", msg: "本地账户尚未就绪" }));
                }
                return proxyRequest(req, res, backend, trackBackendConnection, (status, body) => {
                    let envelope;
                    try { envelope = JSON.parse(body.toString("utf8")); }
                    catch { return { status: 502, body: Buffer.from(JSON.stringify({ code: 502, reason: "invalid_response", msg: "本地会话响应无效" })) }; }
                    if (status < 200 || status >= 300 || envelope?.code !== 0 || !envelope.data || typeof envelope.data !== "object") {
                        return { status, body };
                    }
                    const user = options.getYingceUser?.();
                    envelope.data.user = user?.id ? {
                        id: String(user.id),
                        username: user.username || user.displayName || "影策用户",
                        displayName: user.displayName || user.username || "影策用户",
                        role: "user",
                    } : null;
                    return { status, body: Buffer.from(JSON.stringify(envelope)) };
                });
            }
            if (pathname.startsWith("/api/ai/system/") && yingceSystemRelay) {
                return yingceSystemRelay(req, res, {
                    port: server.address()?.port,
                    trackConnection: trackBackendConnection,
                });
            }
            if ((pathname.startsWith("/api/wallet") || pathname.startsWith("/api/payments/")) && yingceAccountRelay) {
                return yingceAccountRelay(req, res, {
                    port: server.address()?.port,
                    trackConnection: trackBackendConnection,
                });
            }
            // 本地账户由应用托管：登出会被拦截，避免用户掉进无法自救的登录页。
            if (pathname === "/api/auth/logout" && req.method === "POST") {
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ code: 0, data: { loggedOut: true } }));
                if (onLogoutAttempt) {
                    try {
                        onLogoutAttempt();
                    } catch {
                        /* 回调失败不影响响应 */
                    }
                }
                return;
            }
            if (!backend) {
                res.writeHead(503, { "Content-Type": "application/json" });
                return res.end(JSON.stringify({ code: 503, reason: "account_unavailable", msg: "本地账户尚未就绪" }));
            }
            proxyRequest(req, res, backend, trackBackendConnection);
            return;
        }
        if (pathname === "/peekreel-activation/config") {
            if (options.lite) { res.writeHead(404); return res.end(); }
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify({
                relayUrl: options.relayUrl || "",
                consoleUrl: options.consoleUrl || "",
                directChannelsUrl: options.directChannelsUrl || "",
                // 壳品牌（app.getName()）：activation 页与 seed-core 品牌外观写入的白标源头
                appName: options.appName || "PeekReel",
            }));
            return;
        }
        if (pathname === "/peekreel-activation" || pathname === "/peekreel-activation/" || pathname.startsWith("/peekreel-activation/")) {
            if (options.lite) {
                const asset = pathname.replace(/^\/peekreel-activation\/?/, "") || "lite.html";
                if (!["lite.html", "lite.js", "lite.css", "lite-policy.js"].includes(asset)) {
                    res.writeHead(404);
                    return res.end();
                }
                return serveActivationAsset(req, res, activationDir, `/peekreel-activation/${asset}`);
            }
            serveActivationAsset(req, res, activationDir, pathname);
            return;
        }
        if (relay && req.url.startsWith("/peekreel-relay/")) {
            proxyRelay(req, res, relay);
            return;
        }
        if (relay && req.url.startsWith("/peekreel-remote/")) {
            proxyRemote(req, res, relay);
            return;
        }
        serveStatic(req, res, webDistDir);
    });

    // 画布实时协作走 WebSocket：/api/canvas-projects/:id/realtime。
    server.on("upgrade", (req, socket, head) => {
        if (req.url.startsWith("/api/") && backend) {
            trackBackendConnection(socket);
            proxyUpgrade(req, socket, head, backend, trackBackendConnection);
        } else {
            socket.destroy();
        }
    });

    return new Promise((resolve, reject) => {
        const port = options.port ?? DEFAULT_PORT;
        if (!Number.isInteger(port) || port < 1024 || port > 65535) return reject(new Error("本地来源端口无效"));
        server.once("error", (error) => reject(error.code === "EADDRINUSE"
            ? new Error(`本地端口 ${port} 被占用，请关闭占用程序后重试。已保留原来源和本地数据。`) : error));
        server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${port}`, port, setBackend }));
    });
}

function proxyDoubao(req, res, bridge, port, trackConnection) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname.slice("/doubao-bridge".length);
    const rules = [
        ["GET", /^\/(?:session|login\/(?:status|qr\.png)|v1\/(?:models|tasks|events)|conversation)$/],
        ["GET", /^\/admin\/api\/(?:accounts|conversation-cleanup)$/],
        ["POST", /^\/(?:admin\/api\/accounts|conversation\/send|v1\/tasks\/task_[a-zA-Z0-9_]+\/retry)$/],
        ["PUT", /^\/admin\/api\/conversation-cleanup$/],
        ["DELETE", /^\/admin\/api\/accounts\/acct\d+$/],
    ];
    // Fetch metadata protects against websites, not a malicious local process.
    // Pin Host independently so a DNS-rebinding origin cannot become trusted.
    const expectedHost = `127.0.0.1:${port}`;
    const sameOrigin = req.headers.host === expectedHost && req.headers["sec-fetch-site"] === "same-origin" &&
        (!req.headers.origin || req.headers.origin === `http://${expectedHost}`);
    if (!sameOrigin || !rules.some(([method, pattern]) => req.method === method && pattern.test(pathname))) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ detail: "豆包服务请求不允许" }));
    }
    if (!bridge?.adminToken || !bridge.baseUrl) {
        res.writeHead(503, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ detail: "豆包服务尚未就绪" }));
    }
    url.searchParams.delete("token");
    const target = new URL(bridge.baseUrl);
    const headers = { authorization: `Bearer ${bridge.adminToken}`, host: target.host };
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
    const upstream = http.request({ hostname: target.hostname, port: target.port, method: req.method,
        path: pathname + url.search, headers }, (response) => {
        const responseHeaders = { ...response.headers, "cache-control": "no-store" };
        delete responseHeaders["access-control-allow-origin"];
        res.writeHead(response.statusCode, responseHeaders);
        response.pipe(res);
    });
    trackConnection(upstream);
    trackConnection(res);
    upstream.on("error", () => {
        if (res.destroyed) return;
        if (res.headersSent) return res.destroy();
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "豆包服务连接失败" }));
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
}

// 激活页静态资源：/peekreel-activation → index.html，其余按目录内相对路径。
function serveActivationAsset(req, res, activationDir, pathname) {
    if (!activationDir) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("激活页缺失");
        return;
    }
    let relative = path.posix.normalize(pathname.replace(/^\/peekreel-activation\/?/, ""));
    if (!relative || relative === "." || relative === "/") relative = "index.html";
    const filePath = path.join(activationDir, relative);
    if (!filePath.startsWith(path.resolve(activationDir))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }
    fs.stat(filePath, (error, stats) => {
        if (error || !stats.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not Found");
            return;
        }
        const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        fs.createReadStream(filePath).pipe(res);
    });
}

// 激活页验证用户密钥：GET /peekreel-relay/v1/models → 中转站 /v1/models。
// 只透传必要头，不带本地会话 Cookie；密钥由页面放在 Authorization 头里。
function proxyRelay(req, res, relay) {
    proxyUpstream(req, res, relay, req.url.replace(/^\/peekreel-relay/, "") || "/");
}

// 门面账号直通：/peekreel-passport/api/... → 中转站 /api/...。
// 白名单外的路径一律 403，渲染进程不能借道访问管理端点。
const PASSPORT_ALLOW = [
    "POST:/api/user/login",
    "POST:/api/user/register",
    "GET:/api/user/self",
    "POST:/api/user/topup",
    "GET:/api/token",
    "POST:/api/token",
    // NewAPI rc.47：令牌列表只回掩码 key，完整密钥须带 id 二次请求（服务端限流+审计）。
    "POST:/api/token/{id}/key",
];

function passportAllowed(method, normalizedPath) {
    return PASSPORT_ALLOW.some((rule) => {
        const idx = rule.indexOf(":");
        if (rule.slice(0, idx) !== method) return false;
        const rulePath = rule.slice(idx + 1);
        if (rulePath === normalizedPath) return true;
        // {id} 段匹配任意非空非斜杠内容（当前仅用于数字 id 的 token key 端点）。
        return new RegExp("^" + rulePath.replace(/\{id\}/g, "[^/]+") + "$").test(normalizedPath);
    });
}

function proxyPassport(req, res, relay) {
    const upstreamPath = req.url.replace(/^\/peekreel-passport/, "") || "/";
    const normalized = upstreamPath.split("?")[0].replace(/\/+$/, "") || "/";
    if (!passportAllowed(req.method, normalized)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, message: "该端点不在允许列表" }));
        return;
    }
    proxyUpstream(req, res, relay, upstreamPath);
}

const REMOTE_ALLOW = new Set([
    "POST:/api/auth/login", "POST:/api/auth/register", "GET:/api/auth/session",
    "GET:/api/auth/settings", "POST:/api/auth/logout", "GET:/api/model-catalog",
    "POST:/api/model-catalog/available", "POST:/api/model-catalog/quote",
    "GET:/api/wallet", "POST:/api/wallet/redeem",
    "POST:/api/ai/system", // prefix-matched below for channel proxy paths
]);

function proxyRemote(req, res, relay) {
    const upstreamPath = req.url.replace(/^\/peekreel-remote/, "") || "/";
    const normalized = upstreamPath.split("?")[0].replace(/\/+$/, "") || "/";
    const key = `${req.method}:${normalized}`;
    const allowed = REMOTE_ALLOW.has(key) || /^\/(api\/ai\/system\/[^/]+)(\/|$)/.test(normalized) &&
        ["GET", "POST"].includes(req.method);
    if (!allowed) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: 403, msg: "remote endpoint is not allowed" }));
        return;
    }
    proxyUpstream(req, res, relay, upstreamPath);
}

function proxyUpstream(req, res, relay, upstreamPath) {
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (["host", "cookie", "origin", "referer", "connection", "accept-encoding"].includes(lower)) continue;
        headers[key] = value;
    }
    headers.host = relay.host;
    const upstream = (relay.protocol === "https:" ? https : http).request(
        { protocol: relay.protocol, hostname: relay.hostname, port: relay.port, method: req.method, path: upstreamPath, headers, timeout: 20000 },
        (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
        }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("中转站连接超时")));
    upstream.on("error", (error) => {
        // 同时带 error 与 success/message 字段：relay 调用方看 error，passport 调用方看 success。
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: `中转站不可达：${error.message}`, success: false, message: `中转站不可达：${error.message}` }));
    });
    req.pipe(upstream);
}

function proxyRequest(req, res, backend, trackConnection, transformResponse) {
    const options = {
        protocol: backend.protocol,
        hostname: backend.hostname,
        port: backend.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: backend.host },
    };
    const upstream = (backend.protocol === "https:" ? https : http).request(options, (response) => {
        if (transformResponse) {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
                size += chunk.length;
                if (size > 1024 * 1024) {
                    response.destroy();
                    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                    res.end(JSON.stringify({ code: 502, reason: "invalid_response", msg: "本地会话响应过大" }));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => {
                if (res.destroyed || size > 1024 * 1024) return;
                const transformed = transformResponse(response.statusCode || 502, Buffer.concat(chunks));
                res.writeHead(transformed.status, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                });
                res.end(transformed.body);
            });
            trackConnection(response);
            trackConnection(res);
            res.on("close", () => upstream.destroy());
            return;
        }
        // SSE/流式响应必须立刻写出响应头并持续透传，不能等整个 body 结束。
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
    });
    trackConnection(upstream);
    trackConnection(res);
    res.on("close", () => upstream.destroy());
    upstream.on("error", (error) => {
        if (res.destroyed) return;
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 502, msg: `本地后端不可达：${error.message}` }));
    });
    req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, backend, trackConnection) {
    const options = {
        protocol: backend.protocol,
        hostname: backend.hostname,
        port: backend.port,
        path: req.url,
        headers: { ...req.headers, host: backend.host },
    };
    const upstream = (backend.protocol === "https:" ? https : http).request(options);
    trackConnection(upstream);
    upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
        trackConnection(upstreamSocket);
        socket.write(
            `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` +
                Object.entries(response.headers)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join("\r\n") +
                "\r\n\r\n"
        );
        if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
        if (head && head.length) upstreamSocket.write(head);
        upstreamSocket.pipe(socket);
        socket.pipe(upstreamSocket);
        const close = () => {
            socket.destroy();
            upstreamSocket.destroy();
        };
        upstreamSocket.on("error", close);
        socket.on("error", close);
        upstreamSocket.on("close", close);
        socket.on("close", close);
    });
    upstream.on("error", () => socket.destroy());
    upstream.end();
}

// 工作台更新徽章：注入到工作台 HTML（不改上游 web 前端源码，合并永远零冲突）。
// 经 preload 的 window.desktop 桥驱动：下载中显示进度，就绪后点击即静默重启安装。
// 不在 preload 环境（纯浏览器访问本地服务器）时静默不显示。
const UPDATE_CHIP_SNIPPET = `<script>(function () {
    var api = window.desktop;
    if (!api || !api.getUpdateState) return;
    var el = document.createElement("div");
    el.id = "peekreel-update-chip";
    el.style.cssText = "position:fixed;top:10px;right:14px;z-index:2147483647;display:none;align-items:center;padding:6px 14px;border-radius:999px;font:12px/1.4 'Segoe UI','Microsoft YaHei',sans-serif;color:#ECECF0;background:rgba(21,21,27,.94);border:1px solid rgba(240,180,41,.55);box-shadow:0 2px 12px rgba(0,0,0,.4)";
    var setText = function (t) { el.textContent = t; };
    function render(s) {
        if (!s || s.phase === "idle") { el.style.display = "none"; return; }
        if (s.phase === "downloading") {
            el.style.display = "block"; el.style.cursor = "default"; el.onclick = null;
            setText("正在后台下载 v" + (s.version || "") + " " + (s.percent || 0) + "%");
        } else if (s.phase === "ready") {
            el.style.display = "block"; el.style.cursor = "pointer"; el.style.color = "#F0B429";
            setText("新版本 v" + (s.version || "") + " 已就绪 · 点击重启更新");
            el.onclick = function () {
                if (window.confirm("立即重启并静默安装新版本？未保存的工作请先保存。")) api.applyUpdate();
            };
        }
    }
    document.body.appendChild(el);
    api.getUpdateState().then(render);
    api.onUpdateState(render);
})();</script>`;

function injectUpdateChip(html) {
    if (typeof html !== "string" || html.includes("peekreel-update-chip")) return html;
    const anchor = "</body>";
    const idx = html.lastIndexOf(anchor);
    if (idx === -1) return html + UPDATE_CHIP_SNIPPET;
    return html.slice(0, idx) + UPDATE_CHIP_SNIPPET + html.slice(idx);
}

function serveStatic(req, res, webDistDir) {
    const decoded = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
    let relative = path.posix.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
    if (relative === "/" || relative === "") relative = "/index.html";
    let filePath = path.join(webDistDir, relative);
    if (!filePath.startsWith(path.resolve(webDistDir))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }
    fs.stat(filePath, (error, stats) => {
        if (error || !stats.isFile()) {
            // SPA 路由回退到 index.html；带扩展名的真实文件 404。
            if (path.posix.extname(relative)) {
                res.writeHead(404);
                res.end("Not Found");
                return;
            }
            filePath = path.join(webDistDir, "index.html");
        }
        const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        // HTML 响应注入更新徽章（SPA 入口 index.html），其余文件保持流式直出。
        if (type.startsWith("text/html")) {
            fs.readFile(filePath, "utf8", (readError, html) => {
                if (readError) { res.writeHead(500); res.end(); return; }
                res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
                res.end(injectUpdateChip(html));
            });
            return;
        }
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
        fs.createReadStream(filePath).pipe(res);
    });
}

module.exports = { startLocalServer };
