import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/test" });
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback);
        return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const { act, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasViewport } = await import("@/components/canvas/canvas-viewport");
const { useCanvasSelectionController } = await import("@/pages/canvas/use-canvas-selection-controller");
const { CanvasNodeType } = await import("@/types/canvas");
const noop = () => {};
// happy-dom 的 WheelEvent 未初始化 MouseEvent 坐标，显式补齐浏览器会提供的字段。
function wheelAt(point: { x: number; y: number }, deltaY: number) {
    const event = new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
    Object.defineProperties(event, { clientX: { value: point.x }, clientY: { value: point.y }, ctrlKey: { value: true } });
    return event;
}

test.each([0.5, 1.2])("Ctrl+滚轮、多选拖拽和松手在初始缩放 %s 保持鼠标锚点", async (scale) => {
    let latestNodes: CanvasNodeData[] = [];
    let latestViewport: ViewportTransform = { x: 60, y: 40, k: scale };
    const original = [
        { x: 100, y: 160 },
        { x: 500, y: 600 },
    ];
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const [nodes, setNodes] = useState<CanvasNodeData[]>(original.map((position, i) => ({ id: `node-${i}`, type: CanvasNodeType.Text, title: `node-${i}`, position, width: 100, height: 80, metadata: {} })));
        latestNodes = nodes;
        const nodesRef = useRef(nodes);
        nodesRef.current = nodes;
        const [viewport, setViewport] = useState(latestViewport);
        const viewportRef = useRef(viewport);
        const selectedNodeIdsRef = useRef(new Set(["node-0", "node-1"]));
        const historyPausedRef = useRef(false);
        const controller = useCanvasSelectionController({
            containerRef,
            nodesRef,
            viewportRef,
            selectedNodeIdsRef,
            historyPausedRef,
            screenToCanvas: (x, y) => ({ x: (x - viewportRef.current.x) / viewportRef.current.k, y: (y - viewportRef.current.y) / viewportRef.current.k }),
            setNodes,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            cancelPendingConnectionCreate: noop,
            onCanvasSelectionStart: noop,
            onNodeInteractionStart: noop,
            onNodeClick: noop,
            onDeselect: noop,
        });
        const preview = (next: ViewportTransform) => {
            latestViewport = next;
            viewportRef.current = next;
        };
        return (
            <CanvasViewport
                containerRef={containerRef}
                viewport={viewport}
                onViewportPreviewChange={preview}
                onViewportChange={(next) => {
                    preview(next);
                    setViewport(next);
                }}
            >
                {nodes.map((node) => (
                    <div key={node.id} data-node-id={node.id} onMouseDown={(event) => controller.handleNodeMouseDown(event, node.id)}>
                        {node.title}
                    </div>
                ))}
            </CanvasViewport>
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const flush = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach((callback) => callback(performance.now()));
    };
    await act(async () => root.render(<Harness />));
    try {
        const node = host.querySelector<HTMLElement>('[data-node-id="node-0"]')!;
        const grab = { x: 20, y: 30 };
        let mouse = { x: 60 + 120 * scale, y: 40 + 190 * scale };
        await act(async () => node.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: mouse.x, clientY: mouse.y })));
        expect(host.querySelector<HTMLElement>("[data-canvas-viewport]")?.dataset.canvasNodeDragging).toBe("true");
        mouse = { x: mouse.x + 110, y: mouse.y + 77 };
        await act(async () => {
            window.dispatchEvent(new dom.MouseEvent("mousemove", { clientX: mouse.x, clientY: mouse.y }));
            flush();
        });
        for (const deltaY of [-120, 120, -120]) {
            await act(async () => {
                const wheel = wheelAt(mouse, deltaY);
                node.dispatchEvent(wheel);
                expect(wheel.defaultPrevented).toBe(true);
                flush();
            });
            mouse = { x: mouse.x + 31, y: mouse.y + 19 };
            await act(async () => {
                window.dispatchEvent(new dom.MouseEvent("mousemove", { clientX: mouse.x, clientY: mouse.y }));
                flush();
            });
            const [dx, dy] = node.style.translate.split(" ").map(parseFloat);
            expect(node.style.translate, host.innerHTML).not.toBe("");
            expect(latestViewport.x + (original[0].x + dx + grab.x) * latestViewport.k).toBeCloseTo(mouse.x, 6);
            expect(latestViewport.y + (original[0].y + dy + grab.y) * latestViewport.k).toBeCloseTo(mouse.y, 6);
        }
        // 最后一次缩放后直接松手，不依赖补发 mousemove。
        await act(async () => {
            node.dispatchEvent(wheelAt(mouse, 120));
            flush();
        });
        await act(async () => window.dispatchEvent(new dom.MouseEvent("mouseup", { clientX: mouse.x, clientY: mouse.y })));
        expect(latestViewport.x + (latestNodes[0].position.x + grab.x) * latestViewport.k).toBeCloseTo(mouse.x, 6);
        expect(latestViewport.y + (latestNodes[0].position.y + grab.y) * latestViewport.k).toBeCloseTo(mouse.y, 6);
        expect(latestNodes[1].position.x - latestNodes[0].position.x).toBeCloseTo(400, 6);
        expect(latestNodes[1].position.y - latestNodes[0].position.y).toBeCloseTo(440, 6);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        frames.clear();
    }
});
