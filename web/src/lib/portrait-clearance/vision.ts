import { modelDisplayName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import type { PortraitClearanceModelPolicy, PortraitRiskLevel } from "@/lib/portrait-clearance/contracts";
import type { ResponseFunctionTool, ResponseInputMessage, ToolResponseResult } from "@/services/api/image";

export type PortraitVisionFeatureKey = "face_shape" | "facial_layout" | "eyes_brows" | "nose_mouth" | "hair_hairline" | "distinctive_features";
export type PortraitVisionComparison = {
    imageAType: "realistic" | "stylized";
    imageBType: "realistic" | "stylized";
    analysisPath: "A" | "B";
    status: "success" | "unable_to_determine";
    riskLevel: PortraitRiskLevel;
    overallSimilarity: number;
    featureComparison: Record<PortraitVisionFeatureKey, { similarity: "high" | "medium" | "low" | "none"; note: string }>;
    basis: string[];
    limitations: string[];
    modificationSuggestions: string[];
    insightfaceFusionNote: string;
    manualReviewRecommended: boolean;
};

const FEATURE_KEYS: PortraitVisionFeatureKey[] = ["face_shape", "facial_layout", "eyes_brows", "nose_mouth", "hair_hairline", "distinctive_features"];
const SIMILARITIES = new Set(["high", "medium", "low", "none"]);
const RISKS = new Set<PortraitRiskLevel>(["high", "medium", "low_to_medium", "low", "unable_to_determine"]);

export const portraitVisionTool: ResponseFunctionTool = {
    type: "function",
    function: {
        name: "submit_portrait_comparison",
        description: "提交两张人物图片的结构化可识别性排查结果；不识别人名、不确认私人身份，也不作法律判断。",
        strict: true,
        parameters: {
            type: "object",
            additionalProperties: false,
            required: ["imageAType", "imageBType", "analysisPath", "status", "riskLevel", "overallSimilarity", "featureComparison", "basis", "limitations", "modificationSuggestions", "insightfaceFusionNote", "manualReviewRecommended"],
            properties: {
                imageAType: { type: "string", enum: ["realistic", "stylized"] },
                imageBType: { type: "string", enum: ["realistic", "stylized"] },
                analysisPath: { type: "string", enum: ["A", "B"] },
                status: { type: "string", enum: ["success", "unable_to_determine"] },
                riskLevel: { type: "string", enum: ["high", "medium", "low_to_medium", "low", "unable_to_determine"] },
                overallSimilarity: { type: "number", minimum: 0, maximum: 1 },
                featureComparison: {
                    type: "object",
                    additionalProperties: false,
                    required: FEATURE_KEYS,
                    properties: Object.fromEntries(FEATURE_KEYS.map((key) => [key, { type: "object", additionalProperties: false, required: ["similarity", "note"], properties: { similarity: { type: "string", enum: ["high", "medium", "low", "none"] }, note: { type: "string", maxLength: 1000 } } }])),
                },
                basis: { type: "array", maxItems: 16, items: { type: "string", maxLength: 1000 } },
                limitations: { type: "array", maxItems: 16, items: { type: "string", maxLength: 1000 } },
                modificationSuggestions: { type: "array", maxItems: 16, items: { type: "string", maxLength: 1000 } },
                insightfaceFusionNote: { type: "string", maxLength: 1000 },
                manualReviewRecommended: { type: "boolean" },
            },
        },
    },
};

export function portraitVisionModels(config: AiConfig) {
    return selectableModelsByCapability(config, "text");
}

export function resolvePortraitVisionModel(config: AiConfig, policy: PortraitClearanceModelPolicy) {
    const models = portraitVisionModels(config);
    const preferred = policy.mode === "pinned" ? policy.modelRef : config.textModel || config.model;
    return preferred && models.includes(preferred) ? preferred : policy.mode === "pinned" ? "" : models[0] || "";
}

export function portraitVisionModelError(config: AiConfig, policy: PortraitClearanceModelPolicy) {
    if (!resolvePortraitVisionModel(config, policy)) return policy.mode === "pinned" ? "节点固定的视觉模型已失效，请重新选择" : "项目默认视觉模型不可用，请重新选择";
    return "";
}

export function portraitVisionModelLabel(config: AiConfig, model: string) {
    return model ? modelDisplayName(config, model) : "未选择";
}

export function portraitVisionMessages(input: { queryDataUrl: string; comparisonDataUrl: string; queryName: string; comparisonName: string; localPrecheck: unknown }): ResponseInputMessage[] {
    return [
        {
            role: "system",
            content: "你是影策中的肖像可识别性排查分析器。只做结构化视觉比较，不识别人名或私人身份，不输出确认同一人、确认侵权、绝对安全等确定性结论。两张均为写实人像时使用 Path A，任一张明显风格化时使用 Path B；请结合本地 ArcFace、检测和质量预检，但不要将本地 embedding 当作法律结论。对脸型、五官布局、眼眉、鼻口、发型发际线、标志性特征分别说明。若图片质量、多脸或风格差异使判断不可靠，返回 unable_to_determine 并说明限制。",
        },
        {
            role: "user",
            content: [
                { type: "text", text: `查询图：${input.queryName}\n参考/候选图：${input.comparisonName}\n本地预检（仅作辅助）：${JSON.stringify(input.localPrecheck)}` },
                { type: "image_url", image_url: { url: input.queryDataUrl } },
                { type: "image_url", image_url: { url: input.comparisonDataUrl } },
            ],
        },
    ];
}

export function parsePortraitVisionToolResponse(response: ToolResponseResult): PortraitVisionComparison {
    const call = response.toolCalls.find((candidate) => candidate.function.name === "submit_portrait_comparison");
    if (!call) throw new Error("portrait_vision_tool_missing");
    let value: unknown;
    try { value = JSON.parse(call.function.arguments); } catch { throw new Error("portrait_vision_result_invalid"); }
    return parseVisionComparison(value);
}

export function parseVisionComparison(value: unknown): PortraitVisionComparison {
    if (!isRecord(value) || !["realistic", "stylized"].includes(String(value.imageAType)) || !["realistic", "stylized"].includes(String(value.imageBType)) || !["A", "B"].includes(String(value.analysisPath)) || !["success", "unable_to_determine"].includes(String(value.status)) || !RISKS.has(value.riskLevel as PortraitRiskLevel) || typeof value.overallSimilarity !== "number" || !Number.isFinite(value.overallSimilarity) || value.overallSimilarity < 0 || value.overallSimilarity > 1 || !isRecord(value.featureComparison) || !Array.isArray(value.basis) || !Array.isArray(value.limitations) || !Array.isArray(value.modificationSuggestions) || typeof value.insightfaceFusionNote !== "string" || typeof value.manualReviewRecommended !== "boolean") throw new Error("portrait_vision_result_invalid");
    const featureComparison = Object.fromEntries(FEATURE_KEYS.map((key) => {
        const item = value.featureComparison[key];
        if (!isRecord(item) || !SIMILARITIES.has(String(item.similarity)) || typeof item.note !== "string" || item.note.length > 1000) throw new Error("portrait_vision_result_invalid");
        return [key, { similarity: item.similarity as "high" | "medium" | "low" | "none", note: item.note }];
    })) as PortraitVisionComparison["featureComparison"];
    return {
        imageAType: value.imageAType as "realistic" | "stylized",
        imageBType: value.imageBType as "realistic" | "stylized",
        analysisPath: value.analysisPath as "A" | "B",
        status: value.status as "success" | "unable_to_determine",
        riskLevel: value.riskLevel as PortraitRiskLevel,
        overallSimilarity: value.overallSimilarity,
        featureComparison,
        basis: boundedStrings(value.basis),
        limitations: boundedStrings(value.limitations),
        modificationSuggestions: boundedStrings(value.modificationSuggestions),
        insightfaceFusionNote: value.insightfaceFusionNote,
        manualReviewRecommended: value.manualReviewRecommended,
    };
}

function boundedStrings(value: unknown) {
    if (!Array.isArray(value) || value.length > 16 || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 1000)) throw new Error("portrait_vision_result_invalid");
    return value as string[];
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
