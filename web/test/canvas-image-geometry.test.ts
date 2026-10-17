import { describe, expect, test } from "bun:test";

import { createImageUploadPlaceholder } from "../src/lib/canvas/canvas-file-upload";
import { ensureMediaNodeMinimumSize, fitImageNodeSize, fitNodeSize, imageNodeSizeFromRatio, preserveImageNodeSize } from "../src/lib/canvas/canvas-node-size";
import { commitCanvasGenerationResult } from "../src/lib/canvas/canvas-generation-result";
import { buildGenerationTaskNodeResult } from "../src/lib/canvas/canvas-generation-task-sync";
import { apiClient } from "../src/services/api/request";
import { clearResourceAccessCache } from "../src/services/api/resources";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const file = { name: "image.png", size: 100, type: "image/png" };
const imageNode = (): CanvasNodeData => ({ id: "image", type: CanvasNodeType.Image, title: "图片", width: 300, height: 500, position: { x: 100, y: 50 }, metadata: { content: "/image.png", naturalWidth: 600, naturalHeight: 1000 } });

describe("bounded image geometry", () => {
    for (const [width, height] of [
        [1920, 1080],
        [900, 1600],
        [100, 10000],
        [10000, 100],
        [8, 8],
    ]) {
        test(`upload and reload preserve ratio without exceeding bounds: ${width}x${height}`, () => {
            const node = createImageUploadPlaceholder("image", file, { x: 100, y: 200 }, { width, height });
            expect(node.width).toBeLessThanOrEqual(720);
            expect(node.height).toBeLessThanOrEqual(520);
            expect(node.width / node.height).toBeCloseTo(width / height);
            expect(node.position.x + node.width / 2).toBeCloseTo(100);
            expect(node.position.y + node.height / 2).toBeCloseTo(200);
            expect(ensureMediaNodeMinimumSize(node)).toBe(node);
        });
    }

    test("portrait generation placeholder uses the same bounds as loaded image", () => {
        expect(imageNodeSizeFromRatio("9:16")).toEqual(fitImageNodeSize(900, 1600));
        expect(imageNodeSizeFromRatio("1:100")).toEqual(fitImageNodeSize(100, 10000));
        expect(imageNodeSizeFromRatio("auto")).toBeNull();
        expect(fitNodeSize(900, 1600).width).toBe(420); // Existing video policy stays separate.
    });

    for (const property of ["manualSize", "locked", "freeResize"] as const) {
        test(`${property} geometry survives reopening even below old minimum`, () => {
            const node = { ...imageNode(), width: 60, height: 100, metadata: { ...imageNode().metadata, [property]: true } };
            expect(ensureMediaNodeMinimumSize(node)).toBe(node);
            expect(preserveImageNodeSize(node, { width: 500, height: 500 })).toEqual({ width: 60, height: 100 });
        });
    }

    test("generated result cannot overwrite a resize made while the task was running", () => {
        const original = { ...imageNode(), metadata: { taskId: "task" } };
        const resized = { ...original, width: 150, height: 250, position: { x: 175, y: 175 }, metadata: { ...original.metadata, manualSize: true } };
        const result = { ...original, ...fitImageNodeSize(3000, 4000), metadata: { ...original.metadata, content: "/result.png", naturalWidth: 3000, naturalHeight: 4000 } };
        const committed = commitCanvasGenerationResult([resized], original, result, "task")[0];
        expect(committed.width).toBe(150);
        expect(committed.height).toBe(250);
        expect(committed.position).toEqual(resized.position);
        expect(committed.metadata?.content).toBe("/result.png");
        expect(ensureMediaNodeMinimumSize(committed)).toBe(committed);
        for (const property of ["locked", "freeResize"] as const) {
            const changedDuringRequest = { ...original, metadata: { ...original.metadata, [property]: true } };
            const protectedResult = commitCanvasGenerationResult([changedDuringRequest], original, result, "task")[0];
            expect(protectedResult.width).toBe(original.width);
            expect(protectedResult.height).toBe(original.height);
        }
    });

    test("actual task result projection uses decoded ratio and preserves protected display geometry", async () => {
        const adapter = apiClient.defaults.adapter;
        const requests: string[] = [];
        clearResourceAccessCache();
        apiClient.defaults.adapter = async (config) => {
            requests.push(config.url || "");
            if (config.url !== "/resources/access") throw new Error("Unexpected request");
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: [{ access: { url: "/api/resources/image-geometry-test/file" } }] } } };
        };
        try {
            const task = {
                id: "task",
                type: "canvas_image",
                status: "succeeded" as const,
                prompt: "",
                attempts: 1,
                createdAt: "",
                updatedAt: "",
                resultJson: JSON.stringify({ images: [{ dataUrl: "/portrait.png", storageKey: "resource:image-geometry-test", width: 900, height: 1600 }] }),
            };
            const original = { ...imageNode(), width: 720, height: 405, metadata: { generationType: "edit" as const, size: "auto" } };
            const result = await buildGenerationTaskNodeResult(original, task);
            expect(result.width).toBeCloseTo(292.5);
            expect(result.height).toBe(520);
            expect(result.metadata?.naturalWidth).toBe(900);
            expect(result.metadata?.naturalHeight).toBe(1600);
            expect(ensureMediaNodeMinimumSize(result)).toBe(result);
            for (const property of ["manualSize", "locked", "freeResize"] as const) {
                const protectedNode = { ...original, width: 180, height: 320, metadata: { ...original.metadata, [property]: true } };
                const projected = await buildGenerationTaskNodeResult(protectedNode, task);
                expect(projected.width).toBe(180);
                expect(projected.height).toBe(320);
                expect(projected.position).toEqual(protectedNode.position);
            }
            const unknownSizeTask = { ...task, resultJson: JSON.stringify({ images: [{ dataUrl: "/portrait.png", storageKey: "resource:image-geometry-test" }] }) };
            const unknownSize = await buildGenerationTaskNodeResult({ ...original, metadata: { size: "9:16" } }, unknownSizeTask);
            expect(unknownSize.width / unknownSize.height).toBeCloseTo(9 / 16);
            expect(unknownSize.metadata?.naturalWidth).toBe(0);
            expect(unknownSize.metadata?.naturalHeight).toBe(0);
            expect(requests).toEqual(["/resources/access"]);
        } finally {
            apiClient.defaults.adapter = adapter;
            clearResourceAccessCache();
        }
    });
});
