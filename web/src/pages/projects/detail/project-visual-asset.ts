import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { resolveStyleExecutionPlan, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import type { ProjectAsset } from "@/services/api/projects";
import type { GenerationTask } from "@/services/api/task-center";
import { logicalModelIDForConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type VisualImageInput = {
    projectId: string;
    asset: ProjectAsset;
    config: AiConfig;
    projectStyle?: { id: string; title: string; prompt: string; profile?: StyleProfileSnapshot };
};

export function projectVisualTaskAssetId(task: Pick<GenerationTask, "clientContext">) {
    const nodeId = task.clientContext?.nodeId || "";
    return nodeId.startsWith("project-asset-image:") ? nodeId.slice("project-asset-image:".length) : "";
}

export function projectVisualImageRequest({ projectId, asset, config, projectStyle }: VisualImageInput): Parameters<typeof runBackendCanvasGenerationTask>[0] {
    if (!projectId.trim()) throw new Error("缺少项目标识");
    if (!asset.id || !asset.primaryVersionId) throw new Error("缺少资产或版本标识，请刷新");
    if (asset.category !== "environment" && asset.category !== "prop") throw new Error("请选择场景或道具");
    if (!asset.visual) throw new Error("资产设定未加载，请刷新");
    const prompt = typeof asset.visual.definition.prompt === "string" ? asset.visual.definition.prompt.trim() : "";
    if (!prompt) throw new Error("资产缺少生图提示词，请重新提取");
    const description = typeof asset.visual.definition.description === "string" ? asset.visual.definition.description.trim() : "";
    const generationConfig = { ...config, model: config.imageModel || config.model, count: "1" };
    const requestConfig = resolveModelRequestConfig(generationConfig, generationConfig.model);
    const styleExecutionPlan = projectStyle?.profile ? resolveStyleExecutionPlan(projectStyle.profile, { mode: "image", model: requestConfig.model, interfaceType: requestConfig.interfaceType || requestConfig.apiFormat }) : undefined;
    if (styleExecutionPlan?.status === "blocked" && !logicalModelIDForConfig(generationConfig)) throw new Error(`当前图片模型无法完整执行项目画风：${styleExecutionPlan.warnings.join("；")}。请切换图片模型，或在项目设置中停用对应画风资产`);
    return {
        projectId,
        nodeId: `project-asset-image:${asset.id}`,
        mode: "image",
        prompt: [
            `${asset.category === "environment" ? "场景" : "道具"}参考图：${asset.title}`,
            description,
            prompt,
            asset.category === "environment" ? "展示场景的空间布局、建筑、材质与光照，不出现人物，便于后续分镜保持场景一致。" : "完整展示单个道具主体的形状、材质与纹理，背景简洁，不出现人物，不添加无关物品。",
            projectStyle?.prompt ? `项目画风（必须遵循）：\n${projectStyle.prompt}` : "",
        ]
            .filter(Boolean)
            .join("\n\n"),
        config: generationConfig,
        metadata: {
            operation: "project_asset_image",
            domainProjectId: projectId,
            projectAssetId: asset.id,
            projectAssetVersionId: asset.primaryVersionId,
            stylePresetId: projectStyle?.id,
            styleProfileJson: projectStyle?.profile ? serializeStyleProfile(projectStyle.profile) : undefined,
            styleExecutionPlan,
        },
    };
}

export async function generateProjectVisualImage(input: VisualImageInput) {
    const result = await runBackendCanvasGenerationTask(projectVisualImageRequest(input));
    if (result.projectAssetImageStatus === "stale") throw new Error("图片已生成并保留在任务结果中，但资产版本已变化，未覆盖当前图片；请从任务结果选择图片重新绑定");
    if (result.projectAssetImageStatus !== "bound") throw new Error("图片尚未绑定到资产，请在任务中心检查结果");
}
