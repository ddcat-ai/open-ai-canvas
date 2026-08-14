// 视频片段处理（裁切/提音轨）的 ffmpeg 参数构造，纯函数便于单测。
// -ss 必须放在 -i 之后（输出 seek）：放在 -i 之前是输入 seek，MP4/H.264 只会定位到目标时间戳
// 之前最近的关键帧，切点会偏移最多一个 GOP（常见 0.5-2s）、片尾被 -t 截掉、音视频在切点处错位；
// 本流程已 -c:v libx264 重编码，输出 seek 帧精确，代价只是多解码。

export const SEGMENT_INPUT_NAME = "segment-input.mp4";
export const SEGMENT_OUTPUT_NAME = "segment-output.mp4";

/** 视频片段裁切参数：输出统一编码 MP4。 */
export function buildSegmentTrimArgs(startSec: string, durationSec: string): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", SEGMENT_OUTPUT_NAME];
}

/** 从视频片段提取声音：同样使用输出 seek，保证起点与裁切路径一致。 */
export function buildExtractAudioArgs(audioCodec: string, startSec: string, durationSec: string): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-vn", "-c:a", audioCodec, "-q:a", "2", SEGMENT_OUTPUT_NAME];
}
