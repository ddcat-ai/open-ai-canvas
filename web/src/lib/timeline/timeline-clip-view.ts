import type { TimelineClip, TimelineProject } from "@/types/timeline";

export const FILMSTRIP_TILE_WIDTH = 64;

export function getPreviewClipAtTime(project: TimelineProject, timeMs: number, selectedClipId?: string | null): TimelineClip | null {
    const hidden = new Set(project.tracks.filter((track) => track.visible === false).map((track) => track.id));
    const contains = (clip: TimelineClip) => !hidden.has(clip.trackId) && clip.startMs <= timeMs && timeMs < clip.startMs + clip.durationMs;
    const selected = project.clips.find((clip) => clip.id === selectedClipId && (clip.kind === "video" || clip.kind === "image") && contains(clip));
    return selected ?? project.clips.find((clip) => clip.kind === "video" && contains(clip)) ?? project.clips.find((clip) => clip.kind === "image" && contains(clip)) ?? null;
}

export function getTimelineClipTitle(clip: TimelineClip): string {
    return clip.text || clip.title || clip.directMedia?.title || { video: "视频片段", image: "图片片段", audio: "音频片段", subtitle: "字幕片段", text: "文字片段" }[clip.kind];
}

export function getClipSeekTime(clip: TimelineClip, offsetPx: number, pxPerMs: number): number {
    return clip.startMs + Math.min(Math.max(0, clip.durationMs - 1), Math.max(0, Math.round(offsetPx / pxPerMs)));
}

export type FilmstripTile = { left: number; width: number; timeMs: number };

export function getFilmstripTiles({
    durationMs,
    sourceStartMs,
    pxPerMs,
    visibleStartPx,
    visibleEndPx,
    tileWidth = FILMSTRIP_TILE_WIDTH,
}: {
    durationMs: number;
    sourceStartMs: number;
    pxPerMs: number;
    visibleStartPx: number;
    visibleEndPx: number;
    tileWidth?: number;
}): FilmstripTile[] {
    const width = durationMs * pxPerMs;
    if (width <= 0 || pxPerMs <= 0 || tileWidth <= 0 || visibleStartPx >= width || visibleEndPx <= 0) return [];
    const first = Math.max(0, Math.floor(visibleStartPx / tileWidth) - 1);
    const last = Math.min(Math.ceil(width / tileWidth) - 1, Math.ceil(visibleEndPx / tileWidth));
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => {
        const left = (first + offset) * tileWidth;
        return { left, width: Math.min(tileWidth, width - left), timeMs: sourceStartMs + Math.min(durationMs - 1, Math.round(left / pxPerMs)) };
    });
}
