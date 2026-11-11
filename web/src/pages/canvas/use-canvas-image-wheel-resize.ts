import { getNodeResizeMinSize } from "@/lib/canvas/node-registry";
import { solveNodeResize } from "@/lib/canvas/node-resize-geometry";
import type { CanvasNodeData } from "@/types/canvas";

export function imageWheelSize(node: CanvasNodeData, delta: number) {
    const minimum = getNodeResizeMinSize({ ...node, metadata: { ...node.metadata, freeResize: false } });
    const factor = Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.0015);
    const size = solveNodeResize(
        { position: node.position, width: node.width, height: node.height, minimumWidth: minimum.width, minimumHeight: minimum.height, ratio: node.width / node.height, corner: "bottom-right" },
        { x: node.width * (factor - 1), y: node.height * (factor - 1) },
    );
    return { ...size, position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 } };
}
