import { expect, test } from "bun:test";
import { connectCanvasTextMention } from "@/lib/canvas/canvas-text-mention";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const nodes: CanvasNodeData[] = [
    { id: "text", type: CanvasNodeType.Text, title: "镜头正文", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { content: "清晨，人物推开木门" } },
    { id: "video", type: CanvasNodeType.Video, title: "镜头1", position: { x: 500, y: 0 }, width: 300, height: 200 },
];

test("selecting an unconnected text mention connects and expands its content for video generation", () => {
    const linked = connectCanvasTextMention(nodes, [], "video", "text", "edge");
    expect(linked.connections).toEqual([{ id: "edge", fromNodeId: "text", toNodeId: "video" }]);
    expect(linked.reference.active).toBe(true);
    const prompt = `${canvasResourceMentionToken(linked.reference)} 缓慢运镜`;
    const context = buildNodeGenerationContext("video", linked.nodes, linked.connections, prompt, []);
    expect(context.prompt).toContain("清晨，人物推开木门");
    expect(context.prompt).toContain("缓慢运镜");
    expect(connectCanvasTextMention(linked.nodes, linked.connections, "video", "text", "duplicate").connections).toHaveLength(1);
});

test("text mentions follow a connected Config and reject cycles, self references and locked targets", () => {
    const config: CanvasNodeData = { ...nodes[1], id: "config", type: CanvasNodeType.Config };
    const other: CanvasNodeData = { ...nodes[0], id: "other" };
    const linked = connectCanvasTextMention([...nodes, config, other], [{ id: "config-edge", fromNodeId: "video", toNodeId: "config" }, { id: "existing", fromNodeId: "other", toNodeId: "config" }], "video", "text", "edge");
    expect(linked.connections[2].toNodeId).toBe("config");
    expect(linked.reference.label).toBe("文本2");
    expect(linked.reference.nodeId).toBe("text");
    expect(() => connectCanvasTextMention(nodes, [{ id: "reverse", fromNodeId: "video", toNodeId: "text" }], "video", "text", "edge")).toThrow("循环");
    expect(() => connectCanvasTextMention(nodes, [], "text", "text", "edge")).toThrow();
    expect(() => connectCanvasTextMention(nodes.map((node) => node.id === "video" ? { ...node, metadata: { locked: true } } : node), [], "video", "text", "edge")).toThrow();
});

test("appending a text reference preserves existing mention numbering with an empty Config", () => {
    const other: CanvasNodeData = { ...nodes[0], id: "other", metadata: { content: "原有文本" } };
    const config: CanvasNodeData = { ...nodes[1], id: "config", type: CanvasNodeType.Config };
    const linked = connectCanvasTextMention([...nodes, other, config], [{ id: "old", fromNodeId: "other", toNodeId: "video" }, { id: "config", fromNodeId: "video", toNodeId: "config" }], "video", "text", "new");
    expect(linked.connections[2].toNodeId).toBe("video");
    expect(linked.reference.label).toBe("文本2");
    const context = buildNodeGenerationContext("video", linked.nodes, linked.connections, "@文本1 @文本2", []);
    expect(context.prompt).toContain("原有文本");
    expect(context.prompt).toContain("清晨，人物推开木门");
});
