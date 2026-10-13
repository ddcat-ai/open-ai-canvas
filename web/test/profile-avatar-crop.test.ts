import { describe, expect, test } from "bun:test";
import { centeredAspectSelection, resizeSelection, translateSelection, type CropGrip } from "../src/lib/canvas/image-crop-selection";
import { cropProfileAvatar, planProfileAvatarCrop } from "../src/services/profile-avatar";

describe("fixed avatar crop geometry", () => {
    test("starts with the largest centered square on wide, tall and odd images", () => {
        for (const size of [
            { width: 1200, height: 800 },
            { width: 800, height: 1200 },
            { width: 901, height: 600 },
        ]) {
            const crop = centeredAspectSelection(size, 1);
            expect(crop.width * size.width).toBeCloseTo(Math.min(size.width, size.height));
            expect(crop.height * size.height).toBeCloseTo(Math.min(size.width, size.height));
            expect(crop.x + crop.width / 2).toBeCloseTo(0.5);
            expect(crop.y + crop.height / 2).toBeCloseTo(0.5);
            const plan = planProfileAvatarCrop(size, crop);
            expect(plan.source.width).toBe(plan.source.height);
            expect(plan.outputSide).toBe(512);
        }
    });
    test("every locked grip and movement preserves physical square pixels", () => {
        const size = { width: 1200, height: 600 };
        const initial = centeredAspectSelection(size, 1);
        for (const x of [-1, 0, 1] as const)
            for (const y of [-1, 0, 1] as const) {
                if (!x && !y) continue;
                const resized = resizeSelection(initial, [x, y] as CropGrip, -0.1, -0.1, true);
                const moved = translateSelection(resized, 0.2, -0.3);
                expect(moved.width * size.width).toBeCloseTo(moved.height * size.height);
                expect(planProfileAvatarCrop(size, moved).source.width).toBe(planProfileAvatarCrop(size, moved).source.height);
            }
    });
    test("square crops on panoramic images can shrink from every grip and remain square", () => {
        for (const size of [
            { width: 2000, height: 100 },
            { width: 100, height: 2000 },
        ]) {
            const initial = centeredAspectSelection(size, 1);
            for (const x of [-1, 0, 1] as const)
                for (const y of [-1, 0, 1] as const) {
                    if (!x && !y) continue;
                    const next = resizeSelection(initial, [x, y], (-x * initial.width) / 4, (-y * initial.height) / 4, true);
                    expect(next.width * size.width).toBeCloseTo(75);
                    expect(next.height * size.height).toBeCloseTo(75);
                    expect(next.x).toBeGreaterThanOrEqual(0);
                    expect(next.y).toBeGreaterThanOrEqual(0);
                    expect(next.x + next.width).toBeLessThanOrEqual(1);
                    expect(next.y + next.height).toBeLessThanOrEqual(1);
                }
        }
    });
    test("one-pixel keyboard steps shrink panoramic squares and enforce a reachable positive minimum", () => {
        for (const size of [
            { width: 2000, height: 100 },
            { width: 100, height: 2000 },
        ]) {
            const initial = centeredAspectSelection(size, 1);
            expect(resizeSelection(initial, [1, 0], -1 / size.width, 0, true).width * size.width).toBeCloseTo(99);
            expect(resizeSelection(initial, [0, 1], 0, -1 / size.height, true).height * size.height).toBeCloseTo(99);
            const smallest = resizeSelection(initial, [1, 1], -10, -10, true);
            expect(smallest.width * size.width).toBeCloseTo(6);
            expect(smallest.height * size.height).toBeCloseTo(6);
        }
    });
    test("rejects decoded images over 16M pixels, invalid and non-square crops", () => {
        expect(() => planProfileAvatarCrop({ width: 4001, height: 4000 }, { x: 0, y: 0, width: 1, height: 1 })).toThrow("1600");
        expect(() => planProfileAvatarCrop({ width: 100, height: 100 }, { x: 0, y: 0, width: 1, height: 0.5 })).toThrow("正方形");
        expect(() => centeredAspectSelection({ width: 100, height: 0 }, 1)).toThrow();
        expect(() => centeredAspectSelection({ width: 100, height: 100 }, 0)).toThrow();
        expect(() => planProfileAvatarCrop({ width: 100, height: 100 }, { x: 2, y: 0, width: 1, height: 1 })).toThrow();
        expect(planProfileAvatarCrop({ width: 100, height: 100 }, { x: 0.2, y: 0.3, width: 0.4, height: 0.4 })).toEqual({ source: { x: 20, y: 30, width: 40, height: 40 }, outputSide: 40 });
    });
});

async function withRasterDOM(width: number, height: number, run: (state: { drawn: unknown[][]; imageSources: string[]; canvas: { width: number; height: number }; failExport: () => void }) => Promise<void>) {
    const previousImage = globalThis.Image;
    const previousDocument = globalThis.document;
    const drawn: unknown[][] = [];
    const imageSources: string[] = [];
    let exportFails = false;
    class TestImage {
        naturalWidth = width;
        naturalHeight = height;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
            imageSources.push(value);
            if (value) queueMicrotask(() => this.onload?.());
        }
    }
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...values: unknown[]) => drawn.push(values) }), toBlob: (callback: (blob: Blob | null) => void) => callback(exportFails ? null : new Blob(["png"], { type: "image/png" })) };
    Object.assign(globalThis, { Image: TestImage, document: { createElement: () => canvas } });
    try {
        await run({
            drawn,
            imageSources,
            canvas,
            failExport: () => {
                exportFails = true;
            },
        });
    } finally {
        Object.assign(globalThis, { Image: previousImage, document: previousDocument });
    }
}

describe("avatar PNG export", () => {
    test("draws the chosen source region into a square bounded by 512 and releases buffers", async () => {
        await withRasterDOM(1200, 800, async ({ drawn, canvas, imageSources }) => {
            const file = await cropProfileAvatar("blob:test", { x: 0.25, y: 0.125, width: 0.5, height: 0.75 }, "../../private.jpg");
            expect(drawn[0].slice(1)).toEqual([300, 100, 600, 600, 0, 0, 512, 512]);
            expect(file.name).toBe("avatar.png");
            expect(file.type).toBe("image/png");
            expect(file.size).toBeGreaterThan(0);
            expect(canvas.width).toBe(0);
            expect(canvas.height).toBe(0);
            expect(imageSources.at(-1)).toBe("");
        });
    });
    test("fails explicitly when PNG export fails and still releases image and canvas", async () => {
        await withRasterDOM(100, 100, async ({ failExport, canvas, imageSources }) => {
            failExport();
            await expect(cropProfileAvatar("blob:test", { x: 0, y: 0, width: 1, height: 1 }, "avatar.jpg")).rejects.toThrow("PNG");
            expect(canvas.width).toBe(0);
            expect(imageSources.at(-1)).toBe("");
        });
    });
    test("rejects pixel bombs before drawing", async () => {
        await withRasterDOM(5000, 5000, async ({ drawn, imageSources }) => {
            await expect(cropProfileAvatar("blob:test", { x: 0, y: 0, width: 1, height: 1 }, "avatar.jpg")).rejects.toThrow("1600");
            expect(drawn).toHaveLength(0);
            expect(imageSources.at(-1)).toBe("");
        });
    });
});
