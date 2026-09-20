import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { synchronizeGenerationSpec } from "@/lib/canvas/generation-contract";

export type WriteCanvasNodePromptOptions = {
    metadata?: CanvasNodeMetadata;
    clearPromptTemplate?: boolean;
};

/**
 * A generated or authored result is committed once the node registry exposes it
 * as a resource. Text-like resources additionally require persisted content so
 * a draft prompt alone is not mistaken for a submitted result.
 */
export function canvasNodeHasCommittedContent(node: CanvasNodeData) {
    const resourceKind = getNodeResourceKind(node);
    if (resourceKind === "text") return Boolean(node.metadata?.content?.trim());
    return resourceKind !== null;
}

/**
 * Update the editable prompt draft without replacing the prompt snapshot that
 * produced an existing result. Callers may provide sanitized task metadata,
 * but prompt ownership remains centralized here.
 */
export function writeCanvasNodePrompt(node: CanvasNodeData, prompt: string, options: WriteCanvasNodePromptOptions = {}) {
    const metadata = options.metadata ?? node.metadata;
    const clearPromptTemplate = options.clearPromptTemplate ?? Boolean(metadata?.promptTemplateOperation);
    const promptTemplateMetadata = clearPromptTemplate
        ? { promptTemplateOperation: undefined, promptTemplateVariables: undefined }
        : {};
    // Pass prompt fields through the patch so synchronizeGenerationSpec can
    // propagate composerContent/prompt into generationSpec.prompt and keep the
    // canonical contract in sync with the editable draft.
    const promptPatch = canvasNodeHasCommittedContent(node)
        ? { composerContent: prompt }
        : { prompt, composerContent: prompt };
    return synchronizeGenerationSpec({ ...node, metadata: { ...metadata, ...promptTemplateMetadata } }, promptPatch);
}
