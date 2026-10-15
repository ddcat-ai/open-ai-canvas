export const CONTENT_MODERATION_ERROR_CODE = "sensitive_words_detected";

export const CONTENT_MODERATION_MESSAGE = "内容审核未通过，本次平台积分未扣除或已退还。请修改提示词后重新生成。";

const UPSTREAM_LINK_PLACEHOLDER = "[链接已隐藏]";
const UPSTREAM_HOST_PLACEHOLDER = "[地址已隐藏]";
const UPSTREAM_URL_PATTERN = /https?:\/\/[^\s<>"'，。；）]+/gi;
const UPSTREAM_NETWORK_OPERATION_PATTERN = /\b(?:dial|read|write|proxyconnect)\s+tcp\s+\S+/gi;
const UPSTREAM_IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
const USER_VISIBLE_TASK_ID_PATTERN = /\btask[_-][a-z0-9][a-z0-9_-]{2,}\b/gi;

const DEFAULT_GENERATION_ERROR_MESSAGE = "生成失败，请稍后重试。";
const NETWORK_ERROR_MESSAGE = "网络异常。";
const MODEL_CAPABILITY_ERROR_MESSAGE = "所选模型不支持当前生成方式或输入，请切换模型或调整输入后重试。";
const MODEL_PARAMETER_ERROR_MESSAGE = "当前模型不支持这组参数或参考素材，请调整输入或切换模型后重试。";
const MODEL_SERVICE_ERROR_MESSAGE = "模型服务处理失败，请稍后重试或换用其他模型。";

const REASON_MESSAGES: Record<string, string> = {
    model_price_not_configured: "当前模型暂未配置价格，请换用其他模型或联系管理员。",
    model_route_unavailable: "当前模型暂时没有可用渠道，请稍后重试或换用其他模型。",
    provider_request_failed: MODEL_SERVICE_ERROR_MESSAGE,
    model_catalog_mismatch: "模型配置已更新，请重新选择模型后再试。",
    invalid_model_selection: "模型选择无效，请重新选择模型后再试。",
    quota_exceeded: "积分或额度不足，请充值后再试。",
    rate_limited: "请求过于频繁，请稍后再试。",
    timeout: "模型服务响应超时，请稍后再试。",
    bad_gateway: "模型服务暂时不可用，请稍后再试。",
    unavailable: "模型服务暂时不可用，请稍后再试。",
    upstream_dns_failed: "模型服务暂时不可用，请稍后再试。",
    unauthorized: "当前登录状态或权限不足，请重新登录后再试。",
    forbidden: "当前账号没有执行此操作的权限。",
    failed_precondition: "当前请求条件不满足，请检查输入或换用其他模型。",
    conflict: "请求状态已发生变化，请刷新后再试。",
    internal: "系统暂时无法完成生成，请稍后再试。",
};

// 用户可见文案（画布失败原因、积分流水备注）不能出现上游地址；
// 与后端 redactUpstreamAddress 保持同一套占位符。
export function redactUpstreamAddress(value: string) {
    if (!value.trim()) return value;
    return value
        .replace(UPSTREAM_URL_PATTERN, UPSTREAM_LINK_PLACEHOLDER)
        .replace(UPSTREAM_NETWORK_OPERATION_PATTERN, (match) => {
            const fields = match.split(/\s+/);
            return fields.length >= 2 ? `${fields[0]} ${fields[1]} ${UPSTREAM_HOST_PLACEHOLDER}:` : UPSTREAM_HOST_PLACEHOLDER;
        })
        .replace(UPSTREAM_IPV4_PATTERN, UPSTREAM_HOST_PLACEHOLDER);
}

export type GenerationFailureMetadata = {
    errorDetails: string;
    generationErrorCode?: string;
    failedPromptFingerprint?: string;
};

export function generationFailureMetadata(error: unknown, prompt: string): GenerationFailureMetadata {
    const raw = rawGenerationError(error);
    if (!isContentModerationError(raw)) return { errorDetails: generationErrorMessage(error) };
    return {
        errorDetails: generationErrorMessage(error),
        generationErrorCode: CONTENT_MODERATION_ERROR_CODE,
        failedPromptFingerprint: generationPromptFingerprint(prompt),
    };
}

export function generationErrorMessage(error: unknown) {
    const original = rawGenerationError(error);
    const upstreamIndex = original.indexOf("；上游：");
    if (upstreamIndex >= 0) {
        const prefix = original.slice(0, upstreamIndex).trim();
        if (isContentModerationError(prefix)) return CONTENT_MODERATION_MESSAGE;
        const hint = actionableUpstreamReason(original.slice(upstreamIndex + "；上游：".length));
        if (hint) return sanitizeUserVisibleError(prefix ? `${prefix}；${hint}` : hint);
    }
    const raw = sanitizeUserVisibleError(original);
    if (isContentModerationError(raw)) return contentModerationMessage(raw);

    const reason = structuredErrorReason(error);
    if (reason === "model_capability_not_supported") return MODEL_CAPABILITY_ERROR_MESSAGE;
    if (reason === "invalid_argument" && isModelCapabilityFailure(raw)) return MODEL_CAPABILITY_ERROR_MESSAGE;
    if (reason === "invalid_argument" && isModelParameterFailure(raw)) return MODEL_PARAMETER_ERROR_MESSAGE;
    if (reason && REASON_MESSAGES[reason]) return REASON_MESSAGES[reason];

    const providerMessage = extractStructuredProviderMessage(raw) || extractWrappedProviderMessage(raw);
    const displayMessage = providerMessage || raw;
    if (isContentModerationError(displayMessage)) return contentModerationMessage(displayMessage);
    const resourceStorageMessage = resourceStorageFailureMessage(raw) || resourceStorageFailureMessage(displayMessage);
    if (resourceStorageMessage) return resourceStorageMessage;
    if (isNetworkFailure(displayMessage)) return NETWORK_ERROR_MESSAGE;
    if (!providerMessage && !keepsProviderDetail(displayMessage)) {
        if (hasHttpStatus(raw, 429)) return "服务当前繁忙，请稍后重试。";
        if (hasHttpStatus(raw, 401, 403)) return "生成服务鉴权失败，请检查渠道配置。";
        if (hasHttpStatus(raw, 404)) return "生成服务地址不可用，请检查渠道配置。";
        if (hasHttpStatus(raw, 500, 502, 503, 504)) return NETWORK_ERROR_MESSAGE;
        if (containsInfrastructureDetails(raw)) return NETWORK_ERROR_MESSAGE;
    }
    if (isModelCapabilityFailure(displayMessage)) return MODEL_CAPABILITY_ERROR_MESSAGE;
    if (isModelParameterFailure(displayMessage)) return MODEL_PARAMETER_ERROR_MESSAGE;
    if (keepsProviderDetail(displayMessage)) return displayMessage;
    if (isTechnicalProviderMessage(displayMessage)) return MODEL_SERVICE_ERROR_MESSAGE;
    return displayMessage || DEFAULT_GENERATION_ERROR_MESSAGE;
}

function contentModerationMessage(raw: string) {
    return CONTENT_MODERATION_MESSAGE;
}

function sanitizeUserVisibleError(value: string) {
    const redacted = redactUpstreamAddress(value);
    const marker = "；上游：";
    const index = redacted.indexOf(marker);
    const prefix = index >= 0 ? redacted.slice(0, index) : redacted;
    const detail = index >= 0 ? redacted.slice(index + marker.length) : "";
    const actionable = actionableUpstreamReason(detail);
    const result = actionable ? `${prefix}${prefix ? "；" : ""}${actionable}` : prefix;
    return result.replace(USER_VISIBLE_TASK_ID_PATTERN, "[任务标识已隐藏]");
}

function actionableUpstreamReason(value: string) {
    const lower = value.toLowerCase();
    const image = lower.includes("image") || lower.includes("图片") || lower.includes("file") || lower.includes("参考图");
    const tooLarge = lower.includes("too large") || lower.includes("exceed") || lower.includes("超过") || lower.includes("25mb") || lower.includes("25 mb");
    if (image && tooLarge) return "参考图片超过模型支持的大小限制，请压缩图片后重试。";
    if (lower.includes("model_not_found") || lower.includes("model not found") || lower.includes("无可用渠道")) return "当前模型暂无可用渠道，请更换模型或联系管理员。";
    if (image && (lower.includes("unsupported size") || lower.includes("图片尺寸不支持") || lower.includes("unsupported format") || lower.includes("图片格式不支持"))) return "参考图片的尺寸或格式不符合模型要求，请调整图片后重试。";
    return "";
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

function structuredErrorReason(error: unknown): string | undefined {
    if (!error || typeof error !== "object") return undefined;
    const record = error as Record<string, unknown>;
    if (typeof record.reason === "string" && record.reason.trim()) return record.reason.trim().toLowerCase();
    if (record.cause && record.cause !== error) return structuredErrorReason(record.cause);
    return undefined;
}

function isModelCapabilityFailure(value: string) {
    return /所选模型不支持当前请求|模型不支持当前请求|不支持操作\s+|能力类型不匹配/i.test(value);
}

function isModelParameterFailure(value: string) {
    return /不支持参数|超出支持范围|数量需在|至少需要\s+\d+\s+个|暂时无法满足这组输入和参数/i.test(value);
}

function isTechnicalProviderMessage(value: string) {
    const text = value.trim();
    if (!text) return false;
    if (/(?:provider request failed|invalid_request_error|internal_server_error|bad_request|unauthorized|forbidden|not_found|upstream_error|request failed with status code|http\s*\d{3})/i.test(text)) return true;
    // 纯英文的 SDK/网关错误通常不是面向终端用户的说明；中文供应商原因仍允许展示。
    return !/[\u3400-\u9fff]/.test(text) && /^[\w .,:;_/'"()\-]+$/.test(text) && text.length > 18;
}

function keepsProviderDetail(value: string) {
    const marker = "；上游：";
    const index = value.indexOf(marker);
    if (index < 0) return false;
    const detail = value.slice(index + marker.length).trim();
    if (!detail || isNetworkFailure(detail) || containsInfrastructureDetails(detail)) return false;
    return !/\bHTTP\s*5\d{2}\b/i.test(detail);
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
