import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { generationBatchStatus, isGenerationCostUncertainError } from "@/lib/canvas/canvas-generation-batch";
import { buildGenerationConfig, createGenerationRetryContext, generationTaskMetadata, resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { unchangedModeratedPrompt } from "@/lib/generation-error";
import { listGenerationTasks } from "@/services/api/task-center";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasGenerationBatch, CanvasGenerationBatchItem, CanvasGenerationBatchMode, CanvasNodeData } from "@/types/canvas";

import type { CanvasNodeGenerationOptions } from "./use-canvas-generation-executor";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";

const SCHEDULER_INTERVAL_MS = 2_000;
const MAX_BATCH_HISTORY = 20;

type BatchTarget = Pick<CanvasGenerationBatchItem, "rowId" | "nodeId">;

type UseCanvasGenerationBatchesOptions = {
    projectId: string;
    projectLoaded: boolean;
    nodes: CanvasNodeData[];
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    handleGenerateNode: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => Promise<void>;
};

export function useCanvasGenerationBatches({ projectId, projectLoaded, nodes, nodesRef, setNodes, handleGenerateNode }: UseCanvasGenerationBatchesOptions) {
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const activeTaskLimit = useUserStore((state) => state.runtimeLimits.activeTaskLimit);
    const schedulingRef = useRef(false);
    const controllersRef = useRef(new Map<string, AbortController>());

    const updateBatch = useCallback(
        (sourceNodeId: string, batchId: string, updater: (batch: CanvasGenerationBatch) => CanvasGenerationBatch) => {
            setNodes((current) => {
                let changed = false;
                const next = current.map((node) => {
                    if (node.id !== sourceNodeId || !node.metadata?.generationBatches?.length) return node;
                    const batches = node.metadata.generationBatches.map((batch) => {
                        if (batch.id !== batchId) return batch;
                        const updated = updater(batch);
                        if (updated !== batch) changed = true;
                        return updated;
                    });
                    return changed ? { ...node, metadata: { ...node.metadata, generationBatches: batches } } : node;
                });
                return changed ? next : current;
            });
        },
        [setNodes],
    );

    const enqueueGenerationBatch = useCallback(
        (sourceNodeId: string, mode: CanvasGenerationBatchMode, targets: BatchTarget[]) => {
            const sourceNode = nodesRef.current.find((node) => node.id === sourceNodeId);
            if (!sourceNode || !targets.length) return;
            const activeNodeIds = new Set((sourceNode.metadata?.generationBatches || []).flatMap((batch) => batch.items.filter((item) => ["waiting", "submitting", "queued", "running"].includes(item.status)).map((item) => item.nodeId)));
            const availableTargets = targets.filter((target) => !activeNodeIds.has(target.nodeId));
            if (!availableTargets.length) {
                message.info("所选镜头已在生成批次中");
                return;
            }
            const now = new Date().toISOString();
            const batch: CanvasGenerationBatch = {
                id: nanoid(),
                projectId,
                sourceNodeId,
                mode,
                status: "queued",
                items: availableTargets.map((target) => ({ id: nanoid(), ...target, status: "waiting", retryCount: 0 })),
                createdAt: now,
                updatedAt: now,
            };
            setNodes((current) =>
                current.map((node) =>
                    node.id === sourceNodeId
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  generationBatches: [...(node.metadata?.generationBatches || []), batch].slice(-MAX_BATCH_HISTORY),
                              },
                          }
                        : node,
                ),
            );
            return batch.id;
        },
        [message, nodesRef, projectId, setNodes],
    );

    const reconcileBatches = useCallback(() => {
        setNodes((current) => {
            const nodeById = new Map(current.map((node) => [node.id, node]));
            let changed = false;
            const nextNodes = current.map((sourceNode) => {
                const batches = sourceNode.metadata?.generationBatches;
                if (!batches?.length) return sourceNode;
                let sourceChanged = false;
                const nextBatches = batches.map((batch) => {
                    if (batch.projectId !== projectId) return batch;
                    let batchChanged = false;
                    const nextItems = batch.items.map((item) => {
                        if (item.status === "succeeded" || item.status === "failed" || item.status === "cancelled") return item;
                        const node = nodeById.get(item.nodeId);
                        let patch: Partial<CanvasGenerationBatchItem> | null = null;
                        if (!node) {
                            patch = { status: "failed", errorDetails: "目标节点已不存在" };
                        } else if (node.metadata?.status === "success" && node.metadata.content) {
                            patch = { status: "succeeded", taskId: node.metadata.taskId, errorDetails: undefined, costUncertain: false };
                        } else if (node.metadata?.status === "error") {
                            const errorDetails = node.metadata.errorDetails || "生成失败";
                            patch = {
                                status: node.metadata.taskStatus === "cancelled" ? "cancelled" : "failed",
                                taskId: node.metadata.taskId,
                                errorDetails,
                                costUncertain: isGenerationCostUncertainError(new Error(errorDetails)),
                            };
                        } else if (node.metadata?.taskId) {
                            const taskStatus = node.metadata.taskStatus;
                            patch = {
                                taskId: node.metadata.taskId,
                                // 后端成功后还要下载并写入媒体，节点真正拿到内容才算批次成功。
                                status: taskStatus === "queued" ? "queued" : taskStatus === "failed" ? "failed" : taskStatus === "cancelled" ? "cancelled" : "running",
                                errorDetails: undefined,
                            };
                        } else if (item.status === "submitting" && !controllersRef.current.has(batchItemKey(batch.id, item.id))) {
                            patch = { status: "waiting", errorDetails: undefined };
                        }
                        if (!patch || !itemChanged(item, patch)) return item;
                        batchChanged = true;
                        return { ...item, ...patch };
                    });
                    const nextBatch = batchChanged ? { ...batch, items: nextItems } : batch;
                    const status = generationBatchStatus(nextBatch);
                    if (!batchChanged && status === batch.status) return batch;
                    sourceChanged = true;
                    return { ...nextBatch, status, updatedAt: new Date().toISOString() };
                });
                if (!sourceChanged) return sourceNode;
                changed = true;
                return { ...sourceNode, metadata: { ...sourceNode.metadata, generationBatches: nextBatches } };
            });
            return changed ? nextNodes : current;
        });
    }, [projectId, setNodes]);

    // 仅查询当前画布的活跃任务来安排批次，跨画布并发仍由后端创建任务时原子校验。
    const scheduleWaitingItems = useCallback(async () => {
        if (!projectLoaded || schedulingRef.current) return;
        schedulingRef.current = true;
        try {
            const currentNodes = nodesRef.current;
            // 没有当前画布的等待项时无需查询任务中心，避免空画布持续轮询。
            const hasWaitingItems = currentNodes.some((sourceNode) =>
                (sourceNode.metadata?.generationBatches || []).some((batch) => batch.projectId === projectId && batch.status !== "completed" && batch.status !== "cancelled" && batch.items.some((item) => item.status === "waiting")),
            );
            if (!hasWaitingItems) return;

            const tasks = await listGenerationTasks(100, { projectId, activeOnly: true }).catch(() => null);
            if (!tasks) return;
            const activeTaskCount = tasks.filter((task) => task.status === "queued" || task.status === "running").length;
            const nodeById = new Map(currentNodes.map((node) => [node.id, node]));
            const pendingReservations = [...controllersRef.current.keys()].filter((key) => {
                const [, itemId] = key.split(":");
                const item = currentNodes
                    .flatMap((node) => node.metadata?.generationBatches || [])
                    .flatMap((batch) => batch.items)
                    .find((candidate) => candidate.id === itemId);
                return item ? !nodeById.get(item.nodeId)?.metadata?.taskId : false;
            }).length;
            let availableSlots = Math.max(0, activeTaskLimit - activeTaskCount - pendingReservations);
            if (!availableSlots) return;

            const candidates: Array<{ batch: CanvasGenerationBatch; item: CanvasGenerationBatchItem; node: CanvasNodeData }> = [];
            for (const sourceNode of currentNodes) {
                for (const batch of sourceNode.metadata?.generationBatches || []) {
                    if (batch.projectId !== projectId || batch.status === "completed" || batch.status === "cancelled") continue;
                    for (const item of batch.items) {
                        if (item.status !== "waiting" || availableSlots <= 0) continue;
                        const node = nodeById.get(item.nodeId);
                        if (!node) continue;
                        // 已绑定任务或已有成品的节点交给恢复/对账链路处理，绝不重复提交。
                        if (node.metadata?.taskId || (node.metadata?.status === "success" && node.metadata.content)) continue;
                        candidates.push({ batch, item, node });
                        availableSlots -= 1;
                    }
                }
            }

            for (const { batch, item, node } of candidates) {
                const key = batchItemKey(batch.id, item.id);
                if (controllersRef.current.has(key)) continue;
                const generationMode: CanvasNodeGenerationMode = batch.mode === "storyboard_video" ? "video" : "image";
                const generationConfig = buildGenerationConfig(effectiveConfig, node, generationMode);
                if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                    updateBatch(batch.sourceNodeId, batch.id, (current) => withUpdatedItem(current, item.id, { status: "failed", errorDetails: "生成模型未配置，请完成配置后重试" }));
                    continue;
                }
                const prompt = (node.metadata?.composerContent || node.metadata?.prompt || "").trim();
                if (!prompt) {
                    updateBatch(batch.sourceNodeId, batch.id, (current) => withUpdatedItem(current, item.id, { status: "failed", errorDetails: "生成提示词为空" }));
                    continue;
                }
                const controller = new AbortController();
                controllersRef.current.set(key, controller);
                updateBatch(batch.sourceNodeId, batch.id, (current) => withUpdatedItem(current, item.id, { status: "submitting", errorDetails: undefined }));
                void handleGenerateNode(node.id, generationMode, prompt, {
                    controller,
                    waitForTaskCapacity: true,
                    retryContext:
                        node.metadata?.retryOf && node.metadata.attemptGroupId && node.metadata.taskClientOperationId
                            ? { retryOf: node.metadata.retryOf, attemptGroupId: node.metadata.attemptGroupId, clientOperationId: node.metadata.taskClientOperationId }
                            : undefined,
                }).finally(() => {
                    controllersRef.current.delete(key);
                    reconcileBatches();
                });
            }
        } finally {
            schedulingRef.current = false;
        }
    }, [activeTaskLimit, effectiveConfig, handleGenerateNode, isAiConfigReady, nodesRef, projectId, projectLoaded, reconcileBatches, updateBatch]);

    const retryFailedBatchItems = useCallback(
        (sourceNodeId: string, batchId: string, itemId?: string) => {
            const batch = findBatch(nodesRef.current, sourceNodeId, batchId);
            if (!batch) return;
            const failedItems = batch.items.filter((item) => item.status === "failed" && (!itemId || item.id === itemId));
            if (!failedItems.length) return message.info("没有需要重试的失败项");
            const nodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
            const blockedItems = failedItems.filter((item) => {
                const node = nodeById.get(item.nodeId);
                return unchangedModeratedPrompt(node?.metadata, node?.metadata?.composerContent || node?.metadata?.prompt || "");
            });
            const retryableItems = failedItems.filter((item) => !blockedItems.includes(item));
            if (blockedItems.length) message.warning(`${blockedItems.length} 个镜头未通过内容审核，请先修改提示词`);
            if (!retryableItems.length) return;
            const retry = async () => {
                const retryContexts = new Map<string, Awaited<ReturnType<typeof createGenerationRetryContext>>>();
                await Promise.all(
                    retryableItems.map(async (item) => {
                        const retryNode = nodeById.get(item.nodeId);
                        if (!retryNode?.metadata?.taskId) return;
                        retryContexts.set(item.nodeId, await createGenerationRetryContext(retryNode.metadata.taskId, retryNode.metadata.attemptGroupId));
                    }),
                );
                const retryItemIds = new Set(retryableItems.map((item) => item.id));
                const retryNodeIds = new Set(retryableItems.map((item) => item.nodeId));
                setNodes((current) =>
                    current.map((node) => {
                        if (node.id === sourceNodeId) {
                            const batches = (node.metadata?.generationBatches || []).map((currentBatch) => {
                                if (currentBatch.id !== batchId) return currentBatch;
                                const items = currentBatch.items.map((item) =>
                                    retryItemIds.has(item.id) ? { ...item, status: "waiting" as const, taskId: undefined, errorDetails: undefined, costUncertain: false, retryCount: item.retryCount + 1 } : item,
                                );
                                const nextBatch = { ...currentBatch, items, updatedAt: new Date().toISOString() };
                                return { ...nextBatch, status: generationBatchStatus(nextBatch) };
                            });
                            return { ...node, metadata: { ...node.metadata, generationBatches: batches } };
                        }
                        if (!retryNodeIds.has(node.id)) return node;
                        const retryContext = retryContexts.get(node.id);
                        return {
                            ...node,
                            metadata: {
                                ...resetGenerationTaskMetadata(node.metadata),
                                ...(retryContext
                                    ? {
                                          retryOf: retryContext.retryOf,
                                          attemptGroupId: retryContext.attemptGroupId,
                                          taskClientOperationId: retryContext.clientOperationId,
                                      }
                                    : {}),
                            },
                        };
                    }),
                );
                message.success(`已将 ${retryableItems.length} 个失败项重新加入等待队列`);
            };
            if (retryableItems.some((item) => item.costUncertain)) {
                modal.confirm({
                    title: "重试费用状态不确定的任务？",
                    content: "部分上游请求返回 524，原任务可能已经产生费用。重试会再次提交外部模型任务。",
                    okText: "仍然重试",
                    cancelText: "暂不重试",
                    onOk: retry,
                });
                return;
            }
            retry();
        },
        [message, modal, nodesRef, setNodes],
    );

    const stopRemainingBatchItems = useCallback(
        (sourceNodeId: string, batchId: string) => {
            const batch = findBatch(nodesRef.current, sourceNodeId, batchId);
            if (!batch) return;
            const nodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
            // 只允许停止还在本地等待队列中的项目。进入 submitting 后请求可能已经被服务端接收，
            // 即使前端尚未拿到 taskId 也不能再把它标成取消，避免隐藏已计费任务。
            const stoppableItems = batch.items.filter((item) => item.status === "waiting" && !nodeById.get(item.nodeId)?.metadata?.taskId);
            if (!stoppableItems.length) return message.info("没有尚未提交的任务");
            modal.confirm({
                title: "停止剩余任务？",
                content: `将停止 ${stoppableItems.length} 个尚未提交的任务；已经排队或运行的任务会继续。`,
                okText: "停止剩余任务",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => {
                    const latestNodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
                    const latestBatch = findBatch(nodesRef.current, sourceNodeId, batchId);
                    const latestStoppableItems = latestBatch
                        ? latestBatch.items.filter((item) => item.status === "waiting" && stoppableItems.some((candidate) => candidate.id === item.id) && !latestNodeById.get(item.nodeId)?.metadata?.taskId)
                        : [];
                    const stoppableIds = new Set(latestStoppableItems.map((item) => item.id));
                    updateBatch(sourceNodeId, batchId, (current) => {
                        const items = current.items.map((item) => (stoppableIds.has(item.id) ? { ...item, status: "cancelled" as const, errorDetails: undefined } : item));
                        const nextBatch = { ...current, items, updatedAt: new Date().toISOString() };
                        return { ...nextBatch, status: generationBatchStatus(nextBatch) };
                    });
                },
            });
        },
        [message, modal, nodesRef, updateBatch],
    );

    useEffect(() => {
        if (!projectLoaded) return;
        reconcileBatches();
    }, [nodes, projectLoaded, reconcileBatches]);

    useEffect(() => {
        if (!projectLoaded) return;
        void scheduleWaitingItems();
        const timer = window.setInterval(() => {
            reconcileBatches();
            void scheduleWaitingItems();
        }, SCHEDULER_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [projectLoaded, reconcileBatches, scheduleWaitingItems]);

    return {
        enqueueGenerationBatch,
        retryFailedBatchItems,
        stopRemainingBatchItems,
    };
}

function batchItemKey(batchId: string, itemId: string) {
    return `${batchId}:${itemId}`;
}

function itemChanged(item: CanvasGenerationBatchItem, patch: Partial<CanvasGenerationBatchItem>) {
    return Object.entries(patch).some(([key, value]) => item[key as keyof CanvasGenerationBatchItem] !== value);
}

function withUpdatedItem(batch: CanvasGenerationBatch, itemId: string, patch: Partial<CanvasGenerationBatchItem>) {
    const items = batch.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item));
    const nextBatch = { ...batch, items, updatedAt: new Date().toISOString() };
    return { ...nextBatch, status: generationBatchStatus(nextBatch) };
}

function findBatch(nodes: CanvasNodeData[], sourceNodeId: string, batchId: string) {
    return nodes.find((node) => node.id === sourceNodeId)?.metadata?.generationBatches?.find((batch) => batch.id === batchId);
}
