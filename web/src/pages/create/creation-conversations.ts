import { createClientId } from "@/lib/client-id";
import { generationErrorMessage } from "@/lib/generation-error";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { GenerationTask } from "@/services/api/task-center";
import { creationAttachmentKind, type CreationAttachment } from "./creation-assets";
import type { CreationConversation, CreationMessage, CreationShotRailEntry } from "./creation-types";

type CreationRuntime = typeof import("./creation-runtime");
type PersistedCreationTask = GenerationTask & { creationResultUrls?: string[]; creationResultStorageKeys?: string[]; creationError?: string };

export function newConversation(): CreationConversation {
    return { id: createClientId(), title: "新创作", updatedAt: new Date().toISOString(), messages: [] };
}

export function newMessage(role: CreationMessage["role"], content: string, extra: Partial<CreationMessage> = {}): CreationMessage {
    return { id: createClientId(), role, content, createdAt: new Date().toISOString(), ...extra };
}

export function creationShotRail(messages: CreationMessage[]): CreationShotRailEntry[] {
    const rail: CreationShotRailEntry[] = [];
    let ordinal = 0;
    let lastIndex = -1;
    for (const message of messages) {
        const isVideo = (message.mode || "text") === "video";
        if (message.role === "user") {
            if (!isVideo) continue;
            ordinal += 1;
            rail.push({ key: message.id, ordinal, user: message });
            lastIndex = rail.length - 1;
        } else if (isVideo && lastIndex >= 0 && !rail[lastIndex].result) {
            rail[lastIndex].result = message;
        }
    }
    return rail;
}

export function creationVideoShotOrdinal(shots: CreationShotRailEntry[], item: CreationMessage): number {
    const own = shots.find((entry) => item.role === "user" ? entry.user.id === item.id : entry.result?.id === item.id);
    return own?.ordinal || 0;
}

export function completedCreationGenerationTask(runtime: CreationRuntime, input: { taskId: string; task?: GenerationTask; mode: "image" | "video"; prompt: string; result: BackendGenerationResult; conversationId: string; messageId: string; batchIndex?: number; batchCount?: number }): GenerationTask {
    const now = new Date().toISOString();
    const task = input.task ?? { id: input.taskId, type: input.mode, status: "succeeded" as const, prompt: input.prompt, attempts: 1, createdAt: now, updatedAt: now };
    return runtime.projectGenerationTaskResult({ ...task, status: "succeeded", prompt: input.prompt, clientContext: { conversationId: input.conversationId, messageId: input.messageId, ...(typeof input.batchIndex === "number" ? { batchIndex: input.batchIndex } : {}), ...(typeof input.batchCount === "number" ? { batchCount: input.batchCount } : {}) } }, input.result);
}

export function isVideoAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { url: string } {
    return creationAttachmentKind(attachment) === "video";
}

export function isImageAttachment(attachment: CreationAttachment): attachment is CreationAttachment & { dataUrl: string; width?: number; height?: number } {
    return creationAttachmentKind(attachment) === "image";
}


export function attachCreationTaskContexts(tasks: GenerationTask[], conversations: CreationConversation[]) {
    const contexts = new Map<string, { prompt: string; clientContext: NonNullable<GenerationTask["clientContext"]> }>();
    for (const conversation of conversations) {
        for (const [messageIndex, message] of conversation.messages.entries()) {
            if (message.role !== "assistant" || !message.taskIds?.length) continue;
            const prompt = conversation.messages[messageIndex - 1]?.role === "user" ? conversation.messages[messageIndex - 1].content : "";
            for (const [batchIndex, taskId] of message.taskIds.entries()) contexts.set(taskId, { prompt, clientContext: { conversationId: conversation.id, messageId: message.id, batchIndex, batchCount: message.taskIds.length } });
        }
    }
    return tasks.map((task) => {
        const context = contexts.get(task.id);
        return context ? { ...task, prompt: context.prompt, clientContext: context.clientContext } : task;
    });
}

export async function materializeCreationTaskResults(runtime: CreationRuntime, tasks: GenerationTask[], signal?: AbortSignal): Promise<PersistedCreationTask[]> {
    return Promise.all(tasks.map(async (task): Promise<PersistedCreationTask> => {
        // 文本正文保存在 resultJson，不进入媒体资源化链路。
        if (task.status !== "succeeded" || !task.clientContext || task.type === "canvas_text") return task;
        try {
            const materialized = await runtime.runGenerationConsumer(signal, (managedSignal: AbortSignal) => runtime.materializeGenerationTaskAssets(task, managedSignal));
            const creationResultUrls = runtime.generationTaskMaterializedUrls(materialized);
            const creationResultStorageKeys = runtime.generationTaskMaterializedStorageKeys(materialized);
            return creationResultUrls.length || creationResultStorageKeys.length ? { ...materialized, ...(creationResultUrls.length ? { creationResultUrls } : {}), ...(creationResultStorageKeys.length ? { creationResultStorageKeys } : {}) } : materialized;
        } catch (error) {
            return { ...task, creationError: error instanceof Error ? error.message : "生成结果资源化失败" };
        }
    }));
}

export function reconcileCreationTaskMessages(runtime: CreationRuntime, conversations: CreationConversation[], tasks: PersistedCreationTask[]) {
    let changed = false;
    const next = conversations.map((conversation) => {
        let conversationChanged = false;
        let completedAt = conversation.updatedAt;
        const messages = conversation.messages.map((message) => {
            const taskIds = new Set(message.taskIds || []);
            const matches = tasks
                .filter((task) => taskIds.has(task.id) || (task.clientContext?.conversationId === conversation.id && task.clientContext.messageId === message.id))
                .sort((left, right) => (left.clientContext?.batchIndex || 0) - (right.clientContext?.batchIndex || 0));
            if (message.role === "assistant" && message.mode === "text") {
                const recovery = runtime.recoverCreationTextTask(message, matches);
                if (!recovery) return message;
                completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
                conversationChanged = true;
                changed = true;
                return { ...message, ...recovery };
            }
            if (message.role !== "assistant" || message.status !== "pending") return message;
            const expectedTaskCount = Math.max(0, ...matches.map((task) => task.clientContext?.batchCount || 0));
            if (!matches.length || (expectedTaskCount > 0 && matches.length < expectedTaskCount) || matches.some((task) => task.status === "queued" || task.status === "running")) return message;

            const succeeded = matches.filter((task) => task.status === "succeeded");
            const resultUrls = Array.from(new Set(succeeded.flatMap(creationTaskResultUrls)));
            const resultStorageKeys = Array.from(new Set(succeeded.flatMap(creationTaskResultStorageKeys)));
            const failedCount = matches.filter((task) => task.status !== "succeeded" || Boolean(task.creationError)).length;
            const nextTaskIds = Array.from(new Set([...(message.taskIds || []), ...matches.map((task) => task.id)]));
            completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
            conversationChanged = true;
            changed = true;

            if (resultUrls.length || resultStorageKeys.length) {
                const content = message.mode === "video" ? "视频已生成" : failedCount ? `${resultStorageKeys.length || resultUrls.length} 张图片已生成，${failedCount} 张失败` : "图片已生成";
                return { ...message, status: "done" as const, content, ...(resultUrls.length ? { resultUrls } : {}), ...(resultStorageKeys.length ? { resultStorageKeys } : {}), error: undefined, taskIds: nextTaskIds };
            }
            if (matches.every((task) => task.status === "cancelled")) {
                return { ...message, status: "cancelled" as const, content: "已停止", error: undefined, taskIds: nextTaskIds };
            }
            const failed = matches.find((task) => task.status === "failed" || task.creationError);
            return { ...message, status: "error" as const, content: "生成失败", error: generationErrorMessage(failed?.creationError || failed?.error || "任务已结束，但生成结果暂时无法读取"), taskIds: nextTaskIds };
        });
        return conversationChanged ? { ...conversation, messages, updatedAt: completedAt } : conversation;
    });
    return changed ? next : conversations;
}

function creationTaskResultUrls(task: PersistedCreationTask) {
    if (task.creationResultUrls?.length) return task.creationResultUrls;
    return [];
}

function creationTaskResultStorageKeys(task: PersistedCreationTask) {
    if (task.creationResultStorageKeys?.length) return task.creationResultStorageKeys;
    return [];
}

export function conversationTimestamp(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}
