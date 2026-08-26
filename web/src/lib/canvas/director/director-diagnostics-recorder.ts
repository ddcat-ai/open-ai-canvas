import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

import { formatDirectorDiagnosticCode, projectDirectorDiagnostic, type DirectorDiagnosticCode, type DirectorDiagnosticFields } from "@/lib/canvas/director/director-diagnostics";

/**
 * 导演台故障事件的唯一记录入口。
 *
 * 复用统一的 client-diagnostics 缓冲区，绝不另建平行日志。
 * 只传固定 message 与安全 code/字段；stack 一律不填。
 */

/** 去重窗口：同一 code+字段组合在窗口内只记一次，避免高频路径灌满缓冲区。 */
const DEDUPE_WINDOW_MS = 1500;
const lastSeen = new Map<string, number>();

function now(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** 测试与页面重置用：清空去重状态。 */
export function resetDirectorDiagnosticDedupe(): void {
    lastSeen.clear();
}

/**
 * 记录一条导演台诊断事件。
 * 返回是否真的写入（未知 code 或命中去重窗口时返回 false），便于测试断言。
 */
export function recordDirectorDiagnostic(code: DirectorDiagnosticCode, fields: DirectorDiagnosticFields = {}): boolean {
    const event = projectDirectorDiagnostic(code, fields);
    if (!event) return false;

    const signature = formatDirectorDiagnosticCode(event);
    const timestamp = now();
    const previous = lastSeen.get(signature);
    if (previous !== undefined && timestamp - previous < DEDUPE_WINDOW_MS) return false;
    lastSeen.set(signature, timestamp);

    recordDiagnosticEvent({
        level: event.level,
        category: "runtime",
        // code 携带 scene/object/枚举后缀，便于在统一诊断流里检索而无需自由文本。
        // 不写 canvasId：DirectorScene.id 不是 canvas id，冒充会污染既有后端契约的语义。
        code: signature,
        message: event.message,
    });
    return true;
}
