import { buildSkillMentionReferences, renderSkillPrompt } from "@/lib/canvas/canvas-skill-mentions";
import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Skill } from "@/services/api/skills";
import type { Asset } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type CreationMode = "text" | "image" | "video";
type MentionableAsset = Extract<Asset, { kind: "text" | "image" | "video" | "audio" }>;

export type CreationReference = CanvasResourceReference & {
    asset?: MentionableAsset;
    attachmentId?: string;
};

export function buildCreationMentionReferences(assets: Asset[], skills: Skill[], mode: CreationMode, attachments: ReferenceImage[] = [], snapshots: CreationReference[] = []) {
    const attachmentReferences = attachments.map(attachmentReference);
    const assetReferences = assets
        .filter((asset): asset is MentionableAsset => isMentionableAsset(asset) && supportsMode(asset.kind, mode))
        .map(assetReference);
    const skillReferences = buildSkillMentionReferences(skills) as CreationReference[];
    const current = [...attachmentReferences, ...assetReferences, ...skillReferences];
    const currentIDs = new Set(current.map((reference) => reference.id));
    return [...current, ...snapshots.filter((reference) => !currentIDs.has(reference.id))].map((reference) => ({ ...reference, active: true }));
}

export function selectedCreationReferences(prompt: string, references: CreationReference[]) {
    return references.filter((reference) => prompt.includes(canvasResourceMentionToken(reference)));
}

export function displayCreationPrompt(prompt: string, references: CreationReference[]) {
    return references.reduce((value, reference) => value.split(canvasResourceMentionToken(reference)).join(`@${reference.label}`), prompt);
}

export function expandCreationPrompt(prompt: string, references: CreationReference[], attachments: ReferenceImage[] = []) {
    const visiblePrompt = displayCreationPrompt(prompt, references).trim();
    if (!references.length) return visiblePrompt;

    const contexts: string[] = [];
    const mediaMappings: string[] = [];
    const attachmentPositions = new Map(attachments.map((attachment, index) => [attachment.id, index + 1]));
    const counts = { image: attachments.length, video: 0, audio: 0 };
    references.forEach((reference) => {
        if (reference.kind === "skill" && reference.skill) {
            contexts.push(renderSkillPrompt(reference.skill));
            return;
        }
        if (reference.attachmentId) {
            const position = attachmentPositions.get(reference.attachmentId);
            mediaMappings.push(`- @${reference.label}：参考图片 ${position || 1}`);
            return;
        }
        const asset = reference.asset;
        if (!asset) return;
        if (asset.kind === "text") {
            contexts.push(`【引用资源：${reference.label}】\n${asset.data.content}`);
            return;
        }
        counts[asset.kind] += 1;
        const label = asset.kind === "image" ? "参考图片" : asset.kind === "video" ? "参考视频" : "参考音频";
        mediaMappings.push(`- @${reference.label}：${label} ${counts[asset.kind]}`);
    });

    if (mediaMappings.length) contexts.push(`【资源对应关系】\n${mediaMappings.join("\n")}`);
    return [...contexts, `【创作要求】\n${visiblePrompt}`].filter(Boolean).join("\n\n");
}

export function creationReferenceImages(references: CreationReference[]): ReferenceImage[] {
    return references.flatMap((reference) => {
        const asset = reference.asset;
        if (!asset || asset.kind !== "image") return [];
        return [{
            id: asset.id,
            name: asset.title,
            type: asset.data.mimeType || "image/png",
            dataUrl: asset.data.dataUrl,
            url: asset.data.dataUrl,
            storageKey: asset.data.storageKey,
        }];
    });
}

export function creationReferenceVideos(references: CreationReference[]): ReferenceVideo[] {
    return references.flatMap((reference) => {
        const asset = reference.asset;
        if (!asset || asset.kind !== "video") return [];
        return [{
            id: asset.id,
            name: asset.title,
            type: asset.data.mimeType || "video/mp4",
            url: asset.data.url,
            storageKey: asset.data.storageKey,
            bytes: asset.data.bytes,
            width: asset.data.width,
            height: asset.data.height,
            durationMs: asset.data.durationMs,
        }];
    });
}

export function creationReferenceAudios(references: CreationReference[]): ReferenceAudio[] {
    return references.flatMap((reference) => {
        const asset = reference.asset;
        if (!asset || asset.kind !== "audio") return [];
        return [{
            id: asset.id,
            name: asset.title,
            type: asset.data.mimeType || "audio/mpeg",
            url: asset.data.url,
            storageKey: asset.data.storageKey,
            durationMs: asset.data.durationMs,
        }];
    });
}

export function creationReferenceMetadata(references: CreationReference[]) {
    return {
        assetIds: references.flatMap((reference) => reference.asset ? [reference.asset.id] : []),
        skillIds: references.flatMap((reference) => reference.skill?.skill_id ? [reference.skill.skill_id] : []),
    };
}

function assetReference(asset: MentionableAsset): CreationReference {
    const kindLabel = asset.kind === "image" ? "图片资源" : asset.kind === "video" ? "视频资源" : asset.kind === "audio" ? "音频资源" : "文本资源";
    const previewUrl = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" ? asset.data.url : "");
    return {
        id: `asset:${asset.id}`,
        nodeId: `asset:${asset.id}`,
        kind: asset.kind,
        label: asset.title.trim() || kindLabel,
        title: kindLabel,
        previewUrl: previewUrl || undefined,
        storageKey: asset.kind === "text" ? undefined : asset.data.storageKey,
        text: asset.kind === "text" ? asset.data.content : undefined,
        active: true,
        asset,
    };
}

function attachmentReference(attachment: ReferenceImage, index: number): CreationReference {
    const label = attachment.name.replace(/\.[^.]+$/, "").trim() || `上传图片${index + 1}`;
    return {
        id: `upload:${attachment.id}`,
        nodeId: `upload:${attachment.id}`,
        kind: "image",
        label,
        title: "本次上传",
        previewUrl: attachment.dataUrl || attachment.url,
        storageKey: attachment.storageKey,
        active: true,
        attachmentId: attachment.id,
    };
}

function isMentionableAsset(asset: Asset): asset is MentionableAsset {
    return asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
}

function supportsMode(kind: MentionableAsset["kind"], mode: CreationMode) {
    if (kind === "text" || kind === "image") return true;
    return mode === "video";
}
