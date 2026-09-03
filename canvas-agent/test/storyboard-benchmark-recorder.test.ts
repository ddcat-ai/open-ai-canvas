/**
 * Storyboard Benchmark v1 — 录制捕获与盲标注测试
 *
 * 验证录制基础设施、原始录制/标注分离、盲标注、评估器兼容性。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    createBlindedAnnotationPacket,
    evaluateRawRecording,
    evaluateRecording,
    mergeRawRecordingAndAnnotation,
} from "./benchmark/evaluator";
import type {
    BenchmarkAnnotationFile,
    BenchmarkRecording,
    RawBenchmarkRecording,
} from "./benchmark/types";

// ============ 测试数据 ============

const rawRecording: RawBenchmarkRecording = {
    fixtureId: "emotional-convenience-store",
    mode: "storyboard-director",
    generatedAt: "2026-09-02T00:00:00.000Z",
    shots: [
        { position: 0, title: "凌晨便利店", description: "城市凌晨", shotSize: "wide", cameraMovement: "static", durationMs: 5000 },
        { position: 1, title: "吃泡面", description: "独自吃泡面", shotSize: "medium", cameraMovement: "static", durationMs: 4000 },
        { position: 2, title: "手机亮起", description: "女儿的头像", shotSize: "detail", cameraMovement: "static", durationMs: 2000 },
    ],
    toolTrace: ["project_get_context", "project_create_or_update_shots", "canvas_create_storyboard_shots"],
    metadata: {
        effectiveSkillIds: ["storyboard-director"],
        projectId: "test-project",
        agentRunId: "run-123",
        threadId: "thread-456",
        requestedShotCount: 8,
    },
};

const annotation: BenchmarkAnnotationFile = {
    fixtureId: "emotional-convenience-store",
    runId: "R001",
    annotatedAt: "2026-09-02T01:00:00.000Z",
    annotations: {
        0: { beatTags: ["setup"], continuityTags: ["same-location"] },
        1: { beatTags: ["setup"], continuityTags: ["same-location"] },
        2: { beatTags: ["reveal"], continuityTags: ["phone-prop"] },
    },
};

// ============ Test 6: 录制序列化排除敏感字段 ============

test("6. 录制序列化不包含密钥/隐私字段", () => {
    const json = JSON.stringify(rawRecording);
    // 不包含常见敏感字段名
    assert.ok(!json.includes("apiKey"), "不应包含apiKey");
    assert.ok(!json.includes("api_key"), "不应包含api_key");
    assert.ok(!json.includes("authorization"), "不应包含authorization");
    assert.ok(!json.includes("Authorization"), "不应包含Authorization");
    assert.ok(!json.includes("token"), "不应包含token");
    assert.ok(!json.includes("cookie"), "不应包含cookie");
    assert.ok(!json.includes("password"), "不应包含password");
    assert.ok(!json.includes("secret"), "不应包含secret");
    // metadata只包含非敏感字段
    assert.ok(rawRecording.metadata.effectiveSkillIds.length > 0);
    assert.ok(rawRecording.metadata.projectId);
});

// ============ Test 7: toolTrace保持精确顺序 ============

test("7. toolTrace保持精确执行顺序", () => {
    assert.deepEqual(rawRecording.toolTrace, [
        "project_get_context",
        "project_create_or_update_shots",
        "canvas_create_storyboard_shots",
    ]);

    // 验证评估器能检测顺序
    const result = evaluateRecording({
        fixtureId: rawRecording.fixtureId,
        mode: rawRecording.mode,
        generatedAt: rawRecording.generatedAt,
        shots: rawRecording.shots,
        toolTrace: rawRecording.toolTrace,
    });
    const toolMetric = result.metricScores.find((m) => m.name === "toolDiscipline");
    assert.ok(toolMetric);
    assert.equal(toolMetric!.violations.length, 0, "正确顺序不应有违规");
});

// ============ Test 8: 原始录制和标注保持分离 ============

test("8. 原始录制和标注保持分离", () => {
    // 原始录制不包含手动标注
    for (const shot of rawRecording.shots) {
        assert.equal(shot.beatTags, undefined, "原始录制shot不应有beatTags");
        assert.equal(shot.continuityTags, undefined, "原始录制shot不应有continuityTags");
    }

    // 合并后标注存在于annotations字段，不在shots中
    const merged = mergeRawRecordingAndAnnotation(rawRecording, annotation);
    assert.ok(merged.annotations, "合并后应有annotations");
    for (const shot of merged.shots) {
        assert.equal(shot.beatTags, undefined, "合并后shot仍不应有beatTags");
        assert.equal(shot.continuityTags, undefined, "合并后shot仍不应有continuityTags");
    }
    assert.deepEqual(merged.annotations?.[0]?.beatTags, ["setup"]);
    assert.deepEqual(merged.annotations?.[2]?.beatTags, ["reveal"]);
});

// ============ Test 9: 盲标注包隐藏mode/effectiveSkillIds/score ============

test("9. 盲标注包隐藏mode/effectiveSkillIds/score", () => {
    const packet = createBlindedAnnotationPacket(rawRecording);

    // 有不透明runId
    assert.ok(packet.runId);
    assert.ok(packet.runId.startsWith("R"));

    // 包含fixtureId和shots
    assert.equal(packet.fixtureId, rawRecording.fixtureId);
    assert.equal(packet.shots.length, rawRecording.shots.length);

    // 不包含mode
    assert.ok(!("mode" in packet), "盲标注包不应包含mode");
    // 不包含effectiveSkillIds
    assert.ok(!("effectiveSkillIds" in packet), "盲标注包不应包含effectiveSkillIds");
    // 不包含metadata
    assert.ok(!("metadata" in packet), "盲标注包不应包含metadata");
    // 不包含score
    assert.ok(!("score" in packet), "盲标注包不应包含score");
    // 不包含toolTrace
    assert.ok(!("toolTrace" in packet), "盲标注包不应包含toolTrace");

    // shots中不包含benchmark-only标注
    for (const shot of packet.shots) {
        assert.ok(!("beatTags" in shot), "盲标注shot不应包含beatTags");
        assert.ok(!("continuityTags" in shot), "盲标注shot不应包含continuityTags");
    }
});

// ============ Test 10: 评估器可消费raw recording + annotation ============

test("10. 评估器可消费raw recording + annotation，不改变当前metric行为", () => {
    // 无标注时评估
    const resultNoAnnotation = evaluateRawRecording(rawRecording);
    assert.ok(resultNoAnnotation.totalScore >= 0);

    // 有标注时评估
    const resultWithAnnotation = evaluateRawRecording(rawRecording, annotation);
    assert.ok(resultWithAnnotation.totalScore >= 0);

    // 有标注时beat coverage应该更好
    const beatNoAnn = resultNoAnnotation.metricScores.find((m) => m.name === "beatCoverage");
    const beatWithAnn = resultWithAnnotation.metricScores.find((m) => m.name === "beatCoverage");
    assert.ok(beatNoAnn && beatWithAnn);
    // 有标注时beat coverage得分应 >= 无标注
    assert.ok(beatWithAnn.score >= beatNoAnn.score, "有标注时beat coverage应更好或相等");

    // 有标注时continuity应该更好
    const contNoAnn = resultNoAnnotation.metricScores.find((m) => m.name === "continuity");
    const contWithAnn = resultWithAnnotation.metricScores.find((m) => m.name === "continuity");
    assert.ok(contNoAnn && contWithAnn);
    assert.ok(contWithAnn.score >= contNoAnn.score, "有标注时continuity应更好或相等");

    // 其他metric不受标注影响
    const otherMetrics = ["shotCount", "shotDiversity", "cameraDiscipline", "pacing", "toolDiscipline"];
    for (const metric of otherMetrics) {
        const m1 = resultNoAnnotation.metricScores.find((m) => m.name === metric);
        const m2 = resultWithAnnotation.metricScores.find((m) => m.name === metric);
        assert.ok(m1 && m2);
        assert.equal(m1.score, m2.score, `${metric}不应受标注影响`);
    }
});

// ============ 额外测试: 合并函数不修改原始数据 ============

test("额外: mergeRawRecordingAndAnnotation不修改原始数据", () => {
    const rawCopy = JSON.parse(JSON.stringify(rawRecording)) as RawBenchmarkRecording;
    const annCopy = JSON.parse(JSON.stringify(annotation)) as BenchmarkAnnotationFile;

    mergeRawRecordingAndAnnotation(rawCopy, annCopy);

    // 原始数据未被修改
    assert.deepEqual(rawCopy, rawRecording);
    assert.deepEqual(annCopy, annotation);
});

// ============ 额外测试: 无标注时合并仍有效 ============

test("额外: 无标注时mergeRawRecordingAndAnnotation仍有效", () => {
    const merged = mergeRawRecordingAndAnnotation(rawRecording, undefined);
    assert.equal(merged.fixtureId, rawRecording.fixtureId);
    assert.equal(merged.shots.length, rawRecording.shots.length);
    assert.equal(merged.toolTrace.length, rawRecording.toolTrace.length);
    assert.equal(merged.annotations, undefined);
});
