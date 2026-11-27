import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { AGENT_LAUNCHER_POSITION_KEY, clampAgentLauncherPosition, moveAgentLauncher, restoreAgentLauncherPosition, type AgentLauncherGesture, type AgentLauncherPosition } from "@/lib/canvas/agent-launcher-position";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * 入口的拖拽、点击与键盘移动。指针处理器（onPointer*）可以挂在入口按钮上，也可以挂在按钮内的身体热区上
 * （大形象外框不接收指针）；指针捕获落在挂处理器的元素上，因此该元素必须能被命中。
 */
export function useAgentLauncherPosition(onOpen: () => void, width = 76, height = 76, inCanvasEditor = true, minRight = 0) {
    const size = { width, height };
    const preference = useRef<string | null>(null);
    const [position, setPosition] = useState(() => {
        try {
            preference.current = localStorage.getItem(AGENT_LAUNCHER_POSITION_KEY);
        } catch (error) {
            console.warn("Agent 入口位置无法读取", error);
        }
        return restoreAgentLauncherPosition(preference.current, viewport(), size, inCanvasEditor);
    });
    const shown = position.right < minRight ? clampAgentLauncherPosition({ ...position, right: minRight }, viewport(), size) : position;
    const [dragging, setDragging] = useState(false);
    const gestureRef = useRef<(AgentLauncherGesture & { pointerId: number }) | null>(null);
    const suppressClick = useRef(false);

    const save = (next: AgentLauncherPosition) => {
        preference.current = JSON.stringify(next);
        try {
            localStorage.setItem(AGENT_LAUNCHER_POSITION_KEY, preference.current);
        } catch (error) {
            console.warn("Agent 入口位置无法保存", error);
        }
    };

    useEffect(() => {
        const resize = () => setPosition((current) => (gestureRef.current ? clampAgentLauncherPosition(current, viewport(), size) : restoreAgentLauncherPosition(preference.current, viewport(), size, inCanvasEditor)));
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, [width, height, inCanvasEditor]);

    const onPointerDown = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        if (event.button !== 0 || !event.isPrimary || gestureRef.current) return;
        suppressClick.current = false;
        gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: shown, dragged: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const next = moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size);
        gesture.dragged = next.dragged;
        if (!next.dragged) return;
        event.preventDefault();
        suppressClick.current = true;
        setDragging(true);
        setPosition(next.position);
    };
    const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        const next = cancelled ? { dragged: gesture.dragged, position: clampAgentLauncherPosition(position, viewport(), size) } : moveAgentLauncher(gesture, event.clientX, event.clientY, viewport(), size);
        suppressClick.current = cancelled || next.dragged;
        setDragging(false);
        if (next.dragged || cancelled) setPosition(next.position);
        if (next.dragged) save(next.position);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onClick = (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        // Keyboard/assistive activation remains available after a drag or cancellation.
        if (event.detail !== 0 && suppressClick.current) {
            event.preventDefault();
            return;
        }
        onOpen();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        event.stopPropagation();
        const delta = event.shiftKey ? 40 : 10;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const next = clampAgentLauncherPosition({ right: shown.right + offset[0], bottom: shown.bottom + offset[1] }, viewport(), size);
        setPosition(next);
        save(next);
    };

    return {
        position: shown,
        dragging,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
            onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
            onClick,
            onKeyDown,
            onDoubleClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
        },
    };
}
