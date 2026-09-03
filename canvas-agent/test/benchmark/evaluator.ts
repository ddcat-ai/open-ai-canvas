/**
 * Storyboard Benchmark v1 — 确定性评估器
 *
 * 纯函数，不调用LLM，不访问网络。
 * 7个metric，总分100。
 */

import type {
    BenchmarkAnnotationFile,
    BenchmarkFixture,
    BenchmarkRecording,
    BenchmarkShot,
    BenchmarkShotSize,
    BlindedAnnotationPacket,
    EvaluationResult,
    MetricScore,
    RawBenchmarkRecording,
} from "./types";
import { METRIC_WEIGHTS, TOTAL_MAX_SCORE } from "./types";
import { getFixtureById } from "./fixtures";

// ============ 辅助函数 ============

function getShotBeatTags(shot: BenchmarkShot, recording: BenchmarkRecording): string[] {
    const fromShot = shot.beatTags ?? [];
    const fromAnnotation = recording.annotations?.[shot.position]?.beatTags ?? [];
    return [...new Set([...fromShot, ...fromAnnotation])];
}

function getShotContinuityTags(shot: BenchmarkShot, recording: BenchmarkRecording): string[] {
    const fromShot = shot.continuityTags ?? [];
    const fromAnnotation = recording.annotations?.[shot.position]?.continuityTags ?? [];
    return [...new Set([...fromShot, ...fromAnnotation])];
}

function normalizeShotSize(size?: string): BenchmarkShotSize {
    if (!size) return "other";
    const s = size.toLowerCase();
    if (s.includes("wide") || s.includes("远景") || s.includes("全景") || s.includes("establishing") || s.includes("建立")) return "wide";
    if (s.includes("medium") || s.includes("中景") || s.includes("中近")) return "medium";
    if (s.includes("close") || s.includes("近景") || s.includes("特写") || s.includes("close-up")) return "close";
    if (s.includes("detail") || s.includes("insert") || s.includes("细节") || s.includes("插入") || s.includes("大特写")) return "detail";
    return "other";
}

function normalizeCameraMovement(movement?: string): string {
    if (!movement || movement.toLowerCase() === "static" || movement === "固定" || movement === "静止" || movement === "无") return "static";
    const m = movement.toLowerCase();
    if (m.includes("pan") || m.includes("tilt") || m.includes("摇") || m.includes("俯仰")) return "pan_tilt";
    if (m.includes("dolly") || m.includes("push") || m.includes("pull") || m.includes("推") || m.includes("拉") || m.includes("zoom")) return "dolly";
    if (m.includes("track") || m.includes("follow") || m.includes("跟") || m.includes("移动跟拍")) return "tracking";
    if (m.includes("handheld") || m.includes("手持") || m.includes("shake")) return "handheld";
    return "other";
}

// ============ Metric 1: Shot Count Compliance ============

function evaluateShotCount(fixture: BenchmarkFixture, recording: BenchmarkRecording): MetricScore {
    const maxScore = METRIC_WEIGHTS.shotCount;
    const violations: string[] = [];
    const actual = recording.shots.length;
    const expected = fixture.requestedShotCount;

    if (actual === expected) {
        return { name: "shotCount", maxScore, score: maxScore, violations };
    }
    violations.push(`分镜数量不符：期望 ${expected}，实际 ${actual}`);
    // 部分得分：差距越小得分越高
    const diff = Math.abs(actual - expected);
    const score = Math.max(0, maxScore - diff * 3);
    return { name: "shotCount", maxScore, score, violations };
}

// ============ Metric 2: Beat Coverage ============

function evaluateBeatCoverage(fixture: BenchmarkFixture, recording: BenchmarkRecording): MetricScore {
    const maxScore = METRIC_WEIGHTS.beatCoverage;
    const violations: string[] = [];
    const required = fixture.expected.requiredBeats;

    const allBeatTags = new Set<string>();
    for (const shot of recording.shots) {
        for (const tag of getShotBeatTags(shot, recording)) {
            allBeatTags.add(tag.toLowerCase());
        }
    }

    const covered: string[] = [];
    const missing: string[] = [];
    for (const beat of required) {
        if (allBeatTags.has(beat.toLowerCase())) {
            covered.push(beat);
        } else {
            missing.push(beat);
        }
    }

    if (missing.length > 0) {
        violations.push(`缺少节拍覆盖：${missing.join(", ")}`);
    }

    const score = Math.round((covered.length / required.length) * maxScore);
    return { name: "beatCoverage", maxScore, score, violations };
}

// ============ Metric 3: Shot Size Diversity ============

function evaluateShotDiversity(fixture: BenchmarkFixture, recording: BenchmarkRecording): MetricScore {
    const maxScore = METRIC_WEIGHTS.shotDiversity;
    const violations: string[] = [];
    let score = maxScore;

    const sizes = recording.shots.map((s) => normalizeShotSize(s.shotSize));
    const categoriesUsed = new Set(sizes.filter((s) => s !== "other"));

    // 检查最少类别数
    if (categoriesUsed.size < fixture.expected.minimumShotSizeCategories) {
        violations.push(`景别类别不足：期望至少 ${fixture.expected.minimumShotSizeCategories} 类，实际 ${categoriesUsed.size} 类`);
        score -= 5;
    }

    // 检查同景别连续长度
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < sizes.length; i++) {
        if (sizes[i] === sizes[i - 1] && sizes[i] !== "other") {
            currentRun++;
            maxRun = Math.max(maxRun, currentRun);
        } else {
            currentRun = 1;
        }
    }

    if (maxRun > fixture.expected.maximumRepeatedShotSizeRun) {
        violations.push(`同景别连续过长：最长连续 ${maxRun} 个，限制 ${fixture.expected.maximumRepeatedShotSizeRun}`);
        score -= 5;
    }

    // 全medium惩罚
    if (sizes.length > 0 && sizes.every((s) => s === "medium")) {
        violations.push("机械构图：所有镜头均为中景");
        score -= 5;
    }

    // 反应镜头检查
    if (fixture.expected.requiresReactionShot) {
        const hasReaction = recording.shots.some((s) =>
            getShotBeatTags(s, recording).some((t) => t.toLowerCase().includes("reaction") || t.toLowerCase().includes("反应")),
        );
        if (!hasReaction) {
            violations.push("缺少反应镜头");
            score -= 3;
        }
    }

    // 插入/细节镜头检查
    if (fixture.expected.requiresInsertShot) {
        const hasInsert = sizes.some((s) => s === "detail") ||
            recording.shots.some((s) =>
                getShotBeatTags(s, recording).some((t) => t.toLowerCase().includes("insert") || t.toLowerCase().includes("detail") || t.toLowerCase().includes("插入") || t.toLowerCase().includes("细节")),
            );
        if (!hasInsert) {
            violations.push("缺少插入/细节镜头");
            score -= 3;
        }
    }

    return { name: "shotDiversity", maxScore, score: Math.max(0, score), violations };
}

// ============ Metric 4: Camera Movement Discipline ============

function evaluateCameraDiscipline(fixture: BenchmarkFixture, recording: BenchmarkRecording): MetricScore {
    const maxScore = METRIC_WEIGHTS.cameraDiscipline;
    const violations: string[] = [];
    let score = maxScore;

    const movements = recording.shots.map((s) => normalizeCameraMovement(s.cameraMovement));
    const movingShots = movements.filter((m) => m !== "static");
    const movingPercentage = movements.length > 0 ? movingShots.length / movements.length : 0;

    // restrained策略：移动镜头不应超过50%
    if (fixture.expected.movementPolicy === "restrained" && movingPercentage > 0.5) {
        violations.push(`运镜过度：${Math.round(movingPercentage * 100)}% 镜头有运镜，克制风格应≤50%`);
        score -= 4;
    }

    // 所有镜头都有运镜惩罚
    if (movements.length > 0 && movements.every((m) => m !== "static")) {
        violations.push("每个镜头都有运镜（静态镜头是有效且常更优的选择）");
        score -= 3;
    }

    // 重复相同运镜惩罚
    const movementCounts = new Map<string, number>();
    for (const m of movingShots) {
        movementCounts.set(m, (movementCounts.get(m) ?? 0) + 1);
    }
    for (const [movement, count] of movementCounts) {
        if (movingShots.length >= 3 && count === movingShots.length) {
            violations.push(`运镜重复：所有移动镜头均为 ${movement}`);
            score -= 3;
        }
    }

    return { name: "cameraDiscipline", maxScore, score: Math.max(0, score), violations };
}

// ============ Metric 5: Pacing / Duration ============

function evaluatePacing(fixture: BenchmarkFixture, recording: BenchmarkRecording): MetricScore {
    const maxScore = METRIC_WEIGHTS.pacing;
    const violations: string[] = [];
    let score = maxScore;

    const durations = recording.shots.map((s) => s.durationMs ?? 0);
    const positiveDurations = durations.filter((d) => d > 0);

    // 所有时长>0
    if (positiveDurations.length < durations.length) {
        violations.push(`缺少时长：${durations.length - positiveDurations.length} 个镜头无有效时长`);
        score -= 4;
    }

    // 总时长检查
    if (fixture.totalDurationMs && positiveDurations.length > 0) {
        const total = positiveDurations.reduce((a, b) => a + b, 0);
        const tolerance = fixture.expected.totalDurationToleranceMs ?? fixture.totalDurationMs * 0.2;
        if (Math.abs(total - fixture.totalDurationMs) > tolerance) {
            violations.push(`总时长偏差：期望 ${fixture.totalDurationMs}ms±${tolerance}ms，实际 ${total}ms`);
            score -= 4;
        }
    }

    // 时长多样性检查（varied策略）
    if (fixture.expected.durationPolicy === "varied" && positiveDurations.length >= 3) {
        const uniqueDurations = new Set(positiveDurations);
        if (uniqueDurations.size === 1) {
            violations.push("时长机械：所有镜头时长完全相同");
            score -= 4;
        } else if (uniqueDurations.size <= 2) {
            violations.push("时长变化不足：仅使用了2种不同时长");
            score -= 2;
        }
    }

    // 动作镜头可读性检查
    if (fixture.expected.durationPolicy === "action-readable" && fixture.expected.minActionShotDurationMs) {
        const actionShots = recording.shots.filter((s) =>
            getShotBeatTags(s, recording).some((t) =>
                t.toLowerCase().includes("action") || t.toLowerCase().includes("pursuit") || t.toLowerCase().includes("escape") || t.toLowerCase().includes("动作") || t.toLowerCase().includes("追逐") || t.toLowerCase().includes("逃脱"),
            ),
        );
        for (const shot of actionShots) {
            if (shot.durationMs && shot.durationMs < fixture.expected.minActionShotDurationMs) {
                violations.push(`动作镜头过短：位置${shot.position} 时长${shot.durationMs}ms < 最低${fixture.expected.minActionShotDurationMs}ms`);
                score -= 2;
            }
        }
    }

    return { name: "pacing", maxScore, score: Math.max(0, score), violations };
}

// ============ Metric 6: Continuity ============

function evaluateContinuity(fixture: BenchmarkFixture, recording: BenchmarkRecording): MetricScore {
    const maxScore = METRIC_WEIGHTS.continuity;
    const violations: string[] = [];

    // 收集所有连续性标签（从fixture的requiredBeats推断需要的连续性）
    // v1中连续性评估基于annotations中的continuityTags
    const allContinuityTags = new Set<string>();
    for (const shot of recording.shots) {
        for (const tag of getShotContinuityTags(shot, recording)) {
            allContinuityTags.add(tag.toLowerCase());
        }
    }

    // 根据fixture类别推断需要的连续性检查
    const requiredContinuity: string[] = [];
    if (fixture.category === "dialogue") {
        requiredContinuity.push("eyeline", "same-location");
    }
    if (fixture.category === "action") {
        requiredContinuity.push("action-match", "character-direction", "same-location");
    }
    if (fixture.category === "emotional") {
        requiredContinuity.push("same-location", "phone-prop");
    }
    if (fixture.category === "reveal") {
        requiredContinuity.push("same-location", "photo-prop");
    }

    const covered: string[] = [];
    const missing: string[] = [];
    for (const tag of requiredContinuity) {
        if (allContinuityTags.has(tag)) {
            covered.push(tag);
        } else {
            missing.push(tag);
        }
    }

    if (missing.length > 0) {
        violations.push(`缺少连续性标注：${missing.join(", ")}（需在recording annotations中标注）`);
    }

    const score = requiredContinuity.length > 0
        ? Math.round((covered.length / requiredContinuity.length) * maxScore)
        : maxScore;

    return { name: "continuity", maxScore, score, violations };
}

// ============ Metric 7: Tool Discipline ============

const STORYBOARD_TOOLS = ["project_get_context", "project_create_or_update_shots", "canvas_create_storyboard_shots"];
const FORBIDDEN_GENERATION_TOOLS = ["canvas_generate_image", "canvas_generate_video", "canvas_generate_audio", "canvas_run_generation"];
const DIRECT_CANVAS_CREATION_TOOLS = ["canvas_create_text_node", "canvas_create_node"];

function evaluateToolDiscipline(fixture: BenchmarkFixture, recording: BenchmarkRecording): MetricScore {
    const maxScore = METRIC_WEIGHTS.toolDiscipline;
    const violations: string[] = [];
    let score = maxScore;

    const trace = recording.toolTrace;

    if (trace.length === 0) {
        violations.push("无工具调用记录（无法验证工具纪律）");
        return { name: "toolDiscipline", maxScore, score: 0, violations };
    }

    // 检查语义优先顺序：project_get_context → project_create_or_update_shots → canvas_create_storyboard_shots
    const ctxIdx = trace.indexOf("project_get_context");
    const persistIdx = trace.indexOf("project_create_or_update_shots");
    const projectIdx = trace.indexOf("canvas_create_storyboard_shots");

    if (persistIdx === -1) {
        violations.push("缺少语义持久化：未调用 project_create_or_update_shots");
        score -= 4;
    }
    if (projectIdx === -1) {
        violations.push("缺少画布投影：未调用 canvas_create_storyboard_shots");
        score -= 3;
    }

    // 顺序检查：投影不能在持久化之前
    if (projectIdx !== -1 && persistIdx !== -1 && projectIdx < persistIdx) {
        violations.push("顺序错误：canvas_create_storyboard_shots 在 project_create_or_update_shots 之前（应先持久化再投影）");
        score -= 3;
    }

    // 检查禁止的生成工具
    for (const tool of fixture.expected.forbiddenGeneration) {
        if (trace.includes(tool)) {
            violations.push(`调用了禁止的生成工具：${tool}`);
            score -= 5;
        }
    }

    // 检查直接画布节点创建（分镜投影应使用canvas_create_storyboard_shots）
    for (const tool of DIRECT_CANVAS_CREATION_TOOLS) {
        if (trace.includes(tool)) {
            violations.push(`使用了直接画布节点创建：${tool}（应使用 canvas_create_storyboard_shots）`);
            score -= 3;
        }
    }

    return { name: "toolDiscipline", maxScore, score: Math.max(0, score), violations };
}

// ============ 主评估函数 ============

export function evaluateRecording(recording: BenchmarkRecording): EvaluationResult {
    const fixture = getFixtureById(recording.fixtureId);
    if (!fixture) {
        return {
            fixtureId: recording.fixtureId,
            mode: recording.mode,
            totalScore: 0,
            maxTotalScore: TOTAL_MAX_SCORE,
            metricScores: [],
            violations: [`未找到fixture：${recording.fixtureId}`],
            summary: "评估失败：未找到对应fixture",
        };
    }

    const metricScores: MetricScore[] = [
        evaluateShotCount(fixture, recording),
        evaluateBeatCoverage(fixture, recording),
        evaluateShotDiversity(fixture, recording),
        evaluateCameraDiscipline(fixture, recording),
        evaluatePacing(fixture, recording),
        evaluateContinuity(fixture, recording),
        evaluateToolDiscipline(fixture, recording),
    ];

    const totalScore = metricScores.reduce((sum, m) => sum + m.score, 0);
    const allViolations = metricScores.flatMap((m) => m.violations);

    const summary = `${fixture.name} [${recording.mode}] 总分 ${totalScore}/${TOTAL_MAX_SCORE}，违规 ${allViolations.length} 项`;

    return {
        fixtureId: fixture.id,
        mode: recording.mode,
        totalScore,
        maxTotalScore: TOTAL_MAX_SCORE,
        metricScores,
        violations: allViolations,
        summary,
    };
}

// ============ 比较函数 ============

import type { ComparisonResult, ComparisonRow } from "./types";

export function compareRecordings(baseline: EvaluationResult, director: EvaluationResult): ComparisonResult {
    const rows: ComparisonRow[] = [];
    const allMetrics = new Set([...baseline.metricScores.map((m) => m.name), ...director.metricScores.map((m) => m.name)]);

    for (const metric of allMetrics) {
        const b = baseline.metricScores.find((m) => m.name === metric);
        const d = director.metricScores.find((m) => m.name === metric);
        rows.push({
            metric,
            baseline: b?.score ?? 0,
            director: d?.score ?? 0,
            delta: (d?.score ?? 0) - (b?.score ?? 0),
        });
    }

    return {
        fixtureId: baseline.fixtureId,
        rows,
        baselineTotal: baseline.totalScore,
        directorTotal: director.totalScore,
        deltaTotal: director.totalScore - baseline.totalScore,
    };
}

// ============ Raw Recording + Annotation 合并 ============

/**
 * 将原始录制（不可变，无手动标注）与标注文件合并为可评估的BenchmarkRecording。
 * 原始录制中的shots不包含beatTags/continuityTags，标注文件按position索引提供。
 */
export function mergeRawRecordingAndAnnotation(
    raw: RawBenchmarkRecording,
    annotation?: BenchmarkAnnotationFile,
): BenchmarkRecording {
    const annotations: Record<number, { beatTags?: string[]; continuityTags?: string[] }> = {};

    // 从原始录制的shots中提取已有的benchmark-only标注（如果有）
    for (const shot of raw.shots) {
        if (shot.beatTags || shot.continuityTags) {
            annotations[shot.position] = {
                beatTags: shot.beatTags,
                continuityTags: shot.continuityTags,
            };
        }
    }

    // 从标注文件合并
    if (annotation?.annotations) {
        for (const [posStr, ann] of Object.entries(annotation.annotations)) {
            const pos = Number(posStr);
            const existing = annotations[pos] ?? {};
            annotations[pos] = {
                beatTags: [...new Set([...(existing.beatTags ?? []), ...(ann.beatTags ?? [])])],
                continuityTags: [...new Set([...(existing.continuityTags ?? []), ...(ann.continuityTags ?? [])])],
            };
        }
    }

    // 移除shots中的benchmark-only标注（保持原始录制纯净）
    const cleanShots = raw.shots.map(({ beatTags, continuityTags, ...rest }) => rest);

    return {
        fixtureId: raw.fixtureId,
        mode: raw.mode,
        generatedAt: raw.generatedAt,
        shots: cleanShots,
        toolTrace: raw.toolTrace,
        annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
    };
}

/**
 * 评估原始录制（可选附带标注文件）。
 * 这是评估raw recording的标准入口。
 */
export function evaluateRawRecording(raw: RawBenchmarkRecording, annotation?: BenchmarkAnnotationFile): EvaluationResult {
    const recording = mergeRawRecordingAndAnnotation(raw, annotation);
    return evaluateRecording(recording);
}

// ============ 盲标注支持 ============

let annotationRunCounter = 0;

/**
 * 生成盲标注包：隐藏mode/score/effectiveSkillIds，使用不透明runId。
 * 标注人员无法判断结果来自baseline还是director，避免评估偏差。
 */
export function createBlindedAnnotationPacket(raw: RawBenchmarkRecording): BlindedAnnotationPacket {
    annotationRunCounter++;
    const runId = `R${String(annotationRunCounter).padStart(3, "0")}`;
    return {
        runId,
        fixtureId: raw.fixtureId,
        shots: raw.shots.map((s) => ({
            position: s.position,
            title: s.title,
            description: s.description,
            action: s.action,
            dialogue: s.dialogue,
            shotSize: s.shotSize,
            cameraAngle: s.cameraAngle,
            cameraMovement: s.cameraMovement,
            durationMs: s.durationMs,
        })),
    };
}

/**
 * 从盲标注结果创建标注文件。
 * runId用于追踪，不影响评估。
 */
export function createAnnotationFromBlinded(
    runId: string,
    fixtureId: string,
    annotations: Record<number, { beatTags?: string[]; continuityTags?: string[] }>,
): BenchmarkAnnotationFile {
    return {
        fixtureId,
        runId,
        annotatedAt: new Date().toISOString(),
        annotations,
    };
}
