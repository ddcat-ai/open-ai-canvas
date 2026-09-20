import { describe, expect, test } from "bun:test";

import { parseListModeJson, parseStoryboardJson, requestedListRowCount } from "@/pages/canvas/list-mode-generator";

test("extracts the requested row count from natural language", () => {
    expect(requestedListRowCount("帮我生成5个卖点")).toBe(5);
    expect(requestedListRowCount("请写十条小红书标题")).toBe(10);
    expect(requestedListRowCount("分析这张图")).toBeUndefined();
});

describe("list mode response parsing", () => {
    test("rejects invalid rows instead of creating an empty success table", () => {
        for (const rows of [[], [null, 1, "bad", []]]) {
            expect(parseListModeJson(JSON.stringify({ columns: ["detail"], rows }))).toBeNull();
            expect(parseStoryboardJson(JSON.stringify({ rows }))).toBeNull();
        }
    });

    test("does not turn missing or invalid timestamps into a first-frame request", () => {
        for (const time of [null, "", " ", false, -1, "invalid"]) {
            const parsed = parseStoryboardJson(JSON.stringify({ rows: [{ plotDescription: "shot", keyframeTimeSeconds: time }] }));
            expect(parsed?.rows[0].keyframeTimeMs).toBeUndefined();
        }
        expect(parseStoryboardJson('{"rows":[{"keyframeTimeSeconds":0}]}')?.rows[0].keyframeTimeMs).toBe(0);
    });
    test("parses plain JSON", () => {
        expect(parseListModeJson('{"columns":["卖点"],"rows":[{"卖点":"轻便"}]}')).toEqual({
            columns: ["卖点"],
            rows: [{ 卖点: "轻便" }],
        });
    });

    test("parses markdown JSON with surrounding explanation", () => {
        expect(parseListModeJson('结果如下：\n```json\n{"columns":["标题"],"rows":[{"标题":"新品"}]}\n```\n')).toEqual({
            columns: ["标题"],
            rows: [{ 标题: "新品" }],
        });
    });

    test("normalizes duplicate columns and non-string cells", () => {
        expect(parseListModeJson('{"columns":["卖点","卖点","细节"],"rows":[{"卖点":["轻","薄"],"细节":123}]}')).toEqual({
            columns: ["卖点", "细节"],
            rows: [{ 卖点: "轻、薄", 细节: "123" }],
        });
    });

    test("rejects malformed responses", () => {
        expect(parseListModeJson("模型暂时无法分析")).toBeNull();
        expect(parseListModeJson('{"columns":[],"rows":[]}')).toBeNull();
    });

    test("parses a storyboard response and derives generation prompts", () => {
        const result = parseStoryboardJson('```json\n{"title":"拆解","rows":[{"durationSeconds":3,"plotDescription":"产品推近","motion":"缓慢推进","keyframeTimeSeconds":1.5}]}\n```');
        expect(result?.title).toBe("拆解");
        expect(result?.rows[0]).toMatchObject({ durationSeconds: 3, plotDescription: "产品推近", motion: "缓慢推进", videoMotionPrompt: "产品推近；缓慢推进", keyframeTimeMs: 1500 });
    });
});
