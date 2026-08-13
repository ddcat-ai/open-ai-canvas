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

export function updateCreationConversationSnapshot<T extends { id: string }>(
    conversations: T[],
    conversationId: string,
    updater: (conversation: T) => T,
) {
    return conversations.map((conversation) => conversation.id === conversationId ? updater(conversation) : conversation);
}

export function pendingCreationMediaKey(conversations: StoredCreationConversation[]) {
    return conversations.flatMap((conversation) => conversation.messages.flatMap((message) => (
        message.role === "assistant" && message.status === "pending" && message.mode !== "text"
            ? [`${conversation.id}:${message.id}:${(message.taskIds || []).join(",")}`]
            : []
    ))).join("|");
}

export function pendingCreationTaskIds(conversations: StoredCreationConversation[]) {
    const taskIds = conversations.flatMap((conversation) => conversation.messages.flatMap((message) => {
        if (message.role !== "assistant" || message.status !== "pending" || message.mode === "text") return [];
        return message.taskIds || [];
    }));
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

export async function saveCreationConversations<T extends StoredCreationConversation>(conversations: T[]) {
    const storage = localForageStorageForScope(getActiveUserScope());
    await storage.setItem(CREATION_CONVERSATIONS_KEY, JSON.stringify(conversations));
}
