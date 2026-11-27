import { describe, expect, test } from "bun:test";
import { canvasDragEdgePanVelocity } from "@/lib/canvas/canvas-drag-edge-pan";

const bounds = { left: 100, right: 900, top: 40, bottom: 640 };

describe("canvas drag edge pan", () => {
    test("does not pan in the center or at the inner edge of the zone", () => {
        expect(canvasDragEdgePanVelocity({ x: 500, y: 300 }, bounds)).toEqual({ x: 0, y: 0 });
        expect(canvasDragEdgePanVelocity({ x: 172, y: 568 }, bounds)).toEqual({ x: 0, y: 0 });
    });

    test("pans toward the visible content in each direction, including corners", () => {
        expect(canvasDragEdgePanVelocity({ x: 100, y: 40 }, bounds)).toEqual({ x: 950, y: 950 });
        expect(canvasDragEdgePanVelocity({ x: 900, y: 640 }, bounds)).toEqual({ x: -950, y: -950 });
        expect(canvasDragEdgePanVelocity({ x: 850, y: 300 }, bounds).x).toBeLessThan(0);
        expect(canvasDragEdgePanVelocity({ x: 136, y: 300 }, bounds).x).toBeCloseTo(237.5);
    });

    test("caps speed outside the canvas and leaves a neutral zone in narrow viewports", () => {
        expect(canvasDragEdgePanVelocity({ x: 0, y: 1000 }, bounds)).toEqual({ x: 950, y: -950 });
        expect(canvasDragEdgePanVelocity({ x: 45, y: 40 }, { left: 0, right: 90, top: 0, bottom: 80 })).toEqual({ x: 0, y: 0 });
    });
});
