import { buildSkillMentionReferences } from "@/services/skill-runtime";
import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Skill } from "@/services/api/skills";
import { creationAttachmentKind, type CreationAttachment } from "./creation-assets";

export type CreationReference = CanvasResourceReference & {
    attachmentId?: string;
};

export function buildCreationMentionReferences(skills: Skill[], attachments: CreationAttachment[] = [], snapshots: CreationReference[] = []) {
    const counts = { image: 0, video: 0, audio: 0, file: 0 };
    const attachmentReferences = attachments.map((attachment) => {
        const kind = creationAttachmentKind(attachment);
        return attachmentReference(attachment, counts[kind]++);
    });
    const skillReferences = buildSkillMentionReferences(skills) as CreationReference[];
    const current = [...attachmentReferences, ...skillReferences];
    const currentIDs = new Set(current.map((reference) => reference.id));
    const restored = snapshots.filter((reference) => reference.kind === "skill" && !currentIDs.has(reference.id));
    return [...current, ...restored].map((reference) => ({ ...reference, active: true }));
}

export function selectedCreationReferences(prompt: string, references: CreationReference[]) {
    return references.filter((reference) => prompt.includes(canvasResourceMentionToken(reference)) || prompt.includes(`@${reference.label}`));
}

export function reconcileCreationAttachmentLimit(attachments: CreationAttachment[], references: CreationReference[], maxReferences: number) {
    const limit = Math.max(0, Math.floor(maxReferences));
    if (attachments.length <= limit) return { attachments, removedReferences: [] as CreationReference[] };

    const nextAttachments = attachments.slice(0, limit);
    const removedAttachmentIds = new Set(attachments.slice(limit).map((attachment) => attachment.id));
    const removedReferences = references.filter((reference) => reference.attachmentId && removedAttachmentIds.has(reference.attachmentId));
    return { attachments: nextAttachments, removedReferences };
}

export function removeCreationReferenceTokens(value: string, references: CreationReference[]) {
    return references.reduce((current, reference) => current.split(canvasResourceMentionToken(reference)).join("").split(`@${reference.label}`).join(""), value);
}

export function replaceCreationAttachmentReference(prompt: string, attachments: CreationAttachment[], targetAttachmentId: string, replacement: CreationAttachment) {
    const targetIndex = attachments.findIndex((attachment) => attachment.id === targetAttachmentId);
    if (targetIndex < 0) throw new Error("要替换的参考内容不存在");
    if (replacement.id === targetAttachmentId) return { prompt, attachments };

    const currentReferences = buildCreationMentionReferences([], attachments);
    const targetReference = currentReferences.find((reference) => reference.attachmentId === targetAttachmentId);
    if (!targetReference) throw new Error("要替换的提示词引用不存在");

    const remainingAttachments = attachments.filter((attachment) => attachment.id !== targetAttachmentId && attachment.id !== replacement.id);
    const insertionIndex = Math.min(targetIndex, remainingAttachments.length);
    const nextAttachments = [
        ...remainingAttachments.slice(0, insertionIndex),
        replacement,
        ...remainingAttachments.slice(insertionIndex),
    ];
    const replacementReference = buildCreationMentionReferences([], nextAttachments).find((reference) => reference.attachmentId === replacement.id);
    if (!replacementReference) throw new Error("替换后的提示词引用无效");

    const targetToken = canvasResourceMentionToken(targetReference);
    const replacementToken = canvasResourceMentionToken(replacementReference);
    const normalizedPrompt = replaceVisibleReferenceLabel(prompt, targetReference.label, replacementToken);
    return {
        prompt: normalizedPrompt.split(targetToken).join(replacementToken),
        attachments: nextAttachments,
    };
}

export function displayCreationPrompt(prompt: string, references: CreationReference[]) {
    return references.reduce((value, reference) => value.split(canvasResourceMentionToken(reference)).join(`@${reference.label}`), prompt);
}

export function expandCreationPrompt(prompt: string, references: CreationReference[], attachments: CreationAttachment[] = []) {
    const visiblePrompt = displayCreationPrompt(prompt, references).trim();
    if (!references.length) return visiblePrompt;

    const contexts: string[] = [];
    const mediaMappings: string[] = [];
    const attachmentPositions = new Map(attachments.map((attachment, index) => [attachment.id, index + 1]));
    references.forEach((reference) => {
        if (reference.attachmentId) {
            const position = attachmentPositions.get(reference.attachmentId);
            const kindLabel = reference.kind === "video" ? "视频" : reference.kind === "audio" ? "音频" : reference.kind === "text" ? "文件" : "图片";
            mediaMappings.push(`- @${reference.label}：参考${kindLabel} ${position || 1}`);
            return;
        }
    });

    if (mediaMappings.length) contexts.push(`【资源对应关系】\n${mediaMappings.join("\n")}`);
    return [...contexts, `【创作要求】\n${visiblePrompt}`].filter(Boolean).join("\n\n");
}

function attachmentReference(attachment: CreationAttachment, index: number): CreationReference {
    const kind = creationAttachmentKind(attachment);
    const label = kind === "video" ? "视频" : kind === "audio" ? "音频" : kind === "file" ? "文件" : "图片";
    return {
        id: `upload:${attachment.id}`,
        nodeId: `upload:${attachment.id}`,
        kind: kind === "file" ? "text" : kind,
        label: `${label}${index + 1}`,
        title: "当前参考内容",
        previewUrl: attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url),
        storageKey: attachment.storageKey,
        active: true,
        attachmentId: attachment.id,
        mentionToken: `@[attachment:${attachment.id}]`,
    };
}

function replaceVisibleReferenceLabel(value: string, label: string, replacementToken: string) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return value.replace(new RegExp(`@${escapedLabel}(?=$|\\s|[,.!?;:，。！？；：、)\\]}】）])`, "gu"), replacementToken);
}
