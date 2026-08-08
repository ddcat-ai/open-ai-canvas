// 时间线视图数学（移植自 lingji-cut 的 timeline-view.ts，按本项目类型精简）。
// 提供缩放钳制、像素/毫秒换算、标尺刻度与时间格式化。

const BASE_TIMELINE_PX_PER_SECOND = 96;
const MIN_TIMELINE_TRACK_WIDTH = 960;
const MIN_TIMELINE_ZOOM = 0.02;
const MAX_TIMELINE_ZOOM = 4;
const TIMELINE_ZOOM_STEP = 1.25;

type ZoomDirection = "in" | "out";

function roundZoom(value: number): number {
    return Math.round(value * 100) / 100;
}

export function clampTimelineZoom(zoomLevel: number): number {
    return roundZoom(Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoomLevel)));
}

export function getBaseTimelineWidth(durationMs: number): number {
    return Math.max(MIN_TIMELINE_TRACK_WIDTH, Math.ceil(Math.max(1_000, durationMs) / 1_000) * BASE_TIMELINE_PX_PER_SECOND);
}

export function getNextTimelineZoom(zoomLevel: number, direction: ZoomDirection): number {
    const nextZoom = direction === "in" ? zoomLevel * TIMELINE_ZOOM_STEP : zoomLevel / TIMELINE_ZOOM_STEP;
    return clampTimelineZoom(nextZoom);
}

export function zoomIn(zoomLevel: number): number {
    return getNextTimelineZoom(zoomLevel, "in");
}

export function zoomOut(zoomLevel: number): number {
    return getNextTimelineZoom(zoomLevel, "out");
}

export function getFitTimelineZoom(durationMs: number, viewportWidth: number): number {
    const safeViewportWidth = Math.max(320, viewportWidth);
    return clampTimelineZoom(safeViewportWidth / getBaseTimelineWidth(durationMs));
}

export function getTimelineTrackWidth(durationMs: number, zoomLevel: number, viewportWidth: number): number {
    const safeViewportWidth = Math.max(320, viewportWidth);
    const zoomedWidth = Math.round(getBaseTimelineWidth(durationMs) * clampTimelineZoom(zoomLevel));
    return Math.max(safeViewportWidth, zoomedWidth);
}

export function getTimelineVisualEndMs(clips: { startMs: number; durationMs: number }[]): number {
    return clips.reduce((max, clip) => Math.max(max, clip.startMs + clip.durationMs), 0);
}

/** 标尺刻度间隔（毫秒），保证刻度间隔像素不小于 64px。 */
export function getRulerTickStep(pxPerMs: number): number {
    const steps = [100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000];
    const target = 64 / Math.max(pxPerMs, 1e-6);
    return steps.find((step) => step >= target) ?? steps[steps.length - 1];
}

/** 毫秒 → 标尺/播放头时间文案（mm:ss.d）。 */
export function formatTimelineTime(ms: number): string {
    const safeMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.floor(safeMs / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((safeMs % 1_000) / 100);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}
