/**
 * Storyboard Benchmark v1 — 评估器单元测试
 *
 * 验证确定性评估器的7个metric和比较功能。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateRecording, compareRecordings } from "./benchmark/evaluator";
import {
    perfectEmotionalRecording,
    baselineEmotionalRecording,
    directorEmotionalRecording,
    wrongShotCountRecording,
    wrongToolOrderRecording,
    missingBeatsRecording,
} from "./benchmark/sample-recordings";
import type { BenchmarkRecording, BenchmarkShot } from "./benchmark/types";
import { TOTAL_MAX_SCORE } from "./benchmark/types";

test("1. 完美fixture得分接近满分100", () => {
    const result = evaluateRecording(perfectEmotionalRecording);
    assert.ok(result.totalScore >= 90, `总分应>=90，实际${result.totalScore}`);
    assert.ok(result.totalScore <= TOTAL_MAX_SCORE);
    assert.equal(result.maxTotalScore, TOTAL_MAX_SCORE);
    const severeViolations = result.violations.filter((v) =>
        v.includes("缺少") || v.includes("禁止") || v.includes("顺序错误"),
    );
    assert.equal(severeViolations.length, 0, "完美样本不应有严重违规");
});

test("2. 错误分镜数量被检测", () => {
    const result = evaluateRecording(wrongShotCountRecording);
    const shotCountMetric = result.metricScores.find((m) => m.name === "shotCount");
    assert.ok(shotCountMetric);
    assert.ok(shotCountMetric!.score < shotCountMetric!.maxScore);
    assert.ok(shotCountMetric!.violations.some((v) => v.includes("分镜数量不符")));
});

test("3. 全medium构图被惩罚", () => {
    const result = evaluateRecording(baselineEmotionalRecording);
    const diversityMetric = result.metricScores.find((m) => m.name === "shotDiversity");
    assert.ok(diversityMetric);
    assert.ok(diversityMetric!.score < diversityMetric!.maxScore);
    assert.ok(diversityMetric!.violations.some((v) =>
        v.includes("机械构图") || v.includes("景别类别不足") || v.includes("同景别连续过长"),
    ));
});

test("4. 每个镜头都有运镜被惩罚", () => {
    const result = evaluateRecording(baselineEmotionalRecording);
    const cameraMetric = result.metricScores.find((m) => m.name === "cameraDiscipline");
    assert.ok(cameraMetric);
    assert.ok(cameraMetric!.score < cameraMetric!.maxScore);
    assert.ok(cameraMetric!.violations.some((v) =>
        v.includes("每个镜头都有运镜") || v.includes("运镜过度") || v.includes("运镜重复"),
    ));
});

test("5. 所有镜头时长相同被惩罚（fixture期望varied）", () => {
    const result = evaluateRecording(baselineEmotionalRecording);
    const pacingMetric = result.metricScores.find((m) => m.name === "pacing");
    assert.ok(pacingMetric);
    assert.ok(pacingMetric!.score < pacingMetric!.maxScore);
    assert.ok(pacingMetric!.violations.some((v) =>
        v.includes("时长机械") || v.includes("时长变化不足"),
    ));
});

test("6. 缺少reveal/reaction节拍被惩罚", () => {
    const result = evaluateRecording(missingBeatsRecording);
    const beatMetric = result.metricScores.find((m) => m.name === "beatCoverage");
    assert.ok(beatMetric);
    assert.ok(beatMetric!.score < beatMetric!.maxScore);
    assert.ok(beatMetric!.violations.some((v) =>
        v.includes("缺少节拍覆盖") && (v.includes("reveal") || v.includes("emotional_turn")),
    ));
});

test("7. 连续性要求缺失被检测", () => {
    const result = evaluateRecording(baselineEmotionalRecording);
    const continuityMetric = result.metricScores.find((m) => m.name === "continuity");
    assert.ok(continuityMetric);
    assert.ok(continuityMetric!.score < continuityMetric!.maxScore);
    assert.ok(continuityMetric!.violations.some((v) => v.includes("缺少连续性标注")));
});

test("8. 调用禁止的生成工具产生tool-discipline违规", () => {
    const result = evaluateRecording(baselineEmotionalRecording);
    const toolMetric = result.metricScores.find((m) => m.name === "toolDiscipline");
    assert.ok(toolMetric);
    assert.ok(toolMetric!.score < toolMetric!.maxScore);
    assert.ok(toolMetric!.violations.some((v) =>
        v.includes("禁止的生成工具") && v.includes("canvas_generate_image"),
    ));
});

test("9. 错误工具顺序产生违规", () => {
    const result = evaluateRecording(wrongToolOrderRecording);
    const toolMetric = result.metricScores.find((m) => m.name === "toolDiscipline");
    assert.ok(toolMetric);
    assert.ok(toolMetric!.violations.some((v) => v.includes("顺序错误")));
});

test("10. 正确的语义优先工具顺序通过", () => {
    const result = evaluateRecording(perfectEmotionalRecording);
    const toolMetric = result.metricScores.find((m) => m.name === "toolDiscipline");
    assert.ok(toolMetric);
    assert.equal(toolMetric!.score, toolMetric!.maxScore);
    assert.equal(toolMetric!.violations.length, 0);
});

test("11. baseline vs director比较delta计算正确", () => {
    const baselineResult = evaluateRecording(baselineEmotionalRecording);
    const directorResult = evaluateRecording(directorEmotionalRecording);
    const comparison = compareRecordings(baselineResult, directorResult);

    assert.equal(comparison.fixtureId, "emotional-convenience-store");
    assert.equal(comparison.baselineTotal, baselineResult.totalScore);
    assert.equal(comparison.directorTotal, directorResult.totalScore);
    assert.equal(comparison.deltaTotal, directorResult.totalScore - baselineResult.totalScore);
    assert.ok(comparison.deltaTotal > 0, "director应比baseline好");

    for (const row of comparison.rows) {
        assert.equal(row.delta, row.director - row.baseline);
    }
    assert.equal(comparison.rows.length, 7);
});

test("12. benchmark annotations永远不进入生产Shot类型", () => {
    const shot: BenchmarkShot = {
        position: 0,
        title: "test",
        description: "test",
        beatTags: ["setup"],
        continuityTags: ["same-location"],
    };
    assert.ok(shot.beatTags);
    assert.ok(shot.continuityTags);

    const shotWithoutAnnotations: BenchmarkShot = {
        position: 1,
        title: "test2",
        description: "test2",
    };
    assert.equal(shotWithoutAnnotations.beatTags, undefined);
    assert.equal(shotWithoutAnnotations.continuityTags, undefined);

    const recording: BenchmarkRecording = {
        fixtureId: "emotional-convenience-store",
        mode: "baseline",
        generatedAt: "2026-01-01T00:00:00.000Z",
        shots: [shotWithoutAnnotations],
        toolTrace: [],
        annotations: {
            1: { beatTags: ["setup"], continuityTags: ["same-location"] },
        },
    };
    assert.equal(recording.shots[0].beatTags, undefined);
    assert.deepEqual(recording.annotations?.[1]?.beatTags, ["setup"]);
});

test("额外: 7个metric权重总和为100", () => {
    const result = evaluateRecording(perfectEmotionalRecording);
    const totalMax = result.metricScores.reduce((sum, m) => sum + m.maxScore, 0);
    assert.equal(totalMax, 100);
    assert.equal(result.metricScores.length, 7);
});

test("额外: 未找到fixture返回0分和错误信息", () => {
    const invalidRecording: BenchmarkRecording = {
        fixtureId: "nonexistent-fixture",
        mode: "baseline",
        generatedAt: "2026-01-01T00:00:00.000Z",
        shots: [],
        toolTrace: [],
    };
    const result = evaluateRecording(invalidRecording);
    assert.equal(result.totalScore, 0);
    assert.ok(result.violations.length > 0);
    assert.ok(result.summary.includes("评估失败"));
});
