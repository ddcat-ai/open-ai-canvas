import { workspaceApiPath } from "@/lib/workspace-routes";

export type PresencePoint = { x: number; y: number };
export type PresenceNode = PresencePoint & { id: string; width: number; height: number };
export type CanvasPresence = { id: string; number: number; cursor: PresencePoint | null; drag: PresenceNode[] | null; updatedAt: number };
export type CanvasRealtimeSnapshot = { connected: boolean; selfId: string | null; peers: CanvasPresence[] };
export type CanvasRealtimeEvent = "connection" | "presence" | "invalidate";
type Listener = (snapshot: CanvasRealtimeSnapshot, event: CanvasRealtimeEvent) => void;
type Timer = ReturnType<typeof setTimeout>;

export function canvasRealtimeURL(apiBase: string, canvasId: string, pageURL: string) {
    const url = new URL(`${apiBase.replace(/\/+$/, "")}${workspaceApiPath(`/canvas-projects/${encodeURIComponent(canvasId)}/realtime`)}`, pageURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
}

const validPoint = (value: unknown): value is PresencePoint => {
    const point = value as PresencePoint | null;
    return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e8 && Math.abs(point.y) <= 1e8);
};

function validPeer(value: unknown): value is CanvasPresence {
    const peer = value as CanvasPresence | null;
    return Boolean(
        peer &&
        typeof peer.id === "string" &&
        peer.id.length <= 160 &&
        Number.isFinite(peer.updatedAt) &&
        Number.isSafeInteger(peer.number) &&
        peer.number >= 1 &&
        peer.number <= 64 &&
        (peer.cursor === null || validPoint(peer.cursor)) &&
        (peer.drag === null ||
            (Array.isArray(peer.drag) && peer.drag.length <= 100 && peer.drag.every((node) => validPoint(node) && typeof node.id === "string" && Number.isFinite(node.width) && Number.isFinite(node.height) && node.width > 0 && node.height > 0))),
    );
}

export function createCanvasRealtimeClient(options: { url: string; socket?: (url: string) => WebSocket; schedule?: (callback: () => void, delay: number) => Timer; clear?: (timer: Timer) => void; now?: () => number; random?: () => number }) {
    const schedule = options.schedule ?? setTimeout;
    const clear = options.clear ?? clearTimeout;
    const now = options.now ?? Date.now;
    const listeners = new Set<Listener>();
    const peers = new Map<string, { peer: CanvasPresence; seenAt: number }>();
    let state: CanvasRealtimeSnapshot = { connected: false, selfId: null, peers: [] };
    let socket: WebSocket | undefined;
    let stopped = false;
    let retry: Timer | undefined;
    let sending: Timer | undefined;
    let watchdog: Timer | undefined;
    let failures = 0;
    let lastMessage = now();
    let lastSent = -Infinity;
    let lastPayload: string | undefined;
    let presence: { cursor: PresencePoint | null; drag: PresenceNode[] | null } = { cursor: null, drag: null };
    const emit = (event: CanvasRealtimeEvent) => {
        state = { ...state, peers: [...peers.values()].map(({ peer }) => peer) };
        for (const listener of listeners) listener(state, event);
    };
    const flush = () => {
        sending = undefined;
        if (!state.connected || socket?.readyState !== 1) return;
        // Presence is replaceable state; a slow transport drops intermediate frames.
        if (socket.bufferedAmount > 32768) {
            sending = schedule(flush, 50);
            return;
        }
        const payload = JSON.stringify({ type: "presence", ...presence });
        if (payload === lastPayload) return;
        socket.send(payload);
        lastPayload = payload;
        lastSent = now();
        const self = state.selfId ? peers.get(state.selfId)?.peer : undefined;
        if (self) peers.set(self.id, { peer: { ...self, ...presence, updatedAt: now() }, seenAt: now() });
    };
    const reconnect = () => {
        if (stopped) return;
        const delay = Math.min(30000, 500 * 2 ** Math.min(failures++, 6)) * (0.8 + (options.random ?? Math.random)() * 0.4);
        retry = schedule(connect, delay);
    };
    const connect = () => {
        if (stopped) return;
        let current: WebSocket;
        try {
            current = (options.socket ?? ((url) => new WebSocket(url)))(options.url);
        } catch {
            reconnect();
            return;
        }
        socket = current;
        current.onmessage = (message) => {
            if (stopped || socket !== current) return;
            let event: { type: string; selfId?: string; peers?: unknown[]; peer?: unknown; peerId?: string };
            try {
                event = JSON.parse(String(message.data));
            } catch {
                return;
            }
            if (!event || typeof event.type !== "string") return;
            lastMessage = now();
            if (event.type === "welcome" && typeof event.selfId === "string" && Array.isArray(event.peers)) {
                peers.clear();
                for (const peer of event.peers.slice(0, 256)) if (validPeer(peer)) peers.set(peer.id, { peer, seenAt: now() });
                state = { connected: true, selfId: event.selfId, peers: [] };
                failures = 0;
                lastPayload = undefined;
                emit("connection");
                emit("invalidate");
                flush();
            } else if (event.type === "peer" && validPeer(event.peer)) {
                if (peers.size >= 256 && !peers.has(event.peer.id)) return;
                peers.set(event.peer.id, { peer: event.peer, seenAt: now() });
                emit("presence");
            } else if (event.type === "leave" && typeof event.peerId === "string") {
                peers.delete(event.peerId);
                emit("presence");
            } else if (event.type === "invalidate") emit("invalidate");
        };
        current.onerror = () => {
            current.close();
        };
        current.onclose = (event) => {
            if (stopped || socket !== current) return;
            state = { connected: false, selfId: null, peers: [] };
            peers.clear();
            if (sending !== undefined) clear(sending);
            sending = undefined;
            emit("connection");
            if (event.code === 1008) {
                stopped = true;
                return;
            }
            reconnect();
        };
    };
    const inspect = () => {
        if (stopped) return;
        if (socket && now() - lastMessage > 45000) socket.close();
        let expired = false;
        for (const [id, entry] of peers)
            if (id !== state.selfId && now() - entry.seenAt > 45000) {
                peers.delete(id);
                expired = true;
            }
        if (expired) emit("presence");
        watchdog = schedule(inspect, 15000);
    };
    return {
        subscribe(listener: Listener) {
            listeners.add(listener);
            listener(state, "connection");
            if (!socket && !stopped) {
                connect();
                watchdog = schedule(inspect, 15000);
            }
            return () => {
                listeners.delete(listener);
            };
        },
        update(cursor: PresencePoint | null, drag: PresenceNode[] | null, immediate = false) {
            presence = { cursor, drag };
            if (sending !== undefined) {
                if (!immediate) return;
                clear(sending);
            }
            if (immediate || now() - lastSent >= 50) flush();
            else sending = schedule(flush, 50 - (now() - lastSent));
        },
        close() {
            stopped = true;
            if (retry !== undefined) clear(retry);
            if (sending !== undefined) clear(sending);
            if (watchdog !== undefined) clear(watchdog);
            socket?.close();
            peers.clear();
            listeners.clear();
        },
    };
}
