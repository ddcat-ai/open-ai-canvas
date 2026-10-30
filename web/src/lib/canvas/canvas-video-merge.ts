import { FFmpeg } from "@ffmpeg/ffmpeg";
import ffmpegCoreURL from "@ffmpeg/core?url";
import ffmpegWasmURL from "@ffmpeg/core/wasm?url";
import { fetchFile } from "@ffmpeg/util";
import { getMediaBlob } from "@/services/file-storage";
import { buildRecordingTranscodeArgs, resolveRecordingTranscodeTimeout } from "./canvas-video-merge-args";

export type MergeVideoInput = { id: string; url?: string; storageKey?: string };
export type MergeVideoProgress = { phase: "loading" | "reading" | "encoding"; progress: number };

let ffmpegPromise: Promise<FFmpeg> | null = null;
let ffmpegJobs: Promise<unknown> = Promise.resolve();
let ffmpegJobSerial = 0;

/** FFmpeg.wasm 在浏览器里运行；这里的失败与服务器是否安装 FFmpeg（CANVAS_FFMPEG_PATH）无关。 */
const FFMPEG_LOAD_ERROR = "浏览器视频转码组件（FFmpeg.wasm）加载失败，请刷新页面后重试；自部署时确认前端 /assets 下的 ffmpeg-core 文件能访问（这一步在浏览器执行，与服务器是否安装 FFmpeg 无关）";

// ffmpeg 只在用户明确合并视频时加载，避免把 wasm 和 worker 放进画布首屏包体。
export async function loadFFmpeg(onProgress?: (progress: MergeVideoProgress) => void) {
    if (!ffmpegPromise) {
        ffmpegPromise = (async () => {
            const ffmpeg = new FFmpeg();
            onProgress?.({ phase: "loading", progress: 0 });
            try {
                // 核心资产随前端同源发布，避免自部署环境首次合并依赖第三方 CDN。
                await ffmpeg.load({ coreURL: ffmpegCoreURL, wasmURL: ffmpegWasmURL });
            } catch (cause) {
                ffmpeg.terminate();
                throw new Error(FFMPEG_LOAD_ERROR, { cause });
            }
            return ffmpeg;
        })();
    }
    try {
        return await ffmpegPromise;
    } catch (error) {
        ffmpegPromise = null;
        throw error;
    }
}

/**
 * 丢掉当前 FFmpeg 实例：超时、worker 崩溃或 wasm 内存耗尽后旧实例可能一直卡住，
 * 继续复用会让之后每次转码都失败，直到刷新页面。下一次调用重新加载一个干净的实例。
 */
function resetFFmpeg(ffmpeg: FFmpeg) {
    ffmpeg.terminate();
    ffmpegPromise = null;
}

/**
 * FFmpeg 实例是全局单例，虚拟文件系统也是共享的：两个任务同时 exec 会互相删掉输入文件。
 * 世界引擎的白膜、深度转码按顺序排队执行，一个失败不影响下一个。
 */
function runFFmpegExclusive<T>(job: () => Promise<T>): Promise<T> {
    const result = ffmpegJobs.then(job, job);
    ffmpegJobs = result.catch(() => undefined);
    return result;
}

export type TranscodeVideoOptions = {
    /** 镜头帧率与时长：给了就按固定帧率输出并裁到镜头时长。 */
    fps?: number;
    duration?: number;
    onProgress?: (progress: MergeVideoProgress) => void;
};

export function transcodeVideoToMp4(input: Blob, options: TranscodeVideoOptions = {}) {
    return runFFmpegExclusive(async () => {
        const { onProgress } = options;
        const ffmpeg = await loadFFmpeg(onProgress);
        const serial = (ffmpegJobSerial += 1);
        const inputName = `recording-${serial}.${input.type.includes("mp4") ? "mp4" : "webm"}`;
        const outputName = `recording-${serial}-transcoded.mp4`;
        const logs: string[] = [];
        const onLog = ({ message }: { message: string }) => {
            if (message) logs.push(message);
            if (logs.length > 40) logs.shift();
        };
        // progress 事件里的 time 是已输出的媒体时长（微秒）；录制 WebM 没有时长头，progress 比例不可靠。
        const onEncodeProgress = ({ time }: { time: number }) => {
            if (options.duration && Number.isFinite(time) && time > 0) onProgress?.({ phase: "encoding", progress: Math.min(99, Math.round(55 + (time / 1e6 / options.duration) * 44)) });
        };
        let healthy = true;
        try {
            await ffmpeg.writeFile(inputName, await fetchFile(input));
            onProgress?.({ phase: "encoding", progress: 55 });
            ffmpeg.on("log", onLog);
            ffmpeg.on("progress", onEncodeProgress);
            const timeout = resolveRecordingTranscodeTimeout(options.duration);
            let timer = 0;
            let exitCode = 1;
            try {
                // exec 自带超时只在 wasm 正常运行时生效；worker 崩溃时 promise 永远不返回，再加一层墙钟超时。
                exitCode = await Promise.race([
                    ffmpeg.exec(buildRecordingTranscodeArgs(inputName, outputName, { fps: options.fps, duration: options.duration }), timeout),
                    new Promise<number>((_, reject) => {
                        timer = window.setTimeout(() => reject(new Error("视频转码超时")), timeout + 15_000);
                    }),
                ]);
            } catch (error) {
                healthy = false;
                throw new Error(error instanceof Error && error.message === "视频转码超时" ? "视频转码超时：镜头较长时请缩短镜头或降低帧率后重试" : "视频转码中断，请重试", { cause: error });
            } finally {
                window.clearTimeout(timer);
                ffmpeg.off("log", onLog);
                ffmpeg.off("progress", onEncodeProgress);
            }
            if (exitCode !== 0) {
                healthy = false;
                console.error("录制视频转码失败", { exitCode, bytes: input.size, mimeType: input.type, logs: logs.slice(-12) });
                throw new Error("视频转码失败，请重试");
            }
            const output = await ffmpeg.readFile(outputName);
            onProgress?.({ phase: "encoding", progress: 100 });
            return new Blob([output as BlobPart], { type: "video/mp4" });
        } finally {
            if (healthy) await Promise.all([inputName, outputName].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
            else resetFFmpeg(ffmpeg);
        }
    });
}

export async function mergeVideos(inputs: MergeVideoInput[], onProgress?: (progress: MergeVideoProgress) => void) {
    if (inputs.length < 2) throw new Error("至少选择 2 个视频才能合并");
    return runFFmpegExclusive(() => mergeVideosNow(inputs, onProgress));
}

async function mergeVideosNow(inputs: MergeVideoInput[], onProgress?: (progress: MergeVideoProgress) => void) {
    const ffmpeg = await loadFFmpeg(onProgress);
    const files: string[] = [];
    try {
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index];
            const storedBlob = input.storageKey ? await getMediaBlob(input.storageKey) : null;
            const remoteBlob = !storedBlob && input.url ? await fetch(input.url).then((response) => {
                if (!response.ok) throw new Error(`视频资源请求失败（${response.status}）`);
                return response.blob();
            }) : null;
            const blob = storedBlob || remoteBlob;
            if (!blob) throw new Error(`无法读取第 ${index + 1} 个视频`);
            const name = `input-${index}.mp4`;
            await ffmpeg.writeFile(name, await fetchFile(blob));
            files.push(name);
            onProgress?.({ phase: "reading", progress: Math.round(((index + 1) / inputs.length) * 45) });
        }
        const concatList = files.map((file) => `file '${file}'`).join("\n");
        await ffmpeg.writeFile("concat.txt", concatList);
        onProgress?.({ phase: "encoding", progress: 55 });
        // 先尝试无损拼接；不同模型输出的编码参数不一致时再回退到统一转码。
        let exitCode = await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "merged.mp4"]);
        if (exitCode !== 0) {
            exitCode = await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", "merged.mp4"]);
        }
        if (exitCode !== 0) throw new Error("视频编码失败，请确认视频编码格式兼容");
        const output = await ffmpeg.readFile("merged.mp4");
        onProgress?.({ phase: "encoding", progress: 100 });
        return new Blob([output as BlobPart], { type: "video/mp4" });
    } finally {
        await Promise.all([...files, "concat.txt", "merged.mp4"].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
    }
}
