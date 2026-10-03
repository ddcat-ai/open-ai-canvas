import { createClientId } from "@/lib/client-id";
import { generationErrorMessage } from "@/lib/generation-error";
import type { BackendGenerationResult } from "@/services/api/generation-task";
import type { GenerationTask } from "@/services/api/task-center";
import { creationAttachmentKind, type CreationAttachment } from "./creation-assets";
import type { CreationConversation, CreationMessage, CreationMode, CreationShotRailEntry } from "./creation-types";
import { projectSmartCreationBatch } from "./smart-creation-runtime";

type CreationRuntime = typeof import("./creation-runtime");
export type PersistedCreationTask = GenerationTask & { creationResultUrls?: string[]; creationResultStorageKeys?: string[]; creationError?: string };

export function newConversation(): CreationConversation {
    return { id: createClientId(), title: "新创作", updatedAt: new Date().toISOString(), messages: [] };
}

export function creationConversationMode(conversation: CreationConversation): CreationMode {
    const selected = conversation.composerMode || (conversation.agentSessionId ? "agent" : conversation.messages.findLast((message) => message.role === "user")?.mode || conversation.messages.at(-1)?.mode);
    return selected === "image" || selected === "video" ? selected : "agent";
}

export function selectCreationConversationMode(conversation: CreationConversation, mode: CreationMode): CreationConversation {
    return { ...conversation, composerMode: mode === "text" ? "agent" : mode };
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
            const prompt = conversation.messages.slice(0, messageIndex).reverse().find((candidate) => candidate.role === "user")?.content || "";
            for (const [batchIndex, taskId] of message.taskIds.entries()) {
                const task = tasks.find((candidate) => candidate.id === taskId);
                contexts.set(taskId, {
                    prompt,
                    clientContext: {
                        conversationId: conversation.id,
                        messageId: message.id,
                        batchIndex,
                        batchCount: message.batchTotal || task?.clientContext?.batchCount || message.taskIds.length,
                    },
                });
            }
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

export function mergeCreationTaskObservations(observed: Map<string, PersistedCreationTask>, tasks: PersistedCreationTask[], pendingTaskIds: readonly string[]) {
    const pending = new Set(pendingTaskIds);
    for (const id of observed.keys()) if (!pending.has(id)) observed.delete(id);
    for (const task of tasks) if (pending.has(task.id)) observed.set(task.id, task);
    return Array.from(observed.values());
}

export function applyRecoveredCreationResult(message: CreationMessage, resultUrls: string[], resultStorageKeys: string[], batchCount: number) {
    const nextResultUrls = Array.from(new Set([...(message.resultUrls || []), ...resultUrls]));
    const nextStorageKeys = Array.from(new Set([...(message.resultStorageKeys || []), ...resultStorageKeys]));
    if (message.mode === "video") return { ...message, status: "done" as const, resultUrls: nextResultUrls, resultStorageKeys: nextStorageKeys };
    const projection = projectSmartCreationBatch({ total: message.batchTotal || batchCount, resultUrls: nextResultUrls, resultStorageKeys: nextStorageKeys, failedCount: message.batchFailedCount || 0 });
    return { ...message, ...projection };
}

export async function consumeCreationImageResult(runtime: CreationRuntime, task: GenerationTask, messageId: string, batchCount: number, updateMessage: (update: (message: CreationMessage) => CreationMessage) => Promise<unknown>, signal?: AbortSignal) {
    const materialized = await runtime.consumeGenerationTaskMessage(task, messageId, async ({ resultUrls, resultStorageKeys, effectKey }) => {
        await updateMessage((message) => runtime.applyGenerationConsumerEffect(message, effectKey, (current) => applyRecoveredCreationResult(current, resultUrls, resultStorageKeys, batchCount)).value);
    }, { signal });
    const url = runtime.generationTaskMaterializedUrls(materialized)[0] || "";
    const storageKey = runtime.generationTaskMaterializedStorageKeys(materialized)[0] || "";
    if (!url && !storageKey) throw new Error("图片结果资源不可用");
    return { url, storageKey };
}

export function projectCreationImageFailure(message: CreationMessage, batchTotal?: number) {
    if (batchTotal) return { ...message, ...projectSmartCreationBatch({ total: message.batchTotal || batchTotal, resultUrls: message.resultUrls || [], resultStorageKeys: message.resultStorageKeys || [], failedCount: (message.batchFailedCount || 0) + 1 }) };
    if (message.resultUrls?.length || message.resultStorageKeys?.length) return { ...message, status: "done" as const, content: "图片已生成" };
    return { ...message, status: "error" as const, content: "生成失败" };
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
            if (!matches.length) return message;

            const succeeded = matches.filter((task) => task.status === "succeeded");
            const resultUrls = Array.from(new Set([...(message.resultUrls || []), ...succeeded.flatMap(creationTaskResultUrls)]));
            const resultStorageKeys = Array.from(new Set([...(message.resultStorageKeys || []), ...succeeded.flatMap(creationTaskResultStorageKeys)]));
            const observedFailedCount = matches.filter((task) => ((task.status !== "succeeded" && task.status !== "queued" && task.status !== "running") || Boolean(task.creationError))).length;
            const failedCount = Math.max(message.batchFailedCount || 0, observedFailedCount);
            const total = message.batchTotal || expectedTaskCount || matches.length;
            const nextTaskIds = Array.from(new Set([...(message.taskIds || []), ...matches.map((task) => task.id)]));
            completedAt = matches.reduce((latest, task) => conversationTimestamp(task.updatedAt) > conversationTimestamp(latest) ? task.updatedAt : latest, completedAt);
            conversationChanged = true;
            changed = true;

            if (message.mode === "video") {
                if (resultUrls.length || resultStorageKeys.length) return { ...message, status: "done" as const, content: "视频已生成", resultUrls, resultStorageKeys, error: undefined, taskIds: nextTaskIds };
                if (matches.some((task) => task.status === "queued" || task.status === "running")) return { ...message, status: "pending" as const, taskIds: nextTaskIds };
            }
            if (matches.length >= total && matches.every((task) => task.status === "cancelled")) {
                return { ...message, status: "cancelled" as const, content: "已停止", error: undefined, taskIds: nextTaskIds };
            }
            const projection = projectSmartCreationBatch({
                total,
                resultUrls,
                resultStorageKeys,
                failedCount,
            });
            if (projection.status !== "error") {
                return { ...message, ...projection, error: undefined, taskIds: nextTaskIds };
            }
            const failed = matches.find((task) => task.status === "failed" || task.creationError);
            return { ...message, status: "error" as const, content: "生成失败", batchFailedCount: failedCount, error: generationErrorMessage(failed?.creationError || failed?.error || "任务已结束，但生成结果暂时无法读取"), taskIds: nextTaskIds };
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
