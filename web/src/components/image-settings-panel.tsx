import { ImageSizePicker } from "./image-size-picker";
import { ImageParameterFields } from "./image-parameter-fields";
import { imageResolutionUsesQuality, imageSizePresets } from "@/lib/image-size-presets";
import { useEffect, useState, type ReactNode } from "react";
import { ConfigProvider } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { ChevronDown, ChevronUp } from "lucide-react";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { buildImageResolutionOptions, formatImageResolutionSize } from "@/lib/image-resolution-tiers";
import { modelCapabilityConfigFor, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { preserveImageSettings as normalizeImageValue } from "@/lib/media-settings";
import { MediaSettingsNotice } from "./media-settings-notice";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { imagePriceSelector, normalizeImagePriceSelector } from "@/lib/image-pricing";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { imageQualityLabel } from "@/lib/image-quality";

export { imageQualityLabel } from "@/lib/image-quality";
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
    { value: "21:9", label: "21:9", size: "1938x812", width: 1938, height: 812, icon: "landscape" },
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
    onConfigChange: (key: "quality" | "imageResolution" | "size" | "transparentBackground" | "count" | "imageParameters", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    showQuality?: boolean;
    showTransparent?: boolean;
    showSize?: boolean;
    showCount?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
    /** 画布节点的张数是拆单数，传值时按账号同时任务数取上限，不再受单模型 maxOutputs 限制。 */
    countLimit?: number;
    /** 局部编辑等场景需要先允许选择参数，由后端负责最终计费校验。 */
    bypassPriceGuard?: boolean;
};

export function ImageSettingsPanel(props: ImageSettingsPanelProps) {
    return (
        <>
            <MediaSettingsNotice config={props.config} capability="image" onChange={(field, value) => props.onConfigChange(field as Parameters<ImageSettingsPanelProps["onConfigChange"]>[0], value)} />
            <ImageSettingsControls {...props} />
        </>
    );
}

function ImageSettingsControls({
    config,
    onConfigChange,
    theme,
    showTitle = true,
    showQuality = true,
    showTransparent = true,
    showSize = true,
    showCount = true,
    className = "w-[304px] space-y-3 rounded-2xl px-1 py-0.5",
    maxCount = 15,
    quickCount = 3,
    countLimit,
    bypassPriceGuard = false,
}: ImageSettingsPanelProps) {
    const profile = mergedImageCapabilityConfig(config, config.model || config.imageModel);
    const normalized = normalizeImageValue(profile, config, resolveModelRequestConfig(config, config.model || config.imageModel).interfaceType);
    const quality = normalized.quality;
    const transparentBackground = normalized.transparentBackground === "true";
    const effectiveMaxCount = Math.min(maxCount, countLimit === undefined ? profile.maxOutputs : countLimit);
    // 传了 countLimit 时 config.count 是拆单数，normalized.count 已被单模型 maxOutputs 压到 1。
    const count = countLimit === undefined ? Math.max(1, Math.min(effectiveMaxCount, Number(normalized.count))) : Math.max(1, Math.min(effectiveMaxCount, Math.floor(Number(config.count)) || 1));
    const activeSize = normalized.size;
    const activeQualityOptions = profile.quality.values.map((value) => ({ value, label: imageQualityLabel(value) }));
    const priceTiers = imageModelPriceTiers(config);
    if (profile.parameters)
        return (
            <ImageSettingsTheme theme={theme}>
                <div className={className}>
                    {showTitle ? <div className="mb-3 text-base font-semibold">图像设置</div> : null}
                    <ImageParameterFields profile={profile} config={config} onChange={onConfigChange} showSize={showSize} showCount={showCount} showQuality={showQuality} showTransparent={showTransparent} countLimit={countLimit} />
                </div>
            </ImageSettingsTheme>
        );

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
                {/* 张数与透明背景放在最前：尺寸列表较长，放在后面时需要滚动才能看到。 */}
                {showCount && effectiveMaxCount > 1 ? (
                    <div className="space-y-2">
                        <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                        <div className="grid grid-cols-4 gap-2">
                            {Array.from({ length: Math.min(3, effectiveMaxCount) }, (_, index) => index + 1).map((value) => (
                                <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                    {value}
                                </OptionPill>
                            ))}
                            {effectiveMaxCount >= 4 ? <CountStepperInput value={count} max={effectiveMaxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value))} /> : null}
                        </div>
                    </div>
                ) : null}
                {showTransparent && profile.transparentBackground.supported ? (
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                            <div className="mt-1 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                                请求模型输出保留 Alpha 通道的 PNG
                            </div>
                        </div>
                        <span title="是否支持透明背景由当前模型接口决定" onMouseDown={(event) => event.stopPropagation()}>
                            <Switch size="sm" checked={transparentBackground} onChange={(checked) => onConfigChange("transparentBackground", checked ? "true" : "false")} />
                        </span>
                    </div>
                ) : null}
                {showQuality && profile.quality.supported && !imageResolutionUsesQuality(profile) ? (
                    <div className="space-y-2">
                        <SettingTitle color={theme.node.muted}>{isGrokResolutionQuality(profile) ? "分辨率" : "质量"}</SettingTitle>
                        <div className={`grid gap-2 ${activeQualityOptions.length <= 2 ? "grid-cols-2" : "grid-cols-4"}`}>
                            {activeQualityOptions.map((item) => (
                                <OptionPill
                                    key={item.value}
                                    selected={quality === item.value}
                                    disabled={!bypassPriceGuard && !hasPriceTierForImageSelection(priceTiers, item.value, activeSize)}
                                    theme={theme}
                                    onClick={() => onConfigChange("quality", item.value)}
                                >
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </div>
                ) : null}
                {showSize ? (
                    <ImageSizePicker
                        profile={profile}
                        size={activeSize}
                        quality={quality}
                        imageResolution={normalized.imageResolution}
                        onChange={(size, nextQuality, nextResolution) => applyImageSizeSelection(onConfigChange, size, nextQuality, nextResolution)}
                    />
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

// 尺寸选择器换档时会同时给出档位；分辨率独立声明的模型必须一起提交，否则像素与档位不一致。
export function applyImageSizeSelection(onConfigChange: ImageSettingsPanelProps["onConfigChange"], size: string, quality?: string, resolution?: string) {
    onConfigChange("size", size);
    if (quality) onConfigChange("quality", quality);
    if (resolution) onConfigChange("imageResolution", resolution);
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
    const requested = imagePriceSelector(quality, size);
    return tiers.some((tier) => {
        const selector = normalizeImagePriceSelector(tier.selector || {});
        return Object.entries(selector).every(([key, value]) => value === "*" || requested[key] === value);
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

function CountStepperInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const isSelected = value >= 4;
    const [draftValue, setDraftValue] = useState(() => (value >= 4 ? String(value) : "4"));

    useEffect(() => {
        if (value >= 4) {
            setDraftValue(String(value));
        }
    }, [value]);

    const handleSelectThis = () => {
        const num = Math.max(1, Math.min(max, parseInt(draftValue, 10) || 4));
        onChange(num);
    };

    const handleStepUp = (e: React.MouseEvent) => {
        e.stopPropagation();
        const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
        const next = Math.min(max, base + 1);
        setDraftValue(String(next));
        onChange(next);
    };

    const handleStepDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
        const next = Math.max(1, base - 1);
        setDraftValue(String(next));
        onChange(next);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDraftValue(e.target.value);
    };

    const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const num = Math.max(1, Math.min(max, parseInt(e.target.value, 10) || 4));
        setDraftValue(String(num));
        onChange(num);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
            const next = Math.min(max, base + 1);
            setDraftValue(String(next));
            onChange(next);
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
            const next = Math.max(1, base - 1);
            setDraftValue(String(next));
            onChange(next);
        }
    };

    return (
        <div
            className="group relative flex h-8 items-center overflow-hidden rounded-full border text-xs transition-colors cursor-pointer select-none"
            style={{
                background: isSelected ? theme.toolbar.activeBg : theme.toolbar.itemHover,
                borderColor: isSelected ? theme.accent.primary : "transparent",
                color: theme.node.text,
            }}
            onClick={handleSelectThis}
        >
            <input
                type="text"
                inputMode="numeric"
                aria-label="自定义生成张数"
                value={draftValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                onFocus={(e) => {
                    e.currentTarget.select();
                    if (value < 4) {
                        handleSelectThis();
                    }
                }}
                className="w-full min-w-0 flex-1 bg-transparent pl-2 pr-0.5 text-center font-medium text-xs outline-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
            />
            <div className="flex flex-col h-full w-4.5 shrink-0 border-l justify-center items-center divide-y" style={{ borderColor: `${theme.toolbar.border}80` }}>
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleStepUp}
                    disabled={value >= max && isSelected}
                    className="flex flex-1 w-full items-center justify-center hover:bg-black/15 dark:hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="增加 1 张"
                    aria-label="增加 1 张"
                >
                    <ChevronUp className="size-2.5 opacity-70" />
                </button>
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleStepDown}
                    disabled={value <= 1 && isSelected}
                    className="flex flex-1 w-full items-center justify-center hover:bg-black/15 dark:hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="减少 1 张"
                    aria-label="减少 1 张"
                >
                    <ChevronDown className="size-2.5 opacity-70" />
                </button>
            </div>
        </div>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}
