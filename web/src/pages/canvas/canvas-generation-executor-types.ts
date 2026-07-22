import type { Dispatch, SetStateAction } from "react";

import type { NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasGenerationExecutorDependencies = {
    projectId: string;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
    showError: (content: string) => void;
};

export type CanvasGenerationExecution = CanvasGenerationExecutorDependencies & {
    nodeId: string;
    sourceNode: CanvasNodeData | undefined;
    prompt: string;
    effectivePrompt: string;
    generationConfig: AiConfig;
    generationContext: NodeGenerationContext;
    controller: AbortController;
    editingTextNode: boolean;
    registerPendingNodeIds: (nodeIds: string[]) => void;
};
