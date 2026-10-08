import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createPrevisSceneFromTemplate, type PrevisTemplateId } from "@/lib/canvas/previs/previs-templates";
import { mergePrevisOutputPreview, upsertPrevisSceneById } from "@/lib/canvas/previs/previs-session";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { PrevisScene, PrevisSceneOutput } from "@/types/previs";

type UseCanvasPrevisOptions = {
    projectId: string;
    domainProjectId?: string;
    previsNodeId: string | null;
    previsScenes: PrevisScene[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    getCanvasCenter: () => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setPrevisNodeId: Dispatch<SetStateAction<string | null>>;
    updateProject: (projectId: string, patch: { previsScenes: PrevisScene[] }) => void;
};

const NODE_STATUS_IDLE = "idle" as const;
const PREVIS_NODE_SIZE = { width: 520, height: 340 } as const;
const PREVIS_LEGACY_NODE_SIZE = { width: 760, height: 500 } as const;

function shouldUpgradePrevisNodeSize(node: CanvasNodeData) {
    // 只迁移预演台曾经写入的默认尺寸；用户后续手动调整过的节点保持原样。
    const isLegacyDefault = node.width === PREVIS_LEGACY_NODE_SIZE.width && node.height === PREVIS_LEGACY_NODE_SIZE.height;
    const isEarlyCompactDefault = node.width <= 720 && node.height <= 320;
    return isLegacyDefault || isEarlyCompactDefault;
}

/**
 * 项目真实内存权威在 useCanvasStore.getState().projects；
 * 闭包里的 previsScenes 只作为 store 尚未就绪时的兜底。
 */
function currentPrevisScenes(projectId: string, fallback: PrevisScene[]) {
    const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
    return project?.previsScenes ?? fallback;
}
export function useCanvasPrevis({
    projectId,
    domainProjectId,
    previsNodeId,
    previsScenes,
    nodesRef,
    connectionsRef,
    getCanvasCenter,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setPrevisNodeId,
    updateProject,
}: UseCanvasPrevisOptions) {
    const { message } = App.useApp();
    const projectIdRef = useRef<string | null>(projectId);
    projectIdRef.current = projectId;

    useEffect(() => {
        projectIdRef.current = projectId;
        return () => {
            if (projectIdRef.current === projectId) projectIdRef.current = null;
        };
    }, [projectId]);

    /**
     * 新建镜头。templateId 由调用方（模板选择弹窗）显式给出 —— 这里不设默认模板，
     * 否则又会回到「无条件塞一个默认演员」的老问题。
     */
    const createPrevisShot = useCallback((templateId: PrevisTemplateId, position?: Position) => {
        const shots = nodesRef.current.filter((node) => node.metadata?.workflowKind === "shot");
        const shotIndex = Math.max(0, ...shots.map((node) => node.metadata?.shotIndex || 0)) + 1;
        let scene = createPrevisSceneFromTemplate(templateId, `镜头 ${shotIndex}`);
        const shot = scene.shots[0];
        scene = { ...scene, shots: [{ ...shot, name: `镜头 ${shotIndex}` }] };
        const node = createCanvasNode(CanvasNodeType.Video, position || getCanvasCenter(), {
            workflowKind: "shot",
            workflowTitle: `镜头 ${shotIndex}`,
            shotIndex,
            generationMode: "video",
            videoEditOperation: "text_to_video",
            status: NODE_STATUS_IDLE,
            composerContent: "",
            previsSceneId: scene.id,
            previsShotId: shot.id,
        });
        node.title = `镜头 ${shotIndex}`;
        node.width = PREVIS_NODE_SIZE.width;
        node.height = PREVIS_NODE_SIZE.height;
        const nextNodes = [...nodesRef.current, node];
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        updateProject(projectId, { previsScenes: upsertPrevisSceneById(currentPrevisScenes(projectId, previsScenes), scene) });
        message.success("已创建预演台节点，点击缩略图进入编辑");
    }, [previsScenes, getCanvasCenter, message, nodesRef, projectId, setNodes, setSelectedConnectionId, setSelectedNodeIds, updateProject]);

    const openPrevisWorkbench = useCallback((nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node || node.metadata?.workflowKind !== "shot") return;
        if (shouldUpgradePrevisNodeSize(node)) {
            const upgradedNodes = nodesRef.current.map((item) => item.id === nodeId ? { ...item, width: PREVIS_NODE_SIZE.width, height: PREVIS_NODE_SIZE.height } : item);
            nodesRef.current = upgradedNodes;
            setNodes(upgradedNodes);
        }
        let scene = currentPrevisScenes(projectId, previsScenes).find((item) => item.id === node.metadata?.previsSceneId);
        if (!scene) {
            // 孤儿节点修复路径：节点存在但场景丢了。这不是「新建」，不弹模板选择，
            // 用空场景兜底 —— 绝不在用户没选过的情况下塞演员进去。
            scene = createPrevisSceneFromTemplate("empty", node.metadata?.workflowTitle || node.title || "镜头场景");
            const shot = scene.shots[0];
            scene = { ...scene, shots: [{ ...shot, name: node.metadata?.workflowTitle || node.title || shot.name, prompt: node.metadata?.workflowDescription || "" }] };
            const previsSceneId = scene.id;
            const previsShotId = shot.id;
            setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, metadata: { ...item.metadata, previsSceneId, previsShotId } } : item));
            updateProject(projectId, { previsScenes: upsertPrevisSceneById(currentPrevisScenes(projectId, previsScenes), scene) });
        }
        setPrevisNodeId(nodeId);
    }, [previsScenes, nodesRef, projectId, setPrevisNodeId, setNodes, updateProject]);

    /** 每次保存都基于 store 中最新 previsScenes upsert，避免旧闭包数组覆盖并发保存。 */
    const savePrevisScene = useCallback((scene: PrevisScene) => {
        updateProject(projectId, { previsScenes: upsertPrevisSceneById(currentPrevisScenes(projectId, previsScenes), scene) });
    }, [previsScenes, projectId, updateProject]);

    const applyPrevisOutput = useCallback(async (output: PrevisSceneOutput) => {
        const outputProjectId = projectId;
        if (projectIdRef.current !== outputProjectId) throw new Error("画布项目已切换，请重试");
        const sourceNodeAtStart = nodesRef.current.find((item) => item.id === previsNodeId);
        if (!sourceNodeAtStart || sourceNodeAtStart.metadata?.previsSceneId !== output.scene.id) throw new Error("镜头节点不存在或场景已切换");
        const sourceNodeId = sourceNodeAtStart.id;
        const [image, videoUpload] = await Promise.all([
            uploadImage(output.beauty),
            output.clayVideo ? uploadMediaFile(output.clayVideo, "previs-clay") : Promise.resolve(null),
        ]);
        // 上传期间项目、节点和镜头都可能变化。以当前权威状态重新核验并合并，
        // 不允许旧输出写入另一项目，也不允许旧 scene 快照覆盖并发编辑。
        const outputProject = useCanvasStore.getState().projects.find((item) => item.id === outputProjectId);
        const sourceNode = nodesRef.current.find((item) => item.id === sourceNodeId);
        const latestScene = outputProject?.previsScenes.find((item) => item.id === output.scene.id);
        if (projectIdRef.current !== outputProjectId || !outputProject || !sourceNode || sourceNode.metadata?.previsSceneId !== output.scene.id || !latestScene || !latestScene.shots.some((shot) => shot.id === output.shot.id)) throw new Error("输出期间项目或镜头已切换、删除，请重试");
        const previewId = sourceNode.metadata?.previsPreviewNodeId || `image-previs-${Date.now()}`;
        const mergedScene = mergePrevisOutputPreview(latestScene, { sceneId: output.scene.id, shotId: output.shot.id, previewNodeId: previewId });
        if (!mergedScene) throw new Error("输出期间镜头已切换或删除，请重试");
        const previewSize = fitNodeSize(image.width, image.height);
        const nextNodes = [...nodesRef.current];
        const previewIndex = nextNodes.findIndex((item) => item.id === previewId);
        const existingPreview = previewIndex >= 0 ? nextNodes[previewIndex] : null;
        const previewNode: CanvasNodeData = {
            ...existingPreview,
            id: previewId,
            type: CanvasNodeType.Image,
            title: `${sourceNode.title} · 预演台构图`,
            position: existingPreview?.position || { x: sourceNode.position.x - previewSize.width - 36, y: sourceNode.position.y },
            width: previewSize.width,
            height: previewSize.height,
            metadata: { ...existingPreview?.metadata, ...imageMetadata(image), prompt: output.prompt, workflowKind: "reference_set", assetTags: ["预演台构图", `镜头:${sourceNode.title}`], producedModel: undefined, producedModelCandidate: undefined },
        };
        if (previewIndex >= 0) nextNodes[previewIndex] = previewNode;
        else nextNodes.push(previewNode);

        let clayVideoId = sourceNode.metadata?.previsClayVideoNodeId;
        if (videoUpload) {
            clayVideoId ||= `video-previs-clay-${Date.now()}`;
            const videoIndex = nextNodes.findIndex((item) => item.id === clayVideoId);
            const existingVideo = videoIndex >= 0 ? nextNodes[videoIndex] : null;
            const videoNode: CanvasNodeData = {
                ...existingVideo,
                id: clayVideoId,
                type: CanvasNodeType.Video,
                title: `${sourceNode.title} · 白膜视频`,
                position: existingVideo?.position || { x: sourceNode.position.x, y: sourceNode.position.y + sourceNode.height + 48 },
                width: existingVideo?.width || 360,
                height: existingVideo?.height || 220,
                metadata: { ...existingVideo?.metadata, ...videoMetadata(videoUpload), prompt: output.prompt, workflowKind: "reference_video", assetTags: ["预演台白膜", `镜头:${sourceNode.title}`], producedModel: undefined, producedModelCandidate: undefined },
            };
            if (videoIndex >= 0) nextNodes[videoIndex] = videoNode;
            else nextNodes.push(videoNode);
        }

        const nextConnections = [...connectionsRef.current];
        [previewId, videoUpload ? clayVideoId : null].filter((id): id is string => Boolean(id)).forEach((id) => {
            if (!nextConnections.some((connection) => connection.fromNodeId === id && connection.toNodeId === sourceNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: id, toNodeId: sourceNode.id });
        });
        const retiredReferenceIds = new Set([sourceNode.metadata?.previsDepthNodeId, sourceNode.metadata?.previsNormalNodeId].filter(Boolean));
        const referenceAssetNodeIds = Array.from(new Set([
            ...(sourceNode.metadata?.referenceAssetNodeIds || []).filter((id) => !retiredReferenceIds.has(id)),
            previewId,
            ...(clayVideoId ? [clayVideoId] : []),
        ]));
        const previsMetadata: Partial<CanvasNodeMetadata> = {
            previsSceneId: output.scene.id,
            previsShotId: output.shot.id,
            previsPreviewNodeId: previewId,
            previsDepthNodeId: undefined,
            previsNormalNodeId: undefined,
            previsClayVideoNodeId: clayVideoId,
            composerContent: output.prompt,
            prompt: output.prompt,
            videoCameraMoveId: output.shot.cameraMove,
            videoCameraMovePrompt: output.prompt,
            referenceAssetNodeIds,
        };
        const mediaNodes = nextNodes.filter((item) => item.id === previewId || Boolean(clayVideoId && item.id === clayVideoId));
        const assetIds = new Map<string, string>();
        for (const mediaNode of mediaNodes) {
            const result = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: mediaNode, source: "canvas-manual" });
            assetIds.set(mediaNode.id, result.assetId);
        }
        const finalizedNodes = nextNodes.map((item) => {
            const assetId = assetIds.get(item.id);
            if (assetId) return { ...item, metadata: { ...item.metadata, assetId } };
            return item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, ...previsMetadata } } : item;
        });
        nodesRef.current = finalizedNodes;
        connectionsRef.current = nextConnections;
        setNodes(finalizedNodes);
        setConnections(nextConnections);
        savePrevisScene(mergedScene);
    }, [connectionsRef, previsNodeId, domainProjectId, nodesRef, projectId, savePrevisScene, setConnections, setNodes]);

    return { applyPrevisOutput, createPrevisShot, openPrevisWorkbench, savePrevisScene };
}
