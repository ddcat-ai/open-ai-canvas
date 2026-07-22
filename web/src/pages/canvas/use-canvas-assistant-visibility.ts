import { useCallback, useEffect, useRef, useState } from "react";

import { CANVAS_AGENT_PANEL_MOTION_MS } from "@/components/canvas/canvas-assistant-panel";
import type { CanvasAgentMode } from "@/components/canvas/canvas-agent-chat-ui";

export function useCanvasAssistantVisibility() {
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [assistantCollapsed, setAssistantCollapsed] = useState(true);
    const [assistantMounted, setAssistantMounted] = useState(false);
    const [assistantClosing, setAssistantClosing] = useState(false);
    const [agentMode, setAgentMode] = useState<CanvasAgentMode>("online");

    const openAgent = useCallback((mode?: CanvasAgentMode) => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        if (mode) setAgentMode(mode);
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
            setAssistantMounted(false);
            setAssistantClosing(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    }, [assistantClosing, assistantMounted]);

    useEffect(() => () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    return {
        agentMode,
        assistantClosing,
        assistantMounted,
        assistantOpen: assistantMounted && !assistantCollapsed,
        closeAgent,
        openAgent,
        setAgentMode,
    };
}
