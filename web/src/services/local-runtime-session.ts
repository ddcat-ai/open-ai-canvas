import { openDB } from "idb";
import { canonicalize } from "json-canonicalize";

const configuredRuntimeEndpoint = typeof import.meta.env === "object"
    ? import.meta.env.VITE_FRAMEFIELD_LOCAL_RUNTIME_ENDPOINT
    : undefined;
export const LOCAL_RUNTIME_ENDPOINT = resolveLocalRuntimeEndpoint(configuredRuntimeEndpoint);
const KEY_DATABASE = "framefield-local-runtime";
const KEY_STORE = "browser-keys";
const KEY_RECORD_ID = "default";

export function resolveLocalRuntimeEndpoint(value: string | undefined) {
    if (value === undefined) return "http://127.0.0.1:17371";
    if (!value || value !== value.trim() || value.includes(",")) {
        throw new Error("Local Runtime endpoint must be one exact loopback origin");
    }
    const url = new URL(value);
    if (url.protocol !== "http:"
        || url.hostname !== "127.0.0.1"
        || !url.port
        || url.pathname !== "/"
        || url.username
        || url.password
        || url.search
        || url.hash
        || url.origin !== value) {
        throw new Error("Local Runtime endpoint must be one exact loopback origin");
    }
    return url.origin;
}

export type RuntimeBrowserKeyRecord = {
    id: typeof KEY_RECORD_ID;
    privateKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
    keyId: string;
    registered: boolean;
};

export type RuntimeBrowserKeyStore = {
    load(): Promise<RuntimeBrowserKeyRecord | undefined>;
    save(record: RuntimeBrowserKeyRecord): Promise<void>;
    clear(): Promise<void>;
};

export type RuntimePublicSession = {
    sessionId: string;
    keyId: string;
    scopes: string[];
    expiresAt: string;
};

export type LocalRuntimeConnection =
    | { state: "connected"; session: RuntimePublicSession; runtimeVersion: number }
    | { state: "origin_not_trusted"; runtimeVersion: number };

type RuntimeInfo = {
    runtime: "framefield-local-runtime";
    apiVersion: 2;
    protocolVersion: "framefield-runtime-session-v1";
    runtimeInstanceId: string;
    originTrusted: boolean;
};

type RuntimeChallenge = {
    state: "challenge";
    challengeId: string;
    nonce: string;
    runtimeInstanceId: string;
    expiresAt: string;
    keyId: string;
};

type LocalRuntimeSessionClientOptions = {
    origin?: string;
    keyStore?: RuntimeBrowserKeyStore;
    fetch?: typeof fetch;
    crypto?: Crypto;
    now?: () => number;
};

export class LocalRuntimeClientError extends Error {
    constructor(readonly code: string, message: string, readonly status = 0) {
        super(message);
        this.name = "LocalRuntimeClientError";
    }
}

export class LocalRuntimeSessionClient {
    private readonly origin: string;
    private readonly keyStore: RuntimeBrowserKeyStore;
    private readonly fetchImpl: typeof fetch;
    private readonly cryptoImpl: Crypto;
    private readonly now: () => number;
    private session?: RuntimePublicSession;
    private runtimeInstanceId?: string;
    private pending?: RuntimeChallenge;
    private connectPromise?: Promise<LocalRuntimeConnection>;

    constructor(options: LocalRuntimeSessionClientOptions = {}) {
        this.origin = exactOrigin(options.origin ?? globalThis.location?.origin ?? "");
        this.keyStore = options.keyStore ?? createIndexedDbRuntimeKeyStore();
        this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.cryptoImpl = options.crypto ?? globalThis.crypto;
        this.now = options.now ?? Date.now;
        if (!this.cryptoImpl?.subtle || typeof this.cryptoImpl.getRandomValues !== "function") {
            throw new LocalRuntimeClientError("webcrypto_unavailable", "浏览器不支持本机安全连接");
        }
    }

    currentSession() {
        return this.session ? { ...this.session, scopes: [...this.session.scopes] } : undefined;
    }

    connect(signal?: AbortSignal) {
        if (this.session && Date.parse(this.session.expiresAt) > this.now()) {
            return Promise.resolve<LocalRuntimeConnection>({
                state: "connected",
                session: this.currentSession()!,
                runtimeVersion: 2,
            });
        }
        this.connectPromise ??= this.connectOnce(signal).finally(() => {
            this.connectPromise = undefined;
        });
        return this.connectPromise;
    }

    async request(pathAndQuery: string, init: RequestInit = {}) {
        const session = this.session;
        if (!session || Date.parse(session.expiresAt) <= this.now()) {
            this.session = undefined;
            throw new LocalRuntimeClientError("session_required", "本机会话尚未建立", 401);
        }
        const url = exactRuntimeUrl(pathAndQuery);
        const method = String(init.method ?? "GET").toUpperCase();
        const bodyBytes = requestBodyBytes(init.body);
        const headers = new Headers(init.headers);
        if (headers.has("authorization") || headers.has("x-canvas-agent-token")) {
            throw new LocalRuntimeClientError("legacy_bearer_rejected", "正常本机请求不能携带旧版凭据");
        }
        const timestamp = this.now();
        const requestNonce = randomBase64Url(this.cryptoImpl, 16);
        const lastEventId = headers.get("last-event-id");
        const payload = {
            protocol: "framefield-runtime-request-v1",
            sessionId: session.sessionId,
            keyId: session.keyId,
            method,
            pathAndQuery: `${url.pathname}${url.search}`,
            bodySha256: await sha256Base64Url(this.cryptoImpl, bodyBytes),
            lastEventId,
            origin: this.origin,
            endpoint: LOCAL_RUNTIME_ENDPOINT,
            runtimeInstanceId: this.runtimeInstanceId!,
            requestNonce,
            timestamp,
            sessionExpiresAt: session.expiresAt,
        };
        const key = await this.requireKey();
        const proof = await signP1363(this.cryptoImpl, key.privateKey, canonicalize(payload));
        headers.set("X-Framefield-Runtime-Session", session.sessionId);
        headers.set("X-Framefield-Runtime-Timestamp", String(timestamp));
        headers.set("X-Framefield-Runtime-Nonce", requestNonce);
        headers.set("X-Framefield-Runtime-Proof", proof);
        const response = await this.fetchImpl(url, {
            ...init,
            method,
            headers,
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
        });
        if (response.status === 401) this.session = undefined;
        return response;
    }

    revokeLocalSession() {
        this.session = undefined;
        this.pending = undefined;
    }

    private async connectOnce(signal?: AbortSignal): Promise<LocalRuntimeConnection> {
        const info = await this.readInfo(signal);
        if (!info.originTrusted) {
            this.session = undefined;
            this.pending = undefined;
            return { state: "origin_not_trusted", runtimeVersion: info.apiVersion };
        }
        if (this.runtimeInstanceId && this.runtimeInstanceId !== info.runtimeInstanceId) {
            this.session = undefined;
            this.pending = undefined;
        }
        this.runtimeInstanceId = info.runtimeInstanceId;
        const key = await this.requireKey();
        let challenge = this.pending;
        if (!challenge || Date.parse(challenge.expiresAt) <= this.now()) {
            challenge = await this.createChallenge(key, signal);
            this.pending = challenge;
        }
        if (challenge.runtimeInstanceId !== info.runtimeInstanceId || challenge.keyId !== key.keyId) {
            this.pending = undefined;
            throw new LocalRuntimeClientError("challenge_invalid", "本机会话挑战无效");
        }
        const signature = await signP1363(
            this.cryptoImpl,
            key.privateKey,
            canonicalize({
                protocol: "framefield-runtime-session-v1",
                challengeId: challenge.challengeId,
                nonce: challenge.nonce,
                origin: this.origin,
                endpoint: LOCAL_RUNTIME_ENDPOINT,
                runtimeInstanceId: challenge.runtimeInstanceId,
                expiresAt: challenge.expiresAt,
            }),
        );
        const exchange = await this.jsonFetch(
            "/runtime/session/exchange",
            { challengeId: challenge.challengeId, signature },
            signal,
            true,
        );
        if (!exchange.response.ok) throw responseError(exchange.response, exchange.body);
        const session = parseSession(exchange.body, key.keyId);
        this.pending = undefined;
        this.session = session;
        if (!key.registered) {
            key.registered = true;
            await this.keyStore.save(key);
        }
        return { state: "connected", session: this.currentSession()!, runtimeVersion: info.apiVersion };
    }

    private async readInfo(signal?: AbortSignal) {
        const response = await this.fetchImpl(`${LOCAL_RUNTIME_ENDPOINT}/runtime/info`, {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            signal,
        });
        const body = await safeJson(response);
        if (!response.ok) throw responseError(response, body);
        return parseInfo(body);
    }

    private async createChallenge(key: RuntimeBrowserKeyRecord, signal?: AbortSignal) {
        const payload = key.registered
            ? { keyId: key.keyId }
            : { publicKeyJwk: key.publicKeyJwk };
        const result = await this.jsonFetch("/runtime/session/challenge", payload, signal, true);
        if (result.response.status === 404 && key.registered) {
            key.registered = false;
            await this.keyStore.save(key);
            const retry = await this.jsonFetch(
                "/runtime/session/challenge",
                { publicKeyJwk: key.publicKeyJwk },
                signal,
                true,
            );
            if (!retry.response.ok) throw responseError(retry.response, retry.body);
            return parseChallenge(retry.body, key.keyId);
        }
        if (!result.response.ok) throw responseError(result.response, result.body);
        return parseChallenge(result.body, key.keyId);
    }

    private async jsonFetch(
        path: string,
        body: unknown,
        signal?: AbortSignal,
        allowError = false,
    ) {
        const response = await this.fetchImpl(`${LOCAL_RUNTIME_ENDPOINT}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            signal,
        });
        const parsed = await safeJson(response);
        if (!allowError && !response.ok) throw responseError(response, parsed);
        return { response, body: parsed };
    }

    private async requireKey() {
        const existing = await this.keyStore.load();
        if (existing) {
            validateKeyRecord(existing);
            return existing;
        }
        const pair = await this.cryptoImpl.subtle.generateKey(
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign", "verify"],
        );
        const publicKeyJwk = await this.cryptoImpl.subtle.exportKey("jwk", pair.publicKey);
        validatePublicJwk(publicKeyJwk);
        const keyId = await browserKeyId(this.cryptoImpl, publicKeyJwk);
        const record: RuntimeBrowserKeyRecord = {
            id: KEY_RECORD_ID,
            privateKey: pair.privateKey,
            publicKeyJwk,
            keyId,
            registered: false,
        };
        await this.keyStore.save(record);
        return record;
    }
}

export function createIndexedDbRuntimeKeyStore(): RuntimeBrowserKeyStore {
    const database = openDB(KEY_DATABASE, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
        },
    });
    return {
        async load() {
            return await (await database).get(KEY_STORE, KEY_RECORD_ID) as RuntimeBrowserKeyRecord | undefined;
        },
        async save(record) {
            await (await database).put(KEY_STORE, record, KEY_RECORD_ID);
        },
        async clear() {
            await (await database).delete(KEY_STORE, KEY_RECORD_ID);
        },
    };
}

async function browserKeyId(cryptoImpl: Crypto, jwk: JsonWebKey) {
    return await sha256Base64Url(cryptoImpl, new TextEncoder().encode(canonicalize({
        crv: jwk.crv,
        kty: jwk.kty,
        x: jwk.x,
        y: jwk.y,
    })));
}

async function signP1363(cryptoImpl: Crypto, privateKey: CryptoKey, payload: string) {
    const signature = new Uint8Array(await cryptoImpl.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        new TextEncoder().encode(payload),
    ));
    if (signature.byteLength !== 64) {
        throw new LocalRuntimeClientError("signature_invalid", "浏览器签名格式不受支持");
    }
    return base64Url(signature);
}

async function sha256Base64Url(cryptoImpl: Crypto, value: Uint8Array) {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(value);
    return base64Url(new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes.buffer)));
}

function randomBase64Url(cryptoImpl: Crypto, bytes: number) {
    return base64Url(cryptoImpl.getRandomValues(new Uint8Array(bytes)));
}

function base64Url(value: Uint8Array) {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function requestBodyBytes(body: BodyInit | null | undefined) {
    if (body === undefined || body === null) return new Uint8Array();
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    throw new LocalRuntimeClientError("request_body_invalid", "本机请求体格式无效");
}

function exactRuntimeUrl(pathAndQuery: string) {
    if (!pathAndQuery.startsWith("/") || pathAndQuery.includes("#")) {
        throw new LocalRuntimeClientError("request_target_invalid", "本机请求路径无效");
    }
    const url = new URL(pathAndQuery, LOCAL_RUNTIME_ENDPOINT);
    if (url.origin !== LOCAL_RUNTIME_ENDPOINT || `${url.pathname}${url.search}` !== pathAndQuery) {
        throw new LocalRuntimeClientError("request_target_invalid", "本机请求路径无效");
    }
    return url;
}

function exactOrigin(value: string) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)
            || url.pathname !== "/"
            || url.search
            || url.hash
            || url.origin !== value) throw new Error();
        return url.origin;
    } catch {
        throw new LocalRuntimeClientError("origin_invalid", "当前页面来源无效");
    }
}

function validatePublicJwk(jwk: JsonWebKey) {
    if (jwk.kty !== "EC"
        || jwk.crv !== "P-256"
        || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x ?? "")
        || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y ?? "")
        || jwk.d !== undefined
        || jwk.ext !== true
        || !Array.isArray(jwk.key_ops)
        || jwk.key_ops.length !== 1
        || jwk.key_ops[0] !== "verify") {
        throw new LocalRuntimeClientError("browser_key_invalid", "浏览器公钥无效");
    }
}

function validateKeyRecord(record: RuntimeBrowserKeyRecord) {
    validatePublicJwk(record.publicKeyJwk);
    if (record.id !== KEY_RECORD_ID
        || record.privateKey.type !== "private"
        || record.privateKey.extractable
        || record.privateKey.algorithm.name !== "ECDSA"
        || record.privateKey.usages.length !== 1
        || record.privateKey.usages[0] !== "sign"
        || !/^[A-Za-z0-9_-]{43}$/.test(record.keyId)) {
        throw new LocalRuntimeClientError("browser_key_invalid", "浏览器密钥无效");
    }
}

function parseInfo(value: Record<string, unknown>): RuntimeInfo {
    assertExactKeys(value, ["runtime", "apiVersion", "protocolVersion", "runtimeInstanceId", "originTrusted"]);
    if (value.runtime !== "framefield-local-runtime"
        || value.apiVersion !== 2
        || value.protocolVersion !== "framefield-runtime-session-v1"
        || typeof value.runtimeInstanceId !== "string"
        || !/^[A-Za-z0-9_-]{8,160}$/.test(value.runtimeInstanceId)
        || typeof value.originTrusted !== "boolean") {
        throw new LocalRuntimeClientError("runtime_incompatible", "本机运行时版本不兼容");
    }
    return value as RuntimeInfo;
}

function parseChallenge(value: Record<string, unknown>, keyId: string): RuntimeChallenge {
    assertExactKeys(value, ["state", "challengeId", "nonce", "runtimeInstanceId", "expiresAt", "keyId"]);
    if (value.state !== "challenge"
        || typeof value.challengeId !== "string"
        || typeof value.nonce !== "string"
        || typeof value.runtimeInstanceId !== "string"
        || typeof value.expiresAt !== "string"
        || value.keyId !== keyId) {
        throw new LocalRuntimeClientError("challenge_invalid", "本机会话挑战无效");
    }
    return value as RuntimeChallenge;
}

function parseSession(value: Record<string, unknown>, keyId: string): RuntimePublicSession {
    assertExactKeys(value, ["sessionId", "keyId", "scopes", "expiresAt"]);
    if (typeof value.sessionId !== "string"
        || value.sessionId.length < 16
        || value.keyId !== keyId
        || !Array.isArray(value.scopes)
        || value.scopes.some((scope) => typeof scope !== "string")
        || typeof value.expiresAt !== "string") {
        throw new LocalRuntimeClientError("session_invalid", "本机会话响应无效");
    }
    return value as RuntimePublicSession;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
    const allowed = new Set(keys);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new LocalRuntimeClientError("runtime_response_invalid", "本机运行时响应无效");
    }
}

async function safeJson(response: Response) {
    try {
        const value = await response.json() as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
    } catch {
        throw new LocalRuntimeClientError("runtime_response_invalid", "本机运行时响应无效", response.status);
    }
}

function responseError(response: Response, body: Record<string, unknown>) {
    const code = typeof body.code === "string" && body.code in PUBLIC_RUNTIME_ERROR_MESSAGES
        ? body.code
        : "runtime_request_failed";
    return new LocalRuntimeClientError(code, PUBLIC_RUNTIME_ERROR_MESSAGES[code], response.status);
}

const PUBLIC_RUNTIME_ERROR_MESSAGES: Record<string, string> = {
    challenge_invalid: "本机会话挑战无效",
    invalid_public_key: "浏览器公钥无效",
    origin_not_trusted: "当前页面来源未获本机授权",
    rate_limited: "本机连接请求过多，请稍后重试",
    registration_not_found: "浏览器密钥尚未注册",
    runtime_internal_error: "本机运行时请求失败",
    runtime_request_failed: "本机运行时请求失败",
};
