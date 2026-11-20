import { mediaSettingIssues } from "@/lib/media-settings";
import { modelCapabilityConfigFor, videoProfileForOperation } from "@/lib/model-capabilities";
import { InputNumber } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUp, FileText, ImagePlus, LayoutList, LoaderCircle, Maximize2, Music2, Video, X, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/base/segmented-control";

import { ModelPicker } from "@/components/model-picker";
import { modelOptionName, resolveModelChannel, useEffectiveConfig } from "@/stores/use-config-store";
import { canonicalGenerationMetadata, nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import { PROMPT_EDITOR_VIEWPORT_MARGIN } from "@/lib/canvas/canvas-prompt-editor-size";
import { useCanvasPromptPreferencesStore } from "@/stores/canvas/use-canvas-prompt-preferences-store";
import { CanvasPromptFontSizeControl } from "./canvas-prompt-font-size-control";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { modelCompatibilityError, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import { canvasVideoFrameIssue, canvasVideoOperation, canvasVideoReferenceMode, usesProjectedVideoReferences, videoMediaMentionIssue, videoReferenceOperation } from "@/lib/canvas/canvas-video-reference-mode";
import { videoRemakeInputIssue } from "@/lib/canvas/canvas-video-regeneration";
import { useGenerationBatchLimit, batchQuoteTotal } from "@/lib/generation-batch-limit";
import { getGenerationCount } from "@/lib/canvas/canvas-project-generation";
import type { ImageDimensions } from "@/lib/canvas/canvas-reference-image-size";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasCameraControlPopover } from "./canvas-camera-control-popover";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { buildAssetMentionReferences, canvasPromptAssetMentionIds, canvasReferenceDisplayName } from "@/lib/canvas/canvas-resource-references";
import { splitMentionText } from "./canvas-mention-editable";
import { useAssetStore } from "@/stores/use-asset-store";
import { canvasAudioVoiceBindings } from "@/lib/canvas/canvas-audio-voice-bindings";
import { CanvasResourceMentionTextarea, type CanvasResourceMentionTextareaActions } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasVideoPromptTools } from "./canvas-video-prompt-tools";
import { CanvasPresetPicker, type CanvasPromptPreset } from "./canvas-preset-picker";
import { CanvasNineGridPicker } from "./canvas-nine-grid-picker";
import { getNineGridMenuItems } from "./canvas-image-toolbar-tools";
import { CanvasChooseImageStylePicker } from "./canvas-choose-image-style-picker";
import { CanvasChooseEffectPicker } from "./canvas-choose-effect-picker";
import { CanvasChooseMotionPicker } from "./canvas-choose-motion-picker";
import { CanvasPortraitTexturePopover } from "./canvas-portrait-texture-popover";
import { CanvasPromptOptimizerDrawer } from "./canvas-prompt-optimizer-drawer";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata, type CanvasVideoReferenceMode, type CanvasWorkspaceMode } from "@/types/canvas";
import {
    applyToolMention,
    removeToolMentions,
    autoMentionCanvasResourceReferences,
    buildToolMentionReference,
    canvasResourceMentionToken,
    normalizeCanvasNodeMentionTokens,
    parseToolMentionTokens,
    type CanvasResourceReference,
} from "@/lib/canvas/canvas-resource-references";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";
import { ConnectedReferenceShelf, ReferenceToolsPopover, referenceShelfHeading } from "./canvas-node-prompt-references";
import { PromptModalResizeHandle, PromptResizeHandle, clampExpandedModalSize, clampPromptHeight, estimatePromptContentHeight, promptEditorBounds } from "./canvas-node-prompt-resize";
import { audioConfigPatch, buildNodeConfig, defaultMode, modeDisplayName, promptPlaceholder, videoConfigPatch } from "./canvas-node-prompt-config";

export { buildNodeConfig } from "./canvas-node-prompt-config";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    projectId: string;
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => boolean | void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onAddReference?: (nodeId: string, reference: CanvasResourceReference) => CanvasResourceReference | undefined;
    onRemoveReference?: (nodeId: string, reference: CanvasResourceReference) => void;
    onReorderReferences?: (nodeId: string, orderedNodeIds: string[]) => void;
    onReplaceReference?: (nodeId: string, oldReference: CanvasResourceReference, sourceNodeId: string) => void;
    onReplaceReferenceFiles?: (nodeId: string, oldReference: CanvasResourceReference, files: File[]) => void;
    onUploadRemakeImage?: () => void;
    onClose?: () => void;
    onNodeMouseDown?: (event: ReactPointerEvent, nodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    workspaceMode?: CanvasWorkspaceMode;
    onListGenerate?: (nodeId: string, prompt: string) => void;
    /** 第一张上游参考图的尺寸；图片尺寸未由用户选择时按它的比例显示和生成。 */
    referenceImageSize?: ImageDimensions;
};

export type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export const PROMPT_REFERENCE_SHELF_HEIGHT = 64;
// Reserve a useful writing area before content grows; references use their own shelf.
export const PROMPT_EDITOR_MIN_HEIGHT = 104;
export const PROMPT_EDITOR_EXPANDED_MIN_HEIGHT = 280;
export const PROMPT_EDITOR_LINE_HEIGHT = 26;
export const PROMPT_EDITOR_EXPANDED_LINE_HEIGHT = 26;
export const PROMPT_EDITOR_VERTICAL_PADDING = 16;
export const PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING = 16;
export const PROMPT_EDITOR_MAX_LINES = 10;
export const PROMPT_EDITOR_EXPANDED_MAX_LINES = 18;
const PROMPT_EDITOR_MODAL_WIDTH = "min(1200px, 92vw)";
const PROMPT_EDITOR_MODAL_DEFAULT_WIDTH = 1200;
const PROMPT_EDITOR_MODAL_DEFAULT_HEIGHT = 420;
const imagePresetMenuItems = getNineGridMenuItems();

export function CanvasNodePromptPanel({
    projectId,
    node,
    isRunning,
    onPromptChange,
    onConfigChange,
    onGenerate,
    mentionReferences = [],
    onAddReference,
    onRemoveReference,
    onReorderReferences,
    onReplaceReference,
    onReplaceReferenceFiles,
    onUploadRemakeImage,
    onClose,
    onNodeMouseDown,
    onImageSettingsOpenChange,
    workspaceMode = "professional",
    onListGenerate,
    referenceImageSize,
}: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const fontSize = useCanvasPromptPreferencesStore((state) => state.fontSize);
    const themeName = useActiveTheme();
    const theme = canvasThemes[themeName];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    // 画布节点选几张等于拆几单，上限按账号同时任务数。
    const batchLimit = useGenerationBatchLimit();
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const simpleMode = workspaceMode === "simple";
    const mode = defaultMode(node.type);
    const showPromptTemplates = !simpleMode && mode !== "image";
    node = { ...node, metadata: canonicalGenerationMetadata(node, mode) };
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const savedPrompt = nodeGenerationPrompt(node);
    const [prompt, setPrompt] = useState(savedPrompt);
    const promptRef = useRef(savedPrompt);
    const promptEditorActionsRef = useRef<CanvasResourceMentionTextareaActions | null>(null);
    const expandedPromptEditorActionsRef = useRef<CanvasResourceMentionTextareaActions | null>(null);
    const [presetOpen, setPresetOpen] = useState(false);
    const [expandedPresetOpen, setExpandedPresetOpen] = useState(false);
    const [nineGridOpen, setNineGridOpen] = useState(false);
    const [expandedNineGridOpen, setExpandedNineGridOpen] = useState(false);
    const [styleToolOpen, setStyleToolOpen] = useState(false);
    const [expandedStyleToolOpen, setExpandedStyleToolOpen] = useState(false);
    const [effectToolOpen, setEffectToolOpen] = useState(false);
    const [expandedEffectToolOpen, setExpandedEffectToolOpen] = useState(false);
    const [motionToolOpen, setMotionToolOpen] = useState(false);
    const [expandedMotionToolOpen, setExpandedMotionToolOpen] = useState(false);
    const [expandedPromptOpen, setExpandedPromptOpen] = useState(false);
    const [expandedModalSize, setExpandedModalSize] = useState<{ width: number; height: number } | null>(null);
    const expandedModalRef = useRef<HTMLDivElement>(null);
    const [promptContentHeight, setPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, false, fontSize));
    const [expandedPromptContentHeight, setExpandedPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, true, fontSize));
    const [manualPromptHeight, setManualPromptHeight] = useState<number | null>(null);
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const [autoLinkEnabled, setAutoLinkEnabled] = useState(true);
    const resolvedMentionReferences = useResolvedCanvasResourceReferences(mentionReferences, { projectId });
    const promptToolReferences = useMemo(() => parseToolMentionTokens(prompt).map(({ toolId, label, type, icon }) => buildToolMentionReference(toolId, label, type, icon)), [prompt]);
    const textareaReferences = useMemo(() => {
        if (!promptToolReferences.length) return resolvedMentionReferences;
        const existingIds = new Set(resolvedMentionReferences.map((r) => r.id));
        const extras = promptToolReferences.filter((r) => !existingIds.has(r.id));
        return extras.length ? [...resolvedMentionReferences, ...extras] : resolvedMentionReferences;
    }, [resolvedMentionReferences, promptToolReferences]);
    // 当前提示词持有的九宫格工具图标，用于触发按钮回显已选工具。
    const activeNineGridTool = useMemo(() => parseToolMentionTokens(prompt).find((tool) => tool.type === "nine_grid"), [prompt]);
    const activeNineGridIcon = activeNineGridTool?.icon ?? "Grid3x3";
    const selectedPresetPlaceholder = mode === "image" ? imagePresetMenuItems.find((item) => item.toolId === activeNineGridTool?.toolId)?.placeholder : undefined;
    const activeStyleTool = parseToolMentionTokens(prompt).find((t) => t.type === "style");
    const activeEffectTool = parseToolMentionTokens(prompt).find((t) => t.type === "effect");
    // 当前提示词持有的运镜工具标签（可多个），用于运镜按钮回显与菜单高亮。
    const activeMotionTools = useMemo(() => parseToolMentionTokens(prompt).filter((tool) => tool.type === "motion"), [prompt]);
    const activeMotionTool = activeMotionTools[0];
    const normalizedSavedPrompt = useMemo(() => normalizeCanvasNodeMentionTokens(savedPrompt, mentionReferences), [mentionReferences, savedPrompt]);
    const activeReferences = resolvedMentionReferences.filter((item) => item.active && item.kind !== "skill" && item.kind !== "tool");
    const assetIds = useMemo(() => (mode === "video" ? canvasPromptAssetMentionIds(prompt) : []), [mode, prompt]);
    const assets = useAssetStore((state) => (assetIds.length ? state.assets : undefined));
    const mentionedAssets = useMemo(() => (assets ? buildAssetMentionReferences(assets.filter((asset) => assetIds.includes(asset.id))) : []), [assets, assetIds]);
    const mediaMentions = mode === "video" && prompt.includes("@") ? splitMentionText(prompt, [...activeReferences, ...mentionedAssets]).flatMap((part) => (part.type === "mention" && part.reference.kind !== "text" ? [part.reference] : [])) : [];
    const inputReferences = mode === "video" ? [...activeReferences.filter((item) => item.nodeId !== node.id || mediaMentions.includes(item)), ...mentionedAssets] : activeReferences;
    const hasMedia = inputReferences.some((item) => item.kind !== "text");
    const videoMode = canvasVideoReferenceMode(node, hasMedia);
    const videoFrameOptions = activeReferences.filter((item) => item.kind === "image");
    const frameIds = [node.metadata?.videoStartFrameNodeId, node.metadata?.videoEndFrameNodeId];
    const usedReferences = videoMode === "text" || videoMode === "frames" ? inputReferences.filter((item) => item.kind === "text" || (videoMode === "frames" && item.kind === "image" && frameIds.includes(item.nodeId))) : inputReferences;
    const inputSummary = {
        textCount: (prompt.trim() ? 1 : 0) + usedReferences.filter((item) => item.kind === "text").length,
        imageCount: usedReferences.filter((item) => item.kind === "image").length,
        videoCount: usedReferences.filter((item) => item.kind === "video").length,
        audioCount: usedReferences.filter((item) => item.kind === "audio").length,
        characterCount: usedReferences.filter((item) => item.kind === "character").length,
        videoDurationsMs: mode === "video" ? usedReferences.filter((item) => item.kind === "video").map((item) => item.durationMs ?? 0) : undefined,
    };
    const requirements: ModelRequirements = {
        capability: mode,
        input: inputSummary,
        videoOperation: mode === "video" ? canvasVideoOperation(node, inputSummary) : undefined,
        videoSeconds: mode === "video" ? (node.metadata?.seconds ?? globalConfig.videoSeconds) : undefined,
        options: modelRequestOptions(
            {
                ...globalConfig,
                size: node.metadata?.size || globalConfig.size,
                quality: node.metadata?.quality || globalConfig.quality,
                count: String(node.metadata?.count || globalConfig.count),
                transparentBackground: node.metadata?.transparentBackground || globalConfig.transparentBackground,
                videoSeconds: node.metadata?.seconds ?? globalConfig.videoSeconds,
                vquality: node.metadata?.vquality || globalConfig.vquality,
                videoGenerateAudio: node.metadata?.generateAudio ?? globalConfig.videoGenerateAudio,
                videoWatermark: node.metadata?.watermark ?? globalConfig.videoWatermark,
                audioVoice: node.metadata?.audioVoice ?? globalConfig.audioVoice,
                audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat,
                audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed,
            },
            mode,
        ),
    };
    const config = buildNodeConfig(globalConfig, node, mode, requirements, referenceImageSize);
    const resolvedRequirements: ModelRequirements = {
        ...requirements,
        options: modelRequestOptions(config, mode),
        videoSeconds: mode === "video" ? config.videoSeconds : undefined,
    };
    const videoProfile = mode === "video" ? modelCapabilityConfigFor(config, config.model).video : undefined;
    const singleFrame = videoProfile?.modeLimits?.image_to_video?.maxImages === 1;
    const promptOptimizerProvider = useMemo(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, globalConfig));
    }, [globalConfig, promptOptimizerEnabled, promptOptimizerInstallation]);
    // 张数是拆单数，上限与执行链路的 getGenerationCount 保持一致。
    const generationCount = getGenerationCount(config.count);
    const priceChannel = resolveModelChannel(config, config.model);
    const configuredCredits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(config.model),
        count: mode === "image" ? generationCount : 1,
        seconds: mode === "video" ? config.videoSeconds : 1,
        capability: mode,
        config,
        requirements: resolvedRequirements,
    });
    // 服务端按单任务报价，图片按每单 1 张询价，显示时再乘实际单数。
    const quoteRequirements: ModelRequirements = mode === "image" ? { ...resolvedRequirements, options: { ...resolvedRequirements.options, count: 1 } } : resolvedRequirements;
    const quoteRequest = modelQuoteRequest(config, config.model, mode, quoteRequirements);
    const quoteRequestKey = JSON.stringify(quoteRequest || null);
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | null>(null);
    const credits = routeQuote ? batchQuoteTotal(routeQuote.amountMicrocredits, mode === "image" ? generationCount : 1) : configuredCredits;
    const activeReferenceCount = activeReferences.length;
    const canPickReferences = Boolean(onAddReference && !node.metadata?.locked);
    const hasShelf = activeReferenceCount > 0 || canPickReferences;
    const monochromeAccent = theme.node.activeStroke;
    const composerTokens = {
        "--canvas-composer-surface": theme.node.panel,
        "--canvas-composer-control-surface": theme.toolbar.itemHover,
        "--canvas-composer-control-hover": theme.toolbar.activeBg,
        "--canvas-composer-shadow": theme.node.shadow,
        "--canvas-composer-edge": theme.node.stroke,
        "--cn-text": theme.node.text,
    } as CSSProperties;
    const promptBounds = promptEditorBounds(false, hasShelf, fontSize);
    const expandedPromptBounds = promptEditorBounds(true, hasShelf, fontSize);
    const shelfHeight = hasShelf ? PROMPT_REFERENCE_SHELF_HEIGHT : 0;
    const composerHeight = clampPromptHeight(manualPromptHeight ?? promptContentHeight + shelfHeight, promptBounds);
    const expandedComposerHeight = clampPromptHeight(expandedPromptContentHeight + shelfHeight, expandedPromptBounds);
    const measureExpandedModalSize = () => {
        const rect = expandedModalRef.current?.getBoundingClientRect();
        if (!rect?.width || !rect.height) return { width: PROMPT_EDITOR_MODAL_DEFAULT_WIDTH, height: PROMPT_EDITOR_MODAL_DEFAULT_HEIGHT };
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const settingsError = mediaSettingIssues(config, mode)
        .map((item) => item.message)
        .join("；");
    const frameIssue =
        videoMode === "frames"
            ? canvasVideoFrameIssue(
                  node.metadata,
                  videoFrameOptions.map((item) => item.nodeId),
              )
            : "";
    const mentionIssue = (videoMode === "text" || videoMode === "frames") && mediaMentions.some((item) => videoMode === "text" || !frameIds.includes(item.nodeId)) ? videoMediaMentionIssue(videoMode) : "";
    const remakeIssue = videoRemakeInputIssue(node.metadata, inputSummary.imageCount + inputSummary.characterCount, inputSummary.videoDurationsMs || [], config);
    const videoIssue = remakeIssue || frameIssue || mentionIssue || (videoMode && config.model ? modelCompatibilityError(config, config.model, resolvedRequirements) : "");
    const isSubmitDisabled = Boolean(settingsError || videoIssue || !prompt.trim() || isRunning);
    const canExpandPrompt = mode === "image" || mode === "video";
    const canOptimizePrompt = Boolean(promptOptimizerProvider) && canExpandPrompt;
    const isPortraitTexture = mode === "image" && Boolean(node.metadata?.portraitTexture);
    const autoMentionedPrompt = useMemo(() => autoMentionCanvasResourceReferences(prompt, resolvedMentionReferences), [prompt, resolvedMentionReferences]);
    const canAutoMention = autoMentionedPrompt !== prompt;

    useEffect(() => {
        promptRef.current = normalizedSavedPrompt;
        setPrompt(normalizedSavedPrompt);
    }, [node.id, normalizedSavedPrompt]);

    useEffect(() => {
        setExpandedPromptOpen(false);
        setExpandedPresetOpen(false);
        setExpandedModalSize(null);
        setPromptContentHeight(estimatePromptContentHeight(normalizedSavedPrompt, false, fontSize));
        setExpandedPromptContentHeight(estimatePromptContentHeight(normalizedSavedPrompt, true, fontSize));
        setManualPromptHeight(null);
    }, [node.id]);

    useEffect(() => {
        if (!expandedPromptOpen) return;
        const constrainSize = () =>
            setExpandedModalSize((size) => {
                if (!size) return size;
                const next = clampExpandedModalSize(size);
                return next.width === size.width && next.height === size.height ? size : next;
            });
        constrainSize();
        window.addEventListener("resize", constrainSize);
        return () => window.removeEventListener("resize", constrainSize);
    }, [expandedPromptOpen]);

    useEffect(() => {
        if (!creditsEnabled || !quoteRequest) {
            setRouteQuote(null);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(null);
        quoteModel(quoteRequest, controller.signal)
            .then(({ quote }) => setRouteQuote(quote))
            .catch(() => {
                if (!controller.signal.aborted) setRouteQuote(null);
            });
        return () => controller.abort();
        // quoteRequestKey captures the full normalized request without retriggering on object identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creditsEnabled, quoteRequestKey]);

    const skillReferences = useMemo(() => resolvedMentionReferences.filter((item) => item.kind === "skill"), [resolvedMentionReferences]);

    const updatePrompt = (value: string) => {
        if (node.metadata?.locked) return false;
        if (value === promptRef.current) return true;
        if (onPromptChange(node.id, value) === false) return false;
        promptRef.current = value;
        setPrompt(value);
        if (showPromptTemplates && /(^|\s)\/[\p{L}\p{N}_-]*$/u.test(value)) {
            if (expandedPromptOpen) setExpandedPresetOpen(true);
            else setPresetOpen(true);
        }
        return true;
    };

    const updatePromptFromCurrent = (updater: (currentPrompt: string) => string) => {
        updatePrompt(updater(promptRef.current));
    };

    const applyPreset = (preset: CanvasPromptPreset) => {
        const withoutSlash = prompt.replace(/(^|\s)\/[\p{L}\p{N}_-]*$/u, "$1").trimEnd();
        updatePrompt(withoutSlash ? `${withoutSlash}\n${preset.prompt}` : preset.prompt);
    };

    const insertPromptReference = (reference: CanvasResourceReference) => {
        const token = canvasResourceMentionToken(reference);
        const editorActions = expandedPromptOpen ? expandedPromptEditorActionsRef.current : promptEditorActionsRef.current;
        if (editorActions) {
            editorActions.insertTextAtSelection(token);
            return;
        }
        const pendingMentionMatch = /@[^\s@，。！？、,.!?;:]*\s*$/.exec(prompt);
        const basePrompt = pendingMentionMatch ? prompt.slice(0, pendingMentionMatch.index) : prompt;
        updatePrompt(basePrompt ? `${basePrompt.replace(/\s*$/u, "")} ${token} ` : `${token} `);
    };

    const removeMotionToolMention = () => updatePromptFromCurrent((currentPrompt) => removeToolMentions(currentPrompt, "motion"));

    const changeModel = (model: string) => {
        if (model !== config.model) onConfigChange(node.id, { model });
    };

    const changeVideoMode = (next: CanvasVideoReferenceMode) => {
        if (next === videoMode && !usesProjectedVideoReferences(node)) return;
        const operation = videoReferenceOperation(
            next,
            inputReferences.some((item) => item.kind === "image" || item.kind === "video" || item.kind === "character"),
        );
        const nextProfile = videoProfile?.modeLimits?.[operation] && videoProfileForOperation(videoProfile, operation);
        onConfigChange(node.id, {
            videoReferenceMode: next,
            ...(node.metadata?.videoRemake ? { videoRemake: undefined } : {}),
            videoEditOperation: operation,
            ...(nextProfile?.ratios.length && !nextProfile.ratios.includes(config.size) ? { size: nextProfile.defaultRatio } : {}),
            videoStartFrameNodeId: next === "frames" ? videoFrameOptions[0]?.nodeId : undefined,
            videoEndFrameNodeId: next === "frames" && !singleFrame ? videoFrameOptions[1]?.nodeId : undefined,
        });
    };

    const submit = () => {
        const text = prompt.trim();
        if (isSubmitDisabled) return false;
        if (mode === "text" && node.metadata?.listMode && onListGenerate) onListGenerate(node.id, text);
        else onGenerate(node.id, mode, text);
        return true;
    };

    const submitExpandedPrompt = () => {
        if (submit()) {
            setExpandedPresetOpen(false);
            setExpandedNineGridOpen(false);
            setExpandedPromptOpen(false);
        }
    };

    const renderComposerHeader = (expanded: boolean) => (
        <div
            className="canvas-node-composer-header cursor-grab select-none active:cursor-grabbing"
            data-canvas-node-drag-handle
            title="拖动节点"
            onPointerDown={(event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target?.closest('button, input, textarea, select, a, [contenteditable="true"], [data-canvas-no-drag]')) onNodeMouseDown?.(event, node.id);
            }}
        >
            {isPortraitTexture ? (
                <>
                    <CanvasPortraitTexturePopover value={node.metadata?.portraitTexture} placement={expanded ? "topRight" : "topLeft"} onChange={(portraitTexture) => onConfigChange(node.id, { portraitTexture })} />
                    {activeReferenceCount > 0 ? <span className="canvas-node-composer-reference-heading">{referenceShelfHeading(activeReferences)}</span> : null}
                </>
            ) : (
                <div className="canvas-node-composer-mode">
                    <span className="canvas-node-composer-mode-icon" style={{ color: monochromeAccent }}>
                        <GenerationModeIcon mode={mode} />
                    </span>
                    <span className="canvas-node-composer-mode-title truncate">{modeDisplayName(mode)}生成</span>
                    {activeReferenceCount > 0 ? <span className="canvas-node-composer-reference-heading">{referenceShelfHeading(activeReferences)}</span> : null}
                    {videoMode && (
                        <SegmentedControl<CanvasVideoReferenceMode>
                            className="canvas-video-reference-switch"
                            size="sm"
                            ariaLabel={t("canvasC.videoPromptTools.mode")}
                            value={videoMode}
                            disabled={Boolean(node.metadata?.locked) || isRunning}
                            options={[
                                { value: "text", label: t("canvasC.videoPromptTools.textMode") },
                                { value: "all", label: t("canvasC.videoPromptTools.allMode"), disabled: !hasMedia },
                                { value: "frames", label: t(singleFrame ? "canvasC.videoPromptTools.startFrame" : "canvasC.videoPromptTools.frameMode"), disabled: !videoFrameOptions.length && videoMode !== "frames" },
                            ]}
                            onChange={changeVideoMode}
                        />
                    )}
                </div>
            )}
            <div className="canvas-node-composer-header-tools">
                {!simpleMode && (mode === "image" || mode === "video") ? (
                    <div className="canvas-node-tool-controls canvas-node-tool-controls-inline flex items-center gap-1" data-canvas-no-zoom data-canvas-wheel-scroll onPointerDown={(e) => e.stopPropagation()}>
                        {mode === "image" ? (
                            <>
                                <CanvasChooseImageStylePicker
                                    open={expanded ? expandedStyleToolOpen : styleToolOpen}
                                    onOpenChange={expanded ? setExpandedStyleToolOpen : setStyleToolOpen}
                                    activeToolId={activeStyleTool?.toolId}
                                    activeLabel={activeStyleTool?.label}
                                    onSelect={(id, label) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "style" }, "Palette"))}
                                    onClear={() => updatePromptFromCurrent((currentPrompt) => removeToolMentions(currentPrompt, "style"))}
                                />
                                <CanvasNineGridPicker
                                    open={expanded ? expandedNineGridOpen : nineGridOpen}
                                    onOpenChange={expanded ? setExpandedNineGridOpen : setNineGridOpen}
                                    icon={activeNineGridIcon}
                                    selectedToolId={activeNineGridTool?.toolId}
                                    onSelect={(id, label, icon) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "nine_grid" }, icon))}
                                />
                            </>
                        ) : (
                            <>
                                <CanvasChooseEffectPicker
                                    open={expanded ? expandedEffectToolOpen : effectToolOpen}
                                    onOpenChange={expanded ? setExpandedEffectToolOpen : setEffectToolOpen}
                                    activeToolId={activeEffectTool?.toolId}
                                    activeLabel={activeEffectTool?.label}
                                    onSelect={(id, label) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "effect" }, "Aperture"))}
                                    onClear={() => updatePromptFromCurrent((currentPrompt) => removeToolMentions(currentPrompt, "effect"))}
                                />
                                <CanvasChooseMotionPicker
                                    open={expanded ? expandedMotionToolOpen : motionToolOpen}
                                    onOpenChange={expanded ? setExpandedMotionToolOpen : setMotionToolOpen}
                                    activeToolIds={activeMotionTools.map((t) => t.toolId)}
                                    activeLabel={activeMotionTool?.label}
                                    onSelect={(id, label) => updatePromptFromCurrent((currentPrompt) => applyToolMention(currentPrompt, { id, label, type: "motion" }, "Camera"))}
                                    onClear={removeMotionToolMention}
                                />
                            </>
                        )}
                    </div>
                ) : null}
                {showPromptTemplates ? (
                    <CanvasPresetPicker mode={mode} skillReferences={skillReferences} open={expanded ? expandedPresetOpen : presetOpen} onOpenChange={expanded ? setExpandedPresetOpen : setPresetOpen} onSelect={applyPreset} dense appearance="quiet" />
                ) : null}
                {canOptimizePrompt ? (
                    <Tooltip title="用 AI 润色提示词">
                        <button type="button" className="canvas-node-composer-header-action is-labeled" onClick={() => setPromptOptimizerOpen(true)} aria-label="润色提示词">
                            <PenLine />
                            <span>润色</span>
                        </button>
                    </Tooltip>
                ) : null}
            </div>
            <div className="canvas-node-composer-window-tools" data-canvas-no-drag>
                <CanvasPromptFontSizeControl compact />
                {!expanded && canExpandPrompt ? (
                    <Tooltip title="放大编辑">
                        <button type="button" className="canvas-node-composer-header-action is-icon" onClick={() => setExpandedPromptOpen(true)} aria-label="放大编辑提示词">
                            <Maximize2 />
                        </button>
                    </Tooltip>
                ) : null}
                {!expanded && onClose ? (
                    <Tooltip title="关闭">
                        <button type="button" className="canvas-node-composer-header-action is-icon" onClick={onClose} aria-label="关闭创作面板">
                            <X />
                        </button>
                    </Tooltip>
                ) : null}
            </div>
        </div>
    );

    const renderSubmitButton = (expanded: boolean) => {
        if (settingsError)
            return (
                <span role="alert" className="text-xs" title={settingsError}>
                    {settingsError}
                </span>
            );
        const showCost = creditsEnabled && credits !== null;
        const formattedCredits = credits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
        const actionLabel = isRunning ? "生成中" : showCost ? `${routeQuote?.estimated ? "预估" : "消耗"} ${formattedCredits} 积分，生成` : "生成";
        return (
            <div className="canvas-node-generate">
                {showCost ? (
                    <span className="canvas-node-generate-cost" title={routeQuote ? modelQuoteDescription(routeQuote) : actionLabel}>
                        <CreditSymbol />
                        <span>
                            {routeQuote?.estimated ? "约 " : ""}
                            {formattedCredits} 积分
                        </span>
                    </span>
                ) : null}
                <button type="button" className="canvas-node-generate-button" disabled={isSubmitDisabled} aria-busy={isRunning} aria-label={actionLabel} title={videoIssue || actionLabel} onClick={() => (expanded ? submitExpandedPrompt() : submit())}>
                    {isRunning ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowUp aria-hidden />}
                </button>
            </div>
        );
    };

    const renderComposerControls = (expanded: boolean) =>
        simpleMode ? (
            <div className="canvas-node-composer-footer">
                <span className="min-w-0 truncate px-2 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                    {activeReferenceCount ? `已连接 ${activeReferenceCount} 个素材` : "将使用默认模型与参数"}
                </span>
                <ReferenceToolsPopover canAutoMention={canAutoMention} autoLinkEnabled={autoLinkEnabled} onAutoMention={() => updatePrompt(autoMentionedPrompt)} onAutoLinkEnabledChange={setAutoLinkEnabled} accent={monochromeAccent} compact />
                {renderSubmitButton(expanded)}
            </div>
        ) : (
            <div className="canvas-node-composer-footer">
                <div className="canvas-node-composer-model">
                    <ModelPicker
                        className="canvas-node-composer-model-trigger"
                        fullWidth
                        config={config}
                        value={config.model}
                        onChange={changeModel}
                        capability={mode}
                        requirements={resolvedRequirements}
                        onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                        showSelectedPrice={false}
                        showOptionPrices={creditsEnabled}
                        variant="creation"
                        showConfiguredModelName
                    />
                </div>
                <div className="canvas-node-composer-output-tools">
                    {mode === "text" ? (
                        <>
                            <div className="flex h-7 items-center overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke }}>
                                <button
                                    type="button"
                                    aria-pressed={!node.metadata?.listMode}
                                    onClick={() => onConfigChange(node.id, { listMode: false })}
                                    className={`flex h-full items-center gap-1 px-2 text-[var(--fs-tiny)] transition-colors focus-visible:outline ${!node.metadata?.listMode ? "font-medium" : ""}`}
                                    style={!node.metadata?.listMode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.muted }}
                                >
                                    <FileText className="size-3" />
                                    文本
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={Boolean(node.metadata?.listMode)}
                                    onClick={() => onConfigChange(node.id, { listMode: true })}
                                    className={`flex h-full items-center gap-1 px-2 text-[var(--fs-tiny)] transition-colors focus-visible:outline ${node.metadata?.listMode ? "font-medium" : ""}`}
                                    style={node.metadata?.listMode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.muted }}
                                >
                                    <LayoutList className="size-3" />
                                    列表
                                </button>
                            </div>
                            {!node.metadata?.listMode ? (
                                <Tooltip title={`文本生成份数（默认 1，可在生成配置中调整）`}>
                                    <InputNumber
                                        size="small"
                                        min={1}
                                        max={Math.min(15, batchLimit)}
                                        value={Math.max(1, Math.min(Math.min(15, batchLimit), Math.floor(Math.abs(Number(node.metadata?.textCount) || 1))))}
                                        onChange={(value) =>
                                            onConfigChange(node.id, {
                                                textCount: Math.max(1, Math.min(Math.min(15, batchLimit), Math.floor(Math.abs(Number(value) || 1)))),
                                            })
                                        }
                                        aria-label="文本生成份数"
                                        className="!w-14 !h-7 [&_.ant-input-number-input]:!text-[var(--fs-tiny)]"
                                    />
                                </Tooltip>
                            ) : (
                                <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                                    行数和列结构由模型判断
                                </span>
                            )}
                        </>
                    ) : mode === "image" ? (
                        // 图片模式下，显示相机配置与镜头配置
                        <>
                            <CanvasCameraControlPopover cameraControl={node.metadata?.cameraControl} onCameraControlChange={(options) => onConfigChange(node.id, { cameraControl: options })} theme={theme} compact={!expanded} />
                            <CanvasImageSettingsPopover
                                config={config}
                                countLimit={batchLimit}
                                placement={expanded ? "topRight" : "topLeft"}
                                buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : key === "size" ? { size: value, imageSizeSource: "user" } : { [key]: value })}
                                onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                                onOpenChange={expanded ? undefined : onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <CanvasVideoSettingsPopover
                            config={config}
                            operation={resolvedRequirements.videoOperation}
                            buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                        />
                    ) : mode === "audio" ? (
                        <CanvasAudioSettingsPopover
                            config={{ ...config, audioVoiceBindings: canvasAudioVoiceBindings(node.metadata) }}
                            references={activeReferences}
                            referenceAudioLabels={activeReferences.filter((reference) => reference.kind === "audio").map(canvasReferenceDisplayName)}
                            onBindingsChange={(bindings) => onConfigChange(node.id, { audioVoiceBindings: bindings })}
                            buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))}
                        />
                    ) : null}
                </div>
                <div className="canvas-node-composer-send-tools">
                    <ReferenceToolsPopover canAutoMention={canAutoMention} autoLinkEnabled={autoLinkEnabled} onAutoMention={() => updatePrompt(autoMentionedPrompt)} onAutoLinkEnabledChange={setAutoLinkEnabled} accent={monochromeAccent} compact />
                    {renderSubmitButton(expanded)}
                </div>
            </div>
        );

    const renderPromptEditor = (expanded: boolean, fill = false) => {
        const bounds = expanded ? expandedPromptBounds : promptBounds;
        const height = expanded ? expandedComposerHeight : composerHeight;
        return (
            <>
                <div className={fill ? "canvas-node-composer-editor flex-1" : "canvas-node-composer-editor"} style={fill ? { minHeight: bounds.min } : { height, ...(expanded ? { flexShrink: 0 } : null) }}>
                    <ConnectedReferenceShelf
                        targetNodeId={node.id}
                        references={resolvedMentionReferences}
                        theme={theme}
                        onInsert={insertPromptReference}
                        onPick={canPickReferences ? () => (expanded ? expandedPromptEditorActionsRef : promptEditorActionsRef).current?.openReferencePicker() : undefined}
                        onRemove={(reference) => onRemoveReference?.(node.id, reference)}
                        onReorder={onReorderReferences ? (orderedNodeIds) => onReorderReferences(node.id, orderedNodeIds) : undefined}
                        onReplaceReference={onReplaceReference ? (oldReference, sourceNodeId) => onReplaceReference(node.id, oldReference, sourceNodeId) : undefined}
                        onReplaceReferenceFiles={onReplaceReferenceFiles ? (oldReference, files) => onReplaceReferenceFiles(node.id, oldReference, files) : undefined}
                    />
                    <CanvasResourceMentionTextarea
                        value={prompt}
                        readOnly={Boolean(node.metadata?.locked)}
                        references={textareaReferences}
                        onSelectReference={onAddReference ? (reference) => onAddReference(node.id, reference) : undefined}
                        includeAssetLibrary
                        // 节点生成器引用素材最多：菜单够宽时多列显示素材，右侧放大预览当前选中项。
                        mentionMenuWidth={640}
                        onChange={updatePrompt}
                        autoLinkEnabled={autoLinkEnabled}
                        onReferenceFilesDrop={onReplaceReferenceFiles ? (reference, files) => onReplaceReferenceFiles(node.id, reference, files) : undefined}
                        onContentSizeChange={expanded ? setExpandedPromptContentHeight : setPromptContentHeight}
                        actionsRef={expanded ? expandedPromptEditorActionsRef : promptEditorActionsRef}
                        containerClassName="min-h-0 flex-1"
                        className={
                            expanded
                                ? "thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent py-2 text-[var(--fs-body-lg)] leading-6 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"
                                : "thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent py-2 text-[var(--fs-body)] leading-5 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"
                        }
                        style={{ color: theme.node.text, outline: "none", boxShadow: "none", fontSize, lineHeight: 1.6 }}
                        placeholder={selectedPresetPlaceholder || promptPlaceholder(mode, hasImageContent, hasTextContent)}
                        aria-label={`${modeDisplayName(mode)}提示词`}
                    />
                </div>
                {!expanded && <PromptResizeHandle height={height} min={bounds.min} max={bounds.max} onResize={setManualPromptHeight} />}
                {videoMode === "frames" && (
                    <div className="canvas-node-composer-parameters shrink-0">
                        <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} singleFrame={singleFrame} disabled={Boolean(node.metadata?.locked) || isRunning} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                    </div>
                )}
                {videoIssue ? (
                    <span role="status" className="canvas-video-reference-issue">
                        {videoIssue}
                        {onUploadRemakeImage && !inputSummary.imageCount && !inputSummary.characterCount ? (
                            <button type="button" className="ms-2 inline-flex items-center gap-1 underline" onClick={onUploadRemakeImage}>
                                <ImagePlus className="size-3.5" aria-hidden="true" />
                                上传参考图
                            </button>
                        ) : null}
                    </span>
                ) : null}
            </>
        );
    };

    return (
        <CanvasPromptOptimizerDrawer
            open={promptOptimizerOpen}
            prompt={prompt}
            generationMode={mode === "image" || mode === "video" ? mode : "image"}
            targetModel={modelOptionName(config.model) || config.model}
            targetProtocol={priceChannel.modelCosts?.find((item) => item.model === modelOptionName(config.model))?.protocol || priceChannel.interfaceType}
            config={globalConfig}
            optimizerModel={globalConfig.textModel}
            references={activeReferences}
            provider={promptOptimizerProvider}
            onClose={() => setPromptOptimizerOpen(false)}
            onApply={(nextPrompt) => updatePrompt(nextPrompt)}
        >
            <div className="canvas-node-composer" style={composerTokens} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                {renderComposerHeader(false)}

                {renderPromptEditor(false)}

                {renderComposerControls(false)}

                <AppModal
                    flush
                    className="canvas-prompt-editor-modal"
                    open={expandedPromptOpen}
                    title={null}
                    footer={null}
                    centered
                    width={expandedModalSize ? expandedModalSize.width : PROMPT_EDITOR_MODAL_WIDTH}
                    style={{ maxWidth: `calc(100vw - ${PROMPT_EDITOR_VIEWPORT_MARGIN}px)` }}
                    onCancel={() => {
                        setExpandedPresetOpen(false);
                        setExpandedNineGridOpen(false);
                        setExpandedPromptOpen(false);
                    }}
                    styles={{
                        container: { borderRadius: "var(--canvas-composer-radius)", background: theme.node.panel, boxShadow: theme.node.shadow },
                        body: { minHeight: 0 },
                    }}
                >
                    <div
                        ref={expandedModalRef}
                        className="relative flex min-h-0 flex-col"
                        style={{ ...composerTokens, color: theme.node.text, maxHeight: `calc(100dvh - ${PROMPT_EDITOR_VIEWPORT_MARGIN}px)`, ...(expandedModalSize ? { height: expandedModalSize.height } : null) }}
                    >
                        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                            <div className="shrink-0 pr-8">{renderComposerHeader(true)}</div>
                            {renderPromptEditor(true, Boolean(expandedModalSize))}
                            <div className="shrink-0">{renderComposerControls(true)}</div>
                        </div>
                        <PromptModalResizeHandle size={expandedModalSize} measure={measureExpandedModalSize} onResize={setExpandedModalSize} accent={theme.node.muted} />
                    </div>
                </AppModal>
            </div>
        </CanvasPromptOptimizerDrawer>
    );
}

function GenerationModeIcon({ mode }: { mode: CanvasNodeGenerationMode }) {
    if (mode === "image") return <ImagePlus className="size-3" />;
    if (mode === "video") return <Video className="size-3" />;
    if (mode === "audio") return <Music2 className="size-3" />;
    return <FileText className="size-3" />;
}
