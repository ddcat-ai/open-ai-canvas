import { type ReactNode } from "react";
import { Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceRatioOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { normalizeVideoDuration, normalizeVideoResolution, VIDEO_DURATION_MIN } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor, videoDurationOptions, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

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
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[292px] space-y-3" }: VideoSettingsPanelProps) {
    const profile = modelCapabilityConfigFor(config, config.model).video!;
    if (resolveModelRequestConfig(config, config.model).interfaceType === "volcengine-jimeng-video") {
        return <JiMengVideoSettingsPanel config={config} profile={profile} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} profile={profile} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const seconds = normalizeVideoDuration(config.videoSeconds);
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const configuredResolutions = profile.resolutions.map((value) => ({ value: value.replace(/p$/i, ""), label: value.toUpperCase() }));
    const generateAudio = boolConfig(config.videoGenerateAudio, profile.generateAudio.default);
    const watermark = boolConfig(config.videoWatermark, profile.watermark.default);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                        {configuredResolutions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-xs opacity-45">×</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {profile.ratios.map((value) => (
                            <button
                                key={value}
                                type="button"
                                className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-1 text-[var(--fs-label)] font-medium transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                                style={{ background: normalizeRatioValue(config.size) === value ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", value)}
                            >
                                <SizePreview width={ratioPreview(value).width} height={ratioPreview(value).height} color={theme.node.text} />
                                <span>{value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                {profile.generateAudio.supported || profile.watermark.supported ? <SettingGroup title="输出" color={theme.node.muted}><div className="grid grid-cols-2 gap-3 rounded-md px-2" style={{ background: theme.toolbar.itemHover }}>{profile.generateAudio.supported ? <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}{profile.watermark.supported ? <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}</div></SettingGroup> : null}
            </div>
        </ImageSettingsTheme>
    );
}

function JiMengVideoSettingsPanel({ config, profile, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig }) {
    const seconds = normalizeVideoDuration(config.videoSeconds);
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                {profile.ratios.map((value) => <OptionPill key={value} selected={config.size === value} theme={theme} onClick={() => onConfigChange("size", value)}>{value}</OptionPill>)}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, profile, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig }) {
    const model = modelOptionName(config.model || config.videoModel);
    const resolution = normalizeSeedanceResolution(config.vquality, model);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, profile.generateAudio.default);
    const watermark = boolConfig(config.videoWatermark, profile.watermark.default);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                        {profile.resolutions.map((value) => {
                            const item = { value, label: value.toUpperCase() };
                            const disabled = item.value === "1080p" && isSeedanceFastModel(model);
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
                    <div className="grid grid-cols-4 gap-1.5">
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
                    <VideoDurationControl profile={profile} value={duration} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-3 rounded-md px-2" style={{ background: theme.toolbar.itemHover }}>
                        {profile.generateAudio.supported ? <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                        {profile.watermark.supported ? <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${normalizeVideoResolutionValue(value)}P`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
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

export function normalizeVideoResolutionValue(value: string) {
    return normalizeVideoResolution(value);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-8 cursor-pointer whitespace-nowrap rounded-md px-1 text-[var(--fs-label)] font-medium leading-none transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="text-[var(--fs-tiny)] font-semibold" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-8 overflow-hidden rounded-md text-[var(--fs-label)]" style={{ background: theme.toolbar.itemHover, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-7 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
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
            <span className="shrink-0 px-1.5" style={{ color: theme.node.muted }}>秒</span>
        </label>
    );
}

function VideoDurationControl({ profile, value, theme, onChange }: { profile: VideoCapabilityConfig; value: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    if (profile.duration.selection === "range") {
        const min = profile.duration.min || VIDEO_DURATION_MIN;
        const max = Math.max(min, profile.duration.max || min);
        const step = Math.max(1, profile.duration.step || 1);
        const normalized = normalizeDurationValue(value, profile.duration.default, min, max, step);
        return <DurationRangeControl value={normalized} min={min} max={max} step={step} theme={theme} onChange={onChange} />;
    }

    const options = videoDurationOptions(profile);
    return <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
        {options.map((option) => <OptionPill key={option} selected={normalizedNumber(value) === option} theme={theme} onClick={() => onChange(option)}>{option}s</OptionPill>)}
    </div>;
}

function DurationRangeControl({ value, min, max, step, theme, onChange }: { value: number; min: number; max: number; step: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    return <div className="space-y-1.5">
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
    </div>;
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
    return <span className="shrink-0 rounded-[2px] border" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
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
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}

function normalizeRatioValue(value: string) {
    const match = String(value || "").match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
    if (!match) return value;
    return `${match[1]}:${match[2]}`;
}
