import type { FFmpeg } from "@ffmpeg/ffmpeg";

export type VideoConcatEngine = Pick<FFmpeg, "writeFile" | "readFile" | "deleteFile" | "exec" | "ffprobe">;

type MediaStream = { codec_type?: string; width?: number; height?: number; duration?: string; start_time?: string; avg_frame_rate?: string };
type MediaProbe = { streams?: MediaStream[]; format?: { duration?: string } };

async function probeVideo(ffmpeg: VideoConcatEngine, file: string): Promise<MediaProbe> {
    const probeFile = "concat-probe.json";
    try {
        // 当前 WASM 内核的 ffprobe 成功时也可能返回 -1，以实际探测结果校验媒体。
        await ffmpeg.ffprobe(["-v", "error", "-show_entries", "stream=codec_type,width,height,duration,start_time,avg_frame_rate:format=duration", "-of", "json", "-o", probeFile, file]);
        const bytes = await ffmpeg.readFile(probeFile);
        return JSON.parse(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)) as MediaProbe;
    } finally {
        await ffmpeg.deleteFile(probeFile).catch(() => undefined);
    }
}

export async function concatVideoFiles(ffmpeg: VideoConcatEngine, files: string[]): Promise<Uint8Array> {
    if (files.length < 2) throw new Error("至少选择 2 个视频才能合并");
    try {
        const inputs = [];
        for (const [index, file] of files.entries()) {
            const probe = await probeVideo(ffmpeg, file);
            const video = probe.streams?.find((stream) => stream.codec_type === "video");
            const duration = Number(video?.duration ?? probe.format?.duration);
            if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) {
                throw new Error(`无法读取第 ${index + 1} 个视频的尺寸或时长`);
            }
            const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
            const audioStart = Number(audio?.start_time);
            const videoStart = Number(video.start_time);
            const audioOffset = Number.isFinite(audioStart) && Number.isFinite(videoStart) ? audioStart - videoStart : 0;
            inputs.push({ video, duration, hasAudio: Boolean(audio), audioOffset });
        }

        const first = inputs[0].video;
        const width = Math.ceil(first.width! / 2) * 2;
        const height = Math.ceil(first.height! / 2) * 2;
        const [rate, scale = 1] = (first.avg_frame_rate || "").split("/").map(Number);
        const frameRate = rate / scale;
        const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
        // 音画共同相对画面起点归零，保留原片的声音延迟；first_pts=0 补齐或裁去起点差。
        const filters = inputs.flatMap((input, index) => [
            `[${index}:v:0]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${index}]`,
            input.hasAudio
                ? `[${index}:a:0]asetpts=PTS-STARTPTS+(${input.audioOffset})/TB,aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${input.duration}[a${index}]`
                : `anullsrc=r=48000:cl=stereo,atrim=duration=${input.duration}[a${index}]`,
        ]);
        filters.push(`${inputs.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${inputs.length}:v=1:a=1[vout][aout]`);
        // 必须分别解码后 concat；demuxer + copy 即使退出码为 0 也会把不同时间刻度的轨道拼坏。
        const exitCode = await ffmpeg.exec([
            "-y",
            "-xerror",
            ...files.flatMap((file) => ["-i", file]),
            "-filter_complex",
            filters.join(";"),
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-threads",
            "1",
            "merged.mp4",
        ]);
        if (exitCode !== 0) throw new Error("视频编码失败，请确认视频编码格式兼容");

        const result = await probeVideo(ffmpeg, "merged.mp4");
        const expectedDuration = inputs.reduce((total, input) => total + input.duration, 0);
        const tolerance = Math.max(0.15, inputs.length / fps);
        for (const kind of ["video", "audio"]) {
            const actualDuration = Number(result.streams?.find((stream) => stream.codec_type === kind)?.duration);
            if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - expectedDuration) > tolerance) {
                throw new Error("合并后音视频时长校验失败，请重新合并");
            }
        }
        return (await ffmpeg.readFile("merged.mp4")) as Uint8Array;
    } finally {
        await ffmpeg.deleteFile("merged.mp4").catch(() => undefined);
    }
}
