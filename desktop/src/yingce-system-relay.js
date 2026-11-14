const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");

function systemProviderPath(rawUrl) {
    let url;
    try { url = new URL(rawUrl, "http://127.0.0.1"); }
    catch { return null; }
    if (url.origin !== "http://127.0.0.1" || /%(?:2f|5c)/i.test(url.pathname)) return null;
    const match = /^\/api\/ai\/system\/([A-Za-z0-9_-]{1,120})(\/.*)$/.exec(url.pathname);
    if (!match) return null;
    try {
        for (const segment of match[2].split("/")) {
            const decoded = decodeURIComponent(segment);
            if (decoded === "." || decoded === ".." || /[\\/\0]/.test(decoded)) return null;
        }
    } catch { return null; }
    return { channelId: match[1], providerPath: match[2], search: url.search };
}

function constantTimeMatch(left, right) {
    if (typeof left !== "string" || !left || typeof right !== "string" || !right) return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestCookie(req, name) {
    const raw = req.headers.cookie;
    if (typeof raw !== "string") return "";
    for (const part of raw.split(";")) {
        const index = part.indexOf("=");
        if (index < 0 || part.slice(0, index).trim() !== name) continue;
        return part.slice(index + 1).trim();
    }
    return "";
}

function createYingceSystemRelay({ apiUrl, getSession, getRelayKey, getLocalSession }) {
    const api = new URL(apiUrl);
    if (api.protocol !== "https:" && !(api.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname))) {
        throw new Error("影策模型中转地址必须使用 HTTPS");
    }
    if (api.username || api.password || api.search || api.hash || !api.pathname.replace(/\/+$/, "").endsWith("/api")) {
        throw new Error("影策模型中转地址无效");
    }

    return function proxySystemRequest(req, res, { port, trackConnection = () => {} } = {}) {
        const route = systemProviderPath(req.url);
        const expectedHost = `127.0.0.1:${port}`;
        const localOrigin = `http://${expectedHost}`;
        const hostOK = req.headers.host === expectedHost;
        const browserSession = requestCookie(req, "open_ai_canvas_session");
        const browserOK = hostOK && req.headers["sec-fetch-site"] === "same-origin" &&
            (!req.headers.origin || req.headers.origin === localOrigin) &&
            constantTimeMatch(browserSession, getLocalSession?.());
        const relayHeader = String(req.headers["x-yingce-lite-relay-key"] || "");
        const backendOK = hostOK && constantTimeMatch(relayHeader, getRelayKey?.());
        if (!route || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(req.method) || (!browserOK && !backendOK)) {
            res.writeHead(route ? 403 : 404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(JSON.stringify({ code: route ? 403 : 404, reason: route ? "forbidden" : "not_found", msg: "影策模型请求不允许" }));
        }

        let session;
        try { session = getSession?.(); }
        catch { session = ""; }
        if (typeof session !== "string" || !session) {
            res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(JSON.stringify({ code: 401, reason: "unauthorized", msg: "影策会话不可用，请联网登录后重试" }));
        }

        const target = new URL(api.href);
        target.pathname = `${api.pathname.replace(/\/+$/, "")}${`/ai/system/${route.channelId}${route.providerPath}`}`;
        target.search = route.search;
        const transport = target.protocol === "https:" ? https : http;
        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) {
            const lower = name.toLowerCase();
            if (["host", "cookie", "origin", "referer", "authorization", "x-api-key", "api-key", "x-goog-api-key", "x-yingce-lite-relay-key", "connection", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].includes(lower)) continue;
            if (["content-type", "content-length", "accept", "x-idempotency-key", "x-yingce-lite-task-id", "last-event-id", "user-agent"].includes(lower)) headers[lower] = value;
        }
        headers.host = target.host;
        headers.authorization = `Bearer ${session}`;
        const upstream = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: `${target.pathname}${target.search}`, headers }, (response) => {
            const responseHeaders = {};
            for (const name of ["content-type", "content-length", "content-disposition", "cache-control", "retry-after", "x-accel-buffering", "x-content-type-options"]) {
                const value = response.headers[name];
                if (value !== undefined) responseHeaders[name] = value;
            }
            if (responseHeaders["content-type"]?.toLowerCase().includes("text/event-stream")) {
                responseHeaders["cache-control"] = "no-cache, no-store, no-transform";
                responseHeaders["x-accel-buffering"] = "no";
            }
            res.writeHead(response.statusCode || 502, responseHeaders);
            response.pipe(res);
        });
        trackConnection(upstream);
        trackConnection(res);
        res.on("close", () => upstream.destroy());
        upstream.on("error", () => {
            if (res.destroyed) return;
            if (res.headersSent) return res.destroy();
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ code: 502, reason: "upstream_unavailable", msg: "影策模型服务暂不可用" }));
        });
        req.pipe(upstream);
    };
}

function createYingceAccountRelay({ apiUrl, getSession, getLocalSession }) {
    const api = new URL(apiUrl);
    if (api.protocol !== "https:" && !(api.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname))) {
        throw new Error("影策账户服务地址必须使用 HTTPS");
    }
    if (api.username || api.password || api.search || api.hash || !api.pathname.replace(/\/+$/, "").endsWith("/api")) {
        throw new Error("影策账户服务地址无效");
    }
    const allowed = new Set([
        "GET:/api/wallet",
        "POST:/api/wallet/redeem",
        "POST:/api/wallet/checkin",
        "GET:/api/payments/providers",
        "GET:/api/payments/products",
        "GET:/api/payments/settings",
        "POST:/api/payments/orders",
    ]);
    function routeAllowed(method, pathname) {
        const key = `${method}:${pathname}`;
        return allowed.has(key) ||
            (method === "GET" && /^\/api\/payments\/orders\/[A-Za-z0-9_-]{1,120}$/.test(pathname)) ||
            (method === "POST" && /^\/api\/payments\/orders\/[A-Za-z0-9_-]{1,120}\/(?:query|close|checkout\/refresh)$/.test(pathname));
    }

    return function proxyAccountRequest(req, res, { port, trackConnection = () => {} } = {}) {
        let url;
        try { url = new URL(req.url, "http://127.0.0.1"); }
        catch { url = null; }
        const expectedHost = `127.0.0.1:${port}`;
        const origin = `http://${expectedHost}`;
        const routeOK = url && routeAllowed(req.method, url.pathname);
        const queryKeys = url ? [...url.searchParams.keys()] : [];
        const queryOK = req.method === "GET"
            ? queryKeys.every((key) => ["type", "page", "pageSize"].includes(key))
            : queryKeys.length === 0;
        const browserOK = req.headers.host === expectedHost && req.headers["sec-fetch-site"] === "same-origin" &&
            (!req.headers.origin || req.headers.origin === origin) &&
            constantTimeMatch(requestCookie(req, "open_ai_canvas_session"), getLocalSession?.());
        if (!url || url.origin !== "http://127.0.0.1" || !routeOK || !queryOK || !browserOK) {
            res.writeHead(url && routeOK ? 403 : 404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(JSON.stringify({ code: url && routeOK ? 403 : 404, reason: "forbidden", msg: "影策账户请求不允许" }));
        }
        const length = Number(req.headers["content-length"] || 0);
        if (length > 16 * 1024) {
            res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(JSON.stringify({ code: 413, reason: "request_too_large", msg: "影策账户请求过大" }));
        }
        let session;
        try { session = getSession?.(); } catch { session = ""; }
        if (typeof session !== "string" || !session) {
            res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            return res.end(JSON.stringify({ code: 401, reason: "unauthorized", msg: "影策会话不可用，请联网登录后重试" }));
        }

        const chunks = [];
        let size = 0;
        let stopped = false;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > 16 * 1024) {
                stopped = true;
                req.destroy();
                if (!res.headersSent) {
                    res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                    res.end(JSON.stringify({ code: 413, reason: "request_too_large", msg: "影策账户请求过大" }));
                }
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (stopped || res.destroyed) return;
            const target = new URL(api.href);
            target.pathname = `${api.pathname.replace(/\/+$/, "")}${url.pathname.replace(/^\/api/u, "")}`;
            target.search = url.search;
            const transport = target.protocol === "https:" ? https : http;
            const headers = { host: target.host, authorization: `Bearer ${session}` };
            if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
            if (req.headers.accept) headers.accept = req.headers.accept;
            const body = Buffer.concat(chunks);
            if (body.length) headers["content-length"] = String(body.length);
            const upstream = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: `${target.pathname}${target.search}`, headers }, (response) => {
                const responseHeaders = {};
                for (const name of ["content-type", "content-length", "cache-control", "retry-after"]) {
                    if (response.headers[name] !== undefined) responseHeaders[name] = response.headers[name];
                }
                responseHeaders["cache-control"] = "no-store";
                res.writeHead(response.statusCode || 502, responseHeaders);
                response.pipe(res);
            });
            trackConnection(upstream);
            trackConnection(res);
            res.on("close", () => upstream.destroy());
            upstream.on("error", () => {
                if (res.destroyed) return;
                if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                res.end(JSON.stringify({ code: 502, reason: "upstream_unavailable", msg: "影策账户服务暂不可用" }));
            });
            upstream.end(body);
        });
    };
}

module.exports = { systemProviderPath, createYingceSystemRelay, createYingceAccountRelay };
