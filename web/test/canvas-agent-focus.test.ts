import { describe, expect, test } from "bun:test";
import { unobscuredCanvasArea, viewportForAgentNodes } from "@/lib/canvas/canvas-viewport";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, x: number, y: number): CanvasNodeData => ({ id, type: CanvasNodeType.Text, title: id, position: { x, y }, width: 300, height: 200 });

describe("Agent created node focus", () => {
    test("pans to distant nodes without unnecessarily changing scale", () => {
        const target = viewportForAgentNodes([node("new", 8000, -4000)], { x: 0, y: 0, k: 1 }, unobscuredCanvasArea({ width: 1200, height: 800 }))!;
        expect(target.k).toBe(1);
        expect(8150 * target.k + target.x).toBe(600);
        expect(-3900 * target.k + target.y).toBe(400);
    });

    test("fits the whole new batch to the left of a right-side panel", () => {
        const area = unobscuredCanvasArea({ width: 1200, height: 800 }, { left: 780, top: 40, right: 1180, bottom: 780 });
        expect(area).toEqual({ left: 0, top: 0, right: 780, bottom: 800 });
        const nodes = [node("a", 3000, 2000), node("b", 4400, 2700)];
        const target = viewportForAgentNodes(nodes, { x: 0, y: 0, k: 1 }, area)!;
        expect(target.k).toBeLessThan(1);
        for (const item of nodes) {
            expect(item.position.x * target.k + target.x).toBeGreaterThanOrEqual(area.left + 55);
            expect((item.position.x + item.width) * target.k + target.x).toBeLessThanOrEqual(area.right - 55);
            expect(item.position.y * target.k + target.y).toBeGreaterThanOrEqual(area.top + 55);
            expect((item.position.y + item.height) * target.k + target.y).toBeLessThanOrEqual(area.bottom - 55);
        }
    });

    test("adapts to panels moved to the left or bottom", () => {
        expect(unobscuredCanvasArea({ width: 1200, height: 800 }, { left: 0, top: 0, right: 400, bottom: 800 }).left).toBe(400);
        expect(unobscuredCanvasArea({ width: 1200, height: 800 }, { left: 0, top: 500, right: 1200, bottom: 800 }).bottom).toBe(500);
    });

    test("ignores offscreen overlays and handles fully covered narrow screens", () => {
        const size = { width: 375, height: 600 };
        const full = { left: 0, top: 0, right: 375, bottom: 600 };
        expect(unobscuredCanvasArea(size, { left: 500, top: 0, right: 900, bottom: 600 })).toEqual(full);
        expect(unobscuredCanvasArea(size, full)).toEqual(full);
        expect(viewportForAgentNodes([], { x: 0, y: 0, k: 1 }, full)).toBeNull();
    });
});
