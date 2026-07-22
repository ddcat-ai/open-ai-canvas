import { useMemo, useRef } from "react";

import { buildNodeGenerationInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import { sameNodeSemanticData } from "@/lib/canvas/canvas-project-domain";
import { shouldReduceCanvasMediaEffects } from "@/lib/canvas/canvas-performance-mode";
import { buildCanvasResourceReferences, buildNodeMentionReferences } from "@/lib/canvas/canvas-resource-references";
import { buildSkillMentionReferences } from "@/lib/canvas/canvas-skill-mentions";
import type { UpdreamSkill } from "@/services/api/skills";
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
    activatedSkills: UpdreamSkill[];
    directorScenes?: DirectorScene[];
    toolbarNodeId: string | null;
    infoNodeId: string | null;
    cropNodeId: string | null;
    maskEditNodeId: string | null;
    annotationNodeId: string | null;
    splitNodeId: string | null;
    upscaleNodeId: string | null;
    superResolveNodeId: string | null;
    angleNodeId: string | null;
    previewNodeId: string | null;
    contextMenu: ContextMenuState | null;
    versionCompareRootId: string | null;
    directorNodeId: string | null;
    documentEditorNodeId: string | null;
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
    activatedSkills,
    directorScenes,
    toolbarNodeId,
    infoNodeId,
    cropNodeId,
    maskEditNodeId,
    annotationNodeId,
    splitNodeId,
    upscaleNodeId,
    superResolveNodeId,
    angleNodeId,
    previewNodeId,
    contextMenu,
    versionCompareRootId,
    directorNodeId,
    documentEditorNodeId,
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
        if (!nodes.length) return { left: -1, top: -1, width: 2, height: 2 };
        const padding = 320;
        let left = Number.POSITIVE_INFINITY;
        let top = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        let bottom = Number.NEGATIVE_INFINITY;
        nodes.forEach((node) => {
            left = Math.min(left, node.position.x - padding);
            top = Math.min(top, node.position.y - padding);
            right = Math.max(right, node.position.x + node.width + padding);
            bottom = Math.max(bottom, node.position.y + node.height + padding);
        });
        return { left, top, width: Math.max(2, right - left), height: Math.max(2, bottom - top) };
    }, [nodes]);
    const visibleNodes = useMemo(() => {
        const padding = (reduceMediaEffects ? Math.max(240, Math.max(viewportSize.width, viewportSize.height) * 0.4) : Math.max(800, Math.max(viewportSize.width, viewportSize.height) * 1.5)) / viewport.k;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + viewportSize.width / viewport.k + padding * 2;
        const viewBottom = viewTop + viewportSize.height / viewport.k + padding * 2;
        const frames: CanvasNodeData[] = [];
        const regular: CanvasNodeData[] = [];
        nodes.forEach((node) => {
            if (renderHiddenNodeIds.has(node.id) || node.position.x + node.width <= viewLeft || node.position.x >= viewRight || node.position.y + node.height <= viewTop || node.position.y >= viewBottom) return;
            (isFrameNode(node) ? frames : regular).push(node);
        });
        return [...frames, ...regular];
    }, [nodes, reduceMediaEffects, renderHiddenNodeIds, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);

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

    const toolbarCandidate = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const toolbarNode = isFrameNode(toolbarCandidate) ? null : toolbarCandidate;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const annotationNode = annotationNodeId ? nodeById.get(annotationNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const contextMenuNode = contextMenu?.type === "node" ? nodeById.get(contextMenu.nodeId) || null : null;
    const activeNodeId = selectedNodeIds.size > 1 ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);

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
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
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
        return [{ connection, from, to }];
    }), [collapsedBatchChildIds, connections, dragPreview, nodeById]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        semanticNodes.forEach((node) => {
            if (node.type === CanvasNodeType.Config) map.set(node.id, buildNodeGenerationInputs(node.id, semanticNodes, connections));
        });
        return map;
    }, [connections, semanticNodes]);
    const activeDirectorNode = useMemo(() => semanticNodes.find((node) => node.id === directorNodeId) || null, [directorNodeId, semanticNodes]);
    const activeDocumentNode = useMemo(() => semanticNodes.find((node) => node.id === documentEditorNodeId && node.type === CanvasNodeType.Text) || null, [documentEditorNodeId, semanticNodes]);
    const activeStylePresetId = useMemo(() => semanticNodes.find((node) => node.metadata?.workflowKind === "styleboard")?.metadata?.stylePresetId, [semanticNodes]);
    const activeScriptNode = useMemo(() => semanticNodes.find((node) => node.id === scriptEditorNodeId && node.type === CanvasNodeType.Script) || null, [scriptEditorNodeId, semanticNodes]);
    const activeDirectorScene = useMemo(() => directorScenes?.find((scene) => scene.id === activeDirectorNode?.metadata?.directorSceneId) || null, [activeDirectorNode?.metadata?.directorSceneId, directorScenes]);
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(semanticNodes, connections, dialogNodeId || activeNodeId), [activeNodeId, connections, dialogNodeId, semanticNodes]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const skillMentionReferences = useMemo(() => buildSkillMentionReferences(activatedSkills), [activatedSkills]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        semanticNodes.forEach((node) => map.set(node.id, [...buildNodeMentionReferences(node, semanticNodes, connections), ...skillMentionReferences]));
        return map;
    }, [connections, semanticNodes, skillMentionReferences]);

    return {
        activeDirectorNode,
        activeDirectorScene,
        activeDocumentNode,
        activeNodeId,
        activeScriptNode,
        activeStylePresetId,
        angleNode,
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
