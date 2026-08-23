import { toolInputSchemas, toolNames, type ToolName } from "./schemas.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

export function isToolName(name: unknown): name is ToolName {
    return typeof name === "string" && toolNames.includes(name as ToolName);
}

export function parseToolInput(name: ToolName, input: unknown) {
    return toolInputSchemas[name].parse(input ?? {});
}

export function compactCanvasState(state: CanvasSnapshot | null) {
    if (!state) throw new Error("当前没有已连接画布");
    return { ...state, nodes: (state.nodes || []).map(compactNode) };
}

export function compactNode(node: CanvasNode) {
    const metadata = { ...(node.metadata || {}) };
    for (const key of ["url", "dataUrl", "previewUrl", "coverUrl"]) delete metadata[key];
    for (const key of ["content", "prompt", "composerContent", "errorDetails"]) {
        if (typeof metadata[key] === "string" && metadata[key].length > 360) metadata[key] = `${metadata[key].slice(0, 340)}...`;
    }
    return { id: node.id, type: node.type, title: node.title, position: node.position, width: node.width, height: node.height, parentId: node.parentId, metadata };
}

export function nextCanvasX(state: CanvasSnapshot | null) {
    const nodes = state?.nodes || [];
    return nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 80 : 0;
}
