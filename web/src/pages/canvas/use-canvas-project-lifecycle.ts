import { mergeAgentCanvasEditor } from "@/lib/canvas/agent-canvas-patch";
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { App } from "antd";
import { useNavigate } from "react-router";

import { canvasAppearanceBaseTheme, canvasAppearanceForTheme, DEFAULT_CANVAS_BACKGROUND_MODE, normalizeCanvasAppearance, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { removeCanvasDrawing } from "@/lib/canvas/canvas-drawing-storage";
import { normalizeCanvasNodeTimestamps } from "@/lib/canvas/canvas-node-timestamps";
import { hydrateAssistantImages, resetInterruptedGeneration } from "@/lib/canvas/canvas-project-generation";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { applyCanvasCollaborationRemoteOperation, preserveCanvasLiveConflict, pullLatestCollaborativeCanvasProject, createCanvasProjectWithRemoteSync, deleteCanvasProjectsWithRemoteSync, forceOverwriteRemoteCanvasSync, loadCanvasProjectForEditing, saveRemoteUserDataNow, subscribeAgentCanvasRefresh } from "@/services/user-data-sync";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { readCanvasSyncDrafts } from "@/services/canvas-sync-drafts";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasHistorySnapshot } from "./use-canvas-history";
import { rebaseCanvasCollaborationProject } from "@/lib/canvas/canvas-collaboration-rebase";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type UseCanvasProjectLifecycleOptions = {
    projectId: string;
    projectLoaded: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    canvasAppearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    chatSessionsRef: MutableRefObject<CanvasAssistantSession[]>;
    activeChatIdRef: MutableRefObject<string | null>;
    viewportRef: MutableRefObject<ViewportTransform>;
    historyPausedRef: MutableRefObject<boolean>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setChatSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
    setActiveChatId: Dispatch<SetStateAction<string | null>>;
    setCanvasAppearance: Dispatch<SetStateAction<CanvasAppearance>>;
    setBackgroundMode: Dispatch<SetStateAction<CanvasBackgroundMode>>;
    setShowImageInfo: Dispatch<SetStateAction<boolean>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setProjectLoaded: Dispatch<SetStateAction<boolean>>;
    resetHistory: (snapshot: CanvasHistorySnapshot) => void;
    adoptRemoteHistory: (before: CanvasHistorySnapshot, next: CanvasHistorySnapshot) => void;
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
    canvasAppearance,
    backgroundMode,
    showImageInfo,
    viewport,
    nodesRef,
    connectionsRef,
    chatSessionsRef,
    activeChatIdRef,
    viewportRef,
    historyPausedRef,
    setNodes,
    setConnections,
    setChatSessions,
    setActiveChatId,
    setCanvasAppearance,
    setBackgroundMode,
    setShowImageInfo,
    setViewport,
    setProjectLoaded,
    resetHistory,
    adoptRemoteHistory,
    cleanupAssetImages,
    cleanupCanvasFiles,
}: UseCanvasProjectLifecycleOptions) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const [loadError, setLoadError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [agentCreatedNodes, setAgentCreatedNodes] = useState<{ projectId: string; nodes: CanvasNodeData[] } | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const observedContentRef = useRef<CanvasHistorySnapshot | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);
	const collaborativePullInFlightRef = useRef(false);
	const collaborativePullQueuedRef = useRef(false);
    const loadLatestRef = useRef(false);
    const historyRestoreRef = useRef<{ snapshotId: string; revision: number; resolve: () => void; reject: (error: unknown) => void } | null>(null);
    const pendingReloadRef = useRef<{ resolve: () => void; reject: (error: unknown) => void } | null>(null);
    const editorReadyRef = useRef(false);

    useEffect(() => {
        if (!hydrated || !sessionHydrated) return;
        let cancelled = false;
        // Keep load intent on the refs until this attempt finishes. React Strict
        // Mode remounts the effect; consuming the flags here would turn "load
        // latest" into a normal open and immediately recreate the conflict.
        const latest = loadLatestRef.current;
        const historyRestore = historyRestoreRef.current;
        const pendingReload = pendingReloadRef.current;
        const keepEditor = editorReadyRef.current && (latest || Boolean(historyRestore));
        if (!keepEditor) {
            editorReadyRef.current = false;
            setProjectLoaded(false);
            setLoadError("");
            observedContentRef.current = null;
        }
        const applyRestoredProject = (targetProject: CanvasProject) => {
            if (cancelled) return;
            const fallbackTheme = useCanvasThemeStore.getState().theme;
            const restoredAppearance = targetProject.appearance
                ? normalizeCanvasAppearance(targetProject.appearance, fallbackTheme)
                : canvasAppearanceForTheme(fallbackTheme);
            const initialNodes = normalizeCanvasNodeTimestamps(resetInterruptedGeneration(targetProject.nodes), {
                createdAt: targetProject.createdAt,
                updatedAt: targetProject.updatedAt,
            });
            const snapshot: CanvasHistorySnapshot = {
                nodes: initialNodes,
                connections: targetProject.connections,
                chatSessions: targetProject.chatSessions || [],
                activeChatId: targetProject.activeChatId || null,
                canvasAppearance: restoredAppearance,
                backgroundMode: targetProject.backgroundMode || DEFAULT_CANVAS_BACKGROUND_MODE,
                showImageInfo: targetProject.showImageInfo || false,
            };
            observedContentRef.current = snapshot;
            chatSessionsRef.current = snapshot.chatSessions;
            activeChatIdRef.current = snapshot.activeChatId;
            nodesRef.current = snapshot.nodes;
            connectionsRef.current = snapshot.connections;
            viewportRef.current = targetProject.viewport;
            setNodes(snapshot.nodes);
            setConnections(snapshot.connections);
            setChatSessions(snapshot.chatSessions);
            setActiveChatId(snapshot.activeChatId);
            setCanvasAppearance(snapshot.canvasAppearance);
            useCanvasThemeStore.getState().setTheme(canvasAppearanceBaseTheme(snapshot.canvasAppearance, fallbackTheme));
            setBackgroundMode(snapshot.backgroundMode);
            setShowImageInfo(snapshot.showImageInfo);
            setViewport(targetProject.viewport);
            resetHistory(snapshot);
            editorReadyRef.current = true;
            setProjectLoaded(true);
        };

        const load = async () => {
            const cachedProject = useCanvasStore.getState().projects.find((p) => p.id === projectId);
            if (!latest && !historyRestore && cachedProject && cachedProject.nodes?.length) {
                // 本地已有该画布的持久化缓存：先以本地数据秒开渲染，彻底消除白屏与等待
                applyRestoredProject(cachedProject);
            }
            const loadedProject = await loadCanvasProjectForEditing(projectId, { latest, historyRestore: historyRestore || undefined, onLoad: applyRestoredProject });
            if (cancelled) return;
            if (historyRestoreRef.current === historyRestore) {
                historyRestoreRef.current = null;
                historyRestore?.resolve();
            }
            if (!loadedProject) {
                if (!cachedProject) navigate("/canvas", { replace: true });
                return;
            }
            const project = useCanvasStore.getState().projects.find((p) => p.id === projectId) || loadedProject;

            // 画布媒体由节点自己的视口观察器按需加载；打开时遍历并解析全部节点会让大画布形成 N+1 资源读取。
            void hydrateAssistantImages(project.chatSessions || [])
                .then((hydratedSessions) => {
                    if (!cancelled) setChatSessions((current) => {
                        const merged = mergeHydratedSessions(current, hydratedSessions);
                        if (observedContentRef.current?.chatSessions === current) observedContentRef.current = { ...observedContentRef.current, chatSessions: merged };
                        return merged;
                    });
                })
                .catch(() => {
                    if (!cancelled) message.warning("部分助手会话素材恢复失败，已使用项目记录继续打开");
                });
        };
        void load()
            .then(() => {
                if (cancelled) return;
                loadLatestRef.current = false;
                if (pendingReloadRef.current === pendingReload) {
                    pendingReloadRef.current = null;
                    pendingReload?.resolve();
                }
            })
            .catch((error) => {
                if (cancelled) return;
                loadLatestRef.current = false;
                if (historyRestoreRef.current === historyRestore) {
                    historyRestoreRef.current = null;
                    historyRestore?.reject(error);
                }
                if (pendingReloadRef.current === pendingReload) {
                    pendingReloadRef.current = null;
                    pendingReload?.reject(error);
                }
                if (useSyncProgressStore.getState().syncingProjects[projectId]?.phase !== "conflict") useSyncProgressStore.getState().setProjectProgress(projectId, { phase: "error", message: error instanceof Error ? error.message : "读取云端版本失败" });
                const detail = error instanceof Error ? error.message : "读取画布失败，请重试";
                if (keepEditor) message.error(detail);
                else setLoadError(detail);
            });
        return () => {
            cancelled = true;
        };
    }, [hydrated, sessionHydrated, loadAttempt, message, navigate, openProject, projectId, resetHistory, setActiveChatId, setBackgroundMode, setCanvasAppearance, setChatSessions, setConnections, setNodes, setShowImageInfo, setViewport]);

	useEffect(() => {
		if (!projectLoaded) return;
        let cancelled = false;
        listAddedSkills()
            .then(({ skills }) => {
                if (!cancelled) setAddedSkills(skills);
            })
            .catch(() => {
                if (!cancelled) setAddedSkills([]);
            });
        return () => {
            cancelled = true;
        };
	}, [projectLoaded]);

	useEffect(() => {
		if (!projectLoaded) return;
		let cancelled = false;
		const applyPulledProject = (project: CanvasProject) => {
			if (cancelled) return;
			const fallbackTheme = useCanvasThemeStore.getState().theme;
			const nextAppearance = project.appearance
				? normalizeCanvasAppearance(project.appearance, fallbackTheme)
				: canvasAppearanceForTheme(fallbackTheme);
			const nextNodes = project.nodes || [];
			const before = observedContentRef.current;
			observedContentRef.current = {
				nodes: nextNodes,
				connections: project.connections || [],
				chatSessions: project.chatSessions || [],
				activeChatId: project.activeChatId || null,
				canvasAppearance: nextAppearance,
				backgroundMode: project.backgroundMode || DEFAULT_CANVAS_BACKGROUND_MODE,
				showImageInfo: project.showImageInfo || false,
			};
			if (before) adoptRemoteHistory({ ...before, nodes: nodesRef.current, connections: connectionsRef.current, chatSessions: chatSessionsRef.current, activeChatId: activeChatIdRef.current }, observedContentRef.current);
			nodesRef.current = nextNodes;
			connectionsRef.current = project.connections || [];
			chatSessionsRef.current = project.chatSessions || [];
			activeChatIdRef.current = project.activeChatId || null;
			setNodes(nextNodes);
			setConnections(project.connections || []);
			setChatSessions(project.chatSessions || []);
			setActiveChatId(project.activeChatId || null);
			setCanvasAppearance(nextAppearance);
			setBackgroundMode(project.backgroundMode || DEFAULT_CANVAS_BACKGROUND_MODE);
			setShowImageInfo(project.showImageInfo || false);
			useCanvasThemeStore.getState().setTheme(canvasAppearanceBaseTheme(nextAppearance, fallbackTheme));
		};
        const onProjection = (event: Event) => {
            const detail = (event as CustomEvent<{ canvasId: string; previous?: CanvasProject; project: CanvasProject }>).detail;
            if (cancelled || detail?.canvasId !== projectId) return;
            const previous = detail.previous;
            const live = previous ? {
                ...previous, nodes: nodesRef.current, connections: connectionsRef.current,
                chatSessions: chatSessionsRef.current, activeChatId: activeChatIdRef.current,
            } : detail.project;
            const rebased = previous && rebaseCanvasCollaborationProject(previous, live, detail.project);
            const project = rebased?.project || detail.project;
            if (previous && rebased?.conflicts.length) void preserveCanvasLiveConflict(previous, live, detail.project);
            // Editor callbacks may run between the network request and store
            // publication. Carry those newer edits forward before rendering.
            applyPulledProject(project);
            useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => item.id === projectId ? project : item) }));
        };
        window.addEventListener("canvas-collaboration-projection", onProjection);
        // A branch can also merge into a private canvas. Its own merge receipt
        // must update the editor even though background collaboration is off.
        if (!currentProject?.collaborationEnabled) return () => {
            cancelled = true;
            window.removeEventListener("canvas-collaboration-projection", onProjection);
        };
        const pull = () => {
            if (cancelled || document.visibilityState === "hidden") return;
            if (collaborativePullInFlightRef.current) {
                collaborativePullQueuedRef.current = true;
                return;
            }
            collaborativePullQueuedRef.current = false;
            collaborativePullInFlightRef.current = true;
            void pullLatestCollaborativeCanvasProject(projectId).catch((error) => {
                if (!cancelled) console.warn("协作画布轮询失败", error);
            }).finally(() => {
                collaborativePullInFlightRef.current = false;
                if (collaborativePullQueuedRef.current && !cancelled) {
                    collaborativePullQueuedRef.current = false;
                    pull();
                }
            });
        };
        const onRealtimeOperation = (event: Event) => {
            const detail = (event as CustomEvent<{ canvasId?: string; operation?: import("@/services/api/canvas-collaboration").CanvasCollaborationOperationDelta }>).detail;
            if (detail?.canvasId !== projectId) return;
            if (detail.operation) {
                void applyCanvasCollaborationRemoteOperation(projectId, detail.operation).then((result) => {
                    if (!result) void pull();
                }).catch(() => pull());
                return;
            }
            void pull();
        };
        window.addEventListener("canvas-collaboration-remote-operation", onRealtimeOperation);
        void pull();
        const onVisibilityChange = () => { if (document.visibilityState === "visible") void pull(); };
        document.addEventListener("visibilitychange", onVisibilityChange);
        const timer = window.setInterval(pull, 5000);
        return () => {
            cancelled = true;
            collaborativePullQueuedRef.current = false;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("canvas-collaboration-remote-operation", onRealtimeOperation);
            window.removeEventListener("canvas-collaboration-projection", onProjection);
		};
	}, [currentProject?.collaborationEnabled, projectId, projectLoaded]);

    useEffect(() => subscribeAgentCanvasRefresh((project, previous) => {
        if (!projectLoaded || project.id !== projectId) return;
        // Merge only server-changed fields so dragging/editing other nodes can
        // continue while Agent media tasks complete. Same-field conflicts fail.
        const merged = previous ? mergeAgentCanvasEditor(previous, project, nodesRef.current, connectionsRef.current) : project;
        if (observedContentRef.current) {
            const observed = observedContentRef.current;
            // Advance only the observed server fields; edits in live refs still
            // differ from this baseline and must be persisted by the effect below.
            const baseline = previous ? mergeAgentCanvasEditor(previous, project, observed.nodes, observed.connections) : project;
            observedContentRef.current = { ...observed, nodes: baseline.nodes, connections: baseline.connections };
        }
        nodesRef.current = merged.nodes;
        connectionsRef.current = merged.connections;
        setNodes(merged.nodes);
        setConnections(merged.connections);
        const previousIds = new Set(previous?.nodes.map((node) => node.id));
        const created = project.nodes.filter((node) => !previousIds.has(node.id));
        if (created.length) setAgentCreatedNodes({ projectId: project.id, nodes: created });
    }), [projectId, projectLoaded, nodesRef, connectionsRef, setNodes, setConnections]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        const snapshot = { nodes, connections, chatSessions, activeChatId, canvasAppearance, backgroundMode, showImageInfo };
        const observed = observedContentRef.current;
        if (
            observed &&
            observed.nodes === nodes &&
            observed.connections === connections &&
            observed.chatSessions === chatSessions &&
            observed.activeChatId === activeChatId &&
            observed.canvasAppearance === canvasAppearance &&
            observed.backgroundMode === backgroundMode &&
            observed.showImageInfo === showImageInfo
        ) return;
        observedContentRef.current = snapshot;
        const patch = { nodes, connections, chatSessions, activeChatId, appearance: canvasAppearance, backgroundMode, showImageInfo };
        const stored = useCanvasStore.getState().projects.find((project) => project.id === projectId);
        // 远端结果投影到编辑器不是一次本地编辑，避免改写时间戳并触发反向保存。
        if (stored && Object.entries(patch).every(([key, value]) => JSON.stringify(stored[key as keyof CanvasProject]) === JSON.stringify(value))) return;
        updateProject(projectId, patch);
    }, [activeChatId, backgroundMode, canvasAppearance, chatSessions, connections, historyPausedRef, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

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
        void createCanvasProjectWithRemoteSync(`自由画布 ${useCanvasStore.getState().projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            navigate(`/canvas/${id}`);
        });
    }, [message, navigate]);

    const deleteCurrentProject = useCallback(async () => {
        let drawingIds = nodesRef.current.flatMap((node) => node.type === "drawing" && node.metadata?.drawingId ? [node.metadata.drawingId] : []);
        try {
            const drafts = await readCanvasSyncDrafts(projectId);
            const preserved = new Set(drafts.flatMap((draft) => draft.project.nodes.flatMap((node) => node.metadata?.drawingId ? [node.metadata.drawingId] : [])));
            drawingIds = drawingIds.filter((id) => !preserved.has(id));
            await deleteCanvasProjectsWithRemoteSync([projectId]);
        } catch (error) {
            message.error(error instanceof Error ? `删除画布失败：${error.message}` : "删除画布失败，请稍后重试");
            return;
        }
        if (drawingIds.length) {
            void Promise.all(drawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId)))
                .catch(() => message.warning("项目已删除，但部分本地绘图缓存清理失败"));
        }
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, message, navigate, nodesRef, projectId]);

    const renameCurrentProject = useCallback((title: string) => {
        renameProject(projectId, title);
        // 标题是画布列表和分享入口的元数据，重命名后立即提交，避免只停留在浏览器缓存。
        void saveRemoteUserDataNow(projectId).catch((error) => {
            message.warning(error instanceof Error ? `名称已更新到本地，云端同步将在后台重试：${error.message}` : "名称已更新到本地，云端同步将在后台重试");
        });
    }, [message, projectId, renameProject]);

    const persistLocalEdits = useCallback(async () => {
        const snapshot = { nodes: nodesRef.current, connections: connectionsRef.current, chatSessions, activeChatId, canvasAppearance, backgroundMode, showImageInfo };
        if (observedContentRef.current && JSON.stringify(observedContentRef.current) !== JSON.stringify(snapshot)) {
            updateProject(projectId, {
                nodes: nodesRef.current,
                connections: connectionsRef.current,
                chatSessions,
                activeChatId,
                appearance: canvasAppearance,
                backgroundMode,
                showImageInfo,
                viewport: viewportRef.current,
            });
            observedContentRef.current = snapshot;
        }
        updateProject(projectId, { viewport: viewportRef.current });
        await flushCanvasStorePersistence();
    }, [activeChatId, backgroundMode, canvasAppearance, chatSessions, connectionsRef, nodesRef, projectId, showImageInfo, updateProject, viewportRef]);

    const reloadLatestCanvasProject = useCallback(async () => {
        await persistLocalEdits();
        return new Promise<void>((resolve, reject) => {
            pendingReloadRef.current?.reject(new Error("已有新的加载请求"));
            loadLatestRef.current = true;
            pendingReloadRef.current = { resolve, reject };
            setLoadAttempt((value) => value + 1);
        });
    }, [persistLocalEdits]);

    const restoreCanvasProjectVersion = useCallback(async (snapshotId: string, revision: number) => {
        await persistLocalEdits();
        return new Promise<void>((resolve, reject) => {
            historyRestoreRef.current?.reject(new Error("已有新的恢复请求"));
            historyRestoreRef.current = { snapshotId, revision, resolve, reject };
            setLoadAttempt((value) => value + 1);
        });
    }, [persistLocalEdits]);

    const saveCanvasProject = useCallback(async (options: { requireRemote?: boolean } = {}): Promise<boolean> => {
        try {
            await persistLocalEdits();
        } catch {
            message.error("画布保存失败，请稍后重试");
            return false;
        }
        try {
            await saveRemoteUserDataNow(projectId);
            message.success("画布已保存到云端");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "未知错误";
            message.warning(`本地画布布局已保存，云端同步失败：${detail}`);
            // Imports can retain their durable local result; sharing requires cloud success.
            return options.requireRemote === false;
        }
        return true;
    }, [message, persistLocalEdits, projectId]);

    const forceSaveCanvasProject = useCallback(async (): Promise<boolean> => {
        try { await persistLocalEdits(); } catch { message.error("本地保存失败，请重试"); return false; }
        try {
            const result = await forceOverwriteRemoteCanvasSync();
            message.success(result.reboundNodes > 0 ? `已保存，并修复 ${result.reboundNodes} 处媒体与素材的绑定` : "素材关联已核对，画布已保存");
        } catch (error) {
            message.error(`修复并保存失败：${error instanceof Error ? error.message : "未知错误"}`);
            return false;
        }
        return true;
    }, [message, persistLocalEdits]);

    const clearCanvasFiles = useCallback(() => {
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, projectId]);

    return {
        loadError,
        retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
        addedSkills,
        agentCreatedNodes: agentCreatedNodes?.projectId === projectId ? agentCreatedNodes.nodes : null,
        clearCanvasFiles,
        createAndOpenProject,
        currentProject,
        deleteCurrentProject,
        renameCurrentProject,
        reloadLatestCanvasProject,
        restoreCanvasProjectVersion,
        saveCanvasProject,
        forceSaveCanvasProject,
        updateProject,
    };
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
