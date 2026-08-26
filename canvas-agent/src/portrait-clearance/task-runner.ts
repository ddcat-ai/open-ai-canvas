import { isTerminal, type PortraitTaskRecord, type PortraitTaskStore } from "./task-store.js";
import { portraitClearanceResultSchema, type PortraitCandidate, type PortraitClearanceResult, type PortraitPairResult } from "./contracts.js";
import { cropPortraitSearchImage, decodePortraitImage, type DecodedPortraitImage } from "./image-metrics.js";
import { deduplicatePortraitCandidates, type PortraitDedupCandidate } from "./dedup.js";
import { PortraitFaceEngine, PortraitFaceEngineError, type PortraitFaceAnalysis } from "./face-engine.js";
import { searchBaiduByImage, PortraitBaiduSearchError, type PortraitSearchCandidate } from "./baidu-search.js";
import { downloadPortraitCandidate, PortraitCandidateDownloadError } from "./safe-image-download.js";
import { buildLocalPrecheck, localRisk, summarizeRisk } from "./risk-rules.js";
import { buildPortraitReports } from "./reports.js";

const MAX_CANDIDATE_BYTES = 120 * 1024 * 1024;

type RuntimeCandidate = {
    id: string;
    artifactId: string;
    originalRank: number;
    title: string;
    source: "connected" | "baidu";
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    imageUrl?: string;
    sourcePageUrl?: string;
    sourceDomain?: string;
    bytes: Uint8Array;
    decoded: DecodedPortraitImage;
    faces?: PortraitFaceAnalysis;
};

export class PortraitTaskRunner {
    constructor(private readonly store: PortraitTaskStore, private readonly faceEngine: PortraitFaceEngine) {}

    start(record: PortraitTaskRecord) {
        this.store.start(record.taskId, (current, signal) => this.run(current, signal));
    }

    async recover(owner: { keyId: string; origin: string }) {
        const page = await this.store.list({ limit: 60 }, owner);
        for (const summary of page.tasks) if (summary.status === "queued" || summary.status === "running") this.start(await this.store.get(summary.taskId, owner));
    }

    private async run(initial: PortraitTaskRecord, signal: AbortSignal) {
        const owner = { keyId: initial.keyId, origin: initial.origin };
        try {
            if (signal.aborted || initial.cancelRequested || initial.status === "cancelled") return;
            if (initial.mode === "direct-compare") await this.runDirect(initial, owner, signal);
            else await this.runNetwork(initial, owner, signal);
        } catch (error) {
            if (isAbort(error) || signal.aborted) return;
            const current = await this.store.get(initial.taskId, owner).catch(() => undefined);
            if (!current || current.cancelRequested || current.status === "cancelled") return;
            const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            console.error(`[portrait-clearance] task ${initial.taskId} failed: ${detail}`);
            const code = error instanceof PortraitFaceEngineError ? error.code : error instanceof PortraitCandidateDownloadError ? error.code : "portrait_face_engine_failed";
            await fail(this.store, current, owner, code, publicErrorMessage(code));
        }
    }

    private async runDirect(initial: PortraitTaskRecord, owner: { keyId: string; origin: string }, signal: AbortSignal) {
        const query = initial.inputs.find((input) => input.role === "query");
        const reference = initial.inputs.find((input) => input.role === "reference");
        if (!query || !reference) return fail(this.store, initial, owner, "portrait_input_missing", "直接比对需要一张查询图和一张参考图");
        let record = await this.store.update(initial.taskId, owner, { status: "running", stage: "checking-model-resources", progress: 0.08 });
        if (!(await this.faceEngine.status()).ready) return fail(this.store, record, owner, "portrait_model_missing", "请先安装并校验本地 det_10g.onnx 与 w600k_r50.onnx");
        record = await this.store.update(record.taskId, owner, { stage: "preparing-query", progress: 0.16 });
        let queryImage: DecodedPortraitImage;
        let referenceImage: DecodedPortraitImage;
        try {
            queryImage = await this.readInputImage(record, owner, query.id);
            referenceImage = await this.readInputImage(record, owner, reference.id);
        } catch {
            return fail(this.store, record, owner, "portrait_input_invalid", "输入图片损坏、过大或格式不受支持");
        }
        record = await this.store.update(record.taskId, owner, { stage: "local-comparing", progress: 0.35, processedCandidates: 0, totalCandidates: 1 });
        const [queryFaces, referenceFaces] = await Promise.all([this.faceEngine.analyze(queryImage), this.faceEngine.analyze(referenceImage)]);
        if (await this.cancelled(record, owner, signal)) return;
        const localPrecheck = buildLocalPrecheck(queryImage, referenceImage, queryFaces, referenceFaces);
        const pair: PortraitPairResult = {
            id: "pair-1",
            queryImageId: query.id,
            comparisonImageId: reference.id,
            source: "connected-reference",
            status: record.analysisMode === "local-only" ? "success" : "partial",
            riskLevel: localRisk(localPrecheck),
            ...(localPrecheck.faceSimilarity === undefined ? {} : { overallSimilarity: reportSimilarity(localPrecheck.faceSimilarity) }),
            analysisPath: localPrecheck.canExtractEmbedding && localPrecheck.reliabilityIssues.length === 0 ? "A" : "unable",
            localPrecheck,
            basis: localPrecheck.faceSimilarity === undefined ? ["未能提取双方可比对的人脸特征，无法仅凭本地辅助指标得出风险等级。"] : [`本地 ArcFace 余弦相似度：${localPrecheck.faceSimilarity.toFixed(4)}。`],
            limitations: record.analysisMode === "local-only" ? ["仅本地模式不调用项目视觉模型；风格化图像或可靠性异常必须人工复核。"] : ["本地预检已完成，等待页面级协调器调用项目视觉模型。"],
        };
        return this.persistResult(record, owner, query.id, [pair], [{ id: reference.id, artifactId: reference.id, originalRank: 0, title: reference.fileName, source: "connected", mimeType: reference.mimeType, bytes: await this.readInputBytes(record, owner, reference.id), decoded: referenceImage }], []);
    }

    private async runNetwork(initial: PortraitTaskRecord, owner: { keyId: string; origin: string }, signal: AbortSignal) {
        const query = initial.inputs.find((input) => input.role === "query");
        if (!query) return fail(this.store, initial, owner, "portrait_input_missing", "网络排查需要一张查询图");
        let record = await this.store.update(initial.taskId, owner, { status: "running", stage: "checking-model-resources", progress: 0.06 });
        if (!(await this.faceEngine.status()).ready) return fail(this.store, record, owner, "portrait_model_missing", "请先安装并校验本地 det_10g.onnx 与 w600k_r50.onnx");
        record = await this.store.update(record.taskId, owner, { stage: "preparing-query", progress: 0.14 });
        let queryBytes: Uint8Array;
        let queryImage: DecodedPortraitImage;
        try {
            queryBytes = await this.readInputBytes(record, owner, query.id);
            queryImage = await decodePortraitImage(queryBytes);
        } catch {
            return fail(this.store, record, owner, "portrait_input_invalid", "查询图片损坏、过大或格式不受支持");
        }
        const queryFaces = await this.faceEngine.analyze(queryImage);
        const searchImage = await cropPortraitSearchImage(queryBytes, queryImage, queryFaces.selectedFace?.bbox);
        const searchPath = await this.store.writeModelInput(record.taskId, owner, "query-search.jpg", searchImage);
        const limitations: string[] = [];
        if (!queryFaces.selectedFace) limitations.push("查询图未检测到可用人脸，网络搜索使用原图，结果可能不完整。");
        const manualCandidates = await this.readManualCandidates(record, owner);
        let searchCandidates: PortraitSearchCandidate[] = [];
        try {
            record = await this.store.update(record.taskId, owner, { stage: "searching", progress: 0.22 });
            searchCandidates = await searchBaiduByImage(searchPath, { maxCandidates: record.settings.maxCandidates, scrolls: record.settings.searchScrolls, visible: record.settings.showBrowserForDebug });
        } catch (error) {
            if (error instanceof PortraitBaiduSearchError) {
                limitations.push(error.message);
                if (!manualCandidates.length) return fail(this.store, record, owner, error.code, error.message);
            } else throw error;
        }
        if (await this.cancelled(record, owner, signal)) return;
        record = await this.store.update(record.taskId, owner, { stage: "downloading-candidates", progress: 0.3, totalCandidates: Math.min(record.settings.maxCandidates, manualCandidates.length + searchCandidates.length) });
        const candidates = [...manualCandidates];
        let candidateBytes = candidates.reduce((total, candidate) => total + candidate.bytes.byteLength, 0);
        for (const [index, item] of searchCandidates.entries()) {
            if (candidates.length >= record.settings.maxCandidates || await this.cancelled(record, owner, signal)) break;
            try {
                const downloaded = await downloadPortraitCandidate(item.imageUrl);
                if (candidateBytes + downloaded.bytes.byteLength > MAX_CANDIDATE_BYTES) {
                    limitations.push("候选图片累计大小达到本机 120MB 限制，后续候选未继续保存。");
                    break;
                }
                const id = `candidate-${index + 1}`;
                await this.store.writeCandidate(record.taskId, owner, id, extensionForMime(downloaded.contentType), downloaded.bytes);
                candidates.push({ id, artifactId: id, originalRank: item.originalRank, title: item.title, source: "baidu", mimeType: downloaded.contentType, imageUrl: downloaded.url, sourcePageUrl: item.sourcePageUrl, sourceDomain: item.sourceDomain, bytes: downloaded.bytes, decoded: downloaded.decoded });
                candidateBytes += downloaded.bytes.byteLength;
            } catch (error) {
                limitations.push(error instanceof Error ? error.message : "候选图片下载失败");
            }
        }
        record = await this.store.update(record.taskId, owner, { stage: "deduplicating", progress: 0.45, totalCandidates: candidates.length });
        const dedupInputs: PortraitDedupCandidate[] = [];
        for (const candidate of candidates) {
            if (record.settings.dedupMode === "arcface") {
                try { candidate.faces = await this.faceEngine.analyze(candidate.decoded); } catch { limitations.push(`候选 ${candidate.id} 无法提取本地人脸特征，继续使用 pHash 去重。`); }
            }
            dedupInputs.push({ id: candidate.id, byteHash: candidate.decoded.byteHash, phash: candidate.decoded.phash, byteSize: candidate.bytes.byteLength, pixelArea: candidate.decoded.width * candidate.decoded.height, embedding: candidate.faces?.embedding });
        }
        const deduped = deduplicatePortraitCandidates(dedupInputs, record.settings.dedupMode);
        const keptIds = new Set(deduped.kept.map((candidate) => candidate.id));
        const keptCandidates = candidates.filter((candidate) => keptIds.has(candidate.id));
        record = await this.store.update(record.taskId, owner, { stage: "local-comparing", progress: 0.52, totalCandidates: keptCandidates.length });
        const pairs: PortraitPairResult[] = [];
        for (const [index, candidate] of keptCandidates.entries()) {
            if (await this.cancelled(record, owner, signal)) return;
            let faces = candidate.faces;
            try { faces ||= await this.faceEngine.analyze(candidate.decoded); } catch (error) {
                const localPrecheck = buildLocalPrecheck(queryImage, candidate.decoded, queryFaces, undefined, [error instanceof Error ? error.message : "候选人脸特征提取失败"]);
                pairs.push(failedPair(index, query.id, candidate, localPrecheck, "portrait_face_engine_failed", "候选人脸特征提取失败"));
                continue;
            }
            const localPrecheck = buildLocalPrecheck(queryImage, candidate.decoded, queryFaces, faces);
            const riskLevel = localRisk(localPrecheck);
            pairs.push({ id: `pair-${index + 1}`, queryImageId: query.id, comparisonImageId: candidate.artifactId, candidateId: candidate.id, source: candidate.source === "baidu" ? "baidu" : "connected-candidate", status: record.analysisMode === "local-only" ? "success" : "partial", riskLevel, ...(localPrecheck.faceSimilarity === undefined ? {} : { overallSimilarity: reportSimilarity(localPrecheck.faceSimilarity) }), analysisPath: localPrecheck.canExtractEmbedding && localPrecheck.reliabilityIssues.length === 0 ? "A" : "unable", localPrecheck, basis: localPrecheck.faceSimilarity === undefined ? ["未能提取双方可比对的人脸特征，无法仅凭本地辅助指标得出风险等级。"] : [`本地 ArcFace 余弦相似度：${localPrecheck.faceSimilarity.toFixed(4)}。`], limitations: ["本机结果不确认私人身份，也不构成法律结论。"] });
            await this.store.update(record.taskId, owner, { progress: 0.52 + ((index + 1) / Math.max(1, keptCandidates.length)) * 0.38, processedCandidates: index + 1 });
        }
        return this.persistResult(record, owner, query.id, pairs, keptCandidates, limitations);
    }

    private async persistResult(record: PortraitTaskRecord, owner: { keyId: string; origin: string }, queryImageId: string, pairs: PortraitPairResult[], candidates: RuntimeCandidate[], limitations: string[]) {
        const summary = summarizeRisk(pairs);
        const completedAt = new Date().toISOString();
        const candidateResults: PortraitCandidate[] = candidates.map((candidate, index) => {
            const pair = pairs.find((item) => item.candidateId === candidate.id) || pairs[index];
            return { id: candidate.id, originalRank: candidate.originalRank || index + 1, title: candidate.title, imageArtifactId: candidate.artifactId, ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}), ...(candidate.sourcePageUrl ? { sourcePageUrl: candidate.sourcePageUrl } : {}), ...(candidate.sourceDomain ? { sourceDomain: candidate.sourceDomain } : {}), source: candidate.source, byteSize: candidate.bytes.byteLength, width: candidate.decoded.width, height: candidate.decoded.height, ...(pair?.id ? { resultId: pair.id } : {}) };
        });
        const hasFailure = pairs.some((pair) => pair.status === "failed");
        const result: PortraitClearanceResult = portraitClearanceResultSchema.parse({ schemaVersion: 1, taskId: record.taskId, mode: record.mode, queryImageId, highestRisk: summary.highestRisk, riskCounts: summary.riskCounts, candidateCount: candidates.length, comparedCount: pairs.length, candidates: candidateResults, pairs, limitations: ["本结果仅表示当前检索范围内的可识别性排查，不是身份确认、法律结论或司法鉴定。", ...limitations], createdAt: record.createdAt, ...(record.analysisMode === "local-only" ? { completedAt } : {}) });
        await this.store.writeResult(record.taskId, owner, result);
        const reportImages = [{ id: queryImageId, bytes: await this.readInputBytes(record, owner, queryImageId), mimeType: record.inputs.find((input) => input.id === queryImageId)?.mimeType || "image/jpeg" as const }, ...candidates.map((candidate) => ({ id: candidate.artifactId, bytes: candidate.bytes, mimeType: candidate.mimeType }))];
        const reports = await buildPortraitReports(result, reportImages);
        await this.store.writeReports(record.taskId, owner, reports);
        if (record.analysisMode === "local-only") return this.store.update(record.taskId, owner, { status: hasFailure || !pairs.length ? "partial" : "completed", stage: "done", progress: 1, processedCandidates: pairs.length, completedAt });
        if (!pairs.length) return this.store.update(record.taskId, owner, { status: "partial", stage: "done", progress: 1, processedCandidates: 0, completedAt });
        await this.store.ensureModelJobs(record.taskId, owner);
        return this.store.update(record.taskId, owner, { status: "waiting_model", stage: "waiting-for-model", progress: 0.92, processedCandidates: pairs.length, detailsAvailable: true });
    }

    private async readManualCandidates(record: PortraitTaskRecord, owner: { keyId: string; origin: string }): Promise<RuntimeCandidate[]> {
        const result: RuntimeCandidate[] = [];
        for (const [index, input] of record.inputs.filter((item) => item.role === "candidate").entries()) {
            try {
                const bytes = await this.readInputBytes(record, owner, input.id);
                result.push({ id: input.id, artifactId: input.id, originalRank: index + 1, title: input.fileName, source: "connected", mimeType: input.mimeType, bytes, decoded: await decodePortraitImage(bytes) });
            } catch {
                // Invalid manual candidates are recorded as a partial limitation by the caller's final report.
            }
        }
        return result;
    }

    private async readInputBytes(record: PortraitTaskRecord, owner: { keyId: string; origin: string }, inputId: string) {
        return (await this.store.readInput(record.taskId, owner, inputId)).bytes;
    }

    private async readInputImage(record: PortraitTaskRecord, owner: { keyId: string; origin: string }, inputId: string) {
        return decodePortraitImage(await this.readInputBytes(record, owner, inputId));
    }

    private async cancelled(record: PortraitTaskRecord, owner: { keyId: string; origin: string }, signal: AbortSignal) {
        return signal.aborted || (await this.store.get(record.taskId, owner)).cancelRequested === true;
    }
}

function failedPair(index: number, queryId: string, candidate: RuntimeCandidate, localPrecheck: ReturnType<typeof buildLocalPrecheck>, code: string, message: string): PortraitPairResult {
    return { id: `pair-${index + 1}`, queryImageId: queryId, comparisonImageId: candidate.artifactId, candidateId: candidate.id, source: candidate.source === "baidu" ? "baidu" : "connected-candidate", status: "failed", riskLevel: "unable_to_determine", analysisPath: "unable", localPrecheck, basis: [message], limitations: ["该候选未完成本地比对。"], error: { code, message, retryable: true } };
}

async function fail(store: PortraitTaskStore, record: PortraitTaskRecord, owner: { keyId: string; origin: string }, code: string, message: string) {
    await store.update(record.taskId, owner, { status: "failed", stage: "done", progress: 1, errorCode: code, errorMessage: message, completedAt: new Date().toISOString() });
}

function extensionForMime(mime: string) {
    return mime === "image/png" ? "png" as const : mime === "image/webp" ? "webp" as const : "jpg" as const;
}

function reportSimilarity(value: number) {
    return Math.min(1, Math.max(0, value));
}

function publicErrorMessage(code: string) {
    return ({ portrait_model_missing: "请先安装并校验本地肖像模型", portrait_input_invalid: "输入图片损坏、过大或格式不受支持", portrait_candidate_download_blocked: "候选图片下载被安全策略阻止", portrait_candidate_invalid: "候选图片无效或无法解码", portrait_search_browser_unavailable: "未找到系统 Chrome、Edge 或 Chromium", portrait_search_layout_changed: "百度识图页面结构发生变化", portrait_search_captcha: "百度识图需要验证码或安全验证" } as Record<string, string>)[code] || "本地肖像检测失败";
}

function isAbort(error: unknown) {
    return Boolean(error && typeof error === "object" && "name" in error && (error as { name?: unknown }).name === "AbortError");
}
