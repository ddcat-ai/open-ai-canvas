import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatMs, summarizeTimeline } from "@/lib/timeline/timeline-summary";
import type { TimelineProject } from "@/types/timeline";

const commandsGolden = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/commands.golden.json"), "utf8"),
) as { base: TimelineProject };

describe("formatMs", () => {
    test("毫秒转 m:ss", () => {
        expect(formatMs(0)).toBe("0:00");
        expect(formatMs(59999)).toBe("0:59");
        expect(formatMs(60000)).toBe("1:00");
        expect(formatMs(65000)).toBe("1:05");
        expect(formatMs(600000 + 12000)).toBe("10:12");
    });
    test("负数钳制为 0", () => {
        expect(formatMs(-500)).toBe("0:00");
    });
    test("小数取整", () => {
        // Math.round(ms) 到毫秒再向下取秒：1500.6→1501ms→0:01；1501.9→1502ms→0:01
        expect(formatMs(1500.6)).toBe("0:01");
    });
});

describe("summarizeTimeline", () => {
    test("确定性：同输入两次输出一致", () => {
        expect(summarizeTimeline(commandsGolden.base)).toBe(summarizeTimeline(commandsGolden.base));
    });
    test("含时长、轨道数与片段统计", () => {
        const s = summarizeTimeline(commandsGolden.base);
        expect(s).toContain("总时长 0:08");
        expect(s).toContain("4 条轨道");
        expect(s).toContain("4 个片段");
        expect(s).toContain("字幕 1");
    });
    test("轨道按 order 排序且逐行列 id/kind/label", () => {
        const s = summarizeTimeline(commandsGolden.base);
        const video1 = s.indexOf("video-1");
        const audio1 = s.indexOf("audio-1");
        const subtitle1 = s.indexOf("subtitle-1");
        const video2 = s.indexOf("video-2");
        expect(video1).toBeGreaterThan(-1);
        expect(audio1).toBeGreaterThan(video1);
        expect(subtitle1).toBeGreaterThan(audio1);
        expect(video2).toBeGreaterThan(subtitle1);
        expect(s).toContain("视频轨");
        expect(s).toContain("音频轨");
        expect(s).toContain("字幕轨");
    });
    test("片段逐行列出 id/kind/时间区间，文本被截断到安全长度", () => {
        const s = summarizeTimeline(commandsGolden.base);
        expect(s).toContain("clip-a");
        expect(s).toContain("clip-b");
        expect(s).toContain("clip-c");
        expect(s).toContain("sub-1");
        expect(s).toContain("0-5000ms");
        expect(s).toContain("轨道 video-1");
        expect(s).toContain("轨道 subtitle-1");
    });
    test("字幕 clip 计入字数统计", () => {
        const s = summarizeTimeline(commandsGolden.base);
        expect(s).toMatch(/字幕共 \d+ 字。/);
    });
    test("空时间线给出明确提示", () => {
        const empty: TimelineProject = { version: 2, tracks: [], clips: [], durationMs: 0 };
        const s = summarizeTimeline(empty);
        expect(s).toContain("0 条轨道");
        expect(s).toContain("（空时间线）");
    });
    test("片段总数超限时折叠（防上下文撑爆）", async () => {
        const summaryModule = await import("@/lib/timeline/timeline-summary");
        const manyClips = Array.from({ length: summaryModule.SUMMARY_MAX_CLIP_LINES + 10 }, (_, i) => ({
            id: `c${i}`,
            kind: "video" as const,
            nodeId: `n${i}`,
            trackId: "video-1",
            startMs: i * 1000,
            durationMs: 500,
            sourceStartMs: 0,
            sourceDurationMs: 500,
        }));
        const big: TimelineProject = {
            version: 2,
            tracks: [{ id: "video-1", kind: "video", label: "视频 1", order: 0 }],
            clips: manyClips,
            durationMs: manyClips.length * 1000,
        };
        const s = summarizeTimeline(big);
        const counted = s.match(/^  - clip /gm)?.length ?? 0;
        expect(counted).toBe(summaryModule.SUMMARY_MAX_CLIP_LINES);
        expect(s).toContain("…其余 10 个片段省略");
    });
});
