import { collectUpstreamVideoNodes } from "@/lib/canvas/canvas-resource-references";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

export type CanvasTimelineSegmentItem = {
    id: string;
    startMs: number;
    endMs: number;
    sourceNodeId?: string;
    sourceStorageKey?: string;
    sourceUrl?: string;
};

export type TimelineImportResult = { ok: true; segments: CanvasTimelineSegmentItem[] } | { ok: false; error: string };

const MIN_TIMELINE_SEGMENT_MS = 100;

export function buildTimelineImportSegments(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], timeline: TimelineProject | null | undefined, durationMs: number): TimelineImportResult {
    const candidateNodes = collectUpstreamVideoNodes(node.id, nodes, connections);
    const matchesCandidate = (clip: TimelineClip, candidate: CanvasNodeData) => {
        if (candidate.id === clip.nodeId) return true;
        if (candidate.metadata?.assetId && clip.nodeId === candidate.metadata.assetId) return true;
        if (candidate.metadata?.storageKey && clip.directMedia?.storageKey === candidate.metadata.storageKey) return true;
        // 旧数据里 nodeId 可能被重新生成过；标题一致且唯一时才回退，避免同名视频误导入。
        if (candidate.title && clip.title === candidate.title && !clip.directMedia) {
            return candidateNodes.filter((item) => item.title === candidate.title).length === 1;
        }
        return false;
    };
    const clips = (timeline?.clips || []).filter((clip) => clip.kind === "video" && candidateNodes.some((candidate) => matchesCandidate(clip, candidate)));
    if (!clips.length) {
        return { ok: false, error: `未找到「${node.title || "当前视频节点"}」或其上游视频节点在时间线中的片段，请先在时间线中加入对应视频节点` };
    }
    const segments = clips.flatMap((clip) => {
        const matchedNode = candidateNodes.find((candidate) => matchesCandidate(clip, candidate));
        const startMs = Math.max(0, Math.round(clip.sourceStartMs ?? 0));
        const rawEndMs = startMs + Math.max(MIN_TIMELINE_SEGMENT_MS, Math.round(clip.sourceDurationMs || clip.durationMs));
        const sourceDurationMs = matchedNode?.metadata?.durationMs || durationMs;
        const endMs = sourceDurationMs > 0 ? Math.min(sourceDurationMs, rawEndMs) : rawEndMs;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
        return [
            {
                id: `timeline-${clip.id}`,
                startMs,
                endMs,
                sourceNodeId: matchedNode?.id,
                sourceStorageKey: clip.directMedia?.storageKey || matchedNode?.metadata?.storageKey,
                sourceUrl: clip.directMedia?.url || matchedNode?.metadata?.content,
            },
        ];
    });
    if (!segments.length) return { ok: false, error: "时间线片段数据不完整，请先在时间线中重新分割或保存" };
    return { ok: true, segments };
}
