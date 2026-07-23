import type { CanvasGenerationBatch, CanvasGenerationBatchStatus } from "@/types/canvas";

const TASK_CAPACITY_MESSAGE = /同时排队或运行的任务最多 \d+ 个/;

export function isGenerationTaskCapacityError(error: unknown) {
    return error instanceof Error && TASK_CAPACITY_MESSAGE.test(error.message);
}

export function isGenerationCostUncertainError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /(?:^|\D)524(?:\D|$)|费用状态不确定|扣费状态不确定|可能已经产生费用/i.test(message);
}

export function generationBatchStatus(batch: CanvasGenerationBatch): CanvasGenerationBatchStatus {
    const statuses = batch.items.map((item) => item.status);
    if (statuses.length > 0 && statuses.every((status) => status === "succeeded")) return "completed";
    if (statuses.some((status) => status === "waiting" || status === "submitting" || status === "queued" || status === "running")) {
        return statuses.some((status) => status !== "waiting") ? "running" : "queued";
    }
    if (statuses.some((status) => status === "failed")) return "partial_failed";
    return "cancelled";
}
