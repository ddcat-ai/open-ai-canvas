import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { App } from "antd";
import { useNavigate } from "react-router";

import { removeLegacyCharacterCards } from "@/lib/canvas/canvas-character-reference";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { hydrateAssistantImages, hydrateCanvasImages, resetInterruptedGeneration } from "@/lib/canvas/canvas-project-generation";
import { listActivatedSkills, type UpdreamSkill } from "@/services/api/skills";
import { createCanvasProjectWithRemoteSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasNodeMetadata, ViewportTransform } from "@/types/canvas";
import type { CanvasHistorySnapshot } from "./use-canvas-history";

type UseCanvasProjectLifecycleOptions = {
    projectId: string;
    projectLoaded: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    viewportRef: MutableRefObject<ViewportTransform>;
    historyPausedRef: MutableRefObject<boolean>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setChatSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
    setActiveChatId: Dispatch<SetStateAction<string | null>>;
    setBackgroundMode: Dispatch<SetStateAction<CanvasBackgroundMode>>;
    setShowImageInfo: Dispatch<SetStateAction<boolean>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setProjectLoaded: Dispatch<SetStateAction<boolean>>;
    resetHistory: (snapshot: CanvasHistorySnapshot) => void;
    cleanupAssetImages: (options?: unknown) => void;
    cleanupCanvasFiles: (extra?: unknown) => void;
};

export function useCanvasProjectLifecycle({
    projectId,
    projectLoaded,
    nodes,
    connections,
    chatSessions,
    activeChatId,
    backgroundMode,
    showImageInfo,
    viewport,
    nodesRef,
    connectionsRef,
    viewportRef,
    historyPausedRef,
    setNodes,
    setConnections,
    setChatSessions,
    setActiveChatId,
    setBackgroundMode,
    setShowImageInfo,
    setViewport,
    setProjectLoaded,
    resetHistory,
    cleanupAssetImages,
    cleanupCanvasFiles,
}: UseCanvasProjectLifecycleOptions) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const [activatedSkills, setActivatedSkills] = useState<UpdreamSkill[]>([]);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!hydrated) return;
        let cancelled = false;
        setProjectLoaded(false);
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const applyRestoredProject = (restoredNodes: CanvasNodeData[], restoredSessions: CanvasAssistantSession[]) => {
            if (cancelled) return;
            // 历史角色卡迁移只清理废弃中间节点，生成后的角色图片继续保留。
            const migrated = removeLegacyCharacterCards(restoredNodes, project.connections);
            const snapshot: CanvasHistorySnapshot = {
                nodes: migrated.nodes,
                connections: migrated.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
            };
            nodesRef.current = snapshot.nodes;
            connectionsRef.current = snapshot.connections;
            viewportRef.current = project.viewport;
            setNodes(snapshot.nodes);
            setConnections(snapshot.connections);
            setChatSessions(snapshot.chatSessions);
            setActiveChatId(snapshot.activeChatId);
            setBackgroundMode(snapshot.backgroundMode);
            setShowImageInfo(snapshot.showImageInfo);
            setViewport(project.viewport);
            resetHistory(snapshot);
            setProjectLoaded(true);
        };

        const restore = async () => {
            const resetNodes = resetInterruptedGeneration(project.nodes);
            const initialNodes = removeLegacyCharacterCards(resetNodes, project.connections).nodes;
            const initialSessions = project.chatSessions || [];

            // 先恢复可交互的节点和布局，媒体缓存/资源校验放到后台，避免首屏被远程资源拖住。
            applyRestoredProject(initialNodes, initialSessions);
            const [nodesResult, sessionsResult] = await Promise.allSettled([hydrateCanvasImages(initialNodes), hydrateAssistantImages(initialSessions)]);
            if (cancelled) return;
            if (nodesResult.status === "fulfilled") setNodes((current) => mergeHydratedNodeMedia(current, initialNodes, nodesResult.value));
            if (sessionsResult.status === "fulfilled") setChatSessions((current) => mergeHydratedSessions(current, sessionsResult.value));
            if (nodesResult.status === "rejected" || sessionsResult.status === "rejected") message.warning("部分本地媒体恢复失败，已使用项目记录继续打开");
        };
        void restore();
        return () => {
            cancelled = true;
        };
    }, [hydrated, message, navigate, openProject, projectId, resetHistory, setActiveChatId, setBackgroundMode, setChatSessions, setConnections, setNodes, setShowImageInfo, setViewport]);

    useEffect(() => {
        if (!projectLoaded) return;
        let cancelled = false;
        listActivatedSkills()
            .then(({ skills }) => {
                if (!cancelled) setActivatedSkills(skills);
            })
            .catch(() => {
                if (!cancelled) setActivatedSkills([]);
            });
        return () => {
            cancelled = true;
        };
    }, [projectLoaded]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, historyPausedRef, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport, viewportRef]);

    useEffect(() => () => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        updateProject(projectId, { viewport: viewportRef.current });
    }, [projectId, projectLoaded, updateProject, viewportRef]);

    const createAndOpenProject = useCallback(() => {
        void createCanvasProjectWithRemoteSync(`无限画布 ${useCanvasStore.getState().projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            navigate(`/canvas/${id}`);
        });
    }, [message, navigate]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const renameCurrentProject = useCallback((title: string) => {
        renameProject(projectId, title);
    }, [projectId, renameProject]);

    const saveCanvasProject = useCallback(async () => {
        try {
            updateProject(projectId, {
                nodes: nodesRef.current,
                connections: connectionsRef.current,
                chatSessions,
                activeChatId,
                backgroundMode,
                showImageInfo,
                viewport: viewportRef.current,
                directorScenes: currentProject?.directorScenes || [],
            });
            await flushCanvasStorePersistence();
        } catch {
            message.error("画布保存失败，请稍后重试");
            return;
        }
        try {
            await saveRemoteUserDataNow();
            message.success("画布布局和位置已保存");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "未知错误";
            message.warning(`本地画布布局已保存，云端同步失败：${detail}`);
        }
    }, [activeChatId, backgroundMode, chatSessions, connectionsRef, currentProject?.directorScenes, message, nodesRef, projectId, showImageInfo, updateProject, viewportRef]);

    const clearCanvasFiles = useCallback(() => {
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, projectId]);

    return {
        activatedSkills,
        clearCanvasFiles,
        createAndOpenProject,
        currentProject,
        deleteCurrentProject,
        renameCurrentProject,
        saveCanvasProject,
        updateProject,
    };
}

const hydratedMediaMetadataKeys = ["content", "storageKey", "naturalWidth", "naturalHeight", "bytes", "mimeType", "durationMs"] as const satisfies readonly (keyof CanvasNodeMetadata)[];

function mergeHydratedNodeMedia(currentNodes: CanvasNodeData[], initialNodes: CanvasNodeData[], hydratedNodes: CanvasNodeData[]) {
    const initialById = new Map(initialNodes.map((node) => [node.id, node]));
    const hydratedById = new Map(hydratedNodes.map((node) => [node.id, node]));
    return currentNodes.map((node) => {
        const initial = initialById.get(node.id);
        const hydrated = hydratedById.get(node.id);
        if (!initial || !hydrated || node.metadata?.content !== initial.metadata?.content) return node;
        const metadata = { ...node.metadata } as CanvasNodeMetadata;
        hydratedMediaMetadataKeys.forEach((key) => {
            const value = hydrated.metadata?.[key];
            if (value !== undefined) (metadata as Record<string, unknown>)[key] = value;
        });
        return { ...node, metadata };
    });
}

function mergeHydratedSessions(currentSessions: CanvasAssistantSession[], hydratedSessions: CanvasAssistantSession[]) {
    const hydratedById = new Map(hydratedSessions.map((session) => [session.id, session]));
    return currentSessions.map((session) => {
        const hydrated = hydratedById.get(session.id);
        if (!hydrated) return session;
        const hydratedMessages = new Map(hydrated.messages.map((message) => [message.id, message]));
        return {
            ...session,
            messages: session.messages.map((message) => {
                const hydratedMessage = hydratedMessages.get(message.id);
                if (!hydratedMessage || !message.references?.length) return message;
                const hydratedReferences = new Map((hydratedMessage.references || []).map((reference) => [reference.id, reference]));
                return {
                    ...message,
                    references: message.references.map((reference) => {
                        const hydratedReference = hydratedReferences.get(reference.id);
                        return hydratedReference ? { ...reference, dataUrl: hydratedReference.dataUrl, storageKey: hydratedReference.storageKey } : reference;
                    }),
                };
            }),
        };
    });
}
