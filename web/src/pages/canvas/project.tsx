import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { uploadMediaFile } from "@/services/file-storage";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import copyToClipboard from "copy-to-clipboard";
import { nanoid } from "nanoid";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { persistCanvasMediaPerformanceMode, readCanvasMediaPerformanceMode } from "@/lib/canvas/canvas-performance-mode";
import { summarizeCanvasContext } from "@/lib/canvas/canvas-context-summary";
import { refreshCanvasCharacterReferenceNodes } from "@/lib/canvas/canvas-character-reference";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { App } from "antd";
import { getNodeSpec } from "@/constant/canvas";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasAssistantPanel } from "@/components/canvas/canvas-assistant-panel";
import { AssistantPanelColumn, getPanelWidthBounds } from "./canvas-assistant-panel-column";
import { CanvasActiveTaskPanel } from "@/components/canvas/canvas-active-task-panel";
import { CanvasAssetTray } from "@/components/canvas/canvas-asset-tray";
import { CanvasProjectSidebar } from "@/components/canvas/canvas-project-sidebar";
import { CanvasProjectAssetModal } from "@/components/canvas/canvas-project-asset-modal";
import { CanvasCharacterReferenceNodeContent } from "@/components/canvas/canvas-character-reference-node";
import { CanvasCharacterReferenceModal } from "@/components/canvas/canvas-character-reference-modal";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { resolveCanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { CanvasNodeToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-toolbar";
import { CanvasNodeAnglePanel } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasTextEditorModal } from "@/components/canvas/canvas-text-editor-modal";
import { CanvasNodeSearchModal } from "@/components/canvas/canvas-node-search-modal";
import { CanvasStylePickerModal } from "@/components/canvas/canvas-style-picker-modal";
import { CanvasFileDropOverlay } from "@/components/canvas/canvas-file-drop-overlay";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { getProject } from "@/services/api/projects";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { CanvasShareModal } from "@/components/canvas/canvas-share-modal";
import { CanvasScriptEditor, CanvasScriptNodeContent, STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardMinNodeHeight, storyboardTableHeight } from "@/components/canvas/canvas-script-node";
import { CanvasDirectorNodePanel } from "@/components/canvas/director/canvas-director-node-panel";
import { CanvasVersionCompareModal } from "@/components/canvas/canvas-version-compare-modal";
import { CanvasLocalAgentPanel } from "@/components/canvas/canvas-local-agent-panel";
import { useFocusMode } from "@/hooks/use-focus-mode";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasConnectionCreateMenu, CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasLeaferGraphicsLayer } from "@/components/canvas/canvas-leafer-graphics-layer";
import { CanvasFreeformEmptyState, CanvasLinkedProjectEmptyState, CanvasShortDramaEmptyState, CanvasShortDramaGuide, CanvasStoryInputNodeContent, CanvasStylePlaceholderNodeContent } from "@/components/canvas/canvas-short-drama-entry";
import {
    createCanvasNode,
    getInputSummary,
    isHiddenBatchChild,
    persistCanvasWorkspaceMode,
    readCanvasWorkspaceMode,
} from "@/lib/canvas/canvas-project-domain";
import {
    deriveStoryboardPipelineProgress,
} from "@/lib/canvas/canvas-storyboard-progress";
import { CanvasAgentChangeToast, CanvasMergeStatusToast, CanvasUploadStatusToast } from "./canvas-project-feedback";
import {
    backendProviderConfig,
    getGenerationCount,
} from "@/lib/canvas/canvas-project-generation";
import { CanvasTopBar } from "./canvas-project-top-bar";
import { CanvasFocusModeBar } from "@/components/canvas/canvas-focus-mode-bar";
import { CanvasProjectContextMenu } from "./canvas-project-context-menu";
import { CanvasProjectMediaDialogs } from "./canvas-project-media-dialogs";
import { CanvasProjectSelectionToolbar } from "./canvas-project-selection-toolbar";
import { CanvasProjectStatusDialogs } from "./canvas-project-status-dialogs";
import { CanvasProjectWorldLayers } from "./canvas-project-world-layers";
import type { CanvasImageEmotionPayload } from "@/components/canvas/canvas-node-emotion-panel";
import { CanvasEmotionWorkspace } from "@/components/canvas/canvas-emotion-workspace";
import { removeCanvasDrawing } from "@/lib/canvas/canvas-drawing-storage";
import { useCanvasConnectionController } from "./use-canvas-connection-controller";
import { useCanvasAgentOperations } from "./use-canvas-agent-operations";
import { useCanvasAssistantVisibility } from "./use-canvas-assistant-visibility";
import { useCanvasActiveTasks } from "./use-canvas-active-tasks";
import { useCanvasStyleWorkflow } from "./use-canvas-style-workflow";
import { useCanvasDirector } from "./use-canvas-director";
import { useCanvasGeneration } from "./use-canvas-generation";
import { useCanvasGenerationBatches } from "./use-canvas-generation-batches";
import { useCanvasGenerationExecutor } from "./use-canvas-generation-executor";
import { useCanvasGenerationRetry } from "./use-canvas-generation-retry";
import { useCanvasHistory } from "./use-canvas-history";
import { useCanvasKeyboard } from "./use-canvas-keyboard";
import { useCanvasMediaTools } from "./use-canvas-media-tools";
import { useCanvasNodeEditor } from "./use-canvas-node-editor";
import { useCanvasNodeOperations } from "./use-canvas-node-operations";
import { useCanvasProjectLifecycle } from "./use-canvas-project-lifecycle";
import { useCanvasRenderModel } from "./use-canvas-render-model";
import { useCanvasSelectionController } from "./use-canvas-selection-controller";
import { useCanvasShortDrama } from "./use-canvas-short-drama";
import { useCanvasStoryboard } from "./use-canvas-storyboard";
import { useCanvasUpload } from "./use-canvas-upload";
import { useCanvasViewportController } from "./use-canvas-viewport-controller";
import {
    CanvasNodeType,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasMediaPerformanceMode,
    type StoryboardColumn,
    type StoryboardShotCount,
    type StoryboardShotDuration,
    type CanvasWorkflowKind,
    type CanvasWorkspaceMode,
    type CanvasToolMode,
    type ContextMenuState,
    type Position,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

const CanvasDirectorWorkbench = lazy(() => import("@/components/canvas/director/canvas-director-workbench").then((module) => ({ default: module.CanvasDirectorWorkbench })));
const CanvasDrawingEditorModal = lazy(() => import("@/components/canvas/canvas-drawing-editor-modal").then((module) => ({ default: module.CanvasDrawingEditorModal })));

const NODE_STATUS_SUCCESS = "success" as const;
const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];

function visibleGenerationBatch(node: CanvasNodeData) {
    const batches = node.metadata?.generationBatches || [];
    for (let index = batches.length - 1; index >= 0; index -= 1) {
        if (batches[index].status === "queued" || batches[index].status === "running") return batches[index];
    }
    return batches.at(-1);
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function CanvasRefreshShell() {
    return (
        <main className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                }}
            />

            <div className="absolute bottom-5 left-1/2 z-[var(--z-toolbar)] flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-[var(--z-toolbar)] h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-[var(--z-toolbar)] flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
                <div className="h-1 flex-1 rounded-full bg-current opacity-10" />
                <div className="h-4 w-10 rounded bg-current opacity-10" />
                <div className="size-8 rounded-md bg-current opacity-10" />
            </div>
        </main>
    );
}

function InfiniteCanvasPage() {
    const { message } = App.useApp();
    const params = useParams<{ id: string }>();
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useCanvasAgentStore((state) => state.connected);
    const localAgentActivity = useCanvasAgentStore((state) => state.activity);
    const localAgentEnabled = useCanvasAgentStore((state) => state.enabled);
    const containerRef = useRef<HTMLDivElement>(null);
    const didInitialCenterRef = useRef(false);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const assets = useAssetStore((state) => state.assets);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const defaultDrawingEngine = useUserStore((state) => state.drawingEngine.defaultEngine);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("dots");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [canvasTool, setCanvasTool] = useState<CanvasToolMode>("move");
    const [mediaPerformanceMode, setMediaPerformanceMode] = useState<CanvasMediaPerformanceMode>(readCanvasMediaPerformanceMode);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [workspaceMode, setWorkspaceMode] = useState<CanvasWorkspaceMode>(readCanvasWorkspaceMode);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [textEditorNodeId, setTextEditorNodeId] = useState<string | null>(null);
    const [characterReferenceNodeId, setCharacterReferenceNodeId] = useState<string | null>(null);
    const [drawingNodeId, setDrawingNodeId] = useState<string | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [projectAssetOpen, setProjectAssetOpen] = useState(false);
    const [projectAssetInitialCategory, setProjectAssetInitialCategory] = useState("all");
    const [projectAssetInsertPosition, setProjectAssetInsertPosition] = useState<Position | undefined>();
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [scriptEditorNodeId, setScriptEditorNodeId] = useState<string | null>(null);
    const [scriptScrollTopById, setScriptScrollTopById] = useState<Record<string, number>>({});
    const [directorNodeId, setDirectorNodeId] = useState<string | null>(null);
    const [versionCompareRootId, setVersionCompareRootId] = useState<string | null>(null);
    const codexAutoConnect = ["new", "recent", "choose"].includes(searchParams.get("mode") || "");
    const codexCompactAgent = codexAutoConnect && searchParams.has("agentUrl");
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [shortcutRequestNonce, setShortcutRequestNonce] = useState(0);
    const [cinematicAgentEntry, setCinematicAgentEntry] = useState(false);
    // 面板初始宽度根据视口宽度动态选择，避免小屏幕上初始就过宽
    const [assistantWidth, setAssistantWidth] = useState(() => {
        const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
        if (vw < 768) return 300;
        if (vw < 1024) return 360;
        if (vw < 1440) return 440;
        return 520;
    });
    // 窗口跨越断点时把面板宽度 clamp 到当前断点的合理区间，避免宽屏值在窄屏挤压画布
    useEffect(() => {
        const clamp = () => {
            const { min, max } = getPanelWidthBounds();
            setAssistantWidth((prev) => (prev < min ? min : prev > max ? max : prev));
        };
        window.addEventListener("resize", clamp);
        return () => window.removeEventListener("resize", clamp);
    }, []);
    const { agentMode, assistantClosing, assistantMounted, assistantOpen, closeAgent, openAgent, setAgentMode } = useCanvasAssistantVisibility();
    const { tasks: activeTasks } = useCanvasActiveTasks(projectId, projectLoaded);
    const { focusMode, enterFocusMode, exitFocusMode, toggleFocusMode } = useFocusMode();
    const [focusDockRevealed, setFocusDockRevealed] = useState(false);

    useEffect(() => {
        persistCanvasWorkspaceMode(workspaceMode);
    }, [workspaceMode]);

    useEffect(() => {
        persistCanvasMediaPerformanceMode(mediaPerformanceMode);
    }, [mediaPerformanceMode]);

    useEffect(() => {
        didInitialCenterRef.current = false;
    }, [projectId]);

    useEffect(() => {
        const openSearch = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== "k") return;
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
            event.preventDefault();
            setNodeSearchOpen(true);
        };
        window.addEventListener("keydown", openSearch);
        return () => window.removeEventListener("keydown", openSearch);
    }, []);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);

    const { getHistoryCleanupContext, historyPausedRef, historyState, redoCanvas, resetHistory, undoCanvas } = useCanvasHistory({
        projectLoaded,
        nodes,
        connections,
        chatSessions,
        activeChatId,
        backgroundMode,
        showImageInfo,
        setNodes,
        setConnections,
        setChatSessions,
        setActiveChatId,
        setBackgroundMode,
        setShowImageInfo,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
    });

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, ...getHistoryCleanupContext() });
        },
        [cleanupAssetImages, getHistoryCleanupContext],
    );

    const {
        addedSkills,
        clearCanvasFiles,
        createAndOpenProject,
        currentProject,
        deleteCurrentProject,
        renameCurrentProject,
        saveCanvasProject,
        updateProject,
    } = useCanvasProjectLifecycle({
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
    });
    const linkedProjectId = shortDramaEnabled ? currentProject?.projectId || "" : "";
    const linkedProjectQuery = useQuery({ queryKey: ["project", linkedProjectId], queryFn: () => getProject(linkedProjectId), enabled: Boolean(linkedProjectId) });
    useEffect(() => {
        if (!projectLoaded || !linkedProjectQuery.data) return;
        setNodes((current) => refreshCanvasCharacterReferenceNodes(current, linkedProjectQuery.data.assets));
    }, [linkedProjectQuery.data, projectLoaded, setNodes]);
    const canvasContext = useMemo(
        () => summarizeCanvasContext(nodes, selectedNodeIds, linkedProjectQuery.data?.units),
        [linkedProjectQuery.data?.units, nodes, selectedNodeIds],
    );

    const {
        bindGenerationTask,
        cancelNodeTask,
        confirmStopGeneration,
        finishGenerationRequest,
        openNodeTaskDetails,
        runningNodeId,
        setRunningNodeId,
        setTaskDetail,
        startGenerationRequest,
        taskDetail,
        taskDetailLoading,
        taskDetailLogs,
    } = useCanvasGeneration({ projectId, domainProjectId: linkedProjectId, projectLoaded, nodes, nodesRef, setNodes });

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (searchParams.has("agentUrl")) {
            setAgentMode("local");
            return;
        }
        openAgent("local");
    }, [openAgent, projectLoaded, searchParams, setAgentMode]);

    // 沉浸专注进入时收起智能体与小地图、重置 Dock 唤出态；仅响应「进入」瞬间，避免关闭专注内主动唤出的面板。
    const prevFocusModeRef = useRef(focusMode);
    useEffect(() => {
        const enteredFocus = focusMode && !prevFocusModeRef.current;
        prevFocusModeRef.current = focusMode;
        if (!enteredFocus) return;
        closeAgent();
        setIsMiniMapOpen(false);
        setFocusDockRevealed(false);
    }, [closeAgent, focusMode]);


    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
    }, [nodes, connections, selectedNodeIds, viewport]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize((current) => current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                const current = viewportRef.current;
                if (current.x === 0 && current.y === 0 && current.k === 1) {
                    const centered = { x: rect.width / 2, y: rect.height / 2, k: 1 };
                    viewportRef.current = centered;
                    setViewport(centered);
                }
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [projectLoaded]);

    const {
        fitCanvasContent,
        fitCanvasSelection,
        focusCanvasImageNode,
        focusCanvasNode,
        getCanvasCenter,
        handleCanvasDoubleClick,
        handleViewportChange,
        handleViewportPreviewChange,
        previewViewport,
        resetViewport,
        screenToCanvas,
        setZoomScale,
        zoomCanvasIn,
        zoomCanvasOut,
        zoomToActualSize,
    } = useCanvasViewportController({
        containerRef,
        size,
        viewportRef,
        nodesRef,
        selectedNodeIdsRef,
        setViewport,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        setToolbarNodeId,
    });

    useEffect(() => {
        const preset = resolveCanvasStylePreset(linkedProjectQuery.data?.project.stylePresetId);
        if (!projectLoaded || !preset) return;
        const current = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
        const nextMetadata = {
            content: preset.prompt,
            prompt: preset.prompt,
            status: NODE_STATUS_SUCCESS,
            workflowKind: "styleboard" as const,
            workflowTitle: "项目画风",
            workflowDescription: preset.description,
            stylePresetId: preset.id,
            fontSize: 14,
            locked: true,
        };
        if (current) {
            if (current.metadata?.stylePresetId === preset.id && current.metadata?.content === preset.prompt && current.metadata?.locked) return;
            setNodes((nodes) => nodes.map((node) => node.id === current.id ? { ...node, title: `项目画风 · ${preset.title}`, metadata: { ...node.metadata, ...nextMetadata } } : node));
            return;
        }
        const node = createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), nextMetadata);
        node.title = `项目画风 · ${preset.title}`;
        node.width = 420;
        node.height = 240;
        setNodes((nodes) => [...nodes, node]);
    }, [getCanvasCenter, linkedProjectQuery.data?.project.stylePresetId, projectLoaded, setNodes]);

    const {
        assetPickerOpen,
        closeAssetPicker,
        createImageAssetNode,
        fileDropActive,
        handleAssetInsert,
        handleDrop,
        handleFileDragEnter,
        handleFileDragLeave,
        handleFileDragOver,
        handleImageInputChange,
        handleProjectAssetsInsert,
        handleProjectChapterInsert,
        handleUploadRequest,
        imageInputRef,
        openAssetsAtPosition,
        pasteAssistantImage,
        pasteSystemClipboard,
        startUploadStatus,
        uploadStatus,
    } = useCanvasUpload({
        canvasId: projectId,
        domainProjectId: linkedProjectId,
        nodesRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        screenToCanvas,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
    });

    const openProjectAssets = useCallback((initialCategory = "all", position?: Position) => {
        setProjectAssetInitialCategory(initialCategory);
        setProjectAssetInsertPosition(position);
        setProjectAssetOpen(true);
    }, []);
    const closeProjectAssets = useCallback(() => {
        setProjectAssetOpen(false);
        setProjectAssetInsertPosition(undefined);
    }, []);

    const {
        angleNodeId,
        emotionNodeId,
        annotationNodeId,
        createImageReversePromptNodes,
        generatePortraitTextureNode,
        cropImageNode,
        cropNodeId,
        extractVideoLastFrame,
        extractingVideoFrameNodeId,
        generateAngleNode,
        generateEmotionNode,
        maskEditImageNode,
        maskEditNodeId,
        mergeSelectedVideos,
        mergeVideosByIds,
        mergeVideoProgress,
        saveAnnotatedImageNode,
        setAngleNodeId,
        setEmotionNodeId,
        setAnnotationNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setSplitNodeId,
        setUpscaleNodeId,
        splitImageNode,
        splitNodeId,
        upscaleImageNode,
        upscaleNodeId,
    } = useCanvasMediaTools({
        projectId,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setContextMenu,
        setHoveredNodeId,
        setToolbarNodeId,
        setRunningNodeId,
        startUploadStatus,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
    });

    const handleNodesDeleted = useCallback((removedIds: Set<string>, nextNodes: CanvasNodeData[], removedNodes: CanvasNodeData[]) => {
        const clearDeletedId = (current: string | null) => current && removedIds.has(current) ? null : current;
        setHoveredNodeId(clearDeletedId);
        setToolbarNodeId(clearDeletedId);
        setDialogNodeId(clearDeletedId);
        setTextEditorNodeId(clearDeletedId);
        setCharacterReferenceNodeId(clearDeletedId);
        setDrawingNodeId(clearDeletedId);
        setInfoNodeId(clearDeletedId);
        setCropNodeId(clearDeletedId);
        setMaskEditNodeId(clearDeletedId);
        setAnnotationNodeId(clearDeletedId);
        setSplitNodeId(clearDeletedId);
        setUpscaleNodeId(clearDeletedId);
        setAngleNodeId(clearDeletedId);
        setEmotionNodeId(clearDeletedId);
        setSuperResolveNodeId(clearDeletedId);
        setPreviewNodeId(clearDeletedId);
        setRunningNodeId(clearDeletedId);
        setScriptEditorNodeId(clearDeletedId);
        setDirectorNodeId(clearDeletedId);
        setVersionCompareRootId(clearDeletedId);
        setScriptScrollTopById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))));
        setContextMenu((current) => current?.type === "node" && removedIds.has(current.nodeId) ? null : current);
        const removedDrawingIds = removedNodes.flatMap((node) => node.type === CanvasNodeType.Drawing && node.metadata?.drawingId ? [node.metadata.drawingId] : []);
        if (removedDrawingIds.length) {
            void Promise.all(removedDrawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId)))
                .catch(() => message.warning("绘图节点已删除，但本地绘图缓存清理失败"));
        }
        cleanupCanvasFiles({ projectId, nodes: nextNodes, chatSessions });
    }, [chatSessions, cleanupCanvasFiles, message, projectId, setAngleNodeId, setAnnotationNodeId, setCropNodeId, setEmotionNodeId, setMaskEditNodeId, setSplitNodeId, setUpscaleNodeId, setRunningNodeId]);

    const {
        alignSelectedNodes,
        arrangeSelectedNodes,
        copyNodesToClipboard,
        copySelectedNodes,
        createNode,
        createReferenceGroup,
        createStoryboardGroup,
        deleteConnection,
        deleteNodes,
        duplicateNode,
        hasCopiedNodes,
        pasteCopiedNodes,
        restoreCopiedNodesFromText,
        releaseCopiedNodesPastePriority,
        setPrimaryVersion,
        shouldPreferCopiedNodes,
        toggleNodeLocked,
    } = useCanvasNodeOperations({
        projectId,
        defaultDrawingEngine,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        onNodesDeleted: handleNodesDeleted,
    });

    const {
        cancelPendingConnectionCreate,
        closeConnectionCreateMenu,
        connectionTargetAnchorRatio,
        connectionTargetNodeId,
        connectingParams,
        createConnectedNode,
        handleConnectStart,
        mouseWorld,
        pendingConnectionCreate,
        setConnecting,
    } = useCanvasConnectionController({
        projectId,
        defaultDrawingEngine,
        nodesRef,
        connectionsRef,
        viewportRef,
        scriptScrollTopById,
        screenToCanvas,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        setDrawingNodeId,
    });

    const handleCanvasSelectionStart = useCallback(() => {
        setContextMenu(null);
        setDialogNodeId(null);
    }, []);

    const handleNodeInteractionStart = useCallback((selectionModifier: boolean) => {
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        if (selectionModifier) setDialogNodeId(null);
    }, []);

    const handleSelectedNodeClick = useCallback((node: CanvasNodeData) => {
        if (node.type === CanvasNodeType.Drawing) {
            setDialogNodeId(null);
            setDrawingNodeId(node.id);
        } else if (node.type === CanvasNodeType.Script) {
            setDialogNodeId(null);
        } else if (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Frame) {
            setDialogNodeId((current) => current === node.id ? current : null);
        } else {
            setDialogNodeId(node.id);
        }
    }, []);

    const handleCanvasDeselect = useCallback(() => {
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
    }, []);

    const {
        alignmentGuides,
        cancelSelectionBox,
        deselectCanvas,
        dragPreview,
        frameDropTargetId,
        handleCanvasMouseDown,
        handleNodeMouseDown,
        isNodeDragging,
        nodeDraggingRef,
        selectionBoundsElementRef,
        selectionBox,
    } = useCanvasSelectionController({
        containerRef,
        nodesRef,
        viewportRef,
        selectedNodeIdsRef,
        historyPausedRef,
        screenToCanvas,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        cancelPendingConnectionCreate,
        onCanvasSelectionStart: handleCanvasSelectionStart,
        onNodeInteractionStart: handleNodeInteractionStart,
        onNodeClick: handleSelectedNodeClick,
        onDeselect: handleCanvasDeselect,
        onSelectionBoxEnd: () => setCanvasTool((tool) => (tool === "box-select" ? "move" : tool)),
    });

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const {
        collapsingBatchIds,
        downloadNodeImage,
        handleConfigNodeChange,
        handleFontSizeChange,
        handleNodeContentChange,
        handleNodePromptChange,
        handleNodeResize,
        handleNodeTitleChange,
        openingBatchIds,
        saveNodeAsset,
        setBatchPrimary,
        toggleBatchExpanded,
        toggleFrameCollapsed,
        toggleNodeFreeResize,
    } = useCanvasNodeEditor({
        canvasId: projectId,
        domainProjectId: linkedProjectId,
        nodesRef,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setToolbarNodeId,
        setHoveredNodeId,
    });

    const {
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
        skillMentionReferences,
        splitNode,
        superResolveNode,
        toolbarNode,
        upscaleNode,
        versionCompareNodes,
        visibleNodes,
    } = useCanvasRenderModel({
        nodes,
        connections,
        assets,
        viewport,
        viewportSize: size,
        mediaPerformanceMode,
        selectedNodeIds,
        hoveredNodeId,
        dragPreview,
        collapsingBatchIds,
        addedSkills,
        directorScenes: currentProject?.directorScenes,
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
    });
    const dialogNode = dialogNodeId ? nodeById.get(dialogNodeId) || null : null;
    const textEditorNode = textEditorNodeId ? nodeById.get(textEditorNodeId) || null : null;
    const characterReferenceNode = characterReferenceNodeId ? nodeById.get(characterReferenceNodeId) || null : null;
    const drawingNode = drawingNodeId ? nodeById.get(drawingNodeId) || null : null;
    const pendingConnectionSourceNode = pendingConnectionCreate?.connection.handleType === "source" ? nodeById.get(pendingConnectionCreate.connection.nodeId) : null;
    const canCreateDrawingFromConnection = pendingConnectionSourceNode?.type === CanvasNodeType.Image && Boolean(pendingConnectionSourceNode.metadata?.content);

    const openTextNodeEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        if (node.metadata?.workflowKind === "character" && node.metadata.characterAssetId) {
            setCharacterReferenceNodeId(node.id);
            return;
        }
        setTextEditorNodeId(node.id);
    }, []);

    const openDrawingNode = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Drawing) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        setDrawingNodeId(node.id);
    }, []);
    const { agentSnapshot, agentUndoCount, applyAgentOps, canUndoAgentOps, dismissLastAgentChange, lastAgentChange, undoAgentOps, viewLastAgentChange } = useCanvasAgentOperations({
        projectId,
        domainProjectId: currentProject?.projectId,
        projectTitle: currentProject?.title || "未命名画布",
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
        focusSelection: fitCanvasSelection,
    });

    const { selectCanvasStyle } = useCanvasStyleWorkflow({
        nodesRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setStylePickerOpen,
    });

    const { applyDirectorOutput, createDirectorShot, openDirectorWorkbench, saveDirectorScene } = useCanvasDirector({
        projectId,
        directorNodeId,
        directorScenes: currentProject?.directorScenes || [],
        nodesRef,
        connectionsRef,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDirectorNodeId,
        updateProject,
    });

    const {
        activateStep: activateShortDramaStep,
        createPipeline: createShortDramaPipeline,
        guideCollapsed: shortDramaGuideCollapsed,
        openStoryInput,
        progress: shortDramaProgress,
        setGuideCollapsed: setShortDramaGuideCollapsed,
        skipGuide: skipShortDramaGuide,
    } = useCanvasShortDrama({
        nodes,
        connections,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setStylePickerOpen,
        fitCanvasSelection,
        focusCanvasNode,
        openTextEditor: openTextNodeEditor,
    });

    const shortDramaGuide = shortDramaEnabled && !currentProject?.projectId && shortDramaProgress.active
        ? { progress: shortDramaProgress, collapsed: shortDramaGuideCollapsed, onToggle: () => setShortDramaGuideCollapsed((value) => !value) }
        : undefined;

    const clearCanvas = useCallback(() => {
        const drawingIds = nodesRef.current.flatMap((node) => node.type === CanvasNodeType.Drawing && node.metadata?.drawingId ? [node.metadata.drawingId] : []);
        if (drawingIds.length) {
            void Promise.all(drawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId)))
                .catch(() => message.warning("画布已清空，但部分本地绘图缓存清理失败"));
        }
        setNodes([]);
        setConnections([]);
        setTextEditorNodeId(null);
        setDrawingNodeId(null);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAnnotationNodeId(null);
        setAngleNodeId(null);
        setEmotionNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        clearCanvasFiles();
    }, [clearCanvasFiles, deselectCanvas, message, nodesRef, projectId, setEmotionNodeId]);

    useCanvasKeyboard({
        nodesRef,
        selectedNodeIdsRef,
        selectedConnectionId,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setShortcutRequestNonce,
        setInfoNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setAnnotationNodeId,
        saveCanvasProject,
        zoomToActualSize,
        fitCanvasContent,
        fitCanvasSelection,
        undoCanvas,
        redoCanvas,
        cancelSelectionBox,
        copySelectedNodes,
        pasteCopiedNodes,
        restoreCopiedNodesFromText,
        shouldPreferCopiedNodes,
        pasteSystemClipboard,
        deleteNodes,
        deleteConnection,
        deselectCanvas,
        zoomCanvasIn,
        zoomCanvasOut,
        focusMode,
        exitFocusMode,
        toggleFocusMode,
    });

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        setChatSessions(sessions);
        setActiveChatId(activeId);
    }, []);

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameCurrentProject(nextTitle);
        setTitleEditing(false);
    }, [renameCurrentProject, titleDraft]);

    const pasteAtPosition = useCallback(
        (position: Position) => {
            if (shouldPreferCopiedNodes() && pasteCopiedNodes(position)) return;
            void (async () => {
                try {
                    // 标记写入成功时仍优先系统图片，兼容截图和从外部应用复制的媒体。
                    const handled = await pasteSystemClipboard(position);
                    if (!handled) pasteCopiedNodes(position);
                } catch {
                    if (!pasteCopiedNodes(position)) message.warning("无法读取剪贴板内容");
                }
            })();
        },
        [message, pasteCopiedNodes, pasteSystemClipboard, shouldPreferCopiedNodes],
    );

    const copyNodeContentToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
            releaseCopiedNodesPastePriority();
            const content = node?.metadata?.content;
            if (!node || !content) {
                message.warning("没有可复制的内容");
                return;
            }

            try {
                if (node.type === CanvasNodeType.Image && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
                    const response = await fetch(content);
                    const blob = await response.blob();
                    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
                    message.success("图片已复制");
                    return;
                }

                if (!navigator.clipboard?.writeText) {
                    message.warning("当前浏览器不支持写入剪贴板");
                    return;
                }
                await navigator.clipboard.writeText(content);
                message.success(node.type === CanvasNodeType.Text ? "文本已复制" : "内容链接已复制");
            } catch {
                message.error("复制失败，请检查浏览器剪贴板权限");
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const copyNodeMediaUrlToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
            releaseCopiedNodesPastePriority();
            try {
                const storageKey = node?.metadata?.storageKey;
                const content = node?.metadata?.content?.trim();
                const resourceId = resourceIdFromStorageKey(storageKey);
                const mediaPath = content && !content.startsWith("data:") && !content.startsWith("blob:") ? content : resourceId ? resourceFileUrl(resourceId) : "";
                const mediaURL = mediaPath ? new URL(mediaPath, window.location.href).toString() : "";
                if (!mediaURL) throw new Error("当前媒体只有本地内容，没有可复制的地址");
                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(mediaURL);
                else if (!await copyToClipboard(mediaURL)) throw new Error("当前浏览器不支持写入剪贴板");
                message.success(node?.type === CanvasNodeType.Video ? "视频地址已复制" : "图片地址已复制");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "媒体地址复制失败");
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const handleCanvasContextMenu = useCallback(
        (event: ReactMouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-node-id],[data-connection-id]")) return;

            event.preventDefault();
            event.stopPropagation();
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown")) {
                setContextMenu(null);
                return;
            }

            closeConnectionCreateMenu();
            setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY) });
        },
        [closeConnectionCreateMenu, screenToCanvas],
    );

    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, id: string) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        closeConnectionCreateMenu();
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
    }, [closeConnectionCreateMenu]);

    const handleGenerateNode = useCanvasGenerationExecutor({
        projectId,
        domainProjectId: currentProject?.projectId,
        addedSkills,
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setRunningNodeId,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
    });
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const {
        cancelSubmittedBatchItem,
        enqueueGenerationBatch,
        retryFailedBatchItems,
        stopRemainingBatchItems,
    } = useCanvasGenerationBatches({
        projectId,
        projectLoaded,
        nodes,
        nodesRef,
        setNodes,
        handleGenerateNode,
    });

    const {
        addScriptRow,
        createAndGenerateScriptVideos,
        createScriptActionBoards,
        createScriptImageNodes,
        createScriptVideoNodes,
        generateScriptImages,
        generateScriptRows,
        generateScriptVideos,
        removeScriptRow,
        replaceScriptRows,
        updateScriptRow,
    } = useCanvasStoryboard({
        projectId,
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        enqueueGenerationBatch,
    });

    const handleRetryNode = useCanvasGenerationRetry({
        projectId,
        domainProjectId: currentProject?.projectId,
        addedSkills,
        nodesRef,
        connectionsRef,
        setNodes,
        setRunningNodeId,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
    });

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Image);
            const imageNode = createCanvasNode(
                CanvasNodeType.Image,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: `@[node:${sourceNode.id}]`,
                    composerContent: `@[node:${sourceNode.id}]`,
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    quality: effectiveConfig.quality,
                    transparentBackground: effectiveConfig.transparentBackground,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            imageNode.title = "图片生成";
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: imageNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, richText: undefined, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(imageNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([imageNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(imageNode.id);
        },
        [effectiveConfig, message],
    );

    const renderCanvasNodePanel = useCallback(
        (panelNode: CanvasNodeData) => {
            if (panelNode.type === CanvasNodeType.Script || panelNode.type === CanvasNodeType.Drawing) return null;
            return panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    skillReferences={skillMentionReferences}
                    generationMode={panelNode.metadata?.generationMode}
                    metadata={panelNode.metadata}
                    workspaceMode={workspaceMode}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onMetadataChange={(patch) => handleConfigNodeChange(panelNode.id, patch)}
                    onClose={() => setDialogNodeId(null)}
                />
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    isRunning={runningNodeId === panelNode.id}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_RESOURCE_REFERENCES}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    workspaceMode={workspaceMode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            );
        },
        [configInputsById, confirmStopGeneration, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, runningNodeId, skillMentionReferences, workspaceMode],
    );

    const renderCanvasNodeContent = useCallback((contentNode: CanvasNodeData) => {
        if (contentNode.metadata?.workflowKind === "character" && contentNode.metadata.characterAssetId) {
            return <CanvasCharacterReferenceNodeContent node={contentNode} />;
        }
        if (contentNode.metadata?.workflowKind === "styleboard" && !contentNode.metadata.content) {
            return <CanvasStylePlaceholderNodeContent onChoose={() => setStylePickerOpen(true)} />;
        }
        if (contentNode.metadata?.workflowKind === "story_input") {
            return <CanvasStoryInputNodeContent node={contentNode} onEdit={() => openStoryInput(contentNode.id)} />;
        }
        if (contentNode.type === CanvasNodeType.Script) {
            const pipeline = deriveStoryboardPipelineProgress(contentNode, nodesRef.current, connectionsRef.current);
            const rowIds = pipeline.rows.map((item) => item.row.id);
            return (
                <CanvasScriptNodeContent
                    node={contentNode}
                    batch={visibleGenerationBatch(contentNode)}
                    pipeline={pipeline}
                    scale={viewport.k}
                    mentionReferences={mentionReferencesByNodeId.get(contentNode.id) || EMPTY_RESOURCE_REFERENCES}
                    onOpen={() => setScriptEditorNodeId(contentNode.id)}
                    onCreateImageNodes={() => createScriptImageNodes(contentNode.id)}
                    onCreateVideoNodes={() => createScriptVideoNodes(contentNode.id)}
                    onGenerateImages={() => void generateScriptImages(contentNode.id, rowIds)}
                    onGenerateVideos={() => contentNode.metadata?.storyboardVideoInputMode === "keyframe" ? void generateScriptVideos(contentNode.id, rowIds) : void createAndGenerateScriptVideos(contentNode.id, rowIds)}
                    onVideoInputModeChange={(storyboardVideoInputMode) => handleConfigNodeChange(contentNode.id, { storyboardVideoInputMode })}
                    onMergeVideos={() => void mergeVideosByIds(pipeline.successfulVideoNodeIds)}
                    onCreateActionBoards={() => void createScriptActionBoards(contentNode.id)}
                    onRetryBatch={(batchId) => retryFailedBatchItems(contentNode.id, batchId)}
                    onRetryBatchItem={(batchId, itemId) => retryFailedBatchItems(contentNode.id, batchId, itemId)}
                    onStopBatch={(batchId) => stopRemainingBatchItems(contentNode.id, batchId)}
                    onCancelBatchItem={(batchId, itemId) => cancelSubmittedBatchItem(contentNode.id, batchId, itemId)}
                    onAddRow={() => addScriptRow(contentNode.id)}
                    onRemoveRow={(rowId) => removeScriptRow(contentNode.id, rowId)}
                    onUpdateRow={(rowId, patch) => updateScriptRow(contentNode.id, rowId, patch)}
                    onPromptChange={(composerContent) => handleConfigNodeChange(contentNode.id, { composerContent })}
                    onGenerateScript={(prompt) => void generateScriptRows(contentNode.id, prompt)}
                    onModelChange={(model) => handleConfigNodeChange(contentNode.id, { model })}
                    onShotDurationChange={(duration: StoryboardShotDuration) => handleConfigNodeChange(contentNode.id, { storyboardShotDuration: duration })}
                    onShotCountChange={(count: StoryboardShotCount) => handleConfigNodeChange(contentNode.id, { storyboardShotCount: count })}
                    workspaceMode={workspaceMode}
                    onComposerHeightChange={(height) => {
                        if (contentNode.metadata?.storyboardComposerHeight === height) return;
                        handleConfigNodeChange(contentNode.id, { storyboardComposerHeight: height });
                        const minHeight = storyboardMinNodeHeight(height);
                        if (contentNode.height < minHeight) handleNodeResize(contentNode.id, contentNode.width, minHeight);
                    }}
                    onConnectStart={(event, rowId, handleType) => handleConnectStart(event, contentNode.id, handleType, rowId === "context" ? "storyboard:context" : `row:${rowId}`)}
                    onScrollTopChange={(scrollTop) => setScriptScrollTopById((current) => current[contentNode.id] === scrollTop ? current : { ...current, [contentNode.id]: scrollTop })}
                />
            );
        }
        if (contentNode.metadata?.directorSceneId) {
            return (
                <CanvasDirectorNodePanel
                    node={contentNode}
                    scene={currentProject?.directorScenes?.find((scene) => scene.id === contentNode.metadata?.directorSceneId) || null}
                    previewUrl={nodesRef.current.find((item) => item.id === contentNode.metadata?.directorPreviewNodeId)?.metadata?.content}
                    professional={workspaceMode === "professional"}
                    onOpen={() => openDirectorWorkbench(contentNode.id)}
                />
            );
        }
        return (
            <CanvasConfigNodePanel
                node={contentNode}
                isRunning={runningNodeId === contentNode.id}
                inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                onConfigChange={handleConfigNodeChange}
                onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                onStop={confirmStopGeneration}
                onGenerate={(nodeId) => {
                    const target = nodesRef.current.find((item) => item.id === nodeId);
                    void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                }}
                workspaceMode={workspaceMode}
            />
        );
    }, [addScriptRow, cancelSubmittedBatchItem, configInputsById, confirmStopGeneration, createAndGenerateScriptVideos, createScriptActionBoards, createScriptImageNodes, createScriptVideoNodes, currentProject?.directorScenes, generateScriptImages, generateScriptRows, generateScriptVideos, handleConfigNodeChange, handleConnectStart, handleGenerateNode, handleNodeResize, mentionReferencesByNodeId, mergeVideosByIds, openDirectorWorkbench, openStoryInput, removeScriptRow, retryFailedBatchItems, runningNodeId, stopRemainingBatchItems, updateScriptRow, viewport.k, workspaceMode]);

    const handleCanvasNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
        keepNodeToolbar(nodeId);
    }, [keepNodeToolbar]);
    const handleCanvasNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
        hideNodeToolbar();
    }, [hideNodeToolbar]);
    const retryCanvasNode = useCallback((node: CanvasNodeData) => {
        if (node.type === CanvasNodeType.Script) {
            const prompt = (node.metadata?.composerContent || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("分镜脚本缺少剧情内容，无法重试");
                return;
            }
            void generateScriptRows(node.id, prompt);
            return;
        }
        void handleRetryNode(node);
    }, [generateScriptRows, handleRetryNode, message]);
    const openCanvasNodeTaskDetails = useCallback((node: CanvasNodeData) => { void openNodeTaskDetails(node); }, [openNodeTaskDetails]);
    const openCanvasNodeVersions = useCallback((node: CanvasNodeData) => setVersionCompareRootId(node.metadata?.versionOfNodeId || node.id), []);
    const viewCanvasNodeImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const editCanvasDirector = useCallback((node: CanvasNodeData) => openDirectorWorkbench(node.id), [openDirectorWorkbench]);
    const locateProjectStyleNode = useCallback(() => {
        const styleNode = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
        if (!styleNode) {
            message.info("项目画风节点正在同步，请稍后再试");
            return;
        }
        focusCanvasNode(styleNode.id);
    }, [focusCanvasNode, message, nodesRef]);
    const emptyCanvasState = nodes.length ? null : !shortDramaEnabled ? (
        <CanvasFreeformEmptyState onUpload={() => handleUploadRequest()} onAddText={() => createNode(CanvasNodeType.Text)} />
    ) : currentProject?.projectId ? (
        <CanvasLinkedProjectEmptyState
            projectName={linkedProjectQuery.data?.project.name || currentProject.title}
            hasChapter={Boolean(linkedProjectQuery.data?.units.length)}
            onAddFirstChapter={() => {
                const first = linkedProjectQuery.data?.units.slice().sort((left, right) => left.position - right.position)[0];
                if (first) void handleProjectChapterInsert({ id: first.id, projectId: currentProject.projectId!, title: first.title, position: first.position });
            }}
            onOpenAssets={() => openProjectAssets()}
            onAddText={() => createNode(CanvasNodeType.Text)}
        />
    ) : (
        <CanvasShortDramaEmptyState
            onCreatePipeline={createShortDramaPipeline}
            onOpenAgent={() => { setCinematicAgentEntry(true); setAgentMode("online"); openAgent("online"); }}
            onUpload={() => handleUploadRequest()}
            onAddText={() => createNode(CanvasNodeType.Text)}
            onAddScript={() => createNode(CanvasNodeType.Script)}
        />
    );
    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <>
        <a href="#canvas-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-md focus:border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg">跳转到画布主内容</a>
        <main id="canvas-main" tabIndex={-1} className="flex h-full min-h-0 overflow-hidden outline-none" style={{ background: theme.canvas.background, color: theme.node.text }}>
            {!focusMode && shortDramaEnabled && currentProject?.projectId ? <CanvasProjectSidebar projectId={currentProject.projectId} detail={linkedProjectQuery.data} onAddChapter={handleProjectChapterInsert} onLocateStyle={locateProjectStyleNode} onOpenAssets={() => openProjectAssets()} /> : null}
            <section
                className="relative min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden"
            >
                {!focusMode ? (
                    <CanvasTopBar
                        title={currentProject?.title || "未命名画布"}
                        workspaceMode={workspaceMode}
                        onWorkspaceModeChange={setWorkspaceMode}
                        titleDraft={titleDraft}
                        isTitleEditing={titleEditing}
                        onTitleDraftChange={setTitleDraft}
                        onStartTitleEditing={startTitleEditing}
                        onFinishTitleEditing={finishTitleEditing}
                        onCancelTitleEditing={() => setTitleEditing(false)}
                        canUndo={historyState.canUndo}
                        canRedo={historyState.canRedo}
                        onCreateProject={createAndOpenProject}
                        onDeleteProject={deleteCurrentProject}
                        onImportImage={() => handleUploadRequest()}
                        onUndo={undoCanvas}
                        onRedo={redoCanvas}
                        onShare={() => setShareModalOpen(true)}
                        agentOpen={assistantOpen}
                        compactAgentStatus={codexCompactAgent ? { connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity } : undefined}
                        onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                        shortcutRequestNonce={shortcutRequestNonce}
                        mediaPerformanceMode={mediaPerformanceMode}
                        onMediaPerformanceModeChange={setMediaPerformanceMode}
                        onOpenSearch={() => setNodeSearchOpen(true)}
                        projectContext={shortDramaEnabled && currentProject?.projectId ? {
                            ...canvasContext,
                            projectId: currentProject.projectId,
                            projectName: linkedProjectQuery.data?.project.name || currentProject.title,
                        } : undefined}
                        onEnterFocusMode={enterFocusMode}
                        shortDramaGuide={shortDramaGuide}
                    />
                ) : null}

                <CanvasNodeSearchModal
                    open={nodeSearchOpen}
                    nodes={nodes}
                    onClose={() => setNodeSearchOpen(false)}
                    onFocus={(nodeId) => {
                        const target = nodeById.get(nodeId);
                        const parent = target?.parentId ? nodeById.get(target.parentId) : null;
                        if (parent?.metadata?.frame?.collapsed) toggleFrameCollapsed(parent.id);
                        const batchRoot = target?.metadata?.batchRootId ? nodeById.get(target.metadata.batchRootId) : null;
                        if (batchRoot && !batchRoot.metadata?.imageBatchExpanded) toggleBatchExpanded(batchRoot.id);
                        const selection = new Set([nodeId]);
                        selectedNodeIdsRef.current = selection;
                        setSelectedNodeIds(selection);
                        setSelectedConnectionId(null);
                        focusCanvasNode(nodeId);
                    }}
                />

                {!focusMode && shortDramaGuide ? <CanvasShortDramaGuide progress={shortDramaGuide.progress} collapsed={shortDramaGuide.collapsed} onToggle={shortDramaGuide.onToggle} onSkip={skipShortDramaGuide} onStepClick={activateShortDramaStep} /> : null}

                <CanvasShareModal projectId={projectId} open={shareModalOpen} onClose={() => setShareModalOpen(false)} beforeCreate={saveCanvasProject} />

                <CanvasStylePickerModal open={stylePickerOpen} value={activeStylePresetId} onClose={() => setStylePickerOpen(false)} onSelect={selectCanvasStyle} />

                <div className="relative flex min-h-0 min-w-0 flex-1">
                <div className="relative min-w-0 flex-1 overflow-hidden">
                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    graphicsLayer={(
                        <CanvasLeaferGraphicsLayer
                            containerRef={containerRef}
                            viewport={viewport}
                            theme={theme}
                            displayConnections={displayConnections}
                            selectedConnectionId={selectedConnectionId}
                            relatedConnectionIds={relatedHighlight.connectionIds}
                            scriptScrollTopById={scriptScrollTopById}
                            connectingParams={connectingParams}
                            mouseWorld={mouseWorld}
                            connectionTargetNodeId={connectionTargetNodeId}
                            connectionTargetAnchorRatio={connectionTargetAnchorRatio}
                            nodeById={nodeById}
                            selectionBox={selectionBox}
                            selectedNodeBounds={selectedNodeBounds}
                            alignmentGuides={alignmentGuides}
                        />
                    )}
                    onViewportChange={handleViewportChange}
                    onViewportPreviewChange={handleViewportPreviewChange}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    boxSelectEnabled={canvasTool === "box-select"}
                    onCanvasDoubleClick={handleCanvasDoubleClick}
                    onCanvasDeselect={deselectCanvas}
                    onContextMenu={handleCanvasContextMenu}
                    onDrop={handleDrop}
                    onFileDragEnter={handleFileDragEnter}
                    onFileDragLeave={handleFileDragLeave}
                    onFileDragOver={handleFileDragOver}
                >
                    <CanvasProjectWorldLayers
                        projectId={projectId}
                        viewportScale={viewport.k}
                        connectionLayerBounds={connectionLayerBounds}
                        displayConnections={displayConnections}
                        selectedConnectionId={selectedConnectionId}
                        relatedConnectionIds={relatedHighlight.connectionIds}
                        scriptScrollTopById={scriptScrollTopById}
                        connectingParams={connectingParams}
                        mouseWorld={mouseWorld}
                        connectionTargetNodeId={connectionTargetNodeId}
                        nodeById={nodeById}
                        visibleNodes={visibleNodes}
                        frameChildrenById={frameChildrenById}
                        dragPreview={dragPreview}
                        selectedNodeIds={selectedNodeIds}
                        frameDropTargetId={frameDropTargetId}
                        relatedNodeIds={relatedHighlight.nodeIds}
                        activeNodeId={activeNodeId}
                        selectionBox={selectionBox}
                        batchChildCountById={batchChildCountById}
                        collapsingBatchIds={collapsingBatchIds}
                        openingBatchIds={openingBatchIds}
                        batchMotionById={batchMotionById}
                        showImageInfo={showImageInfo}
                        reduceMediaEffects={reduceMediaEffects}
                        resourceReferenceByNodeId={resourceReferenceByNodeId}
                        mentionReferencesByNodeId={mentionReferencesByNodeId}
                        mediaEffectsDisabledNodeId={emotionNodeId}
                        selectedNodeBounds={selectedNodeBounds}
                        isNodeDragging={isNodeDragging}
                        selectionBoundsElementRef={selectionBoundsElementRef}
                        renderCanvasNodeContent={renderCanvasNodeContent}
                        onConnectionSelect={(connectionId) => { setSelectedConnectionId(connectionId); setSelectedNodeIds(new Set()); setContextMenu(null); }}
                        onConnectionContextMenu={(event, connectionId) => { setSelectedConnectionId(connectionId); setSelectedNodeIds(new Set()); closeConnectionCreateMenu(); setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId }); }}
                        onNodeMouseDown={handleNodeMouseDown}
                        onNodeHoverStart={handleCanvasNodeHoverStart}
                        onNodeHoverEnd={handleCanvasNodeHoverEnd}
                        onConnectStart={handleConnectStart}
                        onNodeResize={handleNodeResize}
                        onToggleFrame={toggleFrameCollapsed}
                        onNodeTitleChange={handleNodeTitleChange}
                        onNodeContextMenu={handleNodeContextMenu}
                        onNodeContentChange={handleNodeContentChange}
                        onToggleBatch={toggleBatchExpanded}
                        onSetBatchPrimary={setBatchPrimary}
                        onRetry={retryCanvasNode}
                        onCancelTask={cancelNodeTask}
                        onOpenTaskDetails={openCanvasNodeTaskDetails}
                        onOpenVersions={openCanvasNodeVersions}
                        onViewImage={viewCanvasNodeImage}
                        onReplaceMedia={(node) => handleUploadRequest(node.id)}
                        onOpenTextEditor={openTextNodeEditor}
                        onOpenDirector={editCanvasDirector}
                        onOpenDrawing={openDrawingNode}
                    />
                </InfiniteCanvas>

                <CanvasActiveTaskPanel tasks={activeTasks} />

                {focusMode ? (
                    <CanvasFocusModeBar
                        dockRevealed={focusDockRevealed}
                        agentOpen={assistantOpen}
                        zoomPercent={viewport.k}
                        onToggleDock={() => setFocusDockRevealed((value) => !value)}
                        onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                        onExit={exitFocusMode}
                        onZoomIn={zoomCanvasIn}
                        onZoomOut={zoomCanvasOut}
                        onFit={resetViewport}
                    />
                ) : null}

                <CanvasFileDropOverlay active={fileDropActive} theme={theme} />

                {emptyCanvasState}

                {!focusMode || focusDockRevealed ? (
                    <CanvasToolbar
                        selectedCount={selectedNodeIds.size}
                        workspaceMode={workspaceMode}
                        canvasTool={canvasTool}
                        onToolChange={setCanvasTool}
                        isProjectLinked={Boolean(shortDramaEnabled && currentProject?.projectId)}
                        canUndo={historyState.canUndo}
                        canRedo={historyState.canRedo}
                        backgroundMode={backgroundMode}
                        showImageInfo={showImageInfo}
                        onAddImage={() => createNode(CanvasNodeType.Image)}
                        onAddVideo={() => createNode(CanvasNodeType.Video)}
                        onAddAudio={() => createNode(CanvasNodeType.Audio)}
                        onAddText={() => createNode(CanvasNodeType.Text)}
                        onChooseStyle={() => setStylePickerOpen(true)}
                        onAddScript={() => createNode(CanvasNodeType.Script)}
                        onAddFrame={() => createNode(CanvasNodeType.Frame)}
                        onAddDrawing={() => createNode(CanvasNodeType.Drawing)}
                        onOpenDirector={() => createDirectorShot()}
                        onUndo={undoCanvas}
                        onRedo={redoCanvas}
                        onUpload={() => handleUploadRequest()}
                        onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                        onClear={() => setClearConfirmOpen(true)}
                        onDeselect={deselectCanvas}
                        onBackgroundModeChange={setBackgroundMode}
                        onShowImageInfoChange={setShowImageInfo}
                        onOpenMyAssets={() => {
                            openAssetsAtPosition();
                        }}
                        onOpenProjectCharacters={() => openProjectAssets("character")}
                    />
                ) : null}
                </div>

                {assistantMounted ? (
                    <AssistantPanelColumn
                        width={assistantWidth}
                        closing={assistantClosing}
                        topInset={focusMode ? "0px" : "var(--canvas-topbar-offset)"}
                        onWidthChange={setAssistantWidth}
                    >
                        {(resizing) => (
                            <CanvasAssistantPanel
                                nodes={nodes}
                                selectedNodeIds={selectedNodeIds}
                                snapshot={agentSnapshot}
                                projectId={projectId}
                                sessions={chatSessions}
                                activeSessionId={activeChatId}
                                onSelectNodeIds={setSelectedNodeIds}
                                onSessionsChange={handleAssistantSessionsChange}
                                onApplyOps={applyAgentOps}
                                canUndoOps={canUndoAgentOps}
                                undoOpsCount={agentUndoCount}
                                onUndoOps={undoAgentOps}
                                onPasteImage={pasteAssistantImage}
                                agentMode={agentMode}
                                onAgentModeChange={setAgentMode}
                                autoConnectLocal={codexAutoConnect}
                                closing={assistantClosing}
                                onCollapse={closeAgent}
                                cinematicEntry={cinematicAgentEntry}
                                onCinematicEntryConsumed={() => setCinematicAgentEntry(false)}
                                resizing={resizing}
                            />
                        )}
                    </AssistantPanelColumn>
                ) : null}
                </div>

                {angleNode?.metadata?.content ? (
                    <CanvasNodePanelOverlay node={angleNode} viewport={viewport} containerRef={containerRef} panelWidth={580} panelHeight={350}>
                        <CanvasNodeAnglePanel dataUrl={angleNode.metadata.content} onClose={() => setAngleNodeId(null)} onConfirm={(params) => { void generateAngleNode(angleNode, params); }} />
                    </CanvasNodePanelOverlay>
                ) : null}

                {emotionNode?.metadata?.content ? (
                    <CanvasEmotionWorkspace
                        node={emotionNode}
                        viewport={viewport}
                        containerRef={containerRef}
                        onClose={() => setEmotionNodeId(null)}
                        onConfirm={(payload: CanvasImageEmotionPayload) => { void generateEmotionNode(emotionNode, payload); }}
                    />
                ) : null}

                {dialogNode && dialogNode.type !== CanvasNodeType.Script && dialogNode.type !== CanvasNodeType.Drawing && !selectionBox ? (
                    <CanvasNodePanelOverlay node={dialogNode} viewport={viewport} containerRef={containerRef}>
                        {renderCanvasNodePanel(dialogNode)}
                    </CanvasNodePanelOverlay>
                ) : null}

                {pendingConnectionCreate ? <CanvasConnectionCreateMenu pending={pendingConnectionCreate} viewport={viewport} viewportSize={size} containerRef={containerRef} canCreateDrawing={canCreateDrawingFromConnection} onCreate={(type) => void createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}

                {selectedNodeBounds && !selectionBox && !isNodeDragging ? <CanvasProjectSelectionToolbar anchorRef={selectionBoundsElementRef} containerRef={containerRef} count={selectedNodeBounds.count} selectedVideoCount={selectedVideoNodes.length} mergingVideos={Boolean(mergeVideoProgress)} onAlign={alignSelectedNodes} onArrange={arrangeSelectedNodes} onCreateStoryboard={createStoryboardGroup} onCreateReferenceGroup={createReferenceGroup} onMergeVideos={() => void mergeSelectedVideos()} /> : null}

                {uploadStatus ? <CanvasUploadStatusToast status={uploadStatus} theme={theme} /> : null}
                {mergeVideoProgress ? <CanvasMergeStatusToast progress={mergeVideoProgress} theme={theme} /> : null}
                {lastAgentChange ? <CanvasAgentChangeToast change={lastAgentChange} theme={theme} onView={viewLastAgentChange} onUndo={() => { undoAgentOps(); }} onClose={dismissLastAgentChange} /> : null}

                <CanvasNodeToolbar
                    node={isNodeDragging || nodeImageSettingsOpen || emotionNodeId ? null : toolbarNode}
                    workspaceMode={workspaceMode}
                    viewport={viewport}
                    containerRef={containerRef}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => node.metadata?.workflowKind === "character" && node.metadata.characterAssetId ? openTextNodeEditor(node) : setInfoNodeId(node.id)}
                    onEditText={openTextNodeEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onAnnotate={(node) => setAnnotationNodeId(node.id)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onEmotion={(node) => { setDialogNodeId(null); setEmotionNodeId((current) => current === node.id ? null : node.id); }}
                    onPortraitTexture={generatePortraitTextureNode}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => { setDialogNodeId(null); setAngleNodeId((current) => current === node.id ? null : node.id); }}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onExtractVideoLastFrame={(node) => void extractVideoLastFrame(node)}
                    extractingVideoFrame={toolbarNode?.id === extractingVideoFrameNodeId}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onToggleLocked={(node) => toggleNodeLocked(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                {isMiniMapOpen && !focusMode ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} canvasContainerRef={containerRef} onViewportPreviewChange={previewViewport} onViewportChange={handleViewportChange} /> : null}

                {!focusMode ? (
                    <div data-canvas-no-zoom className="absolute bottom-[calc(var(--canvas-inset-y)+var(--space-16))] left-4 z-[var(--z-panel)] flex items-end gap-2 lg:bottom-[var(--canvas-inset-y)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                        <CanvasZoomControls scale={viewport.k} containerRef={containerRef} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} onOpenShortcuts={() => setShortcutRequestNonce((value) => value + 1)} />
                        <CanvasAssetTray assetImages={imageAssets} canvasImages={canvasImageNodes} showLibrary={!currentProject?.projectId} activeNodeId={selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null} onInsertAssetImage={(asset) => void createImageAssetNode(asset)} onFocusCanvasImage={focusCanvasImageNode} />
                    </div>
                ) : null}

                <CanvasProjectContextMenu
                    menu={contextMenu}
                    node={contextMenuNode}
                    workspaceMode={workspaceMode}
                    isProjectLinked={Boolean(currentProject?.projectId)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    canPaste={hasCopiedNodes || Boolean(navigator.clipboard)}
                    screenToCanvas={screenToCanvas}
                    onClose={() => setContextMenu(null)}
                    onAddNode={(type, position) => createNode(type, position)}
                    onChooseStyle={() => setStylePickerOpen(true)}
                    onOpenDirector={createDirectorShot}
                    onUpload={(nodeId, position) => handleUploadRequest(nodeId, position)}
                    onOpenAssets={openAssetsAtPosition}
                    onOpenProjectCharacters={(position) => openProjectAssets("character", position)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onPaste={pasteAtPosition}
                    onCopyNode={(nodeId) => copyNodesToClipboard(new Set([nodeId]))}
                    onDuplicate={duplicateNode}
                    onDeleteNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                    onDeleteConnection={deleteConnection}
                    onSaveAsset={(node) => { void saveNodeAsset(node); }}
                    onViewMedia={(node) => setPreviewNodeId(node.id)}
                    onEditText={openTextNodeEditor}
                    onOpenDrawing={openDrawingNode}
                    onGenerateImage={generateImageFromTextNode}
                    onCopyContent={(node) => { void copyNodeContentToClipboard(node); }}
                    onCopyMediaUrl={(node) => { void copyNodeMediaUrlToClipboard(node); }}
                    onSetAssetCategory={(nodeId, assetCategory) => handleConfigNodeChange(nodeId, { assetCategory })}
                    onToggleFrame={(node) => toggleFrameCollapsed(node.id)}
                />

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} onMetadataChange={handleConfigNodeChange} />

                <CanvasCharacterReferenceModal
                    node={characterReferenceNode}
                    open={Boolean(characterReferenceNode)}
                    onClose={() => setCharacterReferenceNodeId(null)}
                />

                <CanvasTextEditorModal
                    node={textEditorNode}
                    open={Boolean(textEditorNode)}
                    onClose={() => setTextEditorNodeId(null)}
                    onSave={(nodeId, title, content, richText) => {
                        setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, title, metadata: { ...node.metadata, content, richText } } : node));
                    }}
                />

                {drawingNode ? <Suspense fallback={<div className="fixed inset-0 z-[var(--z-toast)] grid place-items-center px-5" style={{ background: theme.canvas.background, color: theme.node.text }}><WorkspaceState icon="loading" title="正在加载绘图编辑器" description="正在准备绘图画布。" /></div>}>
                    <CanvasDrawingEditorModal
                        node={drawingNode}
                        projectId={projectId}
                        open={Boolean(drawingNode)}
                        onClose={() => setDrawingNodeId(null)}
                        onSaved={(nodeId, summary) => {
                            setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, drawingEngine: summary.engine, drawingRevision: summary.revision, drawingUpdatedAt: summary.updatedAt, drawingShapeCount: summary.shapeCount, drawingPageCount: summary.pageCount } } : node));
                            message.success("绘图已保存");
                        }}
                    />
                </Suspense> : null}

                <CanvasScriptEditor
                    node={activeScriptNode}
                    open={Boolean(activeScriptNode)}
                    onClose={() => setScriptEditorNodeId(null)}
                    onUpdateRows={(rows) => activeScriptNode && replaceScriptRows(activeScriptNode.id, rows)}
                    onVisibleColumnsChange={(visibleColumns: StoryboardColumn[]) => {
                        if (!activeScriptNode || !visibleColumns.length) return;
                        setNodes((prev) => prev.map((node) => node.id === activeScriptNode.id ? { ...node, metadata: { ...node.metadata, storyboard: { rows: node.metadata?.storyboard?.rows || [], visibleColumns, referenceNodeIds: node.metadata?.storyboard?.referenceNodeIds || [] } } } : node));
                    }}
                    onGenerateImages={(rowIds) => activeScriptNode && void generateScriptImages(activeScriptNode.id, rowIds)}
                    onGenerateVideos={(rowIds) => {
                        if (!activeScriptNode) return;
                        if (activeScriptNode.metadata?.storyboardVideoInputMode === "keyframe") void generateScriptVideos(activeScriptNode.id, rowIds);
                        else void createAndGenerateScriptVideos(activeScriptNode.id, rowIds);
                    }}
                    onVideoInputModeChange={(storyboardVideoInputMode) => activeScriptNode && handleConfigNodeChange(activeScriptNode.id, { storyboardVideoInputMode })}
                />

                {directorNodeId && activeDirectorScene ? (
                    <Suspense fallback={<div className="fixed inset-0 z-[var(--z-toast)] grid place-items-center px-5" style={{ background: theme.canvas.background, color: theme.node.text }}><WorkspaceState icon="loading" title="正在加载 3D 导演台" description="准备场景、镜头与空间控制。" /></div>}>
                        <CanvasDirectorWorkbench
                            open
                            scene={activeDirectorScene}
                            imageNodes={nodes.filter((node) => node.type === CanvasNodeType.Image && Boolean(node.metadata?.content))}
                            onClose={() => setDirectorNodeId(null)}
                            onChange={saveDirectorScene}
                            onApply={applyDirectorOutput}
                        />
                    </Suspense>
                ) : null}

                <CanvasVersionCompareModal open={Boolean(versionCompareRootId)} versions={versionCompareNodes} onClose={() => setVersionCompareRootId(null)} onSetPrimary={setPrimaryVersion} onFocus={(nodeId) => { setVersionCompareRootId(null); focusCanvasNode(nodeId); }} />

                <CanvasProjectMediaDialogs
                    cropNode={cropNode}
                    annotationNode={annotationNode}
                    maskEditNode={maskEditNode}
                    splitNode={splitNode}
                    upscaleNode={upscaleNode}
                    onCloseCrop={() => setCropNodeId(null)}
                    onCloseAnnotation={() => setAnnotationNodeId(null)}
                    onCloseMaskEdit={() => setMaskEditNodeId(null)}
                    onCloseSplit={() => setSplitNodeId(null)}
                    onCloseUpscale={() => setUpscaleNodeId(null)}
                    onCrop={(node, crop) => void cropImageNode(node, crop)}
                    onAnnotate={(node, dataUrl) => void saveAnnotatedImageNode(node, dataUrl)}
                    onMaskEdit={(node, payload) => void maskEditImageNode(node, payload)}
                    onSplit={(node, params) => void splitImageNode(node, params)}
                    onUpscale={(node, params) => void upscaleImageNode(node, params)}
                />

                <CanvasProjectStatusDialogs
                    theme={theme}
                    task={taskDetail}
                    taskLogs={taskDetailLogs}
                    taskLoading={taskDetailLoading}
                    onCloseTask={() => setTaskDetail(null)}
                    superResolveNode={superResolveNode}
                    onCloseSuperResolve={() => setSuperResolveNodeId(null)}
                    previewNode={previewNode}
                    onClosePreview={() => setPreviewNodeId(null)}
                    clearConfirmOpen={clearConfirmOpen}
                    onCancelClear={() => setClearConfirmOpen(false)}
                    onConfirmClear={clearCanvas}
                />

                <AssetPickerModal
                    open={assetPickerOpen}
                    onInsert={handleAssetInsert}
                    onClose={closeAssetPicker}
                />
                <CanvasProjectAssetModal open={projectAssetOpen} detail={linkedProjectQuery.data} initialCategory={projectAssetInitialCategory} onClose={closeProjectAssets} onInsert={(payloads) => handleProjectAssetsInsert(payloads, projectAssetInsertPosition)} />
                {codexCompactAgent && !assistantMounted ? <CanvasLocalAgentPanel headless snapshot={agentSnapshot} canUndoOps={canUndoAgentOps} undoOpsCount={agentUndoCount} onApplyOps={applyAgentOps} onUndoOps={undoAgentOps} autoConnect={codexAutoConnect} /> : null}
            </section>
        </main>
        </>
    );
}
