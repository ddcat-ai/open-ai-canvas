import { ImageSizePicker } from "./image-size-picker";
import { imageResolutionUsesQuality } from "@/lib/image-size-presets";
import { type ReactNode } from "react";
import { ConfigProvider } from "antd";
import { Switch } from "@/components/ui/base/switch";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { buildImageResolutionOptions, formatImageResolutionSize } from "@/lib/image-resolution-tiers";
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
    { value: "4k", label: "4K" },
];

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
    showQuality?: boolean;
    showTransparent?: boolean;
    showSize?: boolean;
    showCount?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
    /** 局部编辑等场景需要先允许选择参数，由后端负责最终计费校验。 */
    bypassPriceGuard?: boolean;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, showQuality = true, showTransparent = true, showSize = true, showCount = true, className = "w-[304px] space-y-3 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 3, bypassPriceGuard = false }: ImageSettingsPanelProps) {
    const profile = mergedImageCapabilityConfig(config, config.model || config.imageModel);
    const normalized = normalizeImageValue(profile, config);
    const quality = normalized.quality;
    const transparentBackground = normalized.transparentBackground === "true";
    const effectiveMaxCount = Math.min(maxCount, profile.maxOutputs);
    const count = Math.max(1, Math.min(effectiveMaxCount, Number(normalized.count)));
    const activeSize = normalized.size;
    const activeQualityOptions = profile.quality.values.map((value) => qualityOptions.find((item) => item.value === value) || { value, label: value });
    const priceTiers = imageModelPriceTiers(config);

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
                {showQuality && profile.quality.supported && !imageResolutionUsesQuality(profile) ? <div className="space-y-2">
                    <SettingTitle color={theme.node.muted}>{isGrokResolutionQuality(profile) ? "分辨率" : "质量"}</SettingTitle>
                    <div className={`grid gap-1.5 ${activeQualityOptions.length <= 2 ? "grid-cols-2" : "grid-cols-4"}`}>
						{activeQualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} disabled={!bypassPriceGuard && !hasPriceTierForImageSelection(priceTiers, item.value, activeSize)} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div> : null}
                {showTransparent && profile.transparentBackground.supported ? <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                        <div className="mt-1 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            请求模型输出保留 Alpha 通道的 PNG
                        </div>
                    </div>
                    <span title="是否支持透明背景由当前模型接口决定" onMouseDown={(event) => event.stopPropagation()}>
                        <Switch
                            size="sm"
                            checked={transparentBackground}
                            onChange={(checked) => onConfigChange("transparentBackground", checked ? "true" : "false")}
                        />
                    </span>
                </div> : null}
                {showSize ? <ImageSizePicker profile={profile} size={activeSize} quality={quality} onChange={(size, nextQuality) => applyImageSizeSelection(onConfigChange, size, nextQuality)} /> : null}
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

export function applyImageSizeSelection(onConfigChange: ImageSettingsPanelProps["onConfigChange"], size: string, quality?: string) {
    onConfigChange("size", size);
    if (quality) onConfigChange("quality", quality);
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
    return ({ auto: "自动", high: "高", medium: "中", low: "低", "1k": "1K", "2k": "2K", "4k": "4K" } as Record<string, string>)[value.toLowerCase()] || value || "默认";
}

function isGrokResolutionQuality(profile: ImageCapabilityConfig) {
    const values = profile.quality.values.map((item) => item.toLowerCase());
    return values.some((value) => ["1k", "2k", "4k"].includes(value));
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

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}
