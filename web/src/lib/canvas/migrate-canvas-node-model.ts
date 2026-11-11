import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type CanvasDocument = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
const retiredTypes = new Set(["markdown", "html", "svg", "chart", "compare"]);

/** 仅用于本地文档恢复和工程导入边界；运行时只有统一后的节点模型。 */
export function migrateCanvasNodeModel<T extends CanvasDocument>(document: T): T {
    if (!document.nodes.some((node) => retiredTypes.has(node.type))) return document;
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    const nodes = document.nodes.map((node) => {
        if (!retiredTypes.has(node.type)) return node;
        const metadata = { ...node.metadata, textFormat: node.type === "markdown" ? ("markdown" as const) : ("plain" as const) };
        if (node.type === "compare" && !metadata.content) {
            const sources = document.connections.filter((edge) => edge.toNodeId === node.id).map((edge) => ({ id: edge.fromNodeId, title: byId.get(edge.fromNodeId)?.title || edge.fromNodeId }));
            metadata.content = sources.length ? `对比参考：\n${sources.map((source) => `${source.title} @[node:${source.id}]`).join("\n")}` : "图片对比已移到预览：选中两张图片后使用“对比图片”。";
        }
        delete (metadata as Record<string, unknown>).chartKind;
        return { ...node, type: CanvasNodeType.Text, metadata };
    });
    const migrated = { ...document, nodes };
    delete (migrated as Record<string, unknown>).remoteContentHash;
    return migrated;
}
