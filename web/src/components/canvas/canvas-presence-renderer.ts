import type { CanvasPresence, CanvasRealtimeSnapshot } from "@/services/canvas-realtime-client";
import type { ViewportTransform } from "@/types/canvas";
import { translate } from "@/i18n";

export type CanvasPeerIdentity = { id: string; number: number; label: string; self: boolean };
type PeerElements = { root: HTMLDivElement; cursor: HTMLDivElement; label: HTMLSpanElement; outlines: Map<string, HTMLDivElement> };

// This subtree owns only ephemeral graphics. React owns the device list, never animation frames.
export function createCanvasPresenceRenderer(host: HTMLDivElement) {
    const peers = new Map<string, PeerElements>();
    const styles = new WeakMap<HTMLElement, Partial<Record<"transform" | "width" | "height", string>>>();
    const writeStyle = (element: HTMLElement, property: "transform" | "width" | "height", value: string) => {
        let previous = styles.get(element);
        if (!previous) {
            previous = {};
            styles.set(element, previous);
        }
        // Browsers normalize CSS numbers, so comparing style strings would rewrite unchanged frames.
        if (previous[property] !== value) {
            element.style[property] = value;
            previous[property] = value;
        }
    };
    const createPeer = (identity: CanvasPeerIdentity) => {
        const root = document.createElement("div");
        root.className = `canvas-collaboration-peer canvas-collaboration-device--${((identity.number - 1) % 6) + 1}`;
        const cursor = document.createElement("div");
        cursor.className = "canvas-collaboration-cursor";
        cursor.dataset.peerLabel = identity.label;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "18");
        svg.setAttribute("height", "22");
        svg.setAttribute("viewBox", "0 0 18 22");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M2 2L15 13L9 14L6 20Z");
        svg.append(path);
        const label = document.createElement("span");
        label.className = "canvas-collaboration-cursor-label";
        cursor.append(svg, label);
        root.append(cursor);
        host.append(root);
        return { root, cursor, label, outlines: new Map<string, HTMLDivElement>() };
    };
    const transform = (element: HTMLElement, x: number, y: number) => {
        writeStyle(element, "transform", `translate3d(${x}px, ${y}px, 0)`);
    };
    const draw = (elements: PeerElements, identity: CanvasPeerIdentity, peer: CanvasPresence, view: ViewportTransform, bounds?: DOMRect) => {
        const point = peer.cursor;
        const x = point ? point.x * view.k + view.x : 0;
        const y = point ? point.y * view.k + view.y : 0;
        const hidden = !point || Boolean(bounds && (x < 0 || y < 0 || x > bounds.width || y > bounds.height));
        if (elements.cursor.hidden !== hidden) elements.cursor.hidden = hidden;
        if (point && !elements.cursor.hidden) transform(elements.cursor, x, y);
        const label = peer.drag?.length ? translate("canvasB.presence.dragging", { name: identity.label }) : identity.label;
        if (elements.label.textContent !== label) elements.label.textContent = label;
        const active = new Set<string>();
        for (const node of peer.drag ?? []) {
            const nx = node.x * view.k + view.x,
                ny = node.y * view.k + view.y;
            const width = node.width * view.k,
                height = node.height * view.k;
            if (bounds && (nx + width < 0 || ny + height < 0 || nx > bounds.width || ny > bounds.height)) continue;
            active.add(node.id);
            let outline = elements.outlines.get(node.id);
            if (!outline) {
                outline = document.createElement("div");
                outline.className = "canvas-collaboration-drag";
                elements.outlines.set(node.id, outline);
                elements.root.append(outline);
            }
            transform(outline, nx, ny);
            writeStyle(outline, "width", `${width}px`);
            writeStyle(outline, "height", `${height}px`);
        }
        for (const [id, element] of elements.outlines)
            if (!active.has(id)) {
                element.remove();
                elements.outlines.delete(id);
            }
    };
    return {
        render(snapshot: CanvasRealtimeSnapshot, identities: CanvasPeerIdentity[], view: ViewportTransform, bounds?: DOMRect) {
            const active = new Set<string>();
            const byId = new Map(snapshot.peers.map((peer) => [peer.id, peer]));
            for (const identity of identities) {
                if (identity.self) continue;
                const peer = byId.get(identity.id);
                if (!peer) continue;
                active.add(identity.id);
                let elements = peers.get(identity.id);
                if (!elements) {
                    elements = createPeer(identity);
                    peers.set(identity.id, elements);
                }
                draw(elements, identity, peer, view, bounds);
            }
            for (const [id, elements] of peers)
                if (!active.has(id)) {
                    elements.root.remove();
                    peers.delete(id);
                }
        },
        clear() {
            host.replaceChildren();
            peers.clear();
        },
    };
}
