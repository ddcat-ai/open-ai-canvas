import type { ProjectUnit } from "@/services/api/projects";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasContextSummary = {
    nodeCount: number;
    selectedCount: number;
    chapterLabel: string;
    shotLabel: string;
};

export function summarizeCanvasContext(nodes: CanvasNodeData[], selectedNodeIds: Set<string>, units: ProjectUnit[] = []): CanvasContextSummary {
    const selectedNodes = nodes.filter((node) => selectedNodeIds.has(node.id));
    const unitTitleById = new Map(units.map((unit) => [unit.id, unit.title]));
    const chapterTitles = unique(selectedNodes.flatMap((node) => {
        const chapterTitle = node.metadata?.chapterTitle || (node.metadata?.chapterId ? unitTitleById.get(node.metadata.chapterId) : "");
        return chapterTitle ? [chapterTitle] : [];
    }));
    const shotIndexes = unique(selectedNodes.flatMap((node) => typeof node.metadata?.shotIndex === "number" ? [node.metadata.shotIndex] : []));

    return {
        nodeCount: nodes.length,
        selectedCount: selectedNodes.length,
        chapterLabel: chapterTitles.length === 1 ? chapterTitles[0] : chapterTitles.length > 1 ? `${chapterTitles.length} 个章节` : "",
        shotLabel: shotIndexes.length === 1 ? `镜头 ${shotIndexes[0] + 1}` : shotIndexes.length > 1 ? `${shotIndexes.length} 个镜头` : "",
    };
}

function unique<T>(values: T[]) {
    return Array.from(new Set(values));
}
