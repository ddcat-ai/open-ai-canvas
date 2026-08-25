import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowUp, AtSign, Boxes, ChevronDown, FileText, ImageIcon, ImagePlus, Maximize2, Music2, Pencil, SlidersHorizontal, UserRound, Video, WandSparkles, X } from "lucide-react";
import { Button, Image as AntImage, InputNumber, Modal, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelOptionName, resolveModelChannel, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { modelRequestOptions, resolveCompatibleModel, resolveModelGenerationDefaults, defaultImageParamsForModel, type ModelRequirements } from "@/lib/model-selection";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasVideoPromptTools } from "./canvas-video-prompt-tools";
import { CanvasPresetPicker, type CanvasPromptPreset } from "./canvas-preset-picker";
import { CanvasPortraitTexturePopover } from "./canvas-portrait-texture-popover";
import { CanvasPromptOptimizerDrawer } from "./canvas-prompt-optimizer-drawer";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode } from "@/types/canvas";
import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { promptOptimizerPlugin, PROMPT_OPTIMIZER_PLUGIN_ID } from "@/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "@/services/plugin-host";
import { usePluginStore } from "@/stores/use-plugin-store";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onRemoveReference?: (nodeId: string, reference: CanvasResourceReference) => void;
    onClose?: () => void;
    onNodeMouseDown?: (event: ReactPointerEvent, nodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    workspaceMode?: CanvasWorkspaceMode;
};

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

const PROMPT_REFERENCE_SHELF_HEIGHT = 36;
const PROMPT_EDITOR_MIN_HEIGHT = 44;
const PROMPT_EDITOR_EXPANDED_MIN_HEIGHT = 76;
const PROMPT_EDITOR_LINE_HEIGHT = 20;
const PROMPT_EDITOR_EXPANDED_LINE_HEIGHT = 24;
const PROMPT_EDITOR_VERTICAL_PADDING = 12;
const PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING = 20;
const PROMPT_EDITOR_MAX_LINES = 8;

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, mentionReferences = [], onRemoveReference, onClose, onNodeMouseDown, onImageSettingsOpenChange, workspaceMode = "professional" }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const promptOptimizerInstallation = usePluginStore((state) => state.installations.find((item) => item.manifest.id === PROMPT_OPTIMIZER_PLUGIN_ID));
    const simpleMode = workspaceMode === "simple";
    const mode = defaultMode(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const savedPrompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const [prompt, setPrompt] = useState(savedPrompt);
    const [presetOpen, setPresetOpen] = useState(false);
    const [expandedPresetOpen, setExpandedPresetOpen] = useState(false);
    const [expandedPromptOpen, setExpandedPromptOpen] = useState(false);
    const [promptContentHeight, setPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, false));
    const [expandedPromptContentHeight, setExpandedPromptContentHeight] = useState(() => estimatePromptContentHeight(savedPrompt, true));
    const [manualPromptHeight, setManualPromptHeight] = useState<number | null>(null);
    const [manualExpandedPromptHeight, setManualExpandedPromptHeight] = useState<number | null>(null);
    const [paramsExpanded, setParamsExpanded] = useState(false); // #98 决策2：B区参数区折叠状态（手风琴）
    const [promptOptimizerOpen, setPromptOptimizerOpen] = useState(false);
    const activeReferences = mentionReferences.filter((item) => item.active && item.kind !== "skill");
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
        videoSeconds: mode === "video" ? node.metadata?.seconds || globalConfig.videoSeconds : undefined,
        options: modelRequestOptions({
            ...globalConfig,
            size: node.metadata?.size || globalConfig.size,
            quality: node.metadata?.quality || globalConfig.quality,
            count: String(node.metadata?.count || globalConfig.count),
            videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds,
            vquality: node.metadata?.vquality || globalConfig.vquality,
            videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio,
            videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark,
            audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice,
            audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat,
            audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed,
        }, mode),
    };
    const config = buildNodeConfig(globalConfig, node, mode, requirements);
    const promptOptimizerProvider = useMemo(() => {
        if (!promptOptimizerInstallation?.enabled || !promptOptimizerPlugin.createPromptOptimizer) return null;
        return promptOptimizerPlugin.createPromptOptimizer(createPluginHostContext(promptOptimizerPlugin, promptOptimizerInstallation, globalConfig));
    }, [globalConfig, promptOptimizerInstallation]);
    const generationCount = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const priceChannel = resolveModelChannel(config, config.model);
    const credits = requestCreditCost({
        channelMode: priceChannel.scope === "system" ? "remote" : "local",
        modelCosts: priceChannel.modelCosts,
        model: modelOptionName(config.model),
        count: mode === "image" ? generationCount : 1,
        seconds: mode === "video" ? config.videoSeconds : 1,
    });
    const activeReferenceCount = activeReferences.length;
    const videoFrameOptions = mentionReferences.filter((item) => item.active && item.kind === "image").map((item) => ({ nodeId: item.nodeId, label: item.label, title: item.title, previewUrl: item.previewUrl }));
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
    const expandedComposerHeight = clampPromptHeight(manualExpandedPromptHeight ?? expandedPromptContentHeight + (activeReferenceCount ? PROMPT_REFERENCE_SHELF_HEIGHT : 0), expandedPromptBounds);
    const isSubmitDisabled = !isRunning && !prompt.trim();
    const canExpandPrompt = mode === "image" || mode === "video";
    const canOptimizePrompt = Boolean(promptOptimizerProvider) && canExpandPrompt;
    const isPortraitTexture = mode === "image" && Boolean(node.metadata?.portraitTexture);

    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    }, [node.id, node.metadata?.composerContent, node.metadata?.prompt]);

    useEffect(() => {
        setExpandedPromptOpen(false);
        setExpandedPresetOpen(false);
        setPromptContentHeight(estimatePromptContentHeight(savedPrompt, false));
        setExpandedPromptContentHeight(estimatePromptContentHeight(savedPrompt, true));
        setManualPromptHeight(null);
        setManualExpandedPromptHeight(null);
    }, [node.id]);

    const skillReferences = useMemo(() => mentionReferences.filter((item) => item.kind === "skill"), [mentionReferences]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        onPromptChange(node.id, value);
        if (/(^|\s)\/[\p{L}\p{N}_-]*$/u.test(value)) {
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
        if (pendingMentionMatch) {
            const prefix = prompt.slice(0, pendingMentionMatch.index).replace(/\s*$/, "");
            updatePrompt(prefix ? `${prefix} ${insertText}` : insertText);
            return;
        }
        const basePrompt = prompt.replace(/\s*$/, "");
        updatePrompt(basePrompt ? `${basePrompt} ${insertText}` : insertText);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return false;
        onGenerate(node.id, mode, text);
        return true;
    };

    const submitExpandedPrompt = () => {
        if (submit()) {
            setExpandedPresetOpen(false);
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
                <CanvasPortraitTexturePopover value={node.metadata?.portraitTexture} placement={expanded ? "topRight" : "topLeft"} onChange={(portraitTexture) => onConfigChange(node.id, { portraitTexture })} />
            ) : (
                <div className="canvas-node-composer-mode">
                    <span className="grid size-3.5 shrink-0 place-items-center" style={{ color: monochromeAccent }}>
                        <GenerationModeIcon mode={mode} />
                    </span>
                    <span className="truncate text-[var(--fs-tiny)] font-medium">{modeDisplayName(mode)}创作</span>
                </div>
            )}
            {!simpleMode ? <CanvasPresetPicker mode={mode} skillReferences={skillReferences} open={expanded ? expandedPresetOpen : presetOpen} onOpenChange={expanded ? setExpandedPresetOpen : setPresetOpen} onSelect={applyPreset} dense /> : null}
            {canOptimizePrompt ? (
                <Tooltip title="用 AI 优化提示词">
                    <button
                        type="button"
                        className="canvas-node-composer-icon-button inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 transition-[background-color,filter] hover:brightness-125 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 motion-reduce:hover:translate-y-0"
                        style={{ background: controlSurface, color: theme.node.text, outlineColor: monochromeAccent }}
                        onClick={() => setPromptOptimizerOpen(true)}
                        aria-label="优化提示词"
                    >
                        <WandSparkles className="size-3" />
                        <span className="hidden text-[var(--fs-micro)] font-medium sm:inline">优化</span>
                    </button>
                </Tooltip>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
                {activeReferenceCount ? <ComposerPill theme={theme} icon={<Boxes className="size-2.5" />} label={`参考 ${activeReferenceCount}`} /> : null}
                {!expanded && canExpandPrompt ? (
                    <Tooltip title="放大编辑">
                        <button
                            type="button"
                            className="canvas-node-composer-icon-button grid size-6 shrink-0 place-items-center rounded-md transition-[background-color,filter] hover:brightness-125 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 motion-reduce:hover:translate-y-0"
                            style={{ background: controlSurface, color: theme.node.text, outlineColor: monochromeAccent }}
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
                            className="canvas-node-composer-icon-button grid size-6 shrink-0 place-items-center rounded-md transition-[background-color,filter] hover:brightness-125 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 motion-reduce:hover:translate-y-0"
                            style={{ background: controlSurface, color: theme.node.text, outlineColor: monochromeAccent }}
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
        const formattedCredits = credits?.toLocaleString();
        const actionLabel = isRunning ? "生成中" : showCost ? `预计消耗 ${formattedCredits} 积分，生成` : "生成";
        return (
            <Button
                type="text"
                className={`canvas-node-composer-submit ${showCost ? "has-cost" : ""}`}
                disabled={isRunning || isSubmitDisabled}
                style={
                    {
                        color: isSubmitDisabled ? theme.node.faint : theme.node.text,
                        "--canvas-composer-submit-action": isSubmitDisabled ? theme.toolbar.itemHover : isRunning ? theme.accent.danger : monochromeAccent,
                        "--canvas-composer-submit-action-fg": isSubmitDisabled ? theme.node.faint : theme.canvas.background,
                    } as CSSProperties
                }
                onClick={() => (expanded ? submitExpandedPrompt() : submit())}
                aria-label={actionLabel}
                title={actionLabel}
            >
                {showCost ? (
                    <span className="canvas-node-composer-submit-cost">
                        <CreditSymbol />
                        <span>{formattedCredits}</span>
                    </span>
                ) : null}
                <span className="canvas-node-composer-submit-action" aria-hidden>
                    {isRunning ? <span className="size-2.5 animate-pulse" aria-hidden="true" /> : <ArrowUp className="size-3" />}
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
                        requirements={requirements}
                        onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                        showSelectedPrice={false}
                        variant="creation"
                        showConfiguredModelName
                    />
                </div>
                <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
                    {mode === "text" ? (
                        <Tooltip title={`文本生成份数（默认 1，可在生成配置中调整）`}>
                            <InputNumber
                                size="small"
                                min={1}
                                max={15}
                                value={Math.max(1, Math.min(15, Math.floor(Math.abs(Number(node.metadata?.textCount) || 1))))}
                                onChange={(value) => onConfigChange(node.id, { textCount: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1))) })}
                                aria-label="文本生成份数"
                                className="!w-14 !h-7 [&_.ant-input-number-input]:!text-[var(--fs-tiny)]"
                            />
                        </Tooltip>
                    ) : mode === "image" ? (
                        <CanvasImageSettingsPopover
                            config={config}
                            placement={expanded ? "topRight" : "topLeft"}
                            buttonClassName="canvas-node-composer-settings-trigger [&>span]:min-w-0 [&_.lucide]:!size-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                            onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                            onOpenChange={expanded ? undefined : onImageSettingsOpenChange}
                        />
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

    const renderPromptEditor = (expanded: boolean) => {
        const bounds = expanded ? expandedPromptBounds : promptBounds;
        const height = expanded ? expandedComposerHeight : composerHeight;
        return (
            <>
                <div className="canvas-node-composer-editor" style={{ height }}>
                    <ConnectedReferenceShelf references={mentionReferences} theme={theme} onInsert={insertPromptReference} onRemove={(reference) => onRemoveReference?.(node.id, reference)} />
                    <CanvasResourceMentionTextarea
                        value={prompt}
                        references={mentionReferences}
                        includeAssetLibrary
                        onChange={updatePrompt}
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
                <PromptResizeHandle
                    height={height}
                    min={bounds.min}
                    max={bounds.max}
                    onResize={expanded ? setManualExpandedPromptHeight : setManualPromptHeight}
                />
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
                width={920}
                destroyOnHidden
                onCancel={() => {
                    setExpandedPresetOpen(false);
                    setExpandedPromptOpen(false);
                }}
                styles={{
                    container: { border: 0, borderRadius: "var(--canvas-composer-radius)", padding: 0, overflow: "hidden", background: theme.node.panel, boxShadow: theme.node.shadow },
                    body: { minHeight: 0, padding: 0 },
                }}
            >
                <div className="flex min-h-0 flex-col gap-2.5 p-3" style={{ ...composerTokens, color: theme.node.text }}>
                    <div className="shrink-0 pr-8">{renderComposerHeader(true)}</div>
                    {renderPromptEditor(true)}
                    {hasVideoPromptTools ? (
                        <div className="canvas-node-composer-parameters shrink-0">
                            <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                        </div>
                    ) : null}
                    <div className="shrink-0">{renderComposerControls(true)}</div>
                </div>
            </Modal>

            </div>
        </CanvasPromptOptimizerDrawer>
    );
}

function ComposerPill({ theme, icon, label }: { theme: CanvasTheme; icon: ReactNode; label: string }) {
    return (
        <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--r-sm)] px-1.5 text-[var(--fs-micro)] font-medium" style={{ background: "var(--canvas-composer-control-surface)", color: theme.node.activeStroke }}>
            {icon}
            {label}
        </span>
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

function ConnectedReferenceShelf({ references, theme, onInsert, onRemove }: { references: CanvasResourceReference[]; theme: CanvasTheme; onInsert: (reference: CanvasResourceReference) => void; onRemove?: (reference: CanvasResourceReference) => void }) {
    const activeReferences = references.filter((item) => item.active && item.kind !== "skill");
    const [imagePreview, setImagePreview] = useState<CanvasResourceReference | null>(null);
    if (!activeReferences.length) return null;

    return (
        <>
            <div className="canvas-node-composer-references thin-scrollbar" role="group" aria-label="已连接素材">
                {activeReferences.map((reference) => {
                    const canPreview = (reference.kind === "image" || reference.kind === "character") && Boolean(reference.previewUrl);
                    return (
                        <span key={reference.id} className="canvas-node-reference-chip">
                            <button
                                type="button"
                                className="canvas-node-reference-preview"
                                style={{ background: theme.toolbar.itemHover, color: theme.node.text, outlineColor: theme.node.activeStroke }}
                                title={canPreview ? `预览 ${reference.title}` : `插入 @${reference.label}`}
                                aria-label={canPreview ? `预览 ${reference.title}` : `插入 @${reference.label}`}
                                onClick={() => (canPreview ? setImagePreview(reference) : onInsert(reference))}
                            >
                                <ReferenceThumbnail reference={reference} />
                            </button>
                            <button type="button" className="canvas-node-reference-label" title={`插入 @${reference.label}`} onClick={() => onInsert(reference)}>
                                <AtSign className="size-2.5" />
                                <span>{reference.label}</span>
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
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-full bg-black object-cover" muted preload="metadata" />;
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

function promptEditorBounds(expanded: boolean, hasReferences: boolean) {
    const shelfHeight = hasReferences ? PROMPT_REFERENCE_SHELF_HEIGHT : 0;
    const min = (expanded ? PROMPT_EDITOR_EXPANDED_MIN_HEIGHT : PROMPT_EDITOR_MIN_HEIGHT) + shelfHeight;
    const max = (expanded ? PROMPT_EDITOR_EXPANDED_LINE_HEIGHT * PROMPT_EDITOR_MAX_LINES + PROMPT_EDITOR_EXPANDED_VERTICAL_PADDING : PROMPT_EDITOR_LINE_HEIGHT * PROMPT_EDITOR_MAX_LINES + PROMPT_EDITOR_VERTICAL_PADDING) + shelfHeight;
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

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode, requirements: ModelRequirements): AiConfig {
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
        quality: defaults.quality || globalConfig.quality || defaultConfig.quality,
        size: defaults.size || globalConfig.size || defaultConfig.size,
        transparentBackground: defaults.transparentBackground || "false",
        videoSeconds: defaults.videoSeconds || normalizeVideoDuration(globalConfig.videoSeconds || defaultConfig.videoSeconds),
        vquality: defaults.vquality || normalizeVideoResolution(globalConfig.vquality || defaultConfig.vquality),
        videoGenerateAudio: defaults.videoGenerateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: defaults.videoWatermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: defaults.count || String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
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
