import { describe, expect, test } from "bun:test";

import { canvasResourceIds, clearMissingCanvasResources } from "@/services/canvas-missing-resources";

describe("canvas missing resource overwrite", () => {
    test("collects nested resource locators without treating prompt text as media", () => {
        const value = {
            nodes: [{ id: "node-1", metadata: { storageKey: "resource:gone", prompt: "resource:keep-as-text", videoPreview: { url: "/api/resources/poster/file" } } }],
        };
        expect(canvasResourceIds(value)).toEqual(new Set(["gone", "poster"]));
    });

    test("removes only invalid media fields and asset binding while keeping node content", () => {
        const value = {
            id: "canvas",
            nodes: [{ id: "node-1", type: "image", metadata: { assetId: "asset-1", storageKey: "resource:gone", content: "/api/resources/gone/file", prompt: "keep this prompt", status: "success" } }],
            timeline: { clips: [{ id: "clip", directMedia: { kind: "image", assetId: "asset-1", storageKey: "resource:gone", url: "/api/resources/gone/file" } }] },
        };
        const repaired = clearMissingCanvasResources(value, new Set(["gone"]));
        expect(repaired).toEqual({
            id: "canvas",
            nodes: [{ id: "node-1", type: "image", metadata: { prompt: "keep this prompt", status: "idle" } }],
            timeline: { clips: [{ id: "clip", directMedia: { kind: "image" } }] },
        });
    });

    test("server reported locator fields are also cleared during the fallback", () => {
        const value = { nodes: [{ id: "node-1", metadata: { assetId: "asset-1", futureLocator: "resource:gone", prompt: "keep" } }] };
        expect(clearMissingCanvasResources(value, new Set(["gone"]), "", true)).toEqual({
            nodes: [{ id: "node-1", metadata: { assetId: "asset-1", prompt: "keep" } }],
        });
    });
});
