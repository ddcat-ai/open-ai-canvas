import type { Project } from "@/services/api/projects";
import { apiClient, request } from "@/services/api/request";

const api = apiClient;

export type NovelWorkbenchMode = "novel" | "screenplay";

export type NovelWorkbenchRun = {
    id: string;
    userId: string;
    projectId: string;
    outputMode: NovelWorkbenchMode | string;
    engineVersion: number;
    status: "queued" | "running" | "paused" | "completed" | "failed" | "archived" | string;
    stage: string;
    pipelineStage?: string;
    qualityPolicy?: string;
    qualityBlockReason?: string;
    targetUnitCount: number;
    completedUnitCount: number;
    currentUnit: number;
    currentTaskId?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
};

export type NovelWorkbenchV3Character = {
    id: string;
    name: string;
    role: string;
    desire: string;
    fear: string;
    voice: string;
    initialState: string;
};

export type NovelWorkbenchV3Fact = {
    id: string;
    statement: string;
    kind: "fact" | "promise" | "question" | string;
    introducedByUnit: number;
    resolveByUnit: number;
    ownerIds: string[];
};

export type NovelWorkbenchV3Bible = {
    premise?: string;
    endingPromise?: string;
    theme?: string;
    worldRules?: string[];
    characters?: NovelWorkbenchV3Character[];
    facts?: NovelWorkbenchV3Fact[];
};

export type NovelWorkbenchV3StoryArc = {
    id: string;
    title: string;
    startUnit: number;
    endUnit: number;
    mission: string;
    turningPoint: string;
    exitPromise: string;
};

export type NovelWorkbenchV3StyleGuide = {
    narrativeVoice?: string;
    pacingRules?: string[];
    forbiddenDrift?: string[];
};

export type NovelWorkbenchV3EpisodePacket = {
    unit: number;
    title: string;
    entryBridge: string;
    goal: string;
    pressure: string;
    choice: string;
    turn: string;
    exitDebt: string;
    characterIds: string[];
    factActions?: Array<{ factId: string; action: string; visibleEvent: string }>;
    characterChanges?: Array<{ characterId: string; toStatus: string; toLocation: string; reason: string }>;
    knowledgeGrants?: Array<{ characterId: string; factIds: string[]; reason: string }>;
    requiredEvents: string[];
    allowedConclusion: string;
    forbiddenConclusions: string[];
};

export type NovelWorkbenchV3ArcPackage = {
    version: number;
    arcId: string;
    title: string;
    startUnit: number;
    endUnit: number;
    entryDigest: string;
    arcSummary: string;
    packets: NovelWorkbenchV3EpisodePacket[];
    sealedAt?: string;
};

export type NovelWorkbenchControl = {
    engineVersion: number;
    title?: string;
    logline?: string;
    brief?: Record<string, unknown>;
    bible?: NovelWorkbenchV3Bible;
    storyMap?: NovelWorkbenchV3StoryArc[];
    style?: NovelWorkbenchV3StyleGuide;
};

export type NovelWorkbenchDynamicState = {
    completedUnit: number;
    currentArc?: NovelWorkbenchV3ArcPackage | null;
    currentArcId?: string;
    lastUnitSummary: string;
    nextUnitBridge: string;
    factStates?: Record<string, string>;
    openQuestions?: Array<{ id: string; text: string; openedUnit: number }>;
    recentSummaries?: Array<{ unit: number; title: string; summary: string }>;
    characterStates?: Record<string, { status?: string; location?: string; knownFactIds?: string[] }>;
};

export type NovelWorkbenchArtifact = {
    id: string;
    runId: string;
    projectId: string;
    unit: number;
    kind: string;
    attempt: number;
    version: number;
    contentJson: string;
    prompt?: string;
    createdAt: string;
    updatedAt: string;
};

export type NovelWorkbenchRunSummary = {
    run: NovelWorkbenchRun;
    project: Project;
    title: string;
    logline: string;
    currentArc: string;
};

export type NovelWorkbenchRunDetail = {
    run: NovelWorkbenchRun;
    project: Project;
    control: NovelWorkbenchControl;
    dynamicState: NovelWorkbenchDynamicState;
    artifacts: NovelWorkbenchArtifact[];
};

export type StartNovelWorkbenchInput = {
    projectName: string;
    premise: string;
    outputMode: NovelWorkbenchMode;
    genre?: string[];
    audience?: string[];
    targetUnitCount: number;
    targetUnitLength: number;
    unitDurationSeconds?: number;
    tone?: string;
    endingDirection?: string;
    structurePreference?: string;
    customRequirements?: string;
    aspectRatio?: string;
    config: Record<string, unknown>;
    logicalModelId?: string;
};

export type ResumeNovelWorkbenchInput = {
    config: Record<string, unknown>;
    logicalModelId?: string;
};

export function listNovelWorkbenchRuns() {
    return request<{ runs: NovelWorkbenchRunSummary[] }>(api.get("/novel-workbench/runs"));
}

export function getNovelWorkbenchRun(projectId: string) {
    return request<NovelWorkbenchRunDetail>(api.get(`/novel-workbench/runs/${encodeURIComponent(projectId)}`));
}

export function startNovelWorkbench(input: StartNovelWorkbenchInput) {
    return request<{ project: Project; run: NovelWorkbenchRun; task?: { id: string } }>(api.post("/novel-workbench/runs", input));
}

export function pauseNovelWorkbench(projectId: string) {
    return request<{ run: NovelWorkbenchRun }>(api.post(`/novel-workbench/runs/${encodeURIComponent(projectId)}/pause`));
}

export function resumeNovelWorkbench(projectId: string, input: ResumeNovelWorkbenchInput) {
    return request<{ run: NovelWorkbenchRun; task?: { id: string } }>(api.post(`/novel-workbench/runs/${encodeURIComponent(projectId)}/resume`, input));
}

export function rebuildNovelWorkbench(projectId: string, input: ResumeNovelWorkbenchInput) {
    return request<{ project: Project; run: NovelWorkbenchRun; task?: { id: string } }>(api.post(`/novel-workbench/runs/${encodeURIComponent(projectId)}/rebuild`, input));
}
