import type { Position } from "@/types/canvas";

export type NodeResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type NodeResizeSnapshot = {
    position: Position;
    width: number;
    height: number;
    minimumWidth: number;
    minimumHeight: number;
    ratio?: number;
    corner: NodeResizeCorner;
};

/** Solve size first, then retain the diagonally opposite world-space anchor. */
export function solveNodeResize(start: NodeResizeSnapshot, delta: Position): { width: number; height: number; position: Position } {
    const sx = start.corner.endsWith("left") ? -1 : 1;
    const sy = start.corner.startsWith("top") ? -1 : 1;
    let width = Math.max(start.minimumWidth, start.width + sx * delta.x);
    let height = Math.max(start.minimumHeight, start.height + sy * delta.y);
    const ratio = start.ratio;
    if (ratio !== undefined && Number.isFinite(ratio) && ratio > 0) {
        // Preserve the existing dominant-pointer-axis gesture, including horizontal ties.
        const requestedHeight = Math.abs(delta.x) >= Math.abs(delta.y) ? width / ratio : height;
        height = Math.max(start.minimumHeight, start.minimumWidth / ratio, requestedHeight);
        width = height * ratio;
    }
    return {
        width,
        height,
        position: {
            x: start.position.x + (sx < 0 ? start.width - width : 0),
            y: start.position.y + (sy < 0 ? start.height - height : 0),
        },
    };
}
