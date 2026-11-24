import { type CanvasNodeData } from "@/types/canvas";

/** 文本和 Markdown 共用节点，只有展示格式不同。 */
export function isMarkdownText(node: CanvasNodeData | null | undefined) {
    return node?.metadata?.textFormat === "markdown";
}
