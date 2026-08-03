import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUp, AtSign, Boxes, ChevronDown, FileText, ImageIcon, ImagePlus, Maximize2, Music2, Pencil, SlidersHorizontal, Square, UserRound, Video } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { configuredModelMatchesCapability, defaultConfig, modelOptionName, resolveModelChannel, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useThemeStore } from "@/stores/use-theme-store";
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

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange, workspaceMode = "professional" }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const simpleMode = workspaceMode === "simple";
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const savedPrompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const [prompt, setPrompt] = useState(savedPrompt);
    const [presetOpen, setPresetOpen] = useState(false);
    const [expandedPresetOpen, setExpandedPresetOpen] = useState(false);
    const [expandedPromptOpen, setExpandedPromptOpen] = useState(false);
    const [promptContentHeight, setPromptContentHeight] = useState(0);
    const [paramsExpanded, setParamsExpanded] = useState(false); // #98 决策2：B区参数区折叠状态（手风琴）
    const generationCount = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const priceChannel = resolveModelChannel(config, config.model);
    const credits = requestCreditCost({ channelMode: priceChannel.scope === "system" ? "remote" : "local", modelCosts: priceChannel.modelCosts, model: modelOptionName(config.model), count: mode === "image" ? generationCount : 1, seconds: mode === "video" ? config.videoSeconds : 1 });
    const activeReferenceCount = mentionReferences.filter((item) => item.active && item.kind !== "skill").length;
    const videoFrameOptions = mentionReferences
        .filter((item) => item.active && item.kind === "image")
        .map((item) => ({ nodeId: item.nodeId, label: item.label, title: item.title, previewUrl: item.previewUrl }));
    const darkSurface = themeName === "dark";
    const monochromeAccent = theme.node.activeStroke;
    const shellBorder = darkSurface ? "rgba(255,255,255,.08)" : "rgba(15,23,42,.08)";
    const insetBorder = darkSurface ? "rgba(255,255,255,.06)" : "rgba(15,23,42,.07)";
    const shellSurface = darkSurface
        ? theme.canvas.background
        : "rgba(250,251,252,.97)";
    const composerSurface = darkSurface
        ? theme.canvas.background
        : "rgba(15,23,42,.025)";
    const controlSurface = darkSurface ? theme.canvas.background : "rgba(15,23,42,.045)";
    const controlsSurface = darkSurface ? controlSurface : "transparent";
    const shellShadow = darkSurface ? `0 22px 60px ${theme.spatial.shadow}, 0 2px 8px rgba(0,0,0,.22)` : "0 12px 32px rgba(15,23,42,.10), 0 1px 2px rgba(15,23,42,.06)";
    const composerShadow = darkSurface ? "inset 0 1px 4px rgba(0,0,0,.22)" : "inset 0 0 0 1px rgba(15,23,42,.045)";
    const modalShadow = darkSurface ? `0 30px 90px ${theme.spatial.shadow}` : "0 24px 72px rgba(15,23,42,.16)";
    const referenceShelfHeight = activeReferenceCount ? 42 : 0;
    const composerMinHeight = activeReferenceCount ? 82 : 58;
    const composerHeight = Math.min(144, Math.max(composerMinHeight, Math.ceil(promptContentHeight + referenceShelfHeight)));
    const isSubmitDisabled = !isRunning && !prompt.trim();
    const canExpandPrompt = mode === "image" || mode === "video";
    const isPortraitTexture = mode === "image" && Boolean(node.metadata?.portraitTexture);
    const updatePromptContentHeight = useCallback((height: number) => {
        setPromptContentHeight((current) => Math.abs(current - height) < 1 ? current : height);
    }, []);

    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    }, [node.id, node.metadata?.composerContent, node.metadata?.prompt]);

    useEffect(() => setPromptContentHeight(0), [node.id]);

    useEffect(() => {
        setExpandedPromptOpen(false);
        setExpandedPresetOpen(false);
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
        <div className="flex min-w-0 items-center gap-1 px-0.5">
            {isPortraitTexture ? (
                <CanvasPortraitTexturePopover
                    value={node.metadata?.portraitTexture}
                    placement={expanded ? "topRight" : "topLeft"}
                    onChange={(portraitTexture) => onConfigChange(node.id, { portraitTexture })}
                />
            ) : (
                <div className="flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-white/[.04]" style={{ background: controlSurface }}>
                    <span className="grid size-3.5 shrink-0 place-items-center" style={{ color: monochromeAccent }}>
                        <GenerationModeIcon mode={mode} />
                    </span>
                    <span className="truncate text-[var(--fs-tiny)] font-medium">{modeDisplayName(mode)}创作</span>
                </div>
            )}
            {!simpleMode ? (
                <CanvasPresetPicker
                    mode={mode}
                    skillReferences={skillReferences}
                    open={expanded ? expandedPresetOpen : presetOpen}
                    onOpenChange={expanded ? setExpandedPresetOpen : setPresetOpen}
                    onSelect={applyPreset}
                    dense
                />
            ) : null}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
                {activeReferenceCount ? <ComposerPill theme={theme} borderColor={insetBorder} icon={<Boxes className="size-2.5" />} label={`已连接 ${activeReferenceCount} 个`} /> : null}
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

    const renderComposerControls = (expanded: boolean) => simpleMode ? (
        <div className="flex min-w-0 items-center justify-between gap-2 p-1" style={{ background: controlsSurface }}>
            <span className="min-w-0 truncate px-2 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                {activeReferenceCount ? `已连接 ${activeReferenceCount} 个素材` : "将使用默认模型与参数"}
            </span>
            <Button
                type="text"
                className="!inline-flex !h-8 shrink-0 !items-center !gap-1 !rounded-full !px-2.5 !text-[var(--fs-tiny)] !font-medium"
                danger={isRunning}
                disabled={isSubmitDisabled}
                style={{ background: isSubmitDisabled ? theme.toolbar.itemHover : isRunning ? theme.accent.danger : monochromeAccent, color: isSubmitDisabled ? theme.node.faint : isRunning ? "#ffffff" : theme.canvas.background, boxShadow: isSubmitDisabled ? "none" : `0 8px 20px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,.18)` }}
                onClick={() => (isRunning ? onStop(node.id) : expanded ? submitExpandedPrompt() : submit())}
                aria-label={isRunning ? "停止生成" : "生成"}
            >
                {isRunning ? <Square className="size-2.5 fill-current" /> : <ArrowUp className="size-3" />}
                {isRunning ? "停止" : "生成"}
            </Button>
        </div>
    ) : (
        <div className="flex min-w-0 items-center justify-between gap-0.5 p-1" style={{ background: controlsSurface }}>
            <div className={`${expanded ? "max-w-[320px]" : mode === "image" || mode === "video" ? "max-w-[240px]" : "max-w-[174px]"} min-w-[104px] flex-1`}>
                <ModelPicker className="!h-7 !w-full !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3" fullWidth config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} onMissingConfig={() => navigateToSettings({ continueCreation: true })} showSelectedPrice={false} />
            </div>
            <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
                {mode === "image" ? (
                    <CanvasImageSettingsPopover
                        config={config}
                        placement={expanded ? "topRight" : "topLeft"}
                        buttonClassName="!h-7 !w-[146px] !justify-start !rounded-full !border-0 !px-2.5 !text-[var(--fs-tiny)] !font-normal !shadow-none [&>span]:min-w-0 [&_.lucide]:!size-3"
                        onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                        onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                        onOpenChange={expanded ? undefined : onImageSettingsOpenChange}
                    />
                ) : mode === "video" ? (
                    <CanvasVideoSettingsPopover config={config} buttonClassName="!h-7 !w-[144px] !justify-start !rounded-full !border-0 !px-2.5 !text-[var(--fs-tiny)] !font-normal !shadow-none [&>span]:min-w-0 [&_.lucide]:!size-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover config={config} buttonClassName="!h-7 !w-[146px] !justify-start !rounded-full !border-0 !px-2.5 !text-[var(--fs-tiny)] !font-normal !shadow-none [&>span]:min-w-0 [&_.lucide]:!size-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                ) : null}
                <GenerationCostBadge credits={credits} theme={theme} />
                <Button
                    type="text"
                    className="!inline-flex !h-8 !w-8 shrink-0 !items-center !justify-center !rounded-full !border !p-0 transition hover:!-translate-y-px hover:!brightness-110 motion-reduce:hover:!translate-y-0"
                    danger={isRunning}
                    disabled={isSubmitDisabled}
                    style={{ background: isSubmitDisabled ? theme.toolbar.itemHover : isRunning ? theme.accent.danger : monochromeAccent, borderColor: isSubmitDisabled ? insetBorder : monochromeAccent, color: isSubmitDisabled ? theme.node.faint : theme.canvas.background, boxShadow: isSubmitDisabled ? "none" : `0 8px 20px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,.18)` }}
                    onClick={() => (isRunning ? onStop(node.id) : expanded ? submitExpandedPrompt() : submit())}
                    aria-label={isRunning ? "停止生成" : "生成"}
                >
                    {isRunning ? <Square className="size-2.5 fill-current" /> : <ArrowUp className="size-3" />}
                </Button>
            </div>
        </div>
    );

    return (
        <div
            className="aceternity-floating-panel relative overflow-hidden rounded-xl border p-2"
            style={{ background: shellSurface, borderColor: shellBorder, color: theme.node.text, boxShadow: shellShadow }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {renderComposerHeader(false)}

            <div
                className="relative mt-2 flex max-h-36 flex-col overflow-hidden rounded-xl outline-none ring-0 transition-[height] duration-150 focus-within:outline-none focus-within:ring-0 motion-reduce:transition-none"
                style={{ height: composerHeight, background: composerSurface, boxShadow: composerShadow }}
            >
                <ConnectedReferenceShelf references={mentionReferences} theme={theme} onInsert={insertPromptReference} />
                <CanvasResourceMentionTextarea
                    value={prompt}
                    references={mentionReferences}
                    onChange={updatePrompt}
                    containerClassName="min-h-0 flex-1"
                    className="thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-2.5 py-2 text-[var(--fs-body)] leading-5 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"
                    style={{ color: theme.node.text, outline: "none", boxShadow: "none" }}
                    placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                    onContentSizeChange={updatePromptContentHeight}
                />
            </div>

            {/* B区 参数区（对应 #98 决策2：默认折叠，手风琴展开）*/}
            {mode === "video" && !simpleMode ? (
                <div className="mt-1.5 overflow-hidden rounded-md border" style={{ background: controlSurface, borderColor: insetBorder }}>
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
                        <div className="border-t p-0.5" style={{ borderColor: insetBorder }}>
                            <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="mt-1.5">{renderComposerControls(false)}</div>

            <Modal
                className="canvas-prompt-editor-modal"
                open={expandedPromptOpen}
                title={null}
                footer={null}
                centered
                width={760}
                destroyOnHidden
                onCancel={() => { setExpandedPresetOpen(false); setExpandedPromptOpen(false); }}
                styles={{ container: { display: "flex", height: "min(440px, calc(100vh - 40px))", flexDirection: "column", borderRadius: 12, border: `1px solid ${shellBorder}`, padding: 0, overflow: "hidden", background: shellSurface, boxShadow: modalShadow }, body: { minHeight: 0, flex: 1, padding: 0 } }}
            >
                <div className="flex h-full min-h-0 flex-col gap-2.5 p-3" style={{ color: theme.node.text }}>
                    <div className="shrink-0 pr-8">{renderComposerHeader(true)}</div>
                    <div
                        className="flex min-h-[240px] flex-1 flex-col overflow-hidden rounded-xl outline-none ring-0 focus-within:outline-none focus-within:ring-0"
                        style={{ background: composerSurface, boxShadow: composerShadow }}
                    >
                        <ConnectedReferenceShelf references={mentionReferences} theme={theme} onInsert={insertPromptReference} />
                        <CanvasResourceMentionTextarea
                            value={prompt}
                            references={mentionReferences}
                            onChange={updatePrompt}
                            containerClassName="min-h-0 flex-1"
                            className="thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-3 py-2.5 text-[var(--fs-body-lg)] leading-6 !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none placeholder:text-current placeholder:opacity-35"
                            style={{ color: theme.node.text, outline: "none", boxShadow: "none" }}
                            placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                            aria-label={`${modeDisplayName(mode)}提示词`}
                        />
                    </div>
                    {mode === "video" && !simpleMode ? (
                        <div className="shrink-0 rounded-md border p-0.5" style={{ background: controlSurface, borderColor: insetBorder }}>
                            <CanvasVideoPromptTools metadata={node.metadata} frameOptions={videoFrameOptions} onMetadataChange={(patch) => onConfigChange(node.id, patch)} />
                        </div>
                    ) : null}
                    <div className="shrink-0">{renderComposerControls(true)}</div>
                </div>
            </Modal>
        </div>
    );
}

function ComposerPill({ theme, borderColor, icon, label }: { theme: CanvasTheme; borderColor: string; icon: ReactNode; label: string }) {
    return (
        <span
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[var(--fs-micro)] font-medium transition hover:brightness-125"
            style={{ background: theme.canvas.background, borderColor, color: theme.node.activeStroke }}
        >
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
    if (!activeReferences.length) return null;

    return (
        <div className="thin-scrollbar flex h-[42px] shrink-0 min-w-0 items-center gap-1.5 overflow-x-auto px-2.5 pt-1.5" role="group" aria-label="已连接素材">
            {activeReferences.map((reference, index) => (
                <button
                    key={reference.id}
                    type="button"
                    className="group relative size-[34px] shrink-0 overflow-hidden rounded-md text-left transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 motion-reduce:hover:translate-y-0"
                    style={{ background: theme.toolbar.itemHover, color: theme.node.text, outlineColor: theme.node.activeStroke, boxShadow: `0 4px 14px ${theme.spatial.shadow}` }}
                    title={`插入 @${reference.label}`}
                    aria-label={`插入 @${reference.label}`}
                    onClick={() => onInsert(reference)}
                >
                    <span className="block size-full overflow-hidden rounded-md">
                        <ReferenceThumbnail reference={reference} />
                    </span>
                    <span className="absolute left-0.5 top-0.5 grid size-3.5 place-items-center rounded-full bg-black/65 text-[var(--fs-micro)] font-semibold text-white backdrop-blur-sm">{index + 1}</span>
                    <span className="absolute bottom-0.5 right-0.5 grid size-3.5 place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm"><AtSign className="size-2" /></span>
                </button>
            ))}
        </div>
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

function GenerationCostBadge({ credits, theme }: { credits: number | null; theme: CanvasTheme }) {
    if (credits === null) return null;
    return (
        <span className="canvas-generation-cost-badge inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[var(--fs-micro)] font-semibold tabular-nums" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }} title={`预计消耗 ${credits.toLocaleString()} 积分`} aria-label={`预计消耗 ${credits.toLocaleString()} 积分`}>
            <CreditSymbol className="text-[var(--fs-label)]" />
            {credits.toLocaleString()}
        </span>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text || type === CanvasNodeType.Skill ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const storedModel = node.metadata?.model;
    const model = storedModel && configuredModelMatchesCapability(globalConfig, storedModel, mode) ? storedModel : defaultModel && configuredModelMatchesCapability(globalConfig, defaultModel, mode) ? defaultModel : fallbackModel;
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
