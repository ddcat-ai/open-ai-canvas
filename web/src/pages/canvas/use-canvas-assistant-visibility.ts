import { useCallback, useEffect, useRef, useState } from "react";

import { CANVAS_AGENT_PANEL_MOTION_MS } from "@/components/canvas/canvas-assistant-panel";

export function useCanvasAssistantVisibility() {
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [assistantCollapsed, setAssistantCollapsed] = useState(false);
    const [assistantMounted, setAssistantMounted] = useState(true);
    const [assistantClosing, setAssistantClosing] = useState(false);
    const assistantOpen = assistantMounted && !assistantCollapsed;
    const openAgent = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setAssistantMounted(true);
        setAssistantClosing(false);
        setAssistantCollapsed(false);
    }, []);

    const closeAgent = useCallback(() => {
        if (!assistantMounted || assistantClosing) return;
        setAssistantCollapsed(true);
        setAssistantClosing(true);
        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            setAssistantClosing(false);
            setAssistantMounted(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    }, [assistantClosing, assistantMounted]);

    useEffect(() => () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    useEffect(() => {
        if (!assistantOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest(".ant-modal-wrap, .ant-dropdown, .ant-popover, .ant-select-dropdown")) return;
            closeAgent();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [assistantOpen, closeAgent]);

    useEffect(() => {
        if (assistantOpen) return;
        const trigger = document.querySelector<HTMLElement>("[data-agent-toggle]");
        if (trigger && document.activeElement === document.body) trigger.focus();
    }, [assistantOpen]);

    return {
        assistantClosing,
        assistantMounted,
        assistantOpen,
        closeAgent,
        openAgent,
    };
}
