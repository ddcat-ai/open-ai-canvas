import { useCallback, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createDirectorScene } from "@/lib/canvas/director/director-scene";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { DirectorScene, DirectorSceneOutput } from "@/types/director";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();

    const createDirectorShot = useCallback(
        (position?: Position) => {
            const shots = nodesRef.current.filter((node) => node.metadata?.workflowKind === "shot");
            const shotIndex = Math.max(0, ...shots.map((node) => node.metadata?.shotIndex || 0)) + 1;
            let scene = createDirectorScene(t("canvas:shot-param", { shotIndex: shotIndex }));
            const shot = scene.shots[0];
            scene = { ...scene, shots: [{ ...shot, name: t("canvas:shot-param", { shotIndex: shotIndex }) }] };
            const node = createCanvasNode(CanvasNodeType.Video, position || getCanvasCenter(), {
                workflowKind: "shot",
                workflowTitle: t("canvas:shot-param", { shotIndex: shotIndex }),
                shotIndex,
                generationMode: "video",
                videoEditOperation: "text_to_video",
                status: NODE_STATUS_IDLE,
                composerContent: "",
                directorSceneId: scene.id,
                directorShotId: shot.id,
            });
            node.title = t("canvas:shot-param", { shotIndex: shotIndex });
            node.height = 300;
            const nextNodes = [...nodesRef.current, node];
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            updateProject(projectId, { directorScenes: [...directorScenes, scene] });
            message.success(t("canvas:director-stage-node-created-click-the-thumbnail-to-edit"));
        },
        [directorScenes, getCanvasCenter, message, nodesRef, projectId, setNodes, setSelectedConnectionId, setSelectedNodeIds, updateProject],
    );

    const openDirectorWorkbench = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node || node.metadata?.workflowKind !== "shot") return;
            let scene = directorScenes.find((item) => item.id === node.metadata?.directorSceneId);
            if (!scene) {
                scene = createDirectorScene(node.metadata?.workflowTitle || node.title || t("canvas:shot-scene"));
                const shot = scene.shots[0];
                scene = { ...scene, shots: [{ ...shot, name: node.metadata?.workflowTitle || node.title || shot.name, prompt: node.metadata?.workflowDescription || "" }] };
                const directorSceneId = scene.id;
                const directorShotId = shot.id;
                setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, directorSceneId, directorShotId } } : item)));
                updateProject(projectId, { directorScenes: [...directorScenes, scene] });
            }
            setDirectorNodeId(nodeId);
        },
        [directorScenes, nodesRef, projectId, setDirectorNodeId, setNodes, updateProject],
    );

    const saveDirectorScene = useCallback(
        (scene: DirectorScene) => {
            updateProject(projectId, { directorScenes: directorScenes.some((item) => item.id === scene.id) ? directorScenes.map((item) => (item.id === scene.id ? scene : item)) : [...directorScenes, scene] });
        },
        [directorScenes, projectId, updateProject],
    );

    const applyDirectorOutput = useCallback(
        async (output: DirectorSceneOutput) => {
            const sourceNode = nodesRef.current.find((item) => item.id === directorNodeId);
            if (!sourceNode) throw new Error(t("canvas:shot-node-does-not-exist"));
            const [image, videoUpload] = await Promise.all([uploadImage(output.beauty), output.clayVideo ? uploadMediaFile(output.clayVideo, "director-clay") : Promise.resolve(null)]);
            const previewId = sourceNode.metadata?.directorPreviewNodeId || `image-director-${Date.now()}`;
            const previewSize = fitNodeSize(image.width, image.height);
            const nextNodes = [...nodesRef.current];
            const previewIndex = nextNodes.findIndex((item) => item.id === previewId);
            const existingPreview = previewIndex >= 0 ? nextNodes[previewIndex] : null;
            const previewNode: CanvasNodeData = {
                ...existingPreview,
                id: previewId,
                type: CanvasNodeType.Image,
                title: t("canvas:param-director-composition", { title: sourceNode.title }),
                position: existingPreview?.position || { x: sourceNode.position.x - previewSize.width - 36, y: sourceNode.position.y },
                width: previewSize.width,
                height: previewSize.height,
                metadata: { ...existingPreview?.metadata, ...imageMetadata(image), prompt: output.prompt, workflowKind: "reference_set", assetTags: [t("canvas:director-composition"), t("canvas:shot-param-2", { title: sourceNode.title })] },
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
                    title: t("canvas:param-clay-render-video", { title: sourceNode.title }),
                    position: existingVideo?.position || { x: sourceNode.position.x, y: sourceNode.position.y + sourceNode.height + 48 },
                    width: existingVideo?.width || 360,
                    height: existingVideo?.height || 220,
                    metadata: { ...existingVideo?.metadata, ...videoMetadata(videoUpload), prompt: output.prompt, workflowKind: "reference_video", assetTags: [t("canvas:director-clay-render"), t("canvas:shot-param-2", { title: sourceNode.title })] },
                };
                if (videoIndex >= 0) nextNodes[videoIndex] = videoNode;
                else nextNodes.push(videoNode);
            }

            const nextConnections = [...connectionsRef.current];
            [previewId, videoUpload ? clayVideoId : null]
                .filter((id): id is string => Boolean(id))
                .forEach((id) => {
                    if (!nextConnections.some((connection) => connection.fromNodeId === id && connection.toNodeId === sourceNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: id, toNodeId: sourceNode.id });
                });
            const retiredReferenceIds = new Set([sourceNode.metadata?.directorDepthNodeId, sourceNode.metadata?.directorNormalNodeId].filter(Boolean));
            const referenceAssetNodeIds = Array.from(new Set([...(sourceNode.metadata?.referenceAssetNodeIds || []).filter((id) => !retiredReferenceIds.has(id)), previewId, ...(clayVideoId ? [clayVideoId] : [])]));
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
            const finalizedNodes = nextNodes.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, ...directorMetadata } } : item));
            nodesRef.current = finalizedNodes;
            connectionsRef.current = nextConnections;
            setNodes(finalizedNodes);
            setConnections(nextConnections);
            saveDirectorScene({ ...output.scene, shots: output.scene.shots.map((shot) => (shot.id === output.shot.id ? { ...shot, previewNodeId: previewId, depthNodeId: undefined, normalNodeId: undefined } : shot)) });
        },
        [connectionsRef, directorNodeId, nodesRef, saveDirectorScene, setConnections, setNodes],
    );

    return { applyDirectorOutput, createDirectorShot, openDirectorWorkbench, saveDirectorScene };
}
