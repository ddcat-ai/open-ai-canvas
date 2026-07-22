import { useCallback, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { createDirectorScene } from "@/lib/canvas/director/director-scene";
import { uploadImage } from "@/services/image-storage";
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

    const createDirectorShot = useCallback((position?: Position) => {
        const shots = nodesRef.current.filter((node) => node.metadata?.workflowKind === "shot");
        const shotIndex = Math.max(0, ...shots.map((node) => node.metadata?.shotIndex || 0)) + 1;
        let scene = createDirectorScene(`镜头 ${shotIndex}`);
        const shot = scene.shots[0];
        scene = { ...scene, shots: [{ ...shot, name: `镜头 ${shotIndex}` }] };
        const node = createCanvasNode(CanvasNodeType.Config, position || getCanvasCenter(), {
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
        const nextNodes = [...nodesRef.current, node];
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        updateProject(projectId, { directorScenes: [...directorScenes, scene] });
        message.success("已创建导演台节点，点击缩略图进入编辑");
    }, [directorScenes, getCanvasCenter, message, nodesRef, projectId, setNodes, setSelectedConnectionId, setSelectedNodeIds, updateProject]);

    const openDirectorWorkbench = useCallback((nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node || node.metadata?.workflowKind !== "shot") return;
        let scene = directorScenes.find((item) => item.id === node.metadata?.directorSceneId);
        if (!scene) {
            scene = createDirectorScene(node.metadata?.workflowTitle || node.title || "镜头场景");
            const shot = scene.shots[0];
            scene = { ...scene, shots: [{ ...shot, name: node.metadata?.workflowTitle || node.title || shot.name, prompt: node.metadata?.workflowDescription || "" }] };
            const directorSceneId = scene.id;
            const directorShotId = shot.id;
            setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, metadata: { ...item.metadata, directorSceneId, directorShotId } } : item));
            updateProject(projectId, { directorScenes: [...directorScenes, scene] });
        }
        setDirectorNodeId(nodeId);
    }, [directorScenes, nodesRef, projectId, setDirectorNodeId, setNodes, updateProject]);

    const saveDirectorScene = useCallback((scene: DirectorScene) => {
        updateProject(projectId, { directorScenes: directorScenes.some((item) => item.id === scene.id) ? directorScenes.map((item) => item.id === scene.id ? scene : item) : [...directorScenes, scene] });
    }, [directorScenes, projectId, updateProject]);

    const applyDirectorOutput = useCallback(async (output: DirectorSceneOutput) => {
        const sourceNode = nodesRef.current.find((item) => item.id === directorNodeId);
        if (!sourceNode) throw new Error("镜头节点不存在");
        const uploads = await Promise.all([uploadImage(output.beauty), uploadImage(output.depth), uploadImage(output.normal)]);
        const labels = ["导演台构图", "导演台深度", "导演台法线"];
        const existingIds = [sourceNode.metadata?.directorPreviewNodeId, sourceNode.metadata?.directorDepthNodeId, sourceNode.metadata?.directorNormalNodeId];
        const nextNodes = [...nodesRef.current];
        const outputIds: string[] = [];
        uploads.forEach((image, index) => {
            const id = existingIds[index] || `image-director-${Date.now()}-${index}`;
            const size = fitNodeSize(image.width, image.height);
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: `${sourceNode.title} · ${labels[index]}`,
                position: { x: sourceNode.position.x - 3 * (size.width + 36) + index * (size.width + 36), y: sourceNode.position.y },
                width: size.width,
                height: size.height,
                metadata: { ...imageMetadata(image), prompt: output.prompt, workflowKind: "reference_set", assetTags: [labels[index], `镜头:${sourceNode.title}`] },
            };
            const currentIndex = nextNodes.findIndex((item) => item.id === id);
            if (currentIndex >= 0) nextNodes[currentIndex] = node;
            else nextNodes.push(node);
            outputIds.push(id);
        });
        const nextConnections = [...connectionsRef.current];
        outputIds.forEach((id) => {
            if (!nextConnections.some((connection) => connection.fromNodeId === id && connection.toNodeId === sourceNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: id, toNodeId: sourceNode.id });
        });
        const directorMetadata: Partial<CanvasNodeMetadata> = {
            directorSceneId: output.scene.id,
            directorShotId: output.shot.id,
            directorPreviewNodeId: outputIds[0],
            directorDepthNodeId: outputIds[1],
            directorNormalNodeId: outputIds[2],
            composerContent: output.prompt,
            prompt: output.prompt,
            videoCameraMoveId: output.shot.cameraMove,
            videoCameraMovePrompt: output.prompt,
            referenceAssetNodeIds: Array.from(new Set([...(sourceNode.metadata?.referenceAssetNodeIds || []), ...outputIds])),
        };
        const finalizedNodes = nextNodes.map((item) => item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, ...directorMetadata } } : item);
        nodesRef.current = finalizedNodes;
        connectionsRef.current = nextConnections;
        setNodes(finalizedNodes);
        setConnections(nextConnections);
        saveDirectorScene({ ...output.scene, shots: output.scene.shots.map((shot) => shot.id === output.shot.id ? { ...shot, previewNodeId: outputIds[0], depthNodeId: outputIds[1], normalNodeId: outputIds[2] } : shot) });
    }, [connectionsRef, directorNodeId, nodesRef, saveDirectorScene, setConnections, setNodes]);

    return { applyDirectorOutput, createDirectorShot, openDirectorWorkbench, saveDirectorScene };
}
