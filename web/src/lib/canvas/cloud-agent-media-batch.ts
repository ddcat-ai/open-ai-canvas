/**
 * 批量生成进度：后端每次条目状态变化发一条 `media_batch_progress`。阶段切换时带全部条目，
 * 条目变化时只带变化的那几条（`delta`），这里把它们合并成一份完整进度供进度条渲染。
 */

export type CloudAgentMediaBatchItemStatus = "pending" | "submitted" | "succeeded" | "failed" | "cancelled";

export type CloudAgentMediaBatchItem = {
    index: number;
    nodeId: string;
    title?: string;
    status: CloudAgentMediaBatchItemStatus;
    error?: string;
    attempts?: number;
};

export type CloudAgentMediaBatchPhase = "approval" | "canary" | "canary_done" | "running" | "done";

export type CloudAgentMediaBatchProgress = {
    batchId: string;
    mode: string;
    phase: CloudAgentMediaBatchPhase;
    concurrency: number;
    total: number;
    items: CloudAgentMediaBatchItem[];
};

const ITEM_STATUSES = new Set<CloudAgentMediaBatchItemStatus>(["pending", "submitted", "succeeded", "failed", "cancelled"]);
const PHASES = new Set<CloudAgentMediaBatchPhase>(["approval", "canary", "canary_done", "running", "done"]);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseItem(value: unknown): CloudAgentMediaBatchItem | null {
    const item = record(value);
    const index = typeof item.index === "number" && Number.isInteger(item.index) && item.index >= 0 ? item.index : -1;
    const status = String(item.status || "") as CloudAgentMediaBatchItemStatus;
    if (index < 0 || typeof item.nodeId !== "string" || !item.nodeId || !ITEM_STATUSES.has(status)) return null;
    return {
        index,
        nodeId: item.nodeId,
        status,
        ...(typeof item.title === "string" && item.title ? { title: item.title } : {}),
        ...(typeof item.error === "string" && item.error ? { error: item.error } : {}),
        ...(typeof item.attempts === "number" && item.attempts > 0 ? { attempts: item.attempts } : {}),
    };
}

export function mergeAgentMediaBatchProgress(previous: CloudAgentMediaBatchProgress | undefined, payload: Record<string, unknown>): CloudAgentMediaBatchProgress | null {
    const batchId = typeof payload.batchId === "string" ? payload.batchId : "";
    if (!batchId) return null;
    const base = previous?.batchId === batchId ? previous : undefined;
    const phase = String(payload.phase || "") as CloudAgentMediaBatchPhase;
    const total = typeof payload.total === "number" && payload.total > 0 ? payload.total : base?.total || 0;
    const incoming = (Array.isArray(payload.items) ? payload.items : []).map(parseItem).filter((item): item is CloudAgentMediaBatchItem => Boolean(item));
    const byIndex = new Map<number, CloudAgentMediaBatchItem>();
    if (payload.delta === true && base) for (const item of base.items) byIndex.set(item.index, item);
    for (const item of incoming) byIndex.set(item.index, item);
    return {
        batchId,
        mode: typeof payload.mode === "string" ? payload.mode : base?.mode || "",
        phase: PHASES.has(phase) ? phase : base?.phase || "running",
        concurrency: typeof payload.concurrency === "number" ? payload.concurrency : base?.concurrency || 1,
        total,
        items: [...byIndex.values()].sort((left, right) => left.index - right.index),
    };
}

export function latestAgentMediaBatch(messages: readonly { mediaBatch?: CloudAgentMediaBatchProgress }[]): CloudAgentMediaBatchProgress | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const batch = messages[index].mediaBatch;
        if (batch) return batch;
    }
    return null;
}

export function agentMediaBatchCounts(batch: CloudAgentMediaBatchProgress) {
    const counts: Record<CloudAgentMediaBatchItemStatus, number> = { pending: 0, submitted: 0, succeeded: 0, failed: 0, cancelled: 0 };
    for (const item of batch.items) counts[item.status] += 1;
    // 增量合并前条目可能不全：没收到的条目都还在排队。
    counts.pending += Math.max(0, batch.total - batch.items.length);
    return counts;
}

export function agentMediaBatchPhaseLabel(phase: CloudAgentMediaBatchPhase) {
    return ({ approval: "等待批准", canary: "试跑中", canary_done: "试跑完成，等待放行", running: "执行中", done: "已结束" } as const)[phase];
}
