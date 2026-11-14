const crypto = require("node:crypto");
const http = require("node:http");

const DESKTOP_CLIENT_ID = "peekreel-lite";
const CALLBACK_PATH = "/oauth/callback";

function safeConsoleUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
        throw new Error("控制台地址必须使用 HTTPS");
    }
    if (url.username || url.password || url.search || url.hash) throw new Error("控制台地址无效");
    return url;
}

function equalSecret(left, right) {
    const a = Buffer.from(left || "");
    const b = Buffer.from(right || "");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createDesktopLogin({ consoleUrl, shell, client, timeoutMs = 180_000, createServer = http.createServer, randomBytes = crypto.randomBytes }) {
    const authorizeBase = safeConsoleUrl(consoleUrl);
    let active = null;

    function cancel(message = "登录已取消") {
        if (!active) return false;
        active.finish(new Error(message));
        return true;
    }

    function begin() {
        cancel("登录已由新的授权流程取代");
        const verifier = randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        const state = randomBytes(32).toString("base64url");
        const server = createServer();
        let timer;
        let exchanging = false;
        let redirectUri = "";
        let resolveResult;
        let rejectResult;
        const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
        const current = {
            finish(error, value) {
                if (active === current) active = null;
                clearTimeout(timer);
                if (server.listening) server.close();
                if (error) rejectResult(error);
                else resolveResult(value);
            },
        };
        active = current;

        server.on("error", (error) => current.finish(error));
        server.on("request", async (request, response) => {
            const expectedHost = `127.0.0.1:${server.address()?.port}`;
            let callback;
            try { callback = new URL(request.url, `http://${expectedHost}`); }
            catch { callback = null; }
            if (request.method !== "GET" || request.headers.host !== expectedHost || callback?.origin !== `http://${expectedHost}` || callback.pathname !== CALLBACK_PATH) {
                response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
                response.end("Not found");
                return;
            }
            if (!equalSecret(callback.searchParams.get("state"), state)) {
                response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
                response.end("登录校验失败，请返回 PeekReel Lite 重试。");
                return;
            }
            if (exchanging) {
                response.writeHead(409, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
                response.end("登录请求已处理。");
                return;
            }
            const oauthError = callback.searchParams.get("error");
            const code = callback.searchParams.get("code");
            if (oauthError || !code) {
                response.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
                response.end("登录未完成，可以返回 PeekReel Lite 重试。");
                current.finish(new Error(oauthError ? "登录已取消" : "授权回调缺少授权码"));
                return;
            }
            exchanging = true;
            try {
                const authenticated = await client.exchangeDesktopAuthorizationCode({
                    clientId: DESKTOP_CLIENT_ID,
                    redirectUri,
                    code,
                    codeVerifier: verifier,
                });
                response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
                response.end("<!doctype html><meta charset=utf-8><title>PeekReel Lite</title><p>登录完成，可以关闭此页面并返回 PeekReel Lite。</p>");
                current.finish(null, authenticated.user);
            } catch (error) {
                response.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
                response.end("登录未完成，请返回 PeekReel Lite 重试。");
                current.finish(error);
            }
        });

        server.listen(0, "127.0.0.1", async () => {
            const address = server.address();
            if (!address || typeof address === "string" || !address.port) {
                current.finish(new Error("无法启动本机登录回调"));
                return;
            }
            redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
            const authorizeUrl = new URL("/auth/desktop/authorize", authorizeBase);
            authorizeUrl.searchParams.set("client_id", DESKTOP_CLIENT_ID);
            authorizeUrl.searchParams.set("redirect_uri", redirectUri);
            authorizeUrl.searchParams.set("code_challenge", challenge);
            authorizeUrl.searchParams.set("code_challenge_method", "S256");
            authorizeUrl.searchParams.set("state", state);
            timer = setTimeout(() => current.finish(new Error("登录等待超时，请重试")), timeoutMs);
            timer.unref?.();
            try {
                await shell.openExternal(authorizeUrl.toString());
            } catch (error) {
                current.finish(error instanceof Error ? error : new Error("无法打开系统浏览器"));
            }
        });
        return result;
    }

    return { begin, cancel: () => cancel() };
}

module.exports = { createDesktopLogin, DESKTOP_CLIENT_ID, CALLBACK_PATH };
