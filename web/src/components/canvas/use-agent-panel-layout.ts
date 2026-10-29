import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from "react";
import { AGENT_PANEL_LAYOUT_KEY, changeAgentPanelLayout, clampAgentPanelLayout, defaultAgentPanelLayout, restoreAgentPanelLayout, type AgentPanelGesture, type AgentPanelLayout } from "@/lib/canvas/agent-panel-layout";
import { AGENT_DOCK_DEFAULT_WIDTH, clampAgentDockWidth } from "@/lib/canvas/agent-panel-dock";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/** 停靠时只能拖左边缘调宽；浮动时可移动和从左上三个方向调整大小。 */
type PanelGesture = AgentPanelGesture | "dock";

export function useAgentPanelLayout(dock: { active: boolean; width: number } = { active: false, width: AGENT_DOCK_DEFAULT_WIDTH }) {
    const [compact, setCompact] = useState(() => window.innerWidth < 640);
    const [layout, setLayout] = useState(() => {
        try {
            return restoreAgentPanelLayout(localStorage.getItem(AGENT_PANEL_LAYOUT_KEY), viewport());
        } catch (error) {
            console.warn("Agent 窗口偏好无法读取", error);
            return restoreAgentPanelLayout(null, viewport());
        }
    });
    const setDockWidth = useGlobalAgentStore((state) => state.setDockWidth);
    const gestureRef = useRef<{ pointerId: number; kind: PanelGesture; x: number; y: number; start: AgentPanelLayout; dockWidth: number } | null>(null);

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
        const kind = resize?.dataset.agentResize as PanelGesture | undefined;
        if (dock.active) {
            if (kind !== "dock") return;
        } else {
            const header = target.closest("[data-agent-drag-handle]");
            if (kind === "dock" || (!resize && (!header || target.closest("button, input, textarea, a, [role=button]")))) return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = { pointerId: event.pointerId, kind: kind || "move", x: event.clientX, y: event.clientY, start: layout, dockWidth: dock.width };
    };
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        event.stopPropagation();
        if (gesture.kind === "dock") {
            // 面板贴在右侧：左边缘往左拖是变宽。
            setDockWidth(clampAgentDockWidth(gesture.dockWidth - (event.clientX - gesture.x), window.innerWidth));
            return;
        }
        setLayout(changeAgentPanelLayout(gesture.start, gesture.kind, event.clientX - gesture.x, event.clientY - gesture.y, viewport()));
    };
    const onPointerUp = (event: PointerEvent<HTMLElement>) => {
        if (gestureRef.current?.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onResizeKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        const kind = event.currentTarget.dataset.agentResize as PanelGesture;
        const delta = event.shiftKey ? 40 : 10;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (kind === "dock") {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") setDockWidth(clampAgentDockWidth(dock.width + (event.key === "ArrowLeft" ? delta : -delta), window.innerWidth));
            return;
        }
        setLayout((current) => changeAgentPanelLayout(current, kind, event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0, event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0, viewport()));
    };

    const style: CSSProperties = compact ? { left: 0, top: 8, width: "100%", height: "calc(100dvh - 8px)" } : dock.active ? { top: 0, right: 0, width: dock.width, height: "100dvh" } : layout;

    return {
        style,
        reset: () => (dock.active ? setDockWidth(AGENT_DOCK_DEFAULT_WIDTH) : setLayout(defaultAgentPanelLayout(viewport()))),
        onResizeKeyDown,
        pointerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onLostPointerCapture: () => { gestureRef.current = null; } },
    };
}
