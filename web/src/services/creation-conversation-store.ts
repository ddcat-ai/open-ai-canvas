import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";

export const CREATION_CONVERSATIONS_KEY = "creation-conversations-v1";

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
    if (message.mode === "text") return message.status === "streaming" || message.status === "pending";
    // 媒体消息的前端等待可能先于后端结束（例如长视频），消息被判失败但任务其实已经成功。
    // 失败态一并纳入恢复：任务确实失败时收敛结果不变，任务成功时把结果补回消息。
    return message.status === "pending" || message.status === "error";
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

export async function loadCreationConversations<T extends StoredCreationConversation>() {
    const storage = localForageStorageForScope(getActiveUserScope());
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

export async function saveCreationConversations<T extends StoredCreationConversation>(conversations: T[]) {
    const storage = localForageStorageForScope(getActiveUserScope());
    await storage.setItem(CREATION_CONVERSATIONS_KEY, JSON.stringify(persistableCreationConversations(conversations)));
}
