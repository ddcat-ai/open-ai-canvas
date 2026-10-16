import { afterEach, describe, expect, test } from "bun:test";

import { applyGeneratedMediaResultMetadata, applyGenerationTaskResultToNodes, generationTaskOutputsApplied, shouldRecoverCanvasImageOutputs, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { commitCanvasGenerationResult } from "@/lib/canvas/canvas-generation-result";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-task-state";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { useAssetStore, withAssetStorePersistenceSuppressed, type ImageAsset } from "@/stores/use-asset-store";

const initialAssets = useAssetStore.getState().assets;
afterEach(() => withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: initialAssets })));

function imageAsset(id: string, storageKey: string): ImageAsset {
    return { id, kind: "image", title: id, coverUrl: "/image.png", tags: [], createdAt: "", updatedAt: "", data: { dataUrl: "", storageKey, width: 640, height: 480, bytes: 10, mimeType: "image/png" } };
}

function videoNode(assetId: string, storageKey: string): CanvasNodeData {
    return {
        id: "node-1",
        type: CanvasNodeType.Video,
        title: "镜头",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { assetId, storageKey, content: "https://example.test/old.mp4", prompt: "旧提示词" },
    };
}

describe("applyGeneratedMediaResultMetadata", () => {
    test("旧 Midjourney 单图节点需要补齐结果，新堆叠与普通模型不重复恢复", () => {
        const old = { ...videoNode("asset", "resource:old"), type: CanvasNodeType.Image, metadata: { content: "/old.png", status: "success" as const, taskId: "task", producedModel: "CHANNEL::Midjourney v8.2 高速" } };
        const task = { id: "task", type: "canvas_image", status: "succeeded" as const, prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ images: Array.from({ length: 4 }, () => ({ dataUrl: "/image.png" })) }) };
        expect(shouldRecoverCanvasImageOutputs(old)).toBe(true);
        expect(generationTaskOutputsApplied(old, task)).toBe(false);
        expect(shouldRecoverCanvasImageOutputs({ ...old, metadata: { ...old.metadata, generationOutputCount: 4 } })).toBe(false);
        const completed = { ...old, metadata: { ...old.metadata, generationOutputCount: 4, storageKey: "resource:old" } };
        expect(generationTaskOutputsApplied(completed, task)).toBe(false);
        withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [imageAsset("asset", "resource:old")] }));
        expect(generationTaskOutputsApplied({ ...completed, metadata: { ...completed.metadata, assetId: "asset" } }, task)).toBe(true);
        expect(shouldRecoverCanvasImageOutputs({ ...old, metadata: { ...old.metadata, batchRootId: "root" } })).toBe(false);
        expect(shouldRecoverCanvasImageOutputs({ ...old, metadata: { ...old.metadata, producedModel: "other-model" } })).toBe(false);
        expect(resetGenerationTaskMetadata({ generationOutputCount: 4 }).generationOutputCount).toBeUndefined();
    });
    test("交付完成必须匹配资源与素材，不能只凭成功状态、数量或旧素材 ID", () => {
        const node = { ...videoNode("asset", "resource:new"), type: CanvasNodeType.Image, metadata: { assetId: "asset", storageKey: "resource:new", content: "/new.png", status: "success" as const, taskId: "task", generationOutputCount: 1 } };
        const task = { id: "task", type: "canvas_image", status: "succeeded" as const, prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ images: [{ dataUrl: "/new.png", storageKey: "resource:new" }] }) };
        const staleAsset = { ...imageAsset("asset", "resource:old"), metadata: { taskId: "task", nodeId: node.id } };
        withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [staleAsset] }));
        expect(generationTaskOutputsApplied(node, task)).toBe(false);
        withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [imageAsset("asset", "resource:new")] }));
        expect(generationTaskOutputsApplied(node, task)).toBe(true);
        expect(generationTaskOutputsApplied({ ...node, metadata: { ...node.metadata, assetId: "missing" } }, task)).toBe(false);
    });
    test("图层组恢复检查每个现存子图绑定，已删除图层不需要复活", () => {
        const root: CanvasNodeData = { ...videoNode("composite", "resource:composite"), type: CanvasNodeType.Image, metadata: { assetId: "composite", storageKey: "resource:composite", content: "/composite.png", status: "success", taskId: "task", generationOutputCount: 2, batchChildIds: ["child", "deleted"], imageLayerGroup: { width: 640, height: 480, layers: [{ nodeId: "child", x: 0, y: 0, visible: true }] } } };
        const child: CanvasNodeData = { ...root, id: "child", metadata: { batchRootId: root.id, content: "/child.png", storageKey: "resource:child" } };
        const task = { id: "task", type: "canvas_image", status: "succeeded" as const, prompt: "", attempts: 1, createdAt: "", updatedAt: "", resultJson: JSON.stringify({ images: [{ dataUrl: "/first.png" }, { dataUrl: "/second.png" }] }) };
        withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [imageAsset("composite", "resource:composite"), imageAsset("child-asset", "resource:child")] }));
        expect(generationTaskOutputsApplied(root, task, [root, child])).toBe(false);
        const boundChild = { ...child, metadata: { ...child.metadata, assetId: "child-asset" } };
        expect(generationTaskOutputsApplied(root, task, [root, boundChild])).toBe(true);
        const ordinaryBatch = { ...root, metadata: { ...root.metadata, imageLayerGroup: undefined } };
        expect(generationTaskOutputsApplied(ordinaryBatch, task, [ordinaryBatch, boundChild])).toBe(false);
    });
    test("多图提交保留保存期间的移动和改名，重复提交不新增或覆盖图片", () => {
        const before = { ...videoNode("", ""), type: CanvasNodeType.Image, metadata: { taskId: "task" } };
        const result = { ...before, metadata: { taskId: "task", content: "/new.png", isBatchRoot: true, batchChildIds: ["child"] } };
        const child = { ...result, id: "child", position: { x: 440, y: 0 }, metadata: { content: "/child.png", batchRootId: before.id } };
        const live = { ...before, title: "改名", position: { x: 500, y: 100 } };
        const committed = commitCanvasGenerationResult([live], before, result, "task", [child]);
        expect(committed[0]).toMatchObject({ title: "改名", position: { x: 500, y: 100 } });
        expect(committed[1].position).toEqual({ x: 940, y: 100 });
        const edited = { ...committed[1], title: "我的图片", position: { x: 3000, y: 2000 } };
        expect(commitCanvasGenerationResult([committed[0], edited], before, result, "task", [child])).toEqual([committed[0], edited]);
        expect(() => commitCanvasGenerationResult([], before, result, "task", [child])).toThrow("已删除");
        expect(() => commitCanvasGenerationResult([{ ...live, metadata: { taskId: "new-task" } }], before, result, "task", [child])).toThrow("其他生成任务");
    });
    test("明确指定的节点已删除时不能根据 taskId 误更新其他节点", async () => {
        const other = { ...videoNode("asset", "video:key"), metadata: { taskId: "task" } };
        const applied = await applyGenerationTaskResultToNodes([other], { id: "task", type: "canvas_video", status: "succeeded", prompt: "", attempts: 1, createdAt: "", updatedAt: "" }, "deleted-node");
        expect(applied.updated).toBe(false);
        expect(applied.nodes).toEqual([other]);
    });
    test("clears the previous asset binding when a regenerated media result lands", () => {
        const node = videoNode("asset-old", "video:old");
        const next = applyGeneratedMediaResultMetadata(node, videoMetadata({
            url: "https://example.test/new.mp4",
            storageKey: "video:new",
            width: 1280,
            height: 720,
            bytes: 12,
            mimeType: "video/mp4",
            durationMs: 4000,
        }), { prompt: "新提示词" });

        expect(next.assetId).toBeUndefined();
        expect(next.storageKey).toBe("video:new");
        expect(next.content).toBe("https://example.test/new.mp4");
        expect(next.prompt).toBe("新提示词");
        expect(next.status).toBe("success");
    });
});
