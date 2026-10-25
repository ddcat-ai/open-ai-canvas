import { expect, test } from "bun:test";
import { canvasNodeToAsset, findCanvasNodeAsset, requiresMaterializedCanvasAsset } from "@/lib/canvas/canvas-node-asset";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { Asset } from "@/stores/use-asset-store";

const original: CanvasNodeData = {
    id: "layer",
    type: CanvasNodeType.Image,
    title: "前景",
    position: { x: 0, y: 0 },
    width: 400,
    height: 300,
    metadata: { taskId: "generation", content: "/original.png", storageKey: "resource:original", layerExtraction: { sourceNodeId: "source", groupId: "group", index: 1, phase: "complete" } },
};

test("原生生成图层仍须复用服务端素材，不能因缓存缺失重复登记", () => {
    expect(requiresMaterializedCanvasAsset(original)).toBe(true);
    expect(requiresMaterializedCanvasAsset({ ...original, metadata: { ...original.metadata, layerExtraction: { ...original.metadata!.layerExtraction!, sourceResultStorageKey: "resource:original" } } })).toBe(true);
});

test("任务临时图片只可预览，手动保存也不能创建随机素材", () => {
    const preview = { ...original, metadata: { content: "/api/tasks/generation/source-image", storageKey: "task-source:generation", taskId: "generation" } };
    expect(requiresMaterializedCanvasAsset(preview)).toBe(true);
    expect(canvasNodeToAsset(preview, { canvasId: "canvas", source: "canvas-manual" })).toBeNull();
});

test("归一化或修补后的新资源可独立保存且拒绝沿用原任务素材", () => {
    const derived = { ...original, metadata: { ...original.metadata, storageKey: "resource:normalized", layerExtraction: { ...original.metadata!.layerExtraction!, sourceResultStorageKey: "resource:original" } } };
    const asset = { ...canvasNodeToAsset(original, { canvasId: "canvas", source: "canvas-generation" }), id: "original-asset", createdAt: "", updatedAt: "" } as Asset;
    expect(requiresMaterializedCanvasAsset(derived)).toBe(false);
    expect(findCanvasNodeAsset([asset], original, "canvas")?.id).toBe("original-asset");
    expect(findCanvasNodeAsset([asset], derived, "canvas")).toBeUndefined();
});

test("本地图层合成和手工上传可登记各自资源", () => {
    const composite = { ...original, metadata: { ...original.metadata, storageKey: "resource:composite", imageLayerGroup: { width: 400, height: 300, layers: [], compositeStatus: "ready" as const } } };
    expect(requiresMaterializedCanvasAsset(composite)).toBe(false);
    expect(requiresMaterializedCanvasAsset({ ...original, metadata: { content: "/upload.png", storageKey: "resource:upload" } })).toBe(false);
});
