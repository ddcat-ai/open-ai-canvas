import { describe, expect, test } from "bun:test";

import "../src/lib/plugins/builtin/ai-art-critique";
import { getNodeAcceptedInputKind, getNodeDefinition } from "../src/lib/canvas/node-registry";
import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "../src/lib/canvas/tool-registry";
import { ART_CRITIQUE_NODE_TYPE, ART_CRITIQUE_RUBRIC_VERSION } from "../src/lib/art-critique/contracts";
import { ART_CRITIQUE_SEVERITY_COLORS, isRenderableArtCritiqueTarget, referenceTargetForIssue, repairIssueTarget, targetBounds, targetPolygon } from "../src/lib/art-critique/annotation";
import { artCritiqueMessages, parseArtCritiqueResponse } from "../src/lib/art-critique/review";
import {
    applyGrounding,
    applyEditPrompts,
    applyReferenceCoordinates,
    applyVerification,
    artCritiquePipelineTools,
    deduplicateAggregateIssues,
    filterAggregateAgainstCandidates,
    parseAggregatePayload,
    parseEditPromptPayload,
    parseGroundingPayload,
    parseSceneReviewPayload,
    parseVerificationPayload,
} from "../src/lib/art-critique/pipeline";
import { ART_CRITIQUE_RUBRIC, buildArtCritiqueRubricPrompt } from "../src/lib/art-critique/rubrics";
import type { ToolResponseResult } from "../src/services/api/image";

function response(value: unknown): ToolResponseResult {
    return {
        content: "",
        toolCalls: [{ id: "call-1", type: "function", function: { name: "submit_art_critique", arguments: JSON.stringify(value) } }],
    };
}

const input = { dataUrl: "data:image/png;base64,placeholder", title: "测试图片", sourceFingerprint: "v1-test" };

describe("AI 审美批改插件注册", () => {
    test("节点只接受图片并隐藏输出端口", () => {
        expect(getNodeAcceptedInputKind(ART_CRITIQUE_NODE_TYPE)).toBe("image");
        expect(getNodeDefinition(ART_CRITIQUE_NODE_TYPE)?.showOutputConnection).toBe(false);
    });

    test("启用后出现在添加节点菜单", () => {
        const baseContext = {
            workspaceMode: "simple" as const,
            isProjectLinked: false,
            handlers: {} as AddNodeMenuContext["handlers"],
        };
        const enabledCommands = resolveAddNodeMenuCommands({ ...baseContext, enabledPluginIds: new Set(["ai-art-critique"]) });
        const disabledCommands = resolveAddNodeMenuCommands({ ...baseContext, enabledPluginIds: new Set<string>() });
        expect(enabledCommands.some((command) => command.id === ART_CRITIQUE_NODE_TYPE)).toBe(true);
        expect(disabledCommands.some((command) => command.id === ART_CRITIQUE_NODE_TYPE)).toBe(false);
    });
});

describe("AI 审美批改报告解析", () => {
    test("解析 AI 生成的局部编辑提示词并按问题 ID 应用", () => {
        const issue = {
            id: "issue-1",
            category: "lighting",
            title: "主体脸部受光不足",
            explanation: "脸部暗部过重，表情与互动的可读性下降。",
            severity: "high",
            confidence: 0.9,
            target: {
                type: "box",
                points: [
                    { x: 0.3, y: 0.2 },
                    { x: 0.6, y: 0.6 },
                ],
            },
            targetDescription: "女性主体的脸部",
            suggestion: {
                goal: "提升人物表情的可读性",
                actions: ["提高脸部局部亮度", "保留原有光线方向"],
                preserve: ["保留夜景氛围"],
                expectedEffect: "人物重新成为视觉焦点",
            },
        } satisfies import("../src/lib/art-critique/contracts").ArtCritiqueIssue;
        const result = parseEditPromptPayload({
            prompts: [{ issueId: "issue-1", editPrompt: "只提高女性主体脸部的局部亮度，保留窗光方向、人物身份、构图和夜景氛围。" }],
        });
        const warnings: string[] = [];
        const applied = applyEditPrompts([issue], result.prompts, warnings);

        expect(applied[0].editPrompt).toContain("女性主体脸部");
        expect(warnings).toHaveLength(0);
    });

    test("AI 提示词缺失时不使用本地拼接替代", () => {
        const issue = {
            id: "issue-1",
            category: "lighting" as const,
            title: "主体脸部受光不足",
            explanation: "脸部暗部过重。",
            severity: "high" as const,
            confidence: 0.9,
            target: { type: "global" as const, points: [] },
            suggestion: { goal: "提升可读性", actions: ["提高局部亮度"], preserve: ["保留夜景氛围"], expectedEffect: "人物更突出" },
        };
        const warnings: string[] = [];
        const applied = applyEditPrompts([issue], [], warnings);

        expect(applied[0].editPrompt).toBeUndefined();
        expect(warnings[0]).toContain("不会使用本地拼接替代");
    });

    test("使用版本化 Rubric 并把高优先级问题排在前面", () => {
        const report = parseArtCritiqueResponse(
            response({
                summary: "画面有明确主体。",
                strengths: ["色彩统一"],
                issues: [
                    {
                        id: "low-first",
                        category: "color",
                        title: "颜色略杂",
                        explanation: "次要区域饱和度略高。",
                        severity: "low",
                        confidence: 0.98,
                        target: { type: "global", points: [] },
                        suggestion: { goal: "收拢色彩", actions: ["降低次要区域饱和度"], preserve: ["保留主体强调色"], expectedEffect: "主体更突出" },
                    },
                    {
                        id: "high-second",
                        category: "composition",
                        title: "主体方向感不足",
                        explanation: "主体与留白方向关系不清。",
                        severity: "high",
                        confidence: 0.7,
                        target: {
                            type: "box",
                            points: [
                                { x: 0.2, y: 0.2 },
                                { x: 0.6, y: 0.8 },
                            ],
                        },
                        suggestion: { goal: "增强方向感", actions: ["调整主体位置"], preserve: ["保留人物姿态"], expectedEffect: "视线移动更自然" },
                    },
                ],
            }),
            input,
        );
        expect(report.rubricVersion).toBe(ART_CRITIQUE_RUBRIC_VERSION);
        expect(report.issues.map((issue) => issue.id)).toEqual(["high-second", "low-first"]);
    });

    test("Prompt 包含 Rubric 版本、参考方法和构图意图约束", () => {
        const systemText = artCritiqueMessages(input)[0].content;
        expect(typeof systemText).toBe("string");
        expect(systemText).toContain(ART_CRITIQUE_RUBRIC_VERSION);
        expect(systemText).toContain("CADB / SAMP-Net");
        expect(systemText).toContain("不能仅因没有使用三分法就报告");
        expect(buildArtCritiqueRubricPrompt()).toContain("HumanAesExpert");
        expect(ART_CRITIQUE_RUBRIC).toHaveLength(4);
    });

    test("窄 Reviewer Prompt 只注入自己的规则并允许没有问题", () => {
        const prompt = buildArtCritiqueRubricPrompt({ categories: ["color"], includeReferenceMapping: false });
        expect(prompt).toContain("【色彩｜color】");
        expect(prompt).not.toContain("【构图与视觉层级｜composition】");
        expect(prompt).not.toContain("参考方法映射");
        expect(prompt).toContain("允许没有问题");
    });

    test("保留报告合同并把不完整的局部目标降级为全局问题", () => {
        const report = parseArtCritiqueResponse(
            response({
                summary: "主体明确，但画面层次还可以更集中。",
                strengths: ["主体轮廓清楚"],
                issues: [
                    {
                        id: "composition-1",
                        category: "composition",
                        title: "主体偏离视觉重心",
                        explanation: "主体周围留白不均。",
                        severity: "high",
                        confidence: 0.86,
                        target: { type: "box", points: [{ x: 0.2, y: 0.3 }] },
                        suggestion: { goal: "集中注意力", actions: ["收紧左侧留白"], preserve: ["保留主体姿态"], expectedEffect: "视觉重心更稳定" },
                    },
                ],
            }),
            input,
        );
        expect(report.sourceFingerprint).toBe("v1-test");
        expect(report.issues).toHaveLength(1);
        expect(report.issues[0].target).toEqual({ type: "global", points: [] });
    });

    test("最多保留五个问题并裁剪越界坐标", () => {
        const issues = Array.from({ length: 8 }, (_, index) => ({
            id: `issue-${index}`,
            category: "color",
            title: `问题 ${index}`,
            explanation: "需要调整。",
            severity: "low",
            confidence: 2,
            target: { type: "point", points: [{ x: -1, y: 2 }] },
            suggestion: { goal: "改善", actions: ["调整"], preserve: [], expectedEffect: "更统一" },
        }));
        const report = parseArtCritiqueResponse(response({ summary: "总结", strengths: [], issues }), input);
        expect(report.issues).toHaveLength(5);
        expect(report.issues[0].confidence).toBe(1);
        expect(report.issues[0].target.points[0]).toEqual({ x: 0, y: 1 });
    });
});

describe("AI 审美批改标注几何", () => {
    test("box 目标转换为四边形并计算边界", () => {
        const target = {
            type: "box" as const,
            points: [
                { x: 0.8, y: 0.7 },
                { x: 0.2, y: 0.1 },
            ],
        };
        expect(targetPolygon(target)).toEqual([
            { x: 0.2, y: 0.1 },
            { x: 0.8, y: 0.1 },
            { x: 0.8, y: 0.7 },
            { x: 0.2, y: 0.7 },
        ]);
        expect(targetBounds(target)).toEqual({ x: 0.2, y: 0.1, width: 0.6000000000000001, height: 0.6 });
    });

    test("severity 使用固定颜色角色", () => {
        expect(ART_CRITIQUE_SEVERITY_COLORS.high).toBe("#ef4444");
        expect(ART_CRITIQUE_SEVERITY_COLORS.medium).toBe("#f59e0b");
    });

    test("定位失败时用问题描述生成参考区域或多个参考点", () => {
        const foreground = referenceTargetForIssue({
            category: "composition",
            title: "前景人物压过主体",
            explanation: "左侧前景的视觉重量过重。",
            targetDescription: "左侧前景人物与主体区域",
        });
        const table = referenceTargetForIssue({
            category: "proportion",
            title: "桌沿切断人物关系",
            explanation: "桌沿和桌腿位于画面下方。",
            targetDescription: "桌沿、桌腿和桌面静物",
        });
        const highlights = referenceTargetForIssue({
            category: "color",
            title: "多处高饱和暖色亮点分散焦点",
            explanation: "画面中存在多个分散的暖色亮点。",
            targetDescription: "多处高饱和暖色亮点",
        });

        expect(foreground.type).toBe("box");
        expect(targetBounds(foreground).width).toBeCloseTo(0.36);
        expect(table.type).toBe("box");
        expect(targetBounds(table).y).toBe(0.5);
        expect(highlights.type).toBe("points");
        expect(highlights.points.length).toBeGreaterThan(1);
    });

    test("无效框坐标会被识别并修复为可见参考框", () => {
        const issue = {
            id: "invalid-box",
            category: "composition" as const,
            title: "前景暗部压过主体",
            explanation: "左侧前景形成连续暗部。",
            severity: "high" as const,
            confidence: 0.9,
            target: {
                type: "box" as const,
                points: [
                    { x: 0.2, y: 0.1 },
                    { x: 0.8, y: 0.1 },
                ],
            },
            targetDescription: "左侧前景人物",
            suggestion: { goal: "减轻干扰", actions: ["降低前景对比"], preserve: [], expectedEffect: "主体更突出" },
        };
        expect(isRenderableArtCritiqueTarget(issue.target)).toBe(false);
        const repaired = repairIssueTarget(issue);
        expect(repaired.targetSource).toBe("reference");
        expect(repaired.target.type).toBe("box");
        expect(targetBounds(repaired.target).height).toBeGreaterThan(0.8);
    });
});

describe("AI 审美批改多阶段管线", () => {
    test("阶段工具覆盖场景、Reviewer、聚合、定位、提示词生成和复核", () => {
        expect(Object.values(artCritiquePipelineTools).map((tool) => tool.function.name)).toEqual([
            "analyze_art_scene",
            "review_art_composition",
            "review_art_color",
            "review_art_lighting",
            "review_art_structure",
            "aggregate_art_critique",
            "ground_art_critique_issues",
            "generate_art_edit_prompts",
            "verify_art_critique",
        ]);
    });

    test("解析场景和候选问题", () => {
        const result = parseSceneReviewPayload({
            scene: {
                imageType: "portrait",
                style: ["电影感"],
                subjects: [{ id: "person", description: "坐在桌边的人物", importance: "primary" }],
                intendedFocus: "人物表情",
                compositionType: ["对角线"],
                lightingType: ["窗光"],
                mood: "安静",
                estimatedIntent: "表现人物的孤独感",
                sceneDepth: "medium",
            },
            candidates: [
                {
                    id: "c-1",
                    checkId: "subject-placement",
                    category: "composition",
                    title: "主体被左侧前景压住",
                    observation: "左侧前景占据很大面积",
                    reason: "人物视觉重量被削弱",
                    evidence: ["前景轮廓覆盖画面左侧"],
                    severity: 0.8,
                    confidence: 0.9,
                    targetDescription: "左侧前景与人物区域",
                },
            ],
        });
        expect(result.scene.imageType).toBe("portrait");
        expect(result.candidates[0].reviewer).toBe("composition");
        expect(result.candidates[0].confidence).toBe(0.9);
    });

    test("按规则 ID、Reviewer、图片类型、证据和置信度过滤候选", () => {
        const result = parseSceneReviewPayload({
            scene: {
                imageType: "landscape",
                style: [],
                subjects: [],
                intendedFocus: "风景层次",
                compositionType: [],
                lightingType: [],
                mood: "平静",
                estimatedIntent: "表现空间感",
                sceneDepth: "deep",
            },
            candidates: [
                { id: "valid", checkId: "visual-balance", category: "composition", title: "有效问题", observation: "有证据", reason: "影响表达", evidence: ["左侧重量明显"], severity: 0.8, confidence: 0.8, targetDescription: "左侧" },
                { id: "no-rule", checkId: "made-up-rule", category: "composition", title: "未知规则", observation: "有证据", reason: "影响表达", evidence: ["证据"], severity: 0.8, confidence: 0.9, targetDescription: "画面" },
                { id: "no-evidence", checkId: "visual-balance", category: "composition", title: "没有证据", observation: "看起来不平衡", reason: "影响表达", evidence: [], severity: 0.8, confidence: 0.9, targetDescription: "画面" },
                { id: "low-confidence", checkId: "visual-balance", category: "composition", title: "置信度低", observation: "证据不足", reason: "影响表达", evidence: ["模糊"], severity: 0.8, confidence: 0.2, targetDescription: "画面" },
                { id: "wrong-reviewer", checkId: "visual-balance", category: "color", title: "类别不匹配", observation: "有证据", reason: "影响表达", evidence: ["证据"], severity: 0.8, confidence: 0.9, targetDescription: "画面" },
            ],
        });
        expect(result.candidates.map((candidate) => candidate.id)).toEqual(["valid"]);
        expect(result.candidates[0].checkId).toBe("visual-balance");
    });
    test("聚合结果保留建议并按优先级排序", () => {
        const result = parseAggregatePayload({
            summary: "主体明确，但层级还可以更集中。",
            strengths: ["色彩统一"],
            issues: [
                {
                    id: "low",
                    category: "color",
                    title: "次要区域略鲜艳",
                    explanation: "背景有局部高饱和色块。",
                    severity: "low",
                    confidence: 0.95,
                    targetDescription: "背景右上角",
                    suggestion: { goal: "降低干扰", actions: ["降低饱和度"], preserve: ["保留主体强调色"], expectedEffect: "主体更突出" },
                    sourceCandidateIds: ["c-2"],
                },
                {
                    id: "high",
                    category: "lighting",
                    title: "人物和背景分离不足",
                    explanation: "人物脸部和墙面明度接近。",
                    severity: "high",
                    confidence: 0.72,
                    targetDescription: "人物脸部和后方墙面",
                    suggestion: { goal: "增强分离", actions: ["提高脸部局部亮度"], preserve: ["保留窗光方向"], expectedEffect: "焦点更清楚" },
                    sourceCandidateIds: ["c-3"],
                },
            ],
        });
        expect(result.issues.map((issue) => issue.id)).toEqual(["high", "low"]);
        expect(result.issues[0].suggestion.actions).toEqual(["提高脸部局部亮度"]);
    });

    test("聚合结果只能引用真实候选并过滤无来源问题", () => {
        const candidates = [
            {
                id: "c-valid",
                checkId: "palette",
                kind: "issue" as const,
                category: "color" as const,
                title: "背景颜色干扰",
                observation: "背景右上角有一块高饱和色块",
                reason: "它抢走了主体的注意力",
                evidence: ["右上角色块与主体形成强烈饱和度对比"],
                severity: 0.8,
                confidence: 0.85,
                targetDescription: "背景右上角",
                reviewer: "color" as const,
            },
        ];
        const aggregate = parseAggregatePayload({
            summary: "主体明确。",
            strengths: ["主体清楚"],
            issues: [
                {
                    id: "valid",
                    category: "color",
                    title: "背景颜色干扰",
                    explanation: "背景高饱和色块抢走注意力。",
                    severity: "medium",
                    confidence: 0.8,
                    targetDescription: "背景右上角",
                    suggestion: { goal: "降低干扰", actions: ["降低饱和度"], preserve: ["保留主体颜色"], expectedEffect: "主体更突出" },
                    sourceCandidateIds: ["c-valid"],
                },
                {
                    id: "invented",
                    category: "lighting",
                    title: "凭空新增的问题",
                    explanation: "输入候选中不存在这个问题。",
                    severity: "high",
                    confidence: 0.9,
                    targetDescription: "画面",
                    suggestion: { goal: "改善", actions: ["调整"], preserve: [], expectedEffect: "更好" },
                    sourceCandidateIds: ["missing-candidate"],
                },
            ],
        });
        const warnings: string[] = [];
        const filtered = filterAggregateAgainstCandidates(aggregate, candidates, warnings);
        expect(filtered.issues.map((issue) => issue.id)).toEqual(["valid"]);
        expect(warnings).toHaveLength(1);
    });

    test("可选方向不能伪装成问题，且只能引用同类候选", () => {
        const candidates = [
            {
                id: "c-option",
                checkId: "temperature",
                kind: "option" as const,
                category: "color" as const,
                title: "尝试更冷的氛围",
                observation: "画面当前冷暖平衡，存在向冷色偏移的空间",
                reason: "这可能让情绪更克制，但不是确定性缺陷",
                evidence: ["主体和背景的冷暖关系清楚"],
                severity: 0.6,
                confidence: 0.82,
                targetDescription: "整体色调",
                reviewer: "color" as const,
            },
        ];
        const aggregate = parseAggregatePayload({
            summary: "画面整体成立。",
            strengths: ["色彩关系清楚"],
            issues: [
                {
                    id: "wrong-issue",
                    category: "color",
                    title: "色彩错误",
                    explanation: "把可选方向误写成了问题。",
                    severity: "medium",
                    confidence: 0.9,
                    targetDescription: "整体色调",
                    suggestion: { goal: "改善", actions: ["调整"], preserve: [], expectedEffect: "更好" },
                    sourceCandidateIds: ["c-option"],
                },
            ],
            options: [
                {
                    id: "valid-option",
                    category: "color",
                    title: "尝试更冷的氛围",
                    explanation: "如果想强化克制感，可以考虑向冷色移动。",
                    confidence: 0.84,
                    suggestion: { goal: "尝试冷色氛围", actions: ["小幅降低色温"], preserve: ["保留主体肤色"], expectedEffect: "情绪更克制" },
                    sourceCandidateIds: ["c-option"],
                },
            ],
        });
        const warnings: string[] = [];
        const filtered = filterAggregateAgainstCandidates(aggregate, candidates, warnings);
        expect(filtered.issues).toHaveLength(0);
        expect(filtered.options.map((option) => option.id)).toEqual(["valid-option"]);
        expect(warnings).toHaveLength(1);
    });

    test("低置信度定位降级为全局，复核拒绝项被过滤", () => {
        const issues = [
            {
                id: "confirmed",
                category: "composition" as const,
                title: "主体位置",
                explanation: "主体偏向一侧。",
                severity: "high" as const,
                confidence: 0.9,
                target: { type: "global" as const, points: [] },
                suggestion: { goal: "改善", actions: ["调整位置"], preserve: [], expectedEffect: "更平衡" },
            },
            {
                id: "rejected",
                category: "color" as const,
                title: "颜色问题",
                explanation: "颜色关系不清。",
                severity: "medium" as const,
                confidence: 0.8,
                target: { type: "global" as const, points: [] },
                suggestion: { goal: "改善", actions: ["调整颜色"], preserve: [], expectedEffect: "更统一" },
            },
        ];
        const grounded = applyGrounding(issues, [
            {
                issueId: "confirmed",
                target: {
                    type: "box",
                    points: [
                        { x: 0.2, y: 0.2 },
                        { x: 0.6, y: 0.8 },
                    ],
                },
                groundingConfidence: 0.9,
            },
            {
                issueId: "rejected",
                target: {
                    type: "box",
                    points: [
                        { x: 0.1, y: 0.1 },
                        { x: 0.4, y: 0.4 },
                    ],
                },
                groundingConfidence: 0.4,
            },
        ]);
        expect(grounded[0].target.type).toBe("box");
        expect(grounded[1].target.type).toBe("global");

        const verified = applyVerification(grounded, [
            { issueId: "confirmed", verification: { verdict: "confirmed", confidence: 0.92, reason: "图像证据清楚" } },
            { issueId: "rejected", verification: { verdict: "rejected", confidence: 0.9, reason: "与图像不符" } },
        ]);
        expect(verified.issues.map((issue) => issue.id)).toEqual(["confirmed"]);
        expect(verified.summary).toEqual({ checked: 2, confirmed: 1, uncertain: 0, rejected: 1 });
    });

    test("定位服务失败时应用参考坐标并标记来源", () => {
        const issues = [
            {
                id: "reference-1",
                category: "composition" as const,
                title: "左侧前景人物过重",
                explanation: "左侧前景人物形成连续暗色块。",
                severity: "high" as const,
                confidence: 0.9,
                target: { type: "global" as const, points: [] },
                targetDescription: "左侧前景人物",
                suggestion: { goal: "减轻干扰", actions: ["收窄前景人物"], preserve: [], expectedEffect: "主体更突出" },
            },
        ];
        const grounded = applyReferenceCoordinates(issues);
        expect(grounded[0].target.type).toBe("box");
        expect(grounded[0].targetSource).toBe("reference");
    });

    test("定位和复核解析保留置信度", () => {
        const grounding = parseGroundingPayload({ targets: [{ issueId: "i-1", target: { type: "global", points: [] }, groundingConfidence: 0.61 }] });
        const verification = parseVerificationPayload({ decisions: [{ issueId: "i-1", verdict: "uncertain", confidence: 0.77, reason: "局部证据不够明确" }] });
        expect(grounding.targets[0].groundingConfidence).toBe(0.61);
        expect(verification.decisions[0].verification.verdict).toBe("uncertain");
    });

    test("定位解析支持分散问题的多个参考点", () => {
        const grounding = parseGroundingPayload({
            targets: [
                {
                    issueId: "i-2",
                    target: {
                        type: "points",
                        points: [
                            { x: 0.2, y: 0.2 },
                            { x: 0.8, y: 0.7 },
                        ],
                    },
                    groundingConfidence: 0.8,
                },
            ],
        });
        expect(grounding.targets[0].target.type).toBe("points");
        expect(targetPolygon(grounding.targets[0].target)).toHaveLength(2);
    });

    test("模型返回无效框时改用参考区域而不是退化横线", () => {
        const issues = [
            {
                id: "grounding-invalid-box",
                category: "composition" as const,
                title: "前景暗部过重",
                explanation: "左侧前景压过主体动线。",
                severity: "high" as const,
                confidence: 0.9,
                target: { type: "global" as const, points: [] },
                targetDescription: "左侧前景人物",
                suggestion: { goal: "减轻前景重量", actions: ["缩小前景人物"], preserve: [], expectedEffect: "主体更突出" },
            },
        ];
        const grounded = applyGrounding(issues, [
            {
                issueId: "grounding-invalid-box",
                target: {
                    type: "box",
                    points: [
                        { x: 0.2, y: 0.1 },
                        { x: 0.8, y: 0.1 },
                    ],
                },
                groundingConfidence: 0.92,
            },
        ]);
        expect(grounded[0].targetSource).toBe("reference");
        expect(grounded[0].target.type).toBe("box");
        expect(targetBounds(grounded[0].target).height).toBeGreaterThan(0.8);
    });

    test("同类同根因问题会合并并保留来源与建议", () => {
        const issues = [
            {
                id: "face-light",
                category: "lighting" as const,
                title: "主体脸部受光不足",
                explanation: "脸部处于暗部，表情不清晰。",
                severity: "high" as const,
                confidence: 0.9,
                targetDescription: "主体脸部",
                suggestion: { goal: "提升表情可读性", actions: ["提高脸部局部亮度"], preserve: ["保留冷色氛围"], expectedEffect: "表情更清楚" },
                sourceCandidateIds: ["lighting-exposure"],
            },
            {
                id: "subject-separation",
                category: "lighting" as const,
                title: "人物暗部融入背景",
                explanation: "人物亮度与背景接近，主体分离不足。",
                severity: "medium" as const,
                confidence: 0.86,
                targetDescription: "人物头发和右肩",
                suggestion: { goal: "加强主体分离", actions: ["补充克制的轮廓光"], preserve: ["保留人物轮廓"], expectedEffect: "空间层次更清楚" },
                sourceCandidateIds: ["lighting-separation"],
            },
        ];
        const warnings: string[] = [];
        const result = deduplicateAggregateIssues(issues, warnings);
        expect(result).toHaveLength(1);
        expect(result[0].sourceCandidateIds).toEqual(["lighting-exposure", "lighting-separation"]);
        expect(result[0].suggestion.actions).toEqual(["提高脸部局部亮度", "补充克制的轮廓光"]);
        expect(warnings).toEqual(["聚合阶段合并了 1 个重复或同根因问题。"]);
    });
});
