import { preserveVideoSettings } from "@/lib/media-settings";
import { MediaSettingsNotice } from "@/components/media-settings-notice";
import { type ReactNode } from "react";
import { Switch } from "@/components/ui/base/switch";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceRatioOptions } from "@/lib/seedance-video";
import { isVolcengineArkVideoProtocol } from "@/lib/model-protocols";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { formatVideoResolutionLabel, isVideoResolutionMatch, normalizeVideoDuration, videoDimensionsForRatioAndResolution, videoResolutionComparisonKey, VIDEO_DURATION_MIN } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor, resolveVideoRatioValue, resolveVideoResolutionValue, videoDurationOptions, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { LL2_CONNECTED_VIDEO_MODELS, LL2_VIDEO_DURATION, ll2TiersFor, type LL2ConnectedVideoModel } from "@/lib/ll2-models";
import { ll2UpscaleTargetLabel, ll2UpscaleTargetsFor } from "@/lib/ll2-upscale";

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoArkPrivateAssetUpload" | "ll2PromptOptimizer" | "ll2Upscale", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel(props: VideoSettingsPanelProps) {
    return (
        <>
            <MediaSettingsNotice config={props.config} capability="video" onChange={(field, value) => props.onConfigChange(field as Parameters<VideoSettingsPanelProps["onConfigChange"]>[0], value)} />
            <VideoSettingsControls {...props} />
        </>
    );
}

function VideoSettingsControls({ config, onConfigChange, theme, showTitle = true, className = "w-[292px] space-y-3" }: VideoSettingsPanelProps) {
    if (isLL2VideoModel(config.model)) {
        return <LL2VideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    const profile = modelCapabilityConfigFor(config, config.model).video!;
    const priceTiers = modelPriceTiers(config);
    if (resolveModelRequestConfig(config, config.model).interfaceType === "volcengine-jimeng-video") {
        return <JiMengVideoSettingsPanel config={config} profile={profile} priceTiers={priceTiers} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} profile={profile} priceTiers={priceTiers} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const { seconds, resolution, ratio } = preserveVideoSettings(profile, { seconds: config.videoSeconds, resolution: config.vquality, ratio: config.size }, resolveModelRequestConfig(config, config.model).interfaceType);
    const dimensions = resolution === "auto" ? undefined : videoDimensionsForRatioAndResolution(ratio, resolution);
    const sizeSupported = profile.ratios.length > 0;
    const configuredResolutions = profile.resolutions.map((value) => ({ value, label: formatVideoResolutionLabel(value) }));
    const generateAudio = boolConfig(config.videoGenerateAudio, profile.generateAudio.default);
    const watermark = boolConfig(config.videoWatermark, profile.watermark.default);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                {configuredResolutions.length ? (
                    <SettingGroup title="分辨率" color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2">
                            {configuredResolutions.map((item) => (
                                <OptionPill
                                    key={item.value}
                                    selected={isVideoResolutionMatch(resolution, item.value)}
                                    disabled={!hasPriceTierForVideoSelection(priceTiers, item.value, Number(seconds))}
                                    theme={theme}
                                    onClick={() => onConfigChange("vquality", item.value)}
                                >
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                {sizeSupported ? (
                    <SettingGroup title="尺寸" color={theme.node.muted}>
                        {dimensions ? (
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                <DimensionValue prefix="W" value={dimensions.width} theme={theme} />
                                <span className="text-xs opacity-45">×</span>
                                <DimensionValue prefix="H" value={dimensions.height} theme={theme} />
                            </div>
                        ) : null}
                        <div className="grid grid-cols-3 gap-2">
                            {profile.ratios.map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    className="flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-1 text-[var(--fs-label)] font-medium transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                                    style={{ background: ratio === value ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", value)}
                                >
                                    <SizePreview width={ratioPreview(value).width} height={ratioPreview(value).height} color={theme.node.text} />
                                    <span>{value}</span>
                                </button>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, resolution, value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                {profile.generateAudio.supported || profile.watermark.supported ? (
                    <SettingGroup title="输出" color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-3 rounded-md px-2" style={{ background: theme.toolbar.itemHover }}>
                            {profile.generateAudio.supported ? <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                            {profile.watermark.supported ? <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function JiMengVideoSettingsPanel({ config, profile, priceTiers, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig; priceTiers: ReturnType<typeof modelPriceTiers> }) {
    const { seconds, ratio } = preserveVideoSettings(profile, { seconds: config.videoSeconds, ratio: config.size });
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2">
                        {profile.ratios.map((value) => (
                            <OptionPill key={value} selected={ratio === value} theme={theme} onClick={() => onConfigChange("size", value)}>
                                {value}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, "*", value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, profile, priceTiers, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig; priceTiers: ReturnType<typeof modelPriceTiers> }) {
    const model = modelOptionName(config.model || config.videoModel);
    const { resolution, ratio, seconds } = preserveVideoSettings(profile, { resolution: config.vquality, ratio: config.size, seconds: config.videoSeconds }, resolveModelRequestConfig(config, config.model || config.videoModel).interfaceType);
    const duration = Number(seconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, profile.generateAudio.default);
    const watermark = boolConfig(config.videoWatermark, profile.watermark.default);
    const useArkPrivateAssets = boolConfig(config.videoArkPrivateAssetUpload, true);
    const isArkSeedance = isVolcengineArkVideoProtocol(resolveModelRequestConfig(config, config.model).interfaceType);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2">
                        {profile.resolutions.map((value) => {
                            const item = { value, label: value.toUpperCase() };
                            const disabled = (item.value === "1080p" && isSeedanceFastModel(model)) || !hasPriceTierForVideoSelection(priceTiers, item.value, duration);
                            return (
                                <OptionPill key={item.value} selected={resolution === item.value} disabled={disabled} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            );
                        })}
                    </div>
                    {isSeedanceFastModel(model) ? <div className="text-[var(--fs-tiny)] leading-4 opacity-55">fast 模型自动使用 720P</div> : null}
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2">
                        {profile.ratios.map((value) => {
                            const item = { value, label: value };
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    className="flex h-11 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[var(--fs-tiny)] font-medium leading-none transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                                    style={{ background: ratio === item.value ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", item.value)}
                                >
                                    <span className="grid h-4 place-items-center">
                                        <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                    </span>
                                    <span className="whitespace-nowrap">{item.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <VideoDurationControl profile={profile} value={duration} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, resolution, value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-3 rounded-md px-2" style={{ background: theme.toolbar.itemHover }}>
                        {profile.generateAudio.supported ? <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                        {profile.watermark.supported ? <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
                    </div>
                </SettingGroup>
                {isArkSeedance ? (
                    <SettingGroup title="参考图" color={theme.node.muted}>
                        <div className="rounded-md px-2" style={{ background: theme.toolbar.itemHover }}>
                            <SwitchRow label="自动同步可信素材（确认拥有使用权）" checked={useArkPrivateAssets} theme={theme} onChange={(checked) => onConfigChange("videoArkPrivateAssetUpload", String(checked))} />
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return value === "auto" ? "自动" : formatVideoResolutionLabel(value);
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    // The compact summary must mirror the selected value (for example 16:9),
    // while the settings panel can still use semantic labels such as 横屏.
    if (ratio === value) return ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    return `${normalizeVideoDuration(value)}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className="h-8 cursor-pointer whitespace-nowrap rounded-md px-1 text-[var(--fs-label)] font-medium leading-none transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-35"
            style={{
                background: selected ? "#5b21b6" : "transparent",
                border: `1px solid ${selected ? "#8d54ff" : "transparent"}`,
                color: selected ? "#ffffff" : theme.node.text,
                outlineColor: theme.node.muted,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="text-[var(--fs-tiny)] font-semibold" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function DimensionValue({ prefix, value, theme }: { prefix: string; value: number; theme: CanvasTheme }) {
    return (
        <div className="flex h-8 overflow-hidden rounded-md text-[var(--fs-label)]" style={{ background: theme.toolbar.itemHover, color: theme.node.text }}>
            <span className="grid w-7 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <span className="min-w-0 flex-1 px-2 leading-8 tabular-nums">{value}</span>
        </div>
    );
}

function DurationInput({ value, min, max, theme, onChange }: { value: number; min: number; max?: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Math.min(max || Number.POSITIVE_INFINITY, Math.max(min, Math.floor(Number(input.value) || value || min)));
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-8 w-20 shrink-0 items-center overflow-hidden rounded-md border text-[var(--fs-label)]" style={{ background: theme.toolbar.itemHover, borderColor: theme.toolbar.border, color: theme.node.text }}>
            <input
                key={`${min}-${value}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                defaultValue={value}
                aria-label="视频时长（秒）"
                className="min-w-0 flex-1 bg-transparent pl-2 text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="shrink-0 px-2" style={{ color: theme.node.muted }}>
                秒
            </span>
        </label>
    );
}

function VideoDurationControl({ profile, value, theme, disabled, onChange }: { profile: VideoCapabilityConfig; value: number; theme: CanvasTheme; disabled?: (value: number) => boolean; onChange: (value: number) => void }) {
    if (profile.duration.selection === "range") {
        const min = profile.duration.min || VIDEO_DURATION_MIN;
        const max = Math.max(min, profile.duration.max || min);
        const step = Math.max(1, profile.duration.step || 1);
        const normalized = normalizeDurationValue(value, profile.duration.default, min, max, step);
        return (
            <DurationRangeControl
                value={normalized}
                min={min}
                max={max}
                step={step}
                theme={theme}
                onChange={(next) => {
                    if (!disabled?.(next)) onChange(next);
                }}
            />
        );
    }

    const options = videoDurationOptions(profile);
    return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
            {options.map((option) => (
                <OptionPill key={option} selected={normalizedNumber(value) === option} disabled={disabled?.(option)} theme={theme} onClick={() => onChange(option)}>
                    {option}s
                </OptionPill>
            ))}
        </div>
    );
}

function modelPriceTiers(config: AiConfig) {
    const channel = resolveModelChannel(config, config.model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(config.model));
    return cost?.logicalPriceTiers || [];
}

function hasPriceTierForVideoSelection(tiers: ReturnType<typeof modelPriceTiers>, resolution: string, seconds: number) {
    if (!tiers.length) return true;
    const normalizedResolution = normalizeTierResolution(resolution);
    return tiers.some((tier) => {
        const selector = tier.selector || {};
        const tierResolution = selector.vquality || tier.resolution;
        const tierSeconds = selector.videoSeconds ? Number(selector.videoSeconds) : tier.videoSeconds;
        return (tierResolution === "*" || !tierResolution || normalizeTierResolution(tierResolution) === normalizedResolution) && (!tierSeconds || tierSeconds === seconds);
    });
}

function normalizeTierResolution(value: string) {
    return videoResolutionComparisonKey(value);
}

function DurationRangeControl({ value, min, max, step, theme, onChange }: { value: number; min: number; max: number; step: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    return (
        <div className="space-y-2">
            <div className="flex min-w-0 items-center gap-2">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    aria-label="视频时长（秒）"
                    className="video-duration-range h-8 min-w-0 flex-1"
                    style={{ accentColor: theme.accent.primary }}
                    onChange={(event) => onChange(Number(event.target.value))}
                    onMouseDown={(event) => event.stopPropagation()}
                />
                <DurationInput value={value} min={min} max={max} theme={theme} onChange={onChange} />
            </div>
            <div className="flex justify-between px-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                <span>{min}s</span>
                <span>{max}s</span>
            </div>
        </div>
    );
}

function normalizeDurationValue(value: number, fallback: number, min: number, max: number, step: number) {
    const candidate = Number.isFinite(value) ? value : fallback;
    const clamped = Math.min(max, Math.max(min, Math.floor(candidate)));
    const maxStep = Math.max(0, Math.floor((max - min) / step));
    return min + Math.min(maxStep, Math.max(0, Math.round((clamped - min) / step))) * step;
}

function normalizedNumber(value: number) {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(7, Math.round((width / longSide) * 16));
    const previewHeight = Math.max(7, Math.round((height / longSide) * 16));
    return <span className="shrink-0 rounded-[4px] border" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-2">
            <span className="min-w-0 whitespace-nowrap text-[var(--fs-label)]" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span className="shrink-0" onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="sm" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

// ── LL2（BYOK）视频参数面板 ──────────────────────────────────────────────
// 影策原生的能力表不知道 LL2 的档位/时长（H3 固定 768P、全模型 4 秒起），
// 在 LL2 模型下改用这张表，避免画布里显示出 720P / 6 秒这种错参数。

/** 画布里的模型是「渠道::模型名」；取最后一段去和 LL2 模型表比对。 */
function ll2BaseModel(model: string): string {
    return (
        String(model || "")
            .split("::")
            .pop() || ""
    );
}

function isLL2VideoModel(model: string): model is LL2ConnectedVideoModel {
    return (LL2_CONNECTED_VIDEO_MODELS as readonly string[]).includes(ll2BaseModel(model));
}

const LL2_H3_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const LL2_WAN_RATIOS = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"];
const LL2_COMMON_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

function ll2RatioOptions(model: LL2ConnectedVideoModel) {
    if (model === "MiniMax-H3") return LL2_H3_RATIOS;
    if (model.startsWith("wan3.")) return LL2_WAN_RATIOS;
    return LL2_COMMON_RATIOS;
}

function ll2RadioDimensions(ratio: string, height: number) {
    if (ratio === "adaptive") return null;
    const [w, h] = ratio.split(":").map((part) => Number(part) || 1);
    return { width: Math.round((height * w) / h), height };
}

function LL2VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[292px] space-y-3" }: VideoSettingsPanelProps) {
    // 画布的模型可能带渠道前缀，个别渠道还会带上奇怪后缀；按「包含 H3」兜底，
    // 避免 H3 面板落回空档位、提示词优化卡片消失。
    const rawModel = ll2BaseModel(config.model);
    const model = (rawModel.includes("H3") ? "MiniMax-H3" : rawModel) as LL2ConnectedVideoModel;
    const tiers = ll2TiersFor(model) || [];
    const range = LL2_VIDEO_DURATION[model] || { min: 4, max: 15, default: 5 };
    const resolutions = tiers.map((tier) => tier.label);
    const ratios = ll2RatioOptions(model);
    // 画布配置把 vquality 归一化成数字（720），而 LL2 档位是 720P；
    // 用项目统一的 isVideoResolutionMatch 忽略 p 后缀，否则 wan3 永远回退第一档。
    const resolution = resolutions.find((label) => isVideoResolutionMatch(label, config.vquality)) || resolutions[0] || "768P";
    const ratio = ratios.includes(config.size) ? config.size : "16:9";
    const rawSeconds = Number(config.videoSeconds) || range.default;
    const seconds = Math.min(range.max, Math.max(range.min, Math.round(rawSeconds)));
    const sourceHeight = Number(resolution.replace(/[^0-9]/g, "")) || 768;
    const dimensions = ll2RadioDimensions(ratio, Math.min(2160, Math.max(480, sourceHeight)));
    return (
        <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
            {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
            <div className="space-y-2">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    分辨率
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {resolutions.map((value) => (
                        <LL2Pill key={value} selected={resolution === value} theme={theme} onClick={() => onConfigChange("vquality", value)}>
                            {value}
                        </LL2Pill>
                    ))}
                </div>
            </div>
            <div className="space-y-2">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    尺寸
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <LL2Dimension label="W" value={dimensions ? String(dimensions.width) : "跟随参考"} theme={theme} />
                    <span className="text-xs opacity-45">×</span>
                    <LL2Dimension label="H" value={dimensions ? String(dimensions.height) : "跟随参考"} theme={theme} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {ratios.map((value) => (
                        <LL2Pill key={value} selected={ratio === value} theme={theme} onClick={() => onConfigChange("size", value)}>
                            {value === "adaptive" ? "自适应" : value}
                        </LL2Pill>
                    ))}
                </div>
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between text-xs" style={{ color: theme.node.muted }}>
                    <span>秒数</span>
                    <span>{seconds} 秒</span>
                </div>
                <input type="range" aria-label="视频秒数" min={range.min} max={range.max} step={1} value={seconds} className="w-full accent-[var(--ll2-t-6720ff,#6720ff)]" onChange={(event) => onConfigChange("videoSeconds", event.target.value)} />
                <div className="flex justify-between text-[10px]" style={{ color: theme.node.muted }}>
                    <span>{range.min}s 起（LL2 最少 4 秒）</span>
                    <span>{range.max}s</span>
                </div>
            </div>
            <div className="space-y-2">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    附加
                </div>
                {model === "MiniMax-H3" ? (
                    <label className="flex items-center gap-2 rounded-md px-2 py-2 text-xs" style={{ background: theme.toolbar.itemHover }}>
                        <input type="checkbox" checked={config.ll2PromptOptimizer === "1"} onChange={(event) => onConfigChange("ll2PromptOptimizer", event.target.checked ? "1" : "")} />
                        <span>提示词优化（H3 先按官方格式整理）</span>
                    </label>
                ) : null}
                {ll2UpscaleTargetsFor(resolution).length ? (
                    <div className="space-y-1 rounded-md px-2 py-2" style={{ background: theme.toolbar.itemHover }}>
                        <label className="flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={Boolean(config.ll2Upscale)} onChange={(event) => onConfigChange("ll2Upscale", event.target.checked ? ll2UpscaleTargetsFor(resolution)[0]?.id || "" : "")} />
                            <span>生成后顺便超分</span>
                        </label>
                        {config.ll2Upscale ? (
                            <div className="grid grid-cols-3 gap-2 pt-1">
                                {ll2UpscaleTargetsFor(resolution).map((item) => (
                                    <LL2Pill key={item.id} selected={config.ll2Upscale === item.id} theme={theme} onClick={() => onConfigChange("ll2Upscale", item.id)}>
                                        {ll2UpscaleTargetLabel(item.id)}
                                    </LL2Pill>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function LL2Pill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            className="flex h-8 items-center justify-center rounded-md px-1 text-[var(--fs-label)] font-medium transition-colors hover:brightness-110"
            style={{
                background: selected ? "#5b21b6" : theme.toolbar.itemHover,
                border: `1px solid ${selected ? "#8d54ff" : "transparent"}`,
                color: selected ? "#ffffff" : theme.node.text,
                boxShadow: selected ? "inset 0 0 0 1px rgba(255,255,255,.08)" : "none",
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function LL2Dimension({ label, value, theme }: { label: string; value: string; theme: CanvasTheme }) {
    return (
        <span className="flex h-8 items-center gap-2 rounded-md px-2 text-xs" style={{ background: theme.toolbar.itemHover }}>
            <span style={{ color: theme.node.muted }}>{label}</span>
            <span>{value}</span>
        </span>
    );
}
