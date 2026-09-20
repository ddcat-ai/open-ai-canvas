import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { applyCanvasOperations, summarizeCanvasOperations, type CanvasOperation, type CanvasSnapshot } from "@/lib/canvas/canvas-operation-contract";
import { createGenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import { subscribeGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import { persistCanvasOperationContinuationEffect } from "@/services/canvas-generation-consumer";
import { consumeGenerationTaskAgent } from "@/services/project-asset-sync";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

import type { CanvasNodeGenerationOptions } from "./use-canvas-generation-executor";

export type CanvasGenerationContext = { conversationId?: string; messageId?: string; source?: "online" | "local" };
type CanvasGenerationContinuation = NonNullable<NonNullable<CanvasNodeData["metadata"]>["agentGenerationContinuation"]>;
type CanvasGenerationOptions = Pick<CanvasNodeGenerationOptions, "context" | "retryContext" | "onTaskUpdate" | "skipDuplicateConfirmation">;
type CanvasGenerationContinuationDependencies = {
    consumeAgent?: typeof consumeGenerationTaskAgent;
    persistContinuation?: typeof persistCanvasOperationContinuationEffect;
    projectId?: string;
    nodeId?: string;
    previousNodes?: CanvasNodeData[];
    nodesRef?: { current: CanvasNodeData[] };
    setNodes?: Dispatch<SetStateAction<CanvasNodeData[]>>;
};

type UseCanvasOperationHistoryOptions = {
    projectId: string;
    domainProjectId?: string;
    projectTitle: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    selectedNodeIdsRef: { current: Set<string> };
    viewportRef: { current: ViewportTransform };
    generateNodeRef: { current: ((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasGenerationOptions) => Promise<void>) | null };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    focusSelection: () => boolean;
};

export type CanvasOperationChange = {
    id: string;
    summary: string;
    nodeIds: string[];
    undoCount: number;
};

type CanvasOperationUndoBatch = { snapshot: CanvasSnapshot; afterNodes: CanvasNodeData[]; afterConnections: CanvasConnection[]; change: Omit<CanvasOperationChange, "undoCount"> };

type RunCanvasGenerationOpsInput = {
    generationOps: Array<Extract<CanvasOperation, { type: "run_generation" }>>;
    nodes: CanvasNodeData[];
    context?: CanvasGenerationContext;
    generate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options: CanvasGenerationOptions) => Promise<void>;
    subscribeTasks?: (ids: readonly string[], listener: (task: GenerationTask) => void) => () => void;
    consumeTask?: typeof consumeGenerationTaskAgent;
    resumeAgent?: (task: GenerationTask) => Promise<void>;
    onContinuation?: (nodeId: string, continuation: CanvasGenerationContinuation) => Promise<void> | void;
};

export async function runCanvasGenerationOps({
    generationOps,
    nodes,
    context,
    generate,
    subscribeTasks = subscribeGenerationTasks,
    consumeTask = consumeGenerationTaskAgent,
    resumeAgent = async () => undefined,
    onContinuation,
}: RunCanvasGenerationOpsInput) {
    const observations = new Map<string, Promise<void>>();
    const observe = (taskId: string, nodeId: string, continuationIdPromise?: Promise<string>) => {
        const existing = observations.get(taskId);
        if (existing) return existing;
        const observation = new Promise<void>((resolve, reject) => {
            let unsubscribe: (() => void) | undefined;
            let settled = false;
            unsubscribe = subscribeTasks([taskId], (task) => {
                if (settled || (task.status !== "succeeded" && task.status !== "failed" && task.status !== "cancelled")) return;
                settled = true;
                queueMicrotask(() => {
                    void (async () => {
                        const taskContext = {
                            conversationId: task.clientContext?.conversationId || context?.conversationId,
                            messageId: task.clientContext?.messageId || context?.messageId,
                        };
                        const continuationId = await (continuationIdPromise ?? canvasGenerationContinuationId(task.clientContext?.nodeId || nodeId, taskContext));
                        const continuation: CanvasGenerationContinuation = {
                            id: continuationId,
                            taskId: task.id,
                            ...(taskContext.conversationId ? { conversationId: taskContext.conversationId } : {}),
                            ...(taskContext.messageId ? { messageId: taskContext.messageId } : {}),
                            ...(context?.source ? { source: context.source } : {}),
                            status: task.status === "succeeded" ? "pending" : "failed",
                        };
                        if (task.status !== "succeeded") {
                            await onContinuation?.(nodeId, continuation);
                            await resumeAgent(task);
                            return;
                        }
                        await consumeTask(task, continuationId, async (effect?: { effectKey?: string }) => {
                            await onContinuation?.(nodeId, {
                                ...continuation,
                                status: "completed",
                                ...(effect?.effectKey ? { effectKey: effect.effectKey } : {}),
                            });
                            await resumeAgent(task);
                        });
                    })()
                        .then(resolve, reject)
                        .finally(() => unsubscribe?.());
                });
            });
        });
        observations.set(taskId, observation);
        return observation;
    };

    if (!generationOps.length) {
        const taskNodes = nodes.filter((node) => node.metadata?.agentGenerationContinuation?.status === "pending" && (node.metadata?.taskId || node.metadata.agentGenerationContinuation.taskId));
        await Promise.all(
            taskNodes.map((node) => {
                const continuation = node.metadata!.agentGenerationContinuation!;
                return observe(node.metadata?.taskId || continuation.taskId, node.id, Promise.resolve(continuation.id));
            }),
        );
        return;
    }

    await Promise.all(
        generationOps.map(async (op) => {
            const target = nodes.find((node) => node.id === op.nodeId);
            const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
            const retryOf = op.retry ? target?.metadata?.taskId : undefined;
            if (op.retry && !retryOf) throw new Error("当前节点没有可重试的生成任务");
            const retryContext = retryOf ? await createGenerationRetryContext(retryOf, target?.metadata?.attemptGroupId) : undefined;
            const continuationIdPromise = canvasGenerationContinuationId(op.nodeId, context);
            let observation: Promise<void> | undefined;
            let continuationTaskId = "";
            const generationPromise = generate(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt, {
                context: context ? { conversationId: context.conversationId, messageId: context.messageId } : undefined,
                skipDuplicateConfirmation: true,
                ...(retryContext ? { retryContext } : {}),
                onTaskUpdate: (task) => {
                    if (continuationTaskId) return;
                    continuationTaskId = task.id;
                    observation = observe(task.id, op.nodeId, continuationIdPromise);
                    void continuationIdPromise.then((continuationId) => {
                        onContinuation?.(op.nodeId, {
                            id: continuationId,
                            taskId: task.id,
                            ...(context?.conversationId ? { conversationId: context.conversationId } : {}),
                            ...(context?.messageId ? { messageId: context.messageId } : {}),
                            ...(context?.source ? { source: context.source } : {}),
                            status: "pending",
                        });
                    });
                },
            });
            await generationPromise;
            if (observation) await observation;
        }),
    );
}

export async function consumeCanvasGenerationContinuation(
    task: GenerationTask,
    continuation: CanvasGenerationContinuation,
    onCompleted: (continuation: CanvasGenerationContinuation, signal?: AbortSignal) => Promise<void> | void,
    dependencies: CanvasGenerationContinuationDependencies = {},
    signal?: AbortSignal,
) {
    if (continuation.status !== "pending" || continuation.taskId !== task.id || task.status !== "succeeded") return task;
    const consumeAgent = dependencies.consumeAgent ?? consumeGenerationTaskAgent;
    return consumeAgent(
        task,
        continuation.id,
        async ({ effectKey, signal: leaseSignal }) => {
            const completed = { ...continuation, status: "completed" as const, effectKey };
            if (dependencies.projectId && dependencies.nodeId && dependencies.nodesRef && dependencies.setNodes) {
                await (dependencies.persistContinuation ?? persistCanvasOperationContinuationEffect)({
                    projectId: dependencies.projectId,
                    nodeId: dependencies.nodeId,
                    continuation: completed,
                    effectKey,
                    signal: leaseSignal,
                    previousNodes: dependencies.previousNodes,
                    nodesRef: dependencies.nodesRef,
                    setNodes: dependencies.setNodes,
                });
            }
            await onCompleted(completed, leaseSignal);
        },
        { signal },
    );
}

async function canvasGenerationContinuationId(nodeId: string, context?: CanvasGenerationContext) {
    const seed = new TextEncoder().encode(`canvas-operation-generation\0${context?.source || ""}\0${context?.conversationId || ""}\0${context?.messageId || ""}\0${nodeId}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", seed));
    return `agent:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function useCanvasOperationHistory({
    projectId,
    domainProjectId,
    projectTitle,
    nodes,
    connections,
    selectedNodeIds,
    viewport,
    nodesRef,
    connectionsRef,
    selectedNodeIdsRef,
    viewportRef,
    generateNodeRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setViewport,
    setContextMenu,
    focusSelection,
}: UseCanvasOperationHistoryOptions) {
    const undoStackRef = useRef<CanvasOperationUndoBatch[]>([]);
    const [undoOpsCount, setUndoOpsCount] = useState(0);
    const [lastAgentChange, setLastAgentChange] = useState<CanvasOperationChange | null>(null);
    const snapshot = useMemo<CanvasSnapshot>(
        () => ({ projectId, domainProjectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, domainProjectId, nodes, projectId, projectTitle, selectedNodeIds, viewport],
    );

    useEffect(() => {
        undoStackRef.current = [];
        setUndoOpsCount(0);
        setLastAgentChange(null);
    }, [projectId]);

    useEffect(() => {
        const latest = undoStackRef.current.at(-1);
        if (!latest || (latest.afterNodes === nodes && latest.afterConnections === connections)) return;
        // Agent 撤销使用整批快照；用户继续编辑后必须失效，避免覆盖后续手工改动。
        undoStackRef.current = [];
        setUndoOpsCount(0);
        setLastAgentChange(null);
    }, [connections, nodes]);

    const applyOps = useCallback(
        async (ops?: CanvasOperation[], generationContext?: CanvasGenerationContext) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, domainProjectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasOperation, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasOperations(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            const beforeNodeIds = new Set(before.nodes.map((node) => node.id));
            const addedNodeIds = next.nodes.filter((node) => !beforeNodeIds.has(node.id)).map((node) => node.id);
            const addedNodeIdSet = new Set(addedNodeIds);
            const focusNodeIds = next.nodes.filter((node) => addedNodeIdSet.has(node.id) && (!node.parentId || !addedNodeIdSet.has(node.parentId))).map((node) => node.id);
            const affectedNodeIds = focusNodeIds.length ? focusNodeIds : agentAffectedNodeIds(safeOps, next.nodes);
            const nextSelectedNodeIds = focusNodeIds.length ? focusNodeIds : next.selectedNodeIds;
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(nextSelectedNodeIds);
            viewportRef.current = next.viewport;
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(nextSelectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (safeOps.length) {
                const change = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, summary: summarizeCanvasOperations(safeOps) || "画布操作已完成", nodeIds: affectedNodeIds };
                undoStackRef.current = [...undoStackRef.current, { snapshot: before, afterNodes: next.nodes, afterConnections: next.connections, change }].slice(-10);
                const nextUndoCount = undoStackRef.current.length;
                setUndoOpsCount(nextUndoCount);
                setLastAgentChange({ ...change, undoCount: nextUndoCount });
            }
            if (focusNodeIds.length) queueMicrotask(() => focusSelection());
            if (generationOps.length) {
                const generate = generateNodeRef.current;
                if (generate)
                    await runCanvasGenerationOps({
                        generationOps,
                        nodes: nodesRef.current,
                        generate,
                        context: generationContext,
                        onContinuation: async (nodeId, continuation) => {
                            if (continuation.status === "completed" && continuation.effectKey) {
                                await persistCanvasOperationContinuationEffect({
                                    projectId,
                                    nodeId,
                                    continuation,
                                    effectKey: continuation.effectKey,
                                    nodesRef,
                                    setNodes,
                                });
                                return;
                            }
                            setNodes((current) => {
                                const updated = current.map((node) =>
                                    node.id === nodeId
                                        ? {
                                              ...node,
                                              metadata: {
                                                  ...node.metadata,
                                                  agentGenerationContinuation: continuation,
                                              },
                                          }
                                        : node,
                                );
                                nodesRef.current = updated;
                                return updated;
                            });
                        },
                    });
            }
            return { ...next, nodes: nodesRef.current, connections: connectionsRef.current, projectId, title: projectTitle, selectedNodeIds: nextSelectedNodeIds };
        },
        [connectionsRef, domainProjectId, focusSelection, generateNodeRef, nodesRef, projectId, projectTitle, selectedNodeIdsRef, setConnections, setContextMenu, setNodes, setSelectedConnectionId, setSelectedNodeIds, setViewport, viewportRef],
    );

    const undoOps = useCallback(() => {
        const batch = undoStackRef.current.at(-1);
        if (!batch) return null;
        if (batch.afterNodes !== nodesRef.current || batch.afterConnections !== connectionsRef.current) {
            undoStackRef.current = [];
            setUndoOpsCount(0);
            setLastAgentChange(null);
            return null;
        }
        undoStackRef.current.pop();
        const restored = batch.snapshot;
        nodesRef.current = restored.nodes;
        connectionsRef.current = restored.connections;
        selectedNodeIdsRef.current = new Set(restored.selectedNodeIds);
        viewportRef.current = restored.viewport;
        setNodes(restored.nodes);
        setConnections(restored.connections);
        setSelectedNodeIds(new Set(restored.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(restored.viewport);
        setContextMenu(null);
        setUndoOpsCount(undoStackRef.current.length);
        setLastAgentChange(null);
        return { ...restored, projectId, domainProjectId, title: projectTitle };
    }, [connectionsRef, domainProjectId, nodesRef, projectId, projectTitle, selectedNodeIdsRef, setConnections, setContextMenu, setNodes, setSelectedConnectionId, setSelectedNodeIds, setViewport, viewportRef]);

    const viewLastAgentChange = useCallback(() => {
        if (!lastAgentChange?.nodeIds.length) return;
        const ids = lastAgentChange.nodeIds.filter((id) => nodesRef.current.some((node) => node.id === id));
        if (!ids.length) return;
        const selection = new Set(ids);
        selectedNodeIdsRef.current = selection;
        setSelectedNodeIds(selection);
        setSelectedConnectionId(null);
        queueMicrotask(() => focusSelection());
    }, [focusSelection, lastAgentChange, nodesRef, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    return { agentSnapshot: snapshot, agentUndoCount: undoOpsCount, applyAgentOps: applyOps, canUndoAgentOps: undoOpsCount > 0, dismissLastAgentChange: () => setLastAgentChange(null), lastAgentChange, undoAgentOps: undoOps, viewLastAgentChange };
}

function agentAffectedNodeIds(ops: CanvasOperation[], nodes: CanvasNodeData[]) {
    const existingIds = new Set(nodes.map((node) => node.id));
    const ids = new Set<string>();
    ops.forEach((op) => {
        if ((op.type === "add_node" || op.type === "update_node" || op.type === "run_generation") && "id" in op && op.id && existingIds.has(op.id)) ids.add(op.id);
        if (op.type === "run_generation" && existingIds.has(op.nodeId)) ids.add(op.nodeId);
        if (op.type === "select_nodes") op.ids.filter((id) => existingIds.has(id)).forEach((id) => ids.add(id));
    });
    return [...ids];
}
