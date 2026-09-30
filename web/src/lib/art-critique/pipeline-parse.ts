// AI 美术评审流水线各阶段的结果解析：把模型返回的 JSON 严格裁剪成受控结构。
//
// 所有字段都做枚举/范围/长度校验，模型多给或写错的字段直接丢弃，不会原样进入界面。

import type { ArtCritiqueCandidate, ArtCritiqueIssue, ArtCritiqueOption, ArtCritiqueScene, ArtCritiqueSuggestion, ArtCritiqueTarget } from "./contracts";
import { findArtCritiqueRubricCheck } from "./rubrics";
import {
    ALL_CATEGORIES,
    ALL_IMAGE_TYPES,
    ALL_SCENE_DEPTHS,
    ALL_SEVERITIES,
    ALL_VERDICTS,
    type AggregateIssueDraft,
    type AggregateOptionDraft,
    type AggregateResult,
    type EditPromptResult,
    type GroundingResult,
    MAX_CANDIDATES,
    MAX_EDIT_PROMPT_LENGTH,
    MAX_ISSUES,
    MAX_OPTIONS,
    MIN_REPORTABLE_CONFIDENCE,
    type SceneReviewResult,
    type SceneRouterResult,
    type VerificationResult,
    isReviewerAllowed,
    prioritizeIssues,
    prioritizeOptions,
} from "./pipeline";

export function parseSceneRouterPayload(value: unknown): SceneRouterResult {
    if (!isRecord(value) || !isRecord(value.scene)) throw new Error("art_critique_scene_invalid");
    return { scene: parseScene(value.scene) };
}

/** @deprecated Kept for callers of the original two-reviewer parser. */
export function parseSceneReviewPayload(value: unknown): SceneReviewResult {
    if (!isRecord(value) || !isRecord(value.scene) || !Array.isArray(value.candidates)) throw new Error("art_critique_scene_invalid");
    return { scene: parseScene(value.scene), candidates: parseCandidates(value, "composition") };
}

export function parseAggregatePayload(value: unknown): AggregateResult {
    if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.strengths) || !Array.isArray(value.issues)) throw new Error("art_critique_aggregate_invalid");
    const ids = new Set<string>();
    const issues = value.issues.slice(0, MAX_CANDIDATES).map((item, index) => {
        const issue = parseAggregateIssue(item, index);
        return { ...issue, id: uniqueId(issue.id, ids) };
    });
    const optionIds = new Set<string>();
    const options = (Array.isArray(value.options) ? value.options : []).slice(0, MAX_OPTIONS).map((item, index) => {
        const option = parseAggregateOption(item, index);
        return { ...option, id: uniqueId(option.id, optionIds) };
    });
    return { summary: boundedString(value.summary, 1600), strengths: boundedStrings(value.strengths, 8, 500), issues: prioritizeIssues(issues).slice(0, MAX_ISSUES), options: prioritizeOptions(options).slice(0, MAX_OPTIONS) };
}

export function parseGroundingPayload(value: unknown): GroundingResult {
    if (!isRecord(value) || !Array.isArray(value.targets)) throw new Error("art_critique_grounding_invalid");
    return {
        targets: value.targets.slice(0, MAX_ISSUES).map((item) => {
            if (!isRecord(item) || typeof item.issueId !== "string" || !isRecord(item.target)) throw new Error("art_critique_grounding_invalid");
            const groundingConfidence = numeric(item.groundingConfidence);
            if (groundingConfidence === null) throw new Error("art_critique_grounding_invalid");
            return { issueId: boundedString(item.issueId, 80), target: parseTarget(item.target), groundingConfidence: clamp01(groundingConfidence) };
        }),
    };
}

export function parseVerificationPayload(value: unknown): VerificationResult {
    if (!isRecord(value) || !Array.isArray(value.decisions)) throw new Error("art_critique_verification_invalid");
    return {
        decisions: value.decisions.slice(0, MAX_ISSUES).map((item) => {
            if (!isRecord(item) || typeof item.issueId !== "string" || typeof item.reason !== "string") throw new Error("art_critique_verification_invalid");
            const verdict = enumValue(item.verdict, ALL_VERDICTS);
            const confidence = numeric(item.confidence);
            if (!verdict || confidence === null) throw new Error("art_critique_verification_invalid");
            return {
                issueId: boundedString(item.issueId, 80),
                verification: { verdict, confidence: clamp01(confidence), reason: boundedString(item.reason, 500) },
            };
        }),
    };
}

export function parseEditPromptPayload(value: unknown): EditPromptResult {
    if (!isRecord(value) || !Array.isArray(value.prompts)) throw new Error("art_critique_edit_prompt_invalid");
    return {
        prompts: value.prompts.slice(0, MAX_ISSUES).map((item) => {
            if (!isRecord(item) || typeof item.issueId !== "string" || !item.issueId.trim() || typeof item.editPrompt !== "string" || !item.editPrompt.trim()) throw new Error("art_critique_edit_prompt_invalid");
            return {
                issueId: boundedString(item.issueId, 80),
                editPrompt: boundedString(item.editPrompt, MAX_EDIT_PROMPT_LENGTH),
            };
        }),
    };
}

export function parseScene(value: Record<string, unknown>): ArtCritiqueScene {
    const imageType = enumValue(value.imageType, ALL_IMAGE_TYPES);
    const sceneDepth = enumValue(value.sceneDepth, ALL_SCENE_DEPTHS);
    if (!imageType || !sceneDepth || typeof value.intendedFocus !== "string" || typeof value.mood !== "string" || typeof value.estimatedIntent !== "string") throw new Error("art_critique_scene_invalid");
    if (!Array.isArray(value.subjects) || !Array.isArray(value.style) || !Array.isArray(value.compositionType) || !Array.isArray(value.lightingType)) throw new Error("art_critique_scene_invalid");
    return {
        imageType,
        style: boundedStrings(value.style, 8, 100),
        subjects: value.subjects.slice(0, 8).map((item) => {
            if (!isRecord(item) || typeof item.id !== "string" || typeof item.description !== "string") throw new Error("art_critique_scene_invalid");
            const importance = enumValue(item.importance, ["primary", "secondary", "background"] as const);
            if (!importance) throw new Error("art_critique_scene_invalid");
            return { id: boundedString(item.id, 80), description: boundedString(item.description, 240), importance };
        }),
        intendedFocus: boundedString(value.intendedFocus, 300),
        compositionType: boundedStrings(value.compositionType, 8, 100),
        lightingType: boundedStrings(value.lightingType, 8, 100),
        mood: boundedString(value.mood, 180),
        estimatedIntent: boundedString(value.estimatedIntent, 300),
        sceneDepth,
    };
}

export function parseCandidates(value: unknown, reviewer: ArtCritiqueCandidate["reviewer"]) {
    if (!isRecord(value) || !Array.isArray(value.candidates)) throw new Error("art_critique_candidates_invalid");
    const ids = new Set<string>();
    return value.candidates.slice(0, MAX_CANDIDATES).flatMap((item, index) => {
        if (!isRecord(item)) throw new Error("art_critique_candidates_invalid");
        const category = enumValue(item.category, ALL_CATEGORIES);
        const severity = numeric(item.severity);
        const confidence = numeric(item.confidence);
        if (!category || severity === null || confidence === null || typeof item.title !== "string" || typeof item.observation !== "string" || typeof item.reason !== "string" || typeof item.targetDescription !== "string") {
            throw new Error("art_critique_candidates_invalid");
        }
        const checkId = typeof item.checkId === "string" ? boundedString(item.checkId, 80) : "";
        const kind = enumValue(item.kind, ["issue", "option"] as const) || "issue";
        const evidence = Array.isArray(item.evidence) ? boundedStrings(item.evidence, 4, 300) : [];
        const rule = findArtCritiqueRubricCheck(checkId);
        const title = boundedString(item.title, 180);
        const observation = boundedString(item.observation, 600);
        const reason = boundedString(item.reason, 800);
        const targetDescription = boundedString(item.targetDescription, 300);
        if (
            !rule ||
            rule.category !== category ||
            !isReviewerAllowed(reviewer, category) ||
            !title ||
            !observation ||
            !reason ||
            !targetDescription ||
            (rule.evidenceRequired !== false && evidence.length === 0) ||
            clamp01(confidence) < Math.max(rule.minConfidence ?? 0.55, MIN_REPORTABLE_CONFIDENCE)
        )
            return [];

        const requestedId = typeof item.id === "string" && item.id.trim() ? boundedString(item.id, 80) : `candidate-${index + 1}`;
        const id = uniqueId(requestedId, ids);
        return [
            {
                id,
                checkId,
                kind,
                category,
                title,
                observation,
                reason,
                evidence,
                severity: clamp01(severity),
                confidence: clamp01(confidence),
                targetDescription,
                reviewer,
            } satisfies ArtCritiqueCandidate,
        ];
    });
}

export function parseAggregateIssue(value: unknown, index: number): AggregateIssueDraft {
    if (!isRecord(value)) throw new Error("art_critique_aggregate_invalid");
    const category = enumValue(value.category, ALL_CATEGORIES);
    const severity = enumValue(value.severity, ALL_SEVERITIES);
    const confidence = numeric(value.confidence);
    if (!category || !severity || confidence === null || typeof value.title !== "string" || typeof value.explanation !== "string" || typeof value.targetDescription !== "string" || !isRecord(value.suggestion) || !Array.isArray(value.sourceCandidateIds)) {
        throw new Error("art_critique_aggregate_invalid");
    }
    const suggestion = parseSuggestion(value.suggestion);
    const baseId = typeof value.id === "string" && value.id.trim() ? boundedString(value.id, 80) : `issue-${index + 1}`;
    return {
        id: baseId,
        category,
        title: boundedString(value.title, 180),
        explanation: boundedString(value.explanation, 1000),
        severity,
        confidence: clamp01(confidence),
        suggestion,
        sourceCandidateIds: boundedStrings(value.sourceCandidateIds, MAX_CANDIDATES, 80),
        targetDescription: boundedString(value.targetDescription, 300),
    };
}

export function parseSuggestion(value: Record<string, unknown>): ArtCritiqueSuggestion {
    if (typeof value.goal !== "string" || typeof value.expectedEffect !== "string" || !Array.isArray(value.actions) || !Array.isArray(value.preserve)) throw new Error("art_critique_aggregate_invalid");
    return {
        goal: boundedString(value.goal, 500),
        actions: boundedStrings(value.actions, 6, 500),
        preserve: boundedStrings(value.preserve, 6, 500),
        expectedEffect: boundedString(value.expectedEffect, 500),
    };
}

export function parseTarget(value: Record<string, unknown>): ArtCritiqueTarget {
    const type = enumValue(value.type, ["box", "point", "points", "polygon", "global"] as const);
    if (!type || !Array.isArray(value.points)) throw new Error("art_critique_grounding_invalid");
    const points = value.points.slice(0, 12).map((point) => {
        if (!isRecord(point)) throw new Error("art_critique_grounding_invalid");
        const x = numeric(point.x);
        const y = numeric(point.y);
        if (x === null || y === null) throw new Error("art_critique_grounding_invalid");
        return { x: clamp01(x), y: clamp01(y) };
    });
    if (type === "global") return { type, points: [] };
    if ((type === "point" || type === "points") && points.length < 1) return { type: "global", points: [] };
    if (type === "box" && points.length < 2) return { type: "global", points: [] };
    if (type === "polygon" && points.length < 3) return { type: "global", points: [] };
    return { type, points };
}

export function toIssueDraft(issue: AggregateIssueDraft): ArtCritiqueIssue {
    return {
        id: issue.id,
        category: issue.category,
        title: issue.title,
        explanation: issue.explanation,
        severity: issue.severity,
        confidence: issue.confidence,
        target: { type: "global", points: [] },
        targetDescription: issue.targetDescription,
        targetSource: "global",
        suggestion: issue.suggestion,
        sourceCandidateIds: issue.sourceCandidateIds,
    };
}

export function parseAggregateOption(value: unknown, index: number): AggregateOptionDraft {
    if (!isRecord(value)) throw new Error("art_critique_aggregate_invalid");
    const category = enumValue(value.category, ALL_CATEGORIES);
    const confidence = numeric(value.confidence);
    if (!category || confidence === null || typeof value.title !== "string" || typeof value.explanation !== "string" || !isRecord(value.suggestion) || !Array.isArray(value.sourceCandidateIds)) {
        throw new Error("art_critique_aggregate_invalid");
    }
    const suggestion = parseSuggestion(value.suggestion);
    const baseId = typeof value.id === "string" && value.id.trim() ? boundedString(value.id, 80) : `option-${index + 1}`;
    return {
        id: baseId,
        category,
        title: boundedString(value.title, 180),
        explanation: boundedString(value.explanation, 1000),
        confidence: clamp01(confidence),
        suggestion,
        sourceCandidateIds: boundedStrings(value.sourceCandidateIds, MAX_CANDIDATES, 80),
    };
}

export function toOptionDraft(option: AggregateOptionDraft): ArtCritiqueOption {
    return {
        id: option.id,
        category: option.category,
        title: option.title,
        explanation: option.explanation,
        confidence: option.confidence,
        suggestion: option.suggestion,
        sourceCandidateIds: option.sourceCandidateIds,
    };
}

export function uniqueId(value: string, used: Set<string>) {
    let candidate = value;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${value}-${suffix++}`;
    used.add(candidate);
    return candidate;
}

export function boundedStrings(value: unknown, maxItems: number, maxLength: number) {
    if (!Array.isArray(value)) throw new Error("art_critique_stage_invalid");
    return value
        .slice(0, maxItems)
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => boundedString(item, maxLength));
}

export function boundedString(value: string, maxLength: number) {
    return value.trim().slice(0, maxLength);
}

export function enumValue<T extends string>(value: unknown, values: readonly T[]): T | null {
    return typeof value === "string" && values.includes(value as T) ? (value as T) : null;
}

export function numeric(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

export function stripJsonFence(value: string) {
    const trimmed = value.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced?.[1] || trimmed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
