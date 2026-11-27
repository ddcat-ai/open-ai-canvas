import type { Position } from "@/types/canvas";

const EDGE_ZONE_PX = 72;
const MAX_SPEED_PX_PER_SECOND = 950;

// Screen-space speed keeps the gesture consistent at every canvas zoom.
export function canvasDragEdgePanVelocity(pointer: Position, bounds: Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom">): Position {
    function axis(value: number, start: number, end: number) {
        const zone = Math.min(EDGE_ZONE_PX, (end - start) / 3);
        if (zone <= 0) return 0;
        const fromStart = Math.max(0, Math.min(1, 1 - (value - start) / zone));
        const fromEnd = Math.max(0, Math.min(1, 1 - (end - value) / zone));
        return (fromStart ** 2 - fromEnd ** 2) * MAX_SPEED_PX_PER_SECOND;
    }
    return { x: axis(pointer.x, bounds.left, bounds.right), y: axis(pointer.y, bounds.top, bounds.bottom) };
}
