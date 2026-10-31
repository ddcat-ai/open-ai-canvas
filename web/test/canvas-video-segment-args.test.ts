import { describe, expect, test } from "bun:test";

import { buildExtractAudioArgs, buildSegmentTrimArgs, isMp3Bytes, SEGMENT_AUDIO_OUTPUT_NAME, SEGMENT_INPUT_NAME, SEGMENT_OUTPUT_NAME } from "../src/lib/canvas/canvas-video-segment-args";

describe("buildSegmentTrimArgs seek 顺序", () => {
    test("-ss 必须放在 -i 之后（输出 seek）：输入 seek 按关键帧对齐，切点会偏移最多一个 GOP", () => {
        const args = buildSegmentTrimArgs("10.5", "4");
        expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
        expect(args).toEqual(["-i", SEGMENT_INPUT_NAME, "-ss", "10.5", "-t", "4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", SEGMENT_OUTPUT_NAME]);
    });

    test("视频裁切继续输出 .mp4", () => {
        expect(SEGMENT_OUTPUT_NAME.endsWith(".mp4")).toBe(true);
        expect(buildSegmentTrimArgs("0", "1").at(-1)).toBe(SEGMENT_OUTPUT_NAME);
    });
});

describe("buildExtractAudioArgs", () => {
    test("音频提取与裁切路径一致，同样使用输出 seek", () => {
        const args = buildExtractAudioArgs("libmp3lame", "10.5", "4");
        expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
        expect(args).toEqual(["-i", SEGMENT_INPUT_NAME, "-ss", "10.5", "-t", "4", "-vn", "-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3", SEGMENT_AUDIO_OUTPUT_NAME]);
    });

    // 回归：输出名曾沿用 segment-output.mp4，FFmpeg 按扩展名选了 MP4 容器，服务端识别成 video/mp4，Wan 拒收参考音频。
    test("写到独立的 .mp3 文件，并明确指定 MP3 容器，不靠文件名推断", () => {
        for (const codec of ["libmp3lame", "mp3"]) {
            const args = buildExtractAudioArgs(codec, "0", "2");
            expect(args.at(-1)).toBe(SEGMENT_AUDIO_OUTPUT_NAME);
            expect(args.slice(-3, -1)).toEqual(["-f", "mp3"]);
            expect(args).not.toContain(SEGMENT_OUTPUT_NAME);
        }
        expect(SEGMENT_AUDIO_OUTPUT_NAME.endsWith(".mp3")).toBe(true);
        expect(SEGMENT_AUDIO_OUTPUT_NAME).not.toBe(SEGMENT_OUTPUT_NAME);
    });
});

describe("isMp3Bytes", () => {
    test("ID3 标签头和 Layer III 帧同步字算 MP3", () => {
        expect(isMp3Bytes(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]))).toBe(true);
        expect(isMp3Bytes(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe(true);
        expect(isMp3Bytes(new Uint8Array([0xff, 0xf3, 0x90, 0x64]))).toBe(true);
    });

    test("MP4 容器、AAC ADTS 和空输出都不算 MP3", () => {
        // FFmpeg 旧参数的真实产物开头：00 00 00 1c 'ftyp' 'isom'
        expect(isMp3Bytes(new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))).toBe(false);
        expect(isMp3Bytes(new Uint8Array([0xff, 0xf1, 0x50, 0x80]))).toBe(false);
        expect(isMp3Bytes(new Uint8Array())).toBe(false);
    });
});
