import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useParams, useSearchParams } from "react-router";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { uploadMediaFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { persistCanvasMediaPerformanceMode, readCanvasMediaPerformanceMode } from "@/lib/canvas/canvas-performance-mode";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { App } from "antd";
import { getNodeSpec } from "@/constant/canvas";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasAssistantPanel } from "@/components/canvas/canvas-assistant-panel";
import { CanvasActiveTaskPanel } from "@/components/canvas/canvas-active-task-panel";
import { CanvasAssetTray } from "@/components/canvas/canvas-asset-tray";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasNodeSearchModal } from "@/components/canvas/canvas-node-search-modal";
import { CanvasDocumentEditorModal } from "@/components/canvas/canvas-document-editor-modal";
import { CanvasStylePickerModal } from "@/components/canvas/canvas-style-picker-modal";
import { CanvasFileDropOverlay } from "@/components/canvas/canvas-file-drop-overlay";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal } from "@/components/canvas/asset-picker-modal";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { CanvasShareModal } from "@/components/canvas/canvas-share-modal";
import { CanvasScriptEditor, CanvasScriptNodeContent, STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardMinNodeHeight, storyboardTableHeight } from "@/components/canvas/canvas-script-node";
import { CanvasDirectorNodePanel } from "@/components/canvas/director/canvas-director-node-panel";
import { CanvasVersionCompareModal } from "@/components/canvas/canvas-version-compare-modal";
import { CanvasLocalAgentPanel } from "@/components/canvas/canvas-local-agent-panel";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasAlignmentGuides, CanvasConnectionCreateMenu, CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasShortDramaEmptyState, CanvasShortDramaGuide, CanvasStoryInputNodeContent, CanvasStylePlaceholderNodeContent } from "@/components/canvas/canvas-short-drama-entry";
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
import { CanvasProjectContextMenu } from "./canvas-project-context-menu";
import { CanvasProjectMediaDialogs } from "./canvas-project-media-dialogs";
import { CanvasProjectSelectionToolbar } from "./canvas-project-selection-toolbar";
import { CanvasProjectStatusDialogs } from "./canvas-project-status-dialogs";
import { CanvasProjectWorldLayers } from "./canvas-project-world-layers";
import { useCanvasConnectionController } from "./use-canvas-connection-controller";
import { useCanvasAgentOperations } from "./use-canvas-agent-operations";
import { useCanvasAssistantVisibility } from "./use-canvas-assistant-visibility";
import { useCanvasActiveTasks } from "./use-canvas-active-tasks";
import { useCanvasDocumentWorkflow } from "./use-canvas-document-workflow";
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
    type ContextMenuState,
    type Position,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

const CanvasDirectorWorkbench = lazy(() => import("@/components/canvas/director/canvas-director-workbench").then((module) => ({ default: module.CanvasDirectorWorkbench })));

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

            <div className="absolute bottom-5 left-1/2 z-50 flex h-14 -translate-x-1/2 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="size-8 rounded-md bg-current opacity-10" />
                ))}
            </div>

            <div className="absolute bottom-24 left-6 z-50 h-40 w-[240px] rounded-lg border shadow-2xl backdrop-blur-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
                <div className="absolute left-7 top-7 h-5 w-12 rounded-sm bg-current opacity-10" />
                <div className="absolute left-28 top-16 h-6 w-16 rounded-sm bg-current opacity-10" />
                <div className="absolute bottom-7 left-16 h-8 w-20 rounded-sm bg-current opacity-10" />
                <div className="absolute inset-5 rounded border border-current opacity-15" />
            </div>

            <div className="absolute bottom-5 left-5 z-50 flex h-14 w-[260px] items-center gap-2 rounded-xl border px-2 shadow-lg backdrop-blur" style={{ background: "var(--background)", borderColor: "var(--border)" }} aria-hidden="true">
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
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const assets = useAssetStore((state) => state.assets);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
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
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [mediaPerformanceMode, setMediaPerformanceMode] = useState<CanvasMediaPerformanceMode>(readCanvasMediaPerformanceMode);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [workspaceMode, setWorkspaceMode] = useState<CanvasWorkspaceMode>(readCanvasWorkspaceMode);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [documentEditorNodeId, setDocumentEditorNodeId] = useState<string | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
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
    const { agentMode, assistantClosing, assistantMounted, assistantOpen, closeAgent, openAgent, setAgentMode } = useCanvasAssistantVisibility();
    const { tasks: activeTasks } = useCanvasActiveTasks(projectId, projectLoaded);

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
        activatedSkills,
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
    } = useCanvasGeneration({ projectId, projectLoaded, nodes, nodesRef, setNodes });

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (searchParams.has("agentUrl")) {
            setAgentMode("local");
            return;
        }
        openAgent("local");
    }, [openAgent, projectLoaded, searchParams, setAgentMode]);


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
        handleUploadRequest,
        imageInputRef,
        openAssetsAtPosition,
        pasteAssistantImage,
        pasteSystemClipboard,
        startUploadStatus,
        uploadStatus,
    } = useCanvasUpload({
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

    const {
        angleNodeId,
        annotationNodeId,
        createImageReversePromptNodes,
        cropImageNode,
        cropNodeId,
        extractVideoLastFrame,
        extractingVideoFrameNodeId,
        generateAngleNode,
        maskEditImageNode,
        maskEditNodeId,
        mergeSelectedVideos,
        mergeVideosByIds,
        mergeVideoProgress,
        saveAnnotatedImageNode,
        setAngleNodeId,
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

    const handleNodesDeleted = useCallback((removedIds: Set<string>, nextNodes: CanvasNodeData[]) => {
        const clearDeletedId = (current: string | null) => current && removedIds.has(current) ? null : current;
        setHoveredNodeId(clearDeletedId);
        setToolbarNodeId(clearDeletedId);
        setDialogNodeId(clearDeletedId);
        setEditingNodeId(clearDeletedId);
        setInfoNodeId(clearDeletedId);
        setCropNodeId(clearDeletedId);
        setMaskEditNodeId(clearDeletedId);
        setAnnotationNodeId(clearDeletedId);
        setSplitNodeId(clearDeletedId);
        setUpscaleNodeId(clearDeletedId);
        setAngleNodeId(clearDeletedId);
        setSuperResolveNodeId(clearDeletedId);
        setPreviewNodeId(clearDeletedId);
        setRunningNodeId(clearDeletedId);
        setScriptEditorNodeId(clearDeletedId);
        setDocumentEditorNodeId(clearDeletedId);
        setDirectorNodeId(clearDeletedId);
        setVersionCompareRootId(clearDeletedId);
        setScriptScrollTopById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))));
        setContextMenu((current) => current?.type === "node" && removedIds.has(current.nodeId) ? null : current);
        cleanupCanvasFiles({ projectId, nodes: nextNodes, chatSessions });
    }, [chatSessions, cleanupCanvasFiles, projectId, setAngleNodeId, setAnnotationNodeId, setCropNodeId, setMaskEditNodeId, setSplitNodeId, setUpscaleNodeId, setRunningNodeId]);

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
        setPrimaryVersion,
        toggleNodeLocked,
    } = useCanvasNodeOperations({
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
        connectionTargetNodeId,
        connectingParams,
        createConnectedNode,
        handleConnectStart,
        mouseWorld,
        pendingConnectionCreate,
        setConnecting,
    } = useCanvasConnectionController({
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
        if (node.metadata?.document?.kind === "novel") {
            setDialogNodeId(null);
            setDocumentEditorNodeId(node.id);
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
        setEditingNodeId(null);
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
        selectionBoxElementRef,
    } = useCanvasSelectionController({
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
        openTextEditor,
        openingBatchIds,
        saveNodeAsset,
        setBatchPrimary,
        toggleBatchExpanded,
        toggleFrameCollapsed,
        toggleNodeFreeResize,
    } = useCanvasNodeEditor({
        nodesRef,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setDocumentEditorNodeId,
        setEditingNodeId,
        setEditRequestNonce,
        setToolbarNodeId,
        setHoveredNodeId,
    });

    const {
        activeDirectorScene,
        activeDocumentNode,
        activeNodeId,
        activeScriptNode,
        activeStylePresetId,
        angleNode,
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
        activatedSkills,
        directorScenes: currentProject?.directorScenes,
        toolbarNodeId,
        infoNodeId,
        cropNodeId,
        maskEditNodeId,
        annotationNodeId,
        splitNodeId,
        upscaleNodeId,
        superResolveNodeId,
        angleNodeId,
        previewNodeId,
        contextMenu,
        versionCompareRootId,
        directorNodeId,
        documentEditorNodeId,
        scriptEditorNodeId,
        dialogNodeId,
    });
    const dialogNode = dialogNodeId ? nodeById.get(dialogNodeId) || null : null;
    const { agentSnapshot, applyAgentOps, canUndoAgentOps, dismissLastAgentChange, lastAgentChange, undoAgentOps, viewLastAgentChange } = useCanvasAgentOperations({
        projectId,
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

    const {
        analyzeDocumentCharacters,
        analyzeDocumentNode,
        createNovelNode,
        documentAnalyzing,
        documentCharacterAnalyzing,
        documentSaving,
        saveDocumentNode,
        selectCanvasStyle,
    } = useCanvasDocumentWorkflow({
        projectId,
        agentSnapshot,
        applyAgentOps,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        viewportSize: size,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setDocumentEditorNodeId,
        setStylePickerOpen,
        setViewport: handleViewportChange,
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
        setStoryInputMode,
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
        setDocumentEditorNodeId,
        fitCanvasSelection,
        focusCanvasNode,
        openTextEditor,
    });

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAnnotationNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        clearCanvasFiles();
    }, [clearCanvasFiles, deselectCanvas]);

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
        pasteSystemClipboard,
        deleteNodes,
        deleteConnection,
        deselectCanvas,
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
            if (pasteCopiedNodes(position)) return;
            void pasteSystemClipboard(position).catch(() => message.warning("无法读取剪贴板内容"));
        },
        [message, pasteCopiedNodes, pasteSystemClipboard],
    );

    const copyNodeContentToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
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
        [message],
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
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
    }, [closeConnectionCreateMenu]);

    const handleGenerateNode = useCanvasGenerationExecutor({
        projectId,
        activatedSkills,
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
        analyzeDocumentChapter,
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
        activatedSkills,
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
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    quality: effectiveConfig.quality,
                    transparentBackground: effectiveConfig.transparentBackground,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig, message],
    );

    const renderCanvasNodePanel = useCallback(
        (panelNode: CanvasNodeData) => {
            if (panelNode.type === CanvasNodeType.Script) return null;
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
        if (contentNode.metadata?.workflowKind === "styleboard" && !contentNode.metadata.content) {
            return <CanvasStylePlaceholderNodeContent onChoose={() => setStylePickerOpen(true)} />;
        }
        if (contentNode.metadata?.workflowKind === "story_input") {
            return <CanvasStoryInputNodeContent node={contentNode} onModeChange={(mode) => setStoryInputMode(contentNode.id, mode)} onEdit={() => openStoryInput(contentNode.id)} />;
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
                    onGenerateVideos={() => workspaceMode === "simple" ? void createAndGenerateScriptVideos(contentNode.id) : void generateScriptVideos(contentNode.id, rowIds)}
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
    }, [addScriptRow, cancelSubmittedBatchItem, configInputsById, confirmStopGeneration, createAndGenerateScriptVideos, createScriptActionBoards, createScriptImageNodes, createScriptVideoNodes, currentProject?.directorScenes, generateScriptImages, generateScriptRows, generateScriptVideos, handleConfigNodeChange, handleConnectStart, handleGenerateNode, handleNodeResize, mentionReferencesByNodeId, mergeVideosByIds, openDirectorWorkbench, openStoryInput, removeScriptRow, retryFailedBatchItems, runningNodeId, setStoryInputMode, stopRemainingBatchItems, updateScriptRow, viewport.k, workspaceMode]);

    const handleCanvasNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
        keepNodeToolbar(nodeId);
    }, [keepNodeToolbar]);
    const handleCanvasNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
        hideNodeToolbar();
    }, [hideNodeToolbar]);
    const retryCanvasNode = useCallback((node: CanvasNodeData) => { void handleRetryNode(node); }, [handleRetryNode]);
    const openCanvasNodeTaskDetails = useCallback((node: CanvasNodeData) => { void openNodeTaskDetails(node); }, [openNodeTaskDetails]);
    const openCanvasNodeVersions = useCallback((node: CanvasNodeData) => setVersionCompareRootId(node.metadata?.versionOfNodeId || node.id), []);
    const viewCanvasNodeImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const editCanvasDirector = useCallback((node: CanvasNodeData) => openDirectorWorkbench(node.id), [openDirectorWorkbench]);
    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <section className="relative min-w-0 flex-1 overflow-hidden">
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
                />

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

                <CanvasActiveTaskPanel tasks={activeTasks} />

                <CanvasShortDramaGuide progress={shortDramaProgress} collapsed={shortDramaGuideCollapsed} onToggle={() => setShortDramaGuideCollapsed((value) => !value)} onSkip={skipShortDramaGuide} onStepClick={activateShortDramaStep} />

                <CanvasShareModal projectId={projectId} open={shareModalOpen} onClose={() => setShareModalOpen(false)} beforeCreate={saveCanvasProject} />

                <CanvasDocumentEditorModal
                    node={activeDocumentNode}
                    open={Boolean(activeDocumentNode)}
                    saving={documentSaving}
                    analyzing={documentAnalyzing}
                    characterAnalyzing={documentCharacterAnalyzing}
                    onClose={() => setDocumentEditorNodeId(null)}
                    onSave={(document, title) => { if (activeDocumentNode) void saveDocumentNode(activeDocumentNode, document, title); }}
                    onAnalyze={(document, title) => activeDocumentNode ? analyzeDocumentNode(activeDocumentNode, document, title) : undefined}
                    onAnalyzeCharacters={(document, title, chapter) => activeDocumentNode ? analyzeDocumentCharacters(activeDocumentNode, document, title, chapter) : undefined}
                    onAnalyzeChapter={async (document, chapter, title) => activeDocumentNode ? analyzeDocumentChapter(activeDocumentNode, document, chapter, title) : undefined}
                />

                <CanvasStylePickerModal open={stylePickerOpen} value={activeStylePresetId} onClose={() => setStylePickerOpen(false)} onSelect={selectCanvasStyle} />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    onViewportChange={handleViewportChange}
                    onViewportPreviewChange={handleViewportPreviewChange}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDoubleClick={handleCanvasDoubleClick}
                    onCanvasDeselect={deselectCanvas}
                    onContextMenu={handleCanvasContextMenu}
                    onDrop={handleDrop}
                    onFileDragEnter={handleFileDragEnter}
                    onFileDragLeave={handleFileDragLeave}
                    onFileDragOver={handleFileDragOver}
                >
                    <CanvasProjectWorldLayers
                        theme={theme}
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
                        editingNodeId={editingNodeId}
                        editRequestNonce={editRequestNonce}
                        selectionBox={selectionBox}
                        batchChildCountById={batchChildCountById}
                        collapsingBatchIds={collapsingBatchIds}
                        openingBatchIds={openingBatchIds}
                        batchMotionById={batchMotionById}
                        showImageInfo={showImageInfo}
                        reduceMediaEffects={reduceMediaEffects}
                        resourceReferenceByNodeId={resourceReferenceByNodeId}
                        mentionReferencesByNodeId={mentionReferencesByNodeId}
                        angleNode={angleNode}
                        selectedNodeBounds={selectedNodeBounds}
                        isNodeDragging={isNodeDragging}
                        selectionBoundsElementRef={selectionBoundsElementRef}
                        selectionBoxElementRef={selectionBoxElementRef}
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
                        onGenerateImage={generateImageFromTextNode}
                        onViewImage={viewCanvasNodeImage}
                        onReplaceMedia={(node) => handleUploadRequest(node.id)}
                        onOpenDirector={editCanvasDirector}
                        onOpenDocument={openTextEditor}
                        onCloseAngle={() => setAngleNodeId(null)}
                        onGenerateAngle={(params) => { if (angleNode) void generateAngleNode(angleNode, params); }}
                    />
                </InfiniteCanvas>

                {dialogNode && dialogNode.type !== CanvasNodeType.Script && !selectionBox ? (
                    <CanvasNodePanelOverlay node={dialogNode} viewport={viewport} containerRef={containerRef}>
                        {renderCanvasNodePanel(dialogNode)}
                    </CanvasNodePanelOverlay>
                ) : null}

                <CanvasFileDropOverlay active={fileDropActive} theme={theme} />

                {!nodes.length ? <CanvasShortDramaEmptyState onCreatePipeline={createShortDramaPipeline} onOpenAgent={() => { setCinematicAgentEntry(true); setAgentMode("online"); openAgent("online"); }} onUpload={() => handleUploadRequest()} onAddText={() => createNode(CanvasNodeType.Text)} onAddNovel={() => createNovelNode()} onAddScript={() => createNode(CanvasNodeType.Script)} /> : null}

                {pendingConnectionCreate ? <CanvasConnectionCreateMenu pending={pendingConnectionCreate} viewport={viewport} viewportSize={size} containerRef={containerRef} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}

                {selectedNodeBounds && !selectionBox && !isNodeDragging ? <CanvasProjectSelectionToolbar anchorRef={selectionBoundsElementRef} containerRef={containerRef} count={selectedNodeBounds.count} selectedVideoCount={selectedVideoNodes.length} mergingVideos={Boolean(mergeVideoProgress)} onAlign={alignSelectedNodes} onArrange={arrangeSelectedNodes} onCreateStoryboard={createStoryboardGroup} onCreateReferenceGroup={createReferenceGroup} onMergeVideos={() => void mergeSelectedVideos()} /> : null}

                <CanvasAlignmentGuides guides={{ vertical: alignmentGuides.vertical ?? null, horizontal: alignmentGuides.horizontal ?? null }} viewport={viewport} containerRef={containerRef} color={theme.accent.primary} />

                {uploadStatus ? <CanvasUploadStatusToast status={uploadStatus} theme={theme} /> : null}
                {mergeVideoProgress ? <CanvasMergeStatusToast progress={mergeVideoProgress} theme={theme} /> : null}
                {lastAgentChange ? <CanvasAgentChangeToast change={lastAgentChange} theme={theme} onView={viewLastAgentChange} onUndo={() => { undoAgentOps(); }} onClose={dismissLastAgentChange} /> : null}

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    workspaceMode={workspaceMode}
                    viewport={viewport}
                    containerRef={containerRef}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onAnnotate={(node) => setAnnotationNodeId(node.id)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
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

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    workspaceMode={workspaceMode}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddNovel={createNovelNode}
                    onChooseStyle={() => setStylePickerOpen(true)}
                    onAddScript={() => createNode(CanvasNodeType.Script)}
                    onAddFrame={() => createNode(CanvasNodeType.Frame)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
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
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} canvasContainerRef={containerRef} onViewportPreviewChange={previewViewport} onViewportChange={handleViewportChange} /> : null}

                <div data-canvas-no-zoom className="absolute bottom-4 left-4 z-50 flex items-end gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                    <CanvasZoomControls scale={viewport.k} containerRef={containerRef} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} onOpenShortcuts={() => setShortcutRequestNonce((value) => value + 1)} />
                    <CanvasAssetTray assetImages={imageAssets} canvasImages={canvasImageNodes} activeNodeId={selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null} onInsertAssetImage={(asset) => void createImageAssetNode(asset)} onFocusCanvasImage={focusCanvasImageNode} />
                </div>

                <CanvasProjectContextMenu
                    menu={contextMenu}
                    node={contextMenuNode}
                    workspaceMode={workspaceMode}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    canPaste={hasCopiedNodes || Boolean(navigator.clipboard)}
                    screenToCanvas={screenToCanvas}
                    onClose={() => setContextMenu(null)}
                    onAddNode={(type, position) => createNode(type, position)}
                    onAddNovel={(position) => createNovelNode(position)}
                    onOpenDirector={createDirectorShot}
                    onUpload={(nodeId, position) => handleUploadRequest(nodeId, position)}
                    onOpenAssets={openAssetsAtPosition}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onPaste={pasteAtPosition}
                    onCopyNode={(nodeId) => copyNodesToClipboard(new Set([nodeId]))}
                    onDuplicate={duplicateNode}
                    onDeleteNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                    onDeleteConnection={deleteConnection}
                    onSaveAsset={(node) => { void saveNodeAsset(node); }}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onEditNode={(node) => { setSelectedNodeIds(new Set([node.id])); setSelectedConnectionId(null); setDialogNodeId(node.id); }}
                    onEditText={openTextEditor}
                    onGenerateImage={generateImageFromTextNode}
                    onCopyContent={(node) => { void copyNodeContentToClipboard(node); }}
                    onToggleFrame={(node) => toggleFrameCollapsed(node.id)}
                />

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} onMetadataChange={handleConfigNodeChange} />

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
                    onGenerateVideos={(rowIds) => activeScriptNode && void generateScriptVideos(activeScriptNode.id, rowIds)}
                />

                {directorNodeId && activeDirectorScene ? (
                    <Suspense fallback={<div className="fixed inset-0 z-[500] grid place-items-center" style={{ background: theme.canvas.background, color: theme.node.text }}>正在加载 3D 导演台...</div>}>
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
                {codexCompactAgent && !assistantMounted ? <CanvasLocalAgentPanel headless snapshot={agentSnapshot} canUndoOps={canUndoAgentOps} onApplyOps={applyAgentOps} onUndoOps={undoAgentOps} autoConnect={codexAutoConnect} /> : null}
            </section>
            {assistantMounted ? (
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
                    onUndoOps={undoAgentOps}
                    onPasteImage={pasteAssistantImage}
                    agentMode={agentMode}
                    onAgentModeChange={setAgentMode}
                    autoConnectLocal={codexAutoConnect}
                    closing={assistantClosing}
                    onCollapse={closeAgent}
                    cinematicEntry={cinematicAgentEntry}
                    onCinematicEntryConsumed={() => setCinematicAgentEntry(false)}
                />
            ) : null}
        </main>
    );
}
