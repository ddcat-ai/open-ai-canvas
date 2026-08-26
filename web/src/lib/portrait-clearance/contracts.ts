/**
 * 肖像可识别性排查的跨组件合同。
 *
 * 画布只持久化这里的紧凑节点状态；图片、embedding、候选列表和完整模型响应
 * 必须留在 Local Runtime 任务目录中。
 */

export const PORTRAIT_CLEARANCE_SCHEMA_VERSION = 1 as const;
export const PORTRAIT_CLEARANCE_PLUGIN_ID = "portrait-clearance" as const;
export const PORTRAIT_CLEARANCE_NODE_TYPE = "portrait-clearance" as const;

export type PortraitRiskLevel =
    | "high"
    | "medium"
    | "low_to_medium"
    | "low"
    | "unable_to_determine";

export type PortraitClearanceMode = "direct-compare" | "network-search";
export type PortraitClearanceAnalysisMode = "local-plus-vision" | "local-only";
export type PortraitClearanceDedupMode = "phash" | "arcface";
export type PortraitClearanceInputRole = "query" | "reference" | "candidate";

export type PortraitClearanceInputBinding = {
    nodeId: string;
    role: PortraitClearanceInputRole;
};

export type PortraitClearanceModelPolicy =
    | { mode: "project-default" }
    | { mode: "pinned"; modelRef: string };

export type PortraitClearanceTaskStatus =
    | "queued"
    | "running"
    | "waiting_model"
    | "partial"
    | "completed"
    | "failed"
    | "cancelled";

export type PortraitClearanceTaskStage =
    | "validating-inputs"
    | "checking-model-resources"
    | "preparing-query"
    | "searching"
    | "downloading-candidates"
    | "deduplicating"
    | "local-comparing"
    | "waiting-for-model"
    | "model-comparing"
    | "building-report"
    | "done";

export type PortraitClearanceNodeState = {
    schemaVersion: typeof PORTRAIT_CLEARANCE_SCHEMA_VERSION;
    mode: PortraitClearanceMode;
    analysisMode: PortraitClearanceAnalysisMode;
    modelPolicy: PortraitClearanceModelPolicy;
    inputBindings: PortraitClearanceInputBinding[];
    settings: {
        maxCandidates: number;
        searchScrolls: number;
        dedupMode: PortraitClearanceDedupMode;
        modelConcurrency: number;
        showBrowserForDebug: boolean;
    };
    activeTaskId?: string;
    task?: {
        status: PortraitClearanceTaskStatus;
        stage: PortraitClearanceTaskStage;
        progress: number;
        processedCandidates: number;
        totalCandidates?: number;
        errorCode?: string;
        errorMessage?: string;
        updatedAt: string;
    };
    lastResult?: {
        taskId: string;
        highestRisk: PortraitRiskLevel;
        riskCounts: Partial<Record<PortraitRiskLevel, number>>;
        candidateCount: number;
        comparedCount: number;
        modelRef?: string;
        completedAt: string;
        detailsAvailable: boolean;
    };
};

export type PortraitClearanceSettings = PortraitClearanceNodeState["settings"];

export type PortraitImageQuality = {
    width: number;
    height: number;
    sharpness: number;
    brightness: number;
    contrast: number;
    grade: "good" | "usable" | "poor";
};

export type PortraitLocalPrecheck = {
    qualityA: PortraitImageQuality;
    qualityB: PortraitImageQuality;
    facesA: number;
    facesB: number;
    selectedFaceA?: { bbox: [number, number, number, number]; detScore: number; areaRatio: number };
    selectedFaceB?: { bbox: [number, number, number, number]; detScore: number; areaRatio: number };
    faceSimilarity?: number;
    ssim: number;
    colorHistogramCorrelation: number;
    canExtractEmbedding: boolean;
    reliabilityIssues: string[];
};

export type PortraitFeatureKey =
    | "face_shape"
    | "facial_layout"
    | "eyes_brows"
    | "nose_mouth"
    | "hair_hairline"
    | "distinctive_features";

export type PortraitVisionComparison = {
    imageAType: "realistic" | "stylized";
    imageBType: "realistic" | "stylized";
    analysisPath: "A" | "B";
    status: "success" | "unable_to_determine";
    riskLevel: PortraitRiskLevel;
    overallSimilarity: number;
    featureComparison: Record<PortraitFeatureKey, {
        similarity: "high" | "medium" | "low" | "none";
        note: string;
    }>;
    basis: string[];
    limitations: string[];
    modificationSuggestions: string[];
    insightfaceFusionNote: string;
    manualReviewRecommended: boolean;
};

export type PortraitPairResult = {
    id: string;
    queryImageId: string;
    comparisonImageId: string;
    candidateId?: string;
    source: "connected-reference" | "connected-candidate" | "baidu";
    status: "success" | "partial" | "failed";
    riskLevel: PortraitRiskLevel;
    overallSimilarity?: number;
    analysisPath: "A" | "B" | "unable";
    localPrecheck: PortraitLocalPrecheck;
    visionComparison?: PortraitVisionComparison;
    basis: string[];
    limitations: string[];
    error?: { code: string; message: string; retryable: boolean };
};

export type PortraitCandidate = {
    id: string;
    originalRank: number;
    title: string;
    imageArtifactId: string;
    imageUrl?: string;
    sourcePageUrl?: string;
    sourceDomain?: string;
    source: "connected" | "baidu";
    byteSize: number;
    width?: number;
    height?: number;
    dedupGroupId?: string;
    resultId?: string;
};

export type PortraitClearanceResult = {
    schemaVersion: typeof PORTRAIT_CLEARANCE_SCHEMA_VERSION;
    taskId: string;
    ownerScopeHash: string;
    projectId: string;
    nodeId: string;
    mode: PortraitClearanceMode;
    analysisMode: PortraitClearanceAnalysisMode;
    modelRef?: string;
    createdAt: string;
    completedAt?: string;
    highestRisk: PortraitRiskLevel;
    riskCounts: Partial<Record<PortraitRiskLevel, number>>;
    localPrecheck?: PortraitLocalPrecheck;
    candidates: PortraitCandidate[];
    pairs: PortraitPairResult[];
    limitations: string[];
    manualReviewRecommended: boolean;
};

export const DEFAULT_PORTRAIT_CLEARANCE_SETTINGS: PortraitClearanceNodeState["settings"] = {
    maxCandidates: 30,
    searchScrolls: 5,
    dedupMode: "phash",
    modelConcurrency: 2,
    showBrowserForDebug: false,
};

export function createDefaultPortraitClearanceState(): PortraitClearanceNodeState {
    return {
        schemaVersion: PORTRAIT_CLEARANCE_SCHEMA_VERSION,
        mode: "direct-compare",
        analysisMode: "local-plus-vision",
        modelPolicy: { mode: "project-default" },
        inputBindings: [],
        settings: { ...DEFAULT_PORTRAIT_CLEARANCE_SETTINGS },
    };
}

export const PORTRAIT_RISK_ORDER: readonly PortraitRiskLevel[] = ["high", "medium", "low_to_medium", "low", "unable_to_determine"];

export const PORTRAIT_RISK_LABELS: Record<PortraitRiskLevel, string> = {
    high: "高风险",
    medium: "中风险",
    low_to_medium: "中低风险",
    low: "低风险",
    unable_to_determine: "无法判断",
};

export const PORTRAIT_TASK_STAGE_LABELS: Record<PortraitClearanceTaskStage, string> = {
    "validating-inputs": "校验输入",
    "checking-model-resources": "检查本地模型",
    "preparing-query": "准备查询图",
    searching: "网络搜图",
    "downloading-candidates": "采集候选",
    deduplicating: "候选去重",
    "local-comparing": "本地比对",
    "waiting-for-model": "等待视觉模型",
    "model-comparing": "视觉模型分析",
    "building-report": "生成报告",
    done: "已完成",
};

export function isPortraitClearanceTerminalStatus(status?: PortraitClearanceTaskStatus) {
    return status === "partial" || status === "completed" || status === "failed" || status === "cancelled";
}

export function comparePortraitRisk(left: PortraitRiskLevel, right: PortraitRiskLevel) {
    return PORTRAIT_RISK_ORDER.indexOf(left) - PORTRAIT_RISK_ORDER.indexOf(right);
}
