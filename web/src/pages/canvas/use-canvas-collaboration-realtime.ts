import { useEffect, useRef, useState } from "react";

import { apiBaseURL } from "@/services/api/request";
import type { CanvasCollaborationOperationDelta } from "@/services/api/canvas-collaboration";

type CanvasCollaborationRealtimeMessage = {
    type?: string;
    canvasId?: string;
    revision?: number;
    actorId?: string;
    operation?: CanvasCollaborationOperationDelta;
};

export type CanvasCollaborationRealtimeStatus = "disabled" | "connecting" | "connected" | "reconnecting";

function collaborationWebSocketURL(canvasId: string) {
    const path = `/canvas-projects/${encodeURIComponent(canvasId)}/collaboration/ws`;
    const configured = String(apiBaseURL || "/api");
    if (/^https?:\/\//i.test(configured)) {
        const url = new URL(configured);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
        url.search = "";
        return url.toString();
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const prefix = configured.startsWith("/") ? configured.replace(/\/$/, "") : `/${configured.replace(/^\/+/, "").replace(/\/$/, "")}`;
    return `${protocol}//${window.location.host}${prefix}${path}`;
}

export function useCanvasCollaborationRealtime({ canvasId, enabled }: { canvasId: string; enabled: boolean }) {
    const [status, setStatus] = useState<CanvasCollaborationRealtimeStatus>(enabled ? "connecting" : "disabled");
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const retryRef = useRef(0);

    useEffect(() => {
        if (!enabled || !canvasId || typeof window === "undefined" || typeof WebSocket === "undefined") {
            setStatus("disabled");
            return;
        }
        let disposed = false;
        const connect = () => {
            if (disposed) return;
            setStatus(retryRef.current > 0 ? "reconnecting" : "connecting");
            const socket = new WebSocket(collaborationWebSocketURL(canvasId));
            socketRef.current = socket;
            socket.onopen = () => {
                if (disposed) return;
                retryRef.current = 0;
                setStatus("connected");
            };
            socket.onmessage = (event) => {
                if (disposed) return;
                let message: CanvasCollaborationRealtimeMessage;
                try {
                    message = JSON.parse(String(event.data)) as CanvasCollaborationRealtimeMessage;
                } catch {
                    return;
                }
                if (message.canvasId !== canvasId || (message.type !== "ready" && message.type !== "operation_applied" && message.type !== "resync")) return;
                // Apply committed deltas in place; the authenticated pull
                // repairs revision gaps, reconnects and restore operations.
                window.dispatchEvent(
                    new CustomEvent("canvas-collaboration-remote-operation", {
                        detail: { canvasId, revision: message.revision, actorId: message.actorId, type: message.type, operation: message.operation },
                    }),
                );
            };
            socket.onclose = () => {
                if (disposed) return;
                if (socketRef.current === socket) socketRef.current = null;
                const delay = Math.min(10_000, 300 * 2 ** Math.min(retryRef.current, 5));
                retryRef.current += 1;
                setStatus("reconnecting");
                reconnectTimerRef.current = window.setTimeout(connect, delay);
            };
            socket.onerror = () => {
                // onclose performs the backoff. Avoid a duplicate reconnect
                // timer here because browsers fire error and close together.
                socket.close();
            };
        };
        connect();
        return () => {
            disposed = true;
            if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
            const socket = socketRef.current;
            socketRef.current = null;
            if (socket) socket.close(1000, "画布已关闭");
            setStatus("disabled");
        };
    }, [canvasId, enabled]);

    return { status };
}
