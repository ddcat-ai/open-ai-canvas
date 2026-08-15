import { describe, expect, test } from "bun:test";

import { expandStoryboardTextMentions } from "../src/lib/canvas/canvas-project-domain";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";

describe("expandStoryboardTextMentions", () => {
    test("展开引用控件保存的 canonical node token", () => {
        const references: CanvasResourceReference[] = [{
            id: "script-node",
            nodeId: "script-node",
            kind: "text",
            label: "文本1",
            title: "完整剧本",
            text: "第一场：主角推开仓库大门。",
            active: true,
        }];

        expect(expandStoryboardTextMentions("@[node:script-node] 拆成 8 个镜头", references)).toBe(
            "【项目设定：完整剧本】\n第一场：主角推开仓库大门。 拆成 8 个镜头",
        );
    });
});
