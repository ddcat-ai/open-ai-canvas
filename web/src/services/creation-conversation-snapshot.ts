import type { StoredCreationConversation } from "@/services/creation-conversation-store";

export type CreationConversationSnapshot<T extends StoredCreationConversation> = { scope: string; conversations: T[] };

type TimestampedConversation = StoredCreationConversation & { updatedAt?: string };
let snapshot: CreationConversationSnapshot<TimestampedConversation> | null = null;
let navigation: { scope: string; activeId: string; canSelect: boolean } | null = null;
const listeners = new Set<() => void>();

export function subscribeCreationConversationSnapshot(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function notifySnapshot() {
    for (const listener of listeners) listener();
}

export function readCreationConversationNavigation(scope: string) {
    return navigation?.scope === scope ? navigation : null;
}

export function publishCreationConversationNavigation(scope: string, activeId: string, canSelect: boolean) {
    if (navigation?.scope === scope && navigation.activeId === activeId && navigation.canSelect === canSelect) return;
    navigation = { scope, activeId, canSelect };
    notifySnapshot();
}

export function clearCreationConversationNavigation(scope: string) {
    if (navigation?.scope !== scope) return;
    navigation = null;
    notifySnapshot();
}

export function readCreationConversationSnapshot<T extends StoredCreationConversation>(scope: string): T[] | null {
    return snapshot?.scope === scope ? (snapshot.conversations as T[]) : null;
}

export function writeCreationConversationSnapshot<T extends StoredCreationConversation>(scope: string, conversations: T[]) {
    snapshot = { scope, conversations: [...conversations] as TimestampedConversation[] };
    notifySnapshot();
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
    navigation = null;
    notifySnapshot();
}
