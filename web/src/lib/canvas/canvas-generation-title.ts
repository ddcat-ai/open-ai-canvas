import type { CanvasNodeData } from "@/types/canvas";

const COPY_SUFFIX = /(_copy\d+|\s+Copy)$/i;
const VERSION_SUFFIX = /\s*·\s*([A-Z])\s*$/;

export function buildImageGenerationNodeTitle(prompt: string, sourceNode?: CanvasNodeData, outputIndex?: number, outputCount = 1) {
    let title = prompt.trim().slice(0, 32) || "Generated Image";
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
