export type AgentCanvasUndoTarget = { runId: string; canvasId: string; stepId: string; expectedSnapshotHash: string };
export type AgentCanvasUndoState = { status: "pending" | "done" | "error"; error?: string };

const CANVAS_HASH = /^[a-f\d]{64}$/iu;
const FULL_CANVAS_HASH_TOOLS = new Set(["canvas_apply_ops", "canvas_arrange_nodes", "canvas_create_character", "previs_scene_create", "previs_apply_patch"]);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function agentCanvasUndoKey(target: Pick<AgentCanvasUndoTarget, "runId" | "stepId">): string {
    return `${target.runId}:${target.stepId}`;
}

/** The persisted server receipt is authoritative; node-scoped hashes cannot undo a canvas. */
export function agentCanvasUndoTarget(detail: unknown): AgentCanvasUndoTarget | null {
    const payload = record(detail);
    if (payload.undoStatus === "undone") return null;
    const receipt = record(payload.undo);
    if (Object.keys(receipt).length && (payload.eventType === "canvas_updated" || payload.eventType === "tool_completed")) {
        const { runId, canvasId, stepId, expectedSnapshotHash } = receipt;
        if (typeof runId === "string" && runId && typeof canvasId === "string" && canvasId && typeof stepId === "string" && stepId && stepId.length <= 160 && typeof expectedSnapshotHash === "string" && CANVAS_HASH.test(expectedSnapshotHash)) {
            return { runId, canvasId, stepId, expectedSnapshotHash };
        }
        return null;
    }
    if (payload.eventType !== "tool_completed" && payload.completionEventType !== "tool_completed") return null;
    const toolName = String(payload.toolName || payload.operation || "");
    const result = record(payload.result);
    const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
    const canvasId = typeof payload.canvasId === "string" ? payload.canvasId.trim() : "";
    const stepId = typeof payload.callId === "string" ? payload.callId.trim() : "";
    const hashValue = toolName === "previs_scene_create" || toolName === "previs_apply_patch" ? result.canvasSnapshotHash : result.snapshotHash;
    const expectedSnapshotHash = typeof hashValue === "string" ? hashValue.trim() : "";
    if (!FULL_CANVAS_HASH_TOOLS.has(toolName) || !runId || !canvasId || !stepId || stepId.length > 160 || !CANVAS_HASH.test(expectedSnapshotHash) || result.dryRun === true || result.committed === false) return null;
    return { runId, canvasId, stepId, expectedSnapshotHash };
}
