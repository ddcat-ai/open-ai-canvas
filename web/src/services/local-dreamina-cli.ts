import { t } from "@/i18n";
import type { LocalRuntimeTransport } from "@/services/local-runtime";
import { LocalRuntimeClientError } from "@/services/local-runtime-session";

export type DreaminaCliState = "missing" | "installed" | "login_pending" | "authenticated" | "error";
export type DreaminaLifecycleStatusCode = "dreamina_missing" | "dreamina_version_failed" | "dreamina_login_required" | "dreamina_login_pending";

export type DreaminaCliStatus = {
    provider: "dreamina-cli";
    state: DreaminaCliState;
    installed: boolean;
    authenticated: boolean;
    version?: string;
    totalCredit?: number;
    accountBinding?: string;
    sessionEpoch?: number;
    creditObservedAt?: string;
    code?: DreaminaLifecycleStatusCode;
    message: string;
    verificationUri?: string;
    userCode?: string;
    expiresAt?: string;
};

export type DreaminaRequestOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
    now?: () => number;
};

export class DreaminaAgentError extends Error {
    constructor(
        readonly code: string,
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "DreaminaAgentError";
    }
}

const MAX_RESPONSE_BYTES = 64 * 1024;
export const DREAMINA_REQUEST_TIMEOUTS = { status: 30_000, login: 35_000, logout: 20_000 } as const;
export type DreaminaLifecycleAction = keyof typeof DREAMINA_REQUEST_TIMEOUTS;

export function dreaminaRequestTimeout(action: DreaminaLifecycleAction, override?: number) {
    return override ?? DREAMINA_REQUEST_TIMEOUTS[action];
}
const LIFECYCLE_CODES = new Set<DreaminaLifecycleStatusCode>(["dreamina_missing", "dreamina_version_failed", "dreamina_login_required", "dreamina_login_pending"]);
const STABLE_ERROR_MESSAGES: Record<string, string> = {
    dreamina_cancelled: t("domain:dreamina-operation-cancelled"),
    dreamina_cleanup_failed: t("domain:failed-to-clean-up-the-dreamina-process-check-local-process-status"),
    dreamina_command_invalid: t("domain:invalid-dreamina-cli-command"),
    dreamina_command_timeout: t("domain:dreamina-operation-timed-out-related-processes-have-been-cleaned-up"),
    dreamina_environment_invalid: t("domain:invalid-dreamina-environment-variables"),
    dreamina_idempotency_conflict: t("domain:dreamina-operation-identifier-conflict"),
    dreamina_internal_error: t("domain:dreamina-cli-request-failed"),
    dreamina_login_failed: t("domain:unable-to-start-dreamina-oauth-sign-in"),
    dreamina_login_pending: t("domain:complete-authorization-on-the-official-dreamina-page-first"),
    dreamina_login_required: t("domain:dreamina-cli-requires-sign-in"),
    dreamina_login_response_invalid: t("domain:unrecognized-dreamina-login-response-upgrade-the-cli"),
    dreamina_logout_failed: t("domain:dreamina-sign-out-failed-try-again"),
    dreamina_missing: t("domain:dreamina-cli-not-found"),
    dreamina_output_too_large: t("domain:the-dreamina-response-exceeds-the-safety-size-limit"),
    dreamina_query_failed: t("domain:dreamina-query-failed"),
    dreamina_query_response_invalid: t("domain:invalid-dreamina-query-response"),
    dreamina_reference_budget_exceeded: t("domain:the-dreamina-reference-file-exceeds-the-safety-size-limit"),
    dreamina_reference_cleanup_failed: t("domain:failed-to-clean-up-dreamina-reference-files"),
    dreamina_reference_invalid: t("domain:invalid-dreamina-reference-file"),
    dreamina_request_invalid: t("domain:invalid-dreamina-request-parameters"),
    dreamina_spawn_failed: t("domain:unable-to-start-the-dreamina-cli"),
    dreamina_state_busy: t("domain:dreamina-is-processing-another-operation"),
    dreamina_state_fenced: t("domain:dreamina-operation-expired"),
    dreamina_state_invalid: t("domain:invalid-dreamina-local-state"),
    dreamina_submission_unknown: t("domain:unknown-dreamina-submission-result-check-its-status-first"),
    dreamina_version_failed: t("domain:dreamina-cli-version-check-failed"),
};

export function getDreaminaStatus(client: LocalRuntimeTransport, options: DreaminaRequestOptions = {}) {
    return requestDreamina(client, "GET", "/dreamina/status", {
        ...options,
        timeoutMs: dreaminaRequestTimeout("status", options.timeoutMs),
    });
}

export function loginDreamina(client: LocalRuntimeTransport, options: DreaminaRequestOptions = {}) {
    return requestDreamina(client, "POST", "/dreamina/login", {
        ...options,
        timeoutMs: dreaminaRequestTimeout("login", options.timeoutMs),
    });
}

export function logoutDreamina(client: LocalRuntimeTransport, options: DreaminaRequestOptions = {}) {
    return requestDreamina(client, "POST", "/dreamina/logout", {
        ...options,
        timeoutMs: dreaminaRequestTimeout("logout", options.timeoutMs),
    });
}

async function requestDreamina(client: LocalRuntimeTransport, method: "GET" | "POST", route: "/dreamina/status" | "/dreamina/login" | "/dreamina/logout", options: DreaminaRequestOptions) {
    if (options.signal?.aborted) throw publicError("dreamina_cancelled", 499);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
        () => {
            timedOut = true;
            controller.abort();
        },
        Math.max(1, options.timeoutMs ?? DREAMINA_REQUEST_TIMEOUTS.status),
    );

    try {
        const response = await client.request(route, {
            method,
            ...(method === "POST"
                ? {
                      headers: { "content-type": "application/json" },
                      body: "{}",
                  }
                : {}),
            signal: controller.signal,
        });
        if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
            throw publicError("dreamina_response_invalid", 502);
        }
        const body = await readBoundedJson(response);
        if (!response.ok || !isRecord(body) || body.ok !== true) {
            const code = isRecord(body) && typeof body.code === "string" && body.code in STABLE_ERROR_MESSAGES ? body.code : "dreamina_internal_error";
            throw publicError(code, response.status || 500);
        }
        return parseStatus(body.status, options.now?.() ?? Date.now());
    } catch (error) {
        if (error instanceof DreaminaAgentError) throw error;
        if (controller.signal.aborted) {
            throw publicError(timedOut ? "dreamina_timeout" : "dreamina_cancelled", timedOut ? 504 : 499);
        }
        if (error instanceof LocalRuntimeClientError && error.code === "session_required") {
            throw publicError("dreamina_runtime_required", 401);
        }
        throw publicError("dreamina_runtime_unreachable", 503);
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
    }
}

async function readBoundedJson(response: Response): Promise<unknown> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw publicError("dreamina_response_invalid", 502);
    }
    if (!response.body) throw publicError("dreamina_response_invalid", 502);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const item = await reader.read();
            if (item.done) break;
            total += item.value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw publicError("dreamina_response_invalid", 502);
            }
            chunks.push(item.value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        throw publicError("dreamina_response_invalid", 502);
    }
}

function parseStatus(value: unknown, now: number): DreaminaCliStatus {
    if (!isRecord(value)) throw publicError("dreamina_response_invalid", 502);
    const allowed = new Set(["provider", "state", "installed", "authenticated", "version", "code", "message"]);
    if (value.state === "authenticated") {
        allowed.add("totalCredit");
        allowed.add("accountBinding");
        allowed.add("sessionEpoch");
        allowed.add("creditObservedAt");
    }
    if (value.state === "login_pending") {
        allowed.add("verificationUri");
        allowed.add("userCode");
        allowed.add("expiresAt");
    }
    if (
        Object.keys(value).some((key) => !allowed.has(key)) ||
        value.provider !== "dreamina-cli" ||
        !isDreaminaState(value.state) ||
        typeof value.installed !== "boolean" ||
        typeof value.authenticated !== "boolean" ||
        typeof value.message !== "string" ||
        value.message.length < 1 ||
        value.message.length > 500 ||
        (value.version !== undefined && (typeof value.version !== "string" || !/^[A-Za-z0-9._+:-]{1,120}$/.test(value.version))) ||
        (value.totalCredit !== undefined && (value.state !== "authenticated" || !Number.isInteger(value.totalCredit) || (value.totalCredit as number) < 0 || (value.totalCredit as number) > 1_000_000_000)) ||
        (value.accountBinding === undefined) !== (value.sessionEpoch === undefined) ||
        (value.accountBinding !== undefined && (value.state !== "authenticated" || typeof value.accountBinding !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(value.accountBinding))) ||
        (value.sessionEpoch !== undefined && (value.state !== "authenticated" || !Number.isSafeInteger(value.sessionEpoch) || (value.sessionEpoch as number) < 0)) ||
        (value.creditObservedAt !== undefined && (value.totalCredit === undefined || typeof value.creditObservedAt !== "string" || !Number.isFinite(Date.parse(value.creditObservedAt)))) ||
        (value.code !== undefined && (typeof value.code !== "string" || !LIFECYCLE_CODES.has(value.code as DreaminaLifecycleStatusCode)))
    ) {
        throw publicError("dreamina_response_invalid", 502);
    }
    const code = value.code as DreaminaLifecycleStatusCode | undefined;
    if (!consistentStatus(value.state, value.installed, value.authenticated, code)) {
        throw publicError("dreamina_response_invalid", 502);
    }

    let verification: Pick<DreaminaCliStatus, "verificationUri" | "userCode" | "expiresAt"> = {};
    if (value.state === "login_pending") {
        if (!isOfficialVerificationUri(value.verificationUri) || typeof value.userCode !== "string" || !/^[A-Za-z0-9-]{4,32}$/.test(value.userCode) || typeof value.expiresAt !== "string") {
            throw publicError("dreamina_response_invalid", 502);
        }
        const expiresAt = Date.parse(value.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 31 * 60_000) {
            throw publicError("dreamina_response_invalid", 502);
        }
        verification = {
            verificationUri: value.verificationUri,
            userCode: value.userCode,
            expiresAt: value.expiresAt,
        };
    }

    return {
        provider: "dreamina-cli",
        state: value.state,
        installed: value.installed,
        authenticated: value.authenticated,
        ...(typeof value.version === "string" ? { version: value.version } : {}),
        ...(typeof value.totalCredit === "number" ? { totalCredit: value.totalCredit } : {}),
        ...(typeof value.accountBinding === "string" ? { accountBinding: value.accountBinding } : {}),
        ...(typeof value.sessionEpoch === "number" ? { sessionEpoch: value.sessionEpoch } : {}),
        ...(typeof value.creditObservedAt === "string" ? { creditObservedAt: value.creditObservedAt } : {}),
        ...(code ? { code } : {}),
        message: publicStatusMessage(value.state),
        ...verification,
    };
}

function consistentStatus(state: DreaminaCliState, installed: boolean, authenticated: boolean, code: DreaminaLifecycleStatusCode | undefined) {
    if (state === "missing") return !installed && !authenticated && code === "dreamina_missing";
    if (state === "installed") return installed && !authenticated && code === "dreamina_login_required";
    if (state === "login_pending") return installed && !authenticated && code === "dreamina_login_pending";
    if (state === "authenticated") return installed && authenticated && code === undefined;
    return installed && !authenticated && code === "dreamina_version_failed";
}

function isDreaminaState(value: unknown): value is DreaminaCliState {
    return value === "missing" || value === "installed" || value === "login_pending" || value === "authenticated" || value === "error";
}

function isOfficialVerificationUri(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 2_048) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "jimeng.jianying.com" && url.pathname === "/ai-tool/cli-auth" && !url.username && !url.password && !url.hash;
    } catch {
        return false;
    }
}

function publicStatusMessage(state: DreaminaCliState) {
    if (state === "missing") return t("domain:dreamina-cli-not-found-install-it-locally-first");
    if (state === "installed") return t("domain:dreamina-cli-is-installed-but-requires-sign-in");
    if (state === "login_pending") return t("domain:confirm-dreamina-sign-in-on-the-official-page");
    if (state === "authenticated") return t("domain:dreamina-cli-is-signed-in");
    return t("domain:dreamina-cli-found-but-version-check-failed");
}

function publicError(code: string, status: number) {
    const messages: Record<string, string> = {
        ...STABLE_ERROR_MESSAGES,
        dreamina_cancelled: t("domain:dreamina-operation-cancelled"),
        dreamina_response_invalid: t("domain:invalid-dreamina-cli-response"),
        dreamina_runtime_required: t("domain:connect-to-the-local-runtime-first"),
        dreamina_runtime_unreachable: t("domain:the-local-runtime-is-temporarily-unavailable"),
        dreamina_timeout: t("domain:dreamina-cli-request-timed-out"),
    };
    return new DreaminaAgentError(code, status, messages[code] ?? t("domain:dreamina-cli-request-failed"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
