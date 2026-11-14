const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// The API origin is part of the identity: accounts from test and production
// must never share credentials or local data.
function normalizeApiUrl(value) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) throw new Error("Invalid Yingce API URL");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
        throw new Error("Yingce API URL must use HTTPS");
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/api")) throw new Error("Yingce API URL must end with /api");
    return url.toString().replace(/\/$/, "");
}

function accountScope(apiUrl, userId) {
    if ((typeof userId !== "string" && typeof userId !== "number") || !String(userId).trim()) throw new Error("Missing remote user ID");
    return crypto.createHash("sha256").update(JSON.stringify([normalizeApiUrl(apiUrl), String(userId)])).digest("hex");
}

function createSessionVault({ directory, safeStorage }) {
    const file = path.join(directory, "yingce-session.enc");
    const assertAvailable = () => {
        if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
            throw new Error("系统安全存储不可用，无法保存登录会话");
        }
    };
    function read(apiUrl) {
        assertAvailable();
        let encrypted;
        try { encrypted = fs.readFileSync(file); }
        catch (error) { if (error.code === "ENOENT") return null; throw error; }
        const value = JSON.parse(safeStorage.decryptString(encrypted));
        if (value.apiUrl !== normalizeApiUrl(apiUrl)) return null;
        return value;
    }
    return {
        save(apiUrl, session, user) {
            assertAvailable();
            if (typeof session !== "string" || !session) throw new Error("Missing session");
            const profile = user && (typeof user.id === "string" || typeof user.id === "number")
                ? { id: String(user.id), ...(typeof user.displayName === "string" ? { displayName: user.displayName } : {}), ...(typeof user.username === "string" ? { username: user.username } : {}) }
                : undefined;
            const encrypted = safeStorage.encryptString(JSON.stringify({ apiUrl: normalizeApiUrl(apiUrl), session, ...(profile ? { user: profile } : {}) }));
            fs.mkdirSync(directory, { recursive: true });
            const temporary = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
            try {
                fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" });
                fs.renameSync(temporary, file);
            } finally {
                try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
            }
        },
        load(apiUrl) {
            const value = read(apiUrl);
            if (!value) return null;
            if (typeof value.session !== "string" || !value.session) throw new Error("Invalid stored session");
            return value.session;
        },
        loadUser(apiUrl) {
            const value = read(apiUrl);
            if (!value?.user || typeof value.user.id !== "string" || !value.user.id) return null;
            return value.user;
        },
        clear() {
            try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
        },
    };
}

class YingceApiError extends Error {
    constructor(message, { status, code, reason } = {}) {
        super(message);
        this.name = "YingceApiError";
        this.status = status;
        this.code = code;
        this.reason = reason;
    }
}

function unrecognizedResponse(status) {
    const message = status === 409 ? "请求已提交过，请核对结果后手动发起新请求。"
        : status === 401 ? "登录已失效，请重新登录。"
        : status === 429 ? "请求过于频繁，请稍后再试。"
        : "影策服务返回了无法识别的响应";
    return new YingceApiError(message, { status });
}

function parseEnvelope(status, body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw unrecognizedResponse(status);
    }
    const hasReason = typeof body.reason === "string" && Boolean(body.reason.trim());
    if (typeof body.code !== "number" && !hasReason) throw unrecognizedResponse(status);
    if (status < 200 || status >= 300 || body.code !== 0 || hasReason) {
        const message = status === 409 || body.code === 40901 ? "请求已提交过，请核对结果后手动发起新请求。"
            : status === 401 || body.code === 401 || body.reason === "unauthorized" ? "登录已失效，请重新登录。"
            : body.code === 40301 || body.reason === "quota_exceeded" || body.reason === "insufficient_credits" ? "积分不足，请充值后重新发起请求。"
            : status === 429 || body.code === 42901 || body.reason === "rate_limited" ? "请求过于频繁，请稍后再试。"
            : body.reason === "model_unavailable" ? "当前模型不可用，请重新选择模型。"
            : typeof body.msg === "string" && body.msg ? body.msg : "影策请求失败";
        throw new YingceApiError(message, {
            status, code: body.code, reason: body.reason,
        });
    }
    return body.data;
}

// A gateway failure can arrive after the upstream accepted the request.
// Keep the server's status/code/reason while flagging the outcome for recovery.
function generationResponseError(error, status) {
    if (status >= 500 && status <= 599) {
        error.outcomeUnknown = true;
        error.message = "生成服务返回异常，执行和费用状态可能未知。请核对结果后再手动发起新请求。";
    }
    return error;
}

function snapshotImageForm(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 64) throw new Error("无效的图片编辑表单");
    let totalBytes = 0;
    return entries.map((entry) => {
        if (!entry || typeof entry !== "object" || typeof entry.name !== "string" || !/^[a-zA-Z0-9_\[\]-]{1,80}$/.test(entry.name)) throw new Error("无效的图片编辑字段");
        if (typeof entry.value === "string") {
            totalBytes += Buffer.byteLength(entry.value);
            if (totalBytes > 50 * 1024 * 1024) throw new Error("图片编辑表单过大");
            return { name: entry.name, value: entry.value };
        }
        if (!(entry.bytes instanceof Uint8Array) || !entry.bytes.byteLength || typeof entry.filename !== "string" || !entry.filename || entry.filename.length > 255 || /[\r\n\0]/.test(entry.filename) || typeof entry.mimeType !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(entry.mimeType)) throw new Error("无效的图片编辑文件");
        totalBytes += entry.bytes.byteLength;
        if (totalBytes > 50 * 1024 * 1024) throw new Error("图片编辑表单过大");
        return { name: entry.name, filename: entry.filename, mimeType: entry.mimeType, bytes: Uint8Array.from(entry.bytes) };
    });
}

function imageFormBody(entries) {
    const form = new FormData();
    for (const entry of entries) {
        if (typeof entry.value === "string") form.append(entry.name, entry.value);
        else form.append(entry.name, new Blob([entry.bytes], { type: entry.mimeType }), entry.filename);
    }
    return form;
}

function createYingceSessionClient({ apiUrl, vault, fetchImpl = fetch }) {
    const base = normalizeApiUrl(apiUrl);
    let authGeneration = 0;
    async function request(endpoint, { method = "GET", body, authenticated = false, sessionOverride, timeoutMs = 20000 } = {}) {
        const session = sessionOverride !== undefined ? sessionOverride : authenticated ? vault.load(base) : null;
        const requestGeneration = authGeneration;
        const headers = { accept: "application/json" };
        if (body !== undefined) headers["content-type"] = "application/json";
        if (session) headers.authorization = `Bearer ${session}`;
        const response = await fetchImpl(`${base}${endpoint}`, {
            method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        });
        let envelope;
        try { envelope = await response.json(); }
        catch { throw unrecognizedResponse(response.status); }
        if (authenticated && (requestGeneration !== authGeneration || vault.load(base) !== session)) {
            throw new YingceApiError("登录会话已变化，请重新操作。", { status: 401, reason: "auth_superseded" });
        }
        return parseEnvelope(response.status, envelope);
    }
    async function exchangeDesktopAuthorizationCode(input) {
        const generation = ++authGeneration;
        const data = await request("/auth/desktop/token", { method: "POST", body: input });
        if (!data || !data.user || typeof data.session !== "string" || !data.session || !Number.isFinite(data.expiresIn)) {
            throw new Error("影策授权响应缺少会话信息");
        }
        accountScope(base, data.user.id);
        if (generation !== authGeneration) throw new YingceApiError("登录操作已被新的账号操作取代", { reason: "auth_superseded" });
        vault.save(base, data.session, data.user);
        return { user: data.user, expiresIn: data.expiresIn };
    }
    return {
        async session() {
            const data = await request("/auth/session", { authenticated: true });
            if (data?.user) {
                const session = vault.load(base);
                if (session) vault.save(base, session, data.user);
            }
            return data;
        },
        cachedUser: () => vault.loadUser(base),
        sessionToken(expectedUserId) {
            const user = vault.loadUser(base);
            if (!user || (expectedUserId !== undefined && String(expectedUserId) !== user.id)) return "";
            return vault.load(base) || "";
        },
        exchangeDesktopAuthorizationCode,
        modelCatalog: ({ timeoutMs = 5000 } = {}) => request("/model-catalog", { authenticated: true, timeoutMs }),
        ecommerceAgentSetting: ({ timeoutMs = 5000 } = {}) => request("/ecommerce/agent-setting", { authenticated: true, timeoutMs }),
        ecommerceOrchestrationSetting: ({ timeoutMs = 5000 } = {}) => request("/ecommerce/knowledge/orchestration", { authenticated: true, timeoutMs }),
        // A generation intent owns its key for its entire lifetime. Callers may
        // retry this same object, but must never silently replace it after 409.
        createGenerationIntent({ channelId, providerPath, capability, body, multipart }) {
            if (typeof channelId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(channelId)) throw new Error("无效的渠道 ID");
            if (typeof providerPath !== "string" || !/^\/[a-zA-Z0-9_./:%-]+$/.test(providerPath) || providerPath.split("/").some((part) => { try { const decoded = decodeURIComponent(part); return [".", ".."].includes(decoded) || /[\\/%]/.test(decoded); } catch { return true; } })) throw new Error("无效的模型请求路径");
            if (!["text", "image", "audio"].includes(capability)) throw new Error("此模型类型暂不支持同步生成");
            if (capability === "audio" && providerPath !== "/audio/speech") throw new Error("仅支持 OpenAI 兼容语音合成");
            if (multipart !== undefined && (capability !== "image" || providerPath !== "/images/edits" || body !== undefined)) throw new Error("无效的图片编辑请求");
            if (multipart === undefined && (!body || typeof body !== "object" || Array.isArray(body))) throw new Error("无效的生成请求");
            const formEntries = multipart === undefined ? null : snapshotImageForm(multipart);
            const serialized = formEntries ? null : JSON.stringify(body);
            const key = crypto.randomUUID();
            const intentSession = vault.load(base);
            const intentGeneration = authGeneration;
            if (!intentSession) throw new YingceApiError("请先登录", { status: 401, reason: "unauthorized" });
            const unknownOutcome = (status) => new YingceApiError("生成结果无法确认，执行和费用状态可能未知。请核对结果后再手动发起新请求。", { status, reason: "outcome_unknown" });
            return {
                async send({ signal } = {}) {
                    const session = vault.load(base);
                    if (!session) throw new YingceApiError("请先登录", { status: 401, reason: "unauthorized" });
                    if (authGeneration !== intentGeneration || session !== intentSession) throw new YingceApiError("登录会话已变化，请重新发起生成。", { status: 401, reason: "unauthorized" });
                    if (signal?.aborted) throw signal.reason || new Error("请求已取消");
                    let response;
                    try {
                        response = await fetchImpl(`${base}/ai/system/${encodeURIComponent(channelId)}${providerPath}`, {
                            method: "POST", redirect: "error", signal,
                            headers: { authorization: `Bearer ${session}`, ...(!formEntries ? { "content-type": "application/json" } : {}), "x-idempotency-key": key },
                            body: formEntries ? imageFormBody(formEntries) : serialized,
                        });
                    } catch (error) {
                        throw unknownOutcome();
                    }
                    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
                    if (contentType === "application/json" || contentType.endsWith("+json")) {
                        let data;
                        try { data = await response.json(); } catch { throw response.ok ? unknownOutcome(response.status) : generationResponseError(unrecognizedResponse(response.status), response.status); }
                        if (!response.ok || (data && (typeof data.code === "number" || (typeof data.reason === "string" && data.reason.trim())))) {
                            let parsed;
                            try { parsed = parseEnvelope(response.status, data); }
                            catch (error) { throw generationResponseError(error, response.status); }
                            if (capability === "audio") throw unknownOutcome(response.status);
                            return parsed;
                        }
                        if (capability === "audio") throw unknownOutcome(response.status);
                        return data;
                    }
                    if (!response.ok) throw generationResponseError(new YingceApiError(response.status === 409 ? "请求已提交过，请核对结果后手动发起新请求。" : response.status === 401 ? "登录已失效，请重新登录。" : response.status === 429 ? "请求过于频繁，请稍后再试。" : "生成请求失败", { status: response.status }), response.status);
                    if (capability !== "audio" || !contentType.startsWith("audio/")) throw unknownOutcome(response.status);
                    let bytes;
                    try { bytes = Buffer.from(await response.arrayBuffer()); } catch { throw unknownOutcome(); }
                    if (!bytes.length) throw unknownOutcome(response.status);
                    return { contentType, bytes };
                },
            };
        },
        async logout() {
            ++authGeneration;
            let session;
            try { session = vault.load(base); }
            finally { vault.clear(); }
            return request("/auth/logout", { method: "POST", sessionOverride: session });
        },
    };
}

module.exports = { normalizeApiUrl, accountScope, createSessionVault, createYingceSessionClient, YingceApiError, parseEnvelope };
