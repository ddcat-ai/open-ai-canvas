import { expect, test } from "bun:test";

import { deselectVisibleModels, filterImportModels, selectExistingImportModels, selectVisibleModels } from "../src/pages/admin/components/channel-model-import-selection";

const MODELS = [
    "MiniMax-H3",
    "004系列/MiniMax-H3(933/10-15秒768P)",
    "004系列/sd2.5(30--0-10卡脸4-30秒/720P)",
    "gpt-image-1",
    "doubao-seedream-4",
];

test("关键字为空时返回全部模型", () => {
    expect(filterImportModels(MODELS, "")).toEqual(MODELS);
    expect(filterImportModels(MODELS, "   ")).toEqual(MODELS);
});

test("按子串匹配，且大小写不敏感", () => {
    expect(filterImportModels(MODELS, "minimax")).toEqual([MODELS[0], MODELS[1]]);
    expect(filterImportModels(MODELS, "MINIMAX")).toEqual([MODELS[0], MODELS[1]]);
});

test("关键字首尾空白不影响匹配", () => {
    expect(filterImportModels(MODELS, "  sd2.5  ")).toEqual([MODELS[2]]);
});

test("没有命中时返回空数组（弹窗据此显示空态）", () => {
    expect(filterImportModels(MODELS, "不存在的模型")).toEqual([]);
});

test("全选只并入当前可见集合，关键字外的勾选保留", () => {
    const visible = filterImportModels(MODELS, "minimax");
    expect(selectVisibleModels(["gpt-image-1"], visible)).toEqual(["gpt-image-1", MODELS[0], MODELS[1]]);
});

test("全选不会产生重复项", () => {
    const visible = filterImportModels(MODELS, "minimax");
    expect(selectVisibleModels([MODELS[0]], visible)).toEqual([MODELS[0], MODELS[1]]);
});

test("无关键字时全选等于选中全部，与旧行为一致", () => {
    expect(selectVisibleModels([], filterImportModels(MODELS, ""))).toEqual(MODELS);
});

test("取消选中只移除可见的，隐藏的勾选不动", () => {
    const visible = filterImportModels(MODELS, "minimax");
    expect(deselectVisibleModels([MODELS[0], MODELS[1], "gpt-image-1"], visible)).toEqual(["gpt-image-1"]);
});

test("无关键字时取消选中等于清空，与旧行为一致", () => {
    expect(deselectVisibleModels(MODELS, filterImportModels(MODELS, ""))).toEqual([]);
});

test("已有模型默认勾选，新模型默认不勾选，沿用上游标识匹配规则", () => {
    const available = ["models/gpt-a", "new-model", " GPT-B ", "gpt-c"];
    expect(selectExistingImportModels(available, ["gpt-a", "models/gpt-b", "gpt-c"])).toEqual(["models/gpt-a", " GPT-B ", "gpt-c"]);
    expect(selectExistingImportModels(available, [])).toEqual([]);
});
