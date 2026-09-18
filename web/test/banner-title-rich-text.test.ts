import { expect, test } from "bun:test";

import { bannerDocToRuns, bannerTitleRunsToDoc } from "@/lib/announcements/banner-title-rich-text";

test("样式分段与编辑文档互转保持幂等", () => {
    const runs = [
        { text: "限时活动", fontSize: 16, fontWeight: 700, color: "#FF0000" },
        { text: "已上线", fontFamily: "mono" as const },
        { text: "，欢迎体验" },
    ];
    const doc = bannerTitleRunsToDoc(runs);
    expect(doc.content?.[0]?.type).toBe("paragraph");
    expect(bannerDocToRuns(doc)).toEqual(runs);
});

test("编辑器文档里的白名单外样式在转回分段时被丢弃", () => {
    const doc = {
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "标题",
                        marks: [{ type: "textStyle", attrs: { fontSize: "40px", fontWeight: "900", color: "red", fontFamily: "Comic Sans" } }],
                    },
                ],
            },
        ],
    };
    expect(bannerDocToRuns(doc)).toEqual([{ text: "标题" }]);
});

test("同一节点上的多个 textStyle 标记按出现顺序合并取值", () => {
    const doc = {
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: "标题",
                        marks: [
                            { type: "textStyle", attrs: { fontSize: "12px" } },
                            { type: "textStyle", attrs: { fontSize: "18px", color: "#00ff00" } },
                        ],
                    },
                ],
            },
        ],
    };
    expect(bannerDocToRuns(doc)).toEqual([{ text: "标题", fontSize: 18, color: "#00FF00" }]);
});

test("多段文档只取首个段落，粘贴内容不会变成多行标题", () => {
    const doc = {
        type: "doc",
        content: [
            { type: "paragraph", content: [{ type: "text", text: "第一行" }] },
            { type: "paragraph", content: [{ type: "text", text: "第二行" }] },
        ],
    };
    expect(bannerDocToRuns(doc)).toEqual([{ text: "第一行" }]);
});

test("空文档与空分段互转不报错", () => {
    expect(bannerDocToRuns(undefined)).toEqual([]);
    expect(bannerDocToRuns(null)).toEqual([]);
    expect(bannerTitleRunsToDoc([])).toEqual({ type: "doc", content: [{ type: "paragraph", content: [] }] });
});
