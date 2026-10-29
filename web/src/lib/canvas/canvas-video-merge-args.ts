// 画布录制转 MP4 的 ffmpeg 参数，纯函数便于单测。
// 世界引擎白膜用 WebGL canvas.captureStream 录制，没有音轨，画布在 dpr 1.5 下宽高经常是奇数。
// @ffmpeg/core 的 libx264 + yuv420p 要求宽高都能被 2 整除，奇数帧会直接失败：
// "width not divisible by 2" → exit 1，界面只看到「视频转码失败，请重试」。
// 该内核还关闭了 pthreads 和 asm，默认 medium preset 在视口分辨率下转不动，所以用 ultrafast 单线程。

export function buildRecordingTranscodeArgs(inputName: string, outputName: string): string[] {
    return ["-i", inputName, "-an", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "1", outputName];
}
