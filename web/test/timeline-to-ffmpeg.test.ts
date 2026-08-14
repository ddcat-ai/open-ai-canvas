import { describe, expect, test } from "bun:test";

import { buildTimelineRenderPlan, formatSrtTimestamp, type TimelineRenderSource } from "../src/lib/timeline/timeline-to-ffmpeg";
import type { TimelineClip, TimelineProject } from "../src/types/timeline";

function videoClip(id: string, nodeId: string, startMs: number, durationMs: number): TimelineClip {
    return { id, kind: "video", nodeId, trackId: "video", startMs, durationMs, title: id, sourceStartMs: 0, sourceDurationMs: durationMs };
}

function timeline(clips: TimelineClip[]): TimelineProject {
    return { version: 2, tracks: [], clips, durationMs: clips.reduce((max, clip) => Math.max(max, clip.startMs + clip.durationMs), 0) };
}

function source(nodeId: string): TimelineRenderSource {
    return { nodeId, fileName: `input-${nodeId}.mp4`, durationMs: 15_000, url: `file:///${nodeId}.mp4` };
}

/** 从导出计划推导 concat 后的总时长：trim 用 -t，gap 用 lavfi 黑场 d=。 */
function concatTotalSeconds(plan: ReturnType<typeof buildTimelineRenderPlan>): number {
    let total = 0;
    for (const entry of plan.concatEntries) {
        const step = plan.steps.find((item) => item.output === entry);
        if (step?.kind === "trim") total += Number(step.args[step.args.indexOf("-t") + 1]);
        if (step?.kind === "gap") {
            const lavfi = step.args.find((arg) => arg.startsWith("color=c=black")) || "";
            total += Number(lavfi.split("d=")[1]);
        }
    }
    return total;
}

/** 按 concat 顺序逐段累加，校验每个片段/黑场在成片中的实际起点与时间线期望一致。 */
function concatStartOffsetsMs(plan: ReturnType<typeof buildTimelineRenderPlan>): number[] {
    const offsets: number[] = [];
    let cursor = 0;
    for (const entry of plan.concatEntries) {
        const step = plan.steps.find((item) => item.output === entry);
        if (!step) continue;
        offsets.push(cursor);
        if (step.kind === "trim") cursor += Number(step.args[step.args.indexOf("-t") + 1]) * 1000;
        if (step.kind === "gap") {
            const lavfi = step.args.find((arg) => arg.startsWith("color=c=black")) || "";
            cursor += Number(lavfi.split("d=")[1]) * 1000;
        }
    }
    return offsets;
}

describe("buildTimelineRenderPlan 片段与黑场对齐", () => {
    test("全部片段有源素材且首尾相接：无黑场、concat 顺序=片段顺序、总长等于时间线", () => {
        const project = timeline([videoClip("a", "node-a", 0, 15_000), videoClip("b", "node-b", 15_000, 4_000), videoClip("c", "node-c", 19_000, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-a"), source("node-b"), source("node-c")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        expect(plan.steps.filter((step) => step.kind === "gap")).toHaveLength(0);
        expect(concatTotalSeconds(plan)).toBe(34);
        expect(plan.concatEntries).toEqual(["trim-0.mp4", "trim-1.mp4", "trim-2.mp4"]);
    });

    test("全部有源但中间有空隙：黑场必须插在片段之间，而不是追加到片尾", () => {
        // A(0-15s) 与 B(25-40s) 之间有 10s 空隙：修复前 concat=[trim-0,trim-1,gap-1]（黑场在片尾，字幕错位）。
        const project = timeline([videoClip("a", "node-a", 0, 15_000), videoClip("b", "node-b", 25_000, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-a"), source("node-b")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        expect(plan.concatEntries).toEqual(["trim-0.mp4", "gap-1.mp4", "trim-1.mp4"]);
        const gaps = plan.steps.filter((step) => step.kind === "gap");
        expect(gaps).toHaveLength(1);
        expect(gaps[0].args.join(" ")).toContain("d=10");
        expect(concatTotalSeconds(plan)).toBe(40);
        // B 在成片中的起点 = 15s + 10s 黑场 = 25s，与时间线一致。
        expect(concatStartOffsetsMs(plan)).toEqual([0, 15_000, 25_000]);
    });

    test("中间片段无源素材（节点已删除）：该片段跨度补黑场，顺序与总长保持时间线语义", () => {
        const project = timeline([videoClip("a", "node-a", 0, 15_000), videoClip("b", "node-b", 15_000, 4_000), videoClip("c", "node-c", 19_000, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-a"), source("node-c")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        // 黑场 4s 顶替无源的 B，插在 A 与 C 之间：修复前为 [trim-0,trim-2,gap-2]（黑场跑到了片尾）。
        expect(plan.concatEntries).toEqual(["trim-0.mp4", "gap-2.mp4", "trim-2.mp4"]);
        const gaps = plan.steps.filter((step) => step.kind === "gap");
        expect(gaps).toHaveLength(1);
        expect(gaps[0].args.join(" ")).toContain("d=4");
        expect(concatTotalSeconds(plan)).toBe(34);
        // C 的起点 = 15s + 4s 黑场 = 19s，与时间线一致，后续字幕不漂移。
        expect(concatStartOffsetsMs(plan)).toEqual([0, 15_000, 19_000]);
    });

    test("无源片段前有空隙：只补一个 gap，黑场不重复、成片不超长", () => {
        // a(0-15s 有源)、b(20-24s 无源)、c(24-39s 有源)：b 前有 5s 空隙。
        // 修复前 b 会先产出 gap(d=5)，c 又按全跨度产出 gap(d=9)，黑场重复计长、成片 44s≠39s。
        const project = timeline([videoClip("a", "node-a", 0, 15_000), videoClip("b", "node-b", 20_000, 4_000), videoClip("c", "node-c", 24_000, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-a"), source("node-c")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        const gaps = plan.steps.filter((step) => step.kind === "gap");
        expect(gaps).toHaveLength(1);
        // 单个 gap 覆盖 b 的跨度 + 空隙 = 24s - 15s = 9s。
        expect(gaps[0].args.join(" ")).toContain("d=9");
        expect(plan.concatEntries).toEqual(["trim-0.mp4", "gap-2.mp4", "trim-2.mp4"]);
        expect(concatTotalSeconds(plan)).toBe(39);
        expect(concatStartOffsetsMs(plan)).toEqual([0, 15_000, 24_000]);
    });

    test("连续两个无源片段：合并为一个黑场，跨度等于两段之和", () => {
        // a(0-15s 有源)、b(15-19s 无源)、c(19-27s 无源)、d(27-42s 有源)。
        const project = timeline([videoClip("a", "node-a", 0, 15_000), videoClip("b", "node-b", 15_000, 4_000), videoClip("c", "node-c", 19_000, 8_000), videoClip("d", "node-d", 27_000, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-a"), source("node-d")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        const gaps = plan.steps.filter((step) => step.kind === "gap");
        expect(gaps).toHaveLength(1);
        // 15s→27s 之间（b+c）只补一个黑场 d=12。
        expect(gaps[0].args.join(" ")).toContain("d=12");
        expect(plan.concatEntries).toEqual(["trim-0.mp4", "gap-3.mp4", "trim-3.mp4"]);
        expect(concatTotalSeconds(plan)).toBe(42);
        expect(concatStartOffsetsMs(plan)).toEqual([0, 15_000, 27_000]);
    });

    test("开头无源且起点非零：单个 gap 从 0 补到首个有源片段起点", () => {
        // x(5-9s 无源)、a(9-24s 有源)：开头到 a 之间应只有一个 d=9 的黑场。
        const project = timeline([videoClip("x", "node-x", 5_000, 4_000), videoClip("a", "node-a", 9_000, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-a")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        const gaps = plan.steps.filter((step) => step.kind === "gap");
        expect(gaps).toHaveLength(1);
        expect(gaps[0].args.join(" ")).toContain("d=9");
        expect(plan.concatEntries).toEqual(["gap-1.mp4", "trim-1.mp4"]);
        expect(concatTotalSeconds(plan)).toBe(24);
        expect(concatStartOffsetsMs(plan)).toEqual([0, 9_000]);
    });

    test("首个片段无源素材：开头补黑场，后续片段位置保持", () => {
        const project = timeline([videoClip("b", "node-b", 0, 4_000), videoClip("c", "node-c", 4_000, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-c")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        expect(plan.concatEntries).toEqual(["gap-1.mp4", "trim-1.mp4"]);
        const gaps = plan.steps.filter((step) => step.kind === "gap");
        expect(gaps).toHaveLength(1);
        expect(gaps[0].args.join(" ")).toContain("d=4");
        expect(concatTotalSeconds(plan)).toBe(19);
    });

    test("无任何源素材：不产出 concat 与最终输出步骤", () => {
        const project = timeline([videoClip("a", "node-a", 0, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        expect(plan.concatEntries).toEqual([]);
        expect(plan.steps.some((step) => step.output === "out.mp4")).toBe(false);
    });
});

describe("trim 步骤输出 seek（-ss 在 -i 之后）", () => {
    test("裁切参数必须把 -ss 放在 -i 之后：输入 seek 会按关键帧对齐导致切点偏移", () => {
        const project = timeline([videoClip("a", "node-a", 0, 15_000)]);
        const plan = buildTimelineRenderPlan(project, [source("node-a")], { width: 1280, height: 720, fps: 30, outputName: "out.mp4" });
        const trims = plan.steps.filter((step) => step.kind === "trim");
        expect(trims).toHaveLength(1);
        const args = trims[0].args;
        const inputIndex = args.indexOf("-i");
        const ssIndex = args.indexOf("-ss");
        expect(inputIndex).toBeGreaterThan(-1);
        expect(ssIndex).toBeGreaterThan(-1);
        // -ss 必须在 -i 之后（输出 seek，帧精确）；在 -i 之前是输入 seek，MP4/H.264 只对齐关键帧。
        expect(ssIndex).toBeGreaterThan(inputIndex);
    });
});

describe("formatSrtTimestamp", () => {
    test("SRT 时间码毫秒对齐三位", () => {
        expect(formatSrtTimestamp(3_600_000 + 60_000 + 1_234)).toBe("01:01:01,234");
        expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    });
});
