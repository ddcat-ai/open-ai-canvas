import { requestToolResponse, type ResponseFunctionTool, type ResponseInputMessage, type ToolResponseResult } from "@/services/api/image";
import type { AiConfig } from "@/stores/use-config-store";

import {
    type ArtCritiqueCandidate,
    type ArtCritiqueCategory,
    type ArtCritiqueIssue,
    type ArtCritiqueOption,
    type ArtCritiquePipelineStage,
    type ArtCritiqueReport,
    type ArtCritiqueReviewer,
    type ArtCritiqueScene,
    type ArtCritiqueSeverity,
    type ArtCritiqueTarget,
    type ArtCritiqueTargetSource,
    type ArtCritiqueVerification,
    ART_CRITIQUE_RUBRIC_VERSION,
    ART_CRITIQUE_SCHEMA_VERSION,
} from "./contracts";
import { isRenderableArtCritiqueTarget, referenceTargetForIssue } from "./annotation";
import { findArtCritiqueRubricCheck } from "./rubrics";
import type { ArtCritiqueReviewInput } from "./review";
import { parseAggregatePayload, parseCandidates, parseEditPromptPayload, parseGroundingPayload, parseSceneRouterPayload, parseVerificationPayload, stripJsonFence, toIssueDraft, toOptionDraft, uniqueId } from "./pipeline-parse";
import { aggregateMessages, colorMessages, compositionMessages, editPromptMessages, groundingMessages, lightingMessages, sceneMessages, structureMessages, verificationMessages } from "./pipeline-messages";

export { parseAggregatePayload, parseEditPromptPayload, parseGroundingPayload, parseSceneReviewPayload, parseSceneRouterPayload, parseVerificationPayload } from "./pipeline-parse";

export const MAX_CANDIDATES = 8;
export const MAX_ISSUES = 5;
export const MAX_OPTIONS = 4;
export const MAX_EDIT_PROMPT_LENGTH = 2400;
export const MIN_REPORTABLE_CONFIDENCE = 0.68;
const GROUNDING_CONFIDENCE_THRESHOLD = 0.65;
const VERIFICATION_REJECTION_THRESHOLD = 0.75;

export type ArtCritiquePipelineOptions = {
    requestStage?: (input: { config: AiConfig; messages: ResponseInputMessage[]; tool: ResponseFunctionTool; toolName: string; signal?: AbortSignal }) => Promise<ToolResponseResult>;
    signal?: AbortSignal;
    onStage?: (stage: ArtCritiquePipelineStage) => void;
    onDraftReport?: (report: ArtCritiqueReport) => void;
};

type SceneRouterResult = {
    scene: ArtCritiqueScene;
};

type SceneReviewResult = {
    scene: ArtCritiqueScene;
    candidates: ArtCritiqueCandidate[];
};

export type AggregateIssueDraft = Omit<ArtCritiqueIssue, "target" | "groundingConfidence" | "verification"> & {
    targetDescription: string;
};

export type AggregateOptionDraft = Omit<ArtCritiqueOption, "sourceCandidateIds"> & {
    sourceCandidateIds: string[];
};

type AggregateResult = {
    summary: string;
    strengths: string[];
    issues: AggregateIssueDraft[];
    options: AggregateOptionDraft[];
};

type GroundingResult = {
    targets: Array<{ issueId: string; target: ArtCritiqueTarget; groundingConfidence: number }>;
};

type VerificationResult = {
    decisions: Array<{ issueId: string; verification: ArtCritiqueVerification }>;
};

type EditPromptResult = {
    prompts: Array<{ issueId: string; editPrompt: string }>;
};

export const ALL_CATEGORIES = ["composition", "color", "lighting", "proportion", "other"] as const;
export const ALL_IMAGE_TYPES = ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"] as const;
export const ALL_SCENE_DEPTHS = ["flat", "shallow", "medium", "deep"] as const;
export const ALL_SEVERITIES = ["low", "medium", "high"] as const;
const ALL_TARGET_TYPES = ["box", "point", "points", "polygon", "global"] as const;
export const ALL_VERDICTS = ["confirmed", "uncertain", "rejected"] as const;

const pointSchema = {
    type: "object",
    additionalProperties: false,
    required: ["x", "y"],
    properties: {
        x: { type: "number", minimum: 0, maximum: 1 },
        y: { type: "number", minimum: 0, maximum: 1 },
    },
};

const targetSchema = {
    type: "object",
    additionalProperties: false,
    required: ["type", "points"],
    properties: {
        type: { type: "string", enum: [...ALL_TARGET_TYPES] },
        points: { type: "array", maxItems: 12, items: pointSchema },
    },
};

const editPromptItemSchema = {
    type: "object",
    additionalProperties: false,
    required: ["issueId", "editPrompt"],
    properties: {
        issueId: { type: "string", minLength: 1, maxLength: 80 },
        editPrompt: { type: "string", minLength: 1, maxLength: MAX_EDIT_PROMPT_LENGTH },
    },
};

const candidateSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "checkId", "kind", "category", "title", "observation", "reason", "evidence", "severity", "confidence", "targetDescription"],
    properties: {
        id: { type: "string", maxLength: 80 },
        checkId: { type: "string", maxLength: 80 },
        kind: { type: "string", enum: ["issue", "option"] },
        category: { type: "string", enum: [...ALL_CATEGORIES] },
        title: { type: "string", maxLength: 180 },
        observation: { type: "string", maxLength: 600 },
        reason: { type: "string", maxLength: 800 },
        evidence: { type: "array", maxItems: 4, items: { type: "string", maxLength: 300 } },
        severity: { type: "number", minimum: 0, maximum: 1 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        targetDescription: { type: "string", maxLength: 300 },
    },
};

const suggestionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["goal", "actions", "preserve", "expectedEffect"],
    properties: {
        goal: { type: "string", maxLength: 500 },
        actions: { type: "array", maxItems: 6, items: { type: "string", maxLength: 500 } },
        preserve: { type: "array", maxItems: 6, items: { type: "string", maxLength: 500 } },
        expectedEffect: { type: "string", maxLength: 500 },
    },
};

const aggregateIssueSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "category", "title", "explanation", "severity", "confidence", "targetDescription", "suggestion", "sourceCandidateIds"],
    properties: {
        id: { type: "string", maxLength: 80 },
        category: { type: "string", enum: [...ALL_CATEGORIES] },
        title: { type: "string", maxLength: 180 },
        explanation: { type: "string", maxLength: 1000 },
        severity: { type: "string", enum: [...ALL_SEVERITIES] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        targetDescription: { type: "string", maxLength: 300 },
        suggestion: suggestionSchema,
        sourceCandidateIds: { type: "array", maxItems: MAX_CANDIDATES, items: { type: "string", maxLength: 80 } },
    },
};

const aggregateOptionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "category", "title", "explanation", "confidence", "suggestion", "sourceCandidateIds"],
    properties: {
        id: { type: "string", maxLength: 80 },
        category: { type: "string", enum: [...ALL_CATEGORIES] },
        title: { type: "string", maxLength: 180 },
        explanation: { type: "string", maxLength: 1000 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        suggestion: suggestionSchema,
        sourceCandidateIds: { type: "array", maxItems: MAX_CANDIDATES, items: { type: "string", maxLength: 80 } },
    },
};

function createTool(name: string, description: string, properties: Record<string, unknown>, required: string[]): ResponseFunctionTool {
    return {
        type: "function",
        function: {
            name,
            description,
            strict: true,
            parameters: { type: "object", additionalProperties: false, required, properties },
        },
    };
}

function reviewerTool(name: string, description: string) {
    return createTool(name, description, { candidates: { type: "array", maxItems: MAX_CANDIDATES, items: candidateSchema } }, ["candidates"]);
}

export const artCritiquePipelineTools = {
    scene: createTool(
        "analyze_art_scene",
        "只理解图片类型、主体、意图和视觉上下文，不评价问题，不提交批改候选。",
        {
            scene: {
                type: "object",
                additionalProperties: false,
                required: ["imageType", "style", "subjects", "intendedFocus", "compositionType", "lightingType", "mood", "estimatedIntent", "sceneDepth"],
                properties: {
                    imageType: { type: "string", enum: [...ALL_IMAGE_TYPES] },
                    style: { type: "array", maxItems: 8, items: { type: "string", maxLength: 100 } },
                    subjects: {
                        type: "array",
                        maxItems: 8,
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["id", "description", "importance"],
                            properties: {
                                id: { type: "string", maxLength: 80 },
                                description: { type: "string", maxLength: 240 },
                                importance: { type: "string", enum: ["primary", "secondary", "background"] },
                            },
                        },
                    },
                    intendedFocus: { type: "string", maxLength: 300 },
                    compositionType: { type: "array", maxItems: 8, items: { type: "string", maxLength: 100 } },
                    lightingType: { type: "array", maxItems: 8, items: { type: "string", maxLength: 100 } },
                    mood: { type: "string", maxLength: 180 },
                    estimatedIntent: { type: "string", maxLength: 300 },
                    sceneDepth: { type: "string", enum: [...ALL_SCENE_DEPTHS] },
                },
            },
        },
        ["scene"],
    ),
    composition: reviewerTool("review_art_composition", "只检查构图与叙事关系，提交有证据的候选问题；允许返回空候选。"),
    color: reviewerTool("review_art_color", "只检查色彩和调色关系，提交有证据的候选问题；允许返回空候选。"),
    lighting: reviewerTool("review_art_lighting", "只检查光线和曝光关系，提交有证据的候选问题；允许返回空候选。"),
    structure: reviewerTool("review_art_structure", "只检查结构、比例、透视和细节一致性，提交有证据的候选问题；允许返回空候选。"),
    aggregate: createTool(
        "aggregate_art_critique",
        "合并多个 Reviewer 的候选问题，去重、排序并形成可执行的最终问题草案。",
        {
            summary: { type: "string", maxLength: 1600 },
            strengths: { type: "array", maxItems: 8, items: { type: "string", maxLength: 500 } },
            issues: { type: "array", maxItems: MAX_CANDIDATES, items: aggregateIssueSchema },
            options: { type: "array", maxItems: MAX_OPTIONS, items: aggregateOptionSchema },
        },
        ["summary", "strengths", "issues", "options"],
    ),
    grounding: createTool(
        "ground_art_critique_issues",
        "只把已有问题绑定到图片区域，不重新评价图片，也不创建新问题。",
        {
            targets: {
                type: "array",
                maxItems: MAX_ISSUES,
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["issueId", "target", "groundingConfidence"],
                    properties: {
                        issueId: { type: "string", maxLength: 80 },
                        target: targetSchema,
                        groundingConfidence: { type: "number", minimum: 0, maximum: 1 },
                    },
                },
            },
        },
        ["targets"],
    ),
    promptWriter: createTool(
        "generate_art_edit_prompts",
        "根据已有问题和已定位区域，为每个问题生成可直接用于局部图像编辑的 AI 提示词；不得创建新问题。",
        {
            prompts: { type: "array", maxItems: MAX_ISSUES, items: editPromptItemSchema },
        },
        ["prompts"],
    ),
    verification: createTool(
        "verify_art_critique",
        "作为没有参与前面判断的复核者，逐项确认已有问题和位置是否有图像证据。不得新增问题。",
        {
            decisions: {
                type: "array",
                maxItems: MAX_ISSUES,
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["issueId", "verdict", "confidence", "reason"],
                    properties: {
                        issueId: { type: "string", maxLength: 80 },
                        verdict: { type: "string", enum: [...ALL_VERDICTS] },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        reason: { type: "string", maxLength: 500 },
                    },
                },
            },
        },
        ["decisions"],
    ),
} as const;

export async function runArtCritiquePipeline(config: AiConfig, input: ArtCritiqueReviewInput, options: ArtCritiquePipelineOptions = {}) {
    const textModel = config.textModel.trim();
    if (!textModel) throw new Error("未配置文本/视觉理解模型，请先在设置中选择支持图片理解的文本模型");
    // requestToolResponse resolves the request model from config.model first. Override it here so
    // an image-generation default cannot silently receive the critique's tool-calling requests.
    const critiqueConfig = { ...config, model: textModel };

    const warnings: string[] = [];
    const fallbackScene = createEmptyScene();
    let scene = fallbackScene;
    let candidates: ArtCritiqueCandidate[] = [];
    let verificationSummary: ArtCritiqueReport["verificationSummary"];
    let reviewerSucceeded = 0;

    // Scene routing is intentionally not a critique step. It supplies context for local filtering and
    // aggregation, so it can run alongside the four independent reviewers without changing their scope.
    emitStage(options, "scene");
    const sceneRequest = requestPipelineStage(critiqueConfig, sceneMessages(input), artCritiquePipelineTools.scene, "analyze_art_scene", parseSceneRouterPayload, options).then(
        (result) => ({ ok: true as const, scene: result.scene }),
        (error) => ({ ok: false as const, error }),
    );
    const runReviewer = (reviewer: ArtCritiqueReviewer, messages: ResponseInputMessage[], tool: ResponseFunctionTool, toolName: string) =>
        requestPipelineStage(critiqueConfig, messages, tool, toolName, (value) => ({ candidates: parseCandidates(value, reviewer) }), options);
    emitStage(options, "reviewing");
    const reviewerSpecs: Array<{ reviewer: ArtCritiqueReviewer; messages: ResponseInputMessage[]; tool: ResponseFunctionTool; toolName: string }> = [
        { reviewer: "composition", messages: compositionMessages(input, fallbackScene), tool: artCritiquePipelineTools.composition, toolName: "review_art_composition" },
        { reviewer: "color", messages: colorMessages(input, fallbackScene), tool: artCritiquePipelineTools.color, toolName: "review_art_color" },
        { reviewer: "lighting", messages: lightingMessages(input, fallbackScene), tool: artCritiquePipelineTools.lighting, toolName: "review_art_lighting" },
        { reviewer: "structure", messages: structureMessages(input, fallbackScene), tool: artCritiquePipelineTools.structure, toolName: "review_art_structure" },
    ];
    const reviewerResultsRequest = Promise.allSettled(reviewerSpecs.map(({ reviewer, messages, tool, toolName }) => runReviewer(reviewer, messages, tool, toolName)));
    const [sceneOutcome, reviewerResults] = await Promise.all([sceneRequest, reviewerResultsRequest]);

    if (sceneOutcome.ok) {
        scene = sceneOutcome.scene;
    } else {
        rethrowIfAborted(sceneOutcome.error, options.signal);
        warnings.push("场景理解阶段未完成，后续步骤使用了默认场景上下文。");
    }

    const appendReviewerResult = (reviewer: ArtCritiqueReviewer, result: PromiseSettledResult<{ candidates: ArtCritiqueCandidate[] }>) => {
        if (result.status === "fulfilled") {
            reviewerSucceeded += 1;
            candidates = appendCandidates(candidates, filterCandidatesForScene(result.value.candidates, scene.imageType));
            return;
        }
        rethrowIfAborted(result.reason, options.signal);
        warnings.push(`${reviewerLabel(reviewer)} Reviewer 未完成，已使用其他通道继续。`);
    };
    reviewerResults.forEach((result, index) => appendReviewerResult(reviewerSpecs[index].reviewer, result));

    if (!reviewerSucceeded) throw new Error("art_critique_pipeline_failed");

    emitStage(options, "aggregating");
    let aggregate: AggregateResult = cleanAggregate(scene);
    if (candidates.length) {
        try {
            const parsed = await requestPipelineStage(critiqueConfig, aggregateMessages(input, scene, candidates), artCritiquePipelineTools.aggregate, "aggregate_art_critique", parseAggregatePayload, options);
            aggregate = filterAggregateAgainstCandidates(parsed, candidates, warnings);
        } catch (error) {
            rethrowIfAborted(error, options.signal);
            warnings.push("问题聚合阶段未完成，已使用本地规则整理候选问题。");
            aggregate = fallbackAggregate(scene, candidates, warnings);
        }
    }

    let issues = aggregate.issues.map(toIssueDraft);
    let reportOptions = aggregate.options.map(toOptionDraft);
    const buildReport = () =>
        ({
            schemaVersion: ART_CRITIQUE_SCHEMA_VERSION,
            rubricVersion: ART_CRITIQUE_RUBRIC_VERSION,
            summary: aggregate.summary,
            strengths: aggregate.strengths,
            issues,
            ...(reportOptions.length ? { options: reportOptions } : {}),
            sourceFingerprint: input.sourceFingerprint,
            createdAt: new Date().toISOString(),
            scene,
            ...(warnings.length ? { pipelineWarnings: warnings } : {}),
            ...(verificationSummary ? { verificationSummary } : {}),
        }) satisfies ArtCritiqueReport;

    if (issues.length) {
        emitStage(options, "grounding");
        // The text report is useful before coordinates are confirmed. The UI suppresses its overlay while
        // the pipeline is running, so this draft can never expose a global fallback as a precise box.
        options.onDraftReport?.(buildReport());
        try {
            const grounding = await requestPipelineStage(critiqueConfig, groundingMessages(input, scene, issues), artCritiquePipelineTools.grounding, "ground_art_critique_issues", parseGroundingPayload, options);
            issues = applyGrounding(issues, grounding.targets);
        } catch (error) {
            rethrowIfAborted(error, options.signal);
            warnings.push("问题定位阶段未完成，已根据问题描述使用参考区域坐标；坐标仅作辅助参考，文字报告仍然保留。");
            issues = applyReferenceCoordinates(issues);
        }

        emitStage(options, "verifying");
        // Both requests depend on the grounded targets, but neither depends on the other's result.
        // Keep them concurrent so the AI edit prompt does not extend the verification critical path.
        const verificationRequest = requestPipelineStage(critiqueConfig, verificationMessages(input, scene, issues), artCritiquePipelineTools.verification, "verify_art_critique", parseVerificationPayload, options);
        const promptRequest = requestPipelineStage(critiqueConfig, editPromptMessages(input, scene, issues), artCritiquePipelineTools.promptWriter, "generate_art_edit_prompts", parseEditPromptPayload, options);
        const [verificationResult, promptResult] = await Promise.allSettled([verificationRequest, promptRequest] as const);

        if (verificationResult.status === "fulfilled") {
            const verified = applyVerification(issues, verificationResult.value.decisions);
            issues = verified.issues;
            verificationSummary = verified.summary;
            if (!issues.length) {
                warnings.push("独立复核未确认重点问题，已过滤不可靠的批改项。");
                aggregate = { ...aggregate, summary: "独立复核后未确认需要优先修改的问题。" };
            }
        } else {
            rethrowIfAborted(verificationResult.reason, options.signal);
            warnings.push("独立复核阶段未完成，已保留聚合后的批改结果。");
        }

        if (promptResult.status === "fulfilled") {
            issues = applyEditPrompts(issues, promptResult.value.prompts, warnings);
        } else {
            rethrowIfAborted(promptResult.reason, options.signal);
            warnings.push("AI 修改提示词阶段未完成，报告仍保留问题和定位结果；请重新批改后再复制提示词。");
        }
    } else {
        options.onDraftReport?.(buildReport());
    }

    emitStage(options, "annotating");
    return buildReport();
}

export function applyGrounding(issues: readonly ArtCritiqueIssue[], targets: readonly GroundingResult["targets"][number][]) {
    const targetByIssue = new Map(targets.map((target) => [target.issueId, target]));
    return issues.map((issue) => {
        const grounded = targetByIssue.get(issue.id);
        if (!grounded) return { ...issue, target: globalTarget(), targetSource: "global" as const };
        const reliable = grounded.target.type !== "global" && grounded.groundingConfidence >= GROUNDING_CONFIDENCE_THRESHOLD && isRenderableArtCritiqueTarget(grounded.target);
        if (!reliable && grounded.target.type !== "global") {
            const target = referenceTargetForIssue(issue);
            const targetSource: ArtCritiqueTargetSource = target.type === "global" ? "global" : "reference";
            return {
                ...issue,
                target,
                targetSource,
                groundingConfidence: grounded.groundingConfidence,
            };
        }
        const targetSource: ArtCritiqueTargetSource = reliable ? "model" : "global";
        return {
            ...issue,
            target: reliable ? grounded.target : globalTarget(),
            targetSource,
            groundingConfidence: grounded.groundingConfidence,
        };
    });
}

export function applyReferenceCoordinates(issues: readonly ArtCritiqueIssue[]) {
    return issues.map((issue) => {
        const target = referenceTargetForIssue(issue);
        const targetSource: ArtCritiqueTargetSource = target.type === "global" ? "global" : "reference";
        return { ...issue, target, targetSource };
    });
}

export function applyVerification(issues: readonly ArtCritiqueIssue[], decisions: readonly VerificationResult["decisions"][number][]) {
    const issueIds = new Set(issues.map((issue) => issue.id));
    const relevant = decisions.filter((decision) => issueIds.has(decision.issueId));
    const decisionByIssue = new Map(relevant.map((decision) => [decision.issueId, decision.verification]));
    const annotated = issues.map((issue) => {
        const verification = decisionByIssue.get(issue.id);
        return verification ? { ...issue, verification } : issue;
    });
    const kept = annotated.filter((issue) => issue.verification?.verdict !== "rejected" || issue.verification.confidence < VERIFICATION_REJECTION_THRESHOLD);
    const summary = relevant.reduce(
        (result, decision) => {
            result.checked += 1;
            result[decision.verification.verdict] += 1;
            return result;
        },
        { checked: 0, confirmed: 0, uncertain: 0, rejected: 0 },
    );
    return { issues: kept, summary };
}

export function applyEditPrompts(issues: readonly ArtCritiqueIssue[], prompts: readonly EditPromptResult["prompts"][number][], warnings: string[] = []) {
    const promptByIssue = new Map(prompts.map((prompt) => [prompt.issueId, prompt.editPrompt]));
    const missingCount = issues.filter((issue) => !promptByIssue.has(issue.id)).length;
    if (missingCount) warnings.push(`AI 修改提示词未覆盖 ${missingCount} 个问题，缺失项不会使用本地拼接替代。`);
    return issues.map((issue) => {
        const editPrompt = promptByIssue.get(issue.id);
        return editPrompt ? { ...issue, editPrompt } : issue;
    });
}

async function requestPipelineStage<T>(config: AiConfig, messages: ResponseInputMessage[], tool: ResponseFunctionTool, toolName: string, parse: (value: unknown) => T, options: ArtCritiquePipelineOptions) {
    throwIfAborted(options.signal);
    const response = options.requestStage
        ? await options.requestStage({ config, messages, tool, toolName, signal: options.signal })
        : await requestToolResponse(config, messages, [tool], { type: "function", name: toolName }, undefined, { signal: options.signal });
    const raw = response.toolCalls.find((candidate) => candidate.function.name === toolName)?.function.arguments || response.content;
    if (!raw?.trim()) throw new Error(`${toolName}_missing`);
    let value: unknown;
    try {
        value = JSON.parse(stripJsonFence(raw));
    } catch {
        throw new Error(`${toolName}_invalid_json`);
    }
    return parse(value);
}

function cleanAggregate(scene: ArtCritiqueScene): AggregateResult {
    const focus = scene.intendedFocus === "未确定" ? "画面" : scene.intendedFocus;
    return {
        summary: `已完成对${focus}的多维检查，本轮未发现需要优先修改的可靠问题。`,
        strengths: [],
        issues: [],
        options: [],
    };
}

export function filterAggregateAgainstCandidates(aggregate: AggregateResult, candidates: readonly ArtCritiqueCandidate[], warnings: string[]): AggregateResult {
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const accepted = aggregate.issues.filter((issue) => {
        const sourceIds = issue.sourceCandidateIds || [];
        if (!sourceIds.length || sourceIds.some((id) => !candidateById.has(id))) return false;
        const sources = sourceIds.flatMap((id) => {
            const candidate = candidateById.get(id);
            return candidate ? [candidate] : [];
        });
        return sources.length > 0 && sources.every((candidate) => candidate.kind === "issue" && candidate.category === issue.category) && issue.confidence >= MIN_REPORTABLE_CONFIDENCE;
    });
    const acceptedOptions = aggregate.options.filter((option) => {
        const sourceIds = option.sourceCandidateIds || [];
        if (!sourceIds.length || sourceIds.some((id) => !candidateById.has(id))) return false;
        const sources = sourceIds.flatMap((id) => {
            const candidate = candidateById.get(id);
            return candidate ? [candidate] : [];
        });
        return sources.length > 0 && sources.every((candidate) => candidate.kind === "option" && candidate.category === option.category) && option.confidence >= MIN_REPORTABLE_CONFIDENCE;
    });
    if (accepted.length !== aggregate.issues.length || acceptedOptions.length !== aggregate.options.length) {
        warnings.push(`聚合阶段返回了 ${aggregate.issues.length - accepted.length + aggregate.options.length - acceptedOptions.length} 个无可靠来源或低置信度结果，已过滤。`);
    }
    const deduplicated = deduplicateAggregateIssues(accepted, warnings);
    return { ...aggregate, issues: prioritizeIssues(deduplicated).slice(0, MAX_ISSUES), options: prioritizeOptions(acceptedOptions).slice(0, MAX_OPTIONS) };
}

export function deduplicateAggregateIssues(issues: readonly AggregateIssueDraft[], warnings?: string[]) {
    const merged: AggregateIssueDraft[] = [];
    let mergedCount = 0;
    for (const issue of issues) {
        const existingIndex = merged.findIndex((candidate) => areRelatedIssues(candidate, issue));
        if (existingIndex < 0) {
            merged.push(issue);
            continue;
        }
        merged[existingIndex] = mergeAggregateIssues(merged[existingIndex], issue);
        mergedCount += 1;
    }
    if (mergedCount && warnings) warnings.push(`聚合阶段合并了 ${mergedCount} 个重复或同根因问题。`);
    return merged;
}

function areRelatedIssues(left: AggregateIssueDraft, right: AggregateIssueDraft) {
    if (left.category !== right.category) return false;
    const rightSourceIds = new Set(right.sourceCandidateIds || []);
    if ((left.sourceCandidateIds || []).some((id) => rightSourceIds.has(id))) return true;
    const leftTopic = issueTopicKey(left);
    return leftTopic !== null && leftTopic === issueTopicKey(right);
}

function mergeAggregateIssues(left: AggregateIssueDraft, right: AggregateIssueDraft): AggregateIssueDraft {
    const primary = issuePriorityScore(left) >= issuePriorityScore(right) ? left : right;
    const secondary = primary === left ? right : left;
    return {
        ...primary,
        explanation: mergeDistinctText(primary.explanation, secondary.explanation, 1000),
        confidence: Math.max(primary.confidence, secondary.confidence),
        targetDescription: mergeDistinctText(primary.targetDescription, secondary.targetDescription, 300),
        sourceCandidateIds: uniqueStrings([...(primary.sourceCandidateIds || []), ...(secondary.sourceCandidateIds || [])]).slice(0, MAX_CANDIDATES),
        suggestion: {
            ...primary.suggestion,
            actions: uniqueStrings([...primary.suggestion.actions, ...secondary.suggestion.actions]).slice(0, 6),
            preserve: uniqueStrings([...primary.suggestion.preserve, ...secondary.suggestion.preserve]).slice(0, 6),
        },
    };
}

function issueTopicKey(issue: Pick<AggregateIssueDraft, "title" | "explanation" | "targetDescription">) {
    const text = `${issue.title} ${issue.explanation} ${issue.targetDescription}`.toLowerCase();
    const subject = containsAny(text, ["主体", "人物", "女性", "脸", "面部", "人像", "subject", "person", "face"]);
    const lighting = containsAny(text, ["受光", "暗部", "阴影", "亮度", "曝光", "轮廓光", "分离", "融入背景", "冷影", "lighting", "shadow"]);
    const foreground = containsAny(text, ["前景", "近景", "背影", "foreground"]);
    const focus = containsAny(text, ["焦点", "动线", "注意力", "视觉阅读", "视觉重量", "压过", "抢走", "focus", "attention"]);
    const saturated = containsAny(text, ["高饱和", "饱和度", "亮点", "光点", "霓虹", "色彩焦点", "saturation", "highlight", "hotspot"]);
    const space = containsAny(text, ["留白", "拥挤", "切线", "裁切", "边缘", "间距", "轮廓贴近", "negative space", "crop"]);

    if (subject && lighting) return "subject-lighting";
    if (foreground && focus) return "foreground-focus";
    if (saturated && focus) return "saturated-focus";
    if (subject && space) return "subject-space";
    return null;
}

function containsAny(text: string, values: string[]) {
    return values.some((value) => text.includes(value));
}

function mergeDistinctText(primary: string, secondary: string, maxLength: number) {
    if (!secondary || primary.includes(secondary)) return primary.slice(0, maxLength);
    if (!primary || secondary.includes(primary)) return secondary.slice(0, maxLength);
    return `${primary}；${secondary}`.slice(0, maxLength);
}

function uniqueStrings(values: readonly string[]) {
    return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function fallbackAggregate(scene: ArtCritiqueScene, candidates: readonly ArtCritiqueCandidate[], warnings?: string[]): AggregateResult {
    const issueDrafts = candidates
        .filter((candidate) => candidate.kind === "issue")
        .map(
            (candidate) =>
                ({
                    id: candidate.id,
                    category: candidate.category,
                    title: candidate.title,
                    explanation: `${candidate.observation}${candidate.reason ? ` ${candidate.reason}` : ""}`,
                    severity: severityFromScore(candidate.severity),
                    confidence: candidate.confidence,
                    targetDescription: candidate.targetDescription,
                    sourceCandidateIds: [candidate.id],
                    suggestion: {
                        goal: `降低“${candidate.title}”对画面表达的影响`,
                        actions: [`围绕${candidate.targetDescription || "问题区域"}进行针对性调整，并先保留当前主体和画面意图。`],
                        preserve: ["保留当前画面的主体意图"],
                        expectedEffect: "问题对视觉层级和画面表达的干扰减弱。",
                    },
                }) satisfies AggregateIssueDraft,
        );
    const selectedIssues = prioritizeIssues(deduplicateAggregateIssues(issueDrafts, warnings)).slice(0, MAX_ISSUES);
    const selectedOptions = prioritizeCandidates(candidates.filter((candidate) => candidate.kind === "option")).slice(0, MAX_OPTIONS);
    const focus = scene.intendedFocus === "未确定" ? "画面" : scene.intendedFocus;
    return {
        summary: selectedIssues.length
            ? `已完成对${focus}的多维度检查，以下是当前最值得优先处理的问题。`
            : selectedOptions.length
              ? `已完成对${focus}的多维度检查，未发现需要优先修改的可靠问题；下面是可选的风格方向。`
              : "已完成场景检查，但没有识别到足够可靠的重点问题。",
        strengths: [],
        issues: selectedIssues,
        options: selectedOptions.map((candidate) => ({
            id: candidate.id,
            category: candidate.category,
            title: candidate.title,
            explanation: `${candidate.observation}${candidate.reason ? ` ${candidate.reason}` : ""}`,
            confidence: candidate.confidence,
            sourceCandidateIds: [candidate.id],
            suggestion: {
                goal: `如果希望强化“${candidate.title}”所代表的方向，可以尝试以下调整`,
                actions: [`围绕${candidate.targetDescription || "相关区域"}进行小幅尝试，比较调整前后的表达差异。`],
                preserve: ["保留当前画面的主体意图"],
                expectedEffect: "画面更接近该风格方向，但这不是对原图的错误判定。",
            },
        })),
    };
}

function prioritizeCandidates(candidates: readonly ArtCritiqueCandidate[]) {
    return candidates
        .map((candidate, index) => ({ candidate, index }))
        .sort((left, right) => {
            const scoreDifference = candidatePriorityScore(right.candidate) - candidatePriorityScore(left.candidate);
            return scoreDifference || left.index - right.index;
        })
        .map(({ candidate }) => candidate);
}

function filterCandidatesForScene(candidates: readonly ArtCritiqueCandidate[], imageType: ArtCritiqueScene["imageType"]) {
    return candidates.filter((candidate) => {
        const rule = findArtCritiqueRubricCheck(candidate.checkId);
        return Boolean(rule && (rule.applicableImageTypes || ALL_SUPPORTED_IMAGE_TYPES).includes(imageType));
    });
}

export function isReviewerAllowed(reviewer: ArtCritiqueCandidate["reviewer"], category: ArtCritiqueCategory) {
    if (reviewer === "composition") return category === "composition";
    if (reviewer === "color") return category === "color";
    if (reviewer === "lighting") return category === "lighting";
    return category === "proportion";
}

function reviewerLabel(reviewer: ArtCritiqueReviewer) {
    if (reviewer === "composition") return "构图与叙事";
    if (reviewer === "color") return "色彩";
    if (reviewer === "lighting") return "光线";
    return "结构与比例";
}

const ALL_SUPPORTED_IMAGE_TYPES = ["portrait", "landscape", "product", "illustration", "concept-art", "architecture", "still-life", "other"] as const;

function appendCandidates(existing: readonly ArtCritiqueCandidate[], incoming: readonly ArtCritiqueCandidate[]) {
    const used = new Set(existing.map((candidate) => candidate.id));
    return [...existing, ...incoming.map((candidate) => ({ ...candidate, id: uniqueId(candidate.id, used) }))];
}

export function prioritizeIssues(issues: readonly AggregateIssueDraft[]) {
    return issues
        .map((issue, index) => ({ issue, index }))
        .sort((left, right) => {
            const scoreDifference = issuePriorityScore(right.issue) - issuePriorityScore(left.issue);
            return scoreDifference || left.index - right.index;
        })
        .map(({ issue }) => issue);
}

function candidatePriorityScore(candidate: ArtCritiqueCandidate) {
    return candidate.severity * 0.7 + candidate.confidence * 0.3;
}

function issuePriorityScore(issue: AggregateIssueDraft) {
    const severityWeight = issue.severity === "high" ? 3 : issue.severity === "medium" ? 2 : 1;
    return severityWeight * 0.7 + issue.confidence * 0.3;
}

export function prioritizeOptions(options: readonly AggregateOptionDraft[]) {
    return [...options].sort((left, right) => right.confidence - left.confidence);
}

function severityFromScore(value: number): ArtCritiqueSeverity {
    if (value >= 0.75) return "high";
    if (value >= 0.45) return "medium";
    return "low";
}

function createEmptyScene(): ArtCritiqueScene {
    return {
        imageType: "other",
        style: [],
        subjects: [],
        intendedFocus: "未确定",
        compositionType: [],
        lightingType: [],
        mood: "未确定",
        estimatedIntent: "未确定",
        sceneDepth: "medium",
    };
}

function globalTarget(): ArtCritiqueTarget {
    return { type: "global", points: [] };
}

function emitStage(options: ArtCritiquePipelineOptions, stage: ArtCritiquePipelineStage) {
    throwIfAborted(options.signal);
    options.onStage?.(stage);
}

function rethrowIfAborted(error: unknown, signal?: AbortSignal): asserts error is Error {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
}

function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) return;
    const error = new Error("art_critique_aborted");
    error.name = "AbortError";
    throw error;
}

export type { AggregateResult, EditPromptResult, GroundingResult, SceneRouterResult, SceneReviewResult, VerificationResult };
