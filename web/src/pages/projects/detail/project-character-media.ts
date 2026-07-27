import { runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { uploadImage } from "@/services/image-storage";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import type { AiConfig } from "@/stores/use-config-store";

export async function generateCharacterTurnaround(input: { projectId: string; assetId: string; versionId: string; name: string; definition: Record<string, unknown>; config: AiConfig }) {
    const prompt = characterTurnaroundPrompt(input.name, input.definition);
    const result = await runBackendCanvasGenerationTask({
        projectId: input.projectId,
        nodeId: `character-turnaround:${input.assetId}`,
        mode: "image",
        prompt,
        config: { ...input.config, model: input.config.imageModel || input.config.model, count: "1" },
        metadata: { operation: "character_turnaround", characterAssetId: input.assetId, resolvedCharacterVersions: [{ assetId: input.assetId, versionId: input.versionId }] },
    });
    const image = result.images?.[0];
    if (!image?.dataUrl) throw new Error("三视图任务没有返回图片");
    const sheet = image.storageKey
        ? { url: image.dataUrl, storageKey: image.storageKey }
        : await uploadImage(image.dataUrl);
    const sheetResourceId = resourceIdFromStorageKey(sheet.storageKey);
    if (!sheetResourceId) throw new Error("三视图原图尚未保存到后端资源库");
    return [
        { role: "turnaround_sheet", resourceId: sheetResourceId, metadata: { prompt } },
        { role: "primary", resourceId: sheetResourceId, metadata: { source: "turnaround_sheet" } },
    ];
}

export function characterTurnaroundPrompt(name: string, definition: Record<string, unknown>) {
    const visual = [definition.role, definition.appearance, definition.physique, definition.clothing, definition.personality, definition.props, definition.consistencyPrompt, definition.multiViewPrompt]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("；");
    if (!visual) throw new Error("请先填写剧情定位、角色外貌、体型或服装，再初始化三视图");
    return [
        `为角色“${name}”制作专业人物三视图设定表。`,
        "画面严格分成三个等宽竖向区域，从左到右依次为正面全身、右侧面全身、背面全身。",
        "三个视角必须是同一个人、同一服装、同一发型、同一体型和同一比例，站立中性姿势，完整显示头顶到脚底。",
        "纯净浅灰背景，均匀棚拍光线，不添加文字、边框、道具说明、表情变化或额外人物。",
        `角色设定：${visual}`,
    ].join("\n");
}
