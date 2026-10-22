import { expect, test } from "bun:test";
import { canvasMenuPosition } from "../src/lib/canvas/canvas-menu-position";

test("bottom-right menu uses its actual height rather than a short estimate", () => {
    const position = canvasMenuPosition({ x: 1000, y: 700, width: 224, height: 480, viewportWidth: 1024, viewportHeight: 768 });
    expect(position).toEqual({ left: 788, top: 276 });
    expect(position.top + 480).toBe(768 - 12);
});

test("remeasuring longer category menus and viewport resize keeps the last item in view", () => {
    for (const [viewportWidth, viewportHeight] of [[1440, 900], [640, 360], [320, 240]]) {
        for (const naturalHeight of [84, 250, 360, 720]) {
            const width = Math.min(360, viewportWidth - 24);
            const height = Math.min(naturalHeight, viewportHeight - 24);
            const position = canvasMenuPosition({ x: 1400, y: 850, width, height, viewportWidth, viewportHeight });
            expect(position.left).toBeGreaterThanOrEqual(12);
            expect(position.top).toBeGreaterThanOrEqual(12);
            expect(position.left + width).toBeLessThanOrEqual(viewportWidth - 12);
            expect(position.top + height).toBeLessThanOrEqual(viewportHeight - 12);
        }
    }
});

test("keeps a valid pointer location and clamps negative or oversized menu bounds", () => {
    const bounds = { width: 224, height: 300, viewportWidth: 1024, viewportHeight: 768 };
    expect(canvasMenuPosition({ ...bounds, x: 100, y: 90 })).toEqual({ left: 100, top: 90 });
    expect(canvasMenuPosition({ ...bounds, x: -10, y: -20 })).toEqual({ left: 12, top: 12 });
    expect(canvasMenuPosition({ ...bounds, width: 2000, height: 2000, x: 800, y: 700 })).toEqual({ left: 12, top: 12 });
});
