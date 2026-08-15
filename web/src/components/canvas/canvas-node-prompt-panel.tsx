import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowUp, AtSign, Boxes, ChevronDown, FileText, ImageIcon, ImagePlus, Maximize2, Music2, Pencil, SlidersHorizontal, Square, UserRound, Video } from "lucide-react";
import { Button, Image as AntImage, Modal, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, modelOptionName, resolveModelChannel, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
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
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode } from "@/types/canvas";
import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
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

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange, workspaceMode = "professional" }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const simpleMode = workspaceMode === "simple";
    const mode = defaultMode(node.type);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const savedPrompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const [prompt, setPrompt] = useState(savedPrompt);
    const [presetOpen, setPresetOpen] = useState(false);
    const [expandedPresetOpen, setExpandedPresetOpen] = useState(false);
    const [expandedPromptOpen, setExpandedPromptOpen] = useState(false);
    const [promptContentHeight, setPromptContentHeight] = useState(PROMPT_EDITOR_MIN_HEIGHT);
    const [expandedPromptContentHeight, setExpandedPromptContentHeight] = useState(PROMPT_EDITOR_EXPANDED_MIN_HEIGHT);
    const [manualPromptHeight, setManualPromptHeight] = useState<number | null>(null);
    const [manualExpandedPromptHeight, setManualExpandedPromptHeight] = useState<number | null>(null);
    const [paramsExpanded, setParamsExpanded] = useState(false); // #98 决策2：B区参数区折叠状态（手风琴）
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
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds,
    };
    const config = buildNodeConfig(globalConfig, node, mode, requirements);
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
    const monochromeAccent = theme.node.activeStroke;
    const controlSurface = "var(--canvas-composer-control-surface)";
    const promptBounds = promptEditorBounds(false, activeReferenceCount > 0);
    const expandedPromptBounds = promptEditorBounds(true, activeReferenceCount > 0);
    const composerHeight = clampPromptHeight(manualPromptHeight ?? promptContentHeight + (activeReferenceCount ? PROMPT_REFERENCE_SHELF_HEIGHT : 0), promptBounds);
    const expandedComposerHeight = clampPromptHeight(manualExpandedPromptHeight ?? expandedPromptContentHeight + (activeReferenceCount ? PROMPT_REFERENCE_SHELF_HEIGHT : 0), expandedPromptBounds);
    const isSubmitDisabled = !isRunning && !prompt.trim();
    const canExpandPrompt = mode === "image" || mode === "video";
    const isPortraitTexture = mode === "image" && Boolean(node.metadata?.portraitTexture);

    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    }, [node.id, node.metadata?.composerContent, node.metadata?.prompt]);

    useEffect(() => {
        setExpandedPromptOpen(false);
        setExpandedPresetOpen(false);
        setPromptContentHeight(PROMPT_EDITOR_MIN_HEIGHT);
        setExpandedPromptContentHeight(PROMPT_EDITOR_EXPANDED_MIN_HEIGHT);
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
        <div className="canvas-node-composer-header">
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
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
                {activeReferenceCount ? <ComposerPill theme={theme} icon={<Boxes className="size-2.5" />} label={`参考 ${activeReferenceCount}`} /> : null}
                {!expanded && canExpandPrompt ? (
                    <Tooltip title="放大编辑">
                        <button
                            type="button"
                            className="grid size-6 shrink-0 place-items-center rounded-md transition hover:bg-white/[.06] hover:brightness-125 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 motion-reduce:hover:translate-y-0"
                            style={{ background: controlSurface, color: theme.node.text, outlineColor: monochromeAccent }}
                            onClick={() => setExpandedPromptOpen(true)}
                            aria-label="放大编辑提示词"
                        >
                            <Maximize2 className="size-3" />
                        </button>
                    </Tooltip>
                ) : null}
            </div>
        </div>
    );

    const renderSubmitButton = (expanded: boolean) => {
        const showCost = creditsEnabled && credits !== null;
        const formattedCredits = credits?.toLocaleString();
        const actionLabel = isRunning ? "停止生成" : showCost ? `预计消耗 ${formattedCredits} 积分，生成` : "生成";
        return (
            <Button
                type="text"
                className={`canvas-node-composer-submit ${showCost ? "has-cost" : ""}`}
                danger={isRunning}
                disabled={isSubmitDisabled}
                style={
                    {
                        color: isSubmitDisabled ? theme.node.faint : theme.node.text,
                        "--canvas-composer-submit-action": isSubmitDisabled ? theme.toolbar.itemHover : isRunning ? theme.accent.danger : monochromeAccent,
                        "--canvas-composer-submit-action-fg": isSubmitDisabled ? theme.node.faint : theme.canvas.background,
                    } as CSSProperties
                }
                onClick={() => (isRunning ? onStop(node.id) : expanded ? submitExpandedPrompt() : submit())}
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
                    {isRunning ? <Square className="size-2.5 fill-current" /> : <ArrowUp className="size-3" />}
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
                        onChange={(model) => onConfigChange(node.id, { model })}
                        capability={mode}
                        requirements={requirements}
                        onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                        showSelectedPrice={false}
                        variant="creation"
                        showConfiguredModelName
                    />
                </div>
                <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
                    {mode === "image" ? (
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
                    <ConnectedReferenceShelf references={mentionReferences} theme={theme} onInsert={insertPromptReference} />
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
        <div
            className="canvas-node-composer"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {renderComposerHeader(false)}

            {renderPromptEditor(false)}

            {/* B区 参数区（对应 #98 决策2：默认折叠，手风琴展开）*/}
            {mode === "video" && !simpleMode ? (
                <div className="canvas-node-composer-parameters overflow-hidden">
                    <button
                        type="button"
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-[var(--fs-micro)] font-medium transition-colors hover:bg-white/[.04]"
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
                    container: { border: 0, borderRadius: "var(--canvas-composer-radius)", padding: 0, overflow: "hidden", background: "var(--canvas-composer-surface)", boxShadow: "var(--canvas-composer-shadow)" },
                    body: { minHeight: 0, padding: 0 },
                }}
            >
                <div className="flex min-h-0 flex-col gap-2.5 p-3" style={{ color: theme.node.text }}>
                    <div className="shrink-0 pr-8">{renderComposerHeader(true)}</div>
                    {renderPromptEditor(true)}
                    {mode === "video" && !simpleMode ? (
                        <div className="canvas-node-composer-parameters shrink-0">
                            <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                        </div>
                    ) : null}
                    <div className="shrink-0">{renderComposerControls(true)}</div>
                </div>
            </Modal>
        </div>
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

function ConnectedReferenceShelf({ references, theme, onInsert }: { references: CanvasResourceReference[]; theme: CanvasTheme; onInsert: (reference: CanvasResourceReference) => void }) {
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
    const model = resolveCompatibleModel(globalConfig, preferredModel, requirements) || preferredModel;
    return {
        ...globalConfig,
        model,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        transparentBackground: (node.metadata?.transparentBackground || globalConfig.transparentBackground) === "true" ? "true" : "false",
        videoSeconds: normalizeVideoDuration(node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds),
        vquality: normalizeVideoResolution(node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality),
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
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
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
