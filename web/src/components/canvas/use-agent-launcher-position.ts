import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { AGENT_LAUNCHER_POSITION_KEY, clampAgentLauncherPosition, moveAgentLauncher, restoreAgentLauncherPosition, type AgentLauncherGesture, type AgentLauncherPosition } from "@/lib/canvas/agent-launcher-position";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

export function useAgentLauncherPosition(onOpen: () => void) {
    const [position, setPosition] = useState(() => {
        try {
            return restoreAgentLauncherPosition(localStorage.getItem(AGENT_LAUNCHER_POSITION_KEY), viewport());
        } catch (error) {
            console.warn("Agent 入口位置无法读取", error);
            return restoreAgentLauncherPosition(null, viewport());
        }
    });
    const [dragging, setDragging] = useState(false);
    const gestureRef = useRef<(AgentLauncherGesture & { pointerId: number }) | null>(null);
    const suppressClick = useRef(false);

    const save = (next: AgentLauncherPosition) => {
        try {
            localStorage.setItem(AGENT_LAUNCHER_POSITION_KEY, JSON.stringify(next));
        } catch (error) {
            console.warn("Agent 入口位置无法保存", error);
        }
    };

    useEffect(() => {
        const resize = () => setPosition((current) => clampAgentLauncherPosition(current, viewport()));
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);

    const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (event.button !== 0 || !event.isPrimary || gestureRef.current) return;
        suppressClick.current = false;
        gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: position, dragged: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const next = moveAgentLauncher(gesture, event.clientX, event.clientY, viewport());
        gesture.dragged = next.dragged;
        if (!next.dragged) return;
        event.preventDefault();
        suppressClick.current = true;
        setDragging(true);
        setPosition(next.position);
    };
    const finish = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
        event.stopPropagation();
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        const next = cancelled ? { dragged: gesture.dragged, position: clampAgentLauncherPosition(position, viewport()) } : moveAgentLauncher(gesture, event.clientX, event.clientY, viewport());
        suppressClick.current = cancelled || next.dragged;
        setDragging(false);
        setPosition(next.position);
        if (next.dragged) save(next.position);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const onClick = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        // Keyboard/assistive activation remains available after a drag or cancellation.
        if (event.detail !== 0 && suppressClick.current) {
            event.preventDefault();
            return;
        }
        onOpen();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const delta = event.shiftKey ? 40 : 10;
        const offsets: Record<string, [number, number]> = { ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        const next = clampAgentLauncherPosition({ right: position.right + offset[0], bottom: position.bottom + offset[1] }, viewport());
        setPosition(next);
        save(next);
    };

    return {
        position,
        dragging,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event, false),
            onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
            onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
            onClick,
            onKeyDown,
            onDoubleClick: (event: MouseEvent<HTMLButtonElement>) => event.stopPropagation(),
        },
    };
}
