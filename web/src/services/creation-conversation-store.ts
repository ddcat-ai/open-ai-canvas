import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";

export const CREATION_CONVERSATIONS_KEY = "creation-conversations-v1";
export const CREATION_AGENT_PENDING_KEY = "creation-agent-pending-v1";
export type PendingCreationAgentSubmission = { sessionId: string; key: string; fingerprint: string; prompt: string; createdAt: string; request: import("@/services/api/agent").CreateAgentRunInput; parentRunId?: string };

export async function loadPendingCreationAgentSubmission(conversationId: string): Promise<PendingCreationAgentSubmission | null> {
    const value = await localForageStorageForScope(getActiveUserScope()).getItem(`${CREATION_AGENT_PENDING_KEY}:${conversationId}`);
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as PendingCreationAgentSubmission;
        if (!parsed.sessionId || !parsed.key || parsed.request?.idempotencyKey !== parsed.key || parsed.request.sessionId !== parsed.sessionId || parsed.request.surface !== "creation") throw new Error("invalid pending submission");
        return parsed;
    } catch { throw new Error("待确认的 Agent 请求记录已损坏；请先核对服务端运行记录，避免重复提交任务"); }
}

export async function savePendingCreationAgentSubmission(conversationId: string, pending: PendingCreationAgentSubmission) {
    await localForageStorageForScope(getActiveUserScope()).setItem(`${CREATION_AGENT_PENDING_KEY}:${conversationId}`, JSON.stringify(pending));
}

export async function clearPendingCreationAgentSubmission(conversationId: string, scope = getActiveUserScope()) {
    await localForageStorageForScope(scope).removeItem(`${CREATION_AGENT_PENDING_KEY}:${conversationId}`);
}

type PendingCreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: string;
    status?: string;
    taskIds?: string[];
};

export type StoredCreationConversation = {
    id: string;
    messages: PendingCreationMessage[];
};

export function updateCreationConversationSnapshot<T extends { id: string }>(conversations: T[], conversationId: string, updater: (conversation: T) => T) {
    return conversations.map((conversation) => (conversation.id === conversationId ? updater(conversation) : conversation));
}

// 对话、生成任务与素材是独立持久状态；删除历史记录不能在这里级联清理任务或资源。
export function removeCreationConversationSnapshot<T extends { id: string }>(conversations: T[], conversationId: string) {
    if (!conversationId) throw new Error("缺少要删除的创作对话 ID");
    const next = conversations.filter((conversation) => conversation.id !== conversationId);
    if (next.length === conversations.length) throw new Error("要删除的创作对话不存在");
    return next;
}

function isRecoverableCreationMessage(message: PendingCreationMessage) {
    if (message.role !== "assistant" || !message.taskIds?.length) return false;
    return message.mode === "text" ? message.status === "streaming" || message.status === "pending" : message.status === "pending";
}

export function pendingCreationTaskKey(conversations: StoredCreationConversation[]) {
    return conversations
        .flatMap((conversation) => conversation.messages.flatMap((message) => (isRecoverableCreationMessage(message) ? [`${conversation.id}:${message.id}:${(message.taskIds || []).join(",")}`] : [])))
        .join("|");
}

export function pendingCreationTaskIds(conversations: StoredCreationConversation[]) {
    const taskIds = conversations.flatMap((conversation) =>
        conversation.messages.flatMap((message) => {
            if (!isRecoverableCreationMessage(message)) return [];
            return message.taskIds || [];
        }),
    );
    return Array.from(new Set(taskIds));
}

export async function loadCreationConversations<T extends StoredCreationConversation>(scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    const value = await storage.getItem(CREATION_CONVERSATIONS_KEY);
    if (!value) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("创作对话持久状态无效");
    }
    if (!Array.isArray(parsed)) throw new Error("创作对话持久状态无效");
    return parsed as T[];
}

function persistableCreationConversations<T extends StoredCreationConversation>(conversations: T[]) {
    return conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => {
            const candidate = message as PendingCreationMessage & { resultUrls?: unknown; resultStorageKeys?: unknown };
            if (!Array.isArray(candidate.resultStorageKeys) || candidate.resultStorageKeys.length === 0) return message;
            const { resultUrls: _transientResultUrls, ...persistedMessage } = candidate;
            return persistedMessage as typeof message;
        }),
    })) as T[];
}

export async function saveCreationConversations<T extends StoredCreationConversation>(conversations: T[], scope = getActiveUserScope()) {
    const storage = localForageStorageForScope(scope);
    await storage.setItem(CREATION_CONVERSATIONS_KEY, JSON.stringify(persistableCreationConversations(conversations)));
}

// A server deletion may finish after logout. Clean its original cache without
// reading or replacing the newly signed-in account's in-memory conversations.
export async function removeStoredCreationConversation(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) throw new Error("缺少要删除的创作对话 ID");
    const stored = await loadCreationConversations(scope);
    if (stored?.some((conversation) => conversation.id === conversationId)) {
        await saveCreationConversations(removeCreationConversationSnapshot(stored, conversationId), scope);
    }
    await clearPendingCreationAgentSubmission(conversationId, scope);
}

export function queueCreationConversationsSave<T extends StoredCreationConversation>(previous: Promise<unknown>, conversations: T[], scope = getActiveUserScope()) {
    return previous.catch(() => undefined).then(() => saveCreationConversations(conversations, scope));
}
