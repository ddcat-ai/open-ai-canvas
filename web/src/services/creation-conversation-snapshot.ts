import type { StoredCreationConversation } from "@/services/creation-conversation-store";

export type CreationConversationSnapshot<T extends StoredCreationConversation> = { scope: string; conversations: T[] };

type TimestampedConversation = StoredCreationConversation & { updatedAt?: string };
let snapshot: CreationConversationSnapshot<TimestampedConversation> | null = null;

export function readCreationConversationSnapshot<T extends StoredCreationConversation>(scope: string): T[] | null {
    return snapshot?.scope === scope ? (snapshot.conversations as T[]) : null;
}

export function writeCreationConversationSnapshot<T extends StoredCreationConversation>(scope: string, conversations: T[]) {
    snapshot = { scope, conversations: [...conversations] as TimestampedConversation[] };
}

export function mergeCreationConversationSnapshot<T extends TimestampedConversation>(cached: T[], persisted: T[]) {
    const merged = new Map<string, T>();
    for (const conversation of persisted) merged.set(conversation.id, conversation);
    for (const conversation of cached) {
        const stored = merged.get(conversation.id);
        const cachedAt = Date.parse(conversation.updatedAt || "");
        const storedAt = Date.parse(stored?.updatedAt || "");
        if (!stored || !Number.isFinite(storedAt) || (Number.isFinite(cachedAt) && cachedAt >= storedAt)) merged.set(conversation.id, conversation);
    }
    return [...merged.values()].sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
}

export function clearCreationConversationSnapshot() {
    snapshot = null;
}
