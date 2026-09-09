import { expect, test } from "bun:test";
import { composeCanvasAgentAnswers, parseCanvasAgentReply, extractCanvasAgentQuickActions } from "../src/lib/canvas/canvas-agent-reply";

test("requires every group and combines the latest selections with their headings", () => {
    const blocks = parseCanvasAgentReply("篇幅：[短篇](#) | [中篇](#)\n核心冲突：[旧爱重逢](#) | [亲情和解](#)");
    expect(composeCanvasAgentAnswers(blocks, {})).toBeNull();
    expect(composeCanvasAgentAnswers(blocks, { 1: "短篇" })).toBeNull();
    expect(composeCanvasAgentAnswers(blocks, { 1: "短篇", 3: "无效选项" })).toBeNull();
    expect(composeCanvasAgentAnswers(blocks, { 1: "中篇", 3: "亲情和解" })).toBe("篇幅：中篇\n核心冲突：亲情和解");
});

test("keeps all grouped choices and removes only their separators", () => {
    const text = "已确定为都市情感。\n还需要确认两个要素：\n**篇幅：** [短篇约1000字](#) ｜ [中篇约3000字](#) ｜ [60秒短视频剧本](#)\n**核心冲突：** [旧爱重逢](#) | [身份误会](#) | [家庭分歧](#) | [事业抉择](#)";
    const blocks = parseCanvasAgentReply(text);
    const groups = blocks.filter((block) => block.kind === "choices");
    expect(groups.map((group) => group.actions.length)).toEqual([3, 4]);
    expect(extractCanvasAgentQuickActions(text)).toHaveLength(7);
    expect(blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n")).toBe("已确定为都市情感。\n还需要确认两个要素：\n**篇幅：**\n**核心冲突：**");
    expect(groups[1].actions.at(-1)).toEqual({ label: "事业抉择", prompt: "事业抉择" });
});

test("list choices do not leave empty bullets or hash links", () => {
    const blocks = parseCanvasAgentReply("请选择：\n- [科幻](#)\n- [都市](#)\n- [悬疑](#)\n- [喜剧](#)\n- [奇幻](#)");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: "text", text: "请选择：" });
    expect(extractCanvasAgentQuickActions("请选择：\n- [一](#)\n- [二](#)\n- [三](#)\n- [四](#)\n- [五](#)")).toHaveLength(5);
});

test("preserves prose, real links, images, inline code and tables", () => {
    const text = "正文含 [备注] 和 A | B。\n[文档](https://example.com)\n![图片](photo.png)\n`[代码]`\n| 分类 | [内容] |\n| --- | --- |";
    expect(parseCanvasAgentReply(text)).toEqual([{ kind: "text", text }]);
});

test("preserves fenced code and ordinary numbered narrative", () => {
    const text = "```text\n请选择：\n1. 不是按钮\n[一](#) | [二](#)\n```\n1. 第一幕\n2. 第二幕";
    expect(parseCanvasAgentReply(text)).toEqual([{ kind: "text", text }]);
});

test("parses lettered bracket choices in a multi-question confirmation", () => {
    const text = "请先确认 3 项信息：\n1. 故事题材 / 核心冲突\nA 恐怖悬疑\nB 暗黑童话\nC 哥特怪诞\nD 科幻末日\nE 自定义\n\n2. 成片时长\nA 30 秒\nB 60 秒\n\n3. 风格与受众\n[A 森海风格：哥特怪诞卡通+暗黑童话+电影感]\n[B 写实电影感]\n[C 动画短片]\n[D 自定义风格与受众]";
    const groups = parseCanvasAgentReply(text).filter((block) => block.kind === "choices");
    expect(groups.map((group) => group.actions.map((action) => action.label))).toEqual([
        ["A 恐怖悬疑", "B 暗黑童话", "C 哥特怪诞", "D 科幻末日", "E 自定义"],
        ["A 30 秒", "B 60 秒"],
        ["A 森海风格：哥特怪诞卡通+暗黑童话+电影感", "B 写实电影感", "C 动画短片", "D 自定义风格与受众"],
    ]);
});

test("requires and uses custom values for custom choices", () => {
    const blocks = parseCanvasAgentReply("请确认 2 项信息：\n1. 题材\n[A 科幻] [E 自定义]\n2. 时长\n[A 30 秒] [E 自定义]");
    expect(composeCanvasAgentAnswers(blocks, { 1: "E 自定义", 3: "A 30 秒" })).toBeNull();
    expect(composeCanvasAgentAnswers(blocks, { 1: "E 自定义", 3: "A 30 秒" }, { 1: "都市职场悬疑" })).toBe("都市职场悬疑\nA 30 秒");
});
