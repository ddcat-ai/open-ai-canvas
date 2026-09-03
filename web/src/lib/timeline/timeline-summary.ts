// 时间线确定性摘要（Runbook M6.2）：把 TimelineProject v2 压缩成喂给 LLM 的中文上下文。
// 同一输入永远产出同一输出（无时间戳/无随机），供命令引用 id 与 AI 面板上下文注入。

import type { TimelineClip, TimelineProject, TimelineTrack } from "@/types/timeline";

/** 片段逐行列出的上限；超出后折叠为一行汇总，防止超长时间线撑爆模型上下文。 */
export const SUMMARY_MAX_CLIP_LINES = 60;
/** 标题/文本在摘要中的最大展示长度。 */
export const SUMMARY_MAX_TEXT_CHARS = 24;

const KIND_LABELS: Record<string, string> = {
    video: "视频",
    audio: "音频",
    subtitle: "字幕",
    text: "文本",
    image: "图片",
};

export function formatMs(ms: number): string {
    const total = Math.max(0, Math.round(ms));
    const s = Math.floor(total / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
}

function clipLine(clip: TimelineClip): string {
    const label = (clip.title || clip.text || "").trim().slice(0, SUMMARY_MAX_TEXT_CHARS);
    const source = clip.directMedia?.title?.slice(0, SUMMARY_MAX_TEXT_CHARS) ?? "";
    const text = label || source || clip.nodeId.slice(0, 12);
    return `  - clip ${clip.id} | ${clip.kind} | 轨道 ${clip.trackId} | ${clip.startMs}-${clip.startMs + clip.durationMs}ms | ${text}`;
}

function trackLine(track: TimelineTrack): string {
    const flags = [
        track.visible === false ? "隐藏" : null,
        track.muted ? "静音" : null,
    ]
        .filter(Boolean)
        .join("/");
    return `  - ${track.id} | ${KIND_LABELS[track.kind] ?? track.kind}轨 | ${track.label}${flags ? ` | ${flags}` : ""}`;
}

/** 生成中文时间线摘要（确定性、纯文本）。 */
export function summarizeTimeline(project: TimelineProject): string {
    const lines: string[] = [];
    const subtitleClips = project.clips.filter((c) => c.kind === "subtitle");
    const nodeIds = new Set(project.clips.map((c) => c.nodeId));
    const directCount = project.clips.filter((c) => c.directMedia).length;

    lines.push(`时间线：总时长 ${formatMs(project.durationMs)}，${project.tracks.length} 条轨道，${project.clips.length} 个片段（字幕 ${subtitleClips.length}，直连素材 ${directCount}，引用节点 ${nodeIds.size} 个）。`);
    lines.push(`轨道（顺序从上到下）：`);
    for (const track of [...project.tracks].sort((a, b) => a.order - b.order)) {
        lines.push(trackLine(track));
    }
    lines.push(`片段：`);
    if (project.clips.length === 0) {
        lines.push(`  （空时间线）`);
    } else {
        const shown = project.clips.slice(0, SUMMARY_MAX_CLIP_LINES);
        for (const clip of shown) {
            lines.push(clipLine(clip));
        }
        const hidden = project.clips.length - shown.length;
        if (hidden > 0) lines.push(`  …其余 ${hidden} 个片段省略`);
    }
    if (subtitleClips.length > 0) {
        const totalChars = subtitleClips.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
        lines.push(`字幕共 ${totalChars} 字。`);
    }
    return lines.join("\n");
}
