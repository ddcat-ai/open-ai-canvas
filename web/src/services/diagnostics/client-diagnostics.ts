import { type AxiosError, type AxiosRequestConfig } from "axios";

import { apiClient } from "@/services/api/request";

export type ClientDiagnosticLevel = "info" | "warning" | "error";
export type ClientDiagnosticCategory = "navigation" | "action" | "request" | "runtime" | "task" | "plugin";

export type ClientDiagnosticEvent = {
    id: string;
    timestamp: string;
    level: ClientDiagnosticLevel;
    category: ClientDiagnosticCategory;
    code?: string;
    message: string;
    route?: string;
    durationMs?: number;
    httpStatus?: number;
    requestId?: string;
    traceId?: string;
    taskId?: string;
    projectId?: string;
    canvasId?: string;
    stack?: string;
};

type DiagnosticEventInput = Omit<ClientDiagnosticEvent, "id" | "timestamp"> & { timestamp?: string };
type RequestDiagnosticMeta = { startedAt: number; traceId: string };

const maxEvents = 500;
const events: ClientDiagnosticEvent[] = [];
const requestMeta = new WeakMap<object, RequestDiagnosticMeta>();
let initialized = false;
let scopedUserId = "";
let activeTraceId = createDiagnosticId("trace");

export function initializeClientDiagnostics() {
    if (initialized || typeof window === "undefined") return;
    initialized = true;
    window.addEventListener("error", (event) => {
        recordDiagnosticEvent({
            level: "error",
            category: "runtime",
            message: event.message || "页面运行异常",
            stack: event.error instanceof Error ? event.error.stack : undefined,
        });
    });
    window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || "未处理的 Promise 异常"));
        recordDiagnosticEvent({ level: "error", category: "runtime", message: reason.message, stack: reason.stack });
    });

    apiClient.interceptors.request.use(
        (config) => {
            const route = normalizeRoute(config.url);
            if (config.method?.toLowerCase() === "post" && (route === "/tasks" || route === "/sessions")) {
                activeTraceId = createDiagnosticId("trace");
            }
            const traceId = activeTraceId;
            setTraceHeader(config, traceId);
            requestMeta.set(config, { startedAt: performance.now(), traceId });
            return config;
        },
        (error) => {
            recordDiagnosticEvent({ level: "error", category: "request", message: "请求发送前失败" });
            return Promise.reject(error);
        },
    );
    apiClient.interceptors.response.use(
        (response) => {
            const config = response.config;
            const meta = requestMeta.get(config);
            const route = normalizeRoute(config.url);
            const status = response.status;
            const businessCode = response.data && typeof response.data === "object" && "code" in response.data ? Number(response.data.code) : 0;
            const requestId = readHeader(response.headers, "x-request-id");
            recordDiagnosticEvent({
                level: status >= 400 || businessCode !== 0 ? "error" : "info",
                category: "request",
                code: businessCode !== 0 ? String(businessCode) : undefined,
                message: String(config.method || "GET").toUpperCase() + " " + route,
                route,
                durationMs: meta ? Math.max(0, Math.round(performance.now() - meta.startedAt)) : undefined,
                httpStatus: status,
                requestId,
                traceId: meta?.traceId,
            });
            return response;
        },
        (error: AxiosError) => {
            const config = error.config;
            const meta = config ? requestMeta.get(config) : undefined;
            const response = error.response;
            const body = response?.data && typeof response.data === "object" ? (response.data as { code?: number; msg?: string }) : undefined;
            const route = normalizeRoute(config?.url);
            recordDiagnosticEvent({
                level: "error",
                category: "request",
                code: body?.code !== undefined ? String(body.code) : response?.status ? "HTTP_" + response.status : "NETWORK_ERROR",
                message: body?.msg || String(config?.method || "GET").toUpperCase() + " " + route + " 请求失败",
                route,
                durationMs: meta ? Math.max(0, Math.round(performance.now() - meta.startedAt)) : undefined,
                httpStatus: response?.status,
                requestId: response ? readHeader(response.headers, "x-request-id") : undefined,
                traceId: meta?.traceId,
            });
            return Promise.reject(error);
        },
    );
}

export function setDiagnosticUserScope(userId: string) {
    const next = userId.trim();
    if (next === scopedUserId) return;
    scopedUserId = next;
    events.length = 0;
    activeTraceId = createDiagnosticId("trace");
}

export function recordDiagnosticEvent(input: DiagnosticEventInput) {
    const event: ClientDiagnosticEvent = {
        id: createDiagnosticId("event"),
        timestamp: input.timestamp || new Date().toISOString(),
        level: input.level,
        category: input.category,
        code: redactClientText(input.code),
        message: redactClientText(input.message) || "未命名诊断事件",
        route: normalizeRoute(input.route || (typeof window !== "undefined" ? window.location.pathname : "")),
        durationMs: input.durationMs === undefined ? undefined : clampNumber(input.durationMs, 0, 86_400_000),
        httpStatus: input.httpStatus === undefined ? undefined : clampNumber(input.httpStatus, 0, 599),
        requestId: safeDiagnosticId(input.requestId),
        traceId: safeDiagnosticId(input.traceId || activeTraceId),
        taskId: safeDiagnosticId(input.taskId),
        projectId: safeDiagnosticId(input.projectId),
        canvasId: safeDiagnosticId(input.canvasId),
        stack: redactClientText(input.stack, 4000),
    };
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
}

export function getClientDiagnosticEvents(range?: { from?: Date; to?: Date }) {
    const from = range?.from?.getTime() ?? Number.NEGATIVE_INFINITY;
    const to = range?.to?.getTime() ?? Number.POSITIVE_INFINITY;
    return events
        .filter((event) => {
            const timestamp = Date.parse(event.timestamp);
            return Number.isFinite(timestamp) && timestamp >= from && timestamp <= to;
        })
        .map((event) => ({ ...event }));
}

export function getDiagnosticRuntime() {
    return {
        appVersion: String(import.meta.env.VITE_APP_VERSION || "dev"),
        buildCommit: String(import.meta.env.VITE_BUILD_COMMIT || "unknown"),
        browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
        os: typeof navigator !== "undefined" ? navigator.platform : "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    };
}

export function getDiagnosticTraceId() {
    return activeTraceId;
}

function setTraceHeader(config: AxiosRequestConfig, traceId: string) {
    if (!config.headers) config.headers = {};
    if (typeof config.headers.set === "function") config.headers.set("X-Canvas-Trace-ID", traceId);
    else config.headers["X-Canvas-Trace-ID"] = traceId;
}

function readHeader(headers: unknown, key: string) {
    if (!headers || typeof headers !== "object") return undefined;
    const candidate = headers as { get?: (name: string) => string | null; [name: string]: unknown };
    if (typeof candidate.get === "function") return candidate.get(key) || undefined;
    const value = candidate[key] ?? candidate[key.toLowerCase()];
    return typeof value === "string" ? value : undefined;
}

function normalizeRoute(value?: string) {
    const raw = String(value || "").trim();
    if (!raw) return typeof window !== "undefined" ? window.location.pathname : "/";
    try {
        const parsed = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost");
        return parsed.pathname || "/";
    } catch {
        return raw.split(/[?#]/, 1)[0] || "/";
    }
}

function safeDiagnosticId(value?: string) {
    const normalized = String(value || "").trim();
    return /^[A-Za-z0-9._:-]{1,96}$/.test(normalized) ? normalized : undefined;
}

function redactClientText(value?: string, maxLength = 1200) {
    let text = String(value || "").trim();
    if (!text) return "";
    text = text.replace(/(authorization|cookie|set-cookie|api[_-]?key|secret[_-]?key|password|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
    text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
        try {
            const parsed = new URL(url);
            parsed.search = "";
            parsed.hash = "";
            return parsed.toString();
        } catch {
            return url.split(/[?#]/, 1)[0];
        }
    });
    return text.slice(0, maxLength);
}

function clampNumber(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}

function createDiagnosticId(prefix: string) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return prefix + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}
