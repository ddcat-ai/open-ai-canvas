import { describe, expect, test } from "bun:test";

import { shouldOpenNodeGenerationPanelOnCreate } from "../src/lib/canvas/canvas-node-ui-policy";
import { CanvasNodeType } from "../src/types/canvas";

describe("节点生成面板——新建行为", () => {
    test("图片、视频、音频和生成配置新建后立即打开生成面板", () => {
        for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Config]) {
            expect(shouldOpenNodeGenerationPanelOnCreate(type)).toBe(true);
        }
    });

    test("保留插件节点原有的面板行为", () => {
        expect(shouldOpenNodeGenerationPanelOnCreate("plugin:custom-node")).toBe(true);
    });

    test("文本、脚本、绘图和背板新建后不打开生成面板", () => {
        for (const type of [CanvasNodeType.Text, CanvasNodeType.Script, CanvasNodeType.Drawing, CanvasNodeType.Frame]) {
            expect(shouldOpenNodeGenerationPanelOnCreate(type)).toBe(false);
        }
    });
});
