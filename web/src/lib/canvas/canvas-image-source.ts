import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 已有媒体但没有生成配置的图片是输入素材，不提供原地生成入口。 */
export function isCanvasImageSourceNode(node: CanvasNodeData | null | undefined): boolean {
    if (node?.type === CanvasNodeType.Image && node.metadata?.fileUpload) return true;
    return node?.type === CanvasNodeType.Image
        && Boolean(node.metadata?.content)
        && !node.metadata?.generationType
        && !node.metadata?.taskId
        && !node.metadata?.generationResultPlacement
        && !node.metadata?.copiedFromNodeId
        && !node.metadata?.versionOfNodeId;
}

export function createPortraitTextureNode(source: CanvasNodeData, id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: `${source.title || "图片"} · 人物质感`,
        position: { x: source.position.x + source.width + 96, y: source.position.y },
        width: source.width,
        height: source.height,
        metadata: {
            prompt: "@图片1",
            composerContent: "@图片1",
            generationType: "edit",
            portraitTexture: source.metadata?.portraitTexture,
        },
    };
}
