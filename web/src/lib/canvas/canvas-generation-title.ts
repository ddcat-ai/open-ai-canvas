import { getNodeSpec } from "@/constant/canvas";
import { isBuiltinCanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { canvasPromptSummaryText } from "./canvas-resource-references";

const COPY_SUFFIX = /(_copy\d+|\s+Copy)$/i;
const VERSION_SUFFIX = /\s*·\s*([A-Z])\s*$/;
const TITLE_MAX_LENGTH = 32;

/** 生成结果节点的默认标题：取提示词摘要，@ 引用令牌不以原始编码出现在标题里。 */
export function buildGenerationNodeTitle(prompt: string, fallback: string) {
    return canvasPromptSummaryText(prompt).slice(0, TITLE_MAX_LENGTH) || fallback;
}

export function manualNodeTitle(node: CanvasNodeData | undefined) {
    if (!node?.title.trim()) return undefined;
    const metadata = node.metadata;
    if (metadata?.manualTitle !== undefined) return metadata.manualTitle ? node.title : undefined;
    if (metadata?.content || metadata?.storageKey || metadata?.taskId || metadata?.copiedFromNodeId || metadata?.versionOfNodeId) return undefined;
    return isBuiltinCanvasNodeType(node.type) && node.title !== getNodeSpec(node.type).title ? node.title : undefined;
}

export function buildImageGenerationNodeTitle(prompt: string, sourceNode?: CanvasNodeData, outputIndex?: number, outputCount = 1) {
    let title = buildGenerationNodeTitle(prompt, "Generated Image");
    if (sourceNode) {
        const sourceTitleWithoutVersion = sourceNode.title.replace(VERSION_SUFFIX, "");
        const copySuffix = sourceTitleWithoutVersion.match(COPY_SUFFIX)?.[1] || "";
        const versionLabel = validVersionLabel(sourceNode.metadata?.versionLabel) || sourceNode.title.match(VERSION_SUFFIX)?.[1] || "";
        const titleWithoutVersion = title.replace(VERSION_SUFFIX, "");
        if (copySuffix && !titleWithoutVersion.toLowerCase().endsWith(copySuffix.toLowerCase())) title += copySuffix;
        if (versionLabel && !title.endsWith(` · ${versionLabel}`)) title += ` · ${versionLabel}`;
    }
    if (outputCount > 1 && outputIndex !== undefined) title += ` · ${outputIndex + 1}`;
    return title;
}

function validVersionLabel(value?: string) {
    const normalized = value?.trim().toUpperCase() || "";
    return /^[A-Z]$/.test(normalized) ? normalized : "";
}
