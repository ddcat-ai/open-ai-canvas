import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";

import { createPortraitClearanceTaskRequestSchema, portraitClearanceSettingsSchema, riskFromFaceSimilarity } from "../src/portrait-clearance/contracts.js";
import { deduplicatePortraitCandidates } from "../src/portrait-clearance/dedup.js";
import { computePHash, cosineSimilarity, hammingDistance, imageQuality, structuralSimilarity } from "../src/portrait-clearance/image-metrics.js";
import { buildPortraitReports } from "../src/portrait-clearance/reports.js";
import { downloadPortraitCandidate, validatePublicUrl } from "../src/portrait-clearance/safe-image-download.js";
import { PortraitTaskStore } from "../src/portrait-clearance/task-store.js";
import { installPortraitModels } from "../src/portrait-clearance/model-store.js";

test("portrait risk thresholds and cosine similarity are deterministic", () => {
    assert.equal(riskFromFaceSimilarity(undefined), "unable_to_determine");
    assert.equal(riskFromFaceSimilarity(0.65), "high");
    assert.equal(riskFromFaceSimilarity(0.5), "medium");
    assert.equal(riskFromFaceSimilarity(0.35), "low_to_medium");
    assert.equal(riskFromFaceSimilarity(0.34), "low");
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("portrait model concurrency accepts ten and rejects values above the hard limit", () => {
    const settings = {
        maxCandidates: 30,
        searchScrolls: 5,
        dedupMode: "phash" as const,
        modelConcurrency: 10,
        showBrowserForDebug: false,
    };
    assert.equal(portraitClearanceSettingsSchema.parse(settings).modelConcurrency, 10);
    assert.throws(() => portraitClearanceSettingsSchema.parse({ ...settings, modelConcurrency: 11 }));
});

test("quality boundaries, SSIM and pHash remain finite for small fixtures", () => {
    const flat = new Float32Array(16 * 16).fill(128);
    const contrast = new Float32Array(16 * 16);
    for (let index = 0; index < contrast.length; index += 1) contrast[index] = index % 2 ? 0 : 255;
    assert.equal(imageQuality(16, 16, flat).grade, "poor");
    assert.equal(imageQuality(16, 16, contrast).grade, "good");
    const first = { width: 16, height: 16, values: contrast };
    const second = { width: 16, height: 16, values: contrast.slice() };
    const hash = computePHash(first);
    assert.equal(hash.length, 64);
    assert.equal(hammingDistance(hash, computePHash(second)), 0);
    assert.equal(structuralSimilarity(first, second), 1);
});

test("dedup uses byte hash first and pHash/ArcFace as a conservative second condition", () => {
    const result = deduplicatePortraitCandidates([
        { id: "a", byteHash: "same", phash: "0".repeat(64), byteSize: 100, pixelArea: 100 },
        { id: "b", byteHash: "same", phash: "1".repeat(64), byteSize: 90, pixelArea: 200 },
        { id: "c", byteHash: "c", phash: "0".repeat(63) + "1", byteSize: 100, pixelArea: 100, embedding: [1, 0] },
        { id: "d", byteHash: "d", phash: "0".repeat(63) + "1", byteSize: 100, pixelArea: 100, embedding: [0, 1] },
    ], "arcface");
    assert.deepEqual(result.kept.map((item) => item.id), ["b", "c", "d"]);
    assert.equal(result.byteDeduplicatedCount, 1);
    assert.equal(result.visualDeduplicatedCount, 0);
});

test("task store persists input bytes without returning data URLs and keeps idempotency owner scoped", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-store-"));
    const store = new PortraitTaskStore(root, "runtime-owner");
    const owner = { keyId: "key-1", origin: "http://127.0.0.1:3000" };
    const input = "data:image/png;base64,iVBORw0KGgo=";
    const request = createPortraitClearanceTaskRequestSchema.parse({
        schemaVersion: 1,
        clientOperationId: "portrait-store-0001",
        ownerScopeHash: "a".repeat(64),
        projectId: "project-1",
        nodeId: "node-1",
        mode: "direct-compare",
        analysisMode: "local-only",
        inputs: [
            { nodeId: "query", role: "query", fileName: "query.png", mimeType: "image/png", dataUrl: input },
            { nodeId: "reference", role: "reference", fileName: "reference.png", mimeType: "image/png", dataUrl: input },
        ],
        settings: { maxCandidates: 30, searchScrolls: 5, dedupMode: "phash", modelConcurrency: 2, showBrowserForDebug: false },
    });
    try {
        const first = await store.create(request, owner);
        const retry = await store.create(request, owner);
        assert.equal(first.created, true);
        assert.equal(retry.created, false);
        assert.equal(retry.record.taskId, first.record.taskId);
        assert.equal("dataUrl" in retry.record, false);
        const persisted = await store.readInput(first.record.taskId, owner, "input-1");
        assert.deepEqual(persisted.bytes, Buffer.from("89504e470d0a1a0a", "hex"));
        await assert.rejects(() => store.get(first.record.taskId, { keyId: "other", origin: owner.origin }), { code: "portrait_task_forbidden" });
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("candidate URL validation blocks private destinations before fetching", async () => {
    assert.throws(() => validatePublicUrl("file:///C:/secret.png"), { code: "portrait_candidate_download_blocked" });
    assert.throws(() => validatePublicUrl("https://user:pass@example.com/a.png"), { code: "portrait_candidate_download_blocked" });
    await assert.rejects(() => downloadPortraitCandidate("http://127.0.0.1/image.png", { fetch: async () => { throw new Error("must not fetch"); } }), { code: "portrait_candidate_download_blocked" });
});

test("reports escape untrusted text and stay script-free", async () => {
    const result = {
        schemaVersion: 1 as const,
        taskId: "portrait-report-test",
        mode: "direct-compare" as const,
        queryImageId: "input-1",
        highestRisk: "unable_to_determine" as const,
        riskCounts: { unable_to_determine: 1 },
        candidateCount: 1,
        comparedCount: 1,
        candidates: [{ id: "candidate-1", originalRank: 1, title: "<script>alert(1)</script>", imageArtifactId: "input-2", source: "connected" as const, byteSize: 8, resultId: "pair-1" }],
        pairs: [{ id: "pair-1", queryImageId: "input-1", comparisonImageId: "input-2", source: "connected-reference" as const, status: "success" as const, riskLevel: "unable_to_determine" as const, analysisPath: "unable" as const, localPrecheck: { qualityA: { width: 1, height: 1, sharpness: 0, brightness: 0, contrast: 0, grade: "poor" as const }, qualityB: { width: 1, height: 1, sharpness: 0, brightness: 0, contrast: 0, grade: "poor" as const }, facesA: 0, facesB: 0, ssim: 0, colorHistogramCorrelation: 0, canExtractEmbedding: false, reliabilityIssues: ["<unsafe>"] }, basis: ["<basis>"], limitations: [] }],
        limitations: ["<img src=x onerror=alert(1)>", "本结果不能替代司法鉴定"],
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
    };
    const reports = await buildPortraitReports(result);
    assert.equal(reports.html.includes("<script>"), false);
    assert.equal(reports.html.includes("&lt;script&gt;"), true);
    assert.equal(reports.html.includes("<img src=x onerror"), false);
    assert.equal(Buffer.from(reports.docx).subarray(0, 2).toString(), "PK");
});

test("reports preserve the reference report sections across all export formats", async () => {
    const featureComparison = {
        face_shape: { similarity: "high" as const, note: "脸型轮廓接近" },
        facial_layout: { similarity: "medium" as const, note: "五官布局存在局部相似" },
        eyes_brows: { similarity: "low" as const, note: "眼眉差异明显" },
        nose_mouth: { similarity: "none" as const, note: "鼻口没有明显相似" },
        hair_hairline: { similarity: "medium" as const, note: "发型相近" },
        distinctive_features: { similarity: "high" as const, note: "标志性特征需要人工复核" },
    };
    const result = {
        schemaVersion: 1 as const,
        taskId: "portrait-report-sections",
        mode: "network-search" as const,
        queryImageId: "input-query",
        highestRisk: "medium" as const,
        riskCounts: { medium: 1 },
        candidateCount: 1,
        comparedCount: 1,
        candidates: [{ id: "candidate-1", originalRank: 1, title: "候选图", imageArtifactId: "input-candidate", source: "baidu" as const, byteSize: 8, resultId: "pair-1", sourceDomain: "example.com", sourcePageUrl: "https://example.com/source" }],
        pairs: [{
            id: "pair-1",
            queryImageId: "input-query",
            comparisonImageId: "input-candidate",
            candidateId: "candidate-1",
            source: "baidu" as const,
            status: "success" as const,
            riskLevel: "medium" as const,
            overallSimilarity: 0.62,
            analysisPath: "A" as const,
            localPrecheck: {
                qualityA: { width: 640, height: 800, sharpness: 120, brightness: 120, contrast: 45, grade: "good" as const },
                qualityB: { width: 640, height: 800, sharpness: 100, brightness: 118, contrast: 40, grade: "usable" as const },
                facesA: 1,
                facesB: 1,
                faceSimilarity: 0.62,
                ssim: 0.51,
                colorHistogramCorrelation: 0.44,
                canExtractEmbedding: true,
                reliabilityIssues: [],
            },
            visionComparison: {
                imageAType: "realistic" as const,
                imageBType: "realistic" as const,
                analysisPath: "A" as const,
                status: "success" as const,
                riskLevel: "medium" as const,
                overallSimilarity: 0.62,
                featureComparison,
                basis: ["脸型和标志性特征存在相似"],
                limitations: ["角度不同会影响判断"],
                modificationSuggestions: ["调整发型和眉形后重新复核"],
                insightfaceFusionNote: "本地 ArcFace 结果作为辅助，不单独形成身份结论。",
                manualReviewRecommended: true,
            },
            basis: ["本地 ArcFace 余弦相似度：0.6200。"],
            limitations: ["本机结果不确认私人身份，也不构成法律结论。"],
        }],
        limitations: ["当前候选来自公开网页，来源完整性需人工确认。"],
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
    };
    const fixture = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#d9e7f5" } }).png().toBuffer();
    const reports = await buildPortraitReports(result, [
        { id: "input-query", mimeType: "image/png", bytes: fixture },
        { id: "input-candidate", mimeType: "image/png", bytes: fixture },
    ]);
    assert.match(reports.markdown, /一、检测结论/);
    assert.match(reports.markdown, /本地预检/);
    assert.match(reports.markdown, /多模态面部特征分析/);
    assert.match(reports.markdown, /修改建议/);
    assert.match(reports.html, /feature-table/);
    assert.match(reports.html, /调整发型和眉形后重新复核/);
    assert.match(reports.html, /本地预检明细/);
    assert.match(reports.html, /打开来源页面/);
    assert.match(reports.html, /data-report-version="2"/);
    assert.match(reports.html, /data:image\/jpeg;base64,/);
    assert.doesNotMatch(reports.html, /图片过大，未内嵌/);
    assert.equal(Buffer.from(reports.docx).subarray(0, 2).toString(), "PK");
});

test("deleting an active portrait task aborts its runner and prevents directory revival", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-delete-"));
    const store = new PortraitTaskStore(root, "runtime-owner");
    const owner = { keyId: "key-1", origin: "http://127.0.0.1:3000" };
    const task = await createStoreTask(store, owner, "portrait-delete-0001");
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    store.start(task.taskId, async (_record, signal) => {
        started();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        await store.update(task.taskId, owner, { status: "failed", stage: "done" }).catch(() => undefined);
    });
    try {
        await startedPromise;
        await store.delete(task.taskId, owner);
        await assert.rejects(() => store.get(task.taskId, owner), { code: "portrait_task_not_found" });
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal((await store.recoverableRecords()).some((record) => record.taskId === task.taskId), false);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("a cancelled portrait task cannot be overwritten by a late failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-cancel-"));
    const store = new PortraitTaskStore(root, "runtime-owner");
    const owner = { keyId: "key-1", origin: "http://127.0.0.1:3000" };
    const task = await createStoreTask(store, owner, "portrait-cancel-0001");
    try {
        await store.requestCancel(task.taskId, owner);
        const late = await store.update(task.taskId, owner, { status: "failed", stage: "done", errorCode: "late_failure" });
        assert.equal(late.status, "cancelled");
        assert.equal((await store.get(task.taskId, owner)).status, "cancelled");
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("retry waits for the cancelled portrait runner before resetting durable state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-retry-"));
    const store = new PortraitTaskStore(root, "runtime-owner");
    const owner = { keyId: "key-1", origin: "http://127.0.0.1:3000" };
    const task = await createStoreTask(store, owner, "portrait-retry-0001");
    let runnerExited = false;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    store.start(task.taskId, async (_record, signal) => {
        started();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        await new Promise((resolve) => setTimeout(resolve, 15));
        runnerExited = true;
    });
    try {
        await startedPromise;
        await store.requestCancel(task.taskId, owner);
        const retried = await store.prepareRetry(task.taskId, owner);
        assert.equal(runnerExited, true);
        assert.equal(store.isRunning(task.taskId), false);
        assert.equal(retried.status, "queued");
        assert.equal(retried.cancelRequested, false);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("concurrent portrait model claims lease a job only once", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-claim-"));
    const store = new PortraitTaskStore(root, "runtime-owner");
    const owner = { keyId: "key-1", origin: "http://127.0.0.1:3000" };
    const task = await prepareModelJobTask(store, owner, "portrait-claim-0001");
    try {
        const claims = await Promise.all([store.claimModelJob(task.taskId, owner), store.claimModelJob(task.taskId, owner)]);
        assert.equal(claims.filter(Boolean).length, 1);
        assert.equal(new Set(claims.filter(Boolean).map((job) => job!.leaseToken)).size, 1);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("concurrent portrait model completion and failure cannot overwrite one another", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-model-race-"));
    const store = new PortraitTaskStore(root, "runtime-owner");
    const owner = { keyId: "key-1", origin: "http://127.0.0.1:3000" };
    const task = await prepareModelJobTask(store, owner, "portrait-model-race-0001");
    try {
        const job = await store.claimModelJob(task.taskId, owner);
        assert.ok(job?.leaseToken);
        const settled = await Promise.allSettled([
            store.completeModelJob(task.taskId, owner, job.jobId, { attempt: job.attempt, leaseToken: job.leaseToken, visionComparison: modelVisionResult() }),
            store.failModelJob(task.taskId, owner, job.jobId, { attempt: job.attempt, leaseToken: job.leaseToken, errorCode: "model_failed", errorMessage: "模型失败", retryable: false }),
        ]);
        assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
        assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
        const persisted = await store.get(task.taskId, owner);
        assert.ok(persisted.modelJobs?.[0]?.status === "completed" || persisted.modelJobs?.[0]?.status === "failed");
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("concurrent portrait model installs share one in-flight download", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-install-"));
    let fetchCount = 0;
    const fetchImpl = async () => {
        fetchCount += 1;
        return new Response("unavailable", { status: 503 });
    };
    try {
        const settled = await Promise.allSettled([
            installPortraitModels(root, { fetch: fetchImpl as typeof fetch }),
            installPortraitModels(root, { fetch: fetchImpl as typeof fetch }),
        ]);
        assert.equal(settled.every((item) => item.status === "rejected"), true);
        assert.equal(fetchCount, 1);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("a new portrait task store discovers unfinished tasks after restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "portrait-clearance-recovery-"));
    const owner = { keyId: "key-1", origin: "http://127.0.0.1:3000" };
    const first = new PortraitTaskStore(root, "runtime-owner");
    const task = await createStoreTask(first, owner, "portrait-recover-0001");
    try {
        await first.update(task.taskId, owner, { status: "running", stage: "local-comparing" });
        const restarted = new PortraitTaskStore(root, "runtime-owner");
        assert.deepEqual((await restarted.recoverableRecords()).map((record) => record.taskId), [task.taskId]);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

async function createStoreTask(store: PortraitTaskStore, owner: { keyId: string; origin: string }, clientOperationId: string) {
    const input = "data:image/png;base64,iVBORw0KGgo=";
    return (await store.create({
        schemaVersion: 1,
        clientOperationId,
        ownerScopeHash: "a".repeat(64),
        projectId: "project-1",
        nodeId: "node-1",
        mode: "direct-compare",
        analysisMode: "local-plus-vision",
        inputs: [
            { nodeId: "query", role: "query", fileName: "query.png", mimeType: "image/png", dataUrl: input },
            { nodeId: "reference", role: "reference", fileName: "reference.png", mimeType: "image/png", dataUrl: input },
        ],
        settings: { maxCandidates: 30, searchScrolls: 5, dedupMode: "phash", modelConcurrency: 2, showBrowserForDebug: false },
    }, owner)).record;
}

async function prepareModelJobTask(store: PortraitTaskStore, owner: { keyId: string; origin: string }, clientOperationId: string) {
    const task = await createStoreTask(store, owner, clientOperationId);
    await store.writeResult(task.taskId, owner, {
        schemaVersion: 1,
        taskId: task.taskId,
        mode: "direct-compare",
        queryImageId: "input-1",
        highestRisk: "low",
        riskCounts: { low: 1 },
        candidateCount: 1,
        comparedCount: 1,
        candidates: [{ id: "input-2", originalRank: 1, title: "reference.png", imageArtifactId: "input-2", source: "connected", byteSize: 8, resultId: "pair-1" }],
        pairs: [{ id: "pair-1", queryImageId: "input-1", comparisonImageId: "input-2", source: "connected-reference", status: "partial", riskLevel: "low", overallSimilarity: 0.2, analysisPath: "A", localPrecheck: localPrecheck(), basis: ["本地预检"], limitations: [] }],
        limitations: [],
        createdAt: task.createdAt,
    });
    await store.update(task.taskId, owner, { status: "waiting_model", stage: "waiting-for-model", detailsAvailable: true });
    await store.ensureModelJobs(task.taskId, owner);
    return task;
}

function localPrecheck() {
    const quality = { width: 32, height: 32, sharpness: 1, brightness: 128, contrast: 1, grade: "usable" as const };
    return { qualityA: quality, qualityB: quality, facesA: 1, facesB: 1, faceSimilarity: 0.2, ssim: 0.5, colorHistogramCorrelation: 0.5, canExtractEmbedding: true, reliabilityIssues: [] };
}

function modelVisionResult() {
    const feature = { similarity: "low" as const, note: "差异明显" };
    return { imageAType: "realistic" as const, imageBType: "realistic" as const, analysisPath: "A" as const, status: "success" as const, riskLevel: "low" as const, overallSimilarity: 0.2, featureComparison: { face_shape: feature, facial_layout: feature, eyes_brows: feature, nose_mouth: feature, hair_hairline: feature, distinctive_features: feature }, basis: ["差异明显"], limitations: [], modificationSuggestions: [], insightfaceFusionNote: "本地结果仅作辅助", manualReviewRecommended: false };
}
