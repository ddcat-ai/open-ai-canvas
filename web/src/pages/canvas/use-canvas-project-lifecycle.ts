import { agentCanvasFocusTargets, type AgentCanvasFocus } from "@/lib/canvas/agent-canvas-focus";
import { mergeAgentCanvasEditor } from "@/lib/canvas/agent-canvas-patch";
import { rebaseCanvasLocalEdits } from "@/lib/canvas/canvas-sync-rebase";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { App } from "antd";
import { useNavigate } from "react-router";

import { canvasAppearanceBaseTheme, canvasAppearanceForTheme, DEFAULT_CANVAS_BACKGROUND_MODE, normalizeCanvasAppearance, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { removeCanvasDrawing } from "@/lib/canvas/canvas-drawing-storage";
import { normalizeCanvasNodeTimestamps } from "@/lib/canvas/canvas-node-timestamps";
import { canvasPersistentNodes } from "@/lib/canvas/canvas-persistent-nodes";
import { hydrateAssistantImages, resetInterruptedGeneration } from "@/lib/canvas/canvas-project-generation";
import { listAddedSkills, type Skill } from "@/services/api/skills";
import { createCanvasProjectWithRemoteSync, deleteCanvasProjectsWithRemoteSync, loadCanvasProjectForEditing, saveRemoteUserDataNow, prepareCanvasForCloudAction, subscribeAgentCanvasRefresh, refreshCanvasAfterAgent } from "@/services/user-data-sync";
import { getCanvasSyncStatus } from "@/services/api/user-data";
import { canvasEditLeases } from "@/services/canvas-edit-leases";
import { startCanvasSyncPolling } from "@/services/canvas-sync-polling";
import { subscribeCanvasRealtime } from "@/services/canvas-realtime";
import { getActiveUserScope } from "@/lib/user-scope";
import { waitForCanvasSync } from "@/lib/canvas/sync-recovery";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasHistorySnapshot } from "./use-canvas-history";

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
    cleanupAssetImages,
    cleanupCanvasFiles,
}: UseCanvasProjectLifecycleOptions) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const userId = useUserStore((state) => state.user?.id);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const [addedSkills, setAddedSkills] = useState<Skill[]>([]);
    const [loadError, setLoadError] = useState("");
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [agentFocus, setAgentFocus] = useState<{ projectId: string; focus: AgentCanvasFocus } | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const observedContentRef = useRef<CanvasHistorySnapshot | null>(null);
    const persistentNodesRef = useRef<CanvasNodeData[]>([]);
    const persistentNodes = useMemo(() => {
        persistentNodesRef.current = canvasPersistentNodes(nodes, persistentNodesRef.current);
        return persistentNodesRef.current;
    }, [nodes]);
    const editorReadyRef = useRef(false);

    useEffect(() => {
        if (!hydrated || !sessionHydrated) return;
        let cancelled = false;
        // Keep load intent on the refs until this attempt finishes. React Strict
        // Mode remounts the effect; consuming the flags here would turn "load
        // latest" into a normal open and immediately recreate the conflict.
        const keepEditor = editorReadyRef.current;
        if (!keepEditor) {
            editorReadyRef.current = false;
            setProjectLoaded(false);
            setLoadError("");
            observedContentRef.current = null;
        }
        const applyRestoredProject = (targetProject: CanvasProject) => {
            if (cancelled) return;
            const fallbackTheme = useCanvasThemeStore.getState().theme;
            const restoredAppearance = targetProject.appearance ? normalizeCanvasAppearance(targetProject.appearance, fallbackTheme) : canvasAppearanceForTheme(fallbackTheme);
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
            if (cachedProject) {
                // 本地已有该画布的持久化缓存：先以本地数据秒开渲染，彻底消除白屏与等待
                applyRestoredProject(cachedProject);
            }
            const loadedProject = await waitForCanvasSync(loadCanvasProjectForEditing(projectId, { onLoad: applyRestoredProject }));
            if (cancelled) return;
            if (!loadedProject) {
                if (!cachedProject) navigate("/canvas", { replace: true });
                return;
            }
            const project = useCanvasStore.getState().projects.find((p) => p.id === projectId) || loadedProject;

            // 画布媒体由节点自己的视口观察器按需加载；打开时遍历并解析全部节点会让大画布形成 N+1 资源读取。
            void hydrateAssistantImages(project.chatSessions || [])
                .then((hydratedSessions) => {
                    if (!cancelled)
                        setChatSessions((current) => {
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
            })
            .catch((error) => {
                if (cancelled) return;
                useSyncProgressStore.getState().setProjectProgress(projectId, { phase: "pending", errorKind: "network", message: error instanceof Error ? `画布同步失败：${error.message}` : "画布同步失败" });
                // A cached editor may have become ready during this very load.
                // Do not cover it with the cold-start error screen.
                if (editorReadyRef.current) setLoadError("");
                else setLoadError(error instanceof Error ? error.message : "画布加载失败");
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

    useEffect(
        () =>
            subscribeAgentCanvasRefresh((project, previous, source) => {
                if (!projectLoaded || project.id !== projectId) return;
                if (source === "sync") {
                    const fallbackTheme = useCanvasThemeStore.getState().theme;
                    const editor = {
                        ...(previous || project),
                        nodes: nodesRef.current,
                        connections: connectionsRef.current,
                        chatSessions: chatSessionsRef.current,
                        activeChatId: activeChatIdRef.current,
                        appearance: canvasAppearance,
                        backgroundMode,
                        showImageInfo,
                    };
                    const merged = previous ? rebaseCanvasLocalEdits(previous, project, editor) : project;
                    const appearance = merged.appearance ? normalizeCanvasAppearance(merged.appearance, fallbackTheme) : canvasAppearanceForTheme(fallbackTheme);
                    const snapshot: CanvasHistorySnapshot = {
                        nodes: merged.nodes,
                        connections: merged.connections,
                        chatSessions: merged.chatSessions || [],
                        activeChatId: merged.activeChatId || null,
                        canvasAppearance: appearance,
                        backgroundMode: merged.backgroundMode || DEFAULT_CANVAS_BACKGROUND_MODE,
                        showImageInfo: merged.showImageInfo || false,
                    };
                    observedContentRef.current = {
                        ...snapshot,
                        nodes: project.nodes,
                        connections: project.connections,
                        chatSessions: project.chatSessions || [],
                        activeChatId: project.activeChatId || null,
                        canvasAppearance: project.appearance ? normalizeCanvasAppearance(project.appearance, fallbackTheme) : canvasAppearanceForTheme(fallbackTheme),
                        backgroundMode: project.backgroundMode || DEFAULT_CANVAS_BACKGROUND_MODE,
                        showImageInfo: project.showImageInfo || false,
                    };
                    nodesRef.current = snapshot.nodes;
                    connectionsRef.current = snapshot.connections;
                    chatSessionsRef.current = snapshot.chatSessions;
                    activeChatIdRef.current = snapshot.activeChatId;
                    setNodes(snapshot.nodes);
                    setConnections(snapshot.connections);
                    setChatSessions(snapshot.chatSessions);
                    setActiveChatId(snapshot.activeChatId);
                    setCanvasAppearance(snapshot.canvasAppearance);
                    setBackgroundMode(snapshot.backgroundMode);
                    setShowImageInfo(snapshot.showImageInfo);
                    setLoadError("");
                    return;
                }
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
                const focus = agentCanvasFocusTargets(previous, project);
                if (focus) {
                    // 镜头跟随编辑器里的实际位置：用户可能正拖着其中某个节点。
                    const liveById = new Map(merged.nodes.map((node) => [node.id, node]));
                    const nodes = focus.nodes.map((node) => liveById.get(node.id)).filter((node): node is CanvasNodeData => Boolean(node));
                    if (nodes.length) setAgentFocus({ projectId: project.id, focus: { ...focus, nodes } });
                }
            }),
        [
            projectId,
            projectLoaded,
            nodesRef,
            connectionsRef,
            chatSessionsRef,
            activeChatIdRef,
            canvasAppearance,
            backgroundMode,
            showImageInfo,
            setNodes,
            setConnections,
            setChatSessions,
            setActiveChatId,
            setCanvasAppearance,
            setBackgroundMode,
            setShowImageInfo,
        ],
    );

    useEffect(() => {
        if (!projectLoaded || !sessionHydrated) return;
        const scope = getActiveUserScope();
        let connected = false;
        let agentActive = false;
        // Lease maintenance must continue independently of remote notifications.
        let ticking = false;
        const tick = async () => {
            if (ticking || scope !== getActiveUserScope() || navigator.onLine === false) return;
            ticking = true;
            try {
                await canvasEditLeases.tick(projectId);
            } finally {
                ticking = false;
            }
        };
        const leaseTimer = setInterval(() => {
            void tick();
        }, 2000);
        void tick();
        const stop = startCanvasSyncPolling(
            async (signal) => {
                if (scope !== getActiveUserScope()) return;
                const token = canvasEditLeases.statusToken(projectId);
                const status = await getCanvasSyncStatus(projectId, signal);
                if (signal.aborted || scope !== getActiveUserScope()) return;
                agentActive = Boolean(status.agent);
                canvasEditLeases.status(projectId, status, token);
                const current = useCanvasStore.getState().openProject(projectId);
                // Agent 运行时 SSE 增量会先把本地 revision 推前；轮询响应落后时不应再拉整份快照。
                if (current && (!Number.isSafeInteger(current.revision) || status.revision > current.revision!)) await refreshCanvasAfterAgent(projectId, "sync");
            },
            undefined,
            {
                interval: () => (connected && !agentActive ? 30000 : 2000),
                listen: (wake) =>
                    subscribeCanvasRealtime(projectId, (state, event) => {
                        const disconnected = connected && !state.connected;
                        connected = state.connected;
                        if (event === "invalidate" || disconnected) wake();
                    }),
            },
        );
        return () => {
            stop();
            clearInterval(leaseTimer);
        };
    }, [projectId, projectLoaded, sessionHydrated, userId]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        const snapshot = { nodes: persistentNodes, connections, chatSessions, activeChatId, canvasAppearance, backgroundMode, showImageInfo };
        if (!observedContentRef.current || sameCanvasHistorySnapshot(observedContentRef.current, snapshot)) return;
        observedContentRef.current = snapshot;
        const patch = { nodes: persistentNodes, connections, chatSessions, activeChatId, appearance: canvasAppearance, backgroundMode, showImageInfo };
        const stored = useCanvasStore.getState().projects.find((project) => project.id === projectId);
        // 远端结果投影到编辑器不是一次本地编辑，避免改写时间戳并触发反向保存。
        if (stored && sameCanvasPatch(stored, patch)) return;
        updateProject(projectId, patch);
    }, [activeChatId, backgroundMode, canvasAppearance, chatSessions, connections, historyPausedRef, persistentNodes, projectId, projectLoaded, showImageInfo, updateProject]);

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

    useEffect(
        () => () => {
            if (!projectLoaded) return;
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
            updateProject(projectId, { viewport: viewportRef.current });
        },
        [projectId, projectLoaded, updateProject, viewportRef],
    );

    const createAndOpenProject = useCallback(() => {
        void createCanvasProjectWithRemoteSync(`自由画布 ${useCanvasStore.getState().projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) console.warn("新画布等待后台同步", syncError);
            navigate(`/canvas/${id}`);
        });
    }, [message, navigate]);

    const deleteCurrentProject = useCallback(async () => {
        const drawingIds = nodesRef.current.flatMap((node) => (node.type === "drawing" && node.metadata?.drawingId ? [node.metadata.drawingId] : []));
        try {
            await deleteCanvasProjectsWithRemoteSync([projectId]);
        } catch (error) {
            message.error(error instanceof Error ? `删除画布失败：${error.message}` : "删除画布失败，请稍后重试");
            return;
        }
        if (drawingIds.length) {
            void Promise.all(drawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId))).catch(() => message.warning("项目已删除，但部分本地绘图缓存清理失败"));
        }
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, message, navigate, nodesRef, projectId]);

    const renameCurrentProject = useCallback(
        (title: string) => {
            renameProject(projectId, title);
            // 标题是画布列表和分享入口的元数据，重命名后立即提交，避免只停留在浏览器缓存。
            void saveRemoteUserDataNow(projectId).catch((error) => {
                // 后台同步状态统一显示在同步面板，避免每次重试都打断编辑。
                void error;
            });
        },
        [message, projectId, renameProject],
    );

    const persistLocalEdits = useCallback(
        async (options: { flush?: boolean } = {}) => {
            const durableNodes = canvasPersistentNodes(nodesRef.current, observedContentRef.current?.nodes);
            const snapshot = { nodes: durableNodes, connections: connectionsRef.current, chatSessions, activeChatId, canvasAppearance, backgroundMode, showImageInfo };
            if (observedContentRef.current && !sameCanvasHistorySnapshot(observedContentRef.current, snapshot)) {
                updateProject(projectId, {
                    nodes: durableNodes,
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
            if (options.flush !== false) await waitForCanvasSync(flushCanvasStorePersistence());
        },
        [activeChatId, backgroundMode, canvasAppearance, chatSessions, connectionsRef, nodesRef, projectId, showImageInfo, updateProject, viewportRef],
    );

    const saveCanvasProject = useCallback(
        async (options: { requireRemote?: boolean } = {}): Promise<boolean> => {
            try {
                await persistLocalEdits();
            } catch (error) {
                console.warn("画布本地持久化暂未完成", error);
            }
            try {
                if (options.requireRemote === false) {
                    await saveRemoteUserDataNow(projectId);
                    message.success("画布已保存到云端");
                } else {
                    await prepareCanvasForCloudAction(projectId);
                    message.success("画布已保存到云端");
                }
                return true;
            } catch (error) {
                console.warn("画布等待后台同步", error);
                return false;
            }
        },
        [message, persistLocalEdits, projectId],
    );

    const clearCanvasFiles = useCallback(() => {
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, projectId]);

    return {
        loadError,
        retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
        addedSkills,
        agentFocus: agentFocus?.projectId === projectId ? agentFocus.focus : null,
        clearCanvasFiles,
        createAndOpenProject,
        currentProject,
        deleteCurrentProject,
        renameCurrentProject,
        saveCanvasProject,
        persistLocalEdits,
        updateProject,
    };
}

function sameCanvasHistorySnapshot(left: CanvasHistorySnapshot, right: CanvasHistorySnapshot) {
    return (
        left.nodes === right.nodes &&
        left.connections === right.connections &&
        left.chatSessions === right.chatSessions &&
        left.activeChatId === right.activeChatId &&
        left.canvasAppearance === right.canvasAppearance &&
        left.backgroundMode === right.backgroundMode &&
        left.showImageInfo === right.showImageInfo
    );
}

function sameCanvasPatch(project: CanvasProject, patch: Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo"> & { appearance: CanvasProject["appearance"] }) {
    return (
        project.nodes === patch.nodes &&
        project.connections === patch.connections &&
        project.chatSessions === patch.chatSessions &&
        project.activeChatId === patch.activeChatId &&
        project.appearance === patch.appearance &&
        project.backgroundMode === patch.backgroundMode &&
        project.showImageInfo === patch.showImageInfo
    );
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
