/**
 * Storyboard Benchmark v1 — 类型定义
 *
 * 仅用于测试/评估，不引入生产数据库模型。
 * 复用现有 Shot / ShotRevision 词汇表。
 */

// ============ 规范化分镜结果（Benchmark-only，不进入生产Schema） ============

export type BenchmarkShotSize = "wide" | "medium" | "close" | "detail" | "other";
export type BenchmarkCameraMovement = "static" | "pan_tilt" | "dolly" | "tracking" | "handheld" | "other";

/**
 * 规范化分镜结果，仅用于benchmark评估。
 * 复用现有Shot/ShotRevision字段词汇，但不引入生产模型。
 */
export interface BenchmarkShot {
    position: number;
    title: string;
    description: string;
    action?: string;
    dialogue?: string;
    shotSize?: BenchmarkShotSize;
    cameraAngle?: string;
    cameraMovement?: BenchmarkCameraMovement;
    durationMs?: number;
    continuityNotes?: string;
    /** benchmark-only标注，永远不进入生产Shot schema */
    beatTags?: string[];
    continuityTags?: string[];
}

// ============ Fixture Schema ============

export type MovementPolicy = "restrained" | "motivated" | "action" | "any";
export type DurationPolicy = "varied" | "uniform-ok" | "action-readable";

export interface BenchmarkFixtureExpected {
    /** 必须覆盖的语义节拍标签 */
    requiredBeats: string[];
    /** 至少使用的景别类别数 */
    minimumShotSizeCategories: number;
    /** 同景别连续最大长度（超过则违规） */
    maximumRepeatedShotSizeRun: number;
    /** 是否必须有反应镜头 */
    requiresReactionShot: boolean;
    /** 是否必须有插入/细节镜头 */
    requiresInsertShot: boolean;
    /** 运镜策略 */
    movementPolicy: MovementPolicy;
    /** 时长策略 */
    durationPolicy: DurationPolicy;
    /** 禁止的生成工具 */
    forbiddenGeneration: string[];
    /** 总时长容忍度（毫秒），可选 */
    totalDurationToleranceMs?: number;
    /** 动作镜头最小时长（毫秒），仅action fixture */
    minActionShotDurationMs?: number;
}

export interface BenchmarkFixture {
    id: string;
    name: string;
    category: "emotional" | "dialogue" | "action" | "reveal" | "tvc";
    script: string;
    requestedShotCount: number;
    totalDurationMs?: number;
    expected: BenchmarkFixtureExpected;
}

// ============ Recording Schema ============

export type RecordingMode = "baseline" | "storyboard-director";

export interface BenchmarkShotAnnotation {
    beatTags?: string[];
    continuityTags?: string[];
}

export interface BenchmarkRecording {
    fixtureId: string;
    mode: RecordingMode;
    generatedAt: string;
    shots: BenchmarkShot[];
    toolTrace: string[];
    /** benchmark-only标注，按shot position索引 */
    annotations?: Record<number, BenchmarkShotAnnotation>;
}

// ============ Evaluator Output ============

export interface MetricScore {
    name: string;
    maxScore: number;
    score: number;
    violations: string[];
}

export interface EvaluationResult {
    fixtureId: string;
    mode: RecordingMode;
    totalScore: number;
    maxTotalScore: number;
    metricScores: MetricScore[];
    violations: string[];
    summary: string;
}

export interface ComparisonRow {
    metric: string;
    baseline: number;
    director: number;
    delta: number;
}

export interface ComparisonResult {
    fixtureId: string;
    rows: ComparisonRow[];
    baselineTotal: number;
    directorTotal: number;
    deltaTotal: number;
}

// ============ Metric Weights ============

export const METRIC_WEIGHTS = {
    shotCount: 15,
    beatCoverage: 20,
    shotDiversity: 15,
    cameraDiscipline: 10,
    pacing: 15,
    continuity: 15,
    toolDiscipline: 10,
} as const;

export const TOTAL_MAX_SCORE = Object.values(METRIC_WEIGHTS).reduce((a, b) => a + b, 0);

// ============ Benchmark Skill Mode ============

export type BenchmarkSkillMode = "normal" | "baseline" | "director";

// ============ Raw Recording (immutable, no manual annotations) ============

export interface RecordingMetadata {
    agentRunId?: string;
    projectId?: string;
    unitId?: string;
    threadId?: string;
    requestedShotCount?: number;
    requestedTotalDurationMs?: number;
    fixtureVersion?: string;
    skillContentHash?: string;
    gitCommit?: string;
    modelRuntime?: string;
    effectiveSkillIds: string[];
}

export interface RawBenchmarkRecording {
    fixtureId: string;
    mode: RecordingMode;
    generatedAt: string;
    shots: BenchmarkShot[];
    toolTrace: string[];
    metadata: RecordingMetadata;
}

// ============ Annotation (separate from raw recording) ============

export interface BenchmarkAnnotationFile {
    fixtureId: string;
    runId: string;
    annotatedAt: string;
    annotations: Record<number, BenchmarkShotAnnotation>;
}

// ============ Blinded Annotation Packet ============

export interface BlindedAnnotationPacket {
    runId: string;
    fixtureId: string;
    shots: Array<{
        position: number;
        title: string;
        description: string;
        action?: string;
        dialogue?: string;
        shotSize?: string;
        cameraAngle?: string;
        cameraMovement?: string;
        durationMs?: number;
    }>;
}

// ============ Fixture Run Context (for manual run procedure) ============

export interface FixtureRunContext {
    fixtureId: string;
    mode: BenchmarkSkillMode;
    prompt: string;
    requestedShotCount: number;
    totalDurationMs?: number;
    setupInstructions: string[];
}
