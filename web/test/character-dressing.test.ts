import { afterEach, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { dressingImages, dressingSnapshot, saveCharacterDressing } from "../src/services/character-dressing";
import type { GenerationTask } from "../src/services/api/task-center";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
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
