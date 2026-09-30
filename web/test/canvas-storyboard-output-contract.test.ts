import { describe, expect, test } from "bun:test";

import { withStoryboardOutputContract } from "../src/lib/canvas/canvas-project-domain";

// 画布「分镜脚本」节点与章节分镜都把用户输入原样交给模型，拆镜要求与 JSON 契约只能由调用方显式拼上：
// 漏掉契约时模型按自然语言习惯回复（Markdown 表格、甚至续写正文），storyboardRowsFromTask 便报
// 「分镜任务没有返回镜头行」。节点上的「N 镜」「每镜 N 秒」同理只能写进契约文本，
// 后端 canvasGenerationInput 不读 input.shotCount / input.shotDurationSeconds。
describe("withStoryboardOutputContract", () => {
    test("原样保留调用方 prompt 并追加受保护输出契约", () => {
        const source = "我睁开眼的时候，先闻到了一股煎鸡蛋的香味。";
        const prompt = withStoryboardOutputContract(source);
        expect(prompt.startsWith(source)).toBe(true);
        expect(prompt).toContain("【受保护输出契约】");
        expect(prompt).toContain('- 顶层固定为 {"title": string, "rows": object[]}，rows 至少 1 项。');
        expect(prompt).toContain("只返回一个 JSON 对象，不要 Markdown、表格、代码块、注释或任何解释文字。");
        expect(prompt).toContain("videoMotionPrompt");
    });

    test("镜头数与每镜时长写进契约文本", () => {
        const prompt = withStoryboardOutputContract("剧情正文", { shotCount: 3, shotDurationSeconds: 5 });
        expect(prompt).toContain("全片共 3 个镜头");
        expect(prompt).toContain("每镜约 5 秒，durationSeconds 填写该值");
    });

    test("未选镜头数或时长时按剧情决定，不写入 0 镜或 0 秒", () => {
        const prompt = withStoryboardOutputContract("剧情正文", { shotCount: 0, shotDurationSeconds: 0 });
        expect(prompt).not.toContain("共 0 个镜头");
        expect(prompt).not.toContain("每镜约 0 秒");
        expect(prompt).toContain("1 项。每个镜头必须能独立用于生成首帧图片和镜头视频。");
    });

    test("章节分镜沿用默认要求，与画布链路共用同一份契约", () => {
        const prompt = withStoryboardOutputContract("章节正文");
        expect(prompt).toContain("1 项。每个镜头必须能独立用于生成首帧图片和镜头视频。");
        expect(prompt).toContain("不要为压缩数量删减关键情节。");
    });
});
