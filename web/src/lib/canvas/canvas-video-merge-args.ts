// 画布录制转 MP4 的 ffmpeg 参数，纯函数便于单测。
// 世界引擎白膜用 WebGL canvas.captureStream 录制，没有音轨，画布在 dpr 1.5 下宽高经常是奇数。
// @ffmpeg/core 的 libx264 + yuv420p 要求宽高都能被 2 整除，奇数帧会直接失败：
// "width not divisible by 2" → exit 1，界面只看到「视频转码失败，请重试」。
// 该内核还关闭了 pthreads 和 asm，默认 medium preset 在视口分辨率下转不动，所以用 ultrafast 单线程。
//
// 实时录制按墙钟打时间戳：帧间隔不均匀，停止录制时还会多出零点几秒尾巴。给了镜头帧率与时长时，
// 输出按固定帧率重采样并裁到镜头时长，深度视频、白膜视频才能和生成视频逐帧对齐。

export type RecordingTranscodeTiming = { fps?: number; duration?: number };

export function buildRecordingTranscodeArgs(inputName: string, outputName: string, timing: RecordingTranscodeTiming = {}): string[] {
    const fps = timing.fps !== undefined && Number.isFinite(timing.fps) && timing.fps >= 1 && timing.fps <= 60 ? Math.round(timing.fps) : undefined;
    const duration = timing.duration !== undefined && Number.isFinite(timing.duration) && timing.duration > 0 && timing.duration <= 600 ? timing.duration : undefined;
    const filter = fps ? `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2` : "scale=trunc(iw/2)*2:trunc(ih/2)*2";
    return ["-i", inputName, "-an", "-vf", filter, ...(duration ? ["-t", String(Number(duration.toFixed(3)))] : []), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "1", outputName];
}

/** 转码超时（毫秒）：单线程 wasm 大约每秒处理十几到几十帧，按镜头时长留足余量；未知时长给 5 分钟。 */
export function resolveRecordingTranscodeTimeout(duration?: number) {
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return 5 * 60_000;
    return Math.round(Math.min(15 * 60_000, 60_000 + duration * 20_000));
}
