import type { CSSProperties } from "react";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Video } from "lucide-react";
import { Button, InputNumber, Segmented, Select } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { configuredModelMatchesCapability, defaultConfig, modelOptionName, resolveModelChannel, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelCompatibilityError, modelRequestOptions, resolveCompatibleModel, resolveModelGenerationDefaults, defaultImageParamsForModel, type ModelRequirements } from "@/lib/model-selection";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata, CanvasVideoEditOperation, CanvasWorkspaceMode } from "@/types/canvas";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number; characterCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onComposerToggle: () => void;
    workspaceMode?: CanvasWorkspaceMode;
};

const videoOperationOptions: Array<{ label: string; value: CanvasVideoEditOperation }> = [
    { label: "文生视频", value: "text_to_video" },
    { label: "图生视频", value: "image_to_video" },
    { label: "全模态参考", value: "reference_to_video" },
    { label: "视频续写", value: "extend" },
    { label: "局部修改", value: "inpaint" },
    { label: "元素替换", value: "replace_element" },
    { label: "运镜调整", value: "camera_motion" },
    { label: "风格迁移", value: "style_transfer" },
    { label: "音频生视频", value: "audio_to_video" },
    { label: "版本对比", value: "compare_versions" },
];

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onComposerToggle, workspaceMode = "professional" }: CanvasConfigNodePanelProps) {
    const globalConfig = useEffectiveConfig();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const mode = node.metadata?.generationMode || "image";
    const simpleMode = workspaceMode === "simple";
    const requirements: ModelRequirements = {
        capability: mode,
        input: inputSummary,
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
    const videoProfile = mode === "video" ? modelCapabilityConfigFor(config, config.model).video! : undefined;
    const operationOptions = videoProfile ? videoOperationOptions.filter((item) => videoProfile.operations.includes(item.value) || item.value === "concat") : videoOperationOptions;
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const textCountValue = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(node.metadata?.textCount) || 1))));
    const priceChannel = resolveModelChannel(config, config.model);
    const credits = requestCreditCost({ channelMode: priceChannel.scope === "system" ? "remote" : "local", modelCosts: priceChannel.modelCosts, model: modelOptionName(config.model), count: mode === "image" ? count : 1, seconds: mode === "video" ? config.videoSeconds : 1 });
    const hasPrice = creditsEnabled && credits !== null;
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount || inputSummary.characterCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const capabilityError = modelCompatibilityError(config, config.model, requirements);
    const canGenerate = (hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput)) && !capabilityError;

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">{simpleMode ? "快速生成" : "生成配置"}</div>
                {simpleMode ? <span className="rounded-md px-2 py-1 text-[var(--fs-tiny)]" style={{ background: theme.node.fill, color: theme.node.muted }}>自动配置</span> : <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        size="small"
                        className="canvas-config-mode !rounded-md !p-0.5"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, { generationMode: value as CanvasGenerationMode })}
                        options={[
                            {
                                value: "image",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />
                                        生图
                                    </span>
                                ),
                            },
                            {
                                value: "text",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />
                                        文本
                                    </span>
                                ),
                            },
                            {
                                value: "video",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />
                                        视频
                                    </span>
                                ),
                            },
                            {
                                value: "audio",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />
                                        音频
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>}
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
                <InputChip label="提示词" value={`${inputSummary.textCount} 个`} style={chipStyle} />
                <InputChip label="参考图" value={`${inputSummary.imageCount} 张`} style={chipStyle} />
                <InputChip label="参考视频" value={`${inputSummary.videoCount} 个`} style={chipStyle} />
                <InputChip label="参考音频" value={`${inputSummary.audioCount} 个`} style={chipStyle} />
                {inputSummary.characterCount ? <InputChip label="角色卡" value={`${inputSummary.characterCount} 个`} style={chipStyle} /> : null}
                <button type="button" className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[var(--fs-label)]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                    {simpleMode ? <MessageSquare className="size-3.5" /> : <Settings2 className="size-3.5" />}
                    {simpleMode ? "编辑生成内容" : "组装提示词"}
                </button>
            </div>

            {mode === "video" && !simpleMode ? (
                <div className="mb-2 cursor-default" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <Select
                        size="small"
                        className="canvas-compact-control canvas-control-select !h-9 !w-full"
                        value={node.metadata?.videoEditOperation || defaultVideoOperation(inputSummary)}
                        options={operationOptions}
                        placement="bottomLeft"
                        popupMatchSelectWidth={false}
                        styles={{ popup: { root: { minWidth: 180, maxWidth: 260 } } }}
                        popupRender={(menu) => (
                            <div data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                                {menu}
                            </div>
                        )}
                        onChange={(value) => onConfigChange(node.id, { videoEditOperation: value })}
                    />
                </div>
            ) : null}

            {simpleMode ? (
                <div className="mb-2 rounded-lg px-2 py-2 text-[var(--fs-label)]" style={{ background: theme.node.fill, color: theme.node.muted }}>将使用当前默认模型与生成参数</div>
            ) : (
                <div className={`mb-2 grid min-w-0 cursor-default items-center gap-2 ${mode === "image" || mode === "video" || mode === "audio" || mode === "text" ? "grid-cols-[minmax(0,1fr)_148px]" : "grid-cols-1"}`} onMouseDown={(event) => event.stopPropagation()}>
                    <ModelPicker className="canvas-compact-control h-10" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, mode === "image" ? { model, ...defaultImageParamsForModel(config, model) } : { model })} capability={mode} requirements={requirements} onMissingConfig={() => navigateToSettings({ continueCreation: true })} fullWidth showSelectedPrice={creditsEnabled} />
                    {mode === "text" ? (
                        <div className="flex h-10 min-w-0 cursor-default items-center justify-between gap-2 rounded-lg border px-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }} data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                            <span className="inline-flex items-center gap-1 text-[var(--fs-tiny)] font-semibold" style={{ color: theme.node.muted }}><MessageSquare className="size-3.5" />文本份数</span>
                            <InputNumber size="small" min={1} max={15} value={textCountValue} onChange={(value) => onConfigChange(node.id, { textCount: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 1))) })} aria-label="文本生成份数" />
                        </div>
                    ) : mode === "video" ? (
                        <CanvasVideoSettingsPopover config={config} placement="topRight" buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                    ) : mode === "image" ? (
                        <CanvasImageSettingsPopover config={config} placement="topRight" autoAdjustOverflow={false} buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })} />
                    ) : mode === "audio" ? (
                        <CanvasAudioSettingsPopover config={config} placement="topRight" buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                    ) : null}
                </div>
            )}

            {capabilityError ? <div className="mb-2 rounded-md px-2 py-1.5 text-[var(--fs-tiny)]" style={{ background: theme.accent.danger + "18", color: theme.accent.danger }}>{capabilityError}</div> : null}

            <Button
                type="primary"
                className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"
                disabled={isRunning || !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onGenerate(node.id)}
            >
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />
                            <span>生成中</span>
                        </>
                    ) : (
                        <>
                            {!creditsEnabled ? (
                                <span>生成</span>
                            ) : hasPrice ? (
                                <span className="inline-flex items-center gap-1">
                                    <CreditSymbol />
                                    {credits.toLocaleString()}
                                </span>
                            ) : (
                                <span className="text-xs" title="当前渠道没有模型价格数据">
                                    无价格
                                </span>
                            )}
                            <Play className="size-4" />
                            <span>开始生成</span>
                        </>
                    )}
                </span>
            </Button>
        </div>
    );
}

function defaultVideoOperation(inputSummary: CanvasConfigNodePanelProps["inputSummary"]): CanvasVideoEditOperation {
    const visualInputCount = inputSummary.imageCount + inputSummary.characterCount;
    if (inputSummary.audioCount > 0 && visualInputCount === 0 && inputSummary.videoCount === 0) return "audio_to_video";
    if (inputSummary.videoCount > 0) return "extend";
    if (visualInputCount > 0) return "image_to_video";
    return "text_to_video";
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[var(--fs-label)]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode, requirements: ModelRequirements): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const storedModel = node.metadata?.model;
    const preferredModel = storedModel && configuredModelMatchesCapability(globalConfig, storedModel, mode) ? storedModel : defaultModel && configuredModelMatchesCapability(globalConfig, defaultModel, mode) ? defaultModel : fallbackModel;
    const model = resolveCompatibleModel(globalConfig, preferredModel, mode === "image" ? { ...requirements, imageSize: node.metadata?.size || globalConfig.size || defaultConfig.size } : requirements) || preferredModel;
    const generationDefaults = resolveModelGenerationDefaults(
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
    const videoProfile = mode === "video" ? modelCapabilityConfigFor(globalConfig, model).video! : undefined;
    return {
        ...globalConfig,
        model,
        quality: generationDefaults.quality || globalConfig.quality || defaultConfig.quality,
        size: generationDefaults.size || globalConfig.size || defaultConfig.size,
        transparentBackground: generationDefaults.transparentBackground || "false",
        videoSeconds: generationDefaults.videoSeconds || normalizeVideoDuration(globalConfig.videoSeconds || defaultConfig.videoSeconds),
        vquality: generationDefaults.vquality || normalizeVideoResolution(globalConfig.vquality || defaultConfig.vquality),
        videoGenerateAudio: videoProfile?.generateAudio.supported ? generationDefaults.videoGenerateAudio || String(videoProfile.generateAudio.default) : "false",
        videoWatermark: videoProfile?.watermark.supported ? generationDefaults.videoWatermark || String(videoProfile.watermark.default) : "false",
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: generationDefaults.count || String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
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
