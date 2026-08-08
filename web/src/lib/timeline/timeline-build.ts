// 从画布节点构建时间线数据：视频/音频节点自动入轨，字幕条目转成字幕片段。
// 构建是单向快照：时间线保存后用户可自由拖拽，重新构建不覆盖已有时间线。

import type { CanvasNodeData } from "@/types/canvas";
import type { SrtEntry, TimelineClip, TimelineProject } from "@/types/timeline";
import { DEFAULT_AUDIO_TRACK_ID, DEFAULT_SUBTITLE_TRACK_ID, DEFAULT_VIDEO_TRACK_ID, createDefaultTracks } from "./timeline-tracks";
import { getTimelineVisualEndMs } from "./timeline-view";

function nodeDurationMs(node: CanvasNodeData, fallbackMs = 4_000): number {
    const durationMs = node.metadata?.durationMs;
    return durationMs && durationMs > 0 ? Math.round(durationMs) : fallbackMs;
}

/**
 * 从画布节点生成时间线片段。
 * - 视频节点 → 视频轨片段（顺序排布，首尾相接）；
 * - 音频节点 → 音频轨片段（顺序排布）；
 * - 视频节点的字幕条目 → 字幕轨片段（相对该视频片段起点偏移）。
 */
export function buildTimelineFromNodes(nodes: CanvasNodeData[]): TimelineProject {
    const videoNodes = nodes.filter((node) => node.type === "video" && Boolean(node.metadata?.content || node.metadata?.storageKey));
    const audioNodes = nodes.filter((node) => node.type === "audio" && Boolean(node.metadata?.content || node.metadata?.storageKey));
    const clips: TimelineClip[] = [];

    let videoCursorMs = 0;
    for (const node of videoNodes) {
        const durationMs = nodeDurationMs(node);
        clips.push({
            id: `clip-${node.id}`,
            kind: "video",
            nodeId: node.id,
            trackId: DEFAULT_VIDEO_TRACK_ID,
            startMs: videoCursorMs,
            durationMs,
            title: node.title || "视频片段",
            sourceStartMs: 0,
            sourceDurationMs: durationMs,
        });

        const entries = node.metadata?.subtitleEntries || [];
        for (const entry of entries) {
            const startMs = videoCursorMs + Math.max(0, entry.startMs);
            const endMs = videoCursorMs + Math.max(entry.startMs, Math.min(entry.endMs, durationMs));
            clips.push({
                id: `clip-${node.id}-sub-${entry.index}`,
                kind: "subtitle",
                nodeId: node.id,
                trackId: DEFAULT_SUBTITLE_TRACK_ID,
                startMs,
                durationMs: Math.max(100, endMs - startMs),
                title: entry.text || "字幕",
                sourceStartMs: entry.startMs,
                sourceDurationMs: Math.max(0, entry.endMs - entry.startMs),
                subtitleEntryIndex: entry.index,
                text: entry.text,
            });
        }
        videoCursorMs += durationMs;
    }

    let audioCursorMs = 0;
    for (const node of audioNodes) {
        const durationMs = nodeDurationMs(node);
        clips.push({
            id: `clip-${node.id}`,
            kind: "audio",
            nodeId: node.id,
            trackId: DEFAULT_AUDIO_TRACK_ID,
            startMs: audioCursorMs,
            durationMs,
            title: node.title || "音频片段",
            sourceStartMs: 0,
            sourceDurationMs: durationMs,
            volume: 1,
            fadeInMs: 0,
            fadeOutMs: 0,
        });
        audioCursorMs += durationMs;
    }

    return {
        version: 2,
        tracks: createDefaultTracks(),
        clips,
        durationMs: getTimelineVisualEndMs(clips),
        updatedAt: new Date().toISOString(),
    };
}

/** 判断某个节点是否已经出现在时间线中（按 nodeId 去重）。 */
export function isNodeInTimeline(nodeId: string, timeline: TimelineProject | null | undefined): boolean {
    return Boolean(timeline?.clips.some((clip) => clip.nodeId === nodeId));
}

/**
 * 将节点字幕条目同步回项目时间线：按视频片段起点偏移重建该节点的字幕片段；
 * 条目为空数组时移除该节点全部字幕片段，保证字幕弹窗与时间线互通。
 */
export function syncNodeSubtitlesToTimeline(timeline: TimelineProject, nodeId: string, entries: SrtEntry[]): TimelineProject {
    const videoClip = timeline.clips.find((clip) => clip.nodeId === nodeId && clip.kind === "video");
    const hasSubtitleClips = timeline.clips.some((clip) => clip.nodeId === nodeId && clip.kind === "subtitle");
    if (!videoClip && !hasSubtitleClips) return timeline;
    const baseMs = videoClip?.startMs ?? 0;
    const sourceDurationMs = videoClip?.sourceDurationMs || videoClip?.durationMs || 0;
    const clips = timeline.clips.filter((clip) => !(clip.nodeId === nodeId && clip.kind === "subtitle"));
    for (const entry of entries) {
        const text = (entry.text || "").trim();
        if (!text) continue;
        const startMs = baseMs + Math.max(0, entry.startMs);
        const endMs = baseMs + Math.max(entry.startMs, Math.min(entry.endMs, sourceDurationMs || entry.endMs));
        clips.push({
            id: `clip-${nodeId}-sub-${entry.index}`,
            kind: "subtitle",
            nodeId,
            trackId: DEFAULT_SUBTITLE_TRACK_ID,
            startMs,
            durationMs: Math.max(100, endMs - startMs),
            title: text,
            sourceStartMs: entry.startMs,
            sourceDurationMs: Math.max(0, entry.endMs - entry.startMs),
            subtitleEntryIndex: entry.index,
            text,
        });
    }
    return {
        ...timeline,
        clips,
        durationMs: getTimelineVisualEndMs(clips),
        updatedAt: new Date().toISOString(),
    };
}

/**
 * 打开时间线弹窗时的兜底同步：以时间线内已有视频片段为锚点，按节点
 * subtitleEntries 重建该节点的字幕片段（删除旧片段、补齐新增条目）。
 * 仅处理已入轨的节点，避免把未入轨节点的字幕凭空加进时间线。
 */
export function syncTimelineSubtitleClips(timeline: TimelineProject, nodes: CanvasNodeData[]): TimelineProject {
    let changed = false;
    const clips = [...timeline.clips];
    for (const videoClip of timeline.clips) {
        if (videoClip.kind !== "video") continue;
        const node = nodes.find((item) => item.id === videoClip.nodeId);
        if (!node) continue;
        const stale = clips.filter((clip) => clip.kind === "subtitle" && clip.nodeId === videoClip.nodeId);
        if (stale.length) {
            for (const staleClip of stale) {
                const index = clips.indexOf(staleClip);
                if (index >= 0) clips.splice(index, 1);
            }
            changed = true;
        }
        const entries = node.metadata?.subtitleEntries || [];
        const baseMs = videoClip.startMs;
        const sourceDurationMs = videoClip.sourceDurationMs || videoClip.durationMs || 0;
        for (const entry of entries) {
            const text = (entry.text || "").trim();
            if (!text) continue;
            const startMs = baseMs + Math.max(0, entry.startMs);
            const endMs = baseMs + Math.max(entry.startMs, Math.min(entry.endMs, sourceDurationMs || entry.endMs));
            clips.push({
                id: `clip-${videoClip.nodeId}-sub-${entry.index}`,
                kind: "subtitle",
                nodeId: videoClip.nodeId,
                trackId: DEFAULT_SUBTITLE_TRACK_ID,
                startMs,
                durationMs: Math.max(100, endMs - startMs),
                title: text,
                sourceStartMs: entry.startMs,
                sourceDurationMs: Math.max(0, entry.endMs - entry.startMs),
                subtitleEntryIndex: entry.index,
                text,
            });
            changed = true;
        }
    }
    if (!changed) return timeline;
    return {
        ...timeline,
        clips,
        durationMs: getTimelineVisualEndMs(clips),
        updatedAt: new Date().toISOString(),
    };
}
