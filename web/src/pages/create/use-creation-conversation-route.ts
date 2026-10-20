import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

export function useCreationConversationRoute(ready: boolean, userId: string | undefined, open: (id: string, signal: AbortSignal) => Promise<void>, deletedIds?: ReadonlySet<string>) {
    const { conversationId } = useParams<{ conversationId: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const openRef = useRef(open);
    openRef.current = open;
    const localNavigation = useRef<string | undefined>(undefined);
    const [resolution, setResolution] = useState({ key: "", error: "" });
    const key = `${userId || ""}:${location.key}`;
    const unavailable = Boolean(conversationId && deletedIds?.has(conversationId));

    useEffect(() => {
        if (!ready || !conversationId || unavailable) return;
        if (localNavigation.current === conversationId) {
            localNavigation.current = undefined;
            setResolution({ key, error: "" });
            return;
        }
        const controller = new AbortController();
        void openRef
            .current(conversationId, controller.signal)
            .then(() => {
                if (!controller.signal.aborted) setResolution({ key, error: "" });
            })
            .catch((error) => {
                if (!controller.signal.aborted) setResolution({ key, error: error instanceof Error ? error.message : "会话无法打开" });
            });
        return () => controller.abort();
    }, [ready, conversationId, key, unavailable]);

    const show = useCallback(
        (id: string, replace = false) => {
            const path = `/c/${encodeURIComponent(id)}`;
            if (location.pathname === path) return;
            localNavigation.current = id;
            void navigate(path, { replace });
        },
        [location.pathname, navigate],
    );

    return {
        conversationId,
        loading: Boolean(conversationId && !unavailable && (!ready || resolution.key !== key)),
        error: unavailable ? "会话已删除或已超过保留期限" : conversationId && resolution.key === key ? resolution.error : "",
        show,
    };
}
