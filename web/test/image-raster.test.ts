import { afterEach, describe, expect, test } from "bun:test";
import { loadRasterImage } from "../src/lib/image-raster";

const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

afterEach(() => {
    if (originalImage) Object.defineProperty(globalThis, "Image", originalImage);
    else Reflect.deleteProperty(globalThis, "Image");
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else Reflect.deleteProperty(globalThis, "location");
});

function mockImageLoading(requiresDisplayMode = false) {
    class Picture {
        naturalWidth = 1600;
        naturalHeight = 900;
        crossOrigin = "";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(value: string) {
            if (!value) return;
            if (requiresDisplayMode && this.crossOrigin) this.onerror?.();
            else this.onload?.();
        }
    }
    Object.defineProperty(globalThis, "Image", { value: Picture, configurable: true });
    Object.defineProperty(globalThis, "location", { value: { href: "http://127.0.0.1:3000/", origin: "http://127.0.0.1:3000" }, configurable: true });
}

describe("raster image loading modes", () => {
    test("pixel processing keeps anonymous CORS for remote images", async () => {
        mockImageLoading();
        const image = await loadRasterImage("https://cdn.example.com/image.png");
        expect(image.crossOrigin).toBe("anonymous");
    });

    test("mask preview can read dimensions without source pixel CORS", async () => {
        mockImageLoading(true);
        const image = await loadRasterImage("https://cdn.example.com/image.png", undefined, { readPixels: false });
        expect(image.crossOrigin).toBe("");
        expect([image.naturalWidth, image.naturalHeight]).toEqual([1600, 900]);
        await expect(loadRasterImage("https://cdn.example.com/image.png")).rejects.toThrow("图片加载失败");
    });

    test("aborted display reads remain cancelled", async () => {
        mockImageLoading();
        const controller = new AbortController();
        controller.abort();
        await expect(loadRasterImage("https://cdn.example.com/image.png", controller.signal, { readPixels: false })).rejects.toMatchObject({ name: "AbortError" });
    });
});
