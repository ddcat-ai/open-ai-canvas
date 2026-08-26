import crypto from "node:crypto";

import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { LocalRuntimeScope } from "./local-runtime-contract.js";
import {
    LocalRuntimeSessionError,
    type LocalRuntimeSessionManager,
} from "./local-runtime-session.js";

const PROOF_HEADERS = [
    "x-framefield-runtime-session",
    "x-framefield-runtime-timestamp",
    "x-framefield-runtime-nonce",
    "x-framefield-runtime-proof",
];

export type RuntimeCorsPolicy = {
    methods: readonly string[];
    headers: readonly string[];
    publicInfo?: boolean;
    trustedOrigin?: boolean;
    legacyOrigins?: readonly string[];
    legacyHeaders?: readonly string[];
};

export function exactAuthorityGuard(authority: string): RequestHandler {
    const expected = authority.trim().toLowerCase();
    return (req, res, next) => {
        const host = singleHeader(req, "host");
        if (!host || host.toLowerCase() !== expected) {
            res.status(421).json({ ok: false, code: "authority_invalid", message: "本机运行时地址无效" });
            return;
        }
        next();
    };
}

export function noStore(_req: Request, res: Response, next: NextFunction) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    next();
}

export function runtimeCors(
    policies: ReadonlyMap<string, RuntimeCorsPolicy>,
    sessions: LocalRuntimeSessionManager,
): RequestHandler {
    return (req, res, next) => {
        const policy = findCorsPolicy(policies, req.path);
        const origin = safeOrigin(singleHeader(req, "origin"));
        if (req.method === "OPTIONS") {
            const trusted = Boolean(origin && sessions.isTrustedOrigin(origin));
            const legacy = Boolean(origin && policy?.legacyOrigins?.includes(origin));
            if (!policy || !origin || (!policy.publicInfo && !trusted && !legacy)) {
                res.status(403).end();
                return;
            }
            const requestedMethod = singleHeader(req, "access-control-request-method")?.toUpperCase();
            const requestedHeaders = parseRequestedHeaders(singleHeader(req, "access-control-request-headers"));
            const allowedHeaders = trusted || policy.publicInfo
                ? policy.headers
                : policy.legacyHeaders ?? [];
            if (!requestedMethod
                || !policy.methods.includes(requestedMethod)
                || requestedHeaders.some((header) => !allowedHeaders.includes(header))) {
                res.status(403).end();
                return;
            }
            setCorsHeaders(res, origin);
            res.setHeader("Access-Control-Allow-Methods", policy.methods.join(","));
            if (allowedHeaders.length) {
                res.setHeader("Access-Control-Allow-Headers", allowedHeaders.join(","));
            }
            if (singleHeader(req, "access-control-request-private-network") === "true") {
                res.setHeader("Access-Control-Allow-Private-Network", "true");
            }
            res.status(204).end();
            return;
        }
        if (policy && origin && (policy.publicInfo
            || sessions.isTrustedOrigin(origin)
            || policy.legacyOrigins?.includes(origin))) {
            setCorsHeaders(res, origin);
        }
        next();
    };
}

export function trustedOriginGuard(sessions: LocalRuntimeSessionManager): RequestHandler {
    return (req, res, next) => {
        const origin = safeOrigin(singleHeader(req, "origin"));
        if (!origin || !sessions.isTrustedOrigin(origin)) {
            res.removeHeader("Access-Control-Allow-Origin");
            res.status(403).json({ ok: false, code: "origin_not_trusted", message: "来源未获本机授权" });
            return;
        }
        next();
    };
}

export function signedRuntimeGuard(
    sessions: LocalRuntimeSessionManager,
    scope: LocalRuntimeScope,
    options: { queryKeys?: readonly string[] } = {},
): RequestHandler {
    return (req, res, next) => {
        try {
            const origin = requiredOrigin(req);
            const pathAndQuery = canonicalRequestTarget(req, options.queryKeys);
            if (req.method !== "GET" && !isStrictJson(req)) {
                throw new LocalRuntimeSessionError("content_type_invalid", "请求必须使用 JSON", 415);
            }
            const sessionId = requiredHeader(req, "x-framefield-runtime-session");
            const timestampValue = requiredHeader(req, "x-framefield-runtime-timestamp");
            const requestNonce = requiredHeader(req, "x-framefield-runtime-nonce");
            const proof = requiredHeader(req, "x-framefield-runtime-proof");
            const timestamp = Number(timestampValue);
            const lastEventId = singleHeader(req, "last-event-id") ?? null;
            const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
            const session = sessions.verifyRequest({
                sessionId,
                origin,
                method: req.method,
                pathAndQuery,
                body,
                lastEventId,
                requestNonce,
                timestamp,
                proof,
                scope,
            });
            // Keep the public session contract free of origin while exposing the
            // already verified origin to module handlers that scope local data.
            res.locals.runtimeSession = { ...session, origin };
            next();
        } catch (error) {
            next(error);
        }
    };
}

export function legacyOrSignedRuntimeGuard(
    sessions: LocalRuntimeSessionManager,
    scope: LocalRuntimeScope,
    options: {
        queryKeys?: readonly string[];
        masterToken?: string;
        origins?: readonly string[];
    },
): RequestHandler {
    const signed = signedRuntimeGuard(sessions, scope, { queryKeys: options.queryKeys });
    return (req, res, next) => {
        const url = new URL(req.originalUrl || req.url, "http://runtime.invalid");
        const queryTokens = url.searchParams.getAll("token");
        const headerToken = singleHeader(req, "x-canvas-agent-token");
        if (!queryTokens.length && !headerToken) return signed(req, res, next);
        if (queryTokens.length > 1 || (queryTokens.length && headerToken)) {
            res.status(401).json({ ok: false, code: "legacy_auth_invalid", message: "旧版 Canvas 认证无效" });
            return;
        }
        const candidate = queryTokens[0] ?? headerToken ?? "";
        if (!options.masterToken || !constantTimeTextEqual(options.masterToken, candidate)) {
            res.status(401).json({ ok: false, code: "legacy_auth_invalid", message: "旧版 Canvas 认证无效" });
            return;
        }
        const origin = safeOrigin(singleHeader(req, "origin"));
        if (origin && !options.origins?.includes(origin)) {
            res.status(403).json({ ok: false, code: "legacy_origin_invalid", message: "旧版 Canvas 来源无效" });
            return;
        }
        if (req.method !== "GET" && !isStrictJson(req)) {
            res.status(415).json({ ok: false, code: "content_type_invalid", message: "请求必须使用 JSON" });
            return;
        }
        url.searchParams.delete("token");
        const cleanTarget = `${url.pathname}${url.search}`;
        req.url = cleanTarget;
        req.originalUrl = cleanTarget;
        delete req.headers["x-canvas-agent-token"];
        try {
            canonicalRequestTarget(req, options.queryKeys);
        } catch (error) {
            next(error);
            return;
        }
        if (origin) setCorsHeaders(res, origin);
        next();
    };
}

export function strictJsonObject(req: Request) {
    if (!isStrictJson(req) || !Buffer.isBuffer(req.body)) {
        throw new LocalRuntimeSessionError("content_type_invalid", "请求必须使用 JSON", 415);
    }
    try {
        const value = JSON.parse(req.body.toString("utf8")) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
    } catch {
        throw new LocalRuntimeSessionError("json_invalid", "JSON 请求无效", 400);
    }
}

export function assertExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
    const allowed = new Set(keys);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new LocalRuntimeSessionError("request_invalid", "请求字段无效", 400);
    }
}

export function runtimeErrorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
) {
    if (res.headersSent) return next(error);
    if (error instanceof LocalRuntimeSessionError) {
        res.status(error.statusCode).json({ ok: false, code: error.code, message: error.message });
        return;
    }
    res.status(500).json({ ok: false, code: "runtime_internal_error", message: "本机运行时请求失败" });
}

export function protectedCorsHeaders(method: "GET" | "POST", lastEventId = false) {
    return [
        ...(method === "POST" ? ["content-type"] : []),
        ...PROOF_HEADERS,
        ...(lastEventId ? ["last-event-id"] : []),
    ];
}

function setCorsHeaders(res: Response, origin: string) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
}

function findCorsPolicy(policies: ReadonlyMap<string, RuntimeCorsPolicy>, path: string) {
    const exact = policies.get(path);
    if (exact) return exact;
    for (const [pattern, policy] of policies) {
        if (!pattern.includes(":")) continue;
        const expected = pattern.split("/");
        const actual = path.split("/");
        if (expected.length !== actual.length) continue;
        if (expected.every((segment, index) => (
            segment.startsWith(":") ? /^[A-Za-z0-9._-]{1,160}$/.test(actual[index]) : segment === actual[index]
        ))) return policy;
    }
    return undefined;
}

function parseRequestedHeaders(value: string | undefined) {
    if (!value) return [];
    return value.split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
}

function isStrictJson(req: Request) {
    const value = singleHeader(req, "content-type")?.toLowerCase() ?? "";
    return /^application\/json(?:;\s*charset=utf-8)?$/.test(value);
}

function canonicalRequestTarget(req: Request, allowedQueryKeys: readonly string[] = []) {
    const target = req.originalUrl || req.url;
    const separator = target.indexOf("?");
    const pathname = separator < 0 ? target : target.slice(0, separator);
    if (!target.startsWith("/")
        || target.includes("#")
        || target.includes("\\")
        || /%(?:2f|5c)/i.test(target)
        || /\/(?:\.|%2e)(?:\/|$)/i.test(target)
        || /\/(?:\.\.|%2e%2e)(?:\/|$)/i.test(target)) {
        throw new LocalRuntimeSessionError("request_target_invalid", "请求路径无效", 400);
    }
    try {
        if (decodeURI(pathname) !== pathname) {
            throw new LocalRuntimeSessionError("request_target_invalid", "请求路径必须规范编码", 400);
        }
    } catch (error) {
        if (error instanceof LocalRuntimeSessionError) throw error;
        throw new LocalRuntimeSessionError("request_target_invalid", "请求路径无效", 400);
    }
    const url = new URL(target, "http://runtime.invalid");
    const allowed = new Set(allowedQueryKeys);
    const entries: Array<[string, string]> = [];
    for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        if (!allowed.has(key) || values.length !== 1 || !values[0] || values[0].length > 512) {
            throw new LocalRuntimeSessionError("request_target_invalid", "请求查询参数无效", 400);
        }
        entries.push([key, values[0]]);
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    const canonicalQuery = entries
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
    const canonical = `${pathname}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
    if (canonical !== target) {
        throw new LocalRuntimeSessionError("request_target_invalid", "请求路径必须规范编码", 400);
    }
    return canonical;
}

function requiredOrigin(req: Request) {
    const origin = safeOrigin(singleHeader(req, "origin"));
    if (!origin) throw new LocalRuntimeSessionError("origin_invalid", "来源无效", 403);
    return origin;
}

function safeOrigin(value: string | undefined) {
    if (!value || value === "null" || value.includes(",")) return undefined;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)
            || url.username
            || url.password
            || url.pathname !== "/"
            || url.search
            || url.hash
            || url.origin !== value) return undefined;
        return url.origin;
    } catch {
        return undefined;
    }
}

function requiredHeader(req: Request, name: string) {
    const value = singleHeader(req, name);
    if (!value) throw new LocalRuntimeSessionError("request_proof_missing", "请求签名缺失", 401);
    return value;
}

function singleHeader(req: Request, name: string) {
    const value = req.headers[name];
    return typeof value === "string" ? value : undefined;
}

function constantTimeTextEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.byteLength === b.byteLength && crypto.timingSafeEqual(a, b);
}
