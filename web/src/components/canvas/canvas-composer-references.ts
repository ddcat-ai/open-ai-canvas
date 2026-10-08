import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { generationInputMentionLabel, type NodeGenerationInput } from "./canvas-node-generation";

export function composerReferences(inputs: NodeGenerationInput[], skills: CanvasResourceReference[]): CanvasResourceReference[] {
    const media = inputs.map((input): CanvasResourceReference => {
        const label = generationInputMentionLabel(input, inputs);
        return {
            id: `composer:${input.nodeId}`,
            nodeId: input.nodeId,
            kind: input.type,
            label,
            mentionToken: `@${label}`,
            title: input.title,
            active: true,
            text: input.text,
            previewUrl: input.sourceKind === "drawing" ? undefined : input.image?.dataUrl || input.previewUrl,
        };
    });
    return [...skills.map((skill) => ({ ...skill, active: true, mentionToken: `@${skill.label}` })), ...media];
}

export function insertComposerPreset(value: string, start: number, end: number, prompt: string): { text: string; caret: number } {
    const from = Math.max(0, Math.min(value.length, start));
    const to = Math.max(from, Math.min(value.length, end));
    const prefix = value.slice(0, from).replace(/(^|\s)\/[\p{L}\p{N}_-]*$/u, "$1");
    const insertion = `${prompt} `;
    return { text: prefix + insertion + value.slice(to), caret: prefix.length + insertion.length };
}
