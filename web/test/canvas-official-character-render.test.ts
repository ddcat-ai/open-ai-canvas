import { expect, test } from "bun:test";
import { canvasNodeUsesCustomContent } from "@/components/canvas/canvas-node-content";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("官方角色引用无需个人素材 ID 也显示角色卡", () => {
    const node: CanvasNodeData = {
        id: "official-character", type: CanvasNodeType.Text, title: "角色", position: { x: 0, y: 0 }, width: 264, height: 352,
        metadata: { workflowKind: "character", officialAssetId: "official-1", characterDefinition: { role: "主角" } },
    };
    expect(canvasNodeUsesCustomContent(node)).toBe(true);
    expect(canvasNodeUsesCustomContent({ ...node, metadata: { workflowKind: "character" } })).toBe(false);
});
