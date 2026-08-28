import { canonicalize } from "json-canonicalize";

import type { NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { generationPromptFingerprint } from "@/lib/generation-error";

type GenerationReference = NodeGenerationContext["referenceImages"][number] | NodeGenerationContext["referenceVideos"][number] | NodeGenerationContext["referenceAudios"][number];

export type CanvasGenerationRequestFingerprintInput = {
    nodeId: string;
    mode: CanvasNodeGenerationMode;
    prompt: string;
    model: string;
    options: Record<string, unknown>;
    workflow?: {
        provider?: string;
        workflowId?: string;
        workflowKind?: string;
        parameters?: Record<string, unknown>;
    };
    operation?: string;
    audioInstructions?: string;
    promptTemplateOperation?: string;
    promptTemplateVariables?: Record<string, string>;
    context: Pick<NodeGenerationContext, "referenceImages" | "referenceVideos" | "referenceAudios" | "characterReferences" | "resolvedCharacterVersions" | "resolvedCharacterVoices">;
};

export function canvasGenerationRequestFingerprint(input: CanvasGenerationRequestFingerprintInput) {
    const serialized = canonicalize({
        version: 1,
        nodeId: input.nodeId,
        mode: input.mode,
        prompt: input.prompt.trim(),
        model: input.model,
        options: input.options,
        workflow: input.workflow,
        operation: input.operation,
        audioInstructions: input.audioInstructions,
        promptTemplateOperation: input.promptTemplateOperation,
        promptTemplateVariables: input.promptTemplateVariables,
        references: {
            images: input.context.referenceImages.map(referenceIdentity),
            videos: input.context.referenceVideos.map(referenceIdentity),
            audios: input.context.referenceAudios.map(referenceIdentity),
            characters: input.context.characterReferences,
            resolvedCharacterVersions: input.context.resolvedCharacterVersions,
            resolvedCharacterVoices: input.context.resolvedCharacterVoices,
        },
    });
    return `canvas-generation:v1:${generationPromptFingerprint(serialized)}`;
}

function referenceIdentity(reference: GenerationReference) {
    const source = "storageKey" in reference && reference.storageKey ? reference.storageKey : "url" in reference && reference.url ? reference.url : "dataUrl" in reference ? reference.dataUrl : "";
    return {
        id: reference.id,
        name: reference.name,
        type: reference.type,
        source: source.startsWith("data:") ? `data:${generationPromptFingerprint(source)}` : source,
        derivedSource: "source" in reference ? reference.source : undefined,
        durationMs: "durationMs" in reference ? reference.durationMs : undefined,
    };
}

export function runCanvasGenerationSubmissionOnce<T>(locks: Map<string, Promise<unknown>>, nodeId: string, operation: () => Promise<T>, onDuplicate?: () => void): Promise<T> {
    const existing = locks.get(nodeId) as Promise<T> | undefined;
    if (existing) {
        onDuplicate?.();
        return existing;
    }
    const running = Promise.resolve()
        .then(operation)
        .finally(() => {
            if (locks.get(nodeId) === running) locks.delete(nodeId);
        });
    locks.set(nodeId, running);
    return running;
}
