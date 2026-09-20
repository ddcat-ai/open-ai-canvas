import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Avatar, Popover } from "antd";

import { listCanvasPresence, removeCanvasPresence, updateCanvasPresence, type CanvasPresence, type CanvasPresenceActivityKind, type CanvasPresenceUpdate } from "@/services/api/canvas-collaboration";
import type { ViewportTransform } from "@/types/canvas";
import "./canvas-presence.css";

const PRESENCE_PUBLISH_DELAY = 120;
const PRESENCE_HEARTBEAT_MS = 5_000;
const PRESENCE_POLL_MS = 2_500;
const PRESENCE_STALE_AFTER_MS = 12_000;

type PresenceActivity = { kind: CanvasPresenceActivityKind; nodeId?: string };

type UseCanvasPresenceOptions = {
    canvasId: string;
    enabled: boolean;
    projectLoaded: boolean;
    containerRef: RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
};

export function useCanvasPresence({ canvasId, enabled, projectLoaded, containerRef, viewport }: UseCanvasPresenceOptions) {
    const [presence, setPresence] = useState<CanvasPresence[]>([]);
    const sessionIdRef = useRef<string>(newPresenceSessionId());
    const draftRef = useRef<CanvasPresenceUpdate>({ sessionId: sessionIdRef.current, activity: { kind: "viewing" } });
    const viewportRef = useRef(viewport);
    const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const publishInFlightRef = useRef(false);
    const publishPromiseRef = useRef<Promise<void> | null>(null);
    const publishQueuedRef = useRef(false);
    const presenceAbortRef = useRef<AbortController | null>(null);
    const presenceActiveRef = useRef(false);
    const pollInFlightRef = useRef(false);
    const presenceSignatureRef = useRef("");
    const presenceGenerationRef = useRef(0);

    useEffect(() => {
        viewportRef.current = viewport;
        draftRef.current = { ...draftRef.current, viewport };
    }, [viewport]);

    const publish = useCallback(async () => {
        if (!presenceActiveRef.current || !enabled || !projectLoaded || !canvasId) return;
        if (publishInFlightRef.current) {
            publishQueuedRef.current = true;
            return;
        }
        publishInFlightRef.current = true;
        let request!: Promise<void>;
        request = (async () => {
            try {
                await updateCanvasPresence(canvasId, { ...draftRef.current, viewport: viewportRef.current }, { signal: presenceAbortRef.current?.signal });
            } catch {
                // Presence is best effort. A failed heartbeat must never affect canvas editing.
            } finally {
                if (publishPromiseRef.current === request) {
                    publishInFlightRef.current = false;
                    publishPromiseRef.current = null;
                    if (presenceActiveRef.current && publishQueuedRef.current) {
                        publishQueuedRef.current = false;
                        schedulePublish(publish);
                    } else {
                        publishQueuedRef.current = false;
                    }
                }
            }
        })();
        publishPromiseRef.current = request;
        await request;
    }, [canvasId, enabled, projectLoaded]);

    const schedulePublish = useCallback((callback: () => void | Promise<void>) => {
        if (publishTimerRef.current) return;
        publishTimerRef.current = setTimeout(() => {
            publishTimerRef.current = null;
            void callback();
        }, PRESENCE_PUBLISH_DELAY);
    }, []);

    const setActivity = useCallback(
        (activity: PresenceActivity) => {
            if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
            draftRef.current = { ...draftRef.current, activity };
            schedulePublish(publish);
            if (activity.kind === "typing") {
                activityTimerRef.current = setTimeout(() => {
                    activityTimerRef.current = null;
                    draftRef.current = { ...draftRef.current, activity: { kind: "viewing" } };
                    schedulePublish(publish);
                }, 2_500);
            }
        },
        [publish, schedulePublish],
    );

    const clearActivity = useCallback(() => {
        if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
        activityTimerRef.current = null;
        draftRef.current = { ...draftRef.current, activity: { kind: "viewing" } };
        schedulePublish(publish);
    }, [publish, schedulePublish]);

    const handlePointerMove = useCallback(
        (event: { clientX: number; clientY: number; currentTarget: EventTarget | null }) => {
            const element = event.currentTarget instanceof HTMLElement ? event.currentTarget : containerRef.current;
            const rect = element?.getBoundingClientRect();
            if (!rect) return;
            const current = viewportRef.current;
            // The live pan values are written as CSS lengths (for example `12px`).
            // Number("12px") is NaN, which made the remote cursor jump back to the
            // committed viewport while somebody was panning or zooming.
            const readLiveNumber = (name: string, fallback: number) => {
                const value = parseFloat(element?.style.getPropertyValue(name) || "");
                return Number.isFinite(value) ? value : fallback;
            };
            const liveX = readLiveNumber("--canvas-live-x", current.x);
            const liveY = readLiveNumber("--canvas-live-y", current.y);
            const liveScale = readLiveNumber("--canvas-live-scale", current.k);
            draftRef.current = {
                ...draftRef.current,
                cursor: { x: (event.clientX - rect.left - liveX) / Math.max(liveScale, 0.05), y: (event.clientY - rect.top - liveY) / Math.max(liveScale, 0.05) },
                viewport: { x: liveX, y: liveY, k: liveScale },
            };
            schedulePublish(publish);
        },
        [containerRef, publish, schedulePublish],
    );

    useEffect(() => {
        if (!enabled || !projectLoaded || !canvasId) {
            setPresence([]);
            presenceSignatureRef.current = "";
            pollInFlightRef.current = false;
            return;
        }
        const controller = new AbortController();
        const generation = ++presenceGenerationRef.current;
        presenceAbortRef.current = controller;
        presenceActiveRef.current = true;
        const sessionId = newPresenceSessionId();
        sessionIdRef.current = sessionId;
        draftRef.current = { sessionId, activity: { kind: "viewing" } };
        presenceSignatureRef.current = "";
        let cancelled = false;
        const poll = async () => {
            if (generation !== presenceGenerationRef.current || pollInFlightRef.current || document.visibilityState === "hidden") return;
            pollInFlightRef.current = true;
            try {
                const result = await listCanvasPresence(canvasId, { signal: controller.signal });
                if (!cancelled && generation === presenceGenerationRef.current) {
                    const next = (result.presence || []).filter(isFreshPresence);
                    const signature = next.map((item) => `${item.userId}:${item.sessionId}:${item.displayName}:${item.activity.kind}:${item.activity.nodeId || ""}:${item.cursor?.x ?? ""}:${item.cursor?.y ?? ""}`).join("|");
                    if (signature !== presenceSignatureRef.current) {
                        presenceSignatureRef.current = signature;
                        setPresence(next);
                    } else
                        setPresence((current) => {
                            const fresh = current.filter(isFreshPresence);
                            return fresh.length === current.length ? current : fresh;
                        });
                }
            } catch {
                // Keep the last known members through a short network hiccup.
                // A member disappears only after its heartbeat is genuinely stale.
                if (!cancelled && generation === presenceGenerationRef.current) setPresence((current) => current.filter(isFreshPresence));
            } finally {
                if (generation === presenceGenerationRef.current) pollInFlightRef.current = false;
            }
        };
        void publish();
        void poll();
        const pollTimer = window.setInterval(() => void poll(), PRESENCE_POLL_MS);
        const heartbeatTimer = window.setInterval(() => void publish(), PRESENCE_HEARTBEAT_MS);
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") void poll();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            cancelled = true;
            presenceActiveRef.current = false;
            controller.abort();
            window.clearInterval(pollTimer);
            window.clearInterval(heartbeatTimer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
            if (activityTimerRef.current) clearTimeout(activityTimerRef.current);
            publishTimerRef.current = null;
            activityTimerRef.current = null;
            publishQueuedRef.current = false;
            pollInFlightRef.current = false;
            presenceSignatureRef.current = "";
            const oldSessionId = sessionId;
            const pending = publishPromiseRef.current;
            publishPromiseRef.current = null;
            publishInFlightRef.current = false;
            // Delete only after a pending heartbeat has settled. This keeps a
            // delayed PUT from arriving after DELETE and briefly resurrecting
            // the cursor for other collaborators.
            void (pending ? pending.catch(() => undefined).then(() => removeCanvasPresence(canvasId, oldSessionId)) : removeCanvasPresence(canvasId, oldSessionId)).catch(() => undefined);
            if (presenceAbortRef.current === controller) presenceAbortRef.current = null;
        };
    }, [canvasId, enabled, projectLoaded, publish]);

    return { presence, setActivity, clearActivity, handlePointerMove };
}

function isFreshPresence(item: CanvasPresence) {
    const seen = Date.parse(item.lastSeenAt);
    return Number.isFinite(seen) && Date.now() - seen < PRESENCE_STALE_AFTER_MS;
}

export function CanvasPresenceMembers({ presence, collaborationEnabled = false }: { presence: CanvasPresence[]; collaborationEnabled?: boolean }) {
    if (!presence.length) return null;
    const visible = presence.slice(0, 4);
    return (
        <Popover
            trigger="click"
            placement="bottom"
            content={
                <div className="min-w-44 space-y-2" data-canvas-no-zoom>
                    {presence.length ? (
                        presence.map((item) => (
                            <div key={`${item.userId}:${item.sessionId}`} className="flex items-center gap-2 text-xs">
                                <PresenceAvatar presence={item} />
                                <span className="min-w-0 flex-1 truncate">{item.displayName}</span>
                                <span className="text-muted-foreground">{presenceActivityLabel(item.activity.kind)}</span>
                            </div>
                        ))
                    ) : (
                        <p className="m-0 text-xs text-muted-foreground">目前只有你在线</p>
                    )}
                </div>
            }
        >
            <button type="button" className="canvas-presence-members inline-flex h-9 items-center gap-1.5 rounded-xl px-1.5" aria-label={presence.length ? `${presence.length} 位成员在线` : "协作成员"}>
                {presence.length ? (
                    <span className="flex -space-x-1.5">
                        {visible.map((item) => (
                            <PresenceAvatar key={`${item.userId}:${item.sessionId}`} presence={item} />
                        ))}
                    </span>
                ) : (
                    <span className="text-xs opacity-75">协作</span>
                )}
                {presence.length > visible.length ? <span className="text-xs opacity-70">+{presence.length - visible.length}</span> : null}
            </button>
        </Popover>
    );
}

export function CanvasPresenceOverlay({ presence }: { presence: CanvasPresence[] }) {
    return (
        <>
            {presence
                .filter((item) => item.cursor)
                .map((item) => {
                    const cursor = item.cursor!;
                    const color = presenceColor(item.userId);
                    return (
                        <div key={`${item.userId}:${item.sessionId}`} className="canvas-remote-cursor" style={{ left: cursor.x, top: cursor.y, color }} aria-hidden>
                            <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 1L18 15L10.5 16.5L7 23L1 1Z" fill="currentColor" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                            </svg>
                            <span className="canvas-remote-cursor-label" style={{ backgroundColor: color }}>
                                <span className="canvas-remote-cursor-name">{item.displayName?.trim() || "协作成员"}</span>
                                {item.activity.kind !== "viewing" ? <span className="canvas-remote-cursor-activity">{presenceActivityLabel(item.activity.kind)}</span> : null}
                            </span>
                        </div>
                    );
                })}
        </>
    );
}

function PresenceAvatar({ presence, size = "small" }: { presence: CanvasPresence; size?: "small" | number }) {
    const name = presence.displayName || "成员";
    return (
        <Avatar size={size} style={{ backgroundColor: presenceColor(presence.userId), fontSize: size === "small" ? 10 : 12 }}>
            {name.slice(0, 1).toUpperCase()}
        </Avatar>
    );
}

export function presenceColor(userId: string) {
    let hash = 0;
    for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    const palette = ["#2563eb", "#7c3aed", "#db2777", "#059669", "#d97706", "#0891b2", "#dc2626"];
    return palette[Math.abs(hash) % palette.length];
}

function presenceActivityLabel(kind: CanvasPresenceActivityKind) {
    switch (kind) {
        case "typing":
            return "正在输入";
        case "dragging":
            return "正在移动";
        case "resizing":
            return "正在调整大小";
        case "connecting":
            return "正在连接";
        case "generating":
            return "正在生成";
        default:
            return "正在查看";
    }
}

function newPresenceSessionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `presence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
