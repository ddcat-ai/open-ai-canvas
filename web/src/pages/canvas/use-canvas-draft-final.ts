import { useCallback } from "react";
import { App } from "antd";
import type { Dispatch, SetStateAction } from "react";

import { isGenerationTaskCancelled } from "@/services/api/generation-task";
import { useEffectiveConfig } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { GenerationTask } from "@/services/api/task-center";

import { executeDraftFinalVideoGeneration } from "./canvas-media-generation-executors";

type UseCanvasDraftFinalOptions = {
    projectId: string;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
    applyGenerationTaskResult: (targetNodeId: string, task: GenerationTask) => Promise<void>;
};

/**
 * 基于样片视频节点生成 1080p 正式视频（Seedance 2.5 样片模式 Step2）。
 * 对话框确认后调用；生成配置复用样片任务的模型与生成模式，仅切换分辨率并携带 draftTaskId。
 */
export function useCanvasDraftFinal({ projectId, setNodes, setConnections, startGenerationRequest, finishGenerationRequest, bindGenerationTask, applyGenerationTaskResult }: UseCanvasDraftFinalOptions) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();

    const submitDraftFinalVideo = useCallback(
        async (draftNode: CanvasNodeData) => {
            const controller = new AbortController();
            try {
                await executeDraftFinalVideoGeneration({
                    projectId,
                    draftNode,
                    controller,
                    config,
                    setNodes,
                    setConnections,
                    startGenerationRequest,
                    finishGenerationRequest,
                    bindGenerationTask,
                    applyGenerationTaskResult,
                });
            } catch (error) {
                if (isGenerationTaskCancelled(error, controller.signal)) return;
                message.error(error instanceof Error ? error.message : "生成正式视频失败，请稍后重试");
            }
        },
        [projectId, config, setNodes, setConnections, startGenerationRequest, finishGenerationRequest, bindGenerationTask, applyGenerationTaskResult, message],
    );

    return { submitDraftFinalVideo };
}
