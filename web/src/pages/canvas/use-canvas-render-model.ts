import { useEffect, useMemo, useRef, useState } from "react";

import { buildNodeGenerationInputs, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import { sameNodeSemanticData } from "@/lib/canvas/canvas-project-domain";
import { canvasNodeRenderBudget, canvasNodeRenderPadding, CANVAS_MAX_RENDERED_CONNECTIONS } from "@/lib/canvas/canvas-render-budget";
import { buildCanvasNodeMentionReferenceMap, buildCanvasResourceReferences, buildToolMentionReference, parseToolMentionTokens } from "@/lib/canvas/canvas-resource-references";
import { buildSkillMentionReferences } from "@/lib/canvas/canvas-skill-mentions";
import { buildCanvasConnectionIndex, type CanvasIndexedConnection } from "@/lib/canvas/canvas-connection-index";
import { retainCanvasLayoutNodes } from "@/lib/canvas/canvas-layout-snapshot";
import { buildCanvasSpatialIndex, canvasNodeBounds, type CanvasSpatialIndex } from "@/lib/canvas/canvas-spatial-index";
import { canvasOverviewMode, resolveCanvasNodeLOD, type CanvasNodeRenderLOD } from "@/lib/canvas/canvas-node-lod";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import { intersectsCanvasBounds, selectCanvasVisibleNodes } from "@/lib/canvas/canvas-node-visibility";
import type { Skill } from "@/services/api/skills";
import type { Asset, ImageAsset } from "@/stores/use-asset-store";
import type { PrevisScene } from "@/types/previs";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ContextMenuState, type ViewportTransform } from "@/types/canvas";

type DragPreview = { x: number; y: number; nodeIds: Set<string> } | null;

type UseCanvasRenderModelOptions = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    assets: Asset[];
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    selectedNodeIds: Set<string>;
    hoveredNodeId: string | null;
    dragPreview: DragPreview;
    collapsingBatchIds: Set<string>;
    addedSkills: Skill[];
    previsScenes?: PrevisScene[];
    infoNodeId: string | null;
    cropNodeId: string | null;
    maskEditNodeId: string | null;
    imageEditNodeId: string | null;
    annotationNodeId: string | null;
    splitNodeId: string | null;
    upscaleNodeId: string | null;
    superResolveNodeId: string | null;
    angleNodeId: string | null;
    lightingNodeId: string | null;
    emotionNodeId: string | null;
    previewNodeId: string | null;
    contextMenu: ContextMenuState | null;
    previsNodeId: string | null;
    scriptEditorNodeId: string | null;
    dialogNodeId: string | null;
};

export function useCanvasRenderModel({
    nodes,
    connections,
    assets,
    viewport,
    viewportSize,
    selectedNodeIds,
    hoveredNodeId,
    dragPreview,
    collapsingBatchIds,
    addedSkills,
    previsScenes,
    infoNodeId,
    cropNodeId,
    maskEditNodeId,
    imageEditNodeId,
    annotationNodeId,
    splitNodeId,
    upscaleNodeId,
    superResolveNodeId,
    angleNodeId,
    lightingNodeId,
    emotionNodeId,
    previewNodeId,
    contextMenu,
    previsNodeId,
    scriptEditorNodeId,
    dialogNodeId,
}: UseCanvasRenderModelOptions) {
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    // These maps are consumed by both virtualization and node chrome. Building
    // them together keeps a metadata update from walking a 50k-node array six
    // separate times before React can paint the next frame.
    const nodeDerivedData = useMemo(() => {
        const collapsedBatchChildIds = new Set<string>();
        const renderHiddenNodeIds = new Set<string>();
        const frameChildrenById = new Map<string, CanvasNodeData[]>();
        const canvasImageNodes: CanvasNodeData[] = [];
        const batchChildNodes: CanvasNodeData[] = [];
        const batchMotionById = new Map<string, { x: number; y: number; index: number }>();
        const batchChildIndexByRootId = new Map<string, Map<string, number>>();
        const batchChildCountById = new Map<string, number>();

        for (const node of nodes) {
            const rootId = node.metadata?.batchRootId;
            const root = rootId ? nodeById.get(rootId) : undefined;
            if (root && !root.metadata?.imageBatchExpanded) {
                collapsedBatchChildIds.add(node.id);
                if (!collapsingBatchIds.has(root.id)) renderHiddenNodeIds.add(node.id);
            }

            if (rootId && collapsingBatchIds.has(rootId)) renderHiddenNodeIds.delete(node.id);
            if (rootId) batchChildNodes.push(node);
            const childIndex = root?.metadata?.isBatchRoot
                ? batchChildIndexByRootId.get(root.id) || new Map((root.metadata.batchChildIds || []).map((childId, index) => [childId, index]))
                : undefined;
            if (root?.metadata?.isBatchRoot && childIndex && !batchChildIndexByRootId.has(root.id)) batchChildIndexByRootId.set(root.id, childIndex);
            if (root && childIndex?.has(node.id)) batchChildCountById.set(root.id, (batchChildCountById.get(root.id) || 0) + 1);
            const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
            if (parent && isFrameNode(parent)) {
                const children = frameChildrenById.get(parent.id);
                if (children) children.push(node);
                else frameChildrenById.set(parent.id, [node]);
                if (parent.metadata?.frame?.collapsed) renderHiddenNodeIds.add(node.id);
            }

            if (node.metadata?.isBatchRoot) {
                if (!batchChildIndexByRootId.has(node.id)) batchChildIndexByRootId.set(node.id, new Map((node.metadata.batchChildIds || []).map((childId, index) => [childId, index])));
                if (!batchChildCountById.has(node.id)) batchChildCountById.set(node.id, 0);
            }
            if (node.type === CanvasNodeType.Image && node.metadata?.content && !collapsedBatchChildIds.has(node.id) && !(parent && isFrameNode(parent) && parent.metadata?.frame?.collapsed)) {
                canvasImageNodes.push(node);
            }
        }

        for (const node of batchChildNodes) {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) continue;
            const root = nodeById.get(rootId);
            const index = batchChildIndexByRootId.get(rootId)?.get(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            batchMotionById.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        }

        return { batchChildCountById, batchMotionById, canvasImageNodes, collapsedBatchChildIds, frameChildrenById, renderHiddenNodeIds };
    }, [collapsingBatchIds, nodeById, nodes]);
    const { batchChildCountById, batchMotionById, canvasImageNodes, collapsedBatchChildIds, frameChildrenById, renderHiddenNodeIds } = nodeDerivedData;
    const connectionLayerBounds = useMemo(() => {
        const padding = 144 / Math.max(viewport.k, 0.05);
        const left = -viewport.x / viewport.k - padding;
        const top = -viewport.y / viewport.k - padding;
        const width = viewportSize.width / viewport.k + padding * 2;
        const height = viewportSize.height / viewport.k + padding * 2;
        return { left, top, width: Math.max(2, width), height: Math.max(2, height) };
    }, [viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
    const renderBounds = useMemo(() => {
        const enterPadding = canvasNodeRenderPadding(false) / viewport.k;
        const retainPadding = canvasNodeRenderPadding(true) / viewport.k;
        const viewLeft = -viewport.x / viewport.k;
        const viewTop = -viewport.y / viewport.k;
        const viewWidth = viewportSize.width / viewport.k;
        const viewHeight = viewportSize.height / viewport.k;
        return {
            view: { left: viewLeft, top: viewTop, right: viewLeft + viewWidth, bottom: viewTop + viewHeight },
            enter: { left: viewLeft - enterPadding, top: viewTop - enterPadding, right: viewLeft + viewWidth + enterPadding, bottom: viewTop + viewHeight + enterPadding },
            retain: { left: viewLeft - retainPadding, top: viewTop - retainPadding, right: viewLeft + viewWidth + retainPadding, bottom: viewTop + viewHeight + retainPadding },
        };
    }, [viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
    const layoutNodesRef = useRef<CanvasNodeData[]>(nodes);
    const layoutNodes = useMemo(() => {
        const retained = retainCanvasLayoutNodes(layoutNodesRef.current, nodes);
        layoutNodesRef.current = retained;
        return retained;
    }, [nodes]);
    const nodeSpatialIndexRef = useRef<{ source: CanvasNodeData[]; index: CanvasSpatialIndex<string> } | null>(null);
    const nodeSpatialIndex = useMemo(() => {
        const previous = nodeSpatialIndexRef.current;
        if (previous?.source === layoutNodes) return previous.index;
        const index = buildCanvasSpatialIndex(layoutNodes.map((node) => ({ id: node.id, bounds: canvasNodeBounds(node), value: node.id })));
        nodeSpatialIndexRef.current = { source: layoutNodes, index };
        return index;
    }, [layoutNodes]);
    const renderedNodeIdsRef = useRef<Set<string>>(new Set());
    const forcedRenderNodeIds = useMemo(() => new Set([...selectedNodeIds, ...(dragPreview?.nodeIds || [])]), [dragPreview, selectedNodeIds]);
    const candidateNodes = useMemo(() => {
        const frames: CanvasNodeData[] = [];
        const regular: CanvasNodeData[] = [];
        selectCanvasVisibleNodes({
            index: nodeSpatialIndex,
            nodeById,
            ...renderBounds,
            hiddenIds: renderHiddenNodeIds,
            retainedIds: renderedNodeIdsRef.current,
            forcedIds: forcedRenderNodeIds,
            budget: canvasNodeRenderBudget(viewport.k),
        }).forEach((node) => {
            (isFrameNode(node) ? frames : regular).push(node);
        });
        return [...frames, ...regular];
    }, [forcedRenderNodeIds, nodeById, nodeSpatialIndex, renderBounds, renderHiddenNodeIds, viewport.k]);
    const immediateRenderNodeIds = useMemo(() => {
        const ids = new Set(forcedRenderNodeIds);
        candidateNodes.forEach((node) => {
            if (ids.has(node.id) || intersectsCanvasBounds(canvasNodeBounds(node), renderBounds.view)) ids.add(node.id);
        });
        return ids;
    }, [candidateNodes, forcedRenderNodeIds, renderBounds.view]);
    const [mountedNodeIds, setMountedNodeIds] = useState<Set<string>>(() => new Set());
    useEffect(() => {
        const candidateIds = new Set(candidateNodes.map((node) => node.id));
        setMountedNodeIds((current) => {
            const next = new Set<string>();
            current.forEach((id) => {
                if (candidateIds.has(id)) next.add(id);
            });
            immediateRenderNodeIds.forEach((id) => next.add(id));
            return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
        });
        const queue = candidateNodes
            .filter((node) => !immediateRenderNodeIds.has(node.id))
            .sort((left, right) => {
                const leftDistance = distanceToBounds(canvasNodeBounds(left), renderBounds.view);
                const rightDistance = distanceToBounds(canvasNodeBounds(right), renderBounds.view);
                return leftDistance - rightDistance;
            });
        let cursor = 0;
        let frameId = 0;
        const schedule = () => {
            frameId = requestAnimationFrame(() => {
                const startedAt = performance.now();
                const additions: string[] = [];
                while (cursor < queue.length && additions.length < 12 && performance.now() - startedAt < 4) additions.push(queue[cursor++].id);
                if (additions.length) {
                    setMountedNodeIds((current) => {
                        if (additions.every((id) => current.has(id))) return current;
                        const next = new Set(current);
                        additions.forEach((id) => next.add(id));
                        return next;
                    });
                }
                if (cursor < queue.length) schedule();
            });
        };
        if (queue.length && typeof window !== "undefined") schedule();
        return () => cancelAnimationFrame(frameId);
    }, [candidateNodes, immediateRenderNodeIds, renderBounds.view]);
    const visibleNodes = useMemo(() => candidateNodes.filter((node) => immediateRenderNodeIds.has(node.id) || mountedNodeIds.has(node.id)), [candidateNodes, immediateRenderNodeIds, mountedNodeIds]);
    const overviewRef = useRef(false);
    const overview = canvasOverviewMode(viewport.k, overviewRef.current);
    useEffect(() => { overviewRef.current = overview; }, [overview]);
    const nodeRenderLODById = useMemo(() => {
        const result = new Map<string, CanvasNodeRenderLOD>();
        for (const node of visibleNodes) {
            // Selection/drag keeps every node visible, not every editor mounted.
            const editing = selectedNodeIds.size === 1 && selectedNodeIds.has(node.id);
            const inView = intersectsCanvasBounds(canvasNodeBounds(node), renderBounds.view);
            const inEntry = intersectsCanvasBounds(canvasNodeBounds(node), renderBounds.enter);
            result.set(node.id, resolveCanvasNodeLOD(overview, inView, inEntry, editing));
        }
        return result;
    }, [overview, selectedNodeIds, renderBounds.enter, renderBounds.view, visibleNodes]);
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

    const selectedNodeIdForToolbar = selectedNodeIds.size === 1 ? [...selectedNodeIds][0] : null;
    const toolbarCandidate = selectedNodeIdForToolbar ? nodeById.get(selectedNodeIdForToolbar) || null : null;
    const toolbarNode = isFrameNode(toolbarCandidate) ? null : toolbarCandidate;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const imageEditNode = imageEditNodeId ? nodeById.get(imageEditNodeId) || null : null;
    const annotationNode = annotationNodeId ? nodeById.get(annotationNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const lightingNode = lightingNodeId ? nodeById.get(lightingNodeId) || null : null;
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
    const connectionSpatialIndex = useMemo(() => buildCanvasConnectionIndex(layoutNodes, connections), [connections, layoutNodes]);
    const displayConnections = useMemo(() => {
        const candidateById = new Map<string, CanvasIndexedConnection>();
        connectionSpatialIndex.index.query(renderBounds.retain, CANVAS_MAX_RENDERED_CONNECTIONS).forEach((display) => candidateById.set(display.connection.id, display));
        dragPreview?.nodeIds.forEach((nodeId) => {
            connectionSpatialIndex.connectionIdsByNodeId.get(nodeId)?.forEach((connectionId) => {
                const display = connectionSpatialIndex.entriesById.get(connectionId);
                if (display) candidateById.set(connectionId, display);
            });
        });
        return [...candidateById.values()].flatMap(({ connection, fromId, toId }) => {
            const sourceFrom = nodeById.get(fromId);
            const sourceTo = nodeById.get(toId);
            if (!sourceFrom || !sourceTo) return [];
            const from = dragPreview?.nodeIds.has(fromId) ? { ...sourceFrom, position: { x: sourceFrom.position.x + dragPreview.x, y: sourceFrom.position.y + dragPreview.y } } : sourceFrom;
            const to = dragPreview?.nodeIds.has(toId) ? { ...sourceTo, position: { x: sourceTo.position.x + dragPreview.x, y: sourceTo.position.y + dragPreview.y } } : sourceTo;
            const connectionLeft = Math.min(from.position.x, to.position.x);
            const connectionTop = Math.min(from.position.y, to.position.y);
            const connectionRight = Math.max(from.position.x + from.width, to.position.x + to.width);
            const connectionBottom = Math.max(from.position.y + from.height, to.position.y + to.height);
            if (connectionRight <= renderBounds.retain.left || connectionLeft >= renderBounds.retain.right || connectionBottom <= renderBounds.retain.top || connectionTop >= renderBounds.retain.bottom) return [];
            return [{ connection, from, to }];
        });
    }, [connectionSpatialIndex, dragPreview, nodeById, renderBounds]);

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
    const activePrevisNode = useMemo(() => semanticNodes.find((node) => node.id === previsNodeId) || null, [previsNodeId, semanticNodes]);
    const activeStylePresetId = useMemo(() => semanticNodes.find((node) => node.metadata?.workflowKind === "styleboard")?.metadata?.stylePresetId, [semanticNodes]);
    const activeScriptNode = useMemo(() => semanticNodes.find((node) => node.id === scriptEditorNodeId && node.type === CanvasNodeType.Script) || null, [scriptEditorNodeId, semanticNodes]);
    const activePrevisScene = useMemo(() => previsScenes?.find((scene) => scene.id === activePrevisNode?.metadata?.previsSceneId) || null, [activePrevisNode?.metadata?.previsSceneId, previsScenes]);
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
    const toolMentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildToolMentionReference>[]>();
        for (const node of semanticNodes) {
            const text = nodeGenerationPrompt(node);
            const tokens = parseToolMentionTokens(text);
            if (!tokens.length) continue;
            const seen = new Set<string>();
            const refs: ReturnType<typeof buildToolMentionReference>[] = [];
            for (const { type, toolId, label, icon } of tokens) {
                const identity = `${type}:${toolId}`;
                if (seen.has(identity)) continue;
                seen.add(identity);
                refs.push(buildToolMentionReference(toolId, label, type, icon));
            }
            if (refs.length) map.set(node.id, refs);
        }
        return map;
    }, [semanticNodes]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = buildCanvasNodeMentionReferenceMap(semanticNodes, connections, visibleNodes);
        if (!skillMentionReferences.length && toolMentionReferencesByNodeId.size === 0) return map;
        map.forEach((references, nodeId) => {
            const extras = [...skillMentionReferences, ...(toolMentionReferencesByNodeId.get(nodeId) ?? [])];
            if (extras.length) map.set(nodeId, [...references, ...extras]);
        });
        return map;
    }, [connections, semanticNodes, skillMentionReferences, toolMentionReferencesByNodeId, visibleNodes]);

    return {
        activePrevisNode,
        activePrevisScene,
        activeNodeId,
        activeScriptNode,
        activeStylePresetId,
        angleNode,
        lightingNode,
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
        imageEditNode,
        mentionReferencesByNodeId,
        nodeById,
        nodeRenderLODById,
        previewNode,
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
        visibleNodes,
    };
}

function distanceToBounds(node: { left: number; top: number; right: number; bottom: number }, bounds: { left: number; top: number; right: number; bottom: number }) {
    const dx = node.right < bounds.left ? bounds.left - node.right : node.left > bounds.right ? node.left - bounds.right : 0;
    const dy = node.bottom < bounds.top ? bounds.top - node.bottom : node.top > bounds.bottom ? node.top - bounds.bottom : 0;
    return Math.hypot(dx, dy);
}
