import type { CanvasNodeData } from "@/types/canvas";

export type CanvasDrawingEngine = "tldraw" | "excalidraw";

export type CanvasDrawingEngineSetting = {
    defaultEngine: CanvasDrawingEngine;
    configured?: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export const DEFAULT_DRAWING_ENGINE: CanvasDrawingEngine = "excalidraw";

export function drawingEngineForNode(node?: Pick<CanvasNodeData, "metadata"> | null): CanvasDrawingEngine {
    // 旧绘图节点没有引擎标记，其快照只能由 tldraw 读取。
    return node?.metadata?.drawingEngine === "excalidraw" ? "excalidraw" : "tldraw";
}

export function isDrawingEngineAvailable(engine: CanvasDrawingEngine) {
    return engine === "excalidraw" || import.meta.env.DEV || Boolean(import.meta.env.VITE_TLDRAW_LICENSE_KEY);
}

export function drawingEngineLabel(engine: CanvasDrawingEngine) {
    return engine === "excalidraw" ? "Excalidraw" : "tldraw";
}
