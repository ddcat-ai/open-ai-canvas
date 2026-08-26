/**
 * 导演台诊断领域：稳定白名单 code + 安全结构化字段。
 *
 * 调用边界的硬约束（安全边界，不是风格偏好）：
 * - 绝不接收 Error / stack / componentStack / URL / Cookie / Authorization / token / 密钥；
 * - 绝不接收 scene 名称、素材正文、prompt 等业务文本；
 * - message 只能来自本模块的固定常量表，调用方不能自带文案；
 * - 字段只允许「白名单枚举 | 布尔 | 有限数值 | 通过 safe-id 校验的 id」；
 * - 未知 code 与未知字段一律丢弃，不透传。
 */

/** 故障与恢复代码白名单。新增代码必须同时补 message 与测试。 */
export const DIRECTOR_DIAGNOSTIC_CODES = [
    "DIRECTOR_VIEWPORT_RENDER_FAILED",
    "DIRECTOR_VIEWPORT_CONTEXT_LOST",
    "DIRECTOR_VIEWPORT_CONTEXT_RESTORED",
    "DIRECTOR_MODEL_LOAD_FAILED",
    "DIRECTOR_MODEL_LOAD_RETRY",
    "DIRECTOR_MODEL_ADOPT_FAILED",
    "DIRECTOR_SAVE_FLUSH_FAILED",
    "DIRECTOR_SAVE_RETRY_FAILED",
    "DIRECTOR_SAVE_RETRY_RECOVERED",
    "DIRECTOR_SAVE_DRAFT_UNAVAILABLE",
    "DIRECTOR_CLOSE_BLOCKED",
] as const;

export type DirectorDiagnosticCode = (typeof DIRECTOR_DIAGNOSTIC_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(DIRECTOR_DIAGNOSTIC_CODES);

/** 固定文案：调用方不得传入任意字符串，避免业务正文经 message 泄漏。 */
const MESSAGES: Record<DirectorDiagnosticCode, string> = {
    DIRECTOR_VIEWPORT_RENDER_FAILED: "导演台 3D 视口渲染失败",
    DIRECTOR_VIEWPORT_CONTEXT_LOST: "导演台 WebGL 上下文丢失",
    DIRECTOR_VIEWPORT_CONTEXT_RESTORED: "导演台 WebGL 上下文已恢复",
    DIRECTOR_MODEL_LOAD_FAILED: "导演台 3D 模型加载失败",
    DIRECTOR_MODEL_LOAD_RETRY: "导演台 3D 模型重试加载",
    DIRECTOR_MODEL_ADOPT_FAILED: "导演台 3D 模型采纳失败",
    DIRECTOR_SAVE_FLUSH_FAILED: "导演台场景保存失败",
    DIRECTOR_SAVE_RETRY_FAILED: "导演台场景重试保存仍失败",
    DIRECTOR_SAVE_RETRY_RECOVERED: "导演台场景重试保存成功",
    DIRECTOR_SAVE_DRAFT_UNAVAILABLE: "导演台本地草稿不可用",
    DIRECTOR_CLOSE_BLOCKED: "导演台关闭被阻止",
};

const LEVELS: Record<DirectorDiagnosticCode, "info" | "warning" | "error"> = {
    DIRECTOR_VIEWPORT_RENDER_FAILED: "error",
    DIRECTOR_VIEWPORT_CONTEXT_LOST: "warning",
    DIRECTOR_VIEWPORT_CONTEXT_RESTORED: "info",
    DIRECTOR_MODEL_LOAD_FAILED: "warning",
    DIRECTOR_MODEL_LOAD_RETRY: "info",
    DIRECTOR_MODEL_ADOPT_FAILED: "error",
    DIRECTOR_SAVE_FLUSH_FAILED: "error",
    DIRECTOR_SAVE_RETRY_FAILED: "error",
    DIRECTOR_SAVE_RETRY_RECOVERED: "info",
    DIRECTOR_SAVE_DRAFT_UNAVAILABLE: "error",
    DIRECTOR_CLOSE_BLOCKED: "warning",
};

/** 对象种类枚举：只表达形态，绝不表达名称或素材来源。 */
export const DIRECTOR_OBJECT_KINDS = ["actor", "model", "billboard", "primitive", "unknown"] as const;
export type DirectorDiagnosticObjectKind = (typeof DIRECTOR_OBJECT_KINDS)[number];
const OBJECT_KIND_SET: ReadonlySet<string> = new Set(DIRECTOR_OBJECT_KINDS);

/** 保存决策枚举：与 coordinator 的关闭决策同构，但不携带任何场景内容。 */
export const DIRECTOR_SAVE_OUTCOMES = ["close", "offer-draft-exit", "stay"] as const;
export type DirectorDiagnosticSaveOutcome = (typeof DIRECTOR_SAVE_OUTCOMES)[number];
const SAVE_OUTCOME_SET: ReadonlySet<string> = new Set(DIRECTOR_SAVE_OUTCOMES);

/**
 * 允许的结构化字段。全部可选，且每个字段都有独立的校验规则。
 * 这里故意不提供任何自由文本字段。
 */
export type DirectorDiagnosticFields = {
    /** 对象 id：safe-id 校验；不通过则丢弃。 */
    objectId?: string;
    /** 场景 id：safe-id 校验。绝不接收 scene 名称。 */
    sceneId?: string;
    objectKind?: DirectorDiagnosticObjectKind;
    saveOutcome?: DirectorDiagnosticSaveOutcome;
    /** 加载/保存重试次数。 */
    attempt?: number;
    /** 修订号。 */
    revision?: number;
    /** 本地草稿是否可用。 */
    draftStored?: boolean;
    /** 是否由用户显式触发（区分自动重试与手动重试）。 */
    userInitiated?: boolean;
};

export type DirectorDiagnosticEvent = {
    code: DirectorDiagnosticCode;
    level: "info" | "warning" | "error";
    message: string;
    fields: DirectorDiagnosticFields;
};

const SAFE_ID = /^[A-Za-z0-9._:-]{1,96}$/;

export function isDirectorDiagnosticCode(value: unknown): value is DirectorDiagnosticCode {
    return typeof value === "string" && CODE_SET.has(value);
}

/** id 白名单校验：任何含 URL、query、路径分隔、空格、凭证形态的输入都不合法。 */
function safeDirectorId(value: unknown): string | undefined {
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

/**
 * 纯投影：把任意输入收敛成安全事件。未知 code 返回 null，调用方据此丢弃。
 * 未知字段、非法 id、越界数值、非布尔值一律不出现在输出里。
 */
export function projectDirectorDiagnostic(code: unknown, fields: unknown): DirectorDiagnosticEvent | null {
    if (!isDirectorDiagnosticCode(code)) return null;

    const source: Record<string, unknown> = fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};
    const safe: DirectorDiagnosticFields = {};

    const objectId = safeDirectorId(source.objectId);
    if (objectId) safe.objectId = objectId;

    const sceneId = safeDirectorId(source.sceneId);
    if (sceneId) safe.sceneId = sceneId;

    if (typeof source.objectKind === "string" && OBJECT_KIND_SET.has(source.objectKind)) {
        safe.objectKind = source.objectKind as DirectorDiagnosticObjectKind;
    }
    if (typeof source.saveOutcome === "string" && SAVE_OUTCOME_SET.has(source.saveOutcome)) {
        safe.saveOutcome = source.saveOutcome as DirectorDiagnosticSaveOutcome;
    }

    const attempt = boundedInteger(source.attempt, 0, 999);
    if (attempt !== undefined) safe.attempt = attempt;

    const revision = boundedInteger(source.revision, 0, Number.MAX_SAFE_INTEGER);
    if (revision !== undefined) safe.revision = revision;

    if (typeof source.draftStored === "boolean") safe.draftStored = source.draftStored;
    if (typeof source.userInitiated === "boolean") safe.userInitiated = source.userInitiated;

    return { code, level: LEVELS[code], message: MESSAGES[code], fields: safe };
}

/**
 * 把安全字段压成 code 后缀，便于在统一诊断流里检索而无需自由文本。
 *
 * scene/object 走 safe-id 投影后的值（非法 id 在投影阶段已被丢弃，不会到这里），
 * 因此后缀里只可能出现受限字符集。完整签名同时用于去重：
 * 不同 objectId / sceneId 必须是不同事件，不能在去重窗口内互相吞掉。
 */
export function formatDirectorDiagnosticCode(event: DirectorDiagnosticEvent): string {
    const parts: string[] = [event.code];
    if (event.fields.sceneId) parts.push("scene=" + event.fields.sceneId);
    if (event.fields.objectId) parts.push("object=" + event.fields.objectId);
    if (event.fields.objectKind) parts.push("kind=" + event.fields.objectKind);
    if (event.fields.saveOutcome) parts.push("outcome=" + event.fields.saveOutcome);
    if (event.fields.attempt !== undefined) parts.push("attempt=" + event.fields.attempt);
    if (event.fields.revision !== undefined) parts.push("revision=" + event.fields.revision);
    if (event.fields.draftStored !== undefined) parts.push("draft=" + (event.fields.draftStored ? "1" : "0"));
    if (event.fields.userInitiated !== undefined) parts.push("user=" + (event.fields.userInitiated ? "1" : "0"));
    return parts.join(" ");
}

/** 从 DirectorObject 的形态推导枚举，不读取 name / url / storageKey。 */
export function directorDiagnosticObjectKind(object: { kind?: string; primitive?: string } | null | undefined): DirectorDiagnosticObjectKind {
    if (!object) return "unknown";
    if (object.kind === "actor") return "actor";
    if (object.kind === "model") return "model";
    if (object.kind === "billboard") return "billboard";
    if (typeof object.primitive === "string" && object.primitive) return "primitive";
    return "unknown";
}
