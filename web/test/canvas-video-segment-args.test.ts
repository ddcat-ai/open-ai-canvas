import { describe, expect, test } from "bun:test";

import { buildExtractAudioArgs, buildSegmentTrimArgs, SEGMENT_INPUT_NAME, SEGMENT_OUTPUT_NAME } from "../src/lib/canvas/canvas-video-segment-args";

describe("buildSegmentTrimArgs seek 顺序", () => {
    test("-ss 必须放在 -i 之后（输出 seek）：输入 seek 按关键帧对齐，切点会偏移最多一个 GOP", () => {
        const args = buildSegmentTrimArgs("10.5", "4");
        expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
        expect(args).toEqual(["-i", SEGMENT_INPUT_NAME, "-ss", "10.5", "-t", "4", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", SEGMENT_OUTPUT_NAME]);
    });
});

describe("buildExtractAudioArgs seek 顺序", () => {
    test("音频提取与裁切路径一致，同样使用输出 seek", () => {
        const args = buildExtractAudioArgs("libmp3lame", "10.5", "4");
        expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
        expect(args).toEqual(["-i", SEGMENT_INPUT_NAME, "-ss", "10.5", "-t", "4", "-vn", "-c:a", "libmp3lame", "-q:a", "2", SEGMENT_OUTPUT_NAME]);
    });
});
