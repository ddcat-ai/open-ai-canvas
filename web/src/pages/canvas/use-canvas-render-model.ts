import { useMemo, useRef } from "react";

import { buildNodeGenerationInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import { sameNodeSemanticData } from "@/lib/canvas/canvas-project-domain";
import { shouldReduceCanvasMediaEffects } from "@/lib/canvas/canvas-performance-mode";
import { buildCanvasResourceReferences, buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";
import { buildSkillMentionReferences } from "@/lib/canvas/canvas-skill-mentions";
import type { Skill } from "@/services/api/skills";
import type { Asset, ImageAsset } from "@/stores/use-asset-store";
import type { DirectorScene } from "@/types/director";
import { CanvasNodeType, type CanvasConnection, type CanvasMediaPerformanceMode, type CanvasNodeData, type ContextMenuState, type ViewportTransform } from "@/types/canvas";

type DragPreview = { x: number; y: number; nodeIds: Set<string> } | null;

type UseCanvasRenderModelOptions = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    assets: Asset[];
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    mediaPerformanceMode: CanvasMediaPerformanceMode;
    selectedNodeIds: Set<string>;
    hoveredNodeId: string | null;
    dragPreview: DragPreview;
    collapsingBatchIds: Set<string>;
    addedSkills: Skill[];
    directorScenes?: DirectorScene[];
    infoNodeId: string | null;
    cropNodeId: string | null;
    maskEditNodeId: string | null;
    annotationNodeId: string | null;
    splitNodeId: string | null;
    upscaleNodeId: string | null;
    superResolveNodeId: string | null;
    angleNodeId: string | null;
    emotionNodeId: string | null;
    previewNodeId: string | null;
    contextMenu: ContextMenuState | null;
    versionCompareRootId: string | null;
    directorNodeId: string | null;
    scriptEditorNodeId: string | null;
    dialogNodeId: string | null;
};

export function useCanvasRenderModel({
    nodes,
    connections,
    assets,
    viewport,
    viewportSize,
    mediaPerformanceMode,
    selectedNodeIds,
    hoveredNodeId,
    dragPreview,
    collapsingBatchIds,
    addedSkills,
    directorScenes,
    infoNodeId,
    cropNodeId,
    maskEditNodeId,
    annotationNodeId,
    splitNodeId,
    upscaleNodeId,
    superResolveNodeId,
    angleNodeId,
    emotionNodeId,
    previewNodeId,
    contextMenu,
    versionCompareRootId,
    directorNodeId,
    scriptEditorNodeId,
    dialogNodeId,
}: UseCanvasRenderModelOptions) {
    const reduceMediaEffects = useMemo(() => shouldReduceCanvasMediaEffects(mediaPerformanceMode, nodes), [mediaPerformanceMode, nodes]);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const collapsedBatchChildIds = useMemo(() => {
        const hidden = new Set<string>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            if (root && !root.metadata?.imageBatchExpanded) hidden.add(node.id);
        });
        return hidden;
    }, [nodeById, nodes]);
    const renderHiddenNodeIds = useMemo(() => {
        const hidden = new Set(collapsedBatchChildIds);
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (rootId && collapsingBatchIds.has(rootId)) hidden.delete(node.id);
            const parent = node.parentId ? nodeById.get(node.parentId) : null;
            if (parent && isFrameNode(parent) && parent.metadata?.frame?.collapsed) hidden.add(node.id);
        });
        return hidden;
    }, [collapsedBatchChildIds, collapsingBatchIds, nodeById, nodes]);
    const connectionLayerBounds = useMemo(() => {
        const padding = (reduceMediaEffects ? 96 : 144) / Math.max(viewport.k, 0.05);
        const left = -viewport.x / viewport.k - padding;
        const top = -viewport.y / viewport.k - padding;
        const width = viewportSize.width / viewport.k + padding * 2;
        const height = viewportSize.height / viewport.k + padding * 2;
        return { left, top, width: Math.max(2, width), height: Math.max(2, height) };
    }, [reduceMediaEffects, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
    const renderBounds = useMemo(() => {
        const padding = (reduceMediaEffects ? 128 : 192) / viewport.k;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + viewportSize.width / viewport.k + padding * 2;
        const viewBottom = viewTop + viewportSize.height / viewport.k + padding * 2;
        return { left: viewLeft, top: viewTop, right: viewRight, bottom: viewBottom };
    }, [reduceMediaEffects, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
    const visibleNodes = useMemo(() => {
        const frames: CanvasNodeData[] = [];
        const regular: CanvasNodeData[] = [];
        nodes.forEach((node) => {
            if (renderHiddenNodeIds.has(node.id)) return;
            const retained = selectedNodeIds.has(node.id) || Boolean(dragPreview?.nodeIds.has(node.id));
            if (!retained && (node.position.x + node.width <= renderBounds.left || node.position.x >= renderBounds.right || node.position.y + node.height <= renderBounds.top || node.position.y >= renderBounds.bottom)) return;
            (isFrameNode(node) ? frames : regular).push(node);
        });
        return [...frames, ...regular];
    }, [dragPreview, nodes, renderBounds, renderHiddenNodeIds, selectedNodeIds]);

    const imageAssets = useMemo(() => assets.filter((asset): asset is ImageAsset => asset.kind === "image"), [assets]);
    const canvasImageNodes = useMemo(() => nodes.filter((node) => node.type === CanvasNodeType.Image && Boolean(node.metadata?.content) && !collapsedBatchChildIds.has(node.id) && !(node.parentId && nodeById.get(node.parentId)?.metadata?.frame?.collapsed)), [collapsedBatchChildIds, nodeById, nodes]);
    const semanticNodesRef = useRef(nodes);
    const semanticNodes = useMemo(() => {
        const previous = semanticNodesRef.current;
        const positionOnlyChange = previous.length === nodes.length && nodes.every((node, index) => sameNodeSemanticData(node, previous[index]));
        if (!positionOnlyChange) semanticNodesRef.current = nodes;
        return semanticNodesRef.current;
    }, [nodes]);
    const versionCompareNodes = useMemo(() => {
        if (!versionCompareRootId) return [];
        return nodes.filter((node) => (node.metadata?.versionOfNodeId || node.id) === versionCompareRootId).sort((a, b) => (a.metadata?.versionLabel || "").localeCompare(b.metadata?.versionLabel || ""));
    }, [nodes, versionCompareRootId]);

    const selectedNodeIdForToolbar = selectedNodeIds.size === 1 ? [...selectedNodeIds][0] : null;
    const toolbarCandidate = selectedNodeIdForToolbar ? nodeById.get(selectedNodeIdForToolbar) || null : null;
    const toolbarNode = isFrameNode(toolbarCandidate) ? null : toolbarCandidate;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const annotationNode = annotationNodeId ? nodeById.get(annotationNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const emotionNode = emotionNodeId ? nodeById.get(emotionNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const contextMenuNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    // Hover only drives transient affordances (toolbar/handles). Selection is
    // the explicit focus action that raises a node and highlights its graph.
    const activeNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;

    const selectedNodeBounds = useMemo(() => {
        if (selectedNodeIds.size < 2) return null;
        const selectedNodes = nodes.filter((node) => selectedNodeIds.has(node.id) && !renderHiddenNodeIds.has(node.id));
        if (selectedNodes.length < 2) return null;
        const left = Math.min(...selectedNodes.map((node) => node.position.x));
        const top = Math.min(...selectedNodes.map((node) => node.position.y));
        const right = Math.max(...selectedNodes.map((node) => node.position.x + node.width));
        const bottom = Math.max(...selectedNodes.map((node) => node.position.y + node.height));
        return { left, top, width: right - left, height: bottom - top, count: selectedNodes.length };
    }, [nodes, renderHiddenNodeIds, selectedNodeIds]);
    const selectedVideoNodes = useMemo(() => nodes
        .filter((node) => selectedNodeIds.has(node.id) && node.type === CanvasNodeType.Video && Boolean(node.metadata?.content) && !renderHiddenNodeIds.has(node.id))
        .sort((a, b) => {
            const shotA = a.metadata?.shotIndex ?? Number.MAX_SAFE_INTEGER;
            const shotB = b.metadata?.shotIndex ?? Number.MAX_SAFE_INTEGER;
            return shotA - shotB || a.position.y - b.position.y || a.position.x - b.position.x;
        }), [nodes, renderHiddenNodeIds, selectedNodeIds]);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (!node.metadata?.isBatchRoot) return;
            const liveChildCount = (node.metadata.batchChildIds || []).filter((childId) => nodeById.get(childId)?.metadata?.batchRootId === node.id).length;
            map.set(node.id, liveChildCount);
        });
        return map;
    }, [nodeById, nodes]);
    const frameChildrenById = useMemo(() => {
        const map = new Map<string, CanvasNodeData[]>();
        nodes.forEach((node) => {
            if (!node.parentId) return;
            const children = map.get(node.parentId) || [];
            children.push(node);
            map.set(node.parentId, children);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();
        if (!activeNodeId) return { nodeIds, connectionIds };
        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });
        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);
    const displayConnections = useMemo(() => connections.flatMap((connection) => {
        if (collapsedBatchChildIds.has(connection.fromNodeId) || collapsedBatchChildIds.has(connection.toNodeId)) return [];
        const fromNode = nodeById.get(connection.fromNodeId);
        const toNode = nodeById.get(connection.toNodeId);
        if (!fromNode || !toNode) return [];
        const fromParent = fromNode.parentId ? nodeById.get(fromNode.parentId) : null;
        const toParent = toNode.parentId ? nodeById.get(toNode.parentId) : null;
        const displayFrom = fromParent && isFrameNode(fromParent) && fromParent.metadata?.frame?.collapsed ? fromParent : fromNode;
        const displayTo = toParent && isFrameNode(toParent) && toParent.metadata?.frame?.collapsed ? toParent : toNode;
        if (displayFrom.id === displayTo.id) return [];
        const from = dragPreview?.nodeIds.has(displayFrom.id) ? { ...displayFrom, position: { x: displayFrom.position.x + dragPreview.x, y: displayFrom.position.y + dragPreview.y } } : displayFrom;
        const to = dragPreview?.nodeIds.has(displayTo.id) ? { ...displayTo, position: { x: displayTo.position.x + dragPreview.x, y: displayTo.position.y + dragPreview.y } } : displayTo;
        const connectionLeft = Math.min(from.position.x, to.position.x);
        const connectionTop = Math.min(from.position.y, to.position.y);
        const connectionRight = Math.max(from.position.x + from.width, to.position.x + to.width);
        const connectionBottom = Math.max(from.position.y + from.height, to.position.y + to.height);
        if (connectionRight <= renderBounds.left || connectionLeft >= renderBounds.right || connectionBottom <= renderBounds.top || connectionTop >= renderBounds.bottom) return [];
        return [{ connection, from, to }];
    }), [collapsedBatchChildIds, connections, dragPreview, nodeById, renderBounds]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        semanticNodes.forEach((node) => {
            if (node.type === CanvasNodeType.Config) map.set(node.id, buildNodeGenerationInputs(node.id, semanticNodes, connections));
        });
        return map;
    }, [connections, semanticNodes]);
    const activeDirectorNode = useMemo(() => semanticNodes.find((node) => node.id === directorNodeId) || null, [directorNodeId, semanticNodes]);
    const activeStylePresetId = useMemo(() => semanticNodes.find((node) => node.metadata?.workflowKind === "styleboard")?.metadata?.stylePresetId, [semanticNodes]);
    const activeScriptNode = useMemo(() => semanticNodes.find((node) => node.id === scriptEditorNodeId && node.type === CanvasNodeType.Script) || null, [scriptEditorNodeId, semanticNodes]);
    const activeDirectorScene = useMemo(() => directorScenes?.find((scene) => scene.id === activeDirectorNode?.metadata?.directorSceneId) || null, [activeDirectorNode?.metadata?.directorSceneId, directorScenes]);
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(semanticNodes, connections, dialogNodeId || activeNodeId), [activeNodeId, connections, dialogNodeId, semanticNodes]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const skillMentionReferences = useMemo(() => buildSkillMentionReferences(addedSkills), [addedSkills]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        semanticNodes.forEach((node) => map.set(node.id, [...buildNodeMentionReferences(node, semanticNodes, connections), ...skillMentionReferences]));
        return map;
    }, [connections, semanticNodes, skillMentionReferences]);

    return {
        activeDirectorNode,
        activeDirectorScene,
        activeNodeId,
        activeScriptNode,
        activeStylePresetId,
        angleNode,
        emotionNode,
        annotationNode,
        batchChildCountById,
        batchMotionById,
        canvasImageNodes,
        configInputsById,
        connectionLayerBounds,
        contextMenuNode,
        cropNode,
        displayConnections,
        frameChildrenById,
        imageAssets,
        infoNode,
        maskEditNode,
        mentionReferencesByNodeId,
        nodeById,
        previewNode,
        reduceMediaEffects,
        relatedHighlight,
        resourceReferenceByNodeId,
        selectedNodeBounds,
        selectedVideoNodes,
        semanticNodes,
        skillMentionReferences,
        splitNode,
        superResolveNode,
        toolbarNode,
        upscaleNode,
        versionCompareNodes,
        visibleNodes,
    };
}
