import { expect, test } from "bun:test";
import { sameBatchReferenceNode } from "@/lib/canvas/canvas-batch-row-equality";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const image: CanvasNodeData = {
    id: "shared-image",
    type: CanvasNodeType.Image,
    title: "共享参考图",
    position: { x: 20, y: 40 },
    width: 400,
    height: 300,
    metadata: { content: "/api/resources/source/file", storageKey: "resource:source", previewContent: "preview.png", prompt: "提示词", status: "success", naturalWidth: 1600, naturalHeight: 1200 },
};

test("shared reference geometry updates do not invalidate any of its 100 row references", () => {
    const resized = { ...image, position: { x: 30, y: 50 }, width: 800, height: 600, metadata: { ...image.metadata, naturalWidth: 3200, naturalHeight: 2400 } };
    const references = Array.from({ length: 100 }, () => image);
    expect(references.filter((reference) => !sameBatchReferenceNode(reference, resized))).toHaveLength(0);
    expect(sameBatchReferenceNode(image, { ...image, metadata: image.metadata })).toBe(true);
});

test("every visible or business reference field still invalidates the row", () => {
    for (const field of ["content", "storageKey", "previewContent", "prompt", "status", "fileUpload", "errorDetails"] as const) {
        const changed = { ...image, metadata: { ...image.metadata, [field]: `changed-${field}` } } as CanvasNodeData;
        expect(sameBatchReferenceNode(image, changed)).toBe(false);
    }
    expect(sameBatchReferenceNode(image, { ...image, title: "改名" })).toBe(false);
    expect(sameBatchReferenceNode(image, { ...image, type: CanvasNodeType.Text })).toBe(false);
    expect(sameBatchReferenceNode(image, { ...image, id: "replacement" })).toBe(false);
    expect(sameBatchReferenceNode(image, undefined)).toBe(false);
    expect(sameBatchReferenceNode(undefined, image)).toBe(false);
    expect(sameBatchReferenceNode(undefined, undefined)).toBe(true);
});

test("text references retain content and fallback-prompt invalidation", () => {
    const text = { ...image, type: CanvasNodeType.Text, metadata: { content: "原文", prompt: "补充描述" } };
    expect(sameBatchReferenceNode(text, { ...text, width: 500 })).toBe(true);
    expect(sameBatchReferenceNode(text, { ...text, metadata: { ...text.metadata, content: "修改后的原文" } })).toBe(false);
    expect(sameBatchReferenceNode(text, { ...text, metadata: { ...text.metadata, prompt: "修改后的描述" } })).toBe(false);
});
