import { useCallback, useEffect, useRef, useState } from "react";

import { readAgentNotificationPermission, requestAgentBrowserNotificationPermission, shouldSendAgentBrowserNotification, showAgentBrowserNotification, type AgentAttention, type AgentNotificationHandle } from "@/services/agent-browser-notifications";

function currentVisibilityState(): DocumentVisibilityState {
    return typeof document === "undefined" ? "visible" : document.visibilityState;
}

export function agentAttentionFromPending({ approval, question, conversationId }: { approval?: { approvalId: string } | null; question?: { questionId?: string; question: string; round?: number } | null; conversationId: string }): AgentAttention | null {
    if (approval) return { key: `approval:${approval.approvalId}`, kind: "approval" };
    if (!question) return null;
    const questionKey = question.questionId || `${conversationId}:${question.round ?? 0}:${question.question}`;
    return { key: `question:${questionKey}`, kind: "question" };
}

export function useAgentAttentionNotifications({ attention, enabled, panelOpen, onOpen }: { attention: AgentAttention | null; enabled: boolean; panelOpen: boolean; onOpen: () => void }) {
    const [permission, setPermission] = useState(readAgentNotificationPermission);
    const [visibilityState, setVisibilityState] = useState(currentVisibilityState);
    const [requesting, setRequesting] = useState(false);
    const attentionRef = useRef(attention);
    const enabledRef = useRef(enabled);
    const panelOpenRef = useRef(panelOpen);
    const onOpenRef = useRef(onOpen);
    const requestingRef = useRef(false);
    const mountedRef = useRef(true);
    const deliveredKeysRef = useRef(new Set<string>());
    const activeNotificationRef = useRef<{ key: string; handle: AgentNotificationHandle } | null>(null);

    attentionRef.current = attention;
    enabledRef.current = enabled;
    panelOpenRef.current = panelOpen;
    onOpenRef.current = onOpen;

    const closeActiveNotification = useCallback((exceptKey?: string) => {
        const active = activeNotificationRef.current;
        if (!active || active.key === exceptKey) return;
        active.handle.close();
        activeNotificationRef.current = null;
    }, []);

    const deliverCurrentAttention = useCallback(
        (nextPermission = readAgentNotificationPermission(), nextVisibilityState = currentVisibilityState()) => {
            const current = attentionRef.current;
            if (!mountedRef.current || !enabledRef.current || !current) return;
            if (!shouldSendAgentBrowserNotification({ permission: nextPermission, panelOpen: panelOpenRef.current, visibilityState: nextVisibilityState })) {
                const active = activeNotificationRef.current;
                if (active?.key === current.key) {
                    active.handle.close();
                    activeNotificationRef.current = null;
                }
                return;
            }
            if (deliveredKeysRef.current.has(current.key)) return;

            let handle: AgentNotificationHandle | null = null;
            handle = showAgentBrowserNotification(current, () => {
                if (handle && activeNotificationRef.current?.handle === handle) activeNotificationRef.current = null;
                onOpenRef.current();
            });
            if (!handle) return;

            closeActiveNotification(current.key);
            deliveredKeysRef.current.add(current.key);
            activeNotificationRef.current = { key: current.key, handle };
        },
        [closeActiveNotification],
    );

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            closeActiveNotification();
        };
    }, [closeActiveNotification]);

    useEffect(() => {
        const synchronizeBrowserState = () => {
            setPermission(readAgentNotificationPermission());
            setVisibilityState(currentVisibilityState());
        };
        window.addEventListener("focus", synchronizeBrowserState);
        document.addEventListener("visibilitychange", synchronizeBrowserState);
        return () => {
            window.removeEventListener("focus", synchronizeBrowserState);
            document.removeEventListener("visibilitychange", synchronizeBrowserState);
        };
    }, []);

    useEffect(() => {
        if (!enabled || !attention) {
            closeActiveNotification();
            return;
        }
        closeActiveNotification(attention.key);
        deliverCurrentAttention(permission, visibilityState);
    }, [attention, deliverCurrentAttention, enabled, permission, visibilityState, panelOpen, closeActiveNotification]);

    const requestPermission = useCallback(async () => {
        if (!enabledRef.current || requestingRef.current) return;
        requestingRef.current = true;
        setRequesting(true);
        try {
            const nextPermission = await requestAgentBrowserNotificationPermission();
            const nextVisibilityState = currentVisibilityState();
            if (mountedRef.current) {
                setPermission(nextPermission);
                setVisibilityState(nextVisibilityState);
            }
            if (nextPermission === "granted" && mountedRef.current) deliverCurrentAttention(nextPermission, nextVisibilityState);
        } finally {
            requestingRef.current = false;
            if (mountedRef.current) setRequesting(false);
        }
    }, [deliverCurrentAttention]);

    return {
        permission,
        requesting,
        showGuide: enabled && Boolean(attention) && permission !== "granted",
        requestPermission,
    };
}
