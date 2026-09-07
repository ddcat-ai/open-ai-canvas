import { describe, expect, test } from "bun:test";

import { agentSlashQuery, collectAgentMentionReferences, insertAgentSkill } from "../src/lib/canvas/canvas-agent-input";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { buildCanvasResourceReferences } from "../src/lib/canvas/canvas-resource-references";

const textNode = (id: string, title: string): CanvasNodeData => ({ id, type: CanvasNodeType.Text, title, position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { content: "正文" } });

describe("canvas agent input protocol", () => {
    test("slash selection replaces the slash query and keeps following text", () => {
        const value = "请整理 /剧本 里的内容";
        const slash = agentSlashQuery(value.slice(0, 7));
        expect(slash).toEqual({ start: 4, query: "剧本" });
        expect(insertAgentSkill(value, slash, "skill-1")).toBe("请整理 @[skill:skill-1] 里的内容");
    });

    test("mentions use stable node tokens and do not match a longer label", () => {
        const nodes = [textNode("n1", "图片1"), textNode("n2", "图片10")];
        const references = buildCanvasResourceReferences(nodes, [], null);
        expect(collectAgentMentionReferences("请看 @[node:n1]", references, nodes, [])).toHaveLength(1);
        expect(collectAgentMentionReferences("请看 @文本1 之后", references, nodes, [])).toHaveLength(1);
        expect(collectAgentMentionReferences("请看 @文本10", references, nodes, [])).toHaveLength(0);
    });
});
