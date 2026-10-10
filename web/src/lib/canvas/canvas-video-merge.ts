import { FFmpeg } from "@ffmpeg/ffmpeg";
import ffmpegCoreURL from "@ffmpeg/core?url";
import ffmpegWasmURL from "@ffmpeg/core/wasm?url";
import { fetchFile } from "@ffmpeg/util";
import { getMediaBlob } from "@/services/file-storage";
import { buildRecordingTranscodeArgs } from "./canvas-video-merge-args";
import { concatVideoFiles } from "./canvas-video-concat";

export type MergeVideoInput = { id: string; url?: string; storageKey?: string };
export type MergeVideoProgress = { phase: "loading" | "reading" | "encoding"; progress: number };

let ffmpegPromise: Promise<FFmpeg> | null = null;

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
                throw new Error("视频合并工具加载失败，请刷新页面后重试", { cause });
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

export async function transcodeVideoToMp4(input: Blob, onProgress?: (progress: MergeVideoProgress) => void) {
    const ffmpeg = await loadFFmpeg(onProgress);
    const inputName = input.type === "video/mp4" ? "recording.mp4" : "recording.webm";
    const outputName = "recording-transcoded.mp4";
    try {
        await ffmpeg.writeFile(inputName, await fetchFile(input));
        onProgress?.({ phase: "encoding", progress: 55 });
        const logs: string[] = [];
        const onLog = ({ message }: { message: string }) => {
            if (message) logs.push(message);
        };
        ffmpeg.on("log", onLog);
        let exitCode = 1;
        try {
            exitCode = await ffmpeg.exec(buildRecordingTranscodeArgs(inputName, outputName));
        } finally {
            ffmpeg.off("log", onLog);
        }
        if (exitCode !== 0) {
            console.error("白膜视频转码失败", logs.slice(-12));
            throw new Error("视频转码失败，请重试");
        }
        const output = await ffmpeg.readFile(outputName);
        onProgress?.({ phase: "encoding", progress: 100 });
        return new Blob([output as BlobPart], { type: "video/mp4" });
    } finally {
        await Promise.all([inputName, outputName].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
    }
}

export async function mergeVideos(inputs: MergeVideoInput[], onProgress?: (progress: MergeVideoProgress) => void) {
    if (inputs.length < 2) throw new Error("至少选择 2 个视频才能合并");
    const ffmpeg = await loadFFmpeg(onProgress);
    const files: string[] = [];
    try {
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index];
            const storedBlob = input.storageKey ? await getMediaBlob(input.storageKey) : null;
            const remoteBlob =
                !storedBlob && input.url
                    ? await fetch(input.url).then((response) => {
                          if (!response.ok) throw new Error(`视频资源请求失败（${response.status}）`);
                          return response.blob();
                      })
                    : null;
            const blob = storedBlob || remoteBlob;
            if (!blob) throw new Error(`无法读取第 ${index + 1} 个视频`);
            const name = `input-${index}.mp4`;
            await ffmpeg.writeFile(name, await fetchFile(blob));
            files.push(name);
            onProgress?.({ phase: "reading", progress: Math.round(((index + 1) / inputs.length) * 45) });
        }
        onProgress?.({ phase: "encoding", progress: 55 });
        const output = await concatVideoFiles(ffmpeg, files);
        onProgress?.({ phase: "encoding", progress: 100 });
        return new Blob([output as BlobPart], { type: "video/mp4" });
    } finally {
        await Promise.all(files.map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
    }
}
