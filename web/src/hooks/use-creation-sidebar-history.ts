import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";

import { getActiveUserScope } from "@/lib/user-scope";
import type { CreationConversation, CreationMode } from "@/pages/create/creation-types";
import { loadCreationConversations } from "@/services/creation-conversation-store";
import { readCreationConversationNavigation, readCreationConversationSnapshot, subscribeCreationConversationSnapshot, writeCreationConversationSnapshot } from "@/services/creation-conversation-snapshot";
import { useUserStore } from "@/stores/use-user-store";

export function useCreationSidebarHistory(userId: string) {
    const { pathname } = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const readSnapshot = useCallback(() => readCreationConversationSnapshot<CreationConversation>(userId), [userId]);
    const readNavigation = useCallback(() => readCreationConversationNavigation(userId), [userId]);
    const conversations = useSyncExternalStore(subscribeCreationConversationSnapshot, readSnapshot, readSnapshot);
    const navigation = useSyncExternalStore(subscribeCreationConversationSnapshot, readNavigation, readNavigation);
    const [attempt, setAttempt] = useState(0);
    const [failure, setFailure] = useState<{ userId: string; message: string } | null>(null);
    useEffect(() => {
        if (!hydrated || getActiveUserScope() !== userId) return;
        setFailure(null);
        if (readCreationConversationSnapshot(userId) !== null) return;
        let cancelled = false;
        void loadCreationConversations<CreationConversation>()
            .then((stored) => {
                if (cancelled || getActiveUserScope() !== userId) return;
                // 首页在等待期间可能已发布更新，不用迟到的磁盘快照覆盖它。
                if (readCreationConversationSnapshot(userId) === null) writeCreationConversationSnapshot(userId, stored || []);
            })
            .catch((error: unknown) => {
                if (!cancelled && getActiveUserScope() === userId) setFailure({ userId, message: error instanceof Error ? error.message : "读取创作对话失败" });
            });
        return () => {
            cancelled = true;
        };
    }, [userId, hydrated, attempt]);
    const items = useMemo(
        () =>
            (conversations || [])
                .filter((conversation) => conversation.messages.length > 0)
                .map((conversation) => {
                    let mode: CreationMode = "text";
                    for (let index = conversation.messages.length - 1; index >= 0; index--) {
                        const candidate = conversation.messages[index].mode;
                        if (candidate === "video" || candidate === "image" || candidate === "text") {
                            mode = candidate;
                            break;
                        }
                    }
                    return { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt, mode };
                })
                .sort((left, right) => (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0) || left.id.localeCompare(right.id)),
        [conversations],
    );
    const error = failure?.userId === userId ? failure.message : "";
    const home = pathname === "/" || pathname === "/create";
    return {
        items,
        loading: !hydrated || (conversations === null && !error),
        error,
        refetch: () => setAttempt((value) => value + 1),
        activeId: home ? navigation?.activeId || "" : "",
        canSelect: home ? Boolean(navigation?.canSelect) : true,
    };
}
