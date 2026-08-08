// 时间线轨道管理（移植自 lingji-cut 的 timeline-tracks.ts，按本项目类型精简）。
// 默认三轨：视频轨、音频轨、字幕轨；提供轨道查询与规范化。

import type { TimelineProject, TimelineTrack } from "@/types/timeline";

export const DEFAULT_VIDEO_TRACK_ID = "video-1";
export const DEFAULT_AUDIO_TRACK_ID = "audio-1";
export const DEFAULT_SUBTITLE_TRACK_ID = "subtitle-1";

export function createDefaultTracks(): TimelineTrack[] {
    return [
        { id: DEFAULT_VIDEO_TRACK_ID, kind: "video", label: "视频 1", order: 0 },
        { id: DEFAULT_AUDIO_TRACK_ID, kind: "audio", label: "音频 1", order: 1 },
        { id: DEFAULT_SUBTITLE_TRACK_ID, kind: "subtitle", label: "字幕 1", order: 2 },
    ];
}

export function getVisualTracks(tracks: TimelineTrack[]): TimelineTrack[] {
    return tracks.filter((track) => track.kind === "video" || track.kind === "image" || track.kind === "text").sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function getAudioTracks(tracks: TimelineTrack[]): TimelineTrack[] {
    return tracks.filter((track) => track.kind === "audio").sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function getSubtitleTracks(tracks: TimelineTrack[]): TimelineTrack[] {
    return tracks.filter((track) => track.kind === "subtitle").sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function getTracksByKind(tracks: TimelineTrack[], kind: TimelineTrack["kind"]): TimelineTrack[] {
    return tracks.filter((track) => track.kind === kind).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** 规范化时间线数据：轨道去重、补默认轨、时长取片段末端最大值。 */
export function normalizeTimelineProject(timeline: Partial<TimelineProject> | null | undefined): TimelineProject {
    const rawTracks = Array.isArray(timeline?.tracks) ? timeline.tracks : [];
    const seen = new Set<string>();
    const deduped = rawTracks.filter((track) => {
        if (seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
    });
    const baseTracks = createDefaultTracks();
    const tracks = [...baseTracks, ...deduped.filter((track) => !baseTracks.some((base) => base.id === track.id))];
    const clips = Array.isArray(timeline?.clips) ? timeline.clips : [];
    const durationMs = clips.reduce((max, clip) => Math.max(max, clip.startMs + clip.durationMs), 0);
    return {
        version: 2,
        tracks,
        clips,
        durationMs,
        updatedAt: timeline?.updatedAt,
    };
}
