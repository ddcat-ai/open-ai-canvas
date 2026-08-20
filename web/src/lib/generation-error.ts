export const CONTENT_MODERATION_ERROR_CODE = "sensitive_words_detected";

export const CONTENT_MODERATION_MESSAGE = "内容审核未通过，本次平台积分未扣除或已退还。请修改提示词后重新生成。";

const DEFAULT_GENERATION_ERROR_MESSAGE = "生成失败，请稍后重试。";
const NETWORK_ERROR_MESSAGE = "网络异常。";

export type GenerationFailureMetadata = {
    errorDetails: string;
    generationErrorCode?: string;
    failedPromptFingerprint?: string;
};

export function generationFailureMetadata(error: unknown, prompt: string): GenerationFailureMetadata {
    const raw = rawGenerationError(error);
    if (!isContentModerationError(raw)) return { errorDetails: generationErrorMessage(error) };
    return {
        errorDetails: CONTENT_MODERATION_MESSAGE,
        generationErrorCode: CONTENT_MODERATION_ERROR_CODE,
        failedPromptFingerprint: generationPromptFingerprint(prompt),
    };
}

export function generationErrorMessage(error: unknown) {
    const stableCode = generationErrorCode(error);
    const stableMessage = stableCode ? DREAMINA_SUBMIT_ERROR_MESSAGES[stableCode] : undefined;
    if (stableMessage) return stableMessage;
    const raw = rawGenerationError(error);
    if (isContentModerationError(raw)) return CONTENT_MODERATION_MESSAGE;

    const providerMessage = extractStructuredProviderMessage(raw) || extractWrappedProviderMessage(raw);
    const displayMessage = providerMessage || raw;
    if (isContentModerationError(displayMessage)) return CONTENT_MODERATION_MESSAGE;
    const resourceStorageMessage = resourceStorageFailureMessage(raw) || resourceStorageFailureMessage(displayMessage);
    if (resourceStorageMessage) return resourceStorageMessage;
    if (isNetworkFailure(displayMessage)) return NETWORK_ERROR_MESSAGE;
    if (!providerMessage) {
        if (hasHttpStatus(raw, 429)) return "服务当前繁忙，请稍后重试。";
        if (hasHttpStatus(raw, 401, 403)) return "生成服务鉴权失败，请检查渠道配置。";
        if (hasHttpStatus(raw, 404)) return "生成服务地址不可用，请检查渠道配置。";
        if (hasHttpStatus(raw, 500, 502, 503, 504) || containsInfrastructureDetails(raw)) return NETWORK_ERROR_MESSAGE;
    }
    return displayMessage || DEFAULT_GENERATION_ERROR_MESSAGE;
}

export const DREAMINA_SUBMIT_ERROR_MESSAGES: Record<string, string> = {
    dreamina_submit_spawn_failed: "无法启动官方即梦 CLI，任务尚未提交。",
    dreamina_submit_exit_nonzero: "官方即梦 CLI 未接受本次提交，任务没有自动重试。",
    dreamina_submit_timeout: "等待官方即梦 CLI 确认提交超时，为避免重复扣费，任务没有自动重试。",
    dreamina_submit_receipt_missing: "官方即梦 CLI 未返回任务凭证，为避免重复扣费，任务没有自动重试。",
    dreamina_submission_unknown: "提交结果待确认，为避免重复扣费未自动重试。",
};

export function generationErrorCode(error: unknown) {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
        const code = (error as { code: string }).code;
        if (/^(?:dreamina|local_generation|origin)_[a-z0-9_]{2,80}$/.test(code)) return code;
    }
    return undefined;
}

export function isContentModerationError(value: unknown) {
    const text = value instanceof Error ? value.message : String(value || "");
    return text.toLowerCase().includes(CONTENT_MODERATION_ERROR_CODE) || text.includes("内容审核未通过");
}

export function unchangedModeratedPrompt(metadata: { errorDetails?: string; generationErrorCode?: string; failedPromptFingerprint?: string } | undefined, prompt: string) {
    const moderationFailure = metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(metadata?.errorDetails);
    if (!moderationFailure) return false;
    if (!metadata?.failedPromptFingerprint) return true;
    return metadata.failedPromptFingerprint === generationPromptFingerprint(prompt);
}

// 指纹只用于识别“原样重试”，不是安全或鉴权用途。
export function generationPromptFingerprint(value: string) {
    const normalized = value.trim().replace(/\s+/g, " ");
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${normalized.length}:${(hash >>> 0).toString(36)}`;
}

function rawGenerationError(error: unknown) {
    if (error instanceof Error) return error.message.trim();
    if (typeof error === "string") return error.trim();
    return providerPayloadMessage(error);
}

function extractStructuredProviderMessage(raw: string) {
    for (let index = raw.indexOf("{"); index >= 0; index = raw.indexOf("{", index + 1)) {
        try {
            const message = providerPayloadMessage(JSON.parse(raw.slice(index).trim()));
            if (message) return message;
        } catch {
            // 上游常把 JSON 拼在 HTTP 状态后；不是完整 JSON 时继续尝试下一个对象起点。
        }
    }
    return "";
}

function extractWrappedProviderMessage(raw: string) {
    const interfaceFailure = raw.match(/^接口请求失败[:：]\s*(.*)$/s);
    const requestFailure = raw.match(/^Request failed with status code \d{3}\s*[:：-]?\s*(.+)$/is);
    const wrapped = interfaceFailure?.[1] ?? requestFailure?.[1];
    if (!wrapped) return "";
    const message = wrapped.replace(/^\d{3}(?:\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error|Not Found|Unauthorized|Forbidden|Too Many Requests))?\s*[:：-]?\s*/i, "").trim();
    return message && !containsInfrastructureDetails(message) ? message : "";
}

function providerPayloadMessage(payload: unknown): string {
    if (typeof payload === "string") return payload.trim();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
    const record = payload as Record<string, unknown>;
    if (record.error && typeof record.error === "object") {
        const nested = providerPayloadMessage(record.error);
        if (nested) return nested;
    }
    for (const key of ["message", "msg", "detail"] as const) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return typeof record.error === "string" ? record.error.trim() : "";
}

function isNetworkFailure(value: string) {
    return /\b(?:dial tcp|connection refused|connection reset|no such host|i\/o timeout|context deadline exceeded|network error|failed to fetch|fetch failed|socket hang up|econnrefused|econnreset|etimedout)\b/i.test(value);
}

function hasHttpStatus(value: string, ...statuses: number[]) {
    return statuses.some((status) => new RegExp(`\\b${status}\\b`).test(value));
}

function containsInfrastructureDetails(value: string) {
    return /(?:接口请求失败|Request failed with status code|https?:\/\/|\b(?:GET|POST|PUT|PATCH|DELETE)\s+["']?|Bad Gateway|Service Unavailable|Gateway Timeout|upstream_error)/i.test(value);
}

function resourceStorageFailureMessage(value: string) {
    if (!value) return "";
    if (/\bUserDisable\b/i.test(value)) return "对象存储账号已停用，请检查或更换对象存储配置。";
    if (/(?:参考(?:图片|媒体)上传失败|OSS 上传失败|对象存储|腾讯云 COS|七牛云)/i.test(value)) {
        return "参考素材上传到对象存储失败，请检查对象存储配置后重试。";
    }
    return "";
}
