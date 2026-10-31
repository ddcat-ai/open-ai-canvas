// 视频片段处理（裁切/提音轨）的 ffmpeg 参数构造，纯函数便于单测。
// -ss 必须放在 -i 之后（输出 seek）：放在 -i 之前是输入 seek，MP4/H.264 只会定位到目标时间戳
// 之前最近的关键帧，切点会偏移最多一个 GOP（常见 0.5-2s）、片尾被 -t 截掉、音视频在切点处错位；
// 本流程已 -c:v libx264 重编码，输出 seek 帧精确，代价只是多解码。

export const SEGMENT_INPUT_NAME = "segment-input.mp4";
export const SEGMENT_OUTPUT_NAME = "segment-output.mp4";
// 提取音频必须用独立的 .mp3 输出名：FFmpeg 按输出文件名选容器，沿用 .mp4 会把 MP3 音轨封进 MP4 容器，
// 上传后服务端按内容识别成 video/mp4，Wan 等只收 wav/mp3 的参考音频会被拒。
export const SEGMENT_AUDIO_OUTPUT_NAME = "segment-audio-output.mp3";

/** 视频片段裁切参数：输出统一编码 MP4。 */
export function buildSegmentTrimArgs(startSec: string, durationSec: string): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", SEGMENT_OUTPUT_NAME];
}

/** 从视频片段提取声音：同样使用输出 seek，保证起点与裁切路径一致；容器明确为 MP3，不靠文件名推断。 */
export function buildExtractAudioArgs(audioCodec: string, startSec: string, durationSec: string): string[] {
    return ["-i", SEGMENT_INPUT_NAME, "-ss", startSec, "-t", durationSec, "-vn", "-c:a", audioCodec, "-q:a", "2", "-f", "mp3", SEGMENT_AUDIO_OUTPUT_NAME];
}

/** 输出是否真的是 MP3：ID3 标签头，或 MPEG 音频帧同步字（11 位全 1，Layer III）。 */
export function isMp3Bytes(bytes: Uint8Array): boolean {
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
    return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}
