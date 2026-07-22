import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import { getDataUrlByteSize } from "@/lib/image-utils";
import { applyGenerationTaskResultToNodes, generationTaskNodeId } from "@/lib/canvas/canvas-generation-task-sync";
import { useAssetStore } from "@/stores/use-asset-store";
import { cancelGenerationTask, listGenerationTasks, listTaskLogs, queryGenerationTask, waitForGenerationTask, type GenerationTask, type TaskLog } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { cinematicStoryboardColumns, storyboardRowsFromTask } from "@/lib/canvas/canvas-project-domain";
import { generationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { generationFailureMetadata } from "@/lib/generation-error";

type CanvasGenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    controller: AbortController;
};

type UseCanvasGenerationOptions = {
    projectId: string;
    projectLoaded: boolean;
    nodes: CanvasNodeData[];
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
};

const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

export function useCanvasGeneration({ projectId, projectLoaded, nodes, nodesRef, setNodes }: UseCanvasGenerationOptions) {
    const { message, modal } = App.useApp();
    const addAsset = useAssetStore((state) => state.addAsset);
    const generationRequestsRef = useRef(new Map<string, CanvasGenerationRequest>());
    const recoveringTaskIdsRef = useRef(new Set<string>());
    const autoSavedTaskIdsRef = useRef(new Set<string>());
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [taskDetail, setTaskDetail] = useState<GenerationTask | null>(null);
    const [taskDetailLogs, setTaskDetailLogs] = useState<TaskLog[]>([]);
    const [taskDetailLoading, setTaskDetailLoading] = useState(false);

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((current) => current.map((node) => affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node));
    }, [setNodes]);

    const confirmStopGeneration = useCallback((nodeId: string) => {
        modal.confirm({
            title: "停止生成？",
            content: "当前生成请求会被中断，已经生成完成的内容会保留。",
            okText: "停止",
            cancelText: "继续生成",
            okButtonProps: { danger: true },
            onOk: () => stopGenerationByRunningId(nodeId),
        });
    }, [modal, stopGenerationByRunningId]);

    const cancelNodeTask = useCallback((node: CanvasNodeData) => {
        const taskId = node.metadata?.taskId;
        if (!taskId) {
            confirmStopGeneration(node.id);
            return;
        }
        modal.confirm({
            title: "取消后台任务？",
            content: "任务会在后端停止，已生成完成的内容仍会保留。",
            okText: "取消任务",
            cancelText: "继续生成",
            okButtonProps: { danger: true },
            onOk: async () => {
                generationRequestsRef.current.get(node.id)?.controller.abort();
                const task = await cancelGenerationTask(taskId);
                setNodes((current) => current.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, ...generationTaskMetadata(task), status: NODE_STATUS_ERROR, errorDetails: "任务已取消" } } : item));
                message.success("任务已取消");
            },
        });
    }, [confirmStopGeneration, message, modal, setNodes]);

    const openNodeTaskDetails = useCallback(async (node: CanvasNodeData) => {
        const taskId = node.metadata?.taskId;
        if (!taskId) return;
        setTaskDetailLoading(true);
        setTaskDetailLogs([]);
        setTaskDetail({
            id: taskId,
            type: "",
            status: (node.metadata?.taskStatus as GenerationTask["status"]) || "running",
            stage: node.metadata?.taskStage,
            progress: node.metadata?.taskProgress,
            prompt: node.metadata?.prompt || "",
            attempts: 1,
            createdAt: node.metadata?.taskCreatedAt || new Date().toISOString(),
            updatedAt: node.metadata?.taskUpdatedAt || new Date().toISOString(),
        });
        try {
            const [task, logs] = await Promise.all([queryGenerationTask(taskId), listTaskLogs(taskId)]);
            setTaskDetail(task);
            setTaskDetailLogs(logs);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务详情加载失败");
        } finally {
            setTaskDetailLoading(false);
        }
    }, [message]);

    const bindGenerationTask = useCallback((targetNodeId: string, task: GenerationTask) => {
        setNodes((current) => current.map((node) => {
            if (node.id !== targetNodeId) return node;
            const failed = task.status === "failed" || task.status === "cancelled";
            const hasCompletedContent = task.status === "succeeded" && Boolean(node.metadata?.content);
            const failure = failed
                ? generationFailureMetadata(task.error || (task.status === "cancelled" ? "任务已取消" : "任务失败"), node.metadata?.composerContent || node.metadata?.prompt || task.prompt || "")
                : undefined;
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    ...generationTaskMetadata(task),
                    status: failed ? NODE_STATUS_ERROR : hasCompletedContent ? NODE_STATUS_SUCCESS : NODE_STATUS_LOADING,
                    ...(failure || { errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined }),
                },
            };
        }));
    }, [setNodes]);

    const addGeneratedAsset = useCallback((node: CanvasNodeData, taskId: string) => {
        if (!node.metadata?.content || node.metadata.status !== NODE_STATUS_SUCCESS) return;
        const exists = useAssetStore.getState().assets.some((asset) => asset.metadata?.taskId === taskId || (asset.metadata?.source === "canvas-generation" && asset.metadata?.nodeId === node.id));
        if (exists) return;
        if (node.type === CanvasNodeType.Image) {
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            addAsset({
                kind: "image",
                title: node.metadata.prompt?.slice(0, 24) || node.title || "画布图片",
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: { dataUrl, storageKey: node.metadata.storageKey, width: node.metadata.naturalWidth || node.width, height: node.metadata.naturalHeight || node.height, bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl), mimeType: node.metadata.mimeType || "image/png" },
                metadata: { source: "canvas-generation", nodeId: node.id, taskId, prompt: node.metadata.prompt },
            });
            return;
        }
        if (node.type === CanvasNodeType.Video) {
            addAsset({
                kind: "video",
                title: node.metadata.prompt?.slice(0, 24) || node.title || "画布视频",
                coverUrl: "",
                tags: [],
                source: "Canvas",
                data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.metadata.naturalWidth || node.width, height: node.metadata.naturalHeight || node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                metadata: { source: "canvas-generation", nodeId: node.id, taskId, prompt: node.metadata.prompt },
            });
        }
    }, [addAsset]);

    const applyGenerationTaskResult = useCallback(async (nodeId: string, task: GenerationTask) => {
        const applied = await applyGenerationTaskResultToNodes(nodesRef.current, task, nodeId);
        if (!applied.updated || !applied.node) throw new Error("画布中找不到对应任务节点");
        setNodes((current) => current.map((node) => node.id === applied.nodeId ? applied.node! : node));
    }, [nodesRef, setNodes]);

    const recoverInterruptedGenerationTasks = useCallback(async () => {
        const recoveryNodes = nodesRef.current.filter((node) => node.metadata?.status === NODE_STATUS_LOADING || node.metadata?.errorDetails === "页面刷新后生成已中断，请重新生成。" || Boolean(node.metadata?.taskId && node.metadata.status !== NODE_STATUS_SUCCESS));
        if (!recoveryNodes.length) return;
        const taskIds = Array.from(new Set(recoveryNodes.map((node) => node.metadata?.taskId).filter((id): id is string => Boolean(id))));
        const tasks = (await Promise.all(taskIds.map((id) => queryGenerationTask(id).catch(() => undefined)))).filter((task): task is GenerationTask => Boolean(task));
        if (recoveryNodes.some((node) => !node.metadata?.taskId)) {
            const recentTasks = await listGenerationTasks(30).catch(() => []);
            tasks.push(...recentTasks.filter((task) => !tasks.some((item) => item.id === task.id)));
        }
        const projectTasks = tasks.filter((task) => task.projectId === projectId && (task.type.startsWith("canvas_") || task.type === "agent_storyboard_rows"));
        await Promise.all(recoveryNodes.map(async (node) => {
            let task = projectTasks.find((item) => item.id === node.metadata?.taskId) || projectTasks.find((item) => generationTaskNodeId(item) === node.id);
            if (!task && node.metadata?.taskId) task = await queryGenerationTask(node.metadata.taskId).catch(() => undefined);
            if (!task) {
                setNodes((current) => current.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "页面刷新后找不到对应任务，请重新生成。" } } : item));
                return;
            }
            if (recoveringTaskIdsRef.current.has(task.id)) return;
            recoveringTaskIdsRef.current.add(task.id);
            bindGenerationTask(node.id, task);
            try {
                const completed = task.status === "succeeded" ? task : await waitForGenerationTask(task.id, { initialTask: task });
                if (node.type === CanvasNodeType.Script && completed.type === "agent_storyboard_rows") {
                    const result = storyboardRowsFromTask(completed);
                    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, title: result.title || item.title, metadata: { ...item.metadata, ...generationTaskMetadata(completed), status: NODE_STATUS_SUCCESS, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined, storyboard: { rows: result.rows, visibleColumns: cinematicStoryboardColumns(item.metadata?.storyboard?.visibleColumns), referenceNodeIds: item.metadata?.storyboard?.referenceNodeIds || [] } } } : item));
                } else {
                    await applyGenerationTaskResult(node.id, completed);
                }
            } catch (error) {
                const failure = generationFailureMetadata(error, node.metadata?.composerContent || node.metadata?.prompt || task.prompt || "");
                setNodes((current) => current.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, ...failure } } : item));
            } finally {
                recoveringTaskIdsRef.current.delete(task.id);
            }
        }));
    }, [applyGenerationTaskResult, bindGenerationTask, nodesRef, projectId, setNodes]);

    useEffect(() => {
        if (!projectLoaded) return;
        void recoverInterruptedGenerationTasks();
    }, [projectLoaded, recoverInterruptedGenerationTasks]);

    useEffect(() => {
        if (!projectLoaded) return;
        nodes.forEach((node) => {
            const taskId = node.metadata?.taskId;
            if (!taskId || !node.metadata?.content || node.metadata.status !== NODE_STATUS_SUCCESS || (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video)) return;
            const saveKey = `${taskId}:${node.id}`;
            if (autoSavedTaskIdsRef.current.has(saveKey)) return;
            autoSavedTaskIdsRef.current.add(saveKey);
            addGeneratedAsset(node, taskId);
        });
    }, [addGeneratedAsset, nodes, projectLoaded]);

    return {
        bindGenerationTask,
        cancelNodeTask,
        confirmStopGeneration,
        finishGenerationRequest,
        openNodeTaskDetails,
        runningNodeId,
        setRunningNodeId,
        setTaskDetail,
        startGenerationRequest,
        taskDetail,
        taskDetailLoading,
        taskDetailLogs,
    };
}
