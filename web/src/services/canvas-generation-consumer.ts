import type { Dispatch, SetStateAction } from "react";

import { applyMaterializedGenerationTaskResultToNodes } from "@/lib/canvas/canvas-generation-task-sync";
import type { GenerationTask, GenerationTaskOutput } from "@/services/api/task-center";
import { generationEffectApplied } from "@/services/generation-consumer-dedupe";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData } from "@/types/canvas";

export async function applyCanvasGenerationTaskNodeEffect(input: {
    projectId: string;
    nodeId: string;
    task: GenerationTask;
    output: GenerationTaskOutput;
    effectKey: string;
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
}) {
    const applied = await applyMaterializedGenerationTaskResultToNodes(input.nodesRef.current, input.task, input.output, input.effectKey, input.nodeId);
    if (!applied.updated || !applied.node) throw new Error("画布中找不到对应任务节点");
    input.nodesRef.current = applied.nodes;
    input.setNodes(applied.nodes);
    await persistCanvasGenerationEffect({
        projectId: input.projectId,
        effectKey: input.effectKey,
        nodes: applied.nodes,
    });
}

export async function persistCanvasGenerationEffect(input: { projectId: string; effectKey: string; nodes?: CanvasNodeData[]; connections?: CanvasConnection[]; chatSessions?: CanvasAssistantSession[]; activeChatId?: string | null }) {
    const stamped = input.nodes?.some((node) => generationEffectApplied(node.metadata || {}, input.effectKey)) || input.chatSessions?.some((session) => generationEffectApplied(session, input.effectKey));
    if (!stamped) throw new Error("生成副作用缺少持久幂等标记");
    const project = useCanvasStore.getState().projects.find((candidate) => candidate.id === input.projectId);
    if (!project) throw new Error("画布项目不存在，无法持久化生成副作用");
    useCanvasStore.getState().updateProject(input.projectId, {
        ...(input.nodes ? { nodes: input.nodes } : {}),
        ...(input.connections ? { connections: input.connections } : {}),
        ...(input.chatSessions ? { chatSessions: input.chatSessions } : {}),
        ...(input.activeChatId !== undefined ? { activeChatId: input.activeChatId } : {}),
    });
    await flushCanvasStorePersistence();
}
