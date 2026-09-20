import { Button, Image as AntImage, InputNumber, Modal, Popover } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight, ArrowUp, AtSign, Boxes, ChevronDown, FileText, GripVertical, ImageIcon, ImagePlus, LayoutList, Link2, LoaderCircle, Maximize2, Music2, Pencil, SlidersHorizontal, UserRound, Video, WandSparkles, X } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelOptionName, resolveModelChannel, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import { canonicalGenerationMetadata } from "@/lib/canvas/generation-contract";
import { clampPromptEditorModalSize, PROMPT_EDITOR_VIEWPORT_MARGIN } from "@/lib/canvas/canvas-prompt-editor-size";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelQuoteDescription, modelQuoteRequest } from "@/lib/model-pricing";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { modelRequestOptions, resolveCompatibleModel, resolveModelGenerationDefaults, defaultImageParamsForModel, type ModelRequirements } from "@/lib/model-selection";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasCameraControlPopover } from "./canvas-camera-control-popover";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasVideoPromptTools } from "./canvas-video-prompt-tools";
import { CanvasPresetPicker, type CanvasPromptPreset } from "./canvas-preset-picker";
import { CanvasNineGridPicker } from "./canvas-nine-grid-picker";
import { CanvasChooseImageStylePicker } from "./canvas-choose-image-style-picker";
import { CanvasChooseEffectPicker } from "./canvas-choose-effect-picker";
import { CanvasChooseMotionPicker } from "./canvas-choose-motion-picker";
import { CanvasPortraitTexturePopover } from "./canvas-portrait-texture-popover";
import { CanvasPromptOptimizerDrawer } from "./canvas-prompt-optimizer-drawer";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode } from "@/types/canvas";
import { applyToolMention, removeToolMentions, autoMentionCanvasResourceReferences, buildToolMentionReference, canvasResourceMentionToken, normalizeCanvasNodeMentionTokens, overwriteSameTypeToolMention, parseToolMentionTokens, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useResolvedCanvasResourceReferences } from "./use-resolved-canvas-resource-references";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    projectId: string;
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onAddReference?: (nodeId: string, reference: CanvasResourceReference) => CanvasResourceReference | undefined;
    onRemoveReference?: (nodeId: string, reference: CanvasResourceReference) => void;
    onReorderReferences?: (nodeId: string, orderedNodeIds: string[]) => void;
    onReplaceReference?: (nodeId: string, oldReference: CanvasResourceReference, sourceNodeId: string) => void;
    onReplaceReferenceFiles?: (nodeId: string, oldReference: CanvasResourceReference, files: File[]) => void;
    onClose?: () => void;
    onNodeMouseDown?: (event: ReactPointerEvent, nodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    workspaceMode?: CanvasWorkspaceMode;
    onListGenerate?: (nodeId: string, prompt: string) => void;
};

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

const PROMPT_REFERENCE_SHELF_HEIGHT = 58;
// Keep the compact editor readable at rest: three 20px lines plus 12px vertical padding.
const PROMPT_EDITOR_MIN_HEIGHT = 72;
const PROMPT_EDITOR_EXPANDED_MIN_HEIGHT = 200;
const PROMPT_EDITOR_LINE_HEIGHT = 20;
const PROMPT_EDITOR_EXPANDED_LINE_HEIGHT = 24;
const PROMPT_EDITOR_VERTICAL_PADDING = 12;
const PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING = 20;
const PROMPT_EDITOR_MAX_LINES = 8;
const PROMPT_EDITOR_EXPANDED_MAX_LINES = 14;
const PROMPT_EDITOR_MODAL_WIDTH = "min(1200px, 92vw)";
const PROMPT_EDITOR_MODAL_DEFAULT_WIDTH = 1200;
const PROMPT_EDITOR_MODAL_DEFAULT_HEIGHT = 420;

export function CanvasNodePromptPanel({ projectId, node, isRunning, onPromptChange, onConfigChange, onGenerate, mentionReferences = [], onAddReference, onRemoveReference, onReorderReferences, onReplaceReference, onReplaceReferenceFiles, onClose, onNodeMouseDown, onImageSettingsOpenChange, workspaceMode = "professional", onListGenerate }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const themeName = useActiveTheme();
    const theme = canvasThemes[themeName];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const promptOptimizerEnabled = usePluginStore((state) => state.pluginStates[PROMPT_OPTIMIZER_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID)?.enabled));
    const simpleMode = workspaceMode === "simple";
    const mode = defaultMode(node.type);
    const showPromptTemplates = !simpleMode && mode !== "image";
    node = { ...node, metadata: canonicalGenerationMetadata(node, mode) };
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const savedPrompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const [prompt, setPrompt] = useState(savedPrompt);
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
    const [promptContentHeight, setPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, false));
    const [expandedPromptContentHeight, setExpandedPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, true));
    const [manualPromptHeight, setManualPromptHeight] = useState<number | null>(null);
    const [paramsExpanded, setParamsExpanded] = useState(false); // #98 决策2：B区参数区折叠状态（手风琴）
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const [autoLinkEnabled, setAutoLinkEnabled] = useState(true);
    const resolvedMentionReferences = useResolvedCanvasResourceReferences(mentionReferences, { projectId });
    const promptToolReferences = useMemo(() => parseToolMentionTokens(prompt).map(({toolId, label, type, icon}) => buildToolMentionReference(toolId, label, type, icon)), [prompt]);
    const textareaReferences = useMemo(() => {
        if (!promptToolReferences.length) return resolvedMentionReferences;
        const existingIds = new Set(resolvedMentionReferences.map((r) => r.id));
        const extras = promptToolReferences.filter((r) => !existingIds.has(r.id));
        return extras.length ? [...resolvedMentionReferences, ...extras] : resolvedMentionReferences;
    }, [resolvedMentionReferences, promptToolReferences]);
    // 当前提示词持有的九宫格工具图标，用于触发按钮回显已选工具。
    const activeNineGridIcon = useMemo(() => parseToolMentionTokens(prompt).find((tool) => tool.type === "nine_grid")?.icon ?? "Grid3x3", [prompt]);
    const activeStyleTool = parseToolMentionTokens(prompt).find(t => t.type === "style");
    const activeEffectTool = parseToolMentionTokens(prompt).find(t => t.type === "effect");
    // 当前提示词持有的运镜工具标签（可多个），用于运镜按钮回显与菜单高亮。
    const activeMotionTools = useMemo(() => parseToolMentionTokens(prompt).filter((tool) => tool.type === "motion"), [prompt]);
    const activeMotionTool = activeMotionTools[0];
    const normalizedSavedPrompt = useMemo(() => normalizeCanvasNodeMentionTokens(savedPrompt, mentionReferences), [mentionReferences, savedPrompt]);
    const activeReferences = resolvedMentionReferences.filter((item) => item.active && item.kind !== "skill" && item.kind !== "tool");
    const requirements: ModelRequirements = {
        capability: mode,
        input: {
            textCount: (prompt.trim() ? 1 : 0) + activeReferences.filter((item) => item.kind === "text").length,
            imageCount: activeReferences.filter((item) => item.kind === "image").length,
            videoCount: activeReferences.filter((item) => item.kind === "video").length,
            audioCount: activeReferences.filter((item) => item.kind === "audio").length,
            characterCount: activeReferences.filter((item) => item.kind === "character").length,
        },
        videoOperation: node.metadata?.videoEditOperation,
        videoSeconds: mode === "video" ? node.metadata?.seconds ?? globalConfig.videoSeconds : undefined,
        options: modelRequestOptions({
            ...globalConfig,
            size: node.metadata?.size || globalConfig.size,
            quality: node.metadata?.quality || globalConfig.quality,
            count: String(node.metadata?.count || globalConfig.count),
            transparentBackground: node.metadata?.transparentBackground || globalConfig.transparentBackground,
            videoSeconds: node.metadata?.seconds ?? globalConfig.videoSeconds,
            vquality: node.metadata?.vquality || globalConfig.vquality,
            videoGenerateAudio: node.metadata?.generateAudio ?? globalConfig.videoGenerateAudio,
            videoWatermark: node.metadata?.watermark ?? globalConfig.videoWatermark,
            audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice,
            audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat,
            audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed,
        }, mode),
    };
    const config = buildNodeConfig(globalConfig, node, mode, requirements);
    const resolvedRequirements: ModelRequirements = {
        ...requirements,
        options: modelRequestOptions(config, mode),
        videoSeconds: mode === "video" ? config.videoSeconds : undefined,
    };
    const promptOptimizerProvider = useMemo(() => {
        if (!promptOptimizerEnabled || !promptOptimizerInstallation || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, globalConfig));
    }, [globalConfig, promptOptimizerEnabled, promptOptimizerInstallation]);
    const generationCount = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
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
    const quoteRequest = modelQuoteRequest(config, config.model, mode, resolvedRequirements);
    const quoteRequestKey = JSON.stringify(quoteRequest || null);
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | null>(null);
    const credits = routeQuote ? routeQuote.amountMicrocredits / 1_000_000 : configuredCredits;
    const activeReferenceCount = activeReferences.length;
    const videoFrameOptions = resolvedMentionReferences.filter((item) => item.active && item.kind === "image").map((item) => ({ nodeId: item.nodeId, label: item.label, title: item.title, previewUrl: item.previewUrl }));
    const hasVideoPromptTools = mode === "video" && !simpleMode && videoFrameOptions.length > 0;
    const monochromeAccent = theme.node.activeStroke;
    const composerTokens = {
        "--canvas-composer-surface": theme.node.panel,
        "--canvas-composer-control-surface": theme.toolbar.itemHover,
        "--canvas-composer-control-hover": theme.toolbar.activeBg,
        "--canvas-composer-shadow": theme.node.shadow,
        "--cn-text": theme.node.text,
    } as CSSProperties;
    const composerSurfaceStyle = {
        ...composerTokens,
        background: theme.node.panel,
        color: theme.node.text,
        boxShadow: theme.node.shadow,
    } as CSSProperties;
    const controlSurface = "var(--canvas-composer-control-surface)";
    const promptBounds = promptEditorBounds(false, activeReferenceCount > 0);
    const expandedPromptBounds = promptEditorBounds(true, activeReferenceCount > 0);
    const composerHeight = clampPromptHeight(manualPromptHeight ?? promptContentHeight + (activeReferenceCount ? PROMPT_REFERENCE_SHELF_HEIGHT : 0), promptBounds);
    const expandedComposerHeight = clampPromptHeight(expandedPromptContentHeight + (activeReferenceCount ? PROMPT_REFERENCE_SHELF_HEIGHT : 0), expandedPromptBounds);
    const measureExpandedModalSize = () => {
        const rect = expandedModalRef.current?.getBoundingClientRect();
        if (!rect?.width || !rect.height) return { width: PROMPT_EDITOR_MODAL_DEFAULT_WIDTH, height: PROMPT_EDITOR_MODAL_DEFAULT_HEIGHT };
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const isSubmitDisabled = !isRunning && !prompt.trim();
    const canExpandPrompt = mode === "image" || mode === "video";
    const canOptimizePrompt = Boolean(promptOptimizerProvider) && canExpandPrompt;
    const isPortraitTexture = mode === "image" && Boolean(node.metadata?.portraitTexture);
    const autoMentionedPrompt = useMemo(() => autoMentionCanvasResourceReferences(prompt, resolvedMentionReferences), [prompt, resolvedMentionReferences]);
    const canAutoMention = autoMentionedPrompt !== prompt;

    useEffect(() => {
        setPrompt(normalizedSavedPrompt);
        if (normalizedSavedPrompt !== savedPrompt) onPromptChange(node.id, normalizedSavedPrompt);
    }, [node.id, normalizedSavedPrompt, onPromptChange, savedPrompt]);

    useEffect(() => {
        setExpandedPromptOpen(false);
        setExpandedPresetOpen(false);
        setExpandedModalSize(null);
        setPromptContentHeight(estimatePromptContentHeight(normalizedSavedPrompt, false));
        setExpandedPromptContentHeight(estimatePromptContentHeight(normalizedSavedPrompt, true));
        setManualPromptHeight(null);
    }, [node.id]);

    useEffect(() => {
        if (!expandedPromptOpen) return;
        const constrainSize = () => setExpandedModalSize((size) => {
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
        setPrompt(value);
        onPromptChange(node.id, value);
        if (showPromptTemplates && /(^|\s)\/[\p{L}\p{N}_-]*$/u.test(value)) {
            if (expandedPromptOpen) setExpandedPresetOpen(true);
            else setPresetOpen(true);
        }
    };

    const applyPreset = (preset: CanvasPromptPreset) => {
        const withoutSlash = prompt.replace(/(^|\s)\/[\p{L}\p{N}_-]*$/u, "$1").trimEnd();
        updatePrompt(withoutSlash ? `${withoutSlash}\n${preset.prompt}` : preset.prompt);
    };

    const insertPromptReference = (reference: CanvasResourceReference) => {
        const insertText = `${canvasResourceMentionToken(reference)} `;
        const pendingMentionMatch = /@[^\s@，。！？、,.!?;:]*\s*$/.exec(prompt);
        const basePrompt = pendingMentionMatch ? prompt.slice(0, pendingMentionMatch.index) : prompt;
        // 同类型工具标签（style/nine_grid/effect）唯一：已有旧标签时原位覆盖，不再追加。
        const overwrittenPrompt = overwriteSameTypeToolMention(basePrompt, reference);
        if (overwrittenPrompt != null) {
            updatePrompt(overwrittenPrompt.replace(/\s+$/, ""));
            return;
        }
        const trimmedBase = basePrompt.replace(/\s*$/, "");
        updatePrompt(trimmedBase ? `${trimmedBase} ${insertText}` : insertText);
    };

    const removeMotionToolMention = () => updatePrompt(removeToolMentions(prompt, "motion"));

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return false;
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
                if (!target?.closest("button, input, textarea, select, a, [contenteditable=\"true\"], [data-canvas-no-drag]")) onNodeMouseDown?.(event, node.id);
            }}
        >
            {isPortraitTexture ? (
                <>
                    <CanvasPortraitTexturePopover value={node.metadata?.portraitTexture} placement={expanded ? "topRight" : "topLeft"} onChange={(portraitTexture) => onConfigChange(node.id, { portraitTexture })} />
                    {activeReferenceCount > 0 ? <span className="canvas-node-composer-reference-heading">{referenceShelfHeading(activeReferences)}</span> : null}
                </>
            ) : (
                <div className="canvas-node-composer-mode">
                    <span className="grid size-3.5 shrink-0 place-items-center" style={{ color: monochromeAccent }}>
                        <GenerationModeIcon mode={mode} />
                    </span>
                    <span className="truncate text-[var(--fs-tiny)] font-medium">{modeDisplayName(mode)}生成</span>
                    {activeReferenceCount > 0 ? <span className="canvas-node-composer-reference-heading">{referenceShelfHeading(activeReferences)}</span> : null}
                </div>
            )}
            <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            {!simpleMode && (mode === "image" || mode === "video") ? <div className="canvas-node-tool-controls canvas-node-tool-controls-inline flex items-center gap-1" data-canvas-no-zoom data-canvas-wheel-scroll onPointerDown={e => e.stopPropagation()}>
                {mode === "image" ? <>
                    <CanvasChooseImageStylePicker open={expanded ? expandedStyleToolOpen : styleToolOpen} onOpenChange={expanded ? setExpandedStyleToolOpen : setStyleToolOpen} activeToolId={activeStyleTool?.toolId} activeLabel={activeStyleTool?.label} onSelect={(id,label) => updatePrompt(applyToolMention(prompt,{id,label,type:"style"},"Palette"))} onClear={() => updatePrompt(removeToolMentions(prompt,"style"))} />
                    <CanvasNineGridPicker open={expanded ? expandedNineGridOpen : nineGridOpen} onOpenChange={expanded ? setExpandedNineGridOpen : setNineGridOpen} icon={activeNineGridIcon} onSelect={(id,label,icon) => updatePrompt(applyToolMention(prompt,{id,label,type:"nine_grid"},icon))} />
                </> : <>
                    <CanvasChooseEffectPicker open={expanded ? expandedEffectToolOpen : effectToolOpen} onOpenChange={expanded ? setExpandedEffectToolOpen : setEffectToolOpen} activeToolId={activeEffectTool?.toolId} activeLabel={activeEffectTool?.label} onSelect={(id,label) => updatePrompt(applyToolMention(prompt,{id,label,type:"effect"},"Sparkles"))} onClear={() => updatePrompt(removeToolMentions(prompt,"effect"))} />
                    <CanvasChooseMotionPicker open={expanded ? expandedMotionToolOpen : motionToolOpen} onOpenChange={expanded ? setExpandedMotionToolOpen : setMotionToolOpen} activeToolIds={activeMotionTools.map(t => t.toolId)} activeLabel={activeMotionTool?.label} onSelect={(id,label) => updatePrompt(applyToolMention(prompt,{id,label,type:"motion"},"Camera"))} onClear={removeMotionToolMention} />
                </>}
            </div> : null}
            {showPromptTemplates ? <CanvasPresetPicker mode={mode} skillReferences={skillReferences} open={expanded ? expandedPresetOpen : presetOpen} onOpenChange={expanded ? setExpandedPresetOpen : setPresetOpen} onSelect={applyPreset} dense appearance="quiet" /> : null}
            {canOptimizePrompt ? (
                <Tooltip title="用 AI 润色提示词">
                    <button
                        type="button"
                        className="canvas-node-composer-header-action inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5"
                        onClick={() => setPromptOptimizerOpen(true)}
                        aria-label="润色提示词"
                    >
                        <WandSparkles className="size-3" />
                        <span className="text-[var(--fs-tiny)] font-medium">润色</span>
                    </button>
                </Tooltip>
            ) : null}
                {!expanded && canExpandPrompt ? (
                    <Tooltip title="放大编辑">
                        <button
                            type="button"
                            className="canvas-node-composer-header-action grid size-6 shrink-0 place-items-center rounded-md"
                            onClick={() => setExpandedPromptOpen(true)}
                            aria-label="放大编辑提示词"
                        >
                            <Maximize2 className="size-3" />
                        </button>
                    </Tooltip>
                ) : null}
                {!expanded && onClose ? (
                    <Tooltip title="关闭">
                        <button
                            type="button"
                            className="canvas-node-composer-header-action grid size-6 shrink-0 place-items-center rounded-md"
                            onClick={onClose}
                            aria-label="关闭创作面板"
                        >
                            <X className="size-3" />
                        </button>
                    </Tooltip>
                ) : null}
            </div>
        </div>
    );

    const renderSubmitButton = (expanded: boolean) => {
        const showCost = creditsEnabled && credits !== null;
        const formattedCredits = credits?.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
        const actionLabel = isRunning ? "生成中" : showCost ? `${routeQuote?.estimated ? "预估" : "消耗"} ${formattedCredits} 积分，生成` : "生成";
        return (
            <Button
                type="text"
                className={`canvas-node-composer-submit canvas-node-composer-submit-canvas ${showCost ? "has-cost" : ""}`}
                disabled={isRunning || isSubmitDisabled}
                style={
                    {
                        color: isSubmitDisabled ? theme.node.faint : theme.node.text,
                        "--canvas-composer-submit-action": isSubmitDisabled ? theme.toolbar.itemHover : monochromeAccent,
                        "--canvas-composer-submit-action-fg": isSubmitDisabled ? theme.node.faint : theme.canvas.background,
                    } as CSSProperties
                }
                onClick={() => (expanded ? submitExpandedPrompt() : submit())}
                aria-label={actionLabel}
                title={routeQuote ? modelQuoteDescription(routeQuote) : actionLabel}
            >
                {showCost ? (
                    <span className="canvas-node-composer-submit-cost">
                        <CreditSymbol />
                        <span>{routeQuote?.estimated ? `预估:${formattedCredits}` : formattedCredits}</span>
                    </span>
                ) : null}
                <span className="canvas-node-composer-submit-action" aria-hidden>
                    {isRunning ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-3.5" strokeWidth={2.4} />}
                </span>
            </Button>
        );
    };

    const renderComposerControls = (expanded: boolean) =>
        simpleMode ? (
            <div className="canvas-node-composer-footer">
                <span className="min-w-0 truncate px-2 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                    {activeReferenceCount ? `已连接 ${activeReferenceCount} 个素材` : "将使用默认模型与参数"}
                </span>
                <ReferenceToolsPopover
                    canAutoMention={canAutoMention}
                    autoLinkEnabled={autoLinkEnabled}
                    onAutoMention={() => updatePrompt(autoMentionedPrompt)}
                    onAutoLinkEnabledChange={setAutoLinkEnabled}
                    accent={monochromeAccent}
                    compact
                />
                {renderSubmitButton(expanded)}
            </div>
        ) : (
            <div className="canvas-node-composer-footer">
                <div className={expanded ? "min-w-0 flex-1" : "canvas-node-composer-model"}>
                    <ModelPicker
                        className="!h-7 !w-full !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                        fullWidth
                        config={config}
                        value={config.model}
                        onChange={(model) => onConfigChange(node.id, mode === "image" ? { model, ...defaultImageParamsForModel(config, model) } : { model })}
                        capability={mode}
                        requirements={resolvedRequirements}
                        onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                        showSelectedPrice={false}
                        showOptionPrices={creditsEnabled}
                        variant="creation"
                        showConfiguredModelName
                    />
                </div>
                <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
                    <ReferenceToolsPopover
                        canAutoMention={canAutoMention}
                        autoLinkEnabled={autoLinkEnabled}
                        onAutoMention={() => updatePrompt(autoMentionedPrompt)}
                        onAutoLinkEnabledChange={setAutoLinkEnabled}
                        accent={monochromeAccent}
                        compact={!expanded}
                    />
                    {mode === "text" ? (
                        <>
                            <div className="flex h-7 items-center overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke }}>
                                <button type="button" aria-pressed={!node.metadata?.listMode} onClick={() => onConfigChange(node.id, { listMode: false })} className={`flex h-full items-center gap-1 px-2 text-[var(--fs-tiny)] transition-colors focus-visible:outline ${!node.metadata?.listMode ? "font-medium" : ""}`} style={!node.metadata?.listMode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.muted }}>
                                    <FileText className="size-3" />
                                    文本
                                </button>
                                <button type="button" aria-pressed={Boolean(node.metadata?.listMode)} onClick={() => onConfigChange(node.id, { listMode: true })} className={`flex h-full items-center gap-1 px-2 text-[var(--fs-tiny)] transition-colors focus-visible:outline ${node.metadata?.listMode ? "font-medium" : ""}`} style={node.metadata?.listMode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.muted }}>
                                    <LayoutList className="size-3" />
                                    列表
                                </button>
                            </div>
                            {!node.metadata?.listMode ? (
                                <Tooltip title={`文本生成份数（默认 1，可在生成配置中调整）`}>
                                    <InputNumber
                                        size="small"
                                        min={1}
                                        max={15}
                                        value={Math.max(1, Math.min(15, Math.floor(Math.abs(Number(node.metadata?.textCount) || 1))))}
                                        onChange={(value) =>
                                            onConfigChange(node.id, {
                                                textCount: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value) || 1)))),
                                            })
                                        }
                                        aria-label="文本生成份数"
                                        className="!w-14 !h-7 [&_.ant-input-number-input]:!text-[var(--fs-tiny)]"
                                    />
                                </Tooltip>
                            ) : <span className="text-[10px]" style={{ color: theme.node.muted }}>行数和列结构由模型判断</span>}
                        </>
                    ) : mode === "image" ? (
                        // 图片模式下，显示相机配置与镜头配置
                        <>
                            <CanvasCameraControlPopover
                                cameraControl={node.metadata?.cameraControl}
                                onCameraControlChange={(options) => onConfigChange(node.id, { cameraControl: options })}
                                theme={theme}
                                compact={!expanded}
                            />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement={expanded ? "topRight" : "topLeft"}
                                buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                                onOpenChange={expanded ? undefined : onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <CanvasVideoSettingsPopover
                            config={config}
                            buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                        />
                    ) : mode === "audio" ? (
                        <CanvasAudioSettingsPopover
                            config={config}
                            buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))}
                        />
                    ) : null}
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
                        onRemove={(reference) => onRemoveReference?.(node.id, reference)}
                        onReorder={onReorderReferences ? (orderedNodeIds) => onReorderReferences(node.id, orderedNodeIds) : undefined}
                        onReplaceReference={onReplaceReference ? (oldReference, sourceNodeId) => onReplaceReference(node.id, oldReference, sourceNodeId) : undefined}
                        onReplaceReferenceFiles={onReplaceReferenceFiles ? (oldReference, files) => onReplaceReferenceFiles(node.id, oldReference, files) : undefined}
                    />
                    <CanvasResourceMentionTextarea
                        value={prompt}
                        references={textareaReferences}
                        onSelectReference={onAddReference ? (reference) => onAddReference(node.id, reference) : undefined}
                        includeAssetLibrary
                        onChange={updatePrompt}
                        autoLinkEnabled={autoLinkEnabled}
                        onReferenceFilesDrop={onReplaceReferenceFiles ? (reference, files) => onReplaceReferenceFiles(node.id, reference, files) : undefined}
                        onContentSizeChange={expanded ? setExpandedPromptContentHeight : setPromptContentHeight}
                        containerClassName="min-h-0 flex-1"
                        className={expanded
                            ? "thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-3 py-2.5 text-[var(--fs-body-lg)] leading-6 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"
                            : "thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-2.5 py-1.5 text-[var(--fs-body)] leading-5 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"}
                        style={{ color: theme.node.text, outline: "none", boxShadow: "none" }}
                        placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                        aria-label={`${modeDisplayName(mode)}提示词`}
                    />
                </div>
                {!expanded && <PromptResizeHandle
                    height={height}
                    min={bounds.min}
                    max={bounds.max}
                    onResize={setManualPromptHeight}
                />}
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
            <div
                className="canvas-node-composer"
                style={composerSurfaceStyle}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
            {renderComposerHeader(false)}

            {renderPromptEditor(false)}

            {/* B区 参数区（对应 #98 决策2：默认折叠，手风琴展开）*/}
            {hasVideoPromptTools ? (
                <div className="canvas-node-composer-parameters overflow-hidden">
                    <button
                        type="button"
                        className="canvas-node-composer-parameters-toggle flex w-full items-center gap-1.5 rounded-[var(--r-md)] px-2 py-1 text-[var(--fs-micro)] font-medium transition-colors"
                        style={{ color: theme.node.muted }}
                        onClick={() => setParamsExpanded(!paramsExpanded)}
                        aria-expanded={paramsExpanded}
                        aria-label={paramsExpanded ? "收起参数" : "展开参数"}
                    >
                        <SlidersHorizontal className="size-3" strokeWidth={1.8} />
                        <span className="flex-1 text-left">参数</span>
                        <ChevronDown className={`size-3 transition-transform duration-200 ${paramsExpanded ? "rotate-180" : ""}`} strokeWidth={1.8} />
                    </button>
                    {paramsExpanded ? (
                        <div className="pt-1">
                            <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                        </div>
                    ) : null}
                </div>
            ) : null}

            {renderComposerControls(false)}

            <Modal
                className="canvas-prompt-editor-modal"
                open={expandedPromptOpen}
                title={null}
                footer={null}
                centered
                width={expandedModalSize ? expandedModalSize.width : PROMPT_EDITOR_MODAL_WIDTH}
                style={{ maxWidth: `calc(100vw - ${PROMPT_EDITOR_VIEWPORT_MARGIN}px)` }}
                destroyOnHidden
                onCancel={() => {
                    setExpandedPresetOpen(false);
                    setExpandedNineGridOpen(false);
                    setExpandedPromptOpen(false);
                }}
                styles={{
                    container: { border: 0, borderRadius: "var(--canvas-composer-radius)", padding: 0, overflow: "hidden", background: theme.node.panel, boxShadow: theme.node.shadow },
                    body: { minHeight: 0, padding: 0 },
                }}
            >
                <div ref={expandedModalRef} className="relative flex min-h-0 flex-col" style={{ ...composerTokens, color: theme.node.text, maxHeight: `calc(100dvh - ${PROMPT_EDITOR_VIEWPORT_MARGIN}px)`, ...(expandedModalSize ? { height: expandedModalSize.height } : null) }}>
                    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
                        <div className="shrink-0 pr-8">{renderComposerHeader(true)}</div>
                        {renderPromptEditor(true, Boolean(expandedModalSize))}
                        {hasVideoPromptTools ? (
                            <div className="canvas-node-composer-parameters shrink-0">
                                <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                            </div>
                        ) : null}
                        <div className="shrink-0">{renderComposerControls(true)}</div>
                    </div>
                    <PromptModalResizeHandle size={expandedModalSize} measure={measureExpandedModalSize} onResize={setExpandedModalSize} accent={theme.node.muted} />
                </div>
            </Modal>

            </div>
        </CanvasPromptOptimizerDrawer>
    );
}

function ReferenceToolsPopover({ canAutoMention, autoLinkEnabled, onAutoMention, onAutoLinkEnabledChange, accent, compact }: { canAutoMention: boolean; autoLinkEnabled: boolean; onAutoMention: () => void; onAutoLinkEnabledChange: (enabled: boolean) => void; accent: string; compact: boolean }) {
    return (
        <Popover
            trigger="click"
            placement="topRight"
            rootClassName="canvas-reference-tools-popover"
            arrow={false}
            align={{ offset: [0, -8] }}
            styles={{ root: { width: "min(280px, calc(100vw - 24px))" }, container: { width: "100%" }, content: { width: "100%", padding: 10 } }}
            content={
                <div className="space-y-1.5">
                    <div>
                        <div className="text-sm font-medium leading-5">智能引用</div>
                        <div className="mt-0.5 text-xs leading-4 text-black/50 dark:text-white/50">输入素材序号或名称后按 Tab，可快速引用</div>
                    </div>
                    <div className="flex min-h-6 items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm"><Link2 className="size-3.5" />AutoLink</div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={autoLinkEnabled}
                            aria-label={autoLinkEnabled ? "关闭 AutoLink" : "开启 AutoLink"}
                            className="canvas-reference-autolink-switch relative inline-flex h-5 w-9 items-center rounded-full border transition-colors"
                            style={{ background: autoLinkEnabled ? `${accent}14` : "transparent", borderColor: autoLinkEnabled ? accent : "color-mix(in srgb, currentColor 22%, transparent)", color: accent }}
                            onClick={() => onAutoLinkEnabledChange(!autoLinkEnabled)}
                        >
                            <span className={`size-3.5 rounded-full shadow-sm transition-transform ${autoLinkEnabled ? "translate-x-[18px]" : "translate-x-0.5"}`} style={{ background: autoLinkEnabled ? accent : "currentColor" }} />
                        </button>
                    </div>
                    <button
                        type="button"
                        className="canvas-reference-tools-mention-button flex h-7 w-full items-center justify-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                        style={{ borderColor: accent, color: accent, background: "transparent" }}
                        disabled={!canAutoMention}
                        onClick={onAutoMention}
                    >
                        <AtSign className="size-3.5" />一键引用全文
                    </button>
                </div>
            }
        >
            <button
                type="button"
                className={`canvas-node-composer-settings-trigger canvas-node-composer-reference-tools-trigger inline-flex shrink-0 items-center gap-1 ${compact ? "is-compact" : ""}`}
                aria-label="打开智能引用"
                title="智能引用"
            >
                <SlidersHorizontal className="size-3.5" />
                {!compact ? <span>引用</span> : null}
            </button>
        </Popover>
    );
}

function GenerationModeIcon({ mode }: { mode: CanvasNodeGenerationMode }) {
    if (mode === "image") return <ImagePlus className="size-3" />;
    if (mode === "video") return <Video className="size-3" />;
    if (mode === "audio") return <Music2 className="size-3" />;
    return <FileText className="size-3" />;
}

function modeDisplayName(mode: CanvasNodeGenerationMode) {
    if (mode === "image") return "图片";
    if (mode === "video") return "视频";
    if (mode === "audio") return "音频";
    return "文本";
}

function referenceShelfHeading(references: CanvasResourceReference[]) {
    const label = references.every((reference) => reference.kind === "image" || reference.kind === "character") ? "参考图" : "参考素材";
    return `${label} · ${references.length}`;
}

function ConnectedReferenceShelf({
    targetNodeId,
    references,
    theme,
    onInsert,
    onRemove,
    onReorder,
    onReplaceReference,
    onReplaceReferenceFiles,
}: {
    targetNodeId?: string;
    references: CanvasResourceReference[];
    theme: CanvasTheme;
    onInsert: (reference: CanvasResourceReference) => void;
    onRemove?: (reference: CanvasResourceReference) => void;
    onReorder?: (orderedNodeIds: string[]) => void;
    onReplaceReference?: (oldReference: CanvasResourceReference, sourceNodeId: string) => void;
    onReplaceReferenceFiles?: (oldReference: CanvasResourceReference, files: File[]) => void;
}) {
    const activeReferences = references.filter((item) => item.active && item.kind !== "skill" && item.kind !== "tool");
    const [imagePreview, setImagePreview] = useState<CanvasResourceReference | null>(null);
    const [draggedReferenceId, setDraggedReferenceId] = useState<string | null>(null);
    const [dropTargetReferenceId, setDropTargetReferenceId] = useState<string | null>(null);
    if (!activeReferences.length) return null;

    const moveReference = (sourceId: string, targetId: string) => {
        if (!onReorder || sourceId === targetId) return;
        const sourceIndex = activeReferences.findIndex((reference) => reference.nodeId === sourceId);
        const targetIndex = activeReferences.findIndex((reference) => reference.nodeId === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const ordered = [...activeReferences];
        const [moved] = ordered.splice(sourceIndex, 1);
        ordered.splice(targetIndex, 0, moved);
        onReorder(ordered.map((reference) => reference.nodeId));
    };

    const moveReferenceByOffset = (sourceId: string, offset: -1 | 1) => {
        const sourceIndex = activeReferences.findIndex((reference) => reference.nodeId === sourceId);
        const target = activeReferences[sourceIndex + offset];
        if (!target) return;
        moveReference(sourceId, target.nodeId);
    };

    return (
        <>
            <div className="canvas-node-composer-references" role="group" aria-label="已连接素材">
                <div className="canvas-node-composer-references-track thin-scrollbar">
                    {activeReferences.map((reference, index) => {
                        const canPreview = Boolean(reference.previewUrl) && (reference.kind === "image" || reference.kind === "character" || reference.kind === "video");
                        const isDropTarget = dropTargetReferenceId === reference.id;
                        return (
                            <span
                                key={reference.id}
                                className="canvas-node-reference-chip relative"
                                data-reference-chip="true"
                                data-reference-id={reference.id}
                                data-reference-node-id={reference.nodeId}
                                data-reference-label={reference.label}
                                data-reference-title={reference.title || reference.label}
                                data-target-node-id={targetNodeId}
                                data-dragging={draggedReferenceId === reference.nodeId || undefined}
                                data-drop-target={isDropTarget ? "true" : undefined}
                                style={{
                                    boxShadow: isDropTarget ? "0 0 0 2px #3b82f6, 0 0 16px rgba(59, 130, 246, 0.45)" : undefined,
                                }}
                                onDragOver={(event) => {
                                    if (draggedReferenceId) {
                                        if (!onReorder) return;
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "move";
                                        return;
                                    }
                                    const hasImageNode = event.dataTransfer.types.includes("application/x-canvas-image-node-id");
                                    const hasFiles = event.dataTransfer.types.includes("Files");
                                    if (hasImageNode || hasFiles) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        event.dataTransfer.dropEffect = "copy";
                                        if (dropTargetReferenceId !== reference.id) {
                                            setDropTargetReferenceId(reference.id);
                                        }
                                    }
                                }}
                                onDragLeave={(event) => {
                                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                        if (dropTargetReferenceId === reference.id) {
                                            setDropTargetReferenceId(null);
                                        }
                                    }
                                }}
                                onDrop={(event) => {
                                    if (dropTargetReferenceId === reference.id) {
                                        setDropTargetReferenceId(null);
                                    }
                                    if (draggedReferenceId) {
                                        event.preventDefault();
                                        const sourceId = draggedReferenceId || event.dataTransfer.getData("text/plain");
                                        setDraggedReferenceId(null);
                                        moveReference(sourceId, reference.nodeId);
                                        return;
                                    }
                                    const sourceNodeId = event.dataTransfer.getData("application/x-canvas-image-node-id");
                                    if (sourceNodeId && sourceNodeId !== reference.nodeId && onReplaceReference) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onReplaceReference(reference, sourceNodeId);
                                        return;
                                    }
                                    const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
                                    if (files.length && onReplaceReferenceFiles) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onReplaceReferenceFiles(reference, files);
                                        return;
                                    }
                                }}
                            >
                                {onReorder ? (
                                    <button
                                        type="button"
                                        className="canvas-node-reference-drag-handle"
                                        draggable
                                        title={`拖动调整 ${reference.label} 的顺序`}
                                        aria-label={`调整 ${reference.label} 的顺序；使用左右方向键也可移动`}
                                        onDragStart={(event) => {
                                            setDraggedReferenceId(reference.nodeId);
                                            event.dataTransfer.effectAllowed = "move";
                                            event.dataTransfer.setData("text/plain", reference.nodeId);
                                        }}
                                        onDragEnd={() => setDraggedReferenceId(null)}
                                        onKeyDown={(event) => {
                                            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                            event.preventDefault();
                                            moveReferenceByOffset(reference.nodeId, event.key === "ArrowLeft" ? -1 : 1);
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                    >
                                        <GripVertical className="size-3" />
                                    </button>
                                ) : null}
                                <span className="canvas-node-reference-order" aria-hidden>{index + 1}</span>
                                <button
                                    type="button"
                                    className="canvas-node-reference-preview"
                                    style={{ background: theme.toolbar.itemHover, color: theme.node.text, outlineColor: theme.node.activeStroke }}
                                    title={canPreview ? `预览 ${reference.title}` : `插入 @${reference.label}`}
                                    aria-label={canPreview ? `预览 ${reference.title}` : `插入 @${reference.label}`}
                                    onClick={() => (canPreview ? setImagePreview(reference) : onInsert(reference))}
                                >
                                    <ReferenceThumbnail reference={reference} />
                                    {canPreview ? (
                                        <span className="canvas-node-reference-preview-hint" aria-hidden="true">
                                            <Maximize2 className="size-3" />
                                        </span>
                                    ) : null}
                                </button>
                                <button type="button" className="canvas-node-reference-label" title={`插入 @${reference.label}`} onClick={() => onInsert(reference)}>
                                    <span className="opacity-55">@</span>
                                    <span className="truncate">{reference.label}</span>
                                </button>
                                {onRemove ? (
                                    <button
                                        type="button"
                                        className="canvas-node-reference-remove"
                                        style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                                        title="移除参考并删除连接"
                                        aria-label={`移除参考 ${reference.label}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onRemove(reference);
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </span>
                        );
                    })}
                </div>
            </div>
            {imagePreview?.previewUrl ? (
                <AntImage
                    src={imagePreview.previewUrl}
                    alt={imagePreview.title || imagePreview.label}
                    style={{ display: "none" }}
                    preview={{
                        open: true,
                        movable: true,
                        minScale: 0.5,
                        maxScale: 12,
                        scaleStep: 0.25,
                        onOpenChange: (open) => !open && setImagePreview(null),
                    }}
                />
            ) : null}
        </>
    );
}

function ReferenceThumbnail({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full bg-black object-cover" loading="lazy" decoding="async" />;
    if (reference.kind === "character" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full bg-black/5 object-contain" />;

    const Icon = reference.sourceType === CanvasNodeType.Drawing ? Pencil : reference.kind === "character" ? UserRound : reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-full place-items-center bg-black/10 text-current dark:bg-white/10">
            <Icon className="size-3.5 opacity-75" />
        </span>
    );
}

function PromptResizeHandle({ height, min, max, onResize }: { height: number; min: number; max: number; onResize: (height: number) => void }) {
    const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

    const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowUp") {
            event.preventDefault();
            onResize(Math.max(min, height - 8));
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            onResize(Math.min(max, height + 8));
        } else if (event.key === "Home") {
            event.preventDefault();
            onResize(min);
        } else if (event.key === "End") {
            event.preventDefault();
            onResize(max);
        }
    };

    return (
        <button
            type="button"
            className="canvas-node-composer-resize-handle"
            role="separator"
            aria-label="调整提示词输入高度"
            aria-orientation="horizontal"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={Math.round(height)}
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                    dragRef.current = null;
                    return;
                }
                if ((event.buttons & 1) === 0) {
                    finishResize(event);
                    return;
                }
                onResize(Math.min(max, Math.max(min, drag.startHeight + event.clientY - drag.startY)));
            }}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onLostPointerCapture={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
        >
            <span aria-hidden />
        </button>
    );
}

function clampExpandedModalSize(size: { width: number; height: number }) {
    return clampPromptEditorModalSize(size, { width: window.innerWidth, height: window.innerHeight });
}

function PromptModalResizeHandle({ size, measure, onResize, accent }: { size: { width: number; height: number } | null; measure: () => { width: number; height: number }; onResize: (size: { width: number; height: number }) => void; accent: string }) {
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; width: number; height: number } | null>(null);

    const finishResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        const step = event.shiftKey ? 40 : 12;
        const widthDelta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const heightDelta = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        if (!widthDelta && !heightDelta) return;
        event.preventDefault();
        event.stopPropagation();
        const base = size ?? measure();
        onResize(clampExpandedModalSize({ width: base.width + widthDelta, height: base.height + heightDelta }));
    };

    return (
        <button
            type="button"
            className="absolute bottom-1.5 right-1.5 z-10 grid size-5 cursor-nwse-resize touch-none place-items-center opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2"
            aria-label="拖动调整窗口大小"
            title="拖动调整窗口宽高，也可用方向键调整"
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.preventDefault();
                event.stopPropagation();
                const base = measure();
                dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ...base };
                onResize(clampExpandedModalSize(base));
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                    dragRef.current = null;
                    return;
                }
                if ((event.buttons & 1) === 0) {
                    finishResize(event);
                    return;
                }
                event.stopPropagation();
                // The modal stays centered, so each edge moves by half the size change.
                onResize(clampExpandedModalSize({ width: drag.width + 2 * (event.clientX - drag.startX), height: drag.height + 2 * (event.clientY - drag.startY) }));
            }}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onLostPointerCapture={(event) => {
                if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
        >
            <span aria-hidden className="absolute bottom-1 right-1 size-2 rounded-br border-b-2 border-r-2" style={{ borderColor: accent }} />
        </button>
    );
}

function promptEditorBounds(expanded: boolean, hasReferences: boolean) {
    const shelfHeight = hasReferences ? PROMPT_REFERENCE_SHELF_HEIGHT : 0;
    const min = (expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT) + shelfHeight;
    const max = (expanded ? PROMPT_EDITOR_EXPANDED_LINE_HEIGHT * PROMPT_EDITOR_EXPANDED_MAX_LINES + PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING : PROMPT_EDITOR_LINE_HEIGHT * PROMPT_EDITOR_MAX_LINES + PROMPT_EDITOR_VERTICAL_PADDING) + shelfHeight;
    return { min, max };
}

function estimatePromptContentHeight(value: string, expanded: boolean) {
    if (!value.trim()) return expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT;
    const charsPerLine = expanded ? 34 : 38;
    const lineCount = value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0);
    const lineHeight = expanded ? PROMPT_EDITOR_EXPANDED_LINE_HEIGHT : PROMPT_EDITOR_LINE_HEIGHT;
    const verticalPadding = expanded ? PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING : PROMPT_EDITOR_VERTICAL_PADDING;
    return Math.max(expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT, lineCount * lineHeight + verticalPadding);
}

function clampPromptHeight(height: number, bounds: { min: number; max: number }) {
    return Math.min(bounds.max, Math.max(bounds.min, height));
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text || type === CanvasNodeType.Skill ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

export function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode, requirements: ModelRequirements): AiConfig {
    node = { ...node, metadata: canonicalGenerationMetadata(node, mode) };
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const preferredModel = resolveCanvasGenerationModel(globalConfig, node.metadata?.model, mode) || resolveCanvasGenerationModel(globalConfig, defaultModel, mode) || fallbackModel;
    const model = resolveCompatibleModel(globalConfig, preferredModel, mode === "image" ? { ...requirements, imageSize: node.metadata?.size || globalConfig.size || defaultConfig.size } : requirements) || preferredModel;
    const defaults = resolveModelGenerationDefaults(
        globalConfig,
        model,
        mode === "image" ? "image" : mode === "video" ? "video" : undefined,
        mode === "image"
            ? {
                  size: node.metadata?.size,
                  quality: node.metadata?.quality,
                  transparentBackground: node.metadata?.transparentBackground,
                  videoWatermark: node.metadata?.watermark,
                  count: String(node.metadata?.count || globalConfig.canvasImageCount || globalConfig.count || defaultConfig.count),
              }
            : {
                  size: node.metadata?.size,
                  videoSeconds: node.metadata?.seconds,
                  vquality: node.metadata?.vquality,
                  videoGenerateAudio: node.metadata?.generateAudio,
                  videoWatermark: node.metadata?.watermark,
              },
        {
            size: globalConfig.size || defaultConfig.size,
            quality: globalConfig.quality || defaultConfig.quality,
            transparentBackground: globalConfig.transparentBackground || defaultConfig.transparentBackground,
            count: String(globalConfig.canvasImageCount || globalConfig.count || defaultConfig.count),
            videoSeconds: globalConfig.videoSeconds || defaultConfig.videoSeconds,
            vquality: globalConfig.vquality || defaultConfig.vquality,
            videoGenerateAudio: globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
            videoWatermark: globalConfig.videoWatermark || defaultConfig.videoWatermark,
        },
    );
    return {
        ...globalConfig,
        model,
        quality: defaults.quality ?? globalConfig.quality ?? defaultConfig.quality,
        size: defaults.size ?? globalConfig.size ?? defaultConfig.size,
        transparentBackground: defaults.transparentBackground ?? "false",
        videoSeconds: defaults.videoSeconds ?? normalizeVideoDuration(globalConfig.videoSeconds ?? defaultConfig.videoSeconds),
        vquality: defaults.vquality ?? normalizeVideoResolution(globalConfig.vquality || defaultConfig.vquality),
        videoGenerateAudio: defaults.videoGenerateAudio ?? globalConfig.videoGenerateAudio ?? defaultConfig.videoGenerateAudio,
        videoWatermark: defaults.videoWatermark ?? globalConfig.videoWatermark ?? defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: defaults.count ?? String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "输入新提示词，重新生成当前图片" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoArkPrivateAssetUpload") return { arkPrivateAssetUpload: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
