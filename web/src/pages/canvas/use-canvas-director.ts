import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createDirectorSceneFromTemplate, type DirectorTemplateId } from "@/lib/canvas/director/director-templates";
import { mergeDirectorOutputPreview, upsertDirectorSceneById } from "@/lib/canvas/director/director-session";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { DirectorScene, DirectorSceneOutput } from "@/types/director";

type UseCanvasDirectorOptions = {
    projectId: string;
    directorNodeId: string | null;
    directorScenes: DirectorScene[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    getCanvasCenter: () => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDirectorNodeId: Dispatch<SetStateAction<string | null>>;
    updateProject: (projectId: string, patch: { directorScenes: DirectorScene[] }) => void;
};

const NODE_STATUS_IDLE = "idle" as const;

/**
 * 项目真实内存权威在 useCanvasStore.getState().projects；
 * 闭包里的 directorScenes 只作为 store 尚未就绪时的兜底。
 */
function currentDirectorScenes(projectId: string, fallback: DirectorScene[]) {
    const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
    return project?.directorScenes ?? fallback;
}
export function useCanvasDirector({
    projectId,
    directorNodeId,
    directorScenes,
    nodesRef,
    connectionsRef,
    getCanvasCenter,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDirectorNodeId,
    updateProject,
}: UseCanvasDirectorOptions) {
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
    const createDirectorShot = useCallback((templateId: DirectorTemplateId, position?: Position) => {
        const shots = nodesRef.current.filter((node) => node.metadata?.workflowKind === "shot");
        const shotIndex = Math.max(0, ...shots.map((node) => node.metadata?.shotIndex || 0)) + 1;
        let scene = createDirectorSceneFromTemplate(templateId, `镜头 ${shotIndex}`);
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
            directorSceneId: scene.id,
            directorShotId: shot.id,
        });
        node.title = `镜头 ${shotIndex}`;
        node.height = 300;
        const nextNodes = [...nodesRef.current, node];
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        updateProject(projectId, { directorScenes: upsertDirectorSceneById(currentDirectorScenes(projectId, directorScenes), scene) });
        message.success("已创建导演台节点，点击缩略图进入编辑");
    }, [directorScenes, getCanvasCenter, message, nodesRef, projectId, setNodes, setSelectedConnectionId, setSelectedNodeIds, updateProject]);

    const openDirectorWorkbench = useCallback((nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node || node.metadata?.workflowKind !== "shot") return;
        let scene = currentDirectorScenes(projectId, directorScenes).find((item) => item.id === node.metadata?.directorSceneId);
        if (!scene) {
            // 孤儿节点修复路径：节点存在但场景丢了。这不是「新建」，不弹模板选择，
            // 用空场景兜底 —— 绝不在用户没选过的情况下塞演员进去。
            scene = createDirectorSceneFromTemplate("empty", node.metadata?.workflowTitle || node.title || "镜头场景");
            const shot = scene.shots[0];
            scene = { ...scene, shots: [{ ...shot, name: node.metadata?.workflowTitle || node.title || shot.name, prompt: node.metadata?.workflowDescription || "" }] };
            const directorSceneId = scene.id;
            const directorShotId = shot.id;
            setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, metadata: { ...item.metadata, directorSceneId, directorShotId } } : item));
            updateProject(projectId, { directorScenes: upsertDirectorSceneById(currentDirectorScenes(projectId, directorScenes), scene) });
        }
        setDirectorNodeId(nodeId);
    }, [directorScenes, nodesRef, projectId, setDirectorNodeId, setNodes, updateProject]);

    /** 每次保存都基于 store 中最新 directorScenes upsert，避免旧闭包数组覆盖并发保存。 */
    const saveDirectorScene = useCallback((scene: DirectorScene) => {
        updateProject(projectId, { directorScenes: upsertDirectorSceneById(currentDirectorScenes(projectId, directorScenes), scene) });
    }, [directorScenes, projectId, updateProject]);

    const applyDirectorOutput = useCallback(async (output: DirectorSceneOutput) => {
        const outputProjectId = projectId;
        if (projectIdRef.current !== outputProjectId) throw new Error("画布项目已切换，请重试");
        const sourceNodeAtStart = nodesRef.current.find((item) => item.id === directorNodeId);
        if (!sourceNodeAtStart || sourceNodeAtStart.metadata?.directorSceneId !== output.scene.id) throw new Error("镜头节点不存在或场景已切换");
        const sourceNodeId = sourceNodeAtStart.id;
        const [image, videoUpload] = await Promise.all([
            uploadImage(output.beauty),
            output.clayVideo ? uploadMediaFile(output.clayVideo, "director-clay") : Promise.resolve(null),
        ]);
        // 上传期间项目、节点和镜头都可能变化。以当前权威状态重新核验并合并，
        // 不允许旧输出写入另一项目，也不允许旧 scene 快照覆盖并发编辑。
        const outputProject = useCanvasStore.getState().projects.find((item) => item.id === outputProjectId);
        const sourceNode = nodesRef.current.find((item) => item.id === sourceNodeId);
        const latestScene = outputProject?.directorScenes.find((item) => item.id === output.scene.id);
        if (projectIdRef.current !== outputProjectId || !outputProject || !sourceNode || sourceNode.metadata?.directorSceneId !== output.scene.id || !latestScene || !latestScene.shots.some((shot) => shot.id === output.shot.id)) throw new Error("输出期间项目或镜头已切换、删除，请重试");
        const previewId = sourceNode.metadata?.directorPreviewNodeId || `image-director-${Date.now()}`;
        const mergedScene = mergeDirectorOutputPreview(latestScene, { sceneId: output.scene.id, shotId: output.shot.id, previewNodeId: previewId });
        if (!mergedScene) throw new Error("输出期间镜头已切换或删除，请重试");
        const previewSize = fitNodeSize(image.width, image.height);
        const nextNodes = [...nodesRef.current];
        const previewIndex = nextNodes.findIndex((item) => item.id === previewId);
        const existingPreview = previewIndex >= 0 ? nextNodes[previewIndex] : null;
        const previewNode: CanvasNodeData = {
            ...existingPreview,
            id: previewId,
            type: CanvasNodeType.Image,
            title: `${sourceNode.title} · 导演台构图`,
            position: existingPreview?.position || { x: sourceNode.position.x - previewSize.width - 36, y: sourceNode.position.y },
            width: previewSize.width,
            height: previewSize.height,
            metadata: { ...existingPreview?.metadata, ...imageMetadata(image), prompt: output.prompt, workflowKind: "reference_set", assetTags: ["导演台构图", `镜头:${sourceNode.title}`] },
        };
        if (previewIndex >= 0) nextNodes[previewIndex] = previewNode;
        else nextNodes.push(previewNode);

        let clayVideoId = sourceNode.metadata?.directorClayVideoNodeId;
        if (videoUpload) {
            clayVideoId ||= `video-director-clay-${Date.now()}`;
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
                metadata: { ...existingVideo?.metadata, ...videoMetadata(videoUpload), prompt: output.prompt, workflowKind: "reference_video", assetTags: ["导演台白膜", `镜头:${sourceNode.title}`] },
            };
            if (videoIndex >= 0) nextNodes[videoIndex] = videoNode;
            else nextNodes.push(videoNode);
        }

        const nextConnections = [...connectionsRef.current];
        [previewId, videoUpload ? clayVideoId : null].filter((id): id is string => Boolean(id)).forEach((id) => {
            if (!nextConnections.some((connection) => connection.fromNodeId === id && connection.toNodeId === sourceNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: id, toNodeId: sourceNode.id });
        });
        const retiredReferenceIds = new Set([sourceNode.metadata?.directorDepthNodeId, sourceNode.metadata?.directorNormalNodeId].filter(Boolean));
        const referenceAssetNodeIds = Array.from(new Set([
            ...(sourceNode.metadata?.referenceAssetNodeIds || []).filter((id) => !retiredReferenceIds.has(id)),
            previewId,
            ...(clayVideoId ? [clayVideoId] : []),
        ]));
        const directorMetadata: Partial<CanvasNodeMetadata> = {
            directorSceneId: output.scene.id,
            directorShotId: output.shot.id,
            directorPreviewNodeId: previewId,
            directorDepthNodeId: undefined,
            directorNormalNodeId: undefined,
            directorClayVideoNodeId: clayVideoId,
            composerContent: output.prompt,
            prompt: output.prompt,
            videoCameraMoveId: output.shot.cameraMove,
            videoCameraMovePrompt: output.prompt,
            referenceAssetNodeIds,
        };
        const finalizedNodes = nextNodes.map((item) => item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, ...directorMetadata } } : item);
        nodesRef.current = finalizedNodes;
        connectionsRef.current = nextConnections;
        setNodes(finalizedNodes);
        setConnections(nextConnections);
        saveDirectorScene(mergedScene);
    }, [connectionsRef, directorNodeId, nodesRef, projectId, saveDirectorScene, setConnections, setNodes]);

    return { applyDirectorOutput, createDirectorShot, openDirectorWorkbench, saveDirectorScene };
}
