import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";
import { batchOutputResultPending } from "@/lib/canvas/canvas-batch-references";

/** 上游成功不能把旧提取图或尚未验收的去背景结果标成完成。 */
export function canvasTaskBindingStatus(node: CanvasNodeData, task: Pick<GenerationTask, "id" | "status">): CanvasNodeMetadata["status"] {
    const extraction = node.metadata?.layerExtraction;
    if (task.status === "failed" || task.status === "cancelled" || extraction?.rejectedTaskId === task.id) return "error";
    if (batchOutputResultPending(node.metadata)) return "loading";
    if (task.status === "succeeded" && Boolean(node.metadata?.content || node.metadata?.storageKey)) {
        if (!extraction || (extraction.phase === "complete" && node.metadata?.taskId === task.id)) return "success";
        if (extraction.phase === "background-removal-required" && extraction.extractionTaskId === task.id) return "idle";
    }
    return "loading";
}

/**
 * 节点显示失败，但后端任务并没有被确认失败：页面轮询中断时最后一次看到的任务仍在排队或生成，
 * 或任务已成功、只是结果回写失败。这类节点只需重新获取原任务结果，不能引导用户重新付费生成。
 */
export function canvasNodeCanResyncTask(metadata: CanvasNodeMetadata | undefined) {
    if (metadata?.status !== "error" || !metadata.taskId || metadata.isBatchRoot) return false;
    if (metadata.taskStage === "submission_unknown" || metadata.layerExtraction?.rejectedTaskId === metadata.taskId) return false;
    if (metadata.resourceReloadAvailable) return true;
    return metadata.taskStatus === "queued" || metadata.taskStatus === "running";
}

/** 查询/消费异常不是任务终态。只标记恢复诊断，不覆盖成功结果或新的任务绑定。 */
export function markCanvasTaskRecoveryUnconfirmed(node: CanvasNodeData, expectedTaskId: string | undefined, detail: string): CanvasNodeData {
    if (node.metadata?.status === "success" || node.metadata?.taskId !== expectedTaskId) return node;
    return { ...node, metadata: { ...node.metadata, errorDetails: detail } };
}

/** 只有完整任务查询确认未提交的素材准备节点，才能解除刷新后遗留的提交锁。 */
export function recoverCanvasPreparationWithoutTask(node: CanvasNodeData, expectedCreatedAt: string | undefined, taskDiscoveryComplete: boolean): CanvasNodeData {
    const metadata = node.metadata;
    if (!taskDiscoveryComplete || !expectedCreatedAt || metadata?.taskCreatedAt !== expectedCreatedAt || metadata.status !== "loading" || metadata.taskStage !== "正在准备参考素材") return node;
    if (metadata.taskId || metadata.taskClientOperationId || metadata.agentGenerationContinuation?.taskId || metadata.isBatchRoot || metadata.content) return node;
    return {
        ...node,
        metadata: {
            ...resetGenerationTaskMetadata(metadata, "error"),
            errorDetails: "任务准备已中断，未找到已提交的生成任务；请检查模型和参考素材后重新生成。",
        },
    };
}

// 失败节点再次提交前必须移除旧任务绑定，否则批次调度会把它误判为仍在处理。
export function resetGenerationTaskMetadata(metadata: CanvasNodeMetadata | undefined, status: CanvasNodeMetadata["status"] = "idle"): CanvasNodeMetadata {
    const next = {
        ...(metadata || {}),
        status,
        errorDetails: undefined,
        generationErrorCode: undefined,
        resourceReloadAvailable: undefined,
        failedPromptFingerprint: undefined,
    };
    delete next.taskId;
    delete next.taskClientOperationId;
    delete next.retryOf;
    delete next.attemptGroupId;
    delete next.taskStatus;
    delete next.taskProgress;
    delete next.taskStage;
    delete next.taskMediaStage;
    delete next.taskCanRecoverMedia;
    delete next.taskProvider;
    delete next.taskStartedAt;
    delete next.taskCompletedAt;
    delete next.taskDurationMs;
    delete next.taskErrorCode;
    delete next.taskOfficialStatus;
    delete next.taskReceiptRecorded;
    delete next.taskCreatedAt;
    delete next.taskUpdatedAt;
    delete next.generationOutputCount;
    return next;
}
