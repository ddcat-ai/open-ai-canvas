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

test("归一化或修补后的新资源可独立保存且拒绝沿用原任务素材", () => {
    const derived = { ...original, metadata: { ...original.metadata, storageKey: "resource:normalized", layerExtraction: { ...original.metadata!.layerExtraction!, sourceResultStorageKey: "resource:original" } } };
    const asset = { ...canvasNodeToAsset(original, { canvasId: "canvas", source: "canvas-generation" }), id: "original-asset", createdAt: "", updatedAt: "" } as Asset;
    expect(requiresMaterializedCanvasAsset(derived)).toBe(false);
    expect(findCanvasNodeAsset([asset], original, "canvas")?.id).toBe("original-asset");
    expect(findCanvasNodeAsset([asset], derived, "canvas")).toBeUndefined();
});

test("生成任务物化素材缺少 nodeId 时仍按任务和资源绑定到节点", () => {
    const generated = {
        ...canvasNodeToAsset(original, { canvasId: "canvas", source: "canvas-generation", taskId: "generation" }),
        id: "materialized-asset",
        createdAt: "",
        updatedAt: "",
        metadata: { source: "generation-task", taskId: "generation", resourceKey: "resource:original" },
    } as Asset;
    expect(findCanvasNodeAsset([generated], original, "canvas", "generation")?.id).toBe("materialized-asset");
});

test("本地图层合成和手工上传可登记各自资源", () => {
    const composite = { ...original, metadata: { ...original.metadata, storageKey: "resource:composite", imageLayerGroup: { width: 400, height: 300, layers: [], compositeStatus: "ready" as const } } };
    expect(requiresMaterializedCanvasAsset(composite)).toBe(false);
    expect(requiresMaterializedCanvasAsset({ ...original, metadata: { content: "/upload.png", storageKey: "resource:upload" } })).toBe(false);
});
