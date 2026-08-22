import { type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { buildImageResolutionOptions, formatImageResolutionSize, imageRatioForSize, imageResolutionChoices, imageResolutionOption, imageSizeForResolution, supportsImageResolutionPresets, type ImageResolutionChoice } from "@/lib/image-resolution-tiers";
import { modelCapabilityConfigFor, normalizeImageValue, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
];
const DIMENSION_STEP = 16;

type AspectOption = { value: string; label: string; width: number; height: number; icon: string; size?: string };

const aspectOptions: AspectOption[] = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "2:1", label: "2:1", size: "2048x1024", width: 2048, height: 1024, icon: "landscape" },
    { value: "1:2", label: "1:2", size: "1024x2048", width: 1024, height: 2048, icon: "portrait" },
    { value: "21:9", label: "21:9", size: "2352x1008", width: 2352, height: 1008, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "1:1-2k", label: "1:1(2k)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },
    { value: "16:9-2k", label: "16:9(2k)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape" },
    { value: "9:16-2k", label: "9:16(2k)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait" },
    { value: "16:9-4k", label: "16:9(4k)", size: "3840x2160", width: 3840, height: 2160, icon: "landscape" },
    { value: "9:16-4k", label: "9:16(4k)", size: "2160x3840", width: 2160, height: 3840, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "transparentBackground" | "count", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    showCount?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, showCount = true, className = "w-[304px] space-y-3 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 3 }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const profile = mergedImageCapabilityConfig(config, config.model || config.imageModel);
    const normalized = normalizeImageValue(profile, config);
    const quality = normalized.quality;
    const transparentBackground = normalized.transparentBackground === "true";
    const effectiveMaxCount = Math.min(maxCount, profile.maxOutputs);
    const count = Math.max(1, Math.min(effectiveMaxCount, Number(normalized.count)));
    const activeSize = normalized.size;
    const pixelSizeValues = profile.size.values.filter((value) => value.trim().toLowerCase() !== "auto");
    const hasResolutionPresets = supportsImageResolutionPresets(profile.size);
    const resolutionOptions = hasResolutionPresets ? buildImageResolutionOptions(pixelSizeValues) : [];
    const activeResolution = activeSize === "auto" ? undefined : imageResolutionOption(resolutionOptions, activeSize);
    const activeRatio = activeResolution?.ratio || imageRatioForSize(activeSize);
    const resolutionChoices = hasResolutionPresets ? imageResolutionChoices(profile.size.values) : [];
    // 只有一个分辨率层级时，分辨率切换器没有实际选择意义；更重要的是不能因此把比例列表裁剪成当前层级的 3 个像素尺寸。
    // 例如历史 `*` 配置恢复为标准值后，虽然包含 1024x1024/1536x1024/1024x1536，实际仍应展示完整的比例和尺寸选项。
    const usesResolutionPicker = resolutionChoices.length > 1;
    const availableAspects: AspectOption[] = usesResolutionPicker && activeSize === "auto"
        ? []
        : usesResolutionPicker && activeResolution
        ? resolutionOptions.filter((item) => item.tier === activeResolution.tier).map((item) => ({ value: item.ratio, label: item.ratio, size: item.size, width: item.width, height: item.height, icon: item.width === item.height ? "square" : item.width > item.height ? "landscape" : "portrait" }))
        : imageAspectOptions(profile);
    const selectedAspect = availableAspects.find((item) => imageOptionValue(profile, item) === activeSize || item.value === activeSize) || availableAspects.find((item) => item.label === activeRatio);
    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0]);
	const activeQualityOptions = profile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: value });
	const priceTiers = imageModelPriceTiers(config);
    const selectAspect = (value: string) => {
        const option = availableAspects.find((item) => item.value === value);
        onConfigChange("size", option ? imageOptionValue(profile, option) : "auto");
    };
    const selectResolution = (choice: ImageResolutionChoice) => {
        if (choice === "auto") {
            onConfigChange("size", "auto");
            return;
        }
        const ratio = activeRatio || availableAspects[0]?.label;
        const size = imageSizeForResolution(resolutionOptions, choice, ratio) || resolutionOptions.find((item) => item.tier === choice)?.size;
        if (size) onConfigChange("size", size);
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-base font-semibold">图像设置</div> : null}
                {profile.quality.supported ? <div className="space-y-2">
                    <SettingTitle color={theme.node.muted}>{isGrokResolutionQuality(profile) ? "分辨率" : "质量"}</SettingTitle>
                    <div className={`grid gap-1.5 ${activeQualityOptions.length <= 2 ? "grid-cols-2" : "grid-cols-4"}`}>
						{activeQualityOptions.map((item) => (
							<OptionPill key={item.value} selected={quality === item.value} disabled={!hasPriceTierForImageSelection(priceTiers, item.value, activeSize)} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div> : null}
                {profile.transparentBackground.supported ? <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                        <div className="mt-1 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            请求模型输出保留 Alpha 通道的 PNG
                        </div>
                    </div>
                    <span title="是否支持透明背景由当前模型接口决定" onMouseDown={(event) => event.stopPropagation()}>
                        <Switch
                            size="small"
                            checked={transparentBackground}
                            onChange={(checked) => onConfigChange("transparentBackground", checked ? "true" : "false")}
                        />
                    </span>
                </div> : null}
                {resolutionChoices.length ? <div className="space-y-2">
                    <SettingTitle color={theme.node.muted}>分辨率</SettingTitle>
                    <div className={`grid gap-1.5 ${resolutionChoices.length <= 2 ? "grid-cols-2" : resolutionChoices.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
                        {resolutionChoices.map((choice) => (
                            <OptionPill key={choice} selected={choice === "auto" ? activeSize === "auto" : activeResolution?.tier === choice} theme={theme} onClick={() => selectResolution(choice)}>
                                {choice === "auto" ? "自动" : choice.toUpperCase()}
                            </OptionPill>
                        ))}
                    </div>
                </div> : null}
                {profile.size.allowCustom ? <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                16倍数对齐
                            </span>
                            <span title="输入完成后自动向上补成 16 的倍数" onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-sm opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div> : null}
                {availableAspects.length ? <div className="space-y-2">
                    <SettingTitle color={theme.node.muted}>尺寸或比例</SettingTitle>
                    <div className="grid grid-cols-4 gap-1.5 min-[380px]:grid-cols-5">
                        {availableAspects.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg bg-transparent text-[var(--fs-label)] transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                                style={{ background: selectedAspect?.value === item.value ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span className="whitespace-nowrap">{item.label}</span>
                            </button>
                        ))}
                    </div>
                </div> : null}
                {showCount && effectiveMaxCount > 1 ? (
                    <div className="space-y-2">
                        <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                        <div className="grid grid-cols-4 gap-1.5">
                            {Array.from({ length: Math.min(quickCount, effectiveMaxCount) }, (_, index) => index + 1).map((value) => (
                                <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                    {value}
                                </OptionPill>
                            ))}
                            <CountInput value={count} quickCount={quickCount} max={effectiveMaxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                        </div>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function imageOptionAllowed(profile: ImageCapabilityConfig, option: AspectOption) {
    if (profile.size.parameter === "none") return false;
    if (profile.size.allowCustom && profile.size.values.length === 0) return true;
    return [option.value, option.size, option.width && option.height ? `${option.width}x${option.height}` : ""].filter(Boolean).some((value) => profile.size.values.includes(String(value)));
}

// 宽高比选项直接取模型配置 values（与创作页面一致），不在白名单里的比例（如 8:1）也能显示。
function imageAspectOptions(profile: ImageCapabilityConfig): AspectOption[] {
    if (profile.size.parameter === "none") return [];
    const values = profile.size.values.filter((value) => value.trim().toLowerCase() !== "auto");
    if (!values.length) return profile.size.allowCustom ? aspectOptions.filter((item) => item.value !== "auto") : [];
    return values.map((value) => {
        const known = aspectOptions.find((item) => (item.size || item.value) === value || item.value === value);
        if (known) return known;
        const parts = ratioParts(value);
        return { value, label: value, size: value, width: parts?.width || 0, height: parts?.height || 0, icon: "custom" };
    });
}

function ratioParts(value: string) {
    const pixel = value.trim().match(/^(\d+)x(\d+)$/i);
    if (pixel) {
        const divisor = gcd(Number(pixel[1]), Number(pixel[2]));
        return { width: Number(pixel[1]) / divisor, height: Number(pixel[2]) / divisor };
    }
    const ratio = value.trim().match(/^(\d+):(\d+)$/);
    if (!ratio) return undefined;
    return { width: Number(ratio[1]), height: Number(ratio[2]) };
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : a;
}

function imageOptionValue(profile: ImageCapabilityConfig, option: AspectOption) {
    const candidates = [option.size, option.value, option.width && option.height ? `${option.width}x${option.height}` : ""].filter(Boolean).map(String);
    return candidates.find((value) => profile.size.values.includes(value)) || option.size || option.value || "auto";
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.canvas.background, colorBgElevated: theme.canvas.background, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.canvas.background, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低", "1k": "1K", "2k": "2K" } as Record<string, string>)[value] || value || "默认";
}

function isGrokResolutionQuality(profile: ImageCapabilityConfig) {
    const values = profile.quality.values.map((item) => item.toLowerCase());
    return values.includes("1k") || values.includes("2k");
}

export function imageSizeLabel(size: string) {
    const resolutionLabel = formatImageResolutionSize(size, buildImageResolutionOptions([size]));
    return resolutionLabel !== size ? resolutionLabel : aspectOptions.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

function imageModelPriceTiers(config: AiConfig) {
	const channel = resolveModelChannel(config, config.model || config.imageModel);
	const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(config.model || config.imageModel));
	return cost?.logicalPriceTiers || [];
}

function hasPriceTierForImageSelection(tiers: ReturnType<typeof imageModelPriceTiers>, quality: string, size: string) {
	if (!tiers.length) return true;
	return tiers.some((tier) => {
		const selector = tier.selector || {};
		return (!selector.quality || selector.quality === "*" || selector.quality === quality.toLowerCase()) && (!selector.size || selector.size === "*" || selector.size === size.toLowerCase());
	});
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
			className="h-8 cursor-pointer rounded-full px-2 text-xs transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
			style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text, outlineColor: theme.node.muted }}
			disabled={disabled}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-8 overflow-hidden rounded-lg text-xs" style={{ background: theme.toolbar.itemHover, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-8 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, quickCount, max, theme, onChange }: { value: number; quickCount: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Math.max(1, Math.min(max, Math.floor(Number(input.value) || 1)));
        input.value = String(next);
        onChange(next);
    };
    return (
        <label className="flex h-8 overflow-hidden rounded-full text-xs" style={{ background: theme.toolbar.itemHover, color: theme.node.text }}>
            <input
                key={value > quickCount ? `custom-${value}` : "quick"}
                type="number"
                min={1}
                max={max}
                aria-label="自定义生成张数"
                placeholder="输入"
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none placeholder:text-current placeholder:opacity-55 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                defaultValue={value > quickCount ? value : ""}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 22 : Math.max(9, 22 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(9, 22 / ratio) : 22;
    return (
        <span className="grid h-6 w-8 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
