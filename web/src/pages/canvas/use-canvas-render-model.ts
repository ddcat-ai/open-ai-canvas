import { useEffect, useMemo, useRef } from "react";

import { buildNodeGenerationInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import { sameNodeSemanticData } from "@/lib/canvas/canvas-project-domain";
import { canvasNodeRenderBudget, canvasNodeRenderPadding, CANVAS_MAX_RENDERED_CONNECTIONS, shouldReduceCanvasMediaEffects } from "@/lib/canvas/canvas-performance-mode";
import { buildCanvasNodeMentionReferenceMap, buildCanvasResourceReferences } from "@/lib/canvas/canvas-resource-references";
import { buildSkillMentionReferences } from "@/lib/canvas/canvas-skill-mentions";
import { buildCanvasSpatialIndex, canvasNodeBounds, type CanvasSpatialIndex, type CanvasSpatialIndexEntry } from "@/lib/canvas/canvas-spatial-index";
import type { Skill } from "@/services/api/skills";
import type { Asset, ImageAsset } from "@/stores/use-asset-store";
import type { DirectorScene } from "@/types/director";
import { CanvasNodeType, type CanvasConnection, type CanvasDisplayConnection, type CanvasMediaPerformanceMode, type CanvasNodeData, type ContextMenuState, type ViewportTransform } from "@/types/canvas";

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
    // These maps are consumed by both virtualization and node chrome. Building
    // them together keeps a metadata update from walking a 50k-node array six
    // separate times before React can paint the next frame.
    const nodeDerivedData = useMemo(() => {
        const collapsedBatchChildIds = new Set<string>();
        const renderHiddenNodeIds = new Set<string>();
        const frameChildrenById = new Map<string, CanvasNodeData[]>();
        const canvasImageNodes: CanvasNodeData[] = [];
        const batchRoots: CanvasNodeData[] = [];
        const batchMotionById = new Map<string, { x: number; y: number; index: number }>();
        const batchChildIndexByRootId = new Map<string, Map<string, number>>();

        for (const node of nodes) {
            const rootId = node.metadata?.batchRootId;
            const root = rootId ? nodeById.get(rootId) : undefined;
            if (root && !root.metadata?.imageBatchExpanded) {
                collapsedBatchChildIds.add(node.id);
                if (!collapsingBatchIds.has(root.id)) renderHiddenNodeIds.add(node.id);
            }

            if (rootId && collapsingBatchIds.has(rootId)) renderHiddenNodeIds.delete(node.id);
            const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
            if (parent && isFrameNode(parent)) {
                const children = frameChildrenById.get(parent.id);
                if (children) children.push(node);
                else frameChildrenById.set(parent.id, [node]);
                if (parent.metadata?.frame?.collapsed) renderHiddenNodeIds.add(node.id);
            }

            if (node.metadata?.isBatchRoot) batchRoots.push(node);
            if (node.type === CanvasNodeType.Image && node.metadata?.content && !collapsedBatchChildIds.has(node.id) && !(parent && isFrameNode(parent) && parent.metadata?.frame?.collapsed)) {
                canvasImageNodes.push(node);
            }
        }

        for (const root of batchRoots) {
            const childIndex = new Map((root.metadata?.batchChildIds || []).map((childId, index) => [childId, index]));
            batchChildIndexByRootId.set(root.id, childIndex);
        }
        for (const node of nodes) {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) continue;
            const root = nodeById.get(rootId);
            const index = batchChildIndexByRootId.get(rootId)?.get(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            batchMotionById.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        }

        const batchChildCountById = new Map<string, number>();
        for (const root of batchRoots) {
            const childIndex = batchChildIndexByRootId.get(root.id);
            const liveChildCount = [...(childIndex?.keys() || [])].filter((childId) => nodeById.get(childId)?.metadata?.batchRootId === root.id).length;
            batchChildCountById.set(root.id, liveChildCount);
        }

        return { batchChildCountById, batchMotionById, canvasImageNodes, collapsedBatchChildIds, frameChildrenById, renderHiddenNodeIds };
    }, [collapsingBatchIds, nodeById, nodes]);
    const { batchChildCountById, batchMotionById, canvasImageNodes, collapsedBatchChildIds, frameChildrenById, renderHiddenNodeIds } = nodeDerivedData;
    const connectionLayerBounds = useMemo(() => {
        const padding = (reduceMediaEffects ? 96 : 144) / Math.max(viewport.k, 0.05);
        const left = -viewport.x / viewport.k - padding;
        const top = -viewport.y / viewport.k - padding;
        const width = viewportSize.width / viewport.k + padding * 2;
        const height = viewportSize.height / viewport.k + padding * 2;
        return { left, top, width: Math.max(2, width), height: Math.max(2, height) };
    }, [reduceMediaEffects, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
    const renderBounds = useMemo(() => {
        const enterPadding = canvasNodeRenderPadding(reduceMediaEffects, false) / viewport.k;
        const retainPadding = canvasNodeRenderPadding(reduceMediaEffects, true) / viewport.k;
        const viewLeft = -viewport.x / viewport.k;
        const viewTop = -viewport.y / viewport.k;
        const viewWidth = viewportSize.width / viewport.k;
        const viewHeight = viewportSize.height / viewport.k;
        return {
            enter: { left: viewLeft - enterPadding, top: viewTop - enterPadding, right: viewLeft + viewWidth + enterPadding, bottom: viewTop + viewHeight + enterPadding },
            retain: { left: viewLeft - retainPadding, top: viewTop - retainPadding, right: viewLeft + viewWidth + retainPadding, bottom: viewTop + viewHeight + retainPadding },
        };
    }, [reduceMediaEffects, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
    const nodeSpatialIndexRef = useRef<{ source: CanvasNodeData[]; index: CanvasSpatialIndex<string> } | null>(null);
    const nodeSpatialIndex = useMemo(() => {
        const previous = nodeSpatialIndexRef.current;
        const geometryUnchanged =
            previous &&
            previous.source.length === nodes.length &&
            nodes.every((node, index) => {
                const old = previous.source[index];
                return old.id === node.id && old.position.x === node.position.x && old.position.y === node.position.y && old.width === node.width && old.height === node.height;
            });
        if (geometryUnchanged) return previous.index;
        const index = buildCanvasSpatialIndex(nodes.map((node) => ({ id: node.id, bounds: canvasNodeBounds(node), value: node.id })));
        nodeSpatialIndexRef.current = { source: nodes, index };
        return index;
    }, [nodes]);
    const renderedNodeIdsRef = useRef<Set<string>>(new Set());
    const visibleNodes = useMemo(() => {
        const frames: CanvasNodeData[] = [];
        const regular: CanvasNodeData[] = [];
        const renderedNodeIds = renderedNodeIdsRef.current;
        const renderBudget = canvasNodeRenderBudget(viewport.k);
        const forcedNodeIds = new Set([...selectedNodeIds, ...(dragPreview?.nodeIds || [])].slice(0, renderBudget));
        const candidates = nodeSpatialIndex
            .query(renderBounds.retain, renderBudget + forcedNodeIds.size)
            .map((nodeId) => nodeById.get(nodeId))
            .filter((node): node is CanvasNodeData => Boolean(node));
        const candidateIds = new Set(candidates.map((node) => node.id));
        for (const nodeId of forcedNodeIds) {
            if (candidateIds.has(nodeId)) continue;
            const node = nodeById.get(nodeId);
            if (node) candidates.push(node);
        }
        const prioritized = candidates.filter((node) => forcedNodeIds.has(node.id));
        const remaining = candidates.filter((node) => !forcedNodeIds.has(node.id)).slice(0, Math.max(0, renderBudget - prioritized.length));
        [...prioritized, ...remaining].forEach((node) => {
            if (renderHiddenNodeIds.has(node.id)) return;
            const retained = forcedNodeIds.has(node.id) || renderedNodeIds.has(node.id);
            const insideEnterBounds = node.position.x + node.width > renderBounds.enter.left && node.position.x < renderBounds.enter.right && node.position.y + node.height > renderBounds.enter.top && node.position.y < renderBounds.enter.bottom;
            if (!retained && !insideEnterBounds) return;
            (isFrameNode(node) ? frames : regular).push(node);
        });
        return [...frames, ...regular];
    }, [dragPreview, nodeById, nodeSpatialIndex, renderBounds, renderHiddenNodeIds, selectedNodeIds]);
    useEffect(() => {
        renderedNodeIdsRef.current = new Set(visibleNodes.map((node) => node.id));
    }, [visibleNodes]);

    const imageAssets = useMemo(() => assets.filter((asset): asset is ImageAsset => asset.kind === "image" && asset.status !== "archived"), [assets]);
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
        const selectedNodes = [...selectedNodeIds].map((nodeId) => nodeById.get(nodeId)).filter((node): node is CanvasNodeData => Boolean(node && !renderHiddenNodeIds.has(node.id)));
        if (selectedNodes.length < 2) return null;
        const left = Math.min(...selectedNodes.map((node) => node.position.x));
        const top = Math.min(...selectedNodes.map((node) => node.position.y));
        const right = Math.max(...selectedNodes.map((node) => node.position.x + node.width));
        const bottom = Math.max(...selectedNodes.map((node) => node.position.y + node.height));
        return { left, top, width: right - left, height: bottom - top, count: selectedNodes.length };
    }, [nodeById, renderHiddenNodeIds, selectedNodeIds]);
    const selectedVideoNodes = useMemo(
        () =>
            [...selectedNodeIds]
                .map((nodeId) => nodeById.get(nodeId))
                .filter((node): node is CanvasNodeData => Boolean(node && node.type === CanvasNodeType.Video && node.metadata?.content && !renderHiddenNodeIds.has(node.id)))
                .sort((a, b) => {
                    const shotA = a.metadata?.shotIndex ?? Number.MAX_SAFE_INTEGER;
                    const shotB = b.metadata?.shotIndex ?? Number.MAX_SAFE_INTEGER;
                    return shotA - shotB || a.position.y - b.position.y || a.position.x - b.position.x;
                }),
        [nodeById, renderHiddenNodeIds, selectedNodeIds],
    );
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
    const connectionSpatialIndex = useMemo(() => {
        const entries: CanvasSpatialIndexEntry<CanvasDisplayConnection>[] = [];
        const connectionIdsByNodeId = new Map<string, Set<string>>();
        connections.forEach((connection) => {
            if (collapsedBatchChildIds.has(connection.fromNodeId) || collapsedBatchChildIds.has(connection.toNodeId)) return;
            const fromNode = nodeById.get(connection.fromNodeId);
            const toNode = nodeById.get(connection.toNodeId);
            if (!fromNode || !toNode) return;
            const fromParent = fromNode.parentId ? nodeById.get(fromNode.parentId) : null;
            const toParent = toNode.parentId ? nodeById.get(toNode.parentId) : null;
            const displayFrom = fromParent && isFrameNode(fromParent) && fromParent.metadata?.frame?.collapsed ? fromParent : fromNode;
            const displayTo = toParent && isFrameNode(toParent) && toParent.metadata?.frame?.collapsed ? toParent : toNode;
            if (displayFrom.id === displayTo.id) return;
            const left = Math.min(displayFrom.position.x, displayTo.position.x);
            const top = Math.min(displayFrom.position.y, displayTo.position.y);
            const right = Math.max(displayFrom.position.x + displayFrom.width, displayTo.position.x + displayTo.width);
            const bottom = Math.max(displayFrom.position.y + displayFrom.height, displayTo.position.y + displayTo.height);
            const value = { connection, from: displayFrom, to: displayTo };
            entries.push({ id: connection.id, bounds: { left, top, right, bottom }, value });
            for (const nodeId of new Set([connection.fromNodeId, connection.toNodeId, displayFrom.id, displayTo.id])) {
                const ids = connectionIdsByNodeId.get(nodeId) || new Set<string>();
                ids.add(connection.id);
                connectionIdsByNodeId.set(nodeId, ids);
            }
        });
        return { index: buildCanvasSpatialIndex(entries), connectionIdsByNodeId, entriesById: new Map(entries.map((entry) => [entry.id, entry.value])) };
    }, [collapsedBatchChildIds, connections, nodeById]);
    const displayConnections = useMemo(() => {
        const candidateById = new Map<string, CanvasDisplayConnection>();
        connectionSpatialIndex.index.query(renderBounds.retain, CANVAS_MAX_RENDERED_CONNECTIONS).forEach((display) => candidateById.set(display.connection.id, display));
        dragPreview?.nodeIds.forEach((nodeId) => {
            connectionSpatialIndex.connectionIdsByNodeId.get(nodeId)?.forEach((connectionId) => {
                const display = connectionSpatialIndex.entriesById.get(connectionId);
                if (display) candidateById.set(connectionId, display);
            });
        });
        return [...candidateById.values()].flatMap(({ connection, from: sourceFrom, to: sourceTo }) => {
            const from = dragPreview?.nodeIds.has(sourceFrom.id) ? { ...sourceFrom, position: { x: sourceFrom.position.x + dragPreview.x, y: sourceFrom.position.y + dragPreview.y } } : sourceFrom;
            const to = dragPreview?.nodeIds.has(sourceTo.id) ? { ...sourceTo, position: { x: sourceTo.position.x + dragPreview.x, y: sourceTo.position.y + dragPreview.y } } : sourceTo;
            const connectionLeft = Math.min(from.position.x, to.position.x);
            const connectionTop = Math.min(from.position.y, to.position.y);
            const connectionRight = Math.max(from.position.x + from.width, to.position.x + to.width);
            const connectionBottom = Math.max(from.position.y + from.height, to.position.y + to.height);
            if (connectionRight <= renderBounds.retain.left || connectionLeft >= renderBounds.retain.right || connectionBottom <= renderBounds.retain.top || connectionTop >= renderBounds.retain.bottom) return [];
            return [{ connection, from, to }];
        });
    }, [connectionSpatialIndex, dragPreview, renderBounds]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        const configNodeIds = new Set<string>();
        visibleNodes.forEach((node) => {
            if (node.type === CanvasNodeType.Config) configNodeIds.add(node.id);
        });
        selectedNodeIds.forEach((nodeId) => {
            if (nodeById.get(nodeId)?.type === CanvasNodeType.Config) configNodeIds.add(nodeId);
        });
        if (dialogNodeId && nodeById.get(dialogNodeId)?.type === CanvasNodeType.Config) configNodeIds.add(dialogNodeId);
        configNodeIds.forEach((nodeId) => map.set(nodeId, buildNodeGenerationInputs(nodeId, semanticNodes, connections)));
        return map;
    }, [connections, dialogNodeId, nodeById, selectedNodeIds, semanticNodes, visibleNodes]);
    const activeDirectorNode = useMemo(() => semanticNodes.find((node) => node.id === directorNodeId) || null, [directorNodeId, semanticNodes]);
    const activeStylePresetId = useMemo(() => semanticNodes.find((node) => node.metadata?.workflowKind === "styleboard")?.metadata?.stylePresetId, [semanticNodes]);
    const activeScriptNode = useMemo(() => semanticNodes.find((node) => node.id === scriptEditorNodeId && node.type === CanvasNodeType.Script) || null, [scriptEditorNodeId, semanticNodes]);
    const activeDirectorScene = useMemo(() => directorScenes?.find((scene) => scene.id === activeDirectorNode?.metadata?.directorSceneId) || null, [activeDirectorNode?.metadata?.directorSceneId, directorScenes]);
    const resourceReferenceTargetNodes = useMemo(() => {
        const targetNodes = [...visibleNodes];
        const activeId = dialogNodeId || activeNodeId;
        if (activeId) {
            const activeNode = nodeById.get(activeId);
            if (activeNode) targetNodes.push(activeNode);
        }
        return targetNodes;
    }, [activeNodeId, dialogNodeId, nodeById, visibleNodes]);
    const canvasResourceReferences = useMemo(
        () => buildCanvasResourceReferences(semanticNodes, connections, dialogNodeId || activeNodeId, resourceReferenceTargetNodes),
        [activeNodeId, connections, dialogNodeId, resourceReferenceTargetNodes, semanticNodes],
    );
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const skillMentionReferences = useMemo(() => buildSkillMentionReferences(addedSkills), [addedSkills]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = buildCanvasNodeMentionReferenceMap(semanticNodes, connections, visibleNodes);
        if (!skillMentionReferences.length) return map;
        map.forEach((references, nodeId) => map.set(nodeId, [...references, ...skillMentionReferences]));
        return map;
    }, [connections, semanticNodes, skillMentionReferences, visibleNodes]);

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
