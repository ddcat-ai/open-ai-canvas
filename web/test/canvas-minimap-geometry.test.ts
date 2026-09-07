import { describe, expect, test } from "bun:test";

import type { ViewportTransform } from "../src/types/canvas";
import { calculateMinimapWorldBounds, minimapScaleForWorldBounds, minimapViewportRect, viewportWorldRect } from "../src/lib/canvas/canvas-minimap-geometry";

const mapSize = { width: 240, height: 160 };
const viewportSize = { width: 1200, height: 720 };

describe("canvas minimap geometry", () => {
    test("把当前实时视口纳入小地图世界范围", () => {
        const viewport: ViewportTransform = { x: -12000, y: 8000, k: 1 };
        const viewportBounds = viewportWorldRect(viewport, viewportSize);
        const bounds = calculateMinimapWorldBounds({ x: 0, y: 0, w: 1000, h: 800 }, viewportBounds);
        const rect = minimapViewportRect(viewportBounds, bounds, mapSize);

        expect(bounds.x).toBeLessThanOrEqual(viewportBounds.x);
        expect(bounds.x + bounds.w).toBeGreaterThanOrEqual(viewportBounds.x + viewportBounds.w);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(mapSize.width);
        expect(rect.y + rect.h).toBeLessThanOrEqual(mapSize.height);
    });

    test("缩放视口时同步改变底图比例和视口框尺寸", () => {
        const nodeBounds = { x: 0, y: 0, w: 2000, h: 1200 };
        const normal = viewportWorldRect({ x: -400, y: -300, k: 1 }, viewportSize);
        const zoomed = viewportWorldRect({ x: -400, y: -300, k: 2 }, viewportSize);
        const normalBounds = calculateMinimapWorldBounds(nodeBounds, normal);
        const zoomedBounds = calculateMinimapWorldBounds(nodeBounds, zoomed);
        const normalRect = minimapViewportRect(normal, normalBounds, mapSize);
        const zoomedRect = minimapViewportRect(zoomed, zoomedBounds, mapSize);

        expect(minimapScaleForWorldBounds(zoomedBounds, mapSize)).toBeGreaterThanOrEqual(minimapScaleForWorldBounds(normalBounds, mapSize));
        expect(zoomedRect.w).toBeGreaterThan(0);
        expect(zoomedRect.h).toBeGreaterThan(0);
        expect(normalRect.x + normalRect.w).toBeLessThanOrEqual(mapSize.width);
        expect(zoomedRect.x + zoomedRect.w).toBeLessThanOrEqual(mapSize.width);
    });

    test("远距离四个方向的视口框都不会越出小地图", () => {
        const nodeBounds = { x: 0, y: 0, w: 1000, h: 800 };
        for (const viewport of [
            { x: 10000, y: 0, k: 1 },
            { x: -10000, y: 0, k: 1 },
            { x: 0, y: 10000, k: 1 },
            { x: 0, y: -10000, k: 1 },
            { x: 10000, y: -10000, k: 0.5 },
        ]) {
            const viewportBounds = viewportWorldRect(viewport, viewportSize);
            const bounds = calculateMinimapWorldBounds(nodeBounds, viewportBounds);
            const rect = minimapViewportRect(viewportBounds, bounds, mapSize);
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.y).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.w).toBeLessThanOrEqual(mapSize.width);
            expect(rect.y + rect.h).toBeLessThanOrEqual(mapSize.height);
        }
    });

    test("异常视口数据也不会生成负坐标或 NaN", () => {
        const viewportBounds = viewportWorldRect({ x: Number.NaN, y: Number.POSITIVE_INFINITY, k: 0 } as ViewportTransform, viewportSize);
        const bounds = calculateMinimapWorldBounds(null, viewportBounds);
        const rect = minimapViewportRect(viewportBounds, bounds, mapSize);

        for (const value of Object.values(rect)) {
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
        }
        expect(rect.x + rect.w).toBeLessThanOrEqual(mapSize.width);
        expect(rect.y + rect.h).toBeLessThanOrEqual(mapSize.height);
    });
});
