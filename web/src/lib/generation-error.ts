export const CONTENT_MODERATION_ERROR_CODE = "sensitive_words_detected";

export const CONTENT_MODERATION_MESSAGE = "内容审核未通过，本次平台积分未扣除或已退还。请修改提示词后重新生成。";

const DEFAULT_GENERATION_ERROR_MESSAGE = "生成失败，请稍后重试。";
const NETWORK_ERROR_MESSAGE = "网络异常。";
const MODEL_SERVICE_ERROR_MESSAGE = "模型服务处理失败，请稍后重试或换用其他模型。";
const UPSTREAM_URL_PATTERN = /https?:\/\/[^\s<>"'，。；）]+/gi;
const UPSTREAM_NETWORK_OPERATION_PATTERN = /\b(?:dial|read|write|proxyconnect)\s+tcp\s+\S+/gi;
const UPSTREAM_IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
const USER_VISIBLE_TASK_ID_PATTERN = /\btask[_-][a-z0-9][a-z0-9_-]{2,}\b/gi;
const USER_VISIBLE_REQUEST_ID_PATTERN = /\b(?:request[_ -]?id|trace[_ -]?id)["']?\s*[:=]?\s*["']?[a-z0-9_-]{3,}["']?/gi;
const USER_VISIBLE_CREDENTIAL_PATTERN = /\b(?:bearer\s+\S+|(?:api[_-]?key|token|secret|authorization|cookie)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s，；。,}\]]+))/gi;
const USER_VISIBLE_REDACTION_PATTERN = /\[(?:链接|地址|凭据|请求标识|任务标识)已隐藏\]/g;
const REASON_MESSAGES: Record<string, string> = {
    model_capability_not_supported: "所选模型不支持当前生成方式或输入，请切换模型或调整输入后重试。",
    model_price_not_configured: "当前模型暂未配置价格，请换用其他模型或联系管理员。",
    model_route_unavailable: "当前模型暂时没有可用渠道，请稍后重试或换用其他模型。",
    model_catalog_mismatch: "模型配置已更新，请重新选择模型后再试。",
    invalid_model_selection: "模型选择无效，请重新选择模型后再试。",
    rate_limited: "请求过于频繁，请稍后再试。",
    timeout: "模型服务响应超时，请稍后再试。",
    bad_gateway: "模型服务暂时不可用，请稍后再试。",
    unavailable: "模型服务暂时不可用，请稍后再试。",
    upstream_dns_failed: "模型服务暂时不可用，请稍后再试。",
    provider_request_failed: MODEL_SERVICE_ERROR_MESSAGE,
    conflict: "请求状态已发生变化，请刷新后再试。",
    failed_precondition: "当前操作条件尚未满足，请检查任务状态后重试。",
    quota_exceeded: "当前账号额度不足，请调整用量或联系管理员。",
    forbidden: "当前账号没有执行此操作的权限。",
    internal: "系统暂时无法完成生成，请稍后再试。",
};

export type GenerationFailureMetadata = {
    errorDetails: string;
    generationErrorCode?: string;
    failedPromptFingerprint?: string;
};

export function generationFailureMetadata(error: unknown, prompt: string): GenerationFailureMetadata {
    if (!errorChain(error).some((value) => isContentModerationError(rawGenerationError(value)))) return { errorDetails: generationErrorMessage(error) };
    return {
        errorDetails: generationErrorMessage(error),
        generationErrorCode: CONTENT_MODERATION_ERROR_CODE,
        failedPromptFingerprint: generationPromptFingerprint(prompt),
    };
}

export function generationErrorMessage(error: unknown) {
    const raw = rawGenerationError(error);
    if (raw.includes("；上游：")) return sanitizeUserVisibleError(raw);
    return sanitizeUserVisibleError(classifyGenerationErrorMessage(error));
}

function classifyGenerationErrorMessage(error: unknown) {
    const raw = rawGenerationError(error);
    const details = errorChain(error).flatMap((value) => {
        const message = rawGenerationError(value);
        return [message, extractStructuredProviderMessage(message) || extractWrappedProviderMessage(message)];
    });
    const moderation = details.find(isContentModerationError);
    if (moderation) return contentModerationMessage(moderation);
    const storage = details.map(resourceStorageFailureMessage).find(Boolean);
    if (storage) return storage;

    const providerMessage = extractStructuredProviderMessage(raw) || extractWrappedProviderMessage(raw);
    const displayMessage = providerMessage || raw;
    if (isContentModerationError(displayMessage)) return contentModerationMessage(displayMessage);
    const resourceStorageMessage = resourceStorageFailureMessage(raw) || resourceStorageFailureMessage(displayMessage);
    if (resourceStorageMessage) return resourceStorageMessage;
    const actionableDetail = safeActionableDetail(error, displayMessage);
    if (actionableDetail) return actionableDetail;
    const reason = structuredErrorReason(error);
    if (reason && REASON_MESSAGES[reason]) {
        if (/[\u3400-\u9fff]/.test(displayMessage) && !containsInfrastructureDetails(displayMessage) && !isNetworkFailure(displayMessage) && !/\bHTTP\s*[45]\d\d\b/i.test(displayMessage)) return displayMessage;
        return REASON_MESSAGES[reason];
    }
    if (isNetworkFailure(displayMessage)) return NETWORK_ERROR_MESSAGE;
    if (!providerMessage) {
        if (!displayMessage.includes("；上游：")) {
            if (hasHttpStatus(raw, 429)) return "服务当前繁忙，请稍后重试。";
            if (hasHttpStatus(raw, 401, 403)) return "生成服务鉴权失败，请检查渠道配置。";
            if (hasHttpStatus(raw, 404)) return "生成服务地址不可用，请检查渠道配置。";
            if (hasHttpStatus(raw, 500, 502, 503, 504)) return NETWORK_ERROR_MESSAGE;
        }
        if (containsInfrastructureDetails(raw)) return NETWORK_ERROR_MESSAGE;
    }
    if (/所选模型不支持当前请求|模型不支持当前请求|不支持操作\s+|能力类型不匹配/i.test(displayMessage)) return REASON_MESSAGES.model_capability_not_supported;
    if (/不支持参数|超出支持范围|数量需在|至少需要\s+\d+\s+个|暂时无法满足这组输入和参数/i.test(displayMessage)) return "当前模型不支持这组参数或参考素材，请调整输入或切换模型后重试。";
    if (/\b(?:provider request failed|invalid_request_error|internal_server_error|bad_request|upstream_error)\b/i.test(displayMessage)) return MODEL_SERVICE_ERROR_MESSAGE;
    return displayMessage || DEFAULT_GENERATION_ERROR_MESSAGE;
}

export function redactUpstreamAddress(value: string) {
    return value
        .replace(UPSTREAM_URL_PATTERN, "[链接已隐藏]")
        .replace(UPSTREAM_NETWORK_OPERATION_PATTERN, (match) => {
            const fields = match.split(/\s+/);
            return `${fields[0]} ${fields[1]} [地址已隐藏]:`;
        })
        .replace(UPSTREAM_IPV4_PATTERN, "[地址已隐藏]");
}

function redactUserDiagnosticText(value: string) {
    return redactUpstreamAddress(value).replace(USER_VISIBLE_CREDENTIAL_PATTERN, "[凭据已隐藏]").replace(USER_VISIBLE_REQUEST_ID_PATTERN, "[请求标识已隐藏]").replace(USER_VISIBLE_TASK_ID_PATTERN, "[任务标识已隐藏]");
}

// 积分备注可能是普通业务文案；只脱敏，不把它按 HTTP 状态重新分类。
export function sanitizeUserVisibleError(value: string) {
    const marker = "；上游：";
    const index = value.indexOf(marker);
    if (index >= 0) {
        let prefix = value.slice(0, index).trim();
        if (isContentModerationError(prefix)) prefix = CONTENT_MODERATION_MESSAGE;
        const hint = actionableUpstreamReason(value.slice(index + marker.length));
        value = `${prefix}${prefix && hint ? "；" : ""}${hint}` || DEFAULT_GENERATION_ERROR_MESSAGE;
    }
    return redactUserDiagnosticText(value);
}

function actionableUpstreamReason(value: string) {
    const lower = value.toLowerCase();
    const image = /image|图片|file|参考图/.test(lower);
    if (/insufficient[_ ]quota|insufficient balance|quota exceeded|额度不足|余额不足/.test(lower)) return "模型服务额度不足，请更换模型或联系管理员。";
    if (/model_not_found|model not found|无可用渠道/.test(lower)) return "当前模型暂无可用渠道，请更换模型或联系管理员。";
    if (image && /too large|exceed|超过|25 ?mb/.test(lower)) return "参考图片超过模型支持的大小限制，请压缩图片后重试。";
    if (image && /unsupported size|unsupported format|图片尺寸不支持|图片格式不支持/.test(lower)) return "参考图片的尺寸或格式不符合模型要求，请调整图片后重试。";
    if (/content_policy_violation|content filter|safety system/.test(lower)) return "请求内容触发模型内容限制，请修改提示词或参考素材后重试。";
    const message = redactUserDiagnosticText(extractStructuredProviderMessage(value) || value).trim();
    const readable = message.replace(USER_VISIBLE_REDACTION_PATTERN, "");
    if (!/[\u3400-\u9fff]/.test(readable) || /[\r\n\x00{}]/.test(message) || containsInfrastructureDetails(message) || isNetworkFailure(message) || /stack trace|traceback|sql:|sqlite|postgres|\/var\/|\/tmp\//i.test(message)) return "";
    return Array.from(message).slice(0, 240).join("");
}

function errorChain(error: unknown): unknown[] {
    const chain: unknown[] = [];
    const seen = new Set<unknown>();
    let current = error;
    while (current && !seen.has(current) && chain.length < 10) {
        chain.push(current);
        seen.add(current);
        current = typeof current === "object" ? (current as Record<string, unknown>).cause : undefined;
    }
    return chain;
}

function structuredErrorReason(error: unknown): string | undefined {
    for (const value of errorChain(error)) {
        if (!value || typeof value !== "object") continue;
        const reason = (value as Record<string, unknown>).reason;
        if (typeof reason === "string" && reason.trim()) return reason.trim().toLowerCase();
    }
    return undefined;
}

function safeActionableDetail(error: unknown, displayMessage: string) {
    for (const raw of [displayMessage, ...errorChain(error).map(rawGenerationError)]) {
        const detail = extractStructuredProviderMessage(raw) || extractWrappedProviderMessage(raw) || raw;
        if (!/请(?:改为|更换为|调整|修改|选择|使用|切换|上传|降低|提高|提供)|格式不正确/.test(detail)) continue;
        const safe = detail
            .replace(/https?:\/\/[^\s<>"'，；。]+/gi, "[已隐藏地址]")
            .replace(/\b(?:Bearer\s+\S+|(?:api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s，；。]+)/gi, "[已隐藏凭据]")
            .trim();
        if (!containsInfrastructureDetails(safe) && !isNetworkFailure(safe)) return safe;
    }
    return "";
}

function contentModerationMessage(raw: string) {
    const detailIndex = raw.indexOf("；上游：");
    // 保留服务端过滤后的拒绝原因，同时保持平台审核的积分提示及重试保护。
    return detailIndex >= 0 && !containsInfrastructureDetails(raw) ? CONTENT_MODERATION_MESSAGE + raw.slice(detailIndex) : CONTENT_MODERATION_MESSAGE;
}

export function generationErrorCode(error: unknown) {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
        const code = (error as { code: string }).code;
        if (/^(?:model|provider|origin)_[a-z0-9_]{2,80}$/.test(code)) return code;
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
