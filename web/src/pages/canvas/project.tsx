import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { uploadMediaFile } from "@/services/file-storage";
import { readLocalRuntimeBootstrapState } from "@/services/local-runtime-bootstrap";
import { createCanvasGenerationLiveProjectAdapter, registerCanvasGenerationLiveProject } from "@/services/canvas-generation-consumer";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceFileUrl, resourceIdFromStorageKey, syncResourceToArkPrivateAsset } from "@/services/api/resources";
import { uploadImage } from "@/services/image-storage";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import copyToClipboard from "copy-to-clipboard";
import { nanoid } from "nanoid";
import { canvasAppearanceBaseTheme, canvasAppearanceForTheme, normalizeCanvasAppearance, resolveCanvasAppearance, writeCanvasAppearanceDefault, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { persistCanvasMediaPerformanceMode, readCanvasMediaPerformanceMode } from "@/lib/canvas/canvas-performance-mode";
import { summarizeCanvasContext } from "@/lib/canvas/canvas-context-summary";
import { refreshCanvasCharacterReferenceNodes } from "@/lib/canvas/canvas-character-reference";
import { shouldAutoConnectCanvasRuntime } from "@/lib/canvas/local-runtime-connection";
import { useAssetStore } from "@/stores/use-asset-store";
import { flushCanvasStorePersistence } from "@/stores/canvas/use-canvas-store";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { App, Modal } from "antd";
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
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { createStyleProfileSnapshot, resolveStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { CanvasNodeToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-toolbar";
import { CanvasSubtitleDialog } from "@/components/canvas/canvas-subtitle-dialog";
import { CanvasVideoFrameDialog } from "@/components/canvas/canvas-video-frame-dialog";
import { CanvasVideoSegmentDialog } from "@/components/canvas/canvas-video-segment-dialog";
import { CanvasTimelineDialog } from "@/components/canvas/canvas-timeline-dialog";
import { syncNodeSubtitlesToTimeline } from "@/lib/timeline/timeline-build";
import type { TimelineDirectMedia } from "@/types/timeline";
import { CanvasNodeAnglePanel } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasTextEditorModal } from "@/components/canvas/canvas-text-editor-modal";
import { CanvasNodeSearchModal } from "@/components/canvas/canvas-node-search-modal";
import { CanvasStylePickerModal } from "@/components/canvas/canvas-style-picker-modal";
import { CanvasDirectorTemplateModal } from "@/components/canvas/director/canvas-director-template-modal";
import { CanvasFileDropOverlay } from "@/components/canvas/canvas-file-drop-overlay";
import { CanvasUploadModal } from "@/components/canvas/canvas-upload-modal";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { useCanvasCreateCommands } from "@/components/canvas/use-canvas-create-commands";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { getProject } from "@/services/api/projects";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { CanvasShareModal } from "@/components/canvas/canvas-share-modal";
import { CanvasScriptEditor, CanvasScriptNodeContent } from "@/components/canvas/canvas-script-node";
import { STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardMinNodeHeight, storyboardTableHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { CanvasDirectorNodePanel } from "@/components/canvas/director/canvas-director-node-panel";
import { CanvasVersionCompareModal } from "@/components/canvas/canvas-version-compare-modal";
import { CanvasLocalAgentPanel } from "@/components/canvas/canvas-local-agent-panel";
import { useFocusMode } from "@/hooks/use-focus-mode";
import { useCanvasAgentStore } from "@/stores/canvas/use-canvas-agent-store";
import { getContextResourceNodes, normalizeCanvasNodeMentionTokens, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasConnectionCreateMenu, CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { CanvasOverlayLayerContainer, CanvasOverlayLayerProvider } from "@/components/canvas/canvas-overlay-layer";
import { CanvasLeaferGraphicsLayer } from "@/components/canvas/canvas-leafer-graphics-layer";
import { CanvasFreeformEmptyState, CanvasLinkedProjectEmptyState, CanvasShortDramaEmptyState, CanvasShortDramaGuide, CanvasStoryInputNodeContent, CanvasStylePlaceholderNodeContent } from "@/components/canvas/canvas-short-drama-entry";
import { resolveCanvasEmptyStateKind } from "@/lib/canvas/canvas-starter";
import { failedImageBatchChildren, markImageBatchRetrying, reconcileImageBatchRoot, restoreUnsubmittedImageBatchChild } from "@/lib/canvas/canvas-image-batch-retry";
import { createCanvasNode, getInputSummary, isHiddenBatchChild, persistCanvasWorkspaceMode, readCanvasWorkspaceMode } from "@/lib/canvas/canvas-project-domain";
import { stampCanvasNodeChanges } from "@/lib/canvas/canvas-node-timestamps";
import { canvasAssetHandoffAttempt, finalizeCanvasAssetHandoff, uninsertedCanvasAssetHandoffPayloads } from "@/lib/canvas/canvas-asset-handoff";
import { batchSourceRestriction } from "@/lib/canvas/canvas-batch-connection";
import { deriveStoryboardPipelineProgress } from "@/lib/canvas/canvas-storyboard-progress";
import { CanvasAgentChangeToast, CanvasMergeStatusToast, CanvasUploadStatusToast } from "./canvas-project-feedback";
import { backendProviderConfig, getGenerationCount } from "@/lib/canvas/canvas-project-generation";
import { cancelGenerationTask } from "@/services/api/task-center";
import { CanvasTopBar, CanvasWorkspaceModeSwitch } from "./canvas-project-top-bar";
import { LibTVImportDialog } from "./components/libtv-import-dialog";
import { TapNowImportDialog } from "./components/tapnow-import-dialog";
import { CanvasFocusModeBar } from "@/components/canvas/canvas-focus-mode-bar";
import { CanvasProjectContextMenu } from "./canvas-project-context-menu";
import { CanvasProjectMediaDialogs } from "./canvas-project-media-dialogs";
import { CanvasProjectSelectionToolbar } from "./canvas-project-selection-toolbar";
import { CanvasProjectStatusDialogs } from "./canvas-project-status-dialogs";
import { CanvasProjectWorldLayers } from "./canvas-project-world-layers";
import { CanvasNodeActionContext } from "@/components/canvas/canvas-node-action-context";
import { PortraitClearanceModal } from "@/components/canvas/portrait-clearance/portrait-clearance-modal";
import { CanvasNodeGraphContext, type CanvasNodeGraphContextValue } from "@/components/canvas/canvas-node-graph-context";
import { CanvasRefreshShell } from "./canvas-refresh-shell";
import { queryGenerationTask } from "@/services/api/task-center";
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
import { useCanvasGenerationExecutor, type CanvasNodeGenerationOptions } from "./use-canvas-generation-executor";
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
import { usePortraitClearanceCoordinator } from "./use-portrait-clearance-coordinator";
import {
    CanvasNodeType,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasFolderStyle,
    type CanvasFolderTheme,
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
import type { PortraitClearanceNodeState } from "@/lib/portrait-clearance/contracts";
import { createDefaultPortraitClearanceState, PORTRAIT_CLEARANCE_NODE_TYPE } from "@/lib/portrait-clearance/contracts";
import { reconcilePortraitClearanceInputBindings } from "@/lib/portrait-clearance/input-bindings";

const CanvasDirectorWorkbench = lazy(() => import("@/components/canvas/director/canvas-director-workbench").then((module) => ({ default: module.CanvasDirectorWorkbench })));
const CanvasDrawingEditorModal = lazy(() => import("@/components/canvas/canvas-drawing-editor-modal").then((module) => ({ default: module.CanvasDrawingEditorModal })));

const NODE_STATUS_SUCCESS = "success" as const;
const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];

async function copyImageToSystemClipboard(source: string) {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("当前浏览器不支持复制图片");
    const response = await fetch(source);
    if (!response.ok) throw new Error(`图片读取失败（HTTP ${response.status}）`);
    const sourceBlob = await response.blob();
    const blob = sourceBlob.type === "image/png" ? sourceBlob : await convertClipboardImageToPNG(sourceBlob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

async function convertClipboardImageToPNG(blob: Blob) {
    if (typeof createImageBitmap !== "function") throw new Error("当前浏览器无法转换这张图片的格式");
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器无法处理这张图片");
        context.drawImage(bitmap, 0, 0);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片格式转换失败")), "image/png"));
    } finally {
        bitmap.close();
    }
}

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

function InfiniteCanvasPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const params = useParams<{ id: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const projectId = params.id || "";
    const canvasStorageScope = getActiveUserScope();
    const localAgentConnected = useCanvasAgentStore((state) => state.connected);
    const localAgentActivity = useCanvasAgentStore((state) => state.activity);
    const localAgentEnabled = useCanvasAgentStore((state) => state.enabled);
    const containerRef = useRef<HTMLDivElement>(null);
    const didInitialCenterRef = useRef(false);
    const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const assetHandoffRef = useRef("");

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const assets = useAssetStore((state) => state.assets);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const defaultDrawingEngine = useUserStore((state) => state.drawingEngine.defaultEngine);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const directorOnboardingScope = useUserStore((state) => state.user?.id?.trim() || "");
    const nodesRef = useRef<CanvasNodeData[]>([]);
    const [nodes, setNodesState] = useState<CanvasNodeData[]>([]);
    const setNodes = useCallback<Dispatch<SetStateAction<CanvasNodeData[]>>>((value) => {
        if (typeof value === "function") {
            setNodesState((current) => {
                const next = stampCanvasNodeChanges(current, value(current));
                nodesRef.current = next;
                return next;
            });
            return;
        }
        const next = stampCanvasNodeChanges(nodesRef.current, value);
        nodesRef.current = next;
        setNodesState(next);
    }, []);
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
    const [canvasAppearance, setCanvasAppearance] = useState<CanvasAppearance>(() => canvasAppearanceForTheme(colorTheme));
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [canvasTool, setCanvasTool] = useState<CanvasToolMode>("move");
    const [mediaPerformanceMode, setMediaPerformanceMode] = useState<CanvasMediaPerformanceMode>(readCanvasMediaPerformanceMode);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [workspaceMode, setWorkspaceMode] = useState<CanvasWorkspaceMode>(readCanvasWorkspaceMode);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [tapNowImportOpen, setTapNowImportOpen] = useState(false);
    const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [arkPrivateAssetUploadNodeId, setArkPrivateAssetUploadNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [textEditorNodeId, setTextEditorNodeId] = useState<string | null>(null);
    const [characterReferenceNodeId, setCharacterReferenceNodeId] = useState<string | null>(null);
    const [drawingNodeId, setDrawingNodeId] = useState<string | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    // 新建导演台镜头必须先选模板：null 表示未在选择中，undefined position 表示用画布中心。
    const [directorTemplateRequest, setDirectorTemplateRequest] = useState<{ position?: Position } | null>(null);
    const [projectAssetOpen, setProjectAssetOpen] = useState(false);
    const [projectAssetInitialCategory, setProjectAssetInitialCategory] = useState("all");
    const [projectAssetInitialFolderId, setProjectAssetInitialFolderId] = useState("all");
    const [projectAssetInsertPosition, setProjectAssetInsertPosition] = useState<Position | undefined>();
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [subtitleNodeId, setSubtitleNodeId] = useState<string | null>(null);
    const [timelineNodeId, setTimelineNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [scriptEditorNodeId, setScriptEditorNodeId] = useState<string | null>(null);
    const [portraitClearanceNodeId, setPortraitClearanceNodeId] = useState<string | null>(null);
    const [scriptScrollTopById, setScriptScrollTopById] = useState<Record<string, number>>({});
    const [directorNodeId, setDirectorNodeId] = useState<string | null>(null);
    const [versionCompareRootId, setVersionCompareRootId] = useState<string | null>(null);
    const [libTVImportOpen, setLibTVImportOpen] = useState(false);
    const codexAutoConnect = shouldAutoConnectCanvasRuntime(searchParams);
    const codexCompactAgent = codexAutoConnect && readLocalRuntimeBootstrapState().legacyDeepLinkRejected;
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

    const connectionsRef = useRef(connections);
    const chatSessionsRef = useRef(chatSessions);
    const activeChatIdRef = useRef(activeChatId);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => Promise<void>) | null>(null);

    useEffect(() => {
        if (!projectId) return;
        return registerCanvasGenerationLiveProject({
            scope: canvasStorageScope,
            projectId,
            adapter: createCanvasGenerationLiveProjectAdapter({ nodesRef, connectionsRef, chatSessionsRef, activeChatIdRef, setNodes, setConnections, setChatSessions, setActiveChatId }),
        });
    }, [canvasStorageScope, projectId]);

    const resolvedCanvasAppearance = useMemo(() => resolveCanvasAppearance(canvasAppearance, colorTheme), [canvasAppearance, colorTheme]);
    const applyCanvasAppearance = useCallback((next: CanvasAppearance) => {
        const fallback = canvasAppearanceBaseTheme(next, colorTheme);
        const normalized = normalizeCanvasAppearance(next, fallback);
        setCanvasAppearance(normalized);
        setTheme(canvasAppearanceBaseTheme(normalized, fallback));
    }, [colorTheme, setTheme]);
    const saveCanvasAppearanceDefault = useCallback((next: CanvasAppearance) => {
        writeCanvasAppearanceDefault({ appearance: next, backgroundMode });
        message.success("已保存为当前账号在本机的新建画布默认外观");
    }, [backgroundMode, message]);

    const { getHistoryCleanupContext, historyPausedRef, historyState, redoCanvas, resetHistory, undoCanvas } = useCanvasHistory({
        projectLoaded,
        nodes,
        connections,
        chatSessions,
        activeChatId,
        canvasAppearance,
        backgroundMode,
        showImageInfo,
        setNodes,
        setConnections,
        setChatSessions,
        setActiveChatId,
        applyCanvasAppearance,
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

    const { addedSkills, clearCanvasFiles, createAndOpenProject, currentProject, deleteCurrentProject, renameCurrentProject, saveCanvasProject, updateProject } = useCanvasProjectLifecycle({
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
    });

    const applyLibTVImport = useCallback(
        async (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[]) => {
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const nextNodes = [...nodesRef.current, ...importedNodes];
            const nextConnections = [...connectionsRef.current, ...importedConnections];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            const saved = await saveCanvasProject();
            if (!saved) {
                nodesRef.current = previousNodes;
                connectionsRef.current = previousConnections;
                setNodes(previousNodes);
                setConnections(previousConnections);
                throw new Error("画布保存失败，已撤销本次 LibTV 导入");
            }
        },
        [saveCanvasProject, setConnections, setNodes],
    );
    const applyTapNowImport = useCallback(
        async (importedNodes: CanvasNodeData[], importedConnections: CanvasConnection[]) => {
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const nextNodes = [...nodesRef.current, ...importedNodes];
            const nextConnections = [...connectionsRef.current, ...importedConnections];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            const saved = await saveCanvasProject();
            if (!saved) {
                nodesRef.current = previousNodes;
                connectionsRef.current = previousConnections;
                setNodes(previousNodes);
                setConnections(previousConnections);
                throw new Error("画布保存失败，已撤销本次 TapNow 导入");
            }
        },
        [saveCanvasProject, setConnections, setNodes],
    );
    const linkedProjectId = shortDramaEnabled ? currentProject?.projectId || "" : "";
    const linkedProjectQuery = useQuery({ queryKey: ["project", linkedProjectId], queryFn: () => getProject(linkedProjectId), enabled: Boolean(linkedProjectId) });
    const refetchLinkedProject = linkedProjectQuery.refetch;
    const archiveNodesToLinkedFolder = useCallback((folder: CanvasNodeData, droppedNodes: CanvasNodeData[]) => {
        const folderId = folder.metadata?.folder?.assetFolderId;
        const domainProjectId = folder.metadata?.folder?.projectId || linkedProjectId;
        if (!folderId || !domainProjectId || !droppedNodes.length) return;
        void Promise.all(droppedNodes.map((node) => ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, folderId, node, source: "canvas-manual" })))
            .then((results) => {
                const archivedByNodeId = new Map(droppedNodes.map((node, index) => [node.id, { assetId: results[index].assetId, content: node.metadata?.content, previousAssetId: node.metadata?.assetId }]));
                setNodes((current) => current.map((node) => {
                    const archived = archivedByNodeId.get(node.id);
                    if (!archived || node.metadata?.content !== archived.content || node.metadata?.assetId !== archived.previousAssetId) return node;
                    return { ...node, metadata: { ...node.metadata, assetId: archived.assetId } };
                }));
                void refetchLinkedProject();
                message.success(`已归档到“${folder.title}”`);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "素材归档失败"));
    }, [linkedProjectId, message, projectId, refetchLinkedProject, setNodes]);
    useEffect(() => {
        if (!projectLoaded || !linkedProjectQuery.data) return;
        setNodes((current) => refreshCanvasCharacterReferenceNodes(current, linkedProjectQuery.data.assets));
    }, [linkedProjectQuery.data, projectLoaded, setNodes]);
    const canvasContext = useMemo(() => summarizeCanvasContext(nodes, selectedNodeIds, linkedProjectQuery.data?.units), [linkedProjectQuery.data?.units, nodes, selectedNodeIds]);
    // 扩展节点（对比/图表/调色）要读自己的上游才能渲染，经 Context 下发；
    // 取上游复用 canvas-resource-references 的实现，别在这里另写一份。必须 memo——
    // 每帧新对象会让所有节点跟着重渲染，错题本里多条崩溃都出在画布高频更新。
    const nodeGraphContext = useMemo<CanvasNodeGraphContextValue>(() => ({ getUpstreamNodes: (nodeId: string) => getContextResourceNodes(nodeId, nodes, connections) }), [connections, nodes]);

    const {
        applyGenerationTaskResult,
        bindGenerationTask,
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

    const cancelCanvasTask = useCallback(
        (task: import("@/services/api/task-center").GenerationTask) => {
            if (task.provider === "dreamina-cli") {
                message.warning("官方即梦 CLI 当前不支持可靠取消，请等待官方状态同步");
                return;
            }
            Modal.confirm({
                title: "取消生成任务？",
                content: "任务会立即停止本地执行；如果已经提交到上游，系统会继续核对取消结果和积分状态。",
                okText: "取消任务",
                okButtonProps: { danger: true },
                cancelText: "继续等待",
                onOk: async () => {
                    try {
                        const next = await cancelGenerationTask(task.id);
                        const node = nodesRef.current.find((item) => item.metadata?.taskId === task.id);
                        if (node) bindGenerationTask(node.id, next);
                        setTaskDetail((current) => (current?.id === task.id ? next : current));
                        await queryClient.invalidateQueries({ queryKey: ["canvas-active-tasks", projectId] });
                        message.success("任务已取消");
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "取消任务失败");
                    }
                },
            });
        },
        [bindGenerationTask, message, nodesRef, projectId, queryClient, setTaskDetail],
    );

    useEffect(() => {
        if (!projectLoaded || !codexAutoConnect) return;
        if (codexCompactAgent) {
            setAgentMode("local");
            return;
        }
        openAgent("local");
    }, [codexAutoConnect, codexCompactAgent, openAgent, projectLoaded, setAgentMode]);

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
        chatSessionsRef.current = chatSessions;
        activeChatIdRef.current = activeChatId;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
    }, [activeChatId, chatSessions, nodes, connections, selectedNodeIds, viewport]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize((current) => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }));
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
        const project = linkedProjectQuery.data?.project;
        const preset = resolveProjectCanvasStyle(project?.stylePresetId, project?.styleProfileJson);
        if (!projectLoaded || !preset) return;
        const profile = resolveStyleProfile(project?.stylePresetId, project?.styleProfileJson, preset.profile || createStyleProfileSnapshot(preset));
        if (!profile) return;
        const current = nodesRef.current.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "styleboard");
        const nextMetadata = {
            content: profile.prompt,
            prompt: profile.prompt,
            status: NODE_STATUS_SUCCESS,
            workflowKind: "styleboard" as const,
            workflowTitle: "项目画风",
            workflowDescription: profile.description,
            stylePresetId: profile.presetId,
            styleProfileJson: serializeStyleProfile(profile),
            fontSize: 14,
            locked: true,
        };
        if (current) {
            if (current.metadata?.stylePresetId === profile.presetId && current.metadata?.content === profile.prompt && current.metadata?.styleProfileJson === nextMetadata.styleProfileJson && current.metadata?.locked) return;
            setNodes((nodes) => nodes.map((node) => (node.id === current.id ? { ...node, title: `项目画风 · ${profile.title}`, metadata: { ...node.metadata, ...nextMetadata } } : node)));
            return;
        }
        const node = createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), nextMetadata);
        node.title = `项目画风 · ${profile.title}`;
        node.width = 420;
        node.height = 240;
        setNodes((nodes) => [...nodes, node]);
    }, [getCanvasCenter, linkedProjectQuery.data?.project, projectLoaded, setNodes]);

    const {
        assetPickerOpen,
        closeUploadModal,
        closeAssetPicker,
        createVideoNodeFromBlob,
        createImageAssetNode,
        fileDropActive,
        handleAssetsInsert,
        handleDrop,
        handleFileDragEnter,
        handleFileDragLeave,
        handleFileDragOver,
        handleImageInputChange,
        handleProjectAssetsInsert,
        handleProjectChapterInsert,
        handleUploadFiles,
        handleUploadRequest,
        imageInputRef,
        openAssetsAtPosition,
        pasteAssistantImage,
        pasteSystemClipboard,
        startUploadStatus,
        uploadModalOpen,
        uploadTimelineMedia,
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
    const replaceCanvasNodeMedia = useCallback((node: CanvasNodeData) => handleUploadRequest(node.id), [handleUploadRequest]);

    useEffect(() => {
        if (!projectLoaded || !assetsHydrated || searchParams.get("mode") !== "handoff") return;
        const attempt = canvasAssetHandoffAttempt(assets, searchParams);
        const { assetIds, payloads } = attempt;
        if (!assetIds.length) return;
        const assetReadiness = assetIds
            .map((assetId) => {
                const asset = assets.find((candidate) => candidate.id === assetId);
                return `${assetId}:${asset?.kind || "missing"}`;
            })
            .join("|");
        const handoffKey = `${projectId}:${assetReadiness}`;
        if (assetHandoffRef.current === handoffKey) return;
        assetHandoffRef.current = handoffKey;

        if (attempt.kind === "retry") return;
        const pendingPayloads = uninsertedCanvasAssetHandoffPayloads(nodesRef.current, payloads);
        const persistHandoff = async (createdNodes: CanvasNodeData[]) => {
            const finalized = await finalizeCanvasAssetHandoff({
                searchParams,
                currentNodes: nodesRef.current,
                createdNodes,
                persist: async (nextNodes) => {
                    nodesRef.current = nextNodes;
                    updateProject(projectId, { nodes: nextNodes });
                    await flushCanvasStorePersistence();
                },
            });
            setSearchParams(finalized.searchParams, { replace: true });
        };
        const insertion = pendingPayloads.length ? handleProjectAssetsInsert(pendingPayloads) : Promise.resolve([] as CanvasNodeData[]);
        void insertion.then(persistHandoff).catch(() => {
            assetHandoffRef.current = "";
        });
    }, [assets, assetsHydrated, handleProjectAssetsInsert, message, nodesRef, projectId, projectLoaded, searchParams, setSearchParams, updateProject]);

    // 时间线弹窗内新增素材的回填通道：素材库/上传创建节点后由弹窗通过 ref 加入草稿。
    const timelineAddNodeRef = useRef<((node: CanvasNodeData) => void) | null>(null);
    // 时间线作用域直连媒体入轨通道：素材库/项目资产/本地上传不落画布，仅加入时间线草稿。
    const timelineMediaAddRef = useRef<((media: TimelineDirectMedia) => void) | null>(null);
    // 素材库与项目资产弹窗的插入作用域：时间线弹窗内打开时为 timeline，其余为 canvas。
    const [assetInsertScope, setAssetInsertScope] = useState<"canvas" | "timeline">("canvas");
    const [projectAssetScope, setProjectAssetScope] = useState<"canvas" | "timeline">("canvas");

    // InsertAssetPayload → 直连媒体：仅音视频支持直接入轨；图片/文本/角色返回 null（避免在画布重复出现）。
    const payloadToTimelineMedia = (payload: InsertAssetPayload): TimelineDirectMedia | null => {
        const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (payload.kind === "video") {
            return {
                id: payload.assetId || `asset-${randomSuffix}`,
                kind: "video",
                title: payload.title,
                storageKey: payload.storageKey,
                url: payload.url,
                width: payload.width,
                height: payload.height,
                durationMs: payload.durationMs,
                bytes: payload.bytes,
                mimeType: payload.mimeType,
            };
        }
        if (payload.kind === "audio") {
            return { id: payload.assetId || `asset-${randomSuffix}`, kind: "audio", title: payload.title, storageKey: payload.storageKey, url: payload.url, durationMs: payload.durationMs, bytes: payload.bytes, mimeType: payload.mimeType };
        }
        return null;
    };

    const handleLibraryAssetsInsert = useCallback(
        async (payloads: InsertAssetPayload[]) => {
            if (assetInsertScope === "timeline") {
                const media = payloads.map(payloadToTimelineMedia).filter((item): item is TimelineDirectMedia => Boolean(item));
                if (media.length !== payloads.length) throw new Error("图片和文本素材暂不支持直接入轨，请先插入画布");
                media.forEach((item) => timelineMediaAddRef.current?.(item));
                return;
            }
            const created = await handleAssetsInsert(payloads);
            created.forEach((node) => timelineAddNodeRef.current?.(node));
        },
        [assetInsertScope, handleAssetsInsert],
    );

    // 项目资产库引入到时间线：复用现有引入逻辑，把创建出的节点回填到弹窗草稿。
    const handleTimelineProjectAssetsInsert = useCallback(
        async (payloads: InsertAssetPayload[]) => {
            if (projectAssetScope === "timeline") {
                let inserted = 0;
                for (const payload of payloads) {
                    const media = payloadToTimelineMedia(payload);
                    if (media) {
                        timelineMediaAddRef.current?.(media);
                        inserted += 1;
                    }
                }
                if (inserted < payloads.length) message.info("图片/文本/角色素材暂不支持直接入轨，仅音视频素材已加入时间线");
                return;
            }
            const created = await handleProjectAssetsInsert(payloads, projectAssetInsertPosition);
            created.forEach((node) => timelineAddNodeRef.current?.(node));
        },
        [handleProjectAssetsInsert, message, projectAssetInsertPosition, projectAssetScope],
    );

    const openProjectAssets = useCallback(
        (initialCategory = "all", position?: Position, scope: "canvas" | "timeline" = "canvas", initialFolderId = "all") => {
            setProjectAssetScope(scope);
            setProjectAssetInitialCategory(initialCategory);
            setProjectAssetInitialFolderId(initialFolderId);
            setProjectAssetInsertPosition(position);
            setProjectAssetOpen(true);
            // 资产与项目实时同步：打开弹窗前刷新关联短剧项目资产，避免缓存导致资产列表空白/过期。
            if (linkedProjectId) void refetchLinkedProject();
        },
        [linkedProjectId, refetchLinkedProject],
    );

    // 素材库打开入口：画布作用域（工具栏/空态/侧栏）与时间线作用域（时间线弹窗）分别标记插入目标。
    const openCanvasAssetLibrary = useCallback(
        (position?: Position) => {
            setAssetInsertScope("canvas");
            openAssetsAtPosition(position);
        },
        [openAssetsAtPosition],
    );
    const openTimelineAssetLibrary = useCallback(() => {
        setAssetInsertScope("timeline");
        openAssetsAtPosition();
    }, [openAssetsAtPosition]);
    const closeProjectAssets = useCallback(() => {
        setProjectAssetOpen(false);
        setProjectAssetInsertPosition(undefined);
        setProjectAssetInitialFolderId("all");
    }, []);

    const {
        angleNodeId,
        emotionNodeId,
        annotationNodeId,
        createImageReversePromptNodes,
        openPortraitTextureEditor,
        cropImageNode,
        cropNodeId,
        closeFrameDialog,
        closeSegmentDialog,
        extractAudioFromVideo,
        extractVideoFrames,
        extractingVideoFramesNodeId,
        frameDialogNodeId,
        generateAngleNode,
        generateEmotionNode,
        handleSegmentConfirm,
        maskEditImageNode,
        maskEditNodeId,
        mergeSelectedVideos,
        mergeVideosByIds,
        mergeVideoProgress,
        saveAnnotatedImageNode,
        segmentDialogMode,
        segmentDialogNodeId,
        segmentRunningMode,
        setFrameDialogNodeId,
        setSegmentDialogNodeId,
        setAngleNodeId,
        setEmotionNodeId,
        setAnnotationNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setSplitNodeId,
        setUpscaleNodeId,
        splitImageNode,
        splitNodeId,
        openVideoFrameExtractor,
        openVideoSegmentExtractor,
        upscaleImageNode,
        upscaleNodeId,
    } = useCanvasMediaTools({
        projectId,
        domainProjectId: linkedProjectId,
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

    const handleNodesDeleted = useCallback(
        (removedIds: Set<string>, nextNodes: CanvasNodeData[], removedNodes: CanvasNodeData[]) => {
            const clearDeletedId = (current: string | null) => (current && removedIds.has(current) ? null : current);
            setHoveredNodeId(clearDeletedId);
            setToolbarNodeId(clearDeletedId);
            setDialogNodeId(clearDeletedId);
            setTextEditorNodeId(clearDeletedId);
            setCharacterReferenceNodeId(clearDeletedId);
            setDrawingNodeId(clearDeletedId);
            setInfoNodeId(clearDeletedId);
            setSubtitleNodeId(clearDeletedId);
            setFrameDialogNodeId(clearDeletedId);
            setSegmentDialogNodeId(clearDeletedId);
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
            setPortraitClearanceNodeId(clearDeletedId);
            setDirectorNodeId(clearDeletedId);
            setVersionCompareRootId(clearDeletedId);
            setScriptScrollTopById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))));
            setContextMenu((current) => (current?.type === "node" && removedIds.has(current.nodeId) ? null : current));
            const removedDrawingIds = removedNodes.flatMap((node) => (node.type === CanvasNodeType.Drawing && node.metadata?.drawingId ? [node.metadata.drawingId] : []));
            if (removedDrawingIds.length) {
                void Promise.all(removedDrawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId))).catch(() => message.warning("绘图节点已删除，但本地绘图缓存清理失败"));
            }
            cleanupCanvasFiles({ projectId, nodes: nextNodes, chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, message, projectId, setAngleNodeId, setAnnotationNodeId, setCropNodeId, setEmotionNodeId, setFrameDialogNodeId, setMaskEditNodeId, setSegmentDialogNodeId, setSplitNodeId, setUpscaleNodeId, setRunningNodeId],
    );

    const {
        alignSelectedNodes,
        autoArrangeCanvasNodes,
        arrangeSelectedNodes,
        copyNodesToClipboard,
        copySelectedNodes,
        createFolder,
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
        getConnectionCreateDisabledReason,
        handleConnectStart,
        handleBatchConnectionTargetClick,
        batchConnectionPreview,
        beginBatchConnectionMode,
        startBatchConnection,
        mouseWorld,
        pendingConnectionCreate,
        setConnecting,
    } = useCanvasConnectionController({
        projectId,
        config: effectiveConfig,
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

    const batchSourceNodeIds = useMemo(() => nodes
        .filter((node) => selectedNodeIds.has(node.id) && !batchSourceRestriction(node))
        .map((node) => node.id), [nodes, selectedNodeIds]);

    const handleCanvasSelectionStart = useCallback(() => {
        setContextMenu(null);
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
            setDialogNodeId((current) => (current === node.id ? current : null));
        } else if (node.type === PORTRAIT_CLEARANCE_NODE_TYPE) {
            setDialogNodeId(null);
            setPortraitClearanceNodeId(node.id);
        } else {
            // 选择参考媒体时保留当前工作流配置面板，避免点击图片后配置“返回/消失”。
            // 没有工作流配置面板时，媒体节点仍按原逻辑打开自己的面板。
            setDialogNodeId((current) => {
                const currentNode = current ? nodesRef.current.find((item) => item.id === current) : undefined;
                return currentNode?.type === CanvasNodeType.Config ? current : node.id;
            });
        }
    }, [nodesRef]);

    const handleCanvasDeselect = useCallback(() => {
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
    }, []);

    const { alignmentGuides, cancelSelectionBox, deselectCanvas, dragPreview, frameDropTargetId, handleCanvasMouseDown, handleNodeMouseDown, isNodeDragging, nodeDraggingRef, selectionBoundsElementRef, selectionBox } = useCanvasSelectionController({
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
        onBatchConnectionTarget: handleBatchConnectionTargetClick,
        onLinkedFolderDrop: archiveNodesToLinkedFolder,
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
        handleFolderStyleChange,
        handleFolderThemeChange,
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
        canvasTitle: currentProject?.title || "未命名画布",
        domainProjectId: linkedProjectId,
        nodesRef,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setToolbarNodeId,
        setHoveredNodeId,
    });

    const handlePortraitClearanceStateUpdate = useCallback((nodeId: string, state: PortraitClearanceNodeState) => {
        handleConfigNodeChange(nodeId, { portraitClearance: state });
    }, [handleConfigNodeChange]);
    usePortraitClearanceCoordinator({ nodes, onUpdateState: handlePortraitClearanceStateUpdate });

    useEffect(() => {
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                if (node.type !== PORTRAIT_CLEARANCE_NODE_TYPE) return node;
                const state = node.metadata?.portraitClearance || createDefaultPortraitClearanceState();
                const inputBindings = reconcilePortraitClearanceInputBindings(node.metadata?.portraitClearance?.mode || state.mode, node.id, connections, current, state.inputBindings);
                if (JSON.stringify(inputBindings) === JSON.stringify(state.inputBindings) && node.metadata?.portraitClearance) return node;
                changed = true;
                return { ...node, metadata: { ...node.metadata, portraitClearance: { ...state, inputBindings } } };
            });
            return changed ? next : current;
        });
    }, [connections, setNodes]);

    const handleRemoveNodeReference = useCallback((targetNodeId: string, reference: CanvasResourceReference) => {
        const referenceNodeId = reference.nodeId;
        if (!referenceNodeId) return;
        // 生成节点可能通过配置节点接收参考，只移除参考来源边，保留目标到配置节点的主链。
        const configNodeId = connectionsRef.current.find((connection) => {
            if (connection.fromNodeId !== targetNodeId) return false;
            return nodesRef.current.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config;
        })?.toNodeId;
        const removedConnectionIds = new Set(
            connectionsRef.current
                .filter((connection) => connection.fromNodeId === referenceNodeId && (connection.toNodeId === targetNodeId || connection.toNodeId === configNodeId))
                .map((connection) => connection.id),
        );
        if (!removedConnectionIds.size) return;
        connectionsRef.current = connectionsRef.current.filter((connection) => !removedConnectionIds.has(connection.id));
        setConnections(connectionsRef.current);
        setSelectedConnectionId((current) => current && removedConnectionIds.has(current) ? null : current);
    }, [connectionsRef, nodesRef, setConnections, setSelectedConnectionId]);

    const handleProjectFolderInsert = useCallback((folderId: string) => {
        const folder = linkedProjectQuery.data?.assetFolders.find((item) => item.id === folderId);
        if (!folder || !linkedProjectId) throw new Error("素材文件夹已不存在，请刷新后重试");
        const style: CanvasFolderStyle = folder.style === "stacked" || folder.style === "midnight" || folder.style === "paper" || folder.style === "cinema" || folder.style === "compact" ? folder.style : "glass";
        const theme: CanvasFolderTheme = folder.theme === "obsidian" || folder.theme === "ember" || folder.theme === "pearl" ? folder.theme : "aurora";
        createFolder(projectAssetInsertPosition, { id: folder.id, projectId: linkedProjectId, title: folder.name, style, theme, createdAt: folder.createdAt });
    }, [createFolder, linkedProjectId, linkedProjectQuery.data?.assetFolders, projectAssetInsertPosition]);

    const handleFrameToggle = useCallback((nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const linkedFolderId = node?.metadata?.folder?.assetFolderId;
        if (linkedFolderId) {
            openProjectAssets("all", node ? { x: node.position.x + node.width + 40, y: node.position.y } : undefined, "canvas", linkedFolderId);
            return;
        }
        toggleFrameCollapsed(nodeId);
    }, [nodesRef, openProjectAssets, toggleFrameCollapsed]);

    const linkedFolderPreviewNodesById = useMemo(() => {
        const result = new Map<string, CanvasNodeData[]>();
        const localById = new Map(assets.map((asset) => [asset.id, asset]));
        for (const asset of linkedProjectQuery.data?.assets || []) {
            if (!asset.folderId) continue;
            const local = localById.get(asset.id);
            const characterCover = asset.character?.representations.find((item) => item.role === "turnaround_sheet") || asset.character?.representations.find((item) => item.role === "primary") || asset.character?.representations[0];
            const type = asset.category === "character" || asset.mediaType === "image" ? CanvasNodeType.Image : asset.mediaType === "video" ? CanvasNodeType.Video : asset.mediaType === "audio" ? CanvasNodeType.Audio : CanvasNodeType.Text;
            const remoteResourceId = resourceIdFromStorageKey(asset.storageKey);
            const content = characterCover ? resourceFileUrl(characterCover.resourceId) : local?.kind === "image" ? local.data.dataUrl || local.coverUrl : local?.kind === "video" || local?.kind === "audio" ? local.data.url : local?.kind === "text" ? local.data.content : remoteResourceId ? resourceFileUrl(remoteResourceId) : asset.previewText || "";
            const preview: CanvasNodeData = { id: asset.id, type, title: asset.title, position: { x: 0, y: 0 }, width: 240, height: 160, metadata: { assetId: asset.id, content } };
            const current = result.get(asset.folderId) || [];
            current.push(preview);
            result.set(asset.folderId, current);
        }
        return result;
    }, [assets, linkedProjectQuery.data?.assets]);

    useEffect(() => {
        const folders = linkedProjectQuery.data?.assetFolders;
        if (!folders?.length) return;
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                const folderId = node.metadata?.folder?.assetFolderId;
                const folder = folderId ? byId.get(folderId) : undefined;
                if (!folder) return node;
                const style: CanvasFolderStyle = folder.style === "stacked" || folder.style === "midnight" || folder.style === "paper" || folder.style === "cinema" || folder.style === "compact" ? folder.style : "glass";
                const theme: CanvasFolderTheme = folder.theme === "obsidian" || folder.theme === "ember" || folder.theme === "pearl" ? folder.theme : "aurora";
                if (node.title === folder.name && node.metadata?.folder?.style === style && node.metadata?.folder?.theme === theme) return node;
                changed = true;
                return { ...node, title: folder.name, metadata: { ...node.metadata, folder: { ...node.metadata!.folder!, style, theme, themeCover: undefined } } };
            });
            return changed ? next : current;
        });
    }, [linkedProjectQuery.data?.assetFolders, setNodes]);

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
    useEffect(() => {
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                const references = mentionReferencesByNodeId.get(node.id);
                const savedPrompt = node.metadata?.composerContent ?? node.metadata?.prompt;
                if (!references?.length || !savedPrompt?.includes("@[node:")) return node;
                const normalizedPrompt = normalizeCanvasNodeMentionTokens(savedPrompt, references);
                if (normalizedPrompt === savedPrompt) return node;
                changed = true;
                return {
                    ...node,
                    metadata: node.metadata?.composerContent !== undefined
                        ? { ...node.metadata, composerContent: normalizedPrompt }
                        : { ...node.metadata, prompt: normalizedPrompt },
                };
            });
            return changed ? next : current;
        });
    }, [mentionReferencesByNodeId, setNodes]);
    const dialogNode = dialogNodeId ? nodeById.get(dialogNodeId) || null : null;
    const subtitleNode = subtitleNodeId ? nodeById.get(subtitleNodeId) || null : null;
    const timelineNode = timelineNodeId ? nodeById.get(timelineNodeId) || null : null;
    const frameNode = frameDialogNodeId ? nodeById.get(frameDialogNodeId) || null : null;
    const segmentNode = segmentDialogNodeId ? nodeById.get(segmentDialogNodeId) || null : null;
    const textEditorNode = textEditorNodeId ? nodeById.get(textEditorNodeId) || null : null;
    const characterReferenceNode = characterReferenceNodeId ? nodeById.get(characterReferenceNodeId) || null : null;
    const drawingNode = drawingNodeId ? nodeById.get(drawingNodeId) || null : null;
    const portraitClearanceNode = portraitClearanceNodeId ? nodeById.get(portraitClearanceNodeId) || null : null;
    const portraitClearanceInputs = portraitClearanceNode
        ? connections
              .filter((connection) => connection.toNodeId === portraitClearanceNode.id)
              .sort((left, right) => left.id.localeCompare(right.id))
              .map((connection) => nodeById.get(connection.fromNodeId))
              .filter((node): node is CanvasNodeData => Boolean(node))
        : [];
    const addPortraitCandidateToCanvas = useCallback(async (candidate: { id: string; title: string; imageArtifactId: string }, dataUrl: string) => {
        const target = portraitClearanceNodeId ? nodesRef.current.find((node) => node.id === portraitClearanceNodeId) : undefined;
        if (!target) return;
        try {
            const image = await uploadImage(dataUrl);
            const created = createCanvasNode(CanvasNodeType.Image, { x: target.position.x + target.width + 260, y: target.position.y + target.height / 2 }, imageMetadata(image));
            created.title = candidate.title.slice(0, 80) || "肖像排查候选";
            const connection = { id: nanoid(), fromNodeId: created.id, toNodeId: target.id };
            setNodes((current) => [...current, created]);
            setConnections((current) => [...current, connection]);
            setSelectedNodeIds(new Set([created.id]));
            message.success("候选图片已添加到画布并连接到排查节点");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "候选图片添加失败");
        }
    }, [message, portraitClearanceNodeId, setConnections, setNodes, setSelectedNodeIds]);
    const pendingConnectionSourceNode = pendingConnectionCreate?.connection.handleType === "source" ? nodeById.get(pendingConnectionCreate.connection.nodeId) : null;
    const canCreateDrawingFromConnection = !pendingConnectionCreate?.batchSourceNodeIds?.length && pendingConnectionSourceNode?.type === CanvasNodeType.Image && Boolean(pendingConnectionSourceNode.metadata?.content);

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

    const openPortraitClearance = useCallback((node: CanvasNodeData) => {
        if (node.type !== PORTRAIT_CLEARANCE_NODE_TYPE) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        setPortraitClearanceNodeId(node.id);
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

    const { selectCanvasStyle, styleApplying } = useCanvasStyleWorkflow({
        domainProjectId: currentProject?.projectId,
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

    const shortDramaGuide = shortDramaEnabled && !currentProject?.projectId && shortDramaProgress.active ? { progress: shortDramaProgress, collapsed: shortDramaGuideCollapsed, onToggle: () => setShortDramaGuideCollapsed((value) => !value) } : undefined;

    const clearCanvas = useCallback(() => {
        const drawingIds = nodesRef.current.flatMap((node) => (node.type === CanvasNodeType.Drawing && node.metadata?.drawingId ? [node.metadata.drawingId] : []));
        if (drawingIds.length) {
            void Promise.all(drawingIds.map((drawingId) => removeCanvasDrawing(projectId, drawingId))).catch(() => message.warning("画布已清空，但部分本地绘图缓存清理失败"));
        }
        setNodes([]);
        setConnections([]);
        setTextEditorNodeId(null);
        setDrawingNodeId(null);
        setInfoNodeId(null);
        setSubtitleNodeId(null);
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
        onOpenSearch: () => setNodeSearchOpen(true),
        beginBatchConnection: () => beginBatchConnectionMode(Array.from(selectedNodeIdsRef.current)),
    });

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        chatSessionsRef.current = sessions;
        activeChatIdRef.current = activeId;
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
            const content = node?.metadata?.content?.trim();
            const resourceId = resourceIdFromStorageKey(node?.metadata?.storageKey);
            const copySource = content || (node?.type === CanvasNodeType.Image && resourceId ? resourceFileUrl(resourceId) : "");
            if (!node || !copySource) {
                message.warning("没有可复制的内容");
                return;
            }

            try {
                if (node.type === CanvasNodeType.Image) {
                    await copyImageToSystemClipboard(copySource);
                    message.success("图片已复制");
                    return;
                }

                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copySource);
                else if (!copyToClipboard(copySource)) throw new Error("当前浏览器不支持写入剪贴板");
                message.success(node.type === CanvasNodeType.Text ? "文本已复制" : "内容链接已复制");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "复制失败，请检查浏览器剪贴板权限");
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
                else if (!(await copyToClipboard(mediaURL))) throw new Error("当前浏览器不支持写入剪贴板");
                message.success(node?.type === CanvasNodeType.Video ? "视频地址已复制" : "图片地址已复制");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "媒体地址复制失败");
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const uploadNodeImageToArkPrivateAsset = useCallback(async (node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
            message.warning("请选择一张可用图片后再上传");
            return;
        }
        if (arkPrivateAssetUploadNodeId === node.id) return;
        const feedbackKey = `ark-private-asset-${node.id}`;
        setArkPrivateAssetUploadNodeId(node.id);
        message.loading({ key: feedbackKey, content: "正在保存并上传到方舟素材库...", duration: 0 });
        try {
            let resourceID = resourceIdFromStorageKey(node.metadata.storageKey);
            if (!resourceID) {
                const uploaded = await uploadImage(node.metadata.content);
                resourceID = resourceIdFromStorageKey(uploaded.storageKey);
                if (!resourceID) throw new Error("图片未能保存到系统素材库，请检查对象存储配置后重试");
                handleConfigNodeChange(node.id, imageMetadata(uploaded));
            }
            await syncResourceToArkPrivateAsset(resourceID);
            message.success({ key: feedbackKey, content: "已同步到方舟素材库，Seedance 将自动复用该素材", duration: 4 });
        } catch (error) {
            message.error({ key: feedbackKey, content: error instanceof Error ? error.message : "上传到方舟素材库失败", duration: 5 });
        } finally {
            setArkPrivateAssetUploadNodeId((current) => current === node.id ? null : current);
        }
    }, [arkPrivateAssetUploadNodeId, handleConfigNodeChange, message]);

    const confirmUploadNodeImageToArkPrivateAsset = useCallback((node: CanvasNodeData) => {
        Modal.confirm({
            title: "上传到方舟素材库",
            content: "仅可上传你拥有肖像、版权或其他合法使用权的图片。方舟审核通过后，Seedance 会使用受控素材标识生成视频。",
            okText: "确认拥有使用权并上传",
            cancelText: "取消",
            onOk: () => uploadNodeImageToArkPrivateAsset(node),
        });
    }, [uploadNodeImageToArkPrivateAsset]);

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

    const handleNodeContextMenu = useCallback(
        (event: ReactMouseEvent, id: string) => {
            event.preventDefault();
            event.stopPropagation();
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            closeConnectionCreateMenu();
            setToolbarNodeId(null);
            setDialogNodeId(null);
            setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
        },
        [closeConnectionCreateMenu],
    );

    const handleGenerateNode = useCanvasGenerationExecutor({
        projectId,
        domainProjectId: currentProject?.projectId,
        addedSkills,
        assets,
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
        applyGenerationTaskResult,
    });
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const { enqueueGenerationBatch, retryFailedBatchItems, stopRemainingBatchItems } = useCanvasGenerationBatches({
        projectId,
        projectLoaded,
        nodes,
        nodesRef,
        setNodes,
        handleGenerateNode,
    });

    const { addScriptRow, createAndGenerateScriptVideos, createScriptActionBoards, createScriptImageNodes, createScriptVideoNodes, generateScriptImages, generateScriptRows, generateScriptVideos, removeScriptRow, replaceScriptRows, updateScriptRow } =
        useCanvasStoryboard({
            projectId,
            addedSkills,
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
        assets,
        nodesRef,
        connectionsRef,
        setNodes,
        setRunningNodeId,
        startGenerationRequest,
        finishGenerationRequest,
        bindGenerationTask,
        applyGenerationTaskResult,
    });
    const reloadCanvasNodeResource = useCallback(
        async (node: CanvasNodeData) => {
            const taskId = node.metadata?.taskId;
            if (!taskId || !node.metadata?.resourceReloadAvailable) return;
            setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: "loading", taskStage: "正在重新加载资源", errorDetails: undefined } } : item)));
            try {
                const task = await queryGenerationTask(taskId);
                if (task.status !== "succeeded") throw new Error("原生成任务尚未成功，无法重新加载资源");
                await applyGenerationTaskResult(node.id, task);
            } catch (error) {
                setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: "error", errorDetails: error instanceof Error ? error.message : "资源重新加载失败", resourceReloadAvailable: true } } : item)));
            }
        },
        [applyGenerationTaskResult, setNodes],
    );
    const reconcileImageBatchRootNode = useCallback((rootId: string) => {
        setNodes((current) => {
            const root = current.find((item) => item.id === rootId);
            if (!root) return current;
            const reconciled = reconcileImageBatchRoot(root, current);
            return current.map((item) => item.id === root.id ? reconciled : item);
        });
    }, [setNodes]);
    const retryImageBatchChildren = useCallback((rootId: string, children: CanvasNodeData[]) => {
        const childIds = children.map((child) => child.id);
        setNodes((current) => markImageBatchRetrying(rootId, childIds, current));
        void Promise.allSettled(children.map(async (child) => {
            await handleRetryNode(child);
            setNodes((current) => current.map((item) => item.id === child.id ? restoreUnsubmittedImageBatchChild(item, child) : item));
        })).finally(() => reconcileImageBatchRootNode(rootId));
    }, [handleRetryNode, reconcileImageBatchRootNode, setNodes]);

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
                    prompt: "@文本1",
                    composerContent: "@文本1",
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
                    onRemoveReference={handleRemoveNodeReference}
                    onClose={() => setDialogNodeId(null)}
                    onNodeMouseDown={handleNodeMouseDown}
                    workspaceMode={workspaceMode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            );
        },
        [configInputsById, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, handleRemoveNodeReference, mentionReferencesByNodeId, runningNodeId, skillMentionReferences, workspaceMode],
    );

    const renderCanvasNodeContent = useCallback(
        (contentNode: CanvasNodeData) => {
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
                return (
                    <CanvasScriptNodeContent
                        node={contentNode}
                        nodes={nodesRef.current}
                        batch={visibleGenerationBatch(contentNode)}
                        pipeline={pipeline}
                        scale={viewport.k}
                        mentionReferences={mentionReferencesByNodeId.get(contentNode.id) || EMPTY_RESOURCE_REFERENCES}
                        onOpen={() => setScriptEditorNodeId(contentNode.id)}
                        onCreateImageNodes={() => createScriptImageNodes(contentNode.id)}
                        onCreateVideoNodes={() => createScriptVideoNodes(contentNode.id)}
                        onGenerateImages={(rowIds) => void generateScriptImages(contentNode.id, rowIds)}
                        onGenerateVideos={(rowIds) => (contentNode.metadata?.storyboardVideoInputMode === "keyframe" ? void generateScriptVideos(contentNode.id, rowIds) : void createAndGenerateScriptVideos(contentNode.id, rowIds))}
                        onVideoInputModeChange={(storyboardVideoInputMode) => handleConfigNodeChange(contentNode.id, { storyboardVideoInputMode })}
                        onMergeVideos={() => void mergeVideosByIds(pipeline.successfulVideoNodeIds)}
                        onCreateActionBoards={() => void createScriptActionBoards(contentNode.id)}
                        onRetryBatch={(batchId) => retryFailedBatchItems(contentNode.id, batchId)}
                        onRetryBatchItem={(batchId, itemId) => retryFailedBatchItems(contentNode.id, batchId, itemId)}
                        onStopBatch={(batchId) => stopRemainingBatchItems(contentNode.id, batchId)}
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
                        onScrollTopChange={(scrollTop) => setScriptScrollTopById((current) => (current[contentNode.id] === scrollTop ? current : { ...current, [contentNode.id]: scrollTop }))}
                    />
                );
            }
            if (contentNode.metadata?.directorSceneId) {
                return (
                    <CanvasDirectorNodePanel
                        node={contentNode}
                        scene={currentProject?.directorScenes?.find((scene) => scene.id === contentNode.metadata?.directorSceneId) || null}
                        readNodeContent={(nodeId) => (nodeId ? nodesRef.current.find((item) => item.id === nodeId)?.metadata?.content : undefined)}
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
                    onGenerate={(nodeId) => {
                        const target = nodesRef.current.find((item) => item.id === nodeId);
                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                    }}
                    workspaceMode={workspaceMode}
                />
            );
        },
        [
            addScriptRow,
            configInputsById,
            createAndGenerateScriptVideos,
            createScriptActionBoards,
            createScriptImageNodes,
            createScriptVideoNodes,
            currentProject?.directorScenes,
            generateScriptImages,
            generateScriptRows,
            generateScriptVideos,
            handleConfigNodeChange,
            handleConnectStart,
            handleGenerateNode,
            handleNodeResize,
            mentionReferencesByNodeId,
            mergeVideosByIds,
            openDirectorWorkbench,
            openStoryInput,
            removeScriptRow,
            retryFailedBatchItems,
            runningNodeId,
            stopRemainingBatchItems,
            updateScriptRow,
            viewport.k,
            workspaceMode,
        ],
    );

    const handleCanvasNodeHoverStart = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current) return;
            setHoveredNodeId(nodeId);
            keepNodeToolbar(nodeId);
        },
        [keepNodeToolbar],
    );
    const handleCanvasNodeHoverEnd = useCallback(
        (nodeId: string) => {
            setHoveredNodeId((current) => (current === nodeId ? null : current));
            hideNodeToolbar();
        },
        [hideNodeToolbar],
    );
    const retryCanvasNode = useCallback(
        (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Script) {
                const prompt = (node.metadata?.composerContent || node.metadata?.prompt || "").trim();
                if (!prompt) {
                    message.warning("分镜脚本缺少剧情内容，无法重试");
                    return;
                }
                void generateScriptRows(node.id, prompt);
                return;
            }
            if (node.type === CanvasNodeType.Image && node.metadata?.isBatchRoot) {
                const failedChildren = failedImageBatchChildren(node, nodesRef.current);
                if (!failedChildren.length) {
                    message.info("当前批次没有需要重试的失败图片");
                    return;
                }
                message.info(`正在重试 ${failedChildren.length} 个失败图片`);
                retryImageBatchChildren(node.id, failedChildren);
                return;
            }
            if (node.type === CanvasNodeType.Image && node.metadata?.batchRootId) {
                retryImageBatchChildren(node.metadata.batchRootId, [node]);
                return;
            }
            void handleRetryNode(node);
        },
        [generateScriptRows, handleRetryNode, message, nodesRef, retryImageBatchChildren],
    );
    const openCanvasNodeTaskDetails = useCallback(
        (node: CanvasNodeData) => {
            void openNodeTaskDetails(node);
        },
        [openNodeTaskDetails],
    );
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
    const freeformCreateCommands = useCanvasCreateCommands({
        workspaceMode,
        isProjectLinked: Boolean(shortDramaEnabled && currentProject?.projectId),
        handlers: {
            onAddText: () => createNode(CanvasNodeType.Text),
            onAddImage: () => createNode(CanvasNodeType.Image),
            onAddVideo: () => createNode(CanvasNodeType.Video),
            onAddAudio: () => createNode(CanvasNodeType.Audio),
            onAddScript: () => createNode(CanvasNodeType.Script),
            onAddFrame: () => createNode(CanvasNodeType.Frame),
            onAddFolder: createFolder,
            onAddDrawing: () => createNode(CanvasNodeType.Drawing),
            onAddWorkflow: () => createNode(CanvasNodeType.Config),
            onAddExtensionNode: (type) => createNode(type),
            onChooseStyle: () => setStylePickerOpen(true),
            onOpenDirector: () => setDirectorTemplateRequest({}),
            onUpload: () => handleUploadRequest(),
            onOpenMyAssets: () => openCanvasAssetLibrary(),
            onOpenProjectCharacters: () => openProjectAssets("character"),
        },
    });
    const emptyStateKind = resolveCanvasEmptyStateKind({
        nodeCount: nodes.length,
        shortDramaEnabled,
        isProjectLinked: Boolean(currentProject?.projectId),
        starterMode: currentProject?.starterMode,
    });
    const emptyCanvasState = emptyStateKind === "freeform" ? (
        <CanvasFreeformEmptyState commands={freeformCreateCommands} />
    ) : emptyStateKind === "linked" ? (
        <CanvasLinkedProjectEmptyState
            projectName={linkedProjectQuery.data?.project.name || currentProject?.title || "项目画布"}
            hasChapter={Boolean(linkedProjectQuery.data?.units.length)}
            onAddFirstChapter={() => {
                const first = linkedProjectQuery.data?.units.slice().sort((left, right) => left.position - right.position)[0];
                if (first) void handleProjectChapterInsert({ id: first.id, projectId: linkedProjectId, title: first.title, position: first.position });
            }}
            onOpenAssets={() => openProjectAssets()}
            onAddText={() => createNode(CanvasNodeType.Text)}
        />
    ) : emptyStateKind === "guided" ? (
        <CanvasShortDramaEmptyState
            onCreatePipeline={createShortDramaPipeline}
            onOpenAgent={() => {
                setCinematicAgentEntry(true);
                setAgentMode("online");
                openAgent("online");
            }}
            onStartFreeform={() => updateProject(projectId, { starterMode: "freeform" })}
            onUpload={() => handleUploadRequest()}
            onAddText={() => createNode(CanvasNodeType.Text)}
            onAddScript={() => createNode(CanvasNodeType.Script)}
        />
    ) : null;
    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <>
            <a
                href="#canvas-main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-md focus:border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
            >
                跳转到画布主内容
            </a>
            <main id="canvas-main" tabIndex={-1} className="flex h-full min-h-0 overflow-hidden outline-none" style={{ background: resolvedCanvasAppearance.background, color: theme.node.text }}>
                {!focusMode && shortDramaEnabled && currentProject?.projectId ? (
                    <CanvasProjectSidebar projectId={currentProject.projectId} detail={linkedProjectQuery.data} onAddChapter={handleProjectChapterInsert} onLocateStyle={locateProjectStyleNode} onOpenAssets={() => openProjectAssets()} />
                ) : null}
                <CanvasOverlayLayerProvider>
                    <section className="relative min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden">
                    {!focusMode ? (
                        <CanvasTopBar
                            title={currentProject?.title || "未命名画布"}
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
                            onImportLibTV={() => setLibTVImportOpen(true)}
                            onImportTapNow={() => setTapNowImportOpen(true)}
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
                            projectContext={
                                shortDramaEnabled && currentProject?.projectId
                                    ? {
                                          ...canvasContext,
                                          projectId: currentProject.projectId,
                                          projectName: linkedProjectQuery.data?.project.name || currentProject.title,
                                      }
                                    : undefined
                            }
                            onEnterFocusMode={enterFocusMode}
                            shortDramaGuide={shortDramaGuide}
                        />
                    ) : null}

                    {!focusMode ? (
                        <div
                            data-canvas-no-zoom
                            className="pointer-events-none absolute bottom-[calc(var(--canvas-inset-y)+var(--space-16))] z-[var(--z-toolbar)] transition-[right,bottom] duration-300 lg:bottom-[var(--canvas-inset-y)]"
                            style={{ right: assistantMounted ? `calc(var(--canvas-inset-x) + ${assistantWidth}px + var(--space-3))` : "var(--canvas-inset-x)" }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <CanvasWorkspaceModeSwitch mode={workspaceMode} onChange={setWorkspaceMode} />
                        </div>
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

                    {!focusMode && shortDramaGuide ? (
                        <CanvasShortDramaGuide progress={shortDramaGuide.progress} collapsed={shortDramaGuide.collapsed} onToggle={shortDramaGuide.onToggle} onSkip={skipShortDramaGuide} onStepClick={activateShortDramaStep} />
                    ) : null}

                    <CanvasShareModal projectId={projectId} open={shareModalOpen} onClose={() => setShareModalOpen(false)} beforeCreate={saveCanvasProject} />
                    <LibTVImportDialog open={libTVImportOpen} projectId={projectId} viewport={viewport} viewportSize={size} onClose={() => setLibTVImportOpen(false)} onApply={applyLibTVImport} />
                    <TapNowImportDialog open={tapNowImportOpen} projectId={projectId} viewport={viewport} viewportSize={size} onClose={() => setTapNowImportOpen(false)} onApply={applyTapNowImport} />

                    <CanvasStylePickerModal open={stylePickerOpen} value={activeStylePresetId} applying={styleApplying} onClose={() => setStylePickerOpen(false)} onSelect={selectCanvasStyle} />

                    <CanvasDirectorTemplateModal
                        open={Boolean(directorTemplateRequest)}
                        onClose={() => setDirectorTemplateRequest(null)}
                        onSelect={(templateId) => createDirectorShot(templateId, directorTemplateRequest?.position)}
                    />

                    <div className="relative flex min-h-0 min-w-0 flex-1">
                        <div className="relative min-w-0 flex-1 overflow-hidden">
                            <InfiniteCanvas
                                containerRef={containerRef}
                                viewport={viewport}
                                appearance={canvasAppearance}
                                backgroundMode={backgroundMode}
                                graphicsLayer={
                                    <CanvasLeaferGraphicsLayer
                                        containerRef={containerRef}
                                        viewport={viewport}
                                        theme={theme}
                                        displayConnections={displayConnections}
                                        selectedConnectionId={selectedConnectionId}
                                        relatedConnectionIds={relatedHighlight.connectionIds}
                                        scriptScrollTopById={scriptScrollTopById}
                                        connectingParams={connectingParams}
                                        batchConnectionPreview={batchConnectionPreview}
                                        mouseWorld={mouseWorld}
                                        connectionTargetNodeId={connectionTargetNodeId}
                                        connectionTargetAnchorRatio={connectionTargetAnchorRatio}
                                        nodeById={nodeById}
                                        selectionBox={selectionBox}
                                        selectedNodeBounds={selectedNodeBounds}
                                        alignmentGuides={alignmentGuides}
                                    />
                                }
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
                                <CanvasNodeActionContext.Provider value={{ download: downloadNodeImage, duplicate: (node) => duplicateNode(node.id), deleteNode: (node) => deleteNodes(new Set([node.id])), updateMetadata: (nodeId, patch) => setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node))), resizeNode: (nodeId, size) => setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, width: size.width, height: size.height } : node))), openPortraitClearance }}>
                                <CanvasNodeGraphContext.Provider value={nodeGraphContext}>
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
                                    linkedFolderPreviewNodesById={linkedFolderPreviewNodesById}
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
                                    batchSourceNodeIds={batchSourceNodeIds}
                                    batchConnectionPreview={batchConnectionPreview}
                                    isNodeDragging={isNodeDragging}
                                    selectionBoundsElementRef={selectionBoundsElementRef}
                                    renderCanvasNodeContent={renderCanvasNodeContent}
                                    onConnectionSelect={(connectionId) => {
                                        setSelectedConnectionId(connectionId);
                                        setSelectedNodeIds(new Set());
                                        setContextMenu(null);
                                    }}
                                    onConnectionContextMenu={(event, connectionId) => {
                                        setSelectedConnectionId(connectionId);
                                        setSelectedNodeIds(new Set());
                                        closeConnectionCreateMenu();
                                        setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId });
                                    }}
                                    onNodeMouseDown={handleNodeMouseDown}
                                    onNodeHoverStart={handleCanvasNodeHoverStart}
                                    onNodeHoverEnd={handleCanvasNodeHoverEnd}
                                    onConnectStart={handleConnectStart}
                                    onNodeResize={handleNodeResize}
                                    onToggleFrame={handleFrameToggle}
                                    onFolderStyleChange={handleFolderStyleChange}
                                    onFolderThemeChange={handleFolderThemeChange}
                                    onNodeTitleChange={handleNodeTitleChange}
                                    onNodeContextMenu={handleNodeContextMenu}
                                    onNodeContentChange={handleNodeContentChange}
                                    onToggleBatch={toggleBatchExpanded}
                                    onSetBatchPrimary={setBatchPrimary}
                                    onRetry={retryCanvasNode}
                                    onReloadResource={reloadCanvasNodeResource}
                                    onOpenTaskDetails={openCanvasNodeTaskDetails}
                                    onOpenVersions={openCanvasNodeVersions}
                                    onViewImage={viewCanvasNodeImage}
                                    onReplaceMedia={replaceCanvasNodeMedia}
                                    onOpenTextEditor={openTextNodeEditor}
                                    onOpenDirector={editCanvasDirector}
                                    onOpenDrawing={openDrawingNode}
                                    onStartBatchConnection={startBatchConnection}
                                />
                                </CanvasNodeGraphContext.Provider>
                                </CanvasNodeActionContext.Provider>
                            </InfiniteCanvas>

                            <CanvasActiveTaskPanel tasks={activeTasks} onCancelTask={cancelCanvasTask} topInset={focusMode ? "var(--space-3)" : "var(--canvas-topbar-offset)"} />

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
                                    onFit={fitCanvasContent}
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
                                    appearance={canvasAppearance}
                                    backgroundMode={backgroundMode}
                                    showImageInfo={showImageInfo}
                                    onAddImage={() => createNode(CanvasNodeType.Image)}
                                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                                    onAddText={() => createNode(CanvasNodeType.Text)}
                                    onChooseStyle={() => setStylePickerOpen(true)}
                                    onAddScript={() => createNode(CanvasNodeType.Script)}
                                    onAddFrame={() => createNode(CanvasNodeType.Frame)}
                                    onAddFolder={createFolder}
                                    onAddDrawing={() => createNode(CanvasNodeType.Drawing)}
                                    onAddExtensionNode={(type) => createNode(type)}
                                    onAddWorkflow={() => createNode(CanvasNodeType.Config)}
                                    onOpenDirector={() => setDirectorTemplateRequest({})}
                                    onUndo={undoCanvas}
                                    onRedo={redoCanvas}
                                    onUpload={() => handleUploadRequest()}
                                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                                    onClear={() => setClearConfirmOpen(true)}
                                    onDeselect={deselectCanvas}
                                    onAppearanceChange={applyCanvasAppearance}
                                    onSaveAppearanceDefault={saveCanvasAppearanceDefault}
                                    onBackgroundModeChange={setBackgroundMode}
                                    onShowImageInfoChange={setShowImageInfo}
                                    onOpenMyAssets={() => {
                                        openCanvasAssetLibrary();
                                    }}
                                    onOpenProjectCharacters={() => openProjectAssets("character")}
                                />
                            ) : null}
                        </div>

                        {assistantMounted ? (
                            <AssistantPanelColumn width={assistantWidth} closing={assistantClosing} topInset={focusMode ? "0px" : "var(--canvas-topbar-offset)"} onWidthChange={setAssistantWidth}>
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
                        <CanvasNodePanelOverlay
                            node={angleNode}
                            viewport={viewport}
                            containerRef={containerRef}
                            panelWidth={580}
                            panelHeight={350}
                            dragOffset={dragPreview?.nodeIds.has(angleNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                            isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(angleNode.id))}
                        >
                            <CanvasNodeAnglePanel
                                dataUrl={angleNode.metadata.content}
                                onClose={() => setAngleNodeId(null)}
                                onConfirm={(params) => {
                                    void generateAngleNode(angleNode, params);
                                }}
                            />
                        </CanvasNodePanelOverlay>
                    ) : null}

                    {emotionNode?.metadata?.content ? (
                        <CanvasEmotionWorkspace
                            node={emotionNode}
                            viewport={viewport}
                            containerRef={containerRef}
                            dragOffset={dragPreview?.nodeIds.has(emotionNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                            isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(emotionNode.id))}
                            onClose={() => setEmotionNodeId(null)}
                            onConfirm={(payload: CanvasImageEmotionPayload) => {
                                void generateEmotionNode(emotionNode, payload);
                            }}
                        />
                    ) : null}

                    {dialogNode && dialogNode.type !== CanvasNodeType.Script && dialogNode.type !== CanvasNodeType.Drawing && !selectionBox ? (
                        <CanvasNodePanelOverlay
                            node={dialogNode}
                            viewport={viewport}
                            containerRef={containerRef}
                            dragOffset={dragPreview?.nodeIds.has(dialogNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                            isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(dialogNode.id))}
                        >
                            {renderCanvasNodePanel(dialogNode)}
                        </CanvasNodePanelOverlay>
                    ) : null}

                    {pendingConnectionCreate ? (
                        <CanvasConnectionCreateMenu
                            pending={pendingConnectionCreate}
                            viewport={viewport}
                            viewportSize={size}
                            containerRef={containerRef}
                            canCreateDrawing={canCreateDrawingFromConnection}
                            getDisabledReason={(type) => getConnectionCreateDisabledReason(type, pendingConnectionCreate)}
                            onCreate={(type) => void createConnectedNode(type, pendingConnectionCreate)}
                            onClose={cancelPendingConnectionCreate}
                        />
                    ) : null}

                    {selectedNodeBounds && !selectionBox && !isNodeDragging ? (
                        <CanvasProjectSelectionToolbar
                            anchorRef={selectionBoundsElementRef}
                            containerRef={containerRef}
                            count={selectedNodeBounds.count}
                            selectedVideoCount={selectedVideoNodes.length}
                            mergingVideos={Boolean(mergeVideoProgress)}
                            onAlign={alignSelectedNodes}
                            onArrange={arrangeSelectedNodes}
                            onCreateStoryboard={createStoryboardGroup}
                            onCreateReferenceGroup={createReferenceGroup}
                            onBatchConnect={() => beginBatchConnectionMode(Array.from(selectedNodeIds))}
                            onMergeVideos={() => void mergeSelectedVideos()}
                        />
                    ) : null}

                    {uploadStatus ? <CanvasUploadStatusToast status={uploadStatus} theme={theme} /> : null}
                    {mergeVideoProgress ? <CanvasMergeStatusToast progress={mergeVideoProgress} theme={theme} /> : null}
                    {lastAgentChange ? (
                        <CanvasAgentChangeToast
                            change={lastAgentChange}
                            theme={theme}
                            onView={viewLastAgentChange}
                            onUndo={() => {
                                undoAgentOps();
                            }}
                            onClose={dismissLastAgentChange}
                        />
                    ) : null}

                    <CanvasNodeToolbar
                        node={isNodeDragging || nodeImageSettingsOpen || emotionNodeId ? null : toolbarNode}
                        workspaceMode={workspaceMode}
                        viewport={viewport}
                        containerRef={containerRef}
                        onKeep={keepNodeToolbar}
                        onLeave={hideNodeToolbar}
                        onInfo={(node) => (node.metadata?.workflowKind === "character" && node.metadata.characterAssetId ? openTextNodeEditor(node) : setInfoNodeId(node.id))}
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
                        onEmotion={(node) => {
                            setDialogNodeId(null);
                            setEmotionNodeId((current) => (current === node.id ? null : node.id));
                        }}
                        onPortraitTexture={openPortraitTextureEditor}
                        onCrop={(node) => setCropNodeId(node.id)}
                        onSplit={(node) => setSplitNodeId(node.id)}
                        onUpscale={(node) => setUpscaleNodeId(node.id)}
                        onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                        onAngle={(node) => {
                            setDialogNodeId(null);
                            setAngleNodeId((current) => (current === node.id ? null : node.id));
                        }}
                        onViewImage={(node) => setPreviewNodeId(node.id)}
                        onExtractVideoFrames={openVideoFrameExtractor}
                        onExtractAudioFromVideo={(node) => void extractAudioFromVideo(node)}
                        onTrimVideoSegments={openVideoSegmentExtractor}
                        onSubtitles={(node) => setSubtitleNodeId(node.id)}
                        onTimeline={(node) => setTimelineNodeId(node.id)}
                        extractingVideoFrames={toolbarNode?.id === extractingVideoFramesNodeId}
                        extractingAudio={segmentRunningMode === "audio"}
                        trimmingVideo={segmentRunningMode === "video"}
                        onReversePrompt={createImageReversePromptNodes}
                        onRetry={retryCanvasNode}
                        onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                        onToggleLocked={(node) => toggleNodeLocked(node.id)}
                        onDelete={(node) => deleteNodes(new Set([node.id]))}
                    />

                    {isMiniMapOpen && !focusMode ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} canvasContainerRef={containerRef} onViewportPreviewChange={previewViewport} onViewportChange={handleViewportChange} /> : null}

                    {!focusMode ? (
                        <CanvasOverlayLayerContainer
                            overlayId="asset-tray"
                            fallbackZIndex="var(--z-panel)"
                            className="absolute bottom-[calc(var(--canvas-inset-y)+var(--space-16))] left-[var(--canvas-inset-x)] flex items-end gap-2 lg:bottom-[var(--canvas-inset-y)]"
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <CanvasZoomControls
                                scale={viewport.k}
                                containerRef={containerRef}
                                onScaleChange={setZoomScale}
                                onFitContent={fitCanvasContent}
                                onAutoArrange={autoArrangeCanvasNodes}
                                isMiniMapOpen={isMiniMapOpen}
                                onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}
                                onOpenShortcuts={() => setShortcutRequestNonce((value) => value + 1)}
                            />
                            <CanvasAssetTray
                                assetImages={imageAssets}
                                canvasImages={canvasImageNodes}
                                showLibrary={!currentProject?.projectId}
                                activeNodeId={selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null}
                                onInsertAssetImage={(asset) => void createImageAssetNode(asset)}
                                onFocusCanvasImage={focusCanvasImageNode}
                            />
                        </CanvasOverlayLayerContainer>
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
                        onAddFolder={createFolder}
                        onChooseStyle={() => setStylePickerOpen(true)}
                        onOpenDirector={(position) => setDirectorTemplateRequest({ position })}
                        onUpload={(nodeId, position) => handleUploadRequest(nodeId, position)}
                        onOpenAssets={openCanvasAssetLibrary}
                        onOpenProjectCharacters={(position) => openProjectAssets("character", position)}
                        onUndo={undoCanvas}
                        onRedo={redoCanvas}
                        onPaste={pasteAtPosition}
                        onCopyNode={(nodeId) => copyNodesToClipboard(new Set([nodeId]))}
                        onDuplicate={duplicateNode}
                        onDeleteNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                        onDeleteConnection={deleteConnection}
                        onSaveAsset={(node) => {
                            void saveNodeAsset(node);
                        }}
                        onViewMedia={(node) => setPreviewNodeId(node.id)}
                        onEditText={openTextNodeEditor}
                        onOpenDrawing={openDrawingNode}
                        onGenerateImage={generateImageFromTextNode}
                        onCopyContent={(node) => {
                            void copyNodeContentToClipboard(node);
                        }}
                        onCopyMediaUrl={(node) => {
                            void copyNodeMediaUrlToClipboard(node);
                        }}
                        onUploadToArkPrivateAsset={confirmUploadNodeImageToArkPrivateAsset}
                        onSetAssetCategory={(nodeId, assetCategory) => handleConfigNodeChange(nodeId, { assetCategory })}
                        onToggleFrame={(node) => handleFrameToggle(node.id)}
                    />

                    <CanvasUploadModal open={uploadModalOpen} onClose={closeUploadModal} onUpload={handleUploadFiles} />

                    <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                    <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} onMetadataChange={handleConfigNodeChange} />

                    {subtitleNode ? (
                        <CanvasSubtitleDialog
                            node={subtitleNode}
                            open={Boolean(subtitleNode)}
                            projectId={projectId}
                            config={effectiveConfig}
                            onClose={() => setSubtitleNodeId(null)}
                            onSave={(nodeId, patch) => {
                                handleConfigNodeChange(nodeId, patch);
                                const currentTimeline = currentProject?.timeline;
                                if (currentTimeline) {
                                    const next = syncNodeSubtitlesToTimeline(currentTimeline, nodeId, patch.subtitleEntries || []);
                                    if (next !== currentTimeline) updateProject(projectId, { timeline: next });
                                }
                            }}
                        />
                    ) : null}

                    {frameNode ? (
                        <CanvasVideoFrameDialog
                            node={frameNode}
                            open={Boolean(frameNode)}
                            onClose={closeFrameDialog}
                            onConfirm={(params) => void extractVideoFrames(frameNode, params)}
                        />
                    ) : null}

                    {segmentNode && segmentDialogMode ? (
                        <CanvasVideoSegmentDialog
                            node={segmentNode}
                            nodes={nodes}
                            connections={connections}
                            open={Boolean(segmentNode && segmentDialogMode)}
                            mode={segmentDialogMode}
                            config={effectiveConfig}
                            timeline={currentProject?.timeline || null}
                            onClose={closeSegmentDialog}
                            onConfirm={(params) => void handleSegmentConfirm(segmentNode, params)}
                        />
                    ) : null}

                    {timelineNode ? (
                        <CanvasTimelineDialog
                            node={timelineNode}
                            open={Boolean(timelineNode)}
                            nodes={nodes}
                            timeline={currentProject?.timeline || null}
                            onClose={() => setTimelineNodeId(null)}
                            onOpenSubtitleDialog={(subNodeId) => {
                                setTimelineNodeId(null);
                                setSubtitleNodeId(subNodeId);
                            }}
                            onSave={(next) => updateProject(projectId, { timeline: next })}
                            onSaveSubtitles={(subNodeId, entries) =>
                                handleConfigNodeChange(subNodeId, {
                                    subtitleEntries: entries,
                                    ...(entries.length ? {} : { subtitleHighlights: [] }),
                                    subtitleUpdatedAt: new Date().toISOString(),
                                })
                            }
                            onOpenAssetLibrary={openTimelineAssetLibrary}
                            onOpenProjectAssets={() => openProjectAssets("all", undefined, "timeline")}
                            onUploadLocalFiles={uploadTimelineMedia}
                            addNodeToTimelineRef={timelineAddNodeRef}
                            addMediaToTimelineRef={timelineMediaAddRef}
                            onCreateAssembledNode={createVideoNodeFromBlob}
                        />
                    ) : null}

                    <CanvasCharacterReferenceModal node={characterReferenceNode} open={Boolean(characterReferenceNode)} onClose={() => setCharacterReferenceNodeId(null)} />

                    <CanvasTextEditorModal
                        node={textEditorNode}
                        open={Boolean(textEditorNode)}
                        onClose={() => setTextEditorNodeId(null)}
                        onSave={(nodeId, title, content, richText) => {
                            setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, title, metadata: { ...node.metadata, content, richText } } : node)));
                        }}
                    />

                    {drawingNode ? (
                        <Suspense
                            fallback={
                                <div className="fixed inset-0 z-[var(--z-toast)] grid place-items-center px-5" style={{ background: theme.canvas.background, color: theme.node.text }}>
                                    <WorkspaceState icon="loading" title="正在加载绘图编辑器" description="正在准备绘图画布。" />
                                </div>
                            }
                        >
                            <CanvasDrawingEditorModal
                                node={drawingNode}
                                projectId={projectId}
                                open={Boolean(drawingNode)}
                                onClose={() => setDrawingNodeId(null)}
                                onSaved={(nodeId, summary) => {
                                    setNodes((current) =>
                                        current.map((node) =>
                                            node.id === nodeId
                                                ? {
                                                      ...node,
                                                      metadata: {
                                                          ...node.metadata,
                                                          drawingEngine: summary.engine,
                                                          drawingRevision: summary.revision,
                                                          drawingUpdatedAt: summary.updatedAt,
                                                          drawingShapeCount: summary.shapeCount,
                                                          drawingPageCount: summary.pageCount,
                                                      },
                                                  }
                                                : node,
                                        ),
                                    );
                                    message.success("绘图已保存");
                                }}
                            />
                        </Suspense>
                    ) : null}

                        <PortraitClearanceModal
                            projectId={projectId}
                            node={portraitClearanceNode}
                        upstreamNodes={portraitClearanceInputs}
                        open={Boolean(portraitClearanceNode)}
                        onClose={() => setPortraitClearanceNodeId(null)}
                        onUpdateState={(nodeId, state: PortraitClearanceNodeState) => handleConfigNodeChange(nodeId, { portraitClearance: state })}
                        onAddCandidate={addPortraitCandidateToCanvas}
                    />

                    <CanvasScriptEditor
                        node={activeScriptNode}
                        nodes={nodes}
                        open={Boolean(activeScriptNode)}
                        onClose={() => setScriptEditorNodeId(null)}
                        onUpdateRows={(rows) => activeScriptNode && replaceScriptRows(activeScriptNode.id, rows)}
                        onVisibleColumnsChange={(visibleColumns: StoryboardColumn[]) => {
                            if (!activeScriptNode || !visibleColumns.length) return;
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === activeScriptNode.id
                                        ? { ...node, metadata: { ...node.metadata, storyboard: { rows: node.metadata?.storyboard?.rows || [], visibleColumns, referenceNodeIds: node.metadata?.storyboard?.referenceNodeIds || [] } } }
                                        : node,
                                ),
                            );
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
                        <Suspense
                            fallback={
                                <div className="fixed inset-0 z-[var(--z-toast)] grid place-items-center px-5" style={{ background: theme.canvas.background, color: theme.node.text }}>
                                    <WorkspaceState icon="loading" title="正在加载 3D 导演台" description="准备场景、镜头与空间控制。" />
                                </div>
                            }
                        >
                            <CanvasDirectorWorkbench
                                open
                                scene={activeDirectorScene}
                                imageNodes={nodes.filter((node) => node.type === CanvasNodeType.Image && Boolean(node.metadata?.content))}
                                onClose={() => setDirectorNodeId(null)}
                                onChange={saveDirectorScene}
                                onApply={applyDirectorOutput}
                                onDeleteImageNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                                onFlush={() => flushCanvasStorePersistence()}
                                onboardingScope={directorOnboardingScope}
                            />
                        </Suspense>
                    ) : null}

                    <CanvasVersionCompareModal
                        open={Boolean(versionCompareRootId)}
                        versions={versionCompareNodes}
                        onClose={() => setVersionCompareRootId(null)}
                        onSetPrimary={setPrimaryVersion}
                        onFocus={(nodeId) => {
                            setVersionCompareRootId(null);
                            focusCanvasNode(nodeId);
                        }}
                    />

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
                        onCancelTask={cancelCanvasTask}
                        superResolveNode={superResolveNode}
                        onCloseSuperResolve={() => setSuperResolveNodeId(null)}
                        previewNode={previewNode}
                        onClosePreview={() => setPreviewNodeId(null)}
                        clearConfirmOpen={clearConfirmOpen}
                        onCancelClear={() => setClearConfirmOpen(false)}
                        onConfirmClear={clearCanvas}
                    />

                    <AssetPickerModal open={assetPickerOpen} multiple={assetInsertScope === "canvas"} onInsert={handleLibraryAssetsInsert} onClose={closeAssetPicker} />
                    <CanvasProjectAssetModal open={projectAssetOpen} detail={linkedProjectQuery.data} initialCategory={projectAssetInitialCategory} initialFolderId={projectAssetInitialFolderId} onClose={closeProjectAssets} onInsert={handleTimelineProjectAssetsInsert} onInsertFolder={projectAssetScope === "canvas" ? handleProjectFolderInsert : undefined} />
                    {codexCompactAgent && !assistantMounted ? (
                        <CanvasLocalAgentPanel headless snapshot={agentSnapshot} canUndoOps={canUndoAgentOps} undoOpsCount={agentUndoCount} onApplyOps={applyAgentOps} onUndoOps={undoAgentOps} autoConnect={codexAutoConnect} />
                    ) : null}
                    </section>
                </CanvasOverlayLayerProvider>
            </main>
        </>
    );
}
