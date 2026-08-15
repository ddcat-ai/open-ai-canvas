import { dreaminaSubmitIdSchema } from "./dreamina-cli-contract.js";
import { DreaminaCliError } from "./dreamina-cli-process.js";

const PUBLIC_RUN_ERRORS = {
    dreamina_request_invalid: { message: "Dreamina 请求参数无效", statusCode: 400 },
    dreamina_idempotency_conflict: { message: "同一幂等键不能用于不同 Dreamina 请求", statusCode: 409 },
    dreamina_login_required: { message: "Dreamina CLI 需要先登录", statusCode: 401 },
    dreamina_missing: { message: "未检测到 Dreamina CLI", statusCode: 404 },
    dreamina_reference_invalid: { message: "Dreamina 参考素材无效或不受信任", statusCode: 400 },
    dreamina_reference_budget_exceeded: { message: "Dreamina 参考素材超出大小限制", statusCode: 413 },
    dreamina_generation_capacity_full: { message: "Dreamina 官方生成名额已满", statusCode: 409 },
    dreamina_submit_spawn_failed: { message: "无法启动 Dreamina CLI 提交进程", statusCode: 503 },
    dreamina_submission_unknown: {
        message: "Dreamina 提交结果不确定，已禁止自动重试；请按 receipt 查询或人工确认",
        statusCode: 409,
    },
} as const;

export type DreaminaPublicRunErrorCode = keyof typeof PUBLIC_RUN_ERRORS;

export function projectDreaminaPublicRuntimeResult(result: unknown) {
    const source = exactPlainJsonFields(result, ["state", "submitId"]);
    if (!source
        || source.state !== "accepted"
        || !dreaminaSubmitIdSchema.safeParse(source.submitId).success) throw submissionUnknown();
    return { state: "accepted" as const, receiptRecorded: true as const };
}

export function parseDreaminaPublicRuntimeResult(result: unknown) {
    const source = exactPlainJsonFields(result, ["state", "receiptRecorded"]);
    if (!source || source.state !== "accepted" || source.receiptRecorded !== true) throw submissionUnknown();
    return { state: "accepted" as const, receiptRecorded: true as const };
}

export function projectDreaminaPublicRunError(error: unknown) {
    if (error instanceof DreaminaCliError && error.code !== "dreamina_submission_unknown"
        && Object.hasOwn(PUBLIC_RUN_ERRORS, error.code)) {
        return dreaminaPublicRunError(error.code as DreaminaPublicRunErrorCode);
    }
    return submissionUnknown();
}

export function parseDreaminaPublicRunError(code: unknown, message: unknown) {
    if (typeof code !== "string" || !Object.hasOwn(PUBLIC_RUN_ERRORS, code)) return submissionUnknown();
    const projected = dreaminaPublicRunError(code as DreaminaPublicRunErrorCode);
    return message === projected.message ? projected : submissionUnknown();
}

function exactPlainJsonFields(value: unknown, expectedKeys: readonly string[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.length !== expectedKeys.length
        || ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) return undefined;
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
        fields[key] = descriptor.value;
    }
    return fields;
}

function dreaminaPublicRunError(code: DreaminaPublicRunErrorCode) {
    const definition = PUBLIC_RUN_ERRORS[code];
    return new DreaminaCliError(code, definition.message, definition.statusCode);
}

function submissionUnknown() {
    return dreaminaPublicRunError("dreamina_submission_unknown");
}
