import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type NodeGeometry = Pick<CanvasNodeData, "position" | "width" | "height">;
type StartAnimation = (update: (progress: number) => void, complete: () => void) => () => void;
type ResizeMotion = { geometry: NodeGeometry; target: NodeGeometry; stop: () => void };

/** 临时显示几何不写入画布状态；DOM、SVG 和 Leafer 共用同一段过渡。 */
export function createCanvasNodeResizeMotion(startAnimation: StartAnimation) {
    let previous = new Map<string, CanvasNodeData>();
    const active = new Map<string, ResizeMotion>();
    const listeners = new Map<string, Set<() => void>>();
    const frameListeners = new Set<(nodeId: string) => void>();

    const emit = (nodeId: string) => {
        listeners.get(nodeId)?.forEach((listener) => listener());
        frameListeners.forEach((listener) => listener(nodeId));
    };
    const finish = (nodeId: string) => {
        const motion = active.get(nodeId);
        if (!motion) return;
        active.delete(nodeId);
        motion.stop();
        emit(nodeId);
    };
    const finishAll = () => {
        for (const nodeId of active.keys()) finish(nodeId);
    };

    return {
        sync(nodes: CanvasNodeData[], enabled: boolean) {
            const next = new Map(nodes.map((node) => [node.id, node]));
            for (const nodeId of active.keys()) {
                if (!enabled || !next.has(nodeId)) finish(nodeId);
            }
            for (const node of nodes) {
                const before = previous.get(node.id);
                const running = active.get(node.id);
                if (running && !supportsRatioMotion(node)) {
                    finish(node.id);
                    continue;
                }
                if (running && sameGeometry(running.target, node)) continue;
                const from = running?.geometry || before;
                if (!enabled || !before || !from || !isRatioChange(before, node) || sameGeometry(from, node)) {
                    finish(node.id);
                    continue;
                }
                // 连续切换从屏幕当前尺寸接续；已停止的回调不能覆盖新动画。
                running?.stop();
                const target = geometryOf(node);
                const motion: ResizeMotion = { geometry: geometryOf(from), target, stop: () => {} };
                active.set(node.id, motion);
                emit(node.id);
                motion.stop = startAnimation(
                    (progress) => {
                        if (active.get(node.id) !== motion) return;
                        motion.geometry = interpolateGeometry(from, target, progress);
                        emit(node.id);
                    },
                    () => {
                        if (active.get(node.id) !== motion) return;
                        active.delete(node.id);
                        emit(node.id);
                    },
                );
            }
            previous = next;
        },
        getGeometry(nodeId: string) {
            return active.get(nodeId)?.geometry;
        },
        resolveNode(node: CanvasNodeData): CanvasNodeData {
            const geometry = active.get(node.id)?.geometry;
            return geometry ? { ...node, ...geometry } : node;
        },
        subscribeNode(nodeId: string, listener: () => void) {
            const subscriptions = listeners.get(nodeId) || new Set<() => void>();
            subscriptions.add(listener);
            listeners.set(nodeId, subscriptions);
            return () => {
                subscriptions.delete(listener);
                if (!subscriptions.size) listeners.delete(nodeId);
            };
        },
        subscribe(listener: (nodeId: string) => void) {
            frameListeners.add(listener);
            return () => {
                frameListeners.delete(listener);
            };
        },
        finishAll,
        reset() {
            finishAll();
            previous.clear();
        },
    };
}

export type CanvasNodeResizeMotion = ReturnType<typeof createCanvasNodeResizeMotion>;

function isRatioChange(before: CanvasNodeData, after: CanvasNodeData) {
    return before.type === after.type && supportsRatioMotion(after) && before.metadata?.size !== after.metadata?.size && !before.metadata?.content && validGeometry(before);
}

function supportsRatioMotion(node: CanvasNodeData) {
    return (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && !node.metadata?.content && !node.metadata?.manualSize && !node.metadata?.locked && !node.metadata?.freeResize && validGeometry(node);
}

function validGeometry(node: NodeGeometry) {
    return Number.isFinite(node.position.x) && Number.isFinite(node.position.y) && Number.isFinite(node.width) && node.width > 0 && Number.isFinite(node.height) && node.height > 0;
}

function sameGeometry(a: NodeGeometry, b: NodeGeometry) {
    return a.position.x === b.position.x && a.position.y === b.position.y && a.width === b.width && a.height === b.height;
}

function geometryOf(node: NodeGeometry): NodeGeometry {
    return { position: { ...node.position }, width: node.width, height: node.height };
}

function interpolateGeometry(from: NodeGeometry, to: NodeGeometry, progress: number): NodeGeometry {
    const t = Math.max(0, Math.min(1, progress));
    const mix = (a: number, b: number) => a + (b - a) * t;
    return { position: { x: mix(from.position.x, to.position.x), y: mix(from.position.y, to.position.y) }, width: mix(from.width, to.width), height: mix(from.height, to.height) };
}
