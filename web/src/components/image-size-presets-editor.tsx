import { useId, useState } from "react";
import { Button, Input, InputNumber } from "antd";
import { Check, Plus } from "lucide-react";
import { Switch } from "@/components/ui/base/switch";
import "./image-size-picker.css";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { DEFAULT_IMAGE_RATIOS, IMAGE_RATIOS, imageResolutionTiers, imagePresetForRatio, imageResolutionUsesQuality, imageSizeConfigWithPresets, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import { validateImageSize } from "@/services/api/image-validation";
import type { ImageResolutionOption, ImageResolutionTier } from "@/lib/image-resolution-tiers";

export function ImageSizePresetsEditor({
    profile,
    disabled,
    onChange,
    onClearDefault,
    tiers,
    ratios: allowedRatios,
    allowCustomRatio = true,
    grouped = true,
    defaultPresets = [],
}: {
    profile: ImageCapabilityConfig;
    disabled?: boolean;
    onChange: (size: ImageCapabilityConfig["size"]) => void;
    onClearDefault?: () => void;
    tiers?: string[];
    ratios?: string[];
    allowCustomRatio?: boolean;
    grouped?: boolean;
    defaultPresets?: ImageResolutionOption[];
}) {
    const IMAGE_RESOLUTIONS = tiers ?? imageResolutionTiers(profile);
    const presets = imageSizePresets(profile);
    const presetValue = (preset: ImageResolutionOption) => (profile.size.parameter === "aspect_ratio" ? preset.ratio : preset.size);
    const defaultOptions = profile.size.values.length ? profile.size.values : [...new Set(presets.map(presetValue).filter(Boolean))];
    const defaultTier = grouped && profile.resolution.supported && IMAGE_RESOLUTIONS.includes(profile.resolution.default) ? profile.resolution.default : undefined;
    const tierPresets = defaultTier ? presets.filter((preset) => preset.tier === defaultTier) : [];
    const allMapped = new Set(presets.map(presetValue));
    const tierValues = new Set(tierPresets.map(presetValue));
    const options = tierValues.size ? defaultOptions.filter((value) => value === profile.size.default || !allMapped.has(value) || tierValues.has(value)) : defaultOptions;
    const defaultSize = profile.parameters ? profile.parameters.find((field) => field.name === "size")?.default : profile.size.default;
    const id = useId();
    const [drafts, setDrafts] = useState<Partial<Record<ImageResolutionTier, string>>>({});
    const [errors, setErrors] = useState<Partial<Record<ImageResolutionTier, string>>>({});
    const candidate = (tier: string, ratio: string) => {
        const existing = presets.find((preset) => preset.tier === tier && preset.ratio === ratio) || defaultPresets.find((preset) => preset.tier === tier && preset.ratio === ratio);
        if (existing) return existing;
        try {
            return imagePresetForRatio(tier, ratio);
        } catch {
            return { tier, ratio, width: 0, height: 0, size: "" };
        }
    };
    const toggleTier = (tier: ImageResolutionTier, ratios: string[], enabled: boolean) => {
        if (disabled) return;
        update(tier, enabled ? ratios : []);
    };
    const update = (tier: ImageResolutionTier, ratios: string[]) => {
        if (disabled) return false;
        try {
            const next = [
                ...new Map(
                    ratios.map((ratio) => {
                        if (!/^\d+[:：]\d+$/.test(ratio) || ratio.split(/[:：]/).some((part) => Number(part) <= 0)) throw new Error("请输入正数比例，例如 16:9");
                        const preset = candidate(tier, ratio);
                        return [preset.ratio, preset] as const;
                    }),
                ).values(),
            ];
            onChange(imageSizeConfigWithPresets(profile, [...presets.filter((preset) => preset.tier !== tier), ...next]));
            setErrors((current) => ({ ...current, [tier]: "" }));
            return true;
        } catch (reason) {
            setErrors((current) => ({ ...current, [tier]: reason instanceof Error ? reason.message : "比例格式无效" }));
            return false;
        }
    };
    const editDimensions = (tier: ImageResolutionTier, ratio: string, field: "width" | "height", rawValue: number | null) => {
        if (disabled) return;
        const value = rawValue == null ? NaN : Math.round(rawValue);
        const selected = presets.find((preset) => preset.tier === tier && preset.ratio === ratio);
        if (!selected || !Number.isInteger(value) || value <= 0) {
            setErrors((current) => ({ ...current, [tier]: "请输入正整数像素" }));
            return;
        }
        const width = field === "width" ? value : selected.width;
        const height = field === "height" ? value : selected.height;
        try {
            if (width > 0 && height > 0) validateImageSize(width, height, !profile.parameters);
            const next = presets.map((preset) => (preset === selected ? { ...preset, width, height, size: `${width}x${height}` } : preset));
            onChange(imageSizeConfigWithPresets(profile, next));
            setErrors((current) => ({ ...current, [tier]: "" }));
        } catch (reason) {
            setErrors((current) => ({ ...current, [tier]: reason instanceof Error ? reason.message : "像素尺寸无效" }));
        }
    };
    const addRatio = (tier: ImageResolutionTier) => {
        const ratios = (drafts[tier] || "")
            .split(/[,，\n]/)
            .map((value) => value.trim())
            .filter(Boolean);
        if (!ratios.length) return;
        if (update(tier, [...presets.filter((preset) => preset.tier === tier).map((preset) => preset.ratio), ...ratios])) {
            setDrafts((current) => ({ ...current, [tier]: "" }));
        }
    };
    const mappings = (
        <details className="image-size-mappings" open={presets.some((preset) => !preset.width || !preset.height || !preset.size) || undefined}>
            <summary>
                配置画幅与精确像素 <span>{presets.length} 项映射</span>
            </summary>
            <p className="image-size-editor-intro">点选支持的比例，再次点击可移除。已有精确尺寸保持不变，有换算规则时自动填入。</p>
            {IMAGE_RESOLUTIONS.map((tier) => {
                const items = presets.filter((preset) => preset.tier === tier);
                const ratios = [...new Set([...(allowedRatios ?? IMAGE_RATIOS), ...items.map((item) => item.ratio)])];
                return (
                    <section key={tier} className={`image-size-preset-group${grouped ? "" : " is-ungrouped"}`} aria-label={grouped ? undefined : "比例配置"} aria-labelledby={grouped ? `${id}-${tier}-title` : undefined}>
                        {grouped ? (
                            <header className="image-size-preset-heading">
                                <div className="image-size-preset-heading-label">
                                    <strong id={`${id}-${tier}-title`}>{tier.toUpperCase()}</strong>
                                    <span>{items.length ? `${items.length} 个比例` : "未启用"}</span>
                                    {!profile.parameters ? <Switch size="sm" checked={items.length > 0} disabled={disabled} aria-label={`启用 ${tier.toUpperCase()} 规格`} onChange={(enabled) => toggleTier(tier, ratios, enabled)} /> : null}
                                </div>
                                {!items.length && DEFAULT_IMAGE_RATIOS.some((ratio) => ratios.includes(ratio)) ? (
                                    <Button
                                        size="small"
                                        disabled={disabled}
                                        onClick={() =>
                                            update(
                                                tier,
                                                DEFAULT_IMAGE_RATIOS.filter((ratio) => ratios.includes(ratio)),
                                            )
                                        }
                                    >
                                        选择常用比例
                                    </Button>
                                ) : null}
                            </header>
                        ) : null}
                        <div className="image-size-preset-body">
                            {items.some((item) => !item.width || !item.height || !item.size) ? (
                                <p role="alert" className="image-size-error">
                                    请填写所选比例的宽度和高度，完成像素尺寸配置后再保存。
                                </p>
                            ) : null}
                            {imageResolutionUsesQuality(profile) && !imageTierAvailable(profile, tier) ? <p className="image-size-hint">需先配置此档位对应的质量值，用户端才会开放。</p> : null}
                            <div className="image-size-preset-options" role="group" aria-label={grouped ? `${tier.toUpperCase()} 支持的宽高比` : "支持的宽高比"}>
                                {ratios.map((ratio) => {
                                    const selected = items.find((item) => item.ratio === ratio);
                                    const dimensions = selected || candidate(tier, ratio);
                                    return (
                                        <div key={ratio} className="image-size-preset-option-wrap">
                                            <button
                                                type="button"
                                                disabled={disabled}
                                                aria-pressed={Boolean(selected)}
                                                aria-label={grouped ? `${tier.toUpperCase()} ${ratio}` : ratio}
                                                className="image-size-preset-option"
                                                title={`${ratio}${dimensions.width && dimensions.height ? ` · ${dimensions.width} × ${dimensions.height} px` : ""}${selected ? " · 点击移除" : " · 点击添加"}`}
                                                onClick={() => update(tier, selected ? items.filter((item) => item.ratio !== ratio).map((item) => item.ratio) : [...items.map((item) => item.ratio), ratio])}
                                            >
                                                <span className="image-size-preset-option-label">
                                                    <span>{ratio}</span>
                                                    {selected ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                                                </span>
                                                <small>{dimensions.width && dimensions.height ? `${dimensions.width} × ${dimensions.height}` : "设置尺寸"}</small>
                                            </button>
                                            {selected ? (
                                                <div className="image-size-preset-dimensions" aria-label={`${tier.toUpperCase()} ${ratio} 精确像素`}>
                                                    <label>
                                                        <span>宽</span>
                                                        <InputNumber
                                                            controls={false}
                                                            min={1}
                                                            precision={0}
                                                            value={selected.width || null}
                                                            disabled={disabled}
                                                            aria-label={`${grouped ? tier.toUpperCase() + " " : ""}${ratio} 宽度像素`}
                                                            onChange={(value) => editDimensions(tier, ratio, "width", value)}
                                                        />
                                                    </label>
                                                    <span aria-hidden="true">×</span>
                                                    <label>
                                                        <span>高</span>
                                                        <InputNumber
                                                            controls={false}
                                                            min={1}
                                                            precision={0}
                                                            value={selected.height || null}
                                                            disabled={disabled}
                                                            aria-label={`${grouped ? tier.toUpperCase() + " " : ""}${ratio} 高度像素`}
                                                            onChange={(value) => editDimensions(tier, ratio, "height", value)}
                                                        />
                                                    </label>
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                            {allowCustomRatio ? (
                                <div className="image-size-preset-add">
                                    <Input
                                        aria-label={`${tier.toUpperCase()} 自定义比例`}
                                        aria-invalid={Boolean(errors[tier])}
                                        aria-describedby={errors[tier] ? `${id}-${tier}-error` : undefined}
                                        disabled={disabled}
                                        placeholder="其他比例，如 17:11"
                                        value={drafts[tier] || ""}
                                        onChange={(event) => {
                                            setDrafts((current) => ({ ...current, [tier]: event.target.value }));
                                            setErrors((current) => ({ ...current, [tier]: "" }));
                                        }}
                                        onPressEnter={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            addRatio(tier);
                                        }}
                                    />
                                    <Button disabled={disabled || !drafts[tier]?.trim()} icon={<Plus size={14} />} onClick={() => addRatio(tier)} aria-label={`添加 ${tier.toUpperCase()} 比例`}>
                                        添加
                                    </Button>
                                </div>
                            ) : null}
                            {errors[tier] ? (
                                <p id={`${id}-${tier}-error`} role="alert" className="image-size-error">
                                    {errors[tier]}
                                </p>
                            ) : null}
                        </div>
                    </section>
                );
            })}
        </details>
    );
    return (
        <div className="image-size-presets-editor">
            <div className="image-size-defaults">
                <div className="image-size-defaults-heading">
                    <strong>默认输出</strong>
                    <span>{tierPresets.length ? `${defaultTier?.toUpperCase()} 档位的初始画幅` : "用户选择模型时的初始尺寸"}</span>
                </div>
                <div className="image-size-default-options" role="group" aria-label="默认输出">
                    {onClearDefault && (
                        <button type="button" disabled={disabled} aria-pressed={defaultSize === undefined} onClick={onClearDefault}>
                            跟随模型默认
                        </button>
                    )}
                    {options.map((value) => {
                        const preset = presets.find((item) => presetValue(item) === value);
                        const label = value === "auto" ? "自动" : preset && profile.size.parameter === "size" ? `${grouped ? preset.tier.toUpperCase() + " · " : ""}${preset.ratio}` : value;
                        return (
                            <button key={value} type="button" disabled={disabled} aria-pressed={defaultSize === value} title={value} aria-label={`默认输出 ${label} ${value}`} onClick={() => onChange({ ...profile.size, default: value })}>
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {mappings}
        </div>
    );
}
