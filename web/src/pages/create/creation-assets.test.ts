import assert from "node:assert/strict";
import test from "node:test";

// Node 原生 TypeScript 测试运行器要求保留扩展名，项目编译器不允许该写法。
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { creationAssetKey, isSameCreationAsset } from "./creation-assets.ts";

test("同一任务的同一结果只能匹配同一个素材", () => {
    const identity = { taskId: "task-1", resultIndex: 0 };
    const asset = { metadata: { creationAssetKey: creationAssetKey(identity) } };

    assert.equal(isSameCreationAsset(asset, identity), true);
    assert.equal(isSameCreationAsset(asset, { taskId: "task-1", resultIndex: 1 }), false);
});

test("不同任务的结果不能被误判为重复素材", () => {
    const asset = { metadata: { creationAssetKey: creationAssetKey({ taskId: "task-1", resultIndex: 0 }) } };

    assert.equal(isSameCreationAsset(asset, { taskId: "task-2", resultIndex: 0 }), false);
});

test("修复前只保存任务 ID 的素材首个结果仍可被识别", () => {
    const asset = { metadata: { source: "create-generation", taskId: "task-legacy" } };

    assert.equal(isSameCreationAsset(asset, { taskId: "task-legacy", resultIndex: 0 }), true);
    assert.equal(isSameCreationAsset(asset, { taskId: "task-legacy", resultIndex: 1 }), false);
});
