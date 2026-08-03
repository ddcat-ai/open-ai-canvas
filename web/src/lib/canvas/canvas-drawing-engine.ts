import type { CanvasNodeData } from "@/types/canvas";

export type CanvasDrawingEngine = "tldraw" | "excalidraw";

export type CanvasDrawingEngineSetting = {
    defaultEngine: CanvasDrawingEngine;
    tldrawLicenseKey?: string;
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

export function resolveTldrawLicenseKey(configuredLicenseKey?: string) {
    return configuredLicenseKey?.trim() || import.meta.env.VITE_TLDRAW_LICENSE_KEY?.trim() || undefined;
}

export function isDrawingEngineAvailable(engine: CanvasDrawingEngine, configuredLicenseKey?: string) {
    return engine === "excalidraw" || Boolean(resolveTldrawLicenseKey(configuredLicenseKey));
}

export function drawingEngineLabel(engine: CanvasDrawingEngine) {
    return engine === "excalidraw" ? "Excalidraw" : "tldraw";
}