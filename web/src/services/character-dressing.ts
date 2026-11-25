import { createClientUUID } from "@/lib/client-id";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { buildCharacterOutfitPersistence, parseCharacterOutfits, type CharacterOutfit } from "@/components/canvas/character-outfits";
import { submitBackendGenerationTask, parseBackendGenerationResult } from "@/services/api/generation-task";
import { getCharacter, replaceCharacterRepresentations, type ProjectCharacterDetail } from "@/services/api/projects";
import { resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { Asset } from "@/stores/use-asset-store";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { uploadImage } from "@/services/image-storage";
import { upsertRemoteAsset } from "@/services/api/user-data";
import { loadAssetsForUse } from "@/services/user-data-sync";

export const DRESSING_CATEGORIES = ["clothing", "expression", "pose", "accessory", "hairstyle", "facial_features"] as const;
export type DressingCategory = (typeof DRESSING_CATEGORIES)[number];
export type DressingAssetReference = { category: DressingCategory; resourceId: string; title: string; assetId?: string; officialAssetId?: string; poseItemId?: string; angle?: string };

export type DressingSnapshot = {
    characterAssetId: string;
    nodeId: string;
    versionId: string;
    baseOutfitId: string;
    baseResourceId: string;
    extraPrompt: string;
    references?: DressingAssetReference[];
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

export function buildCharacterDressingInput(input: { detail: ProjectCharacterDetail; outfit: CharacterOutfit; nodeId: string; prompt: string; config: AiConfig; operationId?: string; references?: DressingAssetReference[] }) {
    const references = DRESSING_CATEGORIES.flatMap((category) => {
        const reference = input.references?.find((item) => item.category === category);
        return reference ? [reference] : [];
    });
    if (!input.prompt.trim() && !references.length) throw new Error("请选择参考素材或填写需要调整的内容");
    const model = input.config.imageModel || input.config.model;
    const config = { ...input.config, model, imageModel: model, taskWorkflowProvider: "model" as const };
    const capability = modelCapabilityConfigFor(config, model).image;
    if (!capability || capability.references.maxImages < 1) throw new Error("当前模型不支持角色参考图，请选择支持图片参考的模型");
    const images = [dressingReference(input.outfit.resourceId, input.detail.asset.title)];
    const referencePrompts = references.map((reference) => {
        let index = images.findIndex((image) => image.id === reference.resourceId);
        if (index < 0) {
            images.push(dressingReference(reference.resourceId, reference.title));
            index = images.length - 1;
        }
        return `${ASSET_CATEGORY_LABELS[reference.category]}：使用参考图${index + 1}（${reference.title}）的对应特征；仅改变该类别，不采用其中人物身份。`;
    });
    if (images.length > capability.references.maxImages) throw new Error(`当前模型最多支持 ${capability.references.maxImages} 张参考图，包含基础人物共 ${images.length} 张，请减少素材或更换模型`);
    const snapshot: DressingSnapshot = {
        characterAssetId: input.detail.asset.id,
        nodeId: input.nodeId,
        versionId: input.detail.character.versionId,
        baseOutfitId: input.outfit.id,
        baseResourceId: input.outfit.resourceId,
        extraPrompt: input.prompt.trim(),
        references,
    };
    const identity = ["appearance", "physique", "consistencyPrompt"]
        .map((key) => input.detail.character.definition[key])
        .filter((value) => typeof value === "string" && value.trim())
        .join("；");
    return {
        mode: "image" as const,
        config,
        prompt: `基础人物：参考图1为${input.detail.asset.title}，保持人物身份与未指定修改的特征。${identity}\n${referencePrompts.join("\n")}\n用户补充：${input.prompt.trim()}\n输出该人物的新形象图片，不添加文字或资料卡。`,
        referenceImages: images,
        metadata: { source: "character-dressing-table", characterAssetId: input.detail.asset.id, nodeId: input.nodeId, dressing: snapshot },
        clientOperationId: input.operationId || createClientUUID(),
    };
}

export async function submitCharacterDressing(input: Parameters<typeof buildCharacterDressingInput>[0]) {
    return submitBackendGenerationTask(buildCharacterDressingInput(input));
}

export function dressingAssetReference(asset: Asset, category: DressingCategory): DressingAssetReference {
    if (asset.kind !== "image" || asset.status === "archived") throw new Error("请选择可用图片素材");
    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
    if (!resourceId) throw new Error("素材尚未保存为可访问资源，请先在素材库重新上传");
    const officialAssetId = (asset.data as { officialAssetId?: string }).officialAssetId;
    return { category, title: asset.title, resourceId, assetId: asset.id, ...(officialAssetId ? { officialAssetId } : {}) };
}

export async function uploadDressingAsset(file: File, category: DressingCategory) {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
    const image = await uploadImage(file);
    const now = new Date().toISOString();
    const asset: Asset = {
        id: createClientUUID(),
        kind: "image",
        category,
        status: "confirmed",
        title: file.name.replace(/\.[^.]+$/, "") || "参考图片",
        coverUrl: image.url,
        tags: [],
        source: "梳妆台上传",
        data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
        createdAt: now,
        updatedAt: now,
    };
    await upsertRemoteAsset(asset);
    await loadAssetsForUse([asset.id], { refresh: true });
    return asset;
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
    const clothing = snapshot.references?.find((item) => item.category === "clothing")?.title;
    const next: CharacterOutfit = { id: outfitId, name: name.trim(), resourceId, ...(clothing ? { clothing } : {}), source: { taskId: task.id, resourceId, snapshot } };
    const payload = buildCharacterOutfitPersistence(detail.character.definition, [...outfits, next], outfitId, detail.character.representations);
    const saved = await replaceCharacterRepresentations(detail.asset.id, payload.representations, payload.definition, { expectedVersionId, operationId: `dressing:${task.id}:${resourceId}` });
    return { detail: saved, outfitId };
}
