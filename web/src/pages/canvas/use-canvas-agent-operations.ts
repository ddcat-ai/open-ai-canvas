import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { applyCanvasAgentOps, summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type UseCanvasAgentOperationsOptions = {
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
    generateNodeRef: { current: ((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    focusSelection: () => boolean;
};

export type CanvasAgentChange = {
    summary: string;
    nodeIds: string[];
};

export function useCanvasAgentOperations({
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
}: UseCanvasAgentOperationsOptions) {
    const [undoSnapshot, setUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const [lastAgentChange, setLastAgentChange] = useState<CanvasAgentChange | null>(null);
    const snapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, domainProjectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, domainProjectId, nodes, projectId, projectTitle, selectedNodeIds, viewport],
    );

    const applyOps = useCallback((ops?: CanvasAgentOp[]) => {
        const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
        const before = { projectId, domainProjectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
        const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
        const next = applyCanvasAgentOps(before, safeOps.filter((op) => op.type !== "run_generation"));
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
        setUndoSnapshot(before);
        setNodes(next.nodes);
        setConnections(next.connections);
        setSelectedNodeIds(new Set(nextSelectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(next.viewport);
        setContextMenu(null);
        if (safeOps.length) setLastAgentChange({ summary: summarizeCanvasAgentOps(safeOps) || "画布操作已完成", nodeIds: affectedNodeIds });
        if (focusNodeIds.length) queueMicrotask(() => focusSelection());
        if (generationOps.length) {
            queueMicrotask(() => generationOps.forEach((op) => {
                const target = nodesRef.current.find((node) => node.id === op.nodeId);
                const prompt = op.prompt?.trim() ? op.prompt : target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "";
                void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
            }));
        }
        return { ...next, projectId, title: projectTitle, selectedNodeIds: nextSelectedNodeIds };
    }, [connectionsRef, domainProjectId, focusSelection, generateNodeRef, nodesRef, projectId, projectTitle, selectedNodeIdsRef, setConnections, setContextMenu, setNodes, setSelectedConnectionId, setSelectedNodeIds, setViewport, viewportRef]);

    const undoOps = useCallback(() => {
        if (!undoSnapshot) return null;
        nodesRef.current = undoSnapshot.nodes;
        connectionsRef.current = undoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(undoSnapshot.selectedNodeIds);
        viewportRef.current = undoSnapshot.viewport;
        setNodes(undoSnapshot.nodes);
        setConnections(undoSnapshot.connections);
        setSelectedNodeIds(new Set(undoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(undoSnapshot.viewport);
        setContextMenu(null);
        setUndoSnapshot(null);
        setLastAgentChange(null);
        return { ...undoSnapshot, projectId, domainProjectId, title: projectTitle };
    }, [connectionsRef, domainProjectId, nodesRef, projectId, projectTitle, selectedNodeIdsRef, setConnections, setContextMenu, setNodes, setSelectedConnectionId, setSelectedNodeIds, setViewport, undoSnapshot, viewportRef]);

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

    return { agentSnapshot: snapshot, applyAgentOps: applyOps, canUndoAgentOps: Boolean(undoSnapshot), dismissLastAgentChange: () => setLastAgentChange(null), lastAgentChange, undoAgentOps: undoOps, viewLastAgentChange };
}

function agentAffectedNodeIds(ops: CanvasAgentOp[], nodes: CanvasNodeData[]) {
    const existingIds = new Set(nodes.map((node) => node.id));
    const ids = new Set<string>();
    ops.forEach((op) => {
        if ((op.type === "add_node" || op.type === "update_node" || op.type === "run_generation") && "id" in op && op.id && existingIds.has(op.id)) ids.add(op.id);
        if (op.type === "run_generation" && existingIds.has(op.nodeId)) ids.add(op.nodeId);
        if (op.type === "select_nodes") op.ids.filter((id) => existingIds.has(id)).forEach((id) => ids.add(id));
    });
    return [...ids];
}
