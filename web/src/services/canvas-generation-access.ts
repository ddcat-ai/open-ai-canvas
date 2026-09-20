import { ApiError } from "@/services/api/request";
import { queryGenerationTask } from "@/services/api/task-center";
import type { CanvasNodeData } from "@/types/canvas";

// Shared node metadata is visible to every member; task consumption, logs and
// asset side effects still belong to the account that created the task.
export async function readOwnCanvasTask(taskId: string, canvasId: string, signal?: AbortSignal, read = queryGenerationTask) {
    try {
        const task = await read(taskId, { signal });
        return task.projectId === canvasId ? task : null;
    } catch (error) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
        throw error;
    }
}

export function canvasRecoveryStillTargetsNode(expected: CanvasNodeData, current: CanvasNodeData | undefined, taskId: string) {
    if (!current || current.id !== expected.id || (current.metadata?.collaborationIncarnation ?? 1) !== (expected.metadata?.collaborationIncarnation ?? 1)) return false;
    const expectedTask = expected.metadata?.taskId || expected.metadata?.agentGenerationContinuation?.taskId;
    const currentTask = current.metadata?.taskId || current.metadata?.agentGenerationContinuation?.taskId;
    return currentTask === taskId || (!currentTask && !expectedTask);
}
