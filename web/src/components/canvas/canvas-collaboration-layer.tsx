import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { Monitor, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";
import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";
import { subscribeCanvasRealtime, updateCanvasPresence } from "@/services/canvas-realtime";
import type { CanvasRealtimeSnapshot, PresenceNode, PresencePoint } from "@/services/canvas-realtime-client";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { createCanvasPresenceRenderer, type CanvasPeerIdentity } from "./canvas-presence-renderer";
import "./canvas-collaboration-layer.css";

const IGNORE_POINTER = "[data-canvas-no-zoom],[data-canvas-wheel-scroll],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";

export const CanvasCollaborationLayer = memo(function CanvasCollaborationLayer({
    canvasId,
    enabled,
    containerRef,
    nodesRef,
    viewportRef,
}: {
    canvasId: string;
    enabled: boolean;
    containerRef: RefObject<HTMLDivElement | null>;
    nodesRef: RefObject<CanvasNodeData[]>;
    viewportRef: RefObject<ViewportTransform>;
}) {
    const { t } = useTranslation();
    const [members, setMembers] = useState<CanvasPeerIdentity[]>([]);
    const graphicsRef = useRef<HTMLDivElement>(null);
    const detailsRef = useRef<HTMLDetailsElement>(null);

    useEffect(() => {
        if (!enabled || !containerRef.current || !graphicsRef.current) return;
        const container = containerRef.current;
        setMembers((current) => (current.length ? [] : current));
        const renderer = createCanvasPresenceRenderer(graphicsRef.current);
        let membership = "";
        let identities: CanvasPeerIdentity[] = [];
        let latest: CanvasRealtimeSnapshot = { connected: false, selfId: null, peers: [] };
        let viewport = viewportRef.current;
        let cursor: PresencePoint | null = null;
        let drag: PresenceNode[] | null = null;
        let bounds: DOMRect | undefined;
        let frame: number | undefined;
        let stopTracking: (() => void) | undefined;

        const paint = () => {
            frame = undefined;
            renderer.render(latest, identities, viewport, bounds);
        };
        const requestPaint = () => {
            if (frame === undefined) frame = requestAnimationFrame(paint);
        };
        const publish = (immediate = false) => updateCanvasPresence(canvasId, cursor, drag, immediate);
        const clear = () => {
            if (cursor || drag) {
                cursor = null;
                drag = null;
                publish(true);
            }
        };

        const track = () => {
            // Layout is measured only on entry/resize/scroll, never on pointer or viewport frames.
            const measure = () => {
                bounds = container.getBoundingClientRect();
                requestPaint();
            };
            measure();
            let indexedNodes: CanvasNodeData[] | undefined;
            let byId = new Map<string, CanvasNodeData>();
            const pointer = (event: PointerEvent) => {
                const target = event.target instanceof Element ? event.target : null;
                if (target?.closest(IGNORE_POINTER)) {
                    if (cursor) {
                        cursor = null;
                        publish();
                    }
                    return;
                }
                const view = viewportRef.current;
                cursor = { x: (event.clientX - bounds!.left - view.x) / view.k, y: (event.clientY - bounds!.top - view.y) / view.k };
                publish();
            };
            const outside = (event: PointerEvent) => {
                if (drag && !container.contains(event.target as Node)) pointer(event);
            };
            const leave = () => {
                if (cursor) {
                    cursor = null;
                    publish(true);
                }
            };
            const visibility = () => {
                if (document.hidden) clear();
            };
            const unsubscribeDrag = subscribeCanvasNodeDragPreview(container, (preview) => {
                if (preview && indexedNodes !== nodesRef.current) {
                    indexedNodes = nodesRef.current;
                    byId = new Map(indexedNodes.map((node) => [node.id, node]));
                }
                drag = preview
                    ? [...preview.nodeIds].slice(0, 100).flatMap((id) => {
                          const node = byId.get(id);
                          return node && node.width > 0 && node.height > 0 ? [{ id, x: node.position.x + preview.x, y: node.position.y + preview.y, width: node.width, height: node.height }] : [];
                      })
                    : null;
                publish(!preview);
            });
            const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, (view) => {
                viewport = view;
                requestPaint();
            });
            const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
            resize?.observe(container);
            container.addEventListener("pointermove", pointer, { capture: true, passive: true });
            container.addEventListener("pointerleave", leave);
            window.addEventListener("pointermove", outside, { passive: true });
            window.addEventListener("resize", measure, { passive: true });
            // Canvas scroll notifications are synthetic viewport events, not layout changes.
            const scroll = (event: Event) => {
                if (event.target !== container) measure();
            };
            window.addEventListener("scroll", scroll, { capture: true, passive: true });
            window.addEventListener("blur", clear);
            window.addEventListener("pointercancel", clear);
            document.addEventListener("visibilitychange", visibility);
            return () => {
                clear();
                resize?.disconnect();
                unsubscribeDrag();
                unsubscribeViewport();
                container.removeEventListener("pointermove", pointer, true);
                container.removeEventListener("pointerleave", leave);
                window.removeEventListener("pointermove", outside);
                window.removeEventListener("resize", measure);
                window.removeEventListener("scroll", scroll, true);
                window.removeEventListener("blur", clear);
                window.removeEventListener("pointercancel", clear);
                document.removeEventListener("visibilitychange", visibility);
            };
        };

        const unsubscribe = subscribeCanvasRealtime(canvasId, (snapshot) => {
            latest = snapshot;
            const remote = snapshot.peers.filter((peer) => peer.id !== snapshot.selfId);
            const nextMembership = snapshot.connected && remote.length ? JSON.stringify([snapshot.selfId, ...snapshot.peers.map((peer) => `${peer.id}:${peer.number}`).sort()]) : "";
            if (membership !== nextMembership) {
                membership = nextMembership;
                identities = nextMembership
                    ? snapshot.peers.map((peer) => ({ id: peer.id, number: peer.number, label: translate("canvasA.collaboration.deviceLabel", { number: peer.number }), self: peer.id === snapshot.selfId })).sort((a, b) => a.number - b.number)
                    : [];
                setMembers(identities);
            }
            if (nextMembership && !stopTracking) {
                viewport = viewportRef.current;
                stopTracking = track();
            } else if (!nextMembership && stopTracking) {
                stopTracking();
                stopTracking = undefined;
            }
            if (nextMembership) requestPaint();
            else {
                if (frame !== undefined) cancelAnimationFrame(frame);
                frame = undefined;
                renderer.clear();
            }
        });
        return () => {
            stopTracking?.();
            unsubscribe();
            if (frame !== undefined) cancelAnimationFrame(frame);
            renderer.clear();
        };
    }, [canvasId, enabled, containerRef, nodesRef, viewportRef]);

    useEffect(() => {
        if (members.length < 2) return;
        const close = (event: PointerEvent) => {
            if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false;
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [members.length]);

    if (!enabled) return null;
    return (
        <div className="canvas-collaboration-layer" data-canvas-collaboration>
            <div ref={graphicsRef} className="canvas-collaboration-graphics" aria-hidden="true" />
            {members.length > 1 ? (
                <details
                    ref={detailsRef}
                    className="canvas-collaboration-members"
                    data-canvas-no-zoom
                    onKeyDown={(event) => {
                        if (event.key === "Escape" && detailsRef.current?.open) {
                            event.stopPropagation();
                            detailsRef.current.open = false;
                            detailsRef.current.querySelector("summary")?.focus();
                        }
                    }}
                >
                    <summary aria-label={t("canvasA.collaboration.summaryLabel", { count: members.length })}>
                        <Monitor size={14} aria-hidden="true" />
                        <span className="canvas-collaboration-member-dots" aria-hidden="true">
                            {members
                                .filter((member) => !member.self)
                                .slice(0, 3)
                                .map((member) => (
                                    <i key={member.id} className={`canvas-collaboration-device--${((member.number - 1) % 6) + 1}`} />
                                ))}
                        </span>
                        <span>{t("canvasA.collaboration.online", { count: members.length })}</span>
                        <ChevronDown size={12} aria-hidden="true" />
                    </summary>
                    <div className="canvas-collaboration-member-panel">
                        <div className="canvas-collaboration-member-heading">{t("canvasA.collaboration.heading")}</div>
                        <ul aria-label={t("canvasA.collaboration.devicesList")}>
                            {members.map((member) => (
                                <li key={member.id} data-device-number={member.number} className={`canvas-collaboration-device--${((member.number - 1) % 6) + 1}`}>
                                    <span className="canvas-collaboration-member-avatar">{member.number}</span>
                                    <span>{member.label}</span>
                                    <small>{member.self ? t("canvasA.collaboration.thisWindow") : t("canvasA.collaboration.onlineBadge")}</small>
                                </li>
                            ))}
                        </ul>
                    </div>
                </details>
            ) : null}
        </div>
    );
});
