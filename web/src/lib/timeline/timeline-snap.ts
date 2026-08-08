// 时间线吸附算法（移植自 lingji-cut 的 timeline-snap.ts）。
// 候选时间点吸附到播放头或其它片段边缘（起点/终点），取阈值内最近目标。

import type { TimelineClip } from "@/types/timeline";

export type SnapTargetKind = "playhead" | "clip-edge";

export type SnapTarget = {
    ms: number;
    kind: SnapTargetKind;
};

export type ComputeSnapArgs = {
    candidateMs: number;
    playheadMs: number;
    clips: TimelineClip[];
    excludeClipId?: string;
    pxPerMs: number;
    thresholdPx: number;
    enabled: boolean;
};

export type ComputeSnapResult = {
    snappedMs: number;
    targets: SnapTarget[];
};

export function computeSnap(args: ComputeSnapArgs): ComputeSnapResult {
    const { candidateMs, playheadMs, clips, excludeClipId, pxPerMs, thresholdPx, enabled } = args;
    if (!enabled) {
        return { snappedMs: candidateMs, targets: [] };
    }

    const thresholdMs = thresholdPx / Math.max(pxPerMs, 1e-6);
    const candidates: SnapTarget[] = [];

    if (Math.abs(candidateMs - playheadMs) <= thresholdMs) {
        candidates.push({ ms: playheadMs, kind: "playhead" });
    }

    for (const clip of clips) {
        if (clip.id === excludeClipId) continue;
        const start = clip.startMs;
        const end = clip.startMs + clip.durationMs;
        if (Math.abs(candidateMs - start) <= thresholdMs) {
            candidates.push({ ms: start, kind: "clip-edge" });
        }
        if (Math.abs(candidateMs - end) <= thresholdMs) {
            candidates.push({ ms: end, kind: "clip-edge" });
        }
    }

    if (candidates.length === 0) {
        return { snappedMs: candidateMs, targets: [] };
    }

    candidates.sort((a, b) => Math.abs(a.ms - candidateMs) - Math.abs(b.ms - candidateMs));
    const chosen = candidates[0];
    const sameMsTargets = candidates.filter((t) => t.ms === chosen.ms);
    return { snappedMs: chosen.ms, targets: sameMsTargets };
}
