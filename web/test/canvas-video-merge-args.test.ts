import { describe, expect, test } from "bun:test";

import { buildRecordingTranscodeArgs, resolveRecordingTranscodeTimeout } from "../src/lib/canvas/canvas-video-merge-args";

describe("buildRecordingTranscodeArgs", () => {
    test("奇数画布先裁成偶数，并且不要求音轨", () => {
        const args = buildRecordingTranscodeArgs("recording.webm", "recording-transcoded.mp4");
        expect(args).toContain("-an");
        expect(args).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2");
        expect(args).not.toContain("-c:a");
        expect(args.indexOf("-vf")).toBeGreaterThan(args.indexOf("-i"));
        expect(args.indexOf("-vf")).toBeLessThan(args.indexOf("recording-transcoded.mp4"));
        expect(args).toEqual(["-i", "recording.webm", "-an", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "1", "recording-transcoded.mp4"]);
    });

    test("给了镜头帧率与时长时按固定帧率重采样并裁到镜头时长", () => {
        const args = buildRecordingTranscodeArgs("in.webm", "out.mp4", { fps: 24, duration: 6 });
        expect(args[args.indexOf("-vf") + 1]).toBe("fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2");
        expect(args[args.indexOf("-t") + 1]).toBe("6");
        expect(args.indexOf("-t")).toBeLessThan(args.indexOf("-c:v"));
        expect(args.at(-1)).toBe("out.mp4");
        const invalid = buildRecordingTranscodeArgs("in.webm", "out.mp4", { fps: Number.NaN, duration: -1 });
        expect(invalid).not.toContain("-t");
        expect(invalid[invalid.indexOf("-vf") + 1]).toBe("scale=trunc(iw/2)*2:trunc(ih/2)*2");
    });

    test("转码超时按镜头时长放宽，未知时长给 5 分钟", () => {
        expect(resolveRecordingTranscodeTimeout()).toBe(300_000);
        expect(resolveRecordingTranscodeTimeout(6)).toBe(180_000);
        expect(resolveRecordingTranscodeTimeout(600)).toBe(900_000);
    });
});
