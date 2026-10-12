/**
 * 预演台诊断领域：稳定白名单 code + 安全结构化字段。
 * 调用边界只接收受限枚举、布尔、有限数值和 safe-id，不透传业务正文、URL、凭证或错误栈。
 */

export const PREVIS_DIAGNOSTIC_CODES = [
    "PREVIS_VIEWPORT_RENDER_FAILED",
    "PREVIS_VIEWPORT_CONTEXT_LOST",
    "PREVIS_VIEWPORT_CONTEXT_RESTORED",
    "PREVIS_MODEL_LOAD_FAILED",
    "PREVIS_MODEL_LOAD_RETRY",
    "PREVIS_MODEL_ADOPT_FAILED",
    "PREVIS_SAVE_FLUSH_FAILED",
    "PREVIS_CLOSE_BLOCKED",
] as const;

export type PrevisDiagnosticCode = (typeof PREVIS_DIAGNOSTIC_CODES)[number];
const CODE_SET: ReadonlySet<string> = new Set(PREVIS_DIAGNOSTIC_CODES);

const MESSAGES: Record<PrevisDiagnosticCode, string> = {
    PREVIS_VIEWPORT_RENDER_FAILED: "预演台 3D 视口渲染失败",
    PREVIS_VIEWPORT_CONTEXT_LOST: "预演台 WebGL 上下文丢失",
    PREVIS_VIEWPORT_CONTEXT_RESTORED: "预演台 WebGL 上下文已恢复",
    PREVIS_MODEL_LOAD_FAILED: "预演台 3D 模型加载失败",
    PREVIS_MODEL_LOAD_RETRY: "预演台 3D 模型重试加载",
    PREVIS_MODEL_ADOPT_FAILED: "预演台 3D 模型采纳失败",
    PREVIS_SAVE_FLUSH_FAILED: "预演台场景保存失败",
    PREVIS_CLOSE_BLOCKED: "预演台关闭被阻止",
};

const LEVELS: Record<PrevisDiagnosticCode, "info" | "warning" | "error"> = {
    PREVIS_VIEWPORT_RENDER_FAILED: "error",
    PREVIS_VIEWPORT_CONTEXT_LOST: "warning",
    PREVIS_VIEWPORT_CONTEXT_RESTORED: "info",
    PREVIS_MODEL_LOAD_FAILED: "warning",
    PREVIS_MODEL_LOAD_RETRY: "info",
    PREVIS_MODEL_ADOPT_FAILED: "error",
    PREVIS_SAVE_FLUSH_FAILED: "error",
    PREVIS_CLOSE_BLOCKED: "warning",
};

export const PREVIS_OBJECT_KINDS = ["actor", "model", "billboard", "primitive", "unknown"] as const;
export type PrevisDiagnosticObjectKind = (typeof PREVIS_OBJECT_KINDS)[number];
const OBJECT_KIND_SET: ReadonlySet<string> = new Set(PREVIS_OBJECT_KINDS);

export const PREVIS_SAVE_OUTCOMES = ["close", "stay"] as const;
export type PrevisDiagnosticSaveOutcome = (typeof PREVIS_SAVE_OUTCOMES)[number];
const SAVE_OUTCOME_SET: ReadonlySet<string> = new Set(PREVIS_SAVE_OUTCOMES);

export type PrevisDiagnosticFields = {
    objectId?: string;
    sceneId?: string;
    objectKind?: PrevisDiagnosticObjectKind;
    saveOutcome?: PrevisDiagnosticSaveOutcome;
    attempt?: number;
    revision?: number;
    userInitiated?: boolean;
};

export type PrevisDiagnosticEvent = {
    code: PrevisDiagnosticCode;
    level: "info" | "warning" | "error";
    message: string;
    fields: PrevisDiagnosticFields;
};

const SAFE_ID = /^[A-Za-z0-9._:-]{1,96}$/;

export function isPrevisDiagnosticCode(value: unknown): value is PrevisDiagnosticCode {
    return typeof value === "string" && CODE_SET.has(value);
}

function safePrevisId(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return SAFE_ID.test(trimmed) ? trimmed : undefined;
}

function boundedInteger(value: unknown, min: number, max: number): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    if (rounded < min || rounded > max) return undefined;
    return rounded;
}

export function projectPrevisDiagnostic(code: unknown, fields: unknown): PrevisDiagnosticEvent | null {
    if (!isPrevisDiagnosticCode(code)) return null;
    const source: Record<string, unknown> = fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};
    const safe: PrevisDiagnosticFields = {};

    const objectId = safePrevisId(source.objectId);
    if (objectId) safe.objectId = objectId;
    const sceneId = safePrevisId(source.sceneId);
    if (sceneId) safe.sceneId = sceneId;
    if (typeof source.objectKind === "string" && OBJECT_KIND_SET.has(source.objectKind)) safe.objectKind = source.objectKind as PrevisDiagnosticObjectKind;
    if (typeof source.saveOutcome === "string" && SAVE_OUTCOME_SET.has(source.saveOutcome)) safe.saveOutcome = source.saveOutcome as PrevisDiagnosticSaveOutcome;

    const attempt = boundedInteger(source.attempt, 0, 999);
    if (attempt !== undefined) safe.attempt = attempt;
    const revision = boundedInteger(source.revision, 0, Number.MAX_SAFE_INTEGER);
    if (revision !== undefined) safe.revision = revision;
    if (typeof source.userInitiated === "boolean") safe.userInitiated = source.userInitiated;

    return { code, level: LEVELS[code], message: MESSAGES[code], fields: safe };
}

export function formatPrevisDiagnosticCode(event: PrevisDiagnosticEvent): string {
    const parts: string[] = [event.code];
    if (event.fields.sceneId) parts.push("scene=" + event.fields.sceneId);
    if (event.fields.objectId) parts.push("object=" + event.fields.objectId);
    if (event.fields.objectKind) parts.push("kind=" + event.fields.objectKind);
    if (event.fields.saveOutcome) parts.push("outcome=" + event.fields.saveOutcome);
    if (event.fields.attempt !== undefined) parts.push("attempt=" + event.fields.attempt);
    if (event.fields.revision !== undefined) parts.push("revision=" + event.fields.revision);
    if (event.fields.userInitiated !== undefined) parts.push("user=" + (event.fields.userInitiated ? "1" : "0"));
    return parts.join(" ");
}

export function previsDiagnosticObjectKind(object: { kind?: string; primitive?: string } | null | undefined): PrevisDiagnosticObjectKind {
    if (!object) return "unknown";
    if (object.kind === "actor") return "actor";
    if (object.kind === "model") return "model";
    if (object.kind === "billboard") return "billboard";
    if (typeof object.primitive === "string" && object.primitive) return "primitive";
    return "unknown";
}
