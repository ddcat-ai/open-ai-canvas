import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRasterImage, prepareRasterSource } from "../src/lib/image-raster";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "../src/lib/canvas/canvas-image-data";

test("same-origin resource redirects request CORS before assigning src", async () => {
    const originalImage = globalThis.Image;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
    const requests: Array<{ src: string; crossOrigin: string }> = [];
    try {
        Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://canvas.example/", origin: "https://canvas.example" } });
        globalThis.Image = class {
            crossOrigin = "";
            naturalWidth = 940;
            naturalHeight = 1674;
            onload?: () => void;
            onerror?: () => void;
            set src(src: string) {
                requests.push({ src, crossOrigin: this.crossOrigin });
                queueMicrotask(() => this.onload?.());
            }
        } as unknown as typeof Image;
        for (const src of ["/api/resources/image/file", "https://cdn.example/image.png", "data:image/png;base64,test", "blob:local-image"]) {
            await loadRasterImage(src);
        }
        assert.deepEqual(
            requests.map((request) => request.crossOrigin),
            ["anonymous", "anonymous", "", ""],
        );
    } finally {
        globalThis.Image = originalImage;
        if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
        else Reflect.deleteProperty(globalThis, "location");
    }
});

test("crop, resize and split export a redirected resource without taint", async () => {
    const originalImage = globalThis.Image;
    const originalDocument = globalThis.document;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
    const outputs: Array<{ width: number; height: number }> = [];
    try {
        Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://canvas.example/", origin: "https://canvas.example" } });
        globalThis.Image = class {
            crossOrigin = "";
            naturalWidth = 940;
            naturalHeight = 1674;
            tainted = false;
            onload?: () => void;
            onerror?: () => void;
            set src(_src: string) {
                // Model a resource endpoint redirecting to a different image origin.
                this.tainted = this.crossOrigin !== "anonymous";
                queueMicrotask(() => this.onload?.());
            }
        } as unknown as typeof Image;
        globalThis.document = {
            createElement() {
                let tainted = false;
                return {
                    width: 0,
                    height: 0,
                    getContext() {
                        return {
                            drawImage(image: { tainted: boolean }) {
                                tainted = image.tainted;
                            },
                        };
                    },
                    toDataURL() {
                        if (tainted) throw new DOMException("Tainted canvases may not be exported", "SecurityError");
                        outputs.push({ width: this.width, height: this.height });
                        return "data:image/png;base64,output";
                    },
                };
            },
        } as unknown as Document;
        const source = "/api/resources/image/file";
        assert.match(await cropDataUrl(source, { x: 0, y: 0, width: 0.5, height: 0.5 }), /^data:image\/png/);
        assert.match(await upscaleDataUrl(source, { targetLongEdge: 2048, algorithm: "high" }), /^data:image\/png/);
        assert.equal((await splitDataUrl(source, { rows: 2, columns: 2 })).length, 4);
        assert.deepEqual(outputs[0], { width: 470, height: 837 });
        assert.deepEqual(outputs[1], { width: 1150, height: 2048 });
    } finally {
        globalThis.Image = originalImage;
        globalThis.document = originalDocument;
        if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
        else Reflect.deleteProperty(globalThis, "location");
    }
});

test("readable local sources skip remote resource reads", async () => {
    for (const url of ["data:image/png;base64,local", "blob:local-image"]) {
        const source = await prepareRasterSource(url, async () => {
            throw new Error("must not read remote bytes");
        });
        assert.equal(source.url, url);
        source.release();
    }
});

test("cached resource bytes use a Blob URL and release it", async () => {
    const blob = new Blob(["pixels"], { type: "image/png" });
    const source = await prepareRasterSource("/api/resources/image/file", async () => blob);
    assert.match(source.url, /^blob:/);
    assert.equal(await (await fetch(source.url)).text(), "pixels");
    source.release();
    await assert.rejects(fetch(source.url));
});

test("resource read failures propagate without falling back to the display URL", async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    const failure = new Error("resource authorization failed");
    try {
        globalThis.fetch = async () => {
            fetched = true;
            throw new Error("unsafe fallback");
        };
        await assert.rejects(
            prepareRasterSource("/api/resources/image/file", async () => {
                throw failure;
            }),
            (error) => error === failure,
        );
        assert.equal(fetched, false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("uncached sources fetch with CORS and create a readable Blob URL", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: unknown; options: unknown }> = [];
    try {
        globalThis.fetch = async (url, options) => {
            requests.push({ url, options });
            return new Response(new Blob(["pixels"], { type: "image/png" }));
        };
        const source = await prepareRasterSource("/api/resources/image/file", async () => null);
        assert.deepEqual(requests, [{ url: "/api/resources/image/file", options: { mode: "cors", credentials: "same-origin" } }]);
        assert.match(source.url, /^blob:/);
        source.release();
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("HTTP and CORS failures stop processing instead of returning an unsafe URL", async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response("forbidden", { status: 403 });
        await assert.rejects(prepareRasterSource("https://cdn.example/image.png"), /原图读取失败（403）/);
        const failure = new TypeError("Failed to fetch");
        globalThis.fetch = async () => {
            throw failure;
        };
        await assert.rejects(prepareRasterSource("https://cdn.example/image.png"), (error) => error === failure);
        await assert.rejects(prepareRasterSource(" "), /图片地址为空/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
