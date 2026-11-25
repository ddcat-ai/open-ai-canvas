import { afterEach, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { buildCharacterDressingInput, dressingImages, dressingSnapshot, saveCharacterDressing } from "../src/services/character-dressing";
import { defaultConfig, createModelChannel, encodeChannelModel } from "../src/stores/use-config-store";
import type { ProjectCharacterDetail } from "../src/services/api/projects";
import type { GenerationTask } from "../src/services/api/task-center";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});

test("六槽图序按用途固定，同图去重后仍保留全部用途，包含基础图的超限被拒绝", () => {
    const channel = createModelChannel({ id: "image-channel", name: "图片", interfaceType: "volcengine-ark-image", models: ["doubao-seedream-4-0-250828"] });
    const model = encodeChannelModel(channel.id, "doubao-seedream-4-0-250828");
    const config = { ...defaultConfig, channels: [channel], model, imageModel: model };
    const detail = { asset: { id: "person", title: "人物" }, character: { versionId: "v1", definition: {} } } as ProjectCharacterDetail;
    const input = buildCharacterDressingInput({
        detail,
        outfit: { id: "base", name: "默认", resourceId: "base" },
        nodeId: "node",
        prompt: "",
        config,
        references: [
            { category: "pose", resourceId: "shared", title: "站立" },
            { category: "clothing", resourceId: "shared", title: "红衣" },
        ],
    });
    expect(input.referenceImages.map((image) => image.storageKey)).toEqual(["resource:base", "resource:shared"]);
    expect(input.prompt).toContain("衣服：使用参考图2");
    expect(input.prompt).toContain("姿势：使用参考图2");
    expect(input.prompt.indexOf("衣服：")).toBeLessThan(input.prompt.indexOf("姿势："));
    const singleChannel = createModelChannel({ id: "single", name: "文生图", interfaceType: "openai-images", models: ["grok-imagine-image"] });
    const singleModel = encodeChannelModel(singleChannel.id, "grok-imagine-image");
    expect(() =>
        buildCharacterDressingInput({ detail, outfit: { id: "base", name: "默认", resourceId: "base" }, nodeId: "node", prompt: "换衣", config: { ...defaultConfig, channels: [singleChannel], model: singleModel, imageModel: singleModel } }),
    ).toThrow();
});
const task = {
    id: "task1",
    status: "succeeded",
    resultState: "READY",
    inputJson: JSON.stringify({ metadata: { source: "character-dressing-table", dressing: { characterAssetId: "person", baseResourceId: "base", nodeId: "node" } } }),
    resultJson: JSON.stringify({ images: [{ storageKey: "resource:output" }] }),
} as GenerationTask;

test("结果未就绪时不能保存，只有稳定资源可以进入角色形象", async () => {
    expect(dressingImages({ ...task, resultState: "MATERIALIZING" })).toEqual([]);
    expect(dressingImages(task)).toEqual([{ resourceId: "output", width: undefined, height: undefined }]);
    expect(dressingSnapshot({ ...task, inputJson: "invalid" })).toBeUndefined();
    await expect(saveCharacterDressing(task, "foreign-output", "新形象", "v1")).rejects.toThrow("不属于");
});

test("命名保存经角色 API 写回，保留旧形象与来源，重复保存复用已有形象", async () => {
    let writes = 0;
    let definition: Record<string, unknown> = { outfits: [{ id: "old", name: "旧形象", resourceId: "base" }] };
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "put") {
            const body = JSON.parse(config.data);
            expect(body.expectedVersionId).toBe("v1");
            expect(body.operationId).toBe("dressing:task1:output");
            expect(body.definition.outfits[0].resourceId).toBe("base");
            expect(body.definition.outfits[1].source.taskId).toBe("task1");
            definition = body.definition;
            writes++;
        }
        return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { asset: { id: "person", title: "人物" }, character: { versionId: "v1", definition, representations: [] } } } };
    };
    const first = await saveCharacterDressing(task, "output", " 新形象 ", "v1");
    expect(first.outfitId).toBe("output");
    expect((await saveCharacterDressing(task, "output", "新形象", "v1")).outfitId).toBe(first.outfitId);
    expect(writes).toBe(1);
});

test("旧生成形象手动换图后再次保存任务结果，保留两项不同形象", async () => {
    const definition = { outfits: [{ id: "output", name: "手动换图", resourceId: "manual-image" }] };
    apiClient.defaults.adapter = async (config) => {
        let next = definition;
        if (config.method === "put") {
            expect(JSON.parse(config.data).operationId).toBe("dressing:task1:output-1");
            next = JSON.parse(config.data).definition;
            expect(next.outfits.map((item) => item.id)).toEqual(["output", "output-1"]);
            expect(next.outfits.map((item) => item.resourceId)).toEqual(["manual-image", "output"]);
        }
        return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { asset: { id: "person", title: "人物" }, character: { versionId: "v1", definition: next, representations: [] } } } };
    };
    expect((await saveCharacterDressing(task, "output", "重新保存原结果", "v1")).outfitId).toBe("output-1");
});
