import { createClientUUID } from "@/lib/client-id";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { buildCharacterOutfitPersistence, parseCharacterOutfits, type CharacterOutfit } from "@/components/canvas/character-outfits";
import { submitBackendGenerationTask, parseBackendGenerationResult } from "@/services/api/generation-task";
import { getCharacter, replaceCharacterRepresentations, type ProjectCharacterDetail } from "@/services/api/projects";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type DressingSnapshot = {
    characterAssetId: string;
    nodeId: string;
    versionId: string;
    baseOutfitId: string;
    baseResourceId: string;
    extraPrompt: string;
};

export function dressingSnapshot(task: GenerationTask): DressingSnapshot | undefined {
    if (!task.inputJson) return;
    try {
        const input = JSON.parse(task.inputJson);
        const value = input?.metadata?.dressing;
        if (input?.metadata?.source !== "character-dressing-table" || !value || typeof value.characterAssetId !== "string" || typeof value.baseResourceId !== "string") return;
        return value as DressingSnapshot;
    } catch {
        return;
    }
}

export function dressingImages(task: GenerationTask): Array<{ resourceId: string; width?: number; height?: number }> {
    if (task.status !== "succeeded" || !task.resultJson || (task.resultState && task.resultState !== "READY")) return [];
    return (parseBackendGenerationResult(task).images || []).flatMap((image) => {
        const resourceId = resourceIdFromStorageKey(image.storageKey);
        return resourceId ? [{ resourceId, width: image.width, height: image.height }] : [];
    });
}

export function dressingReference(resourceId: string, name: string): ReferenceImage {
    if (!resourceId.trim()) throw new Error("参考图尚未保存为资源");
    return { id: resourceId, name, type: "image/png", dataUrl: "", storageKey: resourceStorageKey(resourceId) };
}

export async function submitCharacterDressing(input: { detail: ProjectCharacterDetail; outfit: CharacterOutfit; nodeId: string; prompt: string; config: AiConfig; operationId?: string }) {
    if (!input.prompt.trim()) throw new Error("请填写需要调整的内容");
    const model = input.config.imageModel || input.config.model;
    const config = { ...input.config, model, imageModel: model, taskWorkflowProvider: "model" as const };
    const capability = modelCapabilityConfigFor(config, model).image;
    if (!capability || capability.references.maxImages < 1) throw new Error("当前模型不支持角色参考图，请选择支持图片参考的模型");
    const snapshot: DressingSnapshot = {
        characterAssetId: input.detail.asset.id,
        nodeId: input.nodeId,
        versionId: input.detail.character.versionId,
        baseOutfitId: input.outfit.id,
        baseResourceId: input.outfit.resourceId,
        extraPrompt: input.prompt.trim(),
    };
    const identity = ["appearance", "physique", "consistencyPrompt"]
        .map((key) => input.detail.character.definition[key])
        .filter((value) => typeof value === "string" && value.trim())
        .join("；");
    return submitBackendGenerationTask({
        mode: "image",
        config,
        prompt: `基础人物：参考图1为${input.detail.asset.title}，保持人物身份与未指定修改的特征。${identity}\n用户补充：${input.prompt.trim()}\n输出该人物的新形象图片，不添加文字或资料卡。`,
        referenceImages: [dressingReference(input.outfit.resourceId, input.detail.asset.title)],
        metadata: { source: "character-dressing-table", characterAssetId: input.detail.asset.id, nodeId: input.nodeId, dressing: snapshot },
        clientOperationId: input.operationId || createClientUUID(),
    });
}

export async function saveCharacterDressing(task: GenerationTask, resourceId: string, name: string, expectedVersionId: string) {
    const snapshot = dressingSnapshot(task);
    if (!snapshot || !dressingImages(task).some((image) => image.resourceId === resourceId)) throw new Error("生成结果尚未就绪或不属于本次任务");
    if (!name.trim()) throw new Error("请为新形象命名");
    const detail = await getCharacter(snapshot.characterAssetId);
    const outfits = parseCharacterOutfits(detail.character.definition, detail.character.representations);
    const alreadySaved = outfits.find((item) => item.source?.taskId === task.id && item.resourceId === resourceId);
    if (alreadySaved) return { detail, outfitId: alreadySaved.id };
    const outfitId = resourceId;
    const next: CharacterOutfit = { id: outfitId, name: name.trim(), resourceId, source: { taskId: task.id, resourceId, snapshot } };
    const payload = buildCharacterOutfitPersistence(detail.character.definition, [...outfits, next], outfitId, detail.character.representations);
    const saved = await replaceCharacterRepresentations(detail.asset.id, payload.representations, payload.definition, { expectedVersionId, operationId: `dressing:${task.id}:${resourceId}` });
    return { detail: saved, outfitId };
}
