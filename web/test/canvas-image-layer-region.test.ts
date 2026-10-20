import { expect, test } from "bun:test";
import { imageLayerAlphaBounds, suggestImageLayerRegion } from "../src/lib/canvas/canvas-image-layer-region";
import { ensureMediaNodeMinimumSize, fitImageMaterialNodeSize } from "../src/lib/canvas/canvas-node-size";
import { CanvasNodeType } from "../src/types/canvas";

test("extreme material ratios use bounded preview frames and remain stable after reload", () => {
    for (const [width, height] of [
        [1408, 79],
        [12, 1400],
        [701, 626],
        [10, 8],
    ]) {
        const size = fitImageMaterialNodeSize(width, height);
        expect(size.width).toBeLessThanOrEqual(720);
        expect(size.height).toBeLessThanOrEqual(520);
        const node = {
            id: "material",
            type: CanvasNodeType.Image,
            title: "素材",
            position: { x: 10, y: 20 },
            ...size,
            metadata: { content: "/material.png", naturalWidth: width, naturalHeight: height, imageLayerMaterial: { sourceLayerId: "layer", sourceGroupId: "group", bounds: { left: 0, top: 0, width, height } } },
        };
        expect(ensureMediaNodeMinimumSize(node)).toEqual(node);
    }
});

test("alpha bounds keep soft edges and reject empty/invalid rasters", () => {
    const pixels = new Uint8ClampedArray(12 * 8 * 4);
    pixels[(2 * 12 + 3) * 4 + 3] = 1;
    pixels[(5 * 12 + 8) * 4 + 3] = 255;
    expect(imageLayerAlphaBounds(12, 8, pixels)).toEqual({ left: 3, top: 2, width: 6, height: 4 });
    expect(() => imageLayerAlphaBounds(12, 8, new Uint8ClampedArray(pixels.length))).toThrow("完全透明");
    expect(() => imageLayerAlphaBounds(12, 9, pixels)).toThrow("尺寸无效");
});

for (const [width, height, background, foreground] of [
    [400, 260, [20, 150, 220], [230, 80, 40]],
    [260, 400, [220, 210, 190], [30, 70, 100]],
    [500, 200, [40, 30, 30], [130, 200, 90]],
] as const) {
    test(`regular panel correction uses pixels, independent of subject/ratio/colors ${width}×${height}`, () => {
        const pixels = new Uint8ClampedArray(width * height * 4);
        const bounds = [Math.round(width * 0.2), Math.round(height * 0.2), Math.round(width * 0.8), Math.round(height * 0.8)];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([...(x >= bounds[0] && x < bounds[2] && y >= bounds[1] && y < bounds[3] ? foreground : background), 255], (y * width + x) * 4);
        const suggestion = suggestImageLayerRegion(width, height, pixels, { bbox: [210, 210, 790, 740], shape: "rect" });
        expect(suggestion?.bbox).toEqual([200, 200, 800, 800]);
    });
}

test("ambiguous uniform image, transparent exterior and ellipse keep the original region", () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    const region = { bbox: [200, 200, 800, 800] as [number, number, number, number], shape: "rect" as const };
    expect(suggestImageLayerRegion(100, 100, pixels, region)).toBeUndefined();
    expect(suggestImageLayerRegion(100, 100, pixels.fill(0), region)).toBeUndefined();
    expect(suggestImageLayerRegion(100, 100, pixels, { ...region, shape: "ellipse" })).toBeUndefined();
});
