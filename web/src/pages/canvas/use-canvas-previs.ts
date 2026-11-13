import { translate } from "@/i18n";
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitImageNodeSize, preserveImageNodeSize } from "@/lib/canvas/canvas-node-size";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { getActiveUserScope } from "@/lib/user-scope";
import { createPrevisSceneFromTemplate, type PrevisTemplateId } from "@/lib/canvas/previs/previs-templates";
import type { DramaPrevisRequest } from "@/lib/canvas/drama-previs";
import { dramaCastAssetCategory, dramaSegmentPrompt } from "@/lib/canvas/drama-canvas-projection";
import { ensureDramaCanvasAssets } from "@/services/drama-canvas";
import { resourceFileUrl } from "@/services/api/resources";
import { mergePrevisOutputPreview, upsertPrevisSceneById } from "@/lib/canvas/previs/previs-session";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { PrevisCanvasExport, PrevisScene, PrevisSceneOutput } from "@/types/previs";

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
    const createPrevisShot = useCallback(
        (templateId: PrevisTemplateId, position?: Position) => {
            const shots = nodesRef.current.filter((node) => node.metadata?.workflowKind === "shot");
            const shotIndex = Math.max(0, ...shots.map((node) => node.metadata?.shotIndex || 0)) + 1;
            let scene = createPrevisSceneFromTemplate(templateId, translate("canvasPage.previs.shot", { index: shotIndex }));
            const shot = scene.shots[0];
            scene = { ...scene, shots: [{ ...shot, name: translate("canvasPage.previs.shot", { index: shotIndex }) }] };
            const node = createCanvasNode(CanvasNodeType.Video, position || getCanvasCenter(), {
                workflowKind: "shot",
                workflowTitle: translate("canvasPage.previs.shot", { index: shotIndex }),
                shotIndex,
                generationMode: "video",
                videoEditOperation: "text_to_video",
                status: NODE_STATUS_IDLE,
                composerContent: "",
                previsSceneId: scene.id,
                previsShotId: shot.id,
            });
            node.title = translate("canvasPage.previs.shot", { index: shotIndex });
            node.width = PREVIS_NODE_SIZE.width;
            node.height = PREVIS_NODE_SIZE.height;
            const nextNodes = [...nodesRef.current, node];
            nodesRef.current = nextNodes;
            setNodes(nextNodes);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            updateProject(projectId, { previsScenes: upsertPrevisSceneById(currentPrevisScenes(projectId, previsScenes), scene) });
            message.success(translate("canvasPage.previs.created"));
        },
        [previsScenes, getCanvasCenter, message, nodesRef, projectId, setNodes, setSelectedConnectionId, setSelectedNodeIds, updateProject],
    );

    const openPrevisWorkbench = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node || node.metadata?.workflowKind !== "shot") return;
            if (shouldUpgradePrevisNodeSize(node)) {
                const upgradedNodes = nodesRef.current.map((item) => (item.id === nodeId ? { ...item, width: PREVIS_NODE_SIZE.width, height: PREVIS_NODE_SIZE.height } : item));
                nodesRef.current = upgradedNodes;
                setNodes(upgradedNodes);
            }
            let scene = currentPrevisScenes(projectId, previsScenes).find((item) => item.id === node.metadata?.previsSceneId);
            if (!scene) {
                // 孤儿节点修复路径：节点存在但场景丢了。这不是「新建」，不弹模板选择，
                // 用空场景兜底 —— 绝不在用户没选过的情况下塞演员进去。
                scene = createPrevisSceneFromTemplate("empty", node.metadata?.workflowTitle || node.title || translate("canvasPage.previs.defaultScene"));
                const shot = scene.shots[0];
                scene = { ...scene, shots: [{ ...shot, name: node.metadata?.workflowTitle || node.title || shot.name, prompt: node.metadata?.workflowDescription || "" }] };
                const previsSceneId = scene.id;
                const previsShotId = shot.id;
                setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, previsSceneId, previsShotId } } : item)));
                updateProject(projectId, { previsScenes: upsertPrevisSceneById(currentPrevisScenes(projectId, previsScenes), scene) });
            }
            setPrevisNodeId(nodeId);
        },
        [previsScenes, nodesRef, projectId, setPrevisNodeId, setNodes, updateProject],
    );

    /** 每次保存都基于 store 中最新 previsScenes upsert，避免旧闭包数组覆盖并发保存。 */
    const savePrevisScene = useCallback(
        (scene: PrevisScene) => {
            updateProject(projectId, { previsScenes: upsertPrevisSceneById(currentPrevisScenes(projectId, previsScenes), scene) });
        },
        [previsScenes, projectId, updateProject],
    );

    const applyPrevisOutput = useCallback(
        async (output: PrevisSceneOutput) => {
            const outputProjectId = projectId;
            if (projectIdRef.current !== outputProjectId) throw new Error(translate("canvasPage.previs.projectSwitched"));
            const sourceNodeAtStart = nodesRef.current.find((item) => item.id === previsNodeId);
            if (!sourceNodeAtStart || sourceNodeAtStart.metadata?.previsSceneId !== output.scene.id) throw new Error(translate("canvasPage.previs.shotMissing"));
            const sourceNodeId = sourceNodeAtStart.id;
            const [image, videoUpload, depthImage, depthVideoUpload] = await Promise.all([
                uploadImage(output.beauty),
                output.clayVideo ? uploadMediaFile(output.clayVideo, "previs-clay") : Promise.resolve(null),
                output.depth ? uploadImage(output.depth) : Promise.resolve(null),
                output.depthVideo ? uploadMediaFile(output.depthVideo, "previs-depth") : Promise.resolve(null),
            ]);
            // 上传期间项目、节点和镜头都可能变化。以当前权威状态重新核验并合并，
            // 不允许旧输出写入另一项目，也不允许旧 scene 快照覆盖并发编辑。
            const outputProject = useCanvasStore.getState().projects.find((item) => item.id === outputProjectId);
            const sourceNode = nodesRef.current.find((item) => item.id === sourceNodeId);
            const latestScene = outputProject?.previsScenes.find((item) => item.id === output.scene.id);
            if (projectIdRef.current !== outputProjectId || !outputProject || !sourceNode || sourceNode.metadata?.previsSceneId !== output.scene.id || !latestScene || !latestScene.shots.some((shot) => shot.id === output.shot.id))
                throw new Error(translate("canvasPage.previs.changedDuringOutput"));
            const previewId = sourceNode.metadata?.previsPreviewNodeId || `image-previs-${Date.now()}`;
            const mergedScene = mergePrevisOutputPreview(latestScene, { sceneId: output.scene.id, shotId: output.shot.id, previewNodeId: previewId });
            if (!mergedScene) throw new Error(translate("canvasPage.previs.shotChangedDuringOutput"));
            const previewSize = fitImageNodeSize(image.width, image.height);
            const nextNodes = [...nodesRef.current];
            const previewIndex = nextNodes.findIndex((item) => item.id === previewId);
            const existingPreview = previewIndex >= 0 ? nextNodes[previewIndex] : null;
            const previewNode: CanvasNodeData = {
                ...existingPreview,
                id: previewId,
                type: CanvasNodeType.Image,
                title: translate("canvasPage.previs.compositionTitle", { title: sourceNode.title }),
                position: existingPreview?.position || { x: sourceNode.position.x - previewSize.width - 36, y: sourceNode.position.y },
                ...preserveImageNodeSize(existingPreview, previewSize),
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
                    title: translate("canvasPage.previs.clayVideoTitle", { title: sourceNode.title }),
                    position: existingVideo?.position || { x: sourceNode.position.x, y: sourceNode.position.y + sourceNode.height + 48 },
                    width: existingVideo?.width || 360,
                    height: existingVideo?.height || 220,
                    metadata: {
                        ...existingVideo?.metadata,
                        ...videoMetadata(videoUpload),
                        prompt: output.prompt,
                        workflowKind: "reference_video",
                        assetTags: ["预演台白膜", `镜头:${sourceNode.title}`],
                        producedModel: undefined,
                        producedModelCandidate: undefined,
                    },
                };
                if (videoIndex >= 0) nextNodes[videoIndex] = videoNode;
                else nextNodes.push(videoNode);
            }

            // 深度图 / 深度视频：放在镜头节点旁、不自动连线，也不进 referenceAssetNodeIds。
            // 不支持深度控制的视频模型会把它当普通参考图，用户需要时手动连到支持深度控制的节点。
            let depthId = sourceNode.metadata?.previsDepthNodeId;
            if (depthImage) {
                depthId ||= `image-previs-depth-${Date.now()}`;
                const depthSize = fitImageNodeSize(depthImage.width, depthImage.height);
                const depthIndex = nextNodes.findIndex((item) => item.id === depthId);
                const existingDepth = depthIndex >= 0 ? nextNodes[depthIndex] : null;
                const depthNode: CanvasNodeData = {
                    ...existingDepth,
                    id: depthId,
                    type: CanvasNodeType.Image,
                    title: translate("canvasPage.previs.depthMapTitle", { title: sourceNode.title }),
                    position: existingDepth?.position || { x: sourceNode.position.x - depthSize.width - 36, y: sourceNode.position.y + previewSize.height + 36 },
                    ...preserveImageNodeSize(existingDepth, depthSize),
                    metadata: {
                        ...existingDepth?.metadata,
                        ...imageMetadata(depthImage),
                        prompt: output.prompt,
                        workflowKind: "reference_set",
                        assetTags: ["预演台深度", `镜头:${sourceNode.title}`],
                        producedModel: undefined,
                        producedModelCandidate: undefined,
                    },
                };
                if (depthIndex >= 0) nextNodes[depthIndex] = depthNode;
                else nextNodes.push(depthNode);
            }
            let depthVideoId = sourceNode.metadata?.previsDepthVideoNodeId;
            if (depthVideoUpload) {
                depthVideoId ||= `video-previs-depth-${Date.now()}`;
                const depthVideoIndex = nextNodes.findIndex((item) => item.id === depthVideoId);
                const existingDepthVideo = depthVideoIndex >= 0 ? nextNodes[depthVideoIndex] : null;
                const depthVideoNode: CanvasNodeData = {
                    ...existingDepthVideo,
                    id: depthVideoId,
                    type: CanvasNodeType.Video,
                    title: translate("canvasPage.previs.depthVideoTitle", { title: sourceNode.title }),
                    position: existingDepthVideo?.position || { x: sourceNode.position.x + sourceNode.width + 48, y: sourceNode.position.y + sourceNode.height + 48 },
                    width: existingDepthVideo?.width || 360,
                    height: existingDepthVideo?.height || 220,
                    metadata: {
                        ...existingDepthVideo?.metadata,
                        ...videoMetadata(depthVideoUpload),
                        prompt: output.prompt,
                        workflowKind: "reference_video",
                        assetTags: ["预演台深度", `镜头:${sourceNode.title}`],
                        producedModel: undefined,
                        producedModelCandidate: undefined,
                    },
                };
                if (depthVideoIndex >= 0) nextNodes[depthVideoIndex] = depthVideoNode;
                else nextNodes.push(depthVideoNode);
            }

            const nextConnections = [...connectionsRef.current];
            [previewId, videoUpload ? clayVideoId : null]
                .filter((id): id is string => Boolean(id))
                .forEach((id) => {
                    if (!nextConnections.some((connection) => connection.fromNodeId === id && connection.toNodeId === sourceNode.id)) nextConnections.push({ id: nanoid(), fromNodeId: id, toNodeId: sourceNode.id });
                });
            // 深度/法线节点只作为控制素材保存，不作为普通参考进入生成；旧版本写入的引用一并剔除。
            const retiredReferenceIds = new Set([sourceNode.metadata?.previsDepthNodeId, sourceNode.metadata?.previsDepthVideoNodeId, sourceNode.metadata?.previsNormalNodeId, depthId, depthVideoId].filter(Boolean));
            const referenceAssetNodeIds = Array.from(new Set([...(sourceNode.metadata?.referenceAssetNodeIds || []).filter((id) => !retiredReferenceIds.has(id)), previewId, ...(clayVideoId ? [clayVideoId] : [])]));
            const previsMetadata: Partial<CanvasNodeMetadata> = {
                previsSceneId: output.scene.id,
                previsShotId: output.shot.id,
                previsPreviewNodeId: previewId,
                previsDepthNodeId: depthId,
                previsDepthVideoNodeId: depthVideoId,
                previsNormalNodeId: undefined,
                previsClayVideoNodeId: clayVideoId,
                composerContent: output.prompt,
                prompt: output.prompt,
                videoCameraMoveId: output.shot.cameraMove,
                videoCameraMovePrompt: output.prompt,
                referenceAssetNodeIds,
            };
            const producedIds = new Set([previewId, videoUpload ? clayVideoId : null, depthImage ? depthId : null, depthVideoUpload ? depthVideoId : null].filter((id): id is string => Boolean(id)));
            const mediaNodes = nextNodes.filter((item) => producedIds.has(item.id));
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
        },
        [connectionsRef, previsNodeId, domainProjectId, nodesRef, projectId, savePrevisScene, setConnections, setNodes],
    );

    const addPrevisToCanvas = useCallback(
        async (output: PrevisCanvasExport) => {
            const scope = getActiveUserScope();
            const sourceNodeId = previsNodeId;
            const validateSource = () => {
                if (projectIdRef.current !== projectId || getActiveUserScope() !== scope) throw new Error(translate("canvasPage.previs.projectSwitched"));
                const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
                const source = nodesRef.current.find((item) => item.id === sourceNodeId);
                const currentScene = project?.previsScenes.find((item) => item.id === output.sceneId);
                if (!source || source.metadata?.previsSceneId !== output.sceneId || !currentScene?.shots.some((shot) => shot.id === output.shotId)) throw new Error(translate("canvasPage.previs.shotMissing"));
                return source;
            };
            validateSource();
            const added: CanvasNodeData[] = [];
            const links: CanvasConnection[] = [];
            if (output.kind === "prompt") {
                if (!output.prompt.trim()) throw new Error("当前镜头没有可加入画布的提示词");
                const text = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 }, { content: output.prompt, status: "success" });
                text.title = `${output.title} · 提示词`;
                added.push(text);
            } else {
                const image = await uploadImage(output.image);
                validateSource();
                const picture = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ...imageMetadata(image), prompt: output.prompt, assetTags: ["预演台截图"] });
                picture.title = `${output.title} · ${output.timecode}`;
                Object.assign(picture, fitImageNodeSize(image.width, image.height));
                const asset = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: picture, source: "canvas-manual" });
                validateSource();
                picture.metadata = { ...picture.metadata, assetId: asset.assetId };
                added.push(picture);
                // 深度、法线和骨架截图仅作为控制素材，避免误当普通首帧提交。
                if (output.renderMode === "beauty" || output.renderMode === "clay") {
                    const video = createCanvasNode(
                        CanvasNodeType.Video,
                        { x: 0, y: 0 },
                        {
                            generationMode: "video",
                            videoEditOperation: "image_to_video",
                            videoStartFrameNodeId: picture.id,
                            referenceAssetNodeIds: [picture.id],
                            prompt: output.prompt,
                            composerContent: output.prompt,
                            seconds: String(output.duration),
                            status: NODE_STATUS_IDLE,
                        },
                    );
                    video.title = `${output.title} · 图生视频`;
                    added.push(video);
                    links.push({ id: nanoid(), fromNodeId: picture.id, toNodeId: video.id });
                }
                if (asset.syncPending) message.warning("截图已保存到本机素材库，云端同步待完成");
            }
            // 所有异步操作结束后再读取节点与连线，保留上传期间的新增、移动和删除。
            const source = validateSource();
            const position = findAvailableGenerationGroupPosition(
                nodesRef.current,
                { x: source.position.x + source.width + 48, y: source.position.y },
                {
                    width: added.reduce((sum, node) => sum + node.width, 0) + (added.length - 1) * 48,
                    height: Math.max(...added.map((node) => node.height)),
                },
            );
            let x = position.x;
            for (const node of added) {
                node.position = { x, y: position.y };
                x += node.width + 48;
            }
            nodesRef.current = [...nodesRef.current, ...added];
            connectionsRef.current = [...connectionsRef.current, ...links];
            setNodes(nodesRef.current);
            setConnections(connectionsRef.current);
            setSelectedNodeIds(new Set(added.map((node) => node.id)));
            setSelectedConnectionId(null);
        },
        [connectionsRef, domainProjectId, message, nodesRef, previsNodeId, projectId, setConnections, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const prepareDramaPrevis = useCallback(
        async (request: DramaPrevisRequest) => {
            const scope = getActiveUserScope();
            const { buildDramaPrevisScene, findDramaPrevisDraft } = await import("@/lib/canvas/drama-previs");
            if (projectIdRef.current !== projectId || getActiveUserScope() !== scope) throw new Error("画布或账号已切换，请重新打开剧情段");
            const source = nodesRef.current.find((node) => node.id === request.sourceNodeId);
            const ref = source?.metadata?.dramaRef;
            if (!source || ref?.kind !== "segment" || ref.projectId !== request.episode.projectId || ref.id !== request.segment.id) throw new Error("剧情段来源已变化，请重新投送");
            const scenes = currentPrevisScenes(projectId, previsScenes);
            const existing = findDramaPrevisDraft(nodesRef.current, scenes, request.episode.projectId, request.segment.id);
            if (existing) return existing.node.id;

            const scene = buildDramaPrevisScene(request);
            const prompt = dramaSegmentPrompt(request.segment);
            const referenceInputs = request.segment.request.references.flatMap((reference) => (reference.sent && reference.resourceId ? [{ ...reference, resourceId: reference.resourceId, firstFrame: false }] : []));
            if (request.segment.request.firstFrameResourceId)
                referenceInputs.push({ resourceId: request.segment.request.firstFrameResourceId, castId: "", kind: "image", label: "首帧", name: `第 ${request.segment.index} 段尾帧`, sent: true, firstFrame: true });
            const imageFor = (resourceId: string) => nodesRef.current.find((item) => item.type === CanvasNodeType.Image && item.metadata?.storageKey === `resource:${resourceId}`);
            const missing = referenceInputs.filter((reference) => !imageFor(reference.resourceId));
            const assetIds = missing.length
                ? await ensureDramaCanvasAssets(
                      request.episode.projectId,
                      missing.map((reference) => ({ resourceId: reference.resourceId, title: `${reference.label} · ${reference.name}`, category: reference.kind === "image" ? "material" : dramaCastAssetCategory(reference.kind) })),
                  )
                : new Map<string, string>();
            const currentSource = nodesRef.current.find((item) => item.id === source.id)?.metadata?.dramaRef;
            if (projectIdRef.current !== projectId || getActiveUserScope() !== scope || currentSource?.projectId !== ref.projectId || currentSource?.kind !== "segment" || currentSource.id !== ref.id) throw new Error("画布或剧情段已变化，请重新打开");
            if (missing.some((reference) => !assetIds.has(reference.resourceId))) throw new Error("部分参考图已不可用，请在制作台检查后重试");
            const latestScenes = currentPrevisScenes(projectId, previsScenes);
            const raced = findDramaPrevisDraft(nodesRef.current, latestScenes, request.episode.projectId, request.segment.id);
            if (raced) return raced.node.id;
            const pendingImages: CanvasNodeData[] = [];
            const references = referenceInputs.map((reference) => {
                const existingImage = imageFor(reference.resourceId) || pendingImages.find((item) => item.metadata?.storageKey === `resource:${reference.resourceId}`);
                if (existingImage) return existingImage;
                const image = createCanvasNode(CanvasNodeType.Image, findAvailableGenerationGroupPosition([...nodesRef.current, ...pendingImages], getCanvasCenter(), { width: 240, height: 160 }), {
                    content: resourceFileUrl(reference.resourceId),
                    storageKey: `resource:${reference.resourceId}`,
                    assetId: assetIds.get(reference.resourceId),
                    status: "success",
                    ...(reference.castId ? { dramaRef: { projectId: request.episode.projectId, kind: "cast", id: reference.castId, baseResourceId: reference.resourceId } as const } : {}),
                });
                image.title = `${reference.label} · ${reference.name}`;
                image.width = 240;
                image.height = 160;
                pendingImages.push(image);
                return image;
            });
            const firstFrameIndex = referenceInputs.findIndex((reference) => reference.firstFrame);
            const firstFrameNodeId = firstFrameIndex >= 0 ? references[firstFrameIndex].id : undefined;
            const node = createCanvasNode(CanvasNodeType.Video, findAvailableGenerationGroupPosition([...nodesRef.current, ...pendingImages], getCanvasCenter(), PREVIS_NODE_SIZE), {
                workflowKind: "shot",
                workflowTitle: scene.title,
                workflowDescription: prompt,
                generationMode: "video",
                videoEditOperation: request.segment.request.operation || undefined,
                videoStartFrameNodeId: firstFrameNodeId,
                referenceAssetNodeIds: references.filter((_, index) => !referenceInputs[index].firstFrame).map((item) => item.id),
                status: NODE_STATUS_IDLE,
                composerContent: prompt,
                prompt,
                seconds: String(scene.shots.reduce((total, shot) => total + shot.duration, 0)),
                dramaRef: { ...ref, baseResourceId: request.segment.videoResourceId },
                previsSceneId: scene.id,
                previsShotId: scene.activeShotId,
            });
            node.title = `${scene.title} · 预演`;
            Object.assign(node, PREVIS_NODE_SIZE);
            const nextNodes = [...nodesRef.current, ...pendingImages, node];
            const nextConnections = [...connectionsRef.current, ...[...new Set(references.map((reference) => reference.id))].map((referenceId) => ({ id: nanoid(), fromNodeId: referenceId, toNodeId: node.id }))];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            updateProject(projectId, { previsScenes: upsertPrevisSceneById(latestScenes, scene) });
            message.info("已带入本段镜头脚本与参考图；3D 布局从空场景开始，请安排站位与机位");
            return node.id;
        },
        [connectionsRef, getCanvasCenter, message, nodesRef, previsScenes, projectId, setConnections, setNodes, updateProject],
    );

    return { addPrevisToCanvas, applyPrevisOutput, createPrevisShot, openPrevisWorkbench, prepareDramaPrevis, savePrevisScene };
}
