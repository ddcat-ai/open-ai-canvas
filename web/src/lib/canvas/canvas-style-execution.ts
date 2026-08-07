import { applyStyleExecutionPlan, createStyleProfileSnapshot, parseStyleProfile, resolveStyleExecutionPlan, serializeStyleProfile, type StyleExecutionPlan, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasStyleExecutionRuntime = {
    profile: StyleProfileSnapshot;
    profileJson: string;
    plan: StyleExecutionPlan;
    prompt: string;
};

export function resolveCanvasStyleExecution(nodes: CanvasNodeData[], sourceNode: CanvasNodeData | undefined, prompt: string, config: AiConfig, mode: "image" | "video"): CanvasStyleExecutionRuntime | null {
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    if (!styleNode || sourceNode?.metadata?.workflowKind === "styleboard") return null;
    const profile = parseStyleProfile(styleNode.metadata?.styleProfileJson) || legacyStyleNodeProfile(styleNode);
    if (!profile) return null;
    const requestConfig = resolveModelRequestConfig(config, config.model);
    const plan = resolveStyleExecutionPlan(profile, { mode, model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat });
    if (plan.status === "blocked") throw new Error(`项目画风与当前模型不兼容：${plan.warnings.join("；")}`);
    return { profile, profileJson: serializeStyleProfile(profile), plan, prompt: applyStyleExecutionPlan(prompt, plan) };
}

function legacyStyleNodeProfile(node: CanvasNodeData) {
    const prompt = String(node.metadata?.content || node.metadata?.prompt || "").trim();
    const presetId = String(node.metadata?.stylePresetId || "").trim();
    if (!prompt || !presetId) return null;
    return createStyleProfileSnapshot({
        presetId,
        title: node.title.replace(/^(?:项目)?画风\s*[·：:]?\s*/, "").trim() || node.title,
        description: node.metadata?.workflowDescription || "历史项目画风规范",
        tags: [],
        prompt,
        assets: [],
        source: "user",
        revision: 1,
    });
}
