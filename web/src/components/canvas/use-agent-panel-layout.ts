import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { AGENT_PANEL_LAYOUT_KEY, changeAgentPanelLayout, clampAgentPanelLayout, defaultAgentPanelLayout, restoreAgentPanelLayout, type AgentPanelGesture, type AgentPanelLayout } from "@/lib/canvas/agent-panel-layout";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

export function useAgentPanelLayout() {
    const [compact, setCompact] = useState(() => window.innerWidth < 640);
    const [layout, setLayout] = useState(() => {
        try {
            return restoreAgentPanelLayout(localStorage.getItem(AGENT_PANEL_LAYOUT_KEY), viewport());
        } catch (error) {
            console.warn("Agent 窗口偏好无法读取", error);
            return restoreAgentPanelLayout(null, viewport());
        }
    });
    const gestureRef = useRef<{ pointerId: number; kind: AgentPanelGesture; x: number; y: number; start: AgentPanelLayout } | null>(null);

    useEffect(() => {
        const resize = () => {
            setCompact(window.innerWidth < 640);
            if (window.innerWidth >= 640) setLayout((current) => clampAgentPanelLayout(current, viewport()));
        };
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);

    useEffect(() => {
        if (compact) return;
        const timer = window.setTimeout(() => {
            try {
                localStorage.setItem(AGENT_PANEL_LAYOUT_KEY, JSON.stringify(layout));
            } catch (error) {
                console.warn("Agent 窗口偏好无法保存", error);
            }
        }, 120);
        return () => window.clearTimeout(timer);
    }, [compact, layout]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        if (compact || event.button !== 0 || !event.isPrimary) return;
        const target = event.target as HTMLElement;
        const resize = target.closest<HTMLElement>("[data-agent-resize]");
        const header = target.closest("[data-agent-drag-handle]");
        if (!resize && (!header || target.closest("button, input, textarea, a, [role=button]"))) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = { pointerId: event.pointerId, kind: (resize?.dataset.agentResize as AgentPanelGesture) || "move", x: event.clientX, y: event.clientY, start: layout };
    };
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        event.stopPropagation();
        setLayout(changeAgentPanelLayout(gesture.start, gesture.kind, event.clientX - gesture.x, event.clientY - gesture.y, viewport()));
    };
    const onPointerUp = (event: PointerEvent<HTMLElement>) => {
        if (gestureRef.current?.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onResizeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const kind = event.currentTarget.dataset.agentResize as AgentPanelGesture;
        const delta = event.shiftKey ? 40 : 10;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        setLayout((current) => changeAgentPanelLayout(current, kind, event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0, event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0, viewport()));
    };

    return {
        style: compact ? { left: 0, top: 8, width: "100%", height: "calc(100dvh - 8px)" } : layout,
        reset: () => setLayout(defaultAgentPanelLayout(viewport())),
        onResizeKeyDown,
        pointerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onLostPointerCapture: () => { gestureRef.current = null; } },
    };
}
