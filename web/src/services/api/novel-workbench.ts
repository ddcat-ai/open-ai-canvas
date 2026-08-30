import type { Project } from "@/services/api/projects";
import { apiClient, request } from "@/services/api/request";

const api = apiClient;

export type NovelWorkbenchMode = "novel" | "screenplay";

export type NovelWorkbenchRun = {
    id: string;
    userId: string;
    projectId: string;
    outputMode: NovelWorkbenchMode | string;
	engineVersion?: number;
    status: "queued" | "running" | "paused" | "completed" | "failed" | string;
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

export type NovelWorkbenchArc = {
    index: number;
    title: string;
    startUnit: number;
    endUnit: number;
    mission: string;
    escalation: string;
    keyConflict: string;
    turn: string;
    exitDebt: string;
    characters: string[];
};

export type NovelWorkbenchControl = {
	engineVersion?: number;
    title?: string;
    logline?: string;
    arcs?: NovelWorkbenchArc[];
	brief?: Record<string, unknown>;
	documents?: NovelWorkbenchControlDocuments;
};

export type NovelWorkbenchLedgerItem = {
	id: string;
	description: string;
	introducedByUnit: number;
	payoffByUnit: number;
	ownerIds: string[];
};

export type NovelWorkbenchRoadmapEntry = {
	id: string;
	title: string;
	startUnit: number;
	endUnit: number;
	mission: string;
	escalation: string;
	keyTurn: string;
	exitDebt: string;
	plannedIntroductions: string[];
	plannedPayoffs: string[];
};

export type NovelWorkbenchControlDocuments = {
	projectOverview?: Record<string, unknown>;
	themeAndProposition?: Record<string, unknown>;
	worldbuilding?: Record<string, unknown>;
	castBible?: Array<Record<string, unknown>>;
	relationshipMap?: Array<Record<string, unknown>>;
	mainPlotlines?: Array<Record<string, unknown>>;
	foreshadowLedger?: NovelWorkbenchLedgerItem[];
	readerPromiseLedger?: NovelWorkbenchLedgerItem[];
	chapterRoadmap?: NovelWorkbenchRoadmapEntry[];
	styleGuide?: Record<string, unknown>;
	writingLog?: Array<Record<string, unknown>>;
};

export type NovelWorkbenchDynamicState = {
    completedUnit: number;
    currentArc: string;
    lastUnitSummary: string;
    nextUnitBridge: string;
	currentRoadmapId?: string;
	currentRoadmapTitle?: string;
	openDebtIds?: string[];
	characterStates?: Record<string, string>;
	relationshipStates?: Record<string, string>;
	plotlineStates?: Record<string, string>;
	foreshadowStates?: Record<string, string>;
	promiseStates?: Record<string, string>;
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
