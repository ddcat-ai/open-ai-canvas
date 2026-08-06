import { buildSkillMentionReferences, renderSkillPrompt } from "@/lib/canvas/canvas-skill-mentions";
import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Skill } from "@/services/api/skills";
import type { CreationAttachment } from "./creation-assets";

export type CreationReference = CanvasResourceReference & {
    attachmentId?: string;
};

export function buildCreationMentionReferences(skills: Skill[], attachments: CreationAttachment[] = [], snapshots: CreationReference[] = []) {
    const attachmentReferences = attachments.map(attachmentReference);
    const skillReferences = buildSkillMentionReferences(skills) as CreationReference[];
    const current = [...attachmentReferences, ...skillReferences];
    const currentIDs = new Set(current.map((reference) => reference.id));
    const restored = snapshots.filter((reference) => reference.kind === "skill" && !currentIDs.has(reference.id));
    return [...current, ...restored].map((reference) => ({ ...reference, active: true }));
}

export function selectedCreationReferences(prompt: string, references: CreationReference[]) {
    return references.filter((reference) => prompt.includes(canvasResourceMentionToken(reference)));
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
        if (reference.kind === "skill" && reference.skill) {
            contexts.push(renderSkillPrompt(reference.skill));
            return;
        }
        if (reference.attachmentId) {
            const position = attachmentPositions.get(reference.attachmentId);
            mediaMappings.push(`- @${reference.label}：参考${reference.kind === "video" ? "视频" : "图片"} ${position || 1}`);
            return;
        }
    });

    if (mediaMappings.length) contexts.push(`【资源对应关系】\n${mediaMappings.join("\n")}`);
    return [...contexts, `【创作要求】\n${visiblePrompt}`].filter(Boolean).join("\n\n");
}

export function creationReferenceMetadata(references: CreationReference[]) {
    return {
        skillIds: references.flatMap((reference) => reference.skill?.skill_id ? [reference.skill.skill_id] : []),
    };
}

function attachmentReference(attachment: CreationAttachment, index: number): CreationReference {
    const isVideo = attachment.type.startsWith("video/");
    return {
        id: `upload:${attachment.id}`,
        nodeId: `upload:${attachment.id}`,
        kind: isVideo ? "video" : "image",
        label: `${isVideo ? "视频" : "图片"}${index + 1}`,
        title: "当前参考内容",
        previewUrl: attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url),
        storageKey: attachment.storageKey,
        active: true,
        attachmentId: attachment.id,
    };
}
