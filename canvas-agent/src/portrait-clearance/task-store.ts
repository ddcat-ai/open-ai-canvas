import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createPortraitClearanceTaskRequestSchema, portraitClearanceInputSchema, portraitClearanceResultSchema, portraitModelJobCompleteRequestSchema, portraitModelJobFailRequestSchema, portraitModelJobSchema, portraitTaskSummarySchema, type CreatePortraitClearanceTaskRequest, type PortraitClearanceInputRole, type PortraitClearanceTaskStatus, type PortraitModelJob, type PortraitTaskSummary } from "./contracts.js";
import { applyStylizedRiskFloor, summarizeRisk } from "./risk-rules.js";
import { buildPortraitReports } from "./reports.js";

// Base64 expands binary input by roughly 4/3; keep the decoded total below
// 20MB so the signed JSON request remains within Local Runtime's 30MB limit.
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MODEL_JOB_LEASE_MS = 180_000;
const MAX_MODEL_JOB_ATTEMPTS = 3;

export type PortraitTaskInputFile = {
    id: string;
    nodeId: string;
    role: PortraitClearanceInputRole;
    fileName: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    relativePath: string;
};

export type PortraitTaskRecord = PortraitTaskSummary & {
    schemaVersion: 1;
    ownerId: string;
    keyId: string;
    origin: string;
    ownerScopeHash: string;
    settings: CreatePortraitClearanceTaskRequest["settings"];
    inputs: PortraitTaskInputFile[];
    resultRelativePath?: string;
    reportRelativePaths?: Partial<Record<"md" | "html" | "docx", string>>;
    modelJobs?: PortraitModelJob[];
    cancelRequested?: boolean;
};

export type PortraitTaskEvent = {
    id: string;
    taskId: string;
    type: "state" | "candidate" | "error";
    at: string;
    summary: PortraitTaskSummary;
};

export class PortraitTaskStoreError extends Error {
    constructor(readonly code: "portrait_task_not_found" | "portrait_task_forbidden" | "portrait_idempotency_conflict" | "portrait_input_invalid" | "portrait_task_delete_failed" | "portrait_model_job_not_found" | "portrait_model_job_conflict" | "portrait_artifact_not_found", message: string, readonly status = 400) {
        super(message);
        this.name = "PortraitTaskStoreError";
    }
}

export class PortraitTaskStore {
    private readonly active = new Map<string, Promise<void>>();
    private readonly activeControllers = new Map<string, AbortController>();
    private readonly taskLocks = new Map<string, Promise<void>>();
    private readonly deleting = new Set<string>();

    constructor(private readonly root: string, private readonly runtimeOwnerId: string) {}

    async create(request: CreatePortraitClearanceTaskRequest, owner: { keyId: string; origin: string }) {
        const parsed = createPortraitClearanceTaskRequestSchema.parse(request);
        const queryCount = parsed.inputs.filter((input) => input.role === "query").length;
        const referenceCount = parsed.inputs.filter((input) => input.role === "reference").length;
        if (parsed.mode === "direct-compare" && (queryCount !== 1 || referenceCount !== 1)) throw new PortraitTaskStoreError("portrait_input_invalid", "直接比对需要唯一的查询图和参考图", 400);
        if (parsed.mode === "network-search" && queryCount !== 1) throw new PortraitTaskStoreError("portrait_input_invalid", "网络排查需要唯一的查询图", 400);
        const existing = await this.findByOperation(parsed, owner);
        if (existing) return { record: existing, created: false };
        const existingOperation = (await this.listAll()).find((item) => item.clientOperationId === parsed.clientOperationId);
        if (existingOperation) throw new PortraitTaskStoreError("portrait_idempotency_conflict", "同一幂等键已用于另一项肖像排查任务", 409);
        const taskId = `portrait-${crypto.randomBytes(16).toString("hex")}`;
        const taskRoot = this.taskRoot(taskId);
        await fs.mkdir(path.join(taskRoot, "inputs"), { recursive: true });
        let inputFiles: PortraitTaskInputFile[];
        try {
            inputFiles = await persistInputs(taskRoot, parsed.inputs);
        } catch (error) {
            await fs.rm(taskRoot, { recursive: true, force: true });
            throw error;
        }
        const now = new Date().toISOString();
        const record: PortraitTaskRecord = {
            schemaVersion: 1,
            taskId,
            clientOperationId: parsed.clientOperationId,
            ownerId: this.runtimeOwnerId,
            keyId: owner.keyId,
            origin: owner.origin,
            ownerScopeHash: parsed.ownerScopeHash,
            projectId: parsed.projectId,
            nodeId: parsed.nodeId,
            mode: parsed.mode,
            analysisMode: parsed.analysisMode,
            ...(parsed.modelRef ? { modelRef: parsed.modelRef } : {}),
            status: "queued",
            stage: "validating-inputs",
            progress: 0,
            processedCandidates: 0,
            totalCandidates: parsed.mode === "direct-compare" ? 1 : undefined,
            createdAt: now,
            updatedAt: now,
            detailsAvailable: false,
            settings: parsed.settings,
            inputs: inputFiles,
        };
        await this.writeRecord(record);
        await this.appendEvent(record, "state");
        return { record, created: true };
    }

    async get(taskId: string, owner: { keyId: string; origin: string }) {
        const record = await this.readRecord(taskId);
        this.assertOwner(record, owner);
        return record;
    }

    async list(query: { projectId?: string; nodeId?: string; ownerScopeHash?: string; limit: number; cursor?: string }, owner: { keyId: string; origin: string }) {
        const records = (await this.listAll())
            .filter((record) => record.keyId === owner.keyId && record.origin === owner.origin)
            .filter((record) => !query.ownerScopeHash || record.ownerScopeHash === query.ownerScopeHash)
            .filter((record) => !query.projectId || record.projectId === query.projectId)
            .filter((record) => !query.nodeId || record.nodeId === query.nodeId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.taskId.localeCompare(left.taskId));
        const after = query.cursor ? records.findIndex((record) => record.taskId === query.cursor) + 1 : 0;
        const selected = records.slice(Math.max(0, after), Math.min(records.length, Math.max(0, after) + query.limit));
        return { tasks: selected.map(toSummary), ...(selected.length && selected.at(-1)!.taskId !== records.at(-1)?.taskId ? { nextCursor: selected.at(-1)!.taskId } : {}) };
    }

    async counts(owner: { keyId: string; origin: string }) {
        const records = (await this.listAll()).filter((record) => record.keyId === owner.keyId && record.origin === owner.origin);
        const recoverable = records.filter((record) => record.status === "queued" || record.status === "running" || record.status === "waiting_model");
        return { active: records.filter((record) => this.isRunning(record.taskId) || record.status === "waiting_model").length, recoverable: recoverable.length };
    }

    async recoverableRecords() {
        return (await this.listAll()).filter((record) => record.status === "queued" || record.status === "running");
    }

    async update(taskId: string, owner: { keyId: string; origin: string }, patch: Partial<Pick<PortraitTaskRecord, "status" | "stage" | "progress" | "processedCandidates" | "totalCandidates" | "errorCode" | "errorMessage" | "completedAt" | "detailsAvailable" | "resultRelativePath" | "reportRelativePaths" | "modelJobs" | "cancelRequested">>) {
        return this.withTaskLock(taskId, () => this.updateUnlocked(taskId, owner, patch));
    }

    private async updateUnlocked(taskId: string, owner: { keyId: string; origin: string }, patch: Partial<Pick<PortraitTaskRecord, "status" | "stage" | "progress" | "processedCandidates" | "totalCandidates" | "errorCode" | "errorMessage" | "completedAt" | "detailsAvailable" | "resultRelativePath" | "reportRelativePaths" | "modelJobs" | "cancelRequested">>, allowCancelledTransition = false) {
        if (this.deleting.has(taskId)) throw new PortraitTaskStoreError("portrait_task_not_found", "任务正在删除", 404);
        const record = await this.get(taskId, owner);
        if (!allowCancelledTransition && record.status === "cancelled" && patch.status && patch.status !== "cancelled") return record;
        const next: PortraitTaskRecord = { ...record, ...patch, updatedAt: new Date().toISOString() };
        await this.writeRecord(next);
        await this.appendEvent(next, patch.errorCode ? "error" : "state");
        return next;
    }

    async prepareRetry(taskId: string, owner: { keyId: string; origin: string }) {
        this.activeControllers.get(taskId)?.abort();
        await this.active.get(taskId)?.catch(() => undefined);
        return this.withTaskLock(taskId, async () => {
            const record = await this.get(taskId, owner);
            for (const directory of ["results", "reports", "candidates", "model-inputs"]) {
                await fs.rm(path.join(this.taskRoot(record.taskId), directory), { recursive: true, force: true });
            }
            return this.updateUnlocked(taskId, owner, {
                status: "queued",
                stage: "validating-inputs",
                progress: 0,
                processedCandidates: 0,
                errorCode: undefined,
                errorMessage: undefined,
                completedAt: undefined,
                detailsAvailable: false,
                resultRelativePath: undefined,
                reportRelativePaths: undefined,
                modelJobs: undefined,
                cancelRequested: false,
            }, true);
        });
    }

    async writeResult(taskId: string, owner: { keyId: string; origin: string }, result: unknown) {
        const record = await this.get(taskId, owner);
        const parsed = portraitClearanceResultSchema.parse(result);
        const resultRelativePath = "results/clearance-result.json";
        const resultPath = path.join(this.taskRoot(record.taskId), resultRelativePath);
        await atomicWrite(resultPath, JSON.stringify(parsed, null, 2));
        return this.update(taskId, owner, { resultRelativePath, detailsAvailable: true });
    }

    async readResult(taskId: string, owner: { keyId: string; origin: string }) {
        return this.withTaskLock(taskId, async () => {
            const record = await this.get(taskId, owner);
            if (!record.resultRelativePath) return undefined;
            try {
                const value = await this.readStoredResult(record);
                return this.syncFailedModelPairs(record, owner, value);
            } catch {
                return undefined;
            }
        });
    }

    private async readStoredResult(record: PortraitTaskRecord) {
        if (!record.resultRelativePath) return undefined;
        return JSON.parse(await fs.readFile(path.join(this.taskRoot(record.taskId), record.resultRelativePath), "utf8")) as unknown;
    }

    private async syncFailedModelPairs(record: PortraitTaskRecord, owner: { keyId: string; origin: string }, value: unknown) {
        const parsed = portraitClearanceResultSchema.safeParse(value);
        if (!parsed.success || !record.modelJobs?.some((job) => job.status === "failed" && job.errorMessage)) return value;
        let changed = false;
        const pairs = parsed.data.pairs.map((pair) => {
            const job = record.modelJobs?.find((candidate) => candidate.status === "failed" && candidate.pairId === pair.id && candidate.errorMessage);
            if (!job || pair.status === "failed" && pair.error?.code === job.errorCode) return pair;
            changed = true;
            return { ...pair, status: "failed" as const, riskLevel: "unable_to_determine" as const, analysisPath: "unable" as const, overallSimilarity: undefined, visionComparison: undefined, basis: [...pair.basis, job.errorMessage!].slice(0, 32), limitations: [...new Set([...pair.limitations, "该候选未完成视觉模型比对，已从本批次跳过。"])].slice(0, 32), error: { code: job.errorCode || "portrait_model_job_failed", message: job.errorMessage!, retryable: false } };
        });
        if (!changed) return parsed.data;
        const riskSummary = summarizeRisk(pairs);
        const next = portraitClearanceResultSchema.parse({ ...parsed.data, highestRisk: riskSummary.highestRisk, riskCounts: riskSummary.riskCounts, comparedCount: pairs.filter((pair) => pair.status !== "failed").length, pairs });
        await atomicWrite(path.join(this.taskRoot(record.taskId), record.resultRelativePath || "results/clearance-result.json"), JSON.stringify(next, null, 2));
        if (record.status === "partial" || record.status === "completed") {
            await this.refreshReports(record.taskId, owner, next).catch(() => undefined);
        }
        return next;
    }

    async writeReports(taskId: string, owner: { keyId: string; origin: string }, reports: { markdown: string; html: string; docx: Uint8Array }) {
        return this.withTaskLock(taskId, () => this.writeReportsUnlocked(taskId, owner, reports));
    }

    private async writeReportsUnlocked(taskId: string, owner: { keyId: string; origin: string }, reports: { markdown: string; html: string; docx: Uint8Array }) {
        const record = await this.get(taskId, owner);
        const reportDirectory = path.join(this.taskRoot(record.taskId), "reports");
        await fs.mkdir(reportDirectory, { recursive: true });
        await atomicWrite(path.join(reportDirectory, "clearance-report.md"), reports.markdown);
        await atomicWrite(path.join(reportDirectory, "clearance-report.html"), reports.html);
        await atomicWriteBytes(path.join(reportDirectory, "clearance-report.docx"), reports.docx);
        const reportRelativePaths = { md: "reports/clearance-report.md", html: "reports/clearance-report.html", docx: "reports/clearance-report.docx" } as const;
        return this.updateUnlocked(taskId, owner, { reportRelativePaths });
    }

    async readReport(taskId: string, owner: { keyId: string; origin: string }, artifactId: string) {
        const record = await this.get(taskId, owner);
        const relativePath = artifactId === "clearance-report.md" ? record.reportRelativePaths?.md : artifactId === "clearance-report.html" ? record.reportRelativePaths?.html : artifactId === "clearance-report.docx" ? record.reportRelativePaths?.docx : undefined;
        if (!relativePath) throw new PortraitTaskStoreError("portrait_artifact_not_found", "报告不存在", 404);
        const mimeType = artifactId.endsWith(".md") ? "text/markdown; charset=utf-8" : artifactId.endsWith(".html") ? "text/html; charset=utf-8" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const reportPath = path.join(this.taskRoot(record.taskId), relativePath);
        if (artifactId === "clearance-report.html") {
            const existing = await fs.readFile(reportPath, "utf8").catch(() => "");
            if (!existing.includes('data-report-version="2"')) {
                await this.refreshReports(taskId, owner, portraitClearanceResultSchema.parse(await this.readResult(taskId, owner)));
            }
        }
        return { mimeType, bytes: await fs.readFile(reportPath) };
    }

    async ensureModelJobs(taskId: string, owner: { keyId: string; origin: string }) {
        return this.withTaskLock(taskId, () => this.ensureModelJobsUnlocked(taskId, owner));
    }

    private async ensureModelJobsUnlocked(taskId: string, owner: { keyId: string; origin: string }) {
        const record = await this.get(taskId, owner);
        if (record.modelJobs?.length) return record.modelJobs;
        const result = portraitClearanceResultSchema.parse(await this.readStoredResult(record));
        const modelJobs = result.pairs.map((pair) => portraitModelJobSchema.parse({
            jobId: `portrait-job-${crypto.randomBytes(16).toString("hex")}`,
            taskId: record.taskId,
            pairId: pair.id,
            queryImageId: pair.queryImageId,
            comparisonImageId: pair.comparisonImageId,
            status: "pending",
            attempt: 0,
        }));
        const next = { ...record, modelJobs, updatedAt: new Date().toISOString() };
        await this.writeRecord(next);
        await this.appendEvent(next, "state");
        return modelJobs;
    }

    async claimModelJob(taskId: string, owner: { keyId: string; origin: string }): Promise<PortraitModelJob | undefined> {
        return this.withTaskLock(taskId, () => this.claimModelJobUnlocked(taskId, owner));
    }

    private async claimModelJobUnlocked(taskId: string, owner: { keyId: string; origin: string }): Promise<PortraitModelJob | undefined> {
        const record = await this.get(taskId, owner);
        const modelJobs = record.modelJobs || [];
        const now = Date.now();
        let changed = false;
        const exhausted = modelJobs.find((job) => job.status === "leased" && job.attempt > MAX_MODEL_JOB_ATTEMPTS && job.leaseToken && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > now);
        if (exhausted?.leaseToken) {
            exhausted.status = "failed";
            exhausted.errorCode = "portrait_model_attempts_exhausted";
            exhausted.errorMessage = "该候选视觉模型多次未完成，已跳过此候选";
            exhausted.leaseToken = undefined;
            exhausted.leaseExpiresAt = undefined;
            changed = true;
        }
        for (const job of modelJobs) {
            if (job.status === "leased" && (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= now)) {
                job.status = "pending";
                job.leaseToken = undefined;
                job.leaseExpiresAt = undefined;
                changed = true;
            }
        }
        const job = modelJobs.find((candidate) => candidate.status === "pending");
        if (!job) {
            if (changed) await this.saveModelJobs(record, modelJobs);
            return undefined;
        }
        job.status = "leased";
        job.attempt += 1;
        job.leaseToken = crypto.randomBytes(24).toString("base64url");
        job.leaseExpiresAt = new Date(now + MODEL_JOB_LEASE_MS).toISOString();
        await this.saveModelJobs(record, modelJobs);
        return job;
    }

    async completeModelJob(taskId: string, owner: { keyId: string; origin: string }, jobId: string, request: unknown) {
        return this.withTaskLock(taskId, () => this.completeModelJobUnlocked(taskId, owner, jobId, request));
    }

    private async completeModelJobUnlocked(taskId: string, owner: { keyId: string; origin: string }, jobId: string, request: unknown) {
        const parsed = portraitModelJobCompleteRequestSchema.parse(request);
        const record = await this.get(taskId, owner);
        if (record.status === "cancelled") throw new PortraitTaskStoreError("portrait_model_job_conflict", "任务已停止，不能继续提交视觉模型结果", 409);
        const jobs = record.modelJobs || [];
        const job = jobs.find((candidate) => candidate.jobId === jobId);
        if (!job) throw new PortraitTaskStoreError("portrait_model_job_not_found", "模型作业不存在", 404);
        if (job.status === "completed") return { record, result: await this.readStoredResult(record), job };
        assertLeasedJob(job, parsed.attempt, parsed.leaseToken);
        const result = portraitClearanceResultSchema.parse(await this.readStoredResult(record));
        const pair = result.pairs.find((candidate) => candidate.id === job.pairId);
        if (!pair) throw new PortraitTaskStoreError("portrait_model_job_conflict", "模型作业对应的比对结果不存在", 409);
        const vision = applyStylizedRiskFloor(parsed.visionComparison);
        const nextPair = { ...pair, status: vision.status === "success" ? "success" as const : "partial" as const, riskLevel: vision.riskLevel, overallSimilarity: vision.overallSimilarity, analysisPath: vision.analysisPath, visionComparison: vision, basis: [...pair.basis, ...vision.basis].slice(0, 32), limitations: [...pair.limitations, ...vision.limitations].slice(0, 32) };
        const nextPairs = result.pairs.map((candidate) => candidate.id === pair.id ? nextPair : candidate);
        const riskSummary = summarizeRisk(nextPairs);
        const nextResult = portraitClearanceResultSchema.parse({ ...result, highestRisk: riskSummary.highestRisk, riskCounts: riskSummary.riskCounts, pairs: nextPairs, completedAt: undefined });
        await atomicWrite(path.join(this.taskRoot(record.taskId), record.resultRelativePath || "results/clearance-result.json"), JSON.stringify(nextResult, null, 2));
        job.status = "completed";
        job.leaseToken = undefined;
        job.leaseExpiresAt = undefined;
        await this.saveModelJobs(record, jobs);
        const complete = jobs.every((candidate) => candidate.status === "completed" || candidate.status === "failed");
        const completedAt = complete ? new Date().toISOString() : undefined;
        const finalResult = completedAt ? portraitClearanceResultSchema.parse({ ...nextResult, completedAt }) : nextResult;
        if (completedAt) {
            await atomicWrite(path.join(this.taskRoot(record.taskId), record.resultRelativePath || "results/clearance-result.json"), JSON.stringify(finalResult, null, 2));
            await this.refreshReports(taskId, owner, finalResult);
        }
        const updated = await this.updateUnlocked(taskId, owner, complete ? { status: jobs.some((candidate) => candidate.status === "failed") || finalResult.pairs.some((candidate) => candidate.status !== "success") ? "partial" : "completed", stage: "done", progress: 1, processedCandidates: finalResult.pairs.length, completedAt } : { processedCandidates: jobs.filter((candidate) => candidate.status === "completed").length, progress: 0.92 + (jobs.filter((candidate) => candidate.status === "completed").length / Math.max(1, jobs.length)) * 0.08, stage: "model-comparing", status: "waiting_model" });
        return { record: updated, result: finalResult, job };
    }

    async failModelJob(taskId: string, owner: { keyId: string; origin: string }, jobId: string, request: unknown) {
        return this.withTaskLock(taskId, () => this.failModelJobUnlocked(taskId, owner, jobId, request));
    }

    private async failModelJobUnlocked(taskId: string, owner: { keyId: string; origin: string }, jobId: string, request: unknown) {
        const parsed = portraitModelJobFailRequestSchema.parse(request);
        const record = await this.get(taskId, owner);
        if (record.status === "cancelled") throw new PortraitTaskStoreError("portrait_model_job_conflict", "任务已停止，不能继续提交视觉模型结果", 409);
        const jobs = record.modelJobs || [];
        const job = jobs.find((candidate) => candidate.jobId === jobId);
        if (!job) throw new PortraitTaskStoreError("portrait_model_job_not_found", "模型作业不存在", 404);
        if (job.status === "failed") return { record, job };
        assertLeasedJob(job, parsed.attempt, parsed.leaseToken);
        let result = portraitClearanceResultSchema.parse(await this.readStoredResult(record));
        if (parsed.retryable && job.attempt < 3) {
            job.status = "pending";
            job.leaseToken = undefined;
            job.leaseExpiresAt = undefined;
        } else {
            job.status = "failed";
            job.errorCode = parsed.errorCode;
            job.errorMessage = parsed.errorMessage;
            job.leaseToken = undefined;
            job.leaseExpiresAt = undefined;
            const nextPairs = result.pairs.map((pair) => {
                if (pair.id !== job.pairId) return pair;
                return { ...pair, status: "failed" as const, riskLevel: "unable_to_determine" as const, analysisPath: "unable" as const, basis: [...pair.basis, parsed.errorMessage].slice(0, 32), limitations: [...pair.limitations, "该候选未完成视觉模型比对，已从本批次跳过。"].slice(0, 32), error: { code: parsed.errorCode, message: parsed.errorMessage, retryable: false } };
            });
            const riskSummary = summarizeRisk(nextPairs);
            result = portraitClearanceResultSchema.parse({ ...result, highestRisk: riskSummary.highestRisk, riskCounts: riskSummary.riskCounts, pairs: nextPairs, completedAt: undefined });
            await atomicWrite(path.join(this.taskRoot(record.taskId), record.resultRelativePath || "results/clearance-result.json"), JSON.stringify(result, null, 2));
        }
        await this.saveModelJobs(record, jobs);
        const complete = jobs.every((candidate) => candidate.status === "completed" || candidate.status === "failed");
        if (complete) {
            const modelLimitations = jobs.filter((candidate) => candidate.status === "failed" && candidate.errorMessage).map((candidate) => `视觉模型作业未完成：${candidate.errorMessage}`).slice(0, 16);
            const finalResult = portraitClearanceResultSchema.parse({
                ...result,
                limitations: [...result.limitations, ...modelLimitations].slice(0, 32),
                completedAt: new Date().toISOString(),
            });
            await atomicWrite(path.join(this.taskRoot(record.taskId), record.resultRelativePath || "results/clearance-result.json"), JSON.stringify(finalResult, null, 2));
            await this.refreshReports(taskId, owner, finalResult);
        }
        const updated = complete ? await this.updateUnlocked(taskId, owner, { status: "partial", stage: "done", progress: 1, completedAt: new Date().toISOString() }) : await this.updateUnlocked(taskId, owner, { status: "waiting_model", stage: "waiting-for-model" });
        return { record: updated, job };
    }

    async readInput(taskId: string, owner: { keyId: string; origin: string }, inputId: string) {
        const record = await this.get(taskId, owner);
        const input = record.inputs.find((candidate) => candidate.id === inputId);
        if (!input) throw new PortraitTaskStoreError("portrait_input_invalid", "任务输入不存在", 404);
        return { input, bytes: await fs.readFile(path.join(this.taskRoot(record.taskId), input.relativePath)) };
    }

    async writeCandidate(taskId: string, owner: { keyId: string; origin: string }, artifactId: string, extension: "jpg" | "png" | "webp", bytes: Uint8Array) {
        const record = await this.get(taskId, owner);
        if (!/^candidate-[A-Za-z0-9._:-]{1,120}$/.test(artifactId)) throw new PortraitTaskStoreError("portrait_input_invalid", "候选文件标识无效", 400);
        const relativePath = path.join("candidates", `${artifactId}.${extension}`);
        const filePath = path.join(this.taskRoot(record.taskId), relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, bytes, { flag: "wx" });
        return { relativePath };
    }

    async readImageArtifact(taskId: string, owner: { keyId: string; origin: string }, artifactId: string) {
        const record = await this.get(taskId, owner);
        const input = record.inputs.find((candidate) => candidate.id === artifactId);
        if (input) return { mimeType: input.mimeType, bytes: await fs.readFile(path.join(this.taskRoot(record.taskId), input.relativePath)) };
        if (!/^candidate-[A-Za-z0-9._:-]{1,120}$/.test(artifactId)) throw new PortraitTaskStoreError("portrait_input_invalid", "图片资源不存在", 404);
        const directory = path.join(this.taskRoot(record.taskId), "candidates");
        const entries = await fs.readdir(directory).catch(() => [] as string[]);
        const fileName = entries.find((entry) => entry.startsWith(`${artifactId}.`));
        if (!fileName) throw new PortraitTaskStoreError("portrait_input_invalid", "图片资源不存在", 404);
        const extension = path.extname(fileName).slice(1);
        const mimeType = extension === "jpg" ? "image/jpeg" : extension === "png" ? "image/png" : "image/webp";
        return { mimeType, bytes: await fs.readFile(path.join(directory, fileName)) };
    }

    async requestCancel(taskId: string, owner: { keyId: string; origin: string }) {
        return this.withTaskLock(taskId, async () => {
            const record = await this.get(taskId, owner);
            if (isTerminal(record.status)) return record;
            const next = await this.updateUnlocked(taskId, owner, { cancelRequested: true, status: "cancelled", stage: "done", errorCode: "portrait_task_cancelled", errorMessage: "任务已停止", completedAt: new Date().toISOString() });
            this.activeControllers.get(taskId)?.abort();
            return next;
        });
    }

    async delete(taskId: string, owner: { keyId: string; origin: string }) {
        await this.withTaskLock(taskId, async () => {
            const record = await this.get(taskId, owner);
            if (!isTerminal(record.status)) {
                await this.updateUnlocked(taskId, owner, { cancelRequested: true, status: "cancelled", stage: "done", errorCode: "portrait_task_cancelled", errorMessage: "任务已停止", completedAt: new Date().toISOString() });
            }
            this.deleting.add(taskId);
            this.activeControllers.get(taskId)?.abort();
        });
        try {
            await this.active.get(taskId)?.catch(() => undefined);
            return await this.withTaskLock(taskId, async () => {
                const record = await this.get(taskId, owner);
                await fs.rm(this.taskRoot(record.taskId), { recursive: true, force: false }).catch(() => { throw new PortraitTaskStoreError("portrait_task_delete_failed", "删除本地排查数据失败", 500); });
                return { deleted: true as const };
            });
        } finally {
            this.active.delete(taskId);
            this.activeControllers.delete(taskId);
            this.deleting.delete(taskId);
        }
    }

    async events(taskId: string, owner: { keyId: string; origin: string }, afterId?: string) {
        const record = await this.get(taskId, owner);
        const eventPath = path.join(this.taskRoot(record.taskId), "events.ndjson");
        let lines: string[] = [];
        try { lines = (await fs.readFile(eventPath, "utf8")).split("\n").filter(Boolean); } catch { return []; }
        const events = lines.map((line) => JSON.parse(line) as PortraitTaskEvent);
        return afterId ? events.filter((event) => event.id > afterId) : events;
    }

    async inputPath(taskId: string, owner: { keyId: string; origin: string }, inputId: string) {
        const record = await this.get(taskId, owner);
        const input = record.inputs.find((candidate) => candidate.id === inputId);
        if (!input) throw new PortraitTaskStoreError("portrait_input_invalid", "任务输入不存在", 404);
        return path.join(this.taskRoot(taskId), input.relativePath);
    }

    async writeModelInput(taskId: string, owner: { keyId: string; origin: string }, name: "query-search.jpg", bytes: Uint8Array) {
        const record = await this.get(taskId, owner);
        const relativePath = path.join("model-inputs", name);
        const filePath = path.join(this.taskRoot(record.taskId), relativePath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await atomicWriteBytes(filePath, bytes);
        return filePath;
    }

    start(taskId: string, runner: (record: PortraitTaskRecord, signal: AbortSignal) => Promise<void>) {
        if (this.active.has(taskId) || this.deleting.has(taskId)) return;
        const controller = new AbortController();
        const promise = this.readRecord(taskId).then((record) => runner(record, controller.signal)).finally(() => {
            if (this.active.get(taskId) === promise) this.active.delete(taskId);
            if (this.activeControllers.get(taskId) === controller) this.activeControllers.delete(taskId);
        });
        this.active.set(taskId, promise);
        this.activeControllers.set(taskId, controller);
        void promise.catch(() => undefined);
    }

    isRunning(taskId: string) {
        return this.active.has(taskId);
    }

    private async findByOperation(request: CreatePortraitClearanceTaskRequest, owner: { keyId: string; origin: string }) {
        const record = (await this.listAll()).find((candidate) => candidate.clientOperationId === request.clientOperationId);
        if (!record) return undefined;
        if (record.keyId !== owner.keyId || record.origin !== owner.origin || record.ownerScopeHash !== request.ownerScopeHash || record.projectId !== request.projectId || record.nodeId !== request.nodeId) throw new PortraitTaskStoreError("portrait_idempotency_conflict", "肖像排查幂等键不匹配", 409);
        return record;
    }

    private async listAll() {
        await fs.mkdir(this.tasksRoot(), { recursive: true });
        const entries = await fs.readdir(this.tasksRoot(), { withFileTypes: true });
        const records: PortraitTaskRecord[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            try { records.push(await this.readRecord(entry.name)); } catch { /* ignore torn/foreign directories */ }
        }
        return records;
    }

    private async withTaskLock<T>(taskId: string, action: () => Promise<T>): Promise<T> {
        const previous = this.taskLocks.get(taskId) || Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const queued = previous.then(() => gate);
        this.taskLocks.set(taskId, queued);
        await previous;
        try {
            return await action();
        } finally {
            release();
            if (this.taskLocks.get(taskId) === queued) this.taskLocks.delete(taskId);
        }
    }

    private async readRecord(taskId: string) {
        if (!/^[a-z0-9-]{16,80}$/.test(taskId)) throw new PortraitTaskStoreError("portrait_task_not_found", "任务不存在", 404);
        try {
            const value = JSON.parse(await fs.readFile(path.join(this.taskRoot(taskId), "task.json"), "utf8")) as PortraitTaskRecord;
            toSummary(value);
            if (value.schemaVersion !== 1 || value.ownerId !== this.runtimeOwnerId || !Array.isArray(value.inputs)) throw new Error();
            return value;
        } catch (error) {
            if (error instanceof PortraitTaskStoreError) throw error;
            throw new PortraitTaskStoreError("portrait_task_not_found", "任务不存在", 404);
        }
    }

    private assertOwner(record: PortraitTaskRecord, owner: { keyId: string; origin: string }) {
        if (record.ownerId !== this.runtimeOwnerId || record.keyId !== owner.keyId || record.origin !== owner.origin) throw new PortraitTaskStoreError("portrait_task_forbidden", "无权访问该本地排查任务", 403);
    }

    private tasksRoot() { return path.join(this.root, "tasks"); }
    private taskRoot(taskId: string) { return path.join(this.tasksRoot(), taskId); }

    private async writeRecord(record: PortraitTaskRecord) {
        await atomicWrite(path.join(this.taskRoot(record.taskId), "task.json"), JSON.stringify(record, null, 2));
    }

    private async appendEvent(record: PortraitTaskRecord, type: PortraitTaskEvent["type"]) {
        const event: PortraitTaskEvent = { id: `${record.updatedAt}:${crypto.randomBytes(4).toString("hex")}`, taskId: record.taskId, type, at: record.updatedAt, summary: toSummary(record) };
        await fs.appendFile(path.join(this.taskRoot(record.taskId), "events.ndjson"), `${JSON.stringify(event)}\n`, "utf8");
    }

    private async saveModelJobs(record: PortraitTaskRecord, modelJobs: PortraitModelJob[]) {
        const next = { ...record, modelJobs: modelJobs.map((job) => portraitModelJobSchema.parse(job)), updatedAt: new Date().toISOString() };
        await this.writeRecord(next);
        await this.appendEvent(next, "state");
    }

    private async refreshReports(taskId: string, owner: { keyId: string; origin: string }, result: ReturnType<typeof portraitClearanceResultSchema.parse>) {
        const imageIds = new Set([result.queryImageId, ...result.candidates.map((candidate) => candidate.imageArtifactId)]);
        const images = [];
        for (const imageId of imageIds) {
            try {
                const image = await this.readImageArtifact(taskId, owner, imageId);
                images.push({ id: imageId, mimeType: image.mimeType as "image/jpeg" | "image/png" | "image/webp", bytes: image.bytes });
            } catch {
                // A report remains useful when a deleted or unavailable candidate image cannot be embedded.
            }
        }
        await this.writeReportsUnlocked(taskId, owner, await buildPortraitReports(result, images));
    }
}

export function toSummary(record: PortraitTaskRecord): PortraitTaskSummary {
    return portraitTaskSummarySchema.parse({
        taskId: record.taskId,
        clientOperationId: record.clientOperationId,
        ownerScopeHash: record.ownerScopeHash,
        projectId: record.projectId,
        nodeId: record.nodeId,
        mode: record.mode,
        analysisMode: record.analysisMode,
        ...(record.modelRef ? { modelRef: record.modelRef } : {}),
        status: record.status,
        stage: record.stage,
        progress: record.progress,
        processedCandidates: record.processedCandidates,
        ...(record.totalCandidates === undefined ? {} : { totalCandidates: record.totalCandidates }),
        ...(record.errorCode ? { errorCode: record.errorCode } : {}),
        ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(record.completedAt ? { completedAt: record.completedAt } : {}),
        detailsAvailable: record.detailsAvailable,
    });
}

export function isTerminal(status: PortraitClearanceTaskStatus) {
    return status === "partial" || status === "completed" || status === "failed" || status === "cancelled";
}

export function decodePortraitDataUrl(value: string, expectedMime: PortraitTaskInputFile["mimeType"]) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=_-]+)$/.exec(value);
    if (!match || match[1] !== expectedMime) throw new PortraitTaskStoreError("portrait_input_invalid", "输入图片格式无效", 400);
    const data = Buffer.from(match[2]!, "base64");
    if (!data.byteLength || data.byteLength > MAX_INPUT_BYTES) throw new PortraitTaskStoreError("portrait_input_invalid", "输入图片超过本机大小限制", 413);
    return data;
}

async function persistInputs(taskRoot: string, inputs: CreatePortraitClearanceTaskRequest["inputs"]): Promise<PortraitTaskInputFile[]> {
    let totalBytes = 0;
    const files: PortraitTaskInputFile[] = [];
    for (const [index, input] of inputs.entries()) {
        const parsed = portraitClearanceInputSchema.parse(input);
        const bytes = decodePortraitDataUrl(parsed.dataUrl, parsed.mimeType);
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_INPUT_BYTES) throw new PortraitTaskStoreError("portrait_input_invalid", "任务输入总大小超过本机限制", 413);
        const id = `input-${index + 1}`;
        const extension = parsed.mimeType === "image/jpeg" ? "jpg" : parsed.mimeType.slice("image/".length);
        const relativePath = path.join("inputs", `${id}.${extension}`);
        await fs.writeFile(path.join(taskRoot, relativePath), bytes, { flag: "wx" });
        files.push({ id, nodeId: parsed.nodeId, role: parsed.role, fileName: parsed.fileName, mimeType: parsed.mimeType, relativePath });
    }
    return files;
}

async function atomicWrite(filePath: string, contents: string) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    await fs.writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await replaceFile(temporary, filePath);
}

async function atomicWriteBytes(filePath: string, contents: Uint8Array) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    await fs.writeFile(temporary, contents, { flag: "wx" });
    await replaceFile(temporary, filePath);
}

async function replaceFile(temporary: string, target: string) {
    try {
        await fs.rename(temporary, target);
        return;
    } catch (renameError) {
        // Windows can reject replacing a file that is briefly held by an
        // antivirus/indexer. Copying the complete temp file keeps the write
        // recoverable without deleting the previous durable record first.
        try {
            await fs.copyFile(temporary, target);
        } catch {
            throw renameError;
        }
        await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
}

function assertLeasedJob(job: PortraitModelJob, attempt: number, leaseToken: string) {
    if (job.status !== "leased" || job.attempt !== attempt || job.leaseToken !== leaseToken || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new PortraitTaskStoreError("portrait_model_job_conflict", "模型作业租约已失效，请重新领取", 409);
}
