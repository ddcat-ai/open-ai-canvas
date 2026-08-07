import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { resolveStyleExecutionPlan, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type ProjectStylePrompt = { id: string; title: string; prompt: string; profile?: StyleProfileSnapshot };

export async function generateCharacterTurnaround(input: { projectId: string; assetId: string; versionId: string; name: string; definition: Record<string, unknown>; projectStyle?: ProjectStylePrompt; config: AiConfig }) {
    const promptTemplateVariables = characterTurnaroundVariables(input.name, input.definition, input.projectStyle);
    const requestConfig = resolveModelRequestConfig(input.config, input.config.imageModel || input.config.model);
    const styleExecutionPlan = input.projectStyle?.profile ? resolveStyleExecutionPlan(input.projectStyle.profile, { mode: "image", model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked") throw new Error(`项目画风与当前图片模型不兼容：${styleExecutionPlan.warnings.join("；")}`);
    await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `character-turnaround:${input.assetId}`,
        mode: "image",
        prompt: "使用当前启用的角色三视图模板。",
        config: { ...input.config, model: input.config.imageModel || input.config.model, count: "1" },
        metadata: { operation: "character_turnaround", promptTemplateOperation: "character_turnaround", promptTemplateVariables, characterAssetId: input.assetId, stylePresetId: input.projectStyle?.id, styleProfileJson: input.projectStyle?.profile ? serializeStyleProfile(input.projectStyle.profile) : undefined, styleExecutionPlan, resolvedCharacterVersions: [{ assetId: input.assetId, versionId: input.versionId }] },
    });
}

function characterTurnaroundVariables(name: string, definition: Record<string, unknown>, projectStyle?: ProjectStylePrompt) {
    const visual = [definition.role, definition.appearance, definition.physique, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt, definition.multiViewPrompt]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("；");
    if (!visual) throw new Error("请先填写剧情定位、角色外貌、体型或服装，再初始化三视图");
    return { 角色名称: name, 项目画风: characterStyleConstraint(projectStyle) || "项目尚未指定画风，保持角色媒介中性。", 角色设定: visual };
}

function characterStyleConstraint(projectStyle?: ProjectStylePrompt) {
    if (!projectStyle) return "";
    // 三视图只继承角色资产相关规范，避免把建筑、运镜等项目规则错误塞进静态设定表。
    const characterSections = new Set(["风格组合", "项目定位", "题材世界观", "视觉媒介", "角色设计系统", "项目色彩与光影", "服饰、材质与场景", "资产一致性", "全局禁用"]);
    const rules = projectStyle.prompt.split("\n").filter((line) => {
        const title = line.match(/^【([^】]+)】/)?.[1];
        return title ? characterSections.has(title) : false;
    });
    return [
        `项目画风：${projectStyle.title}。角色造型、配色、服装材质与最终渲染媒介必须遵循以下规范：`,
        ...rules,
    ].join("\n");
}
