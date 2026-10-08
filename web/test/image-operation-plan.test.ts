import { describe, expect, test } from "bun:test";
import { planImageTiles, resolveCropPixels, resolveUpscaleSize } from "../src/lib/canvas/image-operation-plan";
import { resizeSelection, selectAspect, translateSelection, type CropGrip } from "../src/lib/canvas/image-crop-selection";
import { invertSelectionAlpha } from "../src/lib/canvas/image-mask-document";

describe("图片工具像素合同", () => {
    test("奇数尺寸网格完整覆盖原图且像素不重叠", () => {
        const size = { width: 17, height: 13 };
        const tiles = planImageTiles(size, { rows: 3, columns: 4 });
        const coverage = new Uint8Array(size.width * size.height);
        for (const tile of tiles) {
            for (let y = tile.y; y < tile.y + tile.height; y++) {
                for (let x = tile.x; x < tile.x + tile.width; x++) coverage[y * size.width + x]++;
            }
        }
        expect(tiles).toHaveLength(12);
        expect(coverage.every((count) => count === 1)).toBe(true);
        expect(tiles.map(({ row, column }) => [row, column])).toEqual(Array.from({ length: 12 }, (_, i) => [Math.floor(i / 4), i % 4]));
    });
    test("拒绝零面积、非有限参数及超像素网格", () => {
        for (const value of [0, NaN, Infinity, -1, 13, 1.5]) expect(() => planImageTiles({ width: 20, height: 20 }, { rows: value, columns: 2 })).toThrow();
        expect(() => planImageTiles({ width: 1, height: 1 }, { rows: 2, columns: 1 })).toThrow();
        expect(() => resolveUpscaleSize(0, 100, 1000)).toThrow();
        expect(() => resolveUpscaleSize(100, 100, Infinity)).toThrow();
    });
    test("裁剪夹取图内像素，默认居中方形", () => {
        expect(resolveCropPixels({ width: 9, height: 4 })).toEqual({ x: 2, y: 0, width: 4, height: 4 });
        expect(resolveCropPixels({ width: 10, height: 10 }, { x: -0.1, y: 0.8, width: 0.3, height: 0.5 })).toEqual({ x: 0, y: 8, width: 2, height: 2 });
        expect(() => resolveCropPixels({ width: 10, height: 10 }, { x: 2, y: 0, width: 0.1, height: 1 })).toThrow();
    });
    test("缩放保持宽高比并限制长边", () => {
        expect(resolveUpscaleSize(300, 200, 9000)).toEqual({ width: 4096, height: 2731 });
        expect(resolveUpscaleSize(200, 300, 1024)).toEqual({ width: 683, height: 1024 });
    });
    test("锁定比例时八个手柄在各种拖动下都保持比例与图内边界", () => {
        const box = { x: 0.1, y: 0.2, width: 0.6, height: 0.4 };
        for (const x of [-1, 0, 1] as const)
            for (const y of [-1, 0, 1] as const) {
                if (!x && !y) continue;
                for (const dx of [-3, -0.1, 0, 0.1, 3])
                    for (const dy of [-3, -0.1, 0, 0.1, 3]) {
                        const next = resizeSelection(box, [x, y] as CropGrip, dx, dy, true);
                        expect(next.width / next.height).toBeCloseTo(1.5, 8);
                        expect(next.x).toBeGreaterThanOrEqual(-1e-12);
                        expect(next.y).toBeGreaterThanOrEqual(-1e-12);
                        expect(next.x + next.width).toBeLessThanOrEqual(1 + 1e-12);
                        expect(next.y + next.height).toBeLessThanOrEqual(1 + 1e-12);
                    }
            }
    });
    test("极窄比例切换后仍可自由拖动手柄", () => {
        const box = selectAspect({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 0.02);
        expect(box.width).toBeLessThan(0.06);
        const resized = resizeSelection(box, [-1, 0], 0, 0, false);
        expect(resized.x).toBeGreaterThanOrEqual(0);
        expect(resized.width).toBeGreaterThan(0);
        expect(resized.x + resized.width).toBeLessThanOrEqual(1);
        expect(translateSelection(box, -100, 100).y + box.height).toBeCloseTo(1);
    });
    test("遮罩选区转换为透明，未选区保持白色不透明，空选区拒绝", () => {
        const input = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 255]);
        expect([...invertSelectionAlpha(input)]).toEqual([255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 0]);
        expect(input[7]).toBe(12);
        expect(() => invertSelectionAlpha(new Uint8ClampedArray(8))).toThrow();
    });
});
