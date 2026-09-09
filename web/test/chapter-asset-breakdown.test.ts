import { describe, expect, test } from "bun:test";
import { parseChapterAssetBreakdown } from "../src/lib/canvas/chapter-asset-breakdown";

describe("章节三类资产解析", () => {
    test("无角色章节仍可提取场景和道具", () => {
        const result = parseChapterAssetBreakdown(JSON.stringify({ characters: [], scenes: [{ name: "车站", description: "空旷站台", prompt: "夜间站台" }], props: [{ name: "信封", description: "牛皮纸信封", prompt: "褐色信封特写" }] }));
        expect(result.characters).toEqual([]);
        expect(result.scenes[0].name).toBe("车站");
        expect(result.props[0].name).toBe("信封");
    });
    test("缺失数组或缺失描述不能静默跳过", () => {
        expect(() => parseChapterAssetBreakdown('{"characters":[]}')).toThrow("缺少");
        expect(() => parseChapterAssetBreakdown('{"characters":[],"scenes":[{"name":"车站"}],"props":[]}')).toThrow("description");
    });
    test("支持围栏 JSON 和无资产章节", () => {
        expect(parseChapterAssetBreakdown('```json\n{"characters":[],"scenes":[],"props":[]}\n```')).toEqual({ characters: [], scenes: [], props: [] });
    });
    test("忽略正文解释但仍校验完整资产对象", () => {
        expect(parseChapterAssetBreakdown('提取结果如下：\n{"characters":[],"scenes":[],"props":[]}\n以上为全部结果。')).toEqual({ characters: [], scenes: [], props: [] });
    });
});
