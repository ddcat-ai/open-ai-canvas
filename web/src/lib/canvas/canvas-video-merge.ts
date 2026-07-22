import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { getMediaBlob } from "@/services/file-storage";

export type MergeVideoInput = { id: string; url?: string; storageKey?: string };
export type MergeVideoProgress = { phase: "loading" | "reading" | "encoding"; progress: number };

let ffmpegPromise: Promise<FFmpeg> | null = null;

// ffmpeg 只在用户明确合并视频时加载，避免把 wasm 和 worker 放进画布首屏包体。
async function loadFFmpeg(onProgress?: (progress: MergeVideoProgress) => void) {
    if (!ffmpegPromise) {
        ffmpegPromise = (async () => {
            const ffmpeg = new FFmpeg();
            const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
            onProgress?.({ phase: "loading", progress: 0 });
            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
            });
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

export async function mergeVideos(inputs: MergeVideoInput[], onProgress?: (progress: MergeVideoProgress) => void) {
    if (inputs.length < 2) throw new Error("至少选择 2 个视频才能合并");
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
