// 时间线放置算法（移植自 lingji-cut 的 timeline-placement.ts）。
// 提供同轨碰撞检测、最近可用位置查找、跨轨放置与时长钳制。

import type { TimelineClip, TimelineTrack } from "@/types/timeline";

export type PlacementResult = {
    startMs: number;
    fits: boolean;
};

export type FindNearestArgs = {
    targetStartMs: number;
    durationMs: number;
    trackId: string;
    excludeClipId?: string;
    clips: TimelineClip[];
};

export type PlacementTrackResult = {
    trackId: string | null;
    startMs: number;
};

export type FindAvailableTrackArgs = {
    targetStartMs: number;
    durationMs: number;
    excludeClipId?: string;
    clips: TimelineClip[];
    tracks: TimelineTrack[];
};

export type ClampDurationArgs = {
    clipId: string;
    startMs: number;
    requestedDurationMs: number;
    trackId: string;
    clips: TimelineClip[];
    maxDurationMs?: number;
};

/** 半开区间 [startMs, startMs + durationMs) 重叠判断 */
export function clipsOverlap(left: { startMs: number; durationMs: number }, right: { startMs: number; durationMs: number }): boolean {
    return left.startMs < right.startMs + right.durationMs && right.startMs < left.startMs + left.durationMs;
}

export type CanPlaceAtArgs = {
    trackId: string;
    startMs: number;
    durationMs: number;
    excludeClipId?: string;
    clips: TimelineClip[];
};

export type CanPlaceAtResult = {
    ok: boolean;
    reason?: "overlap";
};

/**
 * 判断指定轨道的区间 [startMs, startMs+durationMs) 是否可放置，
 * 不做任何自动 snap/偏移；遇到任何同轨片段重叠即返回 ok=false。
 */
export function canPlaceAt(args: CanPlaceAtArgs): CanPlaceAtResult {
    const { trackId, startMs, durationMs, excludeClipId, clips } = args;
    const candidate = { startMs, durationMs };
    for (const other of clips) {
        if (other.trackId !== trackId) continue;
        if (other.id === excludeClipId) continue;
        if (clipsOverlap(candidate, other)) {
            return { ok: false, reason: "overlap" };
        }
    }
    return { ok: true };
}

/** 返回与候选区间碰撞的所有片段（按现有顺序，不排序）。 */
export function findCollidingItems(args: CanPlaceAtArgs): TimelineClip[] {
    const { trackId, startMs, durationMs, excludeClipId, clips } = args;
    const candidate = { startMs, durationMs };
    return clips.filter((c) => c.trackId === trackId && c.id !== excludeClipId && clipsOverlap(candidate, c));
}

function getSortedClipsOnTrack(trackId: string, clips: TimelineClip[], excludeClipId?: string): TimelineClip[] {
    return clips.filter((c) => c.trackId === trackId && c.id !== excludeClipId).sort((a, b) => a.startMs - b.startMs);
}

/** 在指定轨道上寻找离 targetStartMs 最近的可用放置位置 */
export function findNearestAvailablePlacement(args: FindNearestArgs): PlacementResult {
    const { targetStartMs, durationMs, trackId, excludeClipId, clips } = args;
    const managed = getSortedClipsOnTrack(trackId, clips, excludeClipId);

    if (managed.length === 0) {
        return { startMs: targetStartMs, fits: true };
    }

    const candidate = { startMs: targetStartMs, durationMs };
    const hasConflict = managed.some((c) => clipsOverlap(candidate, c));
    if (!hasConflict) {
        return { startMs: targetStartMs, fits: true };
    }

    // 目标位置有冲突，扫描所有间隙寻找最近的可用位置：
    // 第一个片段之前、片段之间、最后一个片段之后（无限大）。
    type Gap = { start: number; end: number };
    const gaps: Gap[] = [];

    if (managed[0].startMs > 0) {
        gaps.push({ start: 0, end: managed[0].startMs });
    }

    for (let i = 0; i < managed.length - 1; i++) {
        const gapStart = managed[i].startMs + managed[i].durationMs;
        const gapEnd = managed[i + 1].startMs;
        if (gapEnd > gapStart) {
            gaps.push({ start: gapStart, end: gapEnd });
        }
    }

    const lastEnd = managed[managed.length - 1].startMs + managed[managed.length - 1].durationMs;
    gaps.push({ start: lastEnd, end: Number.POSITIVE_INFINITY });

    let bestStart: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const gap of gaps) {
        const gapSize = gap.end - gap.start;
        if (gapSize < durationMs) continue;

        let candidateStart: number;
        if (targetStartMs >= gap.start && targetStartMs + durationMs <= gap.end) {
            candidateStart = targetStartMs;
        } else if (targetStartMs < gap.start) {
            candidateStart = gap.start;
        } else {
            candidateStart = Math.max(gap.start, gap.end - durationMs);
        }

        if (candidateStart + durationMs > gap.end && gap.end !== Number.POSITIVE_INFINITY) {
            continue;
        }

        const distance = Math.abs(candidateStart - targetStartMs);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestStart = candidateStart;
        }
    }

    if (bestStart !== null) {
        return { startMs: bestStart, fits: true };
    }

    return { startMs: targetStartMs, fits: false };
}

/** 在所有可放置的视觉/音轨中寻找可放置的轨道（按 order 升序） */
export function findAvailableTrack(args: FindAvailableTrackArgs): PlacementTrackResult {
    const { targetStartMs, durationMs, excludeClipId, clips, tracks } = args;
    const candidates = tracks.filter((t) => t.kind === "video" || t.kind === "audio").sort((a, b) => a.order - b.order);

    for (const track of candidates) {
        const result = findNearestAvailablePlacement({
            targetStartMs,
            durationMs,
            trackId: track.id,
            excludeClipId,
            clips,
        });
        if (result.fits) {
            return { trackId: track.id, startMs: result.startMs };
        }
    }

    return { trackId: null, startMs: targetStartMs };
}

/** 根据相邻片段和最大时长限制，钳制片段时长 */
export function clampClipDurationByNeighbors(args: ClampDurationArgs): number {
    const { clipId, startMs, requestedDurationMs, trackId, clips, maxDurationMs } = args;
    const managed = getSortedClipsOnTrack(trackId, clips, clipId);

    let maxGap = requestedDurationMs;
    for (const c of managed) {
        if (c.startMs > startMs) {
            const gap = c.startMs - startMs;
            maxGap = Math.min(maxGap, gap);
            break;
        }
    }

    let result = Math.min(requestedDurationMs, maxGap);
    if (maxDurationMs !== undefined) {
        result = Math.min(result, maxDurationMs);
    }
    return Math.max(0, result);
}
