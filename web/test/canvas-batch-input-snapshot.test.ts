import { describe, expect, test } from "bun:test";

import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { createCanvasBatchInputSnapshot, resolveCanvasBatchInputContext } from "@/lib/canvas/canvas-batch-input-snapshot";
import { canvasGenerationInputPrompt } from "@/lib/canvas/canvas-generation-input-prompt";
import { collectImageStorageKeys } from "@/services/image-storage";
import { collectLocalMediaKeys } from "@/services/user-data-sync-media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function input(id = "input", storageKey = "resource:original-image"): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: "人物", position: { x: 0, y: 0 }, width: 200, height: 300, metadata: { content: "/api/resources/original-image/file", storageKey, mimeType: "image/png", naturalWidth: 200, naturalHeight: 300 } };
}

function output(prompt = "保留人物身份"): CanvasNodeData {
    return { id: "output", type: CanvasNodeType.Image, title: "任务 1", position: { x: 400, y: 0 }, width: 200, height: 300, metadata: { prompt, composerContent: prompt, batchInputNodeIds: ["input"] } };
}

const connections: CanvasConnection[] = [{ id: "input-output", fromNodeId: "input", toNodeId: "output" }];

describe("batch image input snapshot", () => {
    test("排队后源图旋转、替换或删除，执行仍传入入队时的资源版本", async () => {
        const original = input();
        const target = output();
        const snapshot = createCanvasBatchInputSnapshot(target, [original, target], connections, []);
        const reloaded = JSON.parse(JSON.stringify(snapshot));
        const rotated = { ...original, metadata: { ...original.metadata, content: "/api/resources/rotated-image/file", storageKey: "resource:rotated-image" } };
        const current = buildNodeGenerationContext(target.id, [rotated, target], connections, "新提示词", []);
        expect(current.referenceImages[0].storageKey).toBe("resource:rotated-image");

        let liveReadCount = 0;
        const frozen = resolveCanvasBatchInputContext(reloaded, () => {
            liveReadCount += 1;
            return buildNodeGenerationContext(target.id, [target], [], "新提示词", []);
        });
        const submitted = await hydrateNodeGenerationContext(frozen, "test-canvas", undefined, "image", false, true, undefined, false);

        expect(liveReadCount).toBe(0);
        expect(submitted.referenceImages.map((image) => image.storageKey)).toEqual(["resource:original-image"]);
        expect(submitted.prompt).toBe("保留人物身份");
        expect(submitted.referenceImages[0].dataUrl).toBe("");
        expect([submitted.referenceImages[0].width, submitted.referenceImages[0].height]).toEqual([200, 300]);
        expect(snapshot.context.referenceImages[0].storageKey).toBe("resource:original-image");
    });

    test("编译显式图片和文本引用后冻结内容与图片顺序，编辑原文本不会改队列", () => {
        const original = input();
        const other = input("other", "resource:scene-image");
        const note: CanvasNodeData = { id: "note", type: CanvasNodeType.Text, title: "要求", position: { x: 0, y: 0 }, width: 200, height: 120, metadata: { content: "黄昏暖光" } };
        const target = output("@[node:input] @[node:other] @[node:note]");
        const edges = [...connections, { id: "scene-output", fromNodeId: "other", toNodeId: "output" }, { id: "note-output", fromNodeId: "note", toNodeId: "output" }];
        const snapshot = createCanvasBatchInputSnapshot(target, [original, other, note, target], edges, []);
        note.metadata!.content = "阴天冷光";
        target.metadata!.composerContent = "不要参考图";

        expect(snapshot.prompt).toBe("@[node:input] @[node:other] @[node:note]");
        expect(snapshot.context.prompt).toContain("黄昏暖光");
        expect(snapshot.context.prompt).not.toContain("阴天冷光");
        expect(snapshot.context.referenceImages.map((image) => image.storageKey)).toEqual(["resource:original-image", "resource:scene-image"]);
    });

    test("失败重试取得独立上下文，前次hydrate写入不能污染持久快照", () => {
        const source = input();
        const target = output();
        const snapshot = createCanvasBatchInputSnapshot(target, [source, target], connections, []);
        const firstAttempt = resolveCanvasBatchInputContext(snapshot, () => {
            throw new Error("must not read live input");
        });
        firstAttempt.referenceImages[0].dataUrl = "data:image/png;base64,temporary";
        firstAttempt.prompt = "临时处理文本";
        const retry = resolveCanvasBatchInputContext(snapshot, () => {
            throw new Error("must not read live input");
        });

        expect(retry.prompt).toBe("保留人物身份");
        expect(retry.referenceImages[0].dataUrl).toBe("");
        expect(snapshot.context.referenceImages[0].dataUrl).toBe("");
    });

    test("无快照的既有队列继续解析当前输入", () => {
        const source = input("input", "resource:current-image");
        const target = output();
        const resolved = resolveCanvasBatchInputContext(undefined, () => buildNodeGenerationContext(target.id, [source, target], connections, "当前输入", []));
        expect(resolved.prompt).toBe("当前输入");
        expect(resolved.referenceImages[0].storageKey).toBe("resource:current-image");
    });

    test("嵌套快照纳入本地资源保留和上传扫描，不持久化blob地址或图片字节", () => {
        const source = input("input", "image:local-preview:original");
        source.metadata!.content = "blob:http://localhost/temporary";
        const target = output();
        const snapshot = createCanvasBatchInputSnapshot(target, [source, target], connections, []);
        const savedCanvas = { nodes: [{ metadata: { generationBatches: [{ items: [{ inputSnapshot: snapshot }] }] } }] };

        expect([...collectImageStorageKeys(savedCanvas)]).toEqual(["image:local-preview:original"]);
        expect(collectLocalMediaKeys(savedCanvas)).toEqual(["image:local-preview:original"]);
        expect(JSON.stringify(snapshot)).not.toContain("blob:");
        expect(JSON.stringify(snapshot)).not.toContain("data:image");
    });

    test("无持久存储键的临时图片必须先保存，不能把失效URL排入队列", () => {
        const source = input();
        source.metadata!.storageKey = undefined;
        source.metadata!.content = "blob:http://localhost/temporary";
        const target = output();
        expect(() => createCanvasBatchInputSnapshot(target, [source, target], connections, [])).toThrow("尚未保存为资源");
    });

    test("相机参数和直接生成共用提示词准备，不在执行时重复拼入", () => {
        const source = input();
        const target = output();
        target.metadata!.cameraControl = { enabled: true, camera: "arri_alexa_mini_lf", lens: "cooke_s7i", focalLength: 50, aperture: 2.8 };
        const snapshot = createCanvasBatchInputSnapshot(target, [source, target], connections, []);
        expect(snapshot.context.prompt).toBe(canvasGenerationInputPrompt(target, "image", "保留人物身份"));
        expect(snapshot.context.prompt).not.toBe(snapshot.prompt);
    });
});
