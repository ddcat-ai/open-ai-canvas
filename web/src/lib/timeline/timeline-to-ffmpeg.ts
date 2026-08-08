// 第三期：时间线 → FFmpeg 命令序列的纯函数规划层。
// 不直接调用 FFmpeg，只产出可执行的参数计划，方便单测与运行时逐步执行；
// 运行时负责把媒体源写入 ffmpeg 工作区、写 SRT、执行 args 并清理文件。
// 数据流：TimelineProject + 节点媒体 → trim（按 sourceStart/sourceDuration 裁切）→ 黑场补齐空隙 → concat → 字幕 SRT → 烧录。

import type { TimelineClip, TimelineProject } from "@/types/timeline";

export type TimelineRenderSource = {
    nodeId: string;
    /** 已写入 ffmpeg 工作区的文件名（如 input-0.mp4） */
    fileName: string;
    durationMs: number;
    /** 媒体定位（运行时用）：本地缓存 storageKey 或远程资源地址，至少提供一个 */
    storageKey?: string;
    url?: string;
};

export type TimelineRenderStep = {
    kind: "trim" | "gap" | "concat" | "subtitle" | "burn";
    /** 本步骤输出文件名 */
    output: string;
    /** ffmpeg 参数数组（不含可执行文件名与 -y 覆盖参数） */
    args: string[];
    description: string;
    /** 该步骤依赖 libass（subtitles 滤镜）；当前 ffmpeg.wasm 内核可能不含，运行时需探测回退 */
    requiresLibass?: boolean;
};

export type TimelineRenderContext = {
    width: number;
    height: number;
    fps: number;
    /** 是否烧录字幕；false 时跳过 burn 步骤 */
    burnSubtitles: boolean;
    /** 最终输出文件名 */
    outputName: string;
};

export type TimelineRenderPlan = {
    steps: TimelineRenderStep[];
    finalOutput: string;
    /** concat 输入文件列表（trim/gap 输出），运行时据此写 concat.txt */
    concatEntries: string[];
};

export const SUBTITLE_FILE = "timeline.srt";

export function getOrderedVideoClips(timeline: TimelineProject): TimelineClip[] {
    return timeline.clips
        .filter((clip) => clip.kind === "video")
        .slice()
        .sort((a, b) => a.startMs - b.startMs || a.trackId.localeCompare(b.trackId));
}

export function getOrderedSubtitleClips(timeline: TimelineProject): TimelineClip[] {
    return timeline.clips
        .filter((clip) => clip.kind === "subtitle")
        .slice()
        .sort((a, b) => a.startMs - b.startMs || a.trackId.localeCompare(b.trackId));
}

/** 毫秒 → SRT 时间码 hh:mm:ss,mmm */
export function formatSrtTimestamp(ms: number): string {
    const safe = Math.max(0, Math.round(ms));
    const pad = (value: number, length = 2) => String(value).padStart(length, "0");
    const hours = Math.floor(safe / 3_600_000);
    const minutes = Math.floor((safe % 3_600_000) / 60_000);
    const seconds = Math.floor((safe % 60_000) / 1_000);
    const millis = safe % 1_000;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/** 字幕轨片段 → SRT 文件内容（时间线全局时间，直接用于烧录） */
export function buildSubtitleSrt(clips: TimelineClip[]): string {
    return getOrderedSubtitleClips({ version: 2, tracks: [], clips, durationMs: 0 })
        .filter((clip) => clip.text && clip.durationMs > 0)
        .map((clip, index) => {
            const text = (clip.text || "").replace(/\r?\n/g, " ").trim();
            return [String(index + 1), `${formatSrtTimestamp(clip.startMs)} --> ${formatSrtTimestamp(clip.startMs + clip.durationMs)}`, text].join("\n");
        })
        .join("\n\n");
}

function defaultContext(): TimelineRenderContext {
    return { width: 1920, height: 1080, fps: 30, burnSubtitles: true, outputName: "export.mp4" };
}

/**
 * 生成导出计划。
 * 视频轨按 startMs 顺序裁切并补齐空隙（lavfi 黑场 + 静音），最后 concat；
 * 字幕轨独立生成 SRT 并在末步烧录（libass 滤镜），音频轨暂按现有音频片段拼接（第三期迭代）。
 */
export function buildTimelineRenderPlan(timeline: TimelineProject, sources: TimelineRenderSource[], context: Partial<TimelineRenderContext> = {}): TimelineRenderPlan {
    const cfg: TimelineRenderContext = { ...defaultContext(), ...context };
    const sourceByNode = new Map(sources.map((item) => [item.nodeId, item]));
    const steps: TimelineRenderStep[] = [];
    const concatEntries: string[] = [];
    const videoClips = getOrderedVideoClips(timeline);

    // 1) 逐片段裁切：按源素材内部时间定位，输出统一编码便于 concat。
    videoClips.forEach((clip, index) => {
        const source = sourceByNode.get(clip.nodeId);
        if (!source) return;
        const output = `trim-${index}.mp4`;
        // 裁切时长取时间线片段时长（clip.durationMs），而不是源素材剩余时长：
        // 左缘裁剪后 sourceStartMs 前移但 sourceDurationMs 仍为源全长，若按源时长 -t 会把旧片段尾部多裁出来，
        // 表现为「裁剪后播放仍从最原始视频开始/出现旧片段」；-ss 已定位源内起点，-t 必须等于片段展示时长。
        const durationSec = Math.max(0.1, clip.durationMs / 1000);
        steps.push({
            kind: "trim",
            output,
            args: ["-ss", String((clip.sourceStartMs || 0) / 1000), "-i", source.fileName, "-t", String(durationSec), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", output],
            description: `裁切片段 ${index + 1}（${clip.title || clip.nodeId}）`,
        });
        concatEntries.push(output);
    });

    // 2) 空隙补黑场（时间线与成片对齐），含静音音轨。
    let cursorMs = 0;
    videoClips.forEach((clip, index) => {
        const gapMs = clip.startMs - cursorMs;
        if (gapMs > 100) {
            const output = `gap-${index}.mp4`;
            const durationSec = gapMs / 1000;
            steps.push({
                kind: "gap",
                output,
                args: [
                    "-f",
                    "lavfi",
                    "-i",
                    `color=c=black:s=${cfg.width}x${cfg.height}:r=${cfg.fps}:d=${durationSec}`,
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=44100:cl=stereo",
                    "-t",
                    String(durationSec),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-c:a",
                    "aac",
                    "-shortest",
                    output,
                ],
                description: `补黑场 ${(gapMs / 1000).toFixed(2)}s`,
            });
            concatEntries.push(output);
        }
        cursorMs = clip.startMs + clip.durationMs;
    });

    // 3) concat 拼接视频轨。
    const concatOutput = "timeline-video.mp4";
    if (concatEntries.length) {
        steps.push({
            kind: "concat",
            output: concatOutput,
            args: ["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", concatOutput],
            description: "拼接视频轨",
        });
    }

    // 4) 字幕轨 → SRT 内容（运行时写入 SUBTITLE_FILE）。
    const subtitleClips = getOrderedSubtitleClips(timeline);
    if (cfg.burnSubtitles && subtitleClips.some((clip) => clip.text)) {
        steps.push({
            kind: "subtitle",
            output: SUBTITLE_FILE,
            args: [],
            description: "生成字幕 SRT",
        });
    }

    // 5) 烧录字幕并输出最终文件（subtitles 滤镜需要 libass）。
    const finalOutput = cfg.outputName;
    if (concatEntries.length && steps.some((step) => step.kind === "subtitle")) {
        steps.push({
            kind: "burn",
            output: finalOutput,
            args: ["-i", concatOutput, "-vf", `subtitles=${SUBTITLE_FILE}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", finalOutput],
            description: "烧录字幕并输出",
            requiresLibass: true,
        });
    } else if (concatEntries.length) {
        steps.push({
            kind: "concat",
            output: finalOutput,
            args: ["-i", concatOutput, "-c", "copy", finalOutput],
            description: "输出成片（无字幕）",
        });
    }

    return { steps, finalOutput, concatEntries };
}

/** 供导出对话框/文档展示的人类可读命令预览 */
export function describeRenderPlan(plan: TimelineRenderPlan): string {
    return plan.steps.map((step) => `# ${step.description}\nffmpeg -y ${step.args.join(" ")}`).join("\n\n");
}
