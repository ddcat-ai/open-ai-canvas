import { fetchFile } from "@ffmpeg/util";

import { getMediaBlob } from "@/services/file-storage";
import { buildExtractAudioArgs, buildSegmentTrimArgs, hasNoAudioStream, isMp3Bytes, SEGMENT_AUDIO_OUTPUT_NAME, SEGMENT_INPUT_NAME, SEGMENT_OUTPUT_NAME } from "./canvas-video-segment-args";
import { runFFmpegTask } from "./canvas-video-merge";

export type VideoSegmentRange = {
    startMs: number;
    endMs: number;
};

export type VideoSegmentSource = {
    url?: string;
    storageKey?: string;
};

export type VideoSegmentProgress = {
    phase: "loading" | "reading" | "encoding";
    progress: number;
};

const INPUT_NAME = SEGMENT_INPUT_NAME;
const OUTPUT_NAME = SEGMENT_OUTPUT_NAME;

function assertValidRange(range: VideoSegmentRange, durationMs?: number) {
    if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) throw new Error("片段时间必须是有效数值");
    const startMs = Math.max(0, Math.round(range.startMs));
    const endMs = Math.round(range.endMs);
    if (endMs <= startMs) throw new Error("片段结束时间必须晚于开始时间");
    if (durationMs !== undefined && endMs > Math.round(durationMs)) throw new Error("片段结束时间超过视频时长");
}

async function readVideoSourceBlob(source: VideoSegmentSource, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (source.storageKey) {
        const stored = await getMediaBlob(source.storageKey);
        signal?.throwIfAborted();
        if (stored) return stored;
    }
    if (source.url) {
        const response = await fetch(source.url, { signal });
        if (!response.ok) throw new Error(`视频资源请求失败（${response.status}）`);
        return response.blob();
    }
    throw new Error("找不到视频素材，请重新上传后再操作");
}

/** 按参考片段范围截取视频，输出统一编码 MP4。 */
export async function trimVideoSegment(source: VideoSegmentSource, range: VideoSegmentRange, durationMs?: number, onProgress?: (progress: VideoSegmentProgress) => void, signal?: AbortSignal) {
    assertValidRange(range, durationMs);
    return runFFmpegTask(
        async (ffmpeg) => {
            try {
                const blob = await readVideoSourceBlob(source, signal);
                onProgress?.({ phase: "reading", progress: 45 });
                const bytes = await fetchFile(blob);
                signal?.throwIfAborted();
                await ffmpeg.writeFile(INPUT_NAME, bytes);
                signal?.throwIfAborted();
                const startSec = String(range.startMs / 1000);
                const durationSec = String((range.endMs - range.startMs) / 1000);
                onProgress?.({ phase: "encoding", progress: 55 });
                const exitCode = await ffmpeg.exec(["-y", ...buildSegmentTrimArgs(startSec, durationSec)]);
                signal?.throwIfAborted();
                if (exitCode !== 0) throw new Error("媒体处理失败，请确认视频编码格式兼容");
                const output = await ffmpeg.readFile(OUTPUT_NAME);
                signal?.throwIfAborted();
                onProgress?.({ phase: "encoding", progress: 100 });
                return new Blob([output as BlobPart], { type: "video/mp4" });
            } finally {
                await Promise.all([INPUT_NAME, OUTPUT_NAME].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
            }
        },
        onProgress,
        signal,
    );
}

/**
 * 从视频片段提取声音为 MP3；优先 libmp3lame，内核不支持时回退默认 mp3 编码器。
 * 输出写到独立的 .mp3 文件并用 -f mp3 指定容器，返回前再核对字节确实是 MP3：
 * 不能只把 Blob 标成 audio/mpeg，服务端按内容识别类型，MP4 容器会被存成视频。
 */
export async function extractVideoAudio(source: VideoSegmentSource, range: VideoSegmentRange, durationMs?: number, onProgress?: (progress: VideoSegmentProgress) => void, signal?: AbortSignal) {
    assertValidRange(range, durationMs);
    return runFFmpegTask(
        async (ffmpeg) => {
            // 日志只属于当前租约，保留有界尾部来区分无音轨和编码器不可用。
            const logs: string[] = [];
            const onLog = ({ message }: { message: string }) => {
                logs.push(message);
                if (logs.length > 64) logs.shift();
            };
            ffmpeg.on("log", onLog);
            try {
                const blob = await readVideoSourceBlob(source, signal);
                onProgress?.({ phase: "reading", progress: 45 });
                const bytes = await fetchFile(blob);
                signal?.throwIfAborted();
                await ffmpeg.writeFile(INPUT_NAME, bytes);
                signal?.throwIfAborted();
                const startSec = String(range.startMs / 1000);
                const durationSec = String((range.endMs - range.startMs) / 1000);
                onProgress?.({ phase: "encoding", progress: 55 });
                const args = (audioCodec: string) => buildExtractAudioArgs(audioCodec, startSec, durationSec);
                let exitCode = await ffmpeg.exec(["-y", ...args("libmp3lame")]);
                signal?.throwIfAborted();
                if (exitCode !== 0 && hasNoAudioStream(logs)) throw new Error("音频提取失败：这段视频没有音轨");
                if (exitCode !== 0) exitCode = await ffmpeg.exec(["-y", ...args("mp3")]);
                signal?.throwIfAborted();
                if (exitCode !== 0) throw new Error("音频提取失败：当前 FFmpeg 内核不支持 MP3 编码");
                const output = await ffmpeg.readFile(SEGMENT_AUDIO_OUTPUT_NAME);
                signal?.throwIfAborted();
                const outputBytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
                if (!isMp3Bytes(outputBytes)) throw new Error("音频提取失败：输出不是 MP3 文件");
                onProgress?.({ phase: "encoding", progress: 100 });
                return new Blob([outputBytes as BlobPart], { type: "audio/mpeg" });
            } finally {
                ffmpeg.off("log", onLog);
                await Promise.all([INPUT_NAME, SEGMENT_AUDIO_OUTPUT_NAME].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
            }
        },
        onProgress,
        signal,
    );
}
