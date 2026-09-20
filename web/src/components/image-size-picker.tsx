import { useState } from "react";
import "./image-size-picker.css";
import { Input, Button } from "antd";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { IMAGE_RESOLUTIONS, imagePresetForRatio, imagePresetValue, imageQualityForSelection, imageQualityForTier, imageResolutionUsesQuality, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import { buildImageResolutionOptions, type ImageResolutionOption, type ImageResolutionTier } from "@/lib/image-resolution-tiers";

import { resolveImageRequestSize, validateImageSize } from "@/services/api/image-validation";

export function ImageSizePicker({ profile, size, quality, onChange }: { profile: ImageCapabilityConfig; size: string; quality?: string; onChange: (size: string, quality?: string) => void }) {
    const presets = imageSizePresets(profile).filter((preset) => imageTierAvailable(profile, preset.tier));
    const visibleTiers = IMAGE_RESOLUTIONS.filter((value) => presets.some((preset) => preset.tier === value));
    const [chosenTier, setChosenTier] = useState<ImageResolutionTier>("1k");
    const [customPreset, setCustomPreset] = useState<ImageResolutionOption>();
    const [custom, setCustom] = useState("");
    const [error, setError] = useState("");
    const qualityTier = IMAGE_RESOLUTIONS.find((value) => value === (quality || "").toLowerCase());
    const matches = (preset: ImageResolutionOption) => {
        if (imagePresetValue(profile, preset) !== size) return false;
        if (profile.size.parameter !== "aspect_ratio") return true;
        if (imageResolutionUsesQuality(profile)) return imageQualityForTier(profile, preset.tier) === (quality || profile.quality.default);
        return !qualityTier || qualityTier === preset.tier;
    };
    let resolvedLegacySize: string | undefined;
    if (profile.size.parameter === "size" && size.includes(":")) {
        try {
            resolvedLegacySize = resolveImageRequestSize(profile, quality, size)?.value;
        } catch {
            /* 保留旧值，交由请求校验报告错误。 */
        }
    }
    let restoredCustom: ImageResolutionOption | undefined;
    if (profile.size.allowCustom && size !== "auto") {
        try {
            if (profile.size.parameter === "size") restoredCustom = buildImageResolutionOptions([resolvedLegacySize || size])[0];
            else if (profile.size.parameter === "aspect_ratio") {
                const restoredTier = imageResolutionUsesQuality(profile)
                    ? IMAGE_RESOLUTIONS.find((value) => imageQualityForTier(profile, value) === (quality || profile.quality.default)) || "1k"
                    : (qualityTier && visibleTiers.includes(qualityTier) ? qualityTier : visibleTiers[0]) || "1k";
                restoredCustom = imagePresetForRatio(restoredTier, size);
            }
        } catch {
            /* 无效配置不伪装成已选中的有效预设，交由请求校验处理。 */
        }
    }
    const active =
        (profile.size.allowCustom && customPreset && imageTierAvailable(profile, customPreset.tier) && matches(customPreset) ? customPreset : undefined) ||
        presets.find(matches) ||
        presets.find((preset) => preset.size === resolvedLegacySize) ||
        (restoredCustom && imageTierAvailable(profile, restoredCustom.tier) ? restoredCustom : undefined);
    const available = (value: ImageResolutionTier) => imageTierAvailable(profile, value) && (profile.size.allowCustom || presets.some((preset) => preset.tier === value));
    const tier =
        (active && visibleTiers.includes(active.tier) ? active.tier : undefined) ||
        (profile.size.parameter === "aspect_ratio" && imageResolutionUsesQuality(profile) ? visibleTiers.find((value) => imageQualityForTier(profile, value) === (quality || profile.quality.default)) : undefined) ||
        (qualityTier && visibleTiers.includes(qualityTier) ? qualityTier : undefined) ||
        (visibleTiers.includes(chosenTier) ? chosenTier : visibleTiers[0]) ||
        "1k";
    const choices = presets.filter((preset) => preset.tier === tier);
    const select = (preset: ImageResolutionOption) => {
        if (!available(preset.tier)) return;
        setChosenTier(preset.tier);
        setCustomPreset(preset);
        setError("");
        onChange(imagePresetValue(profile, preset), profile.size.parameter === "aspect_ratio" ? imageQualityForSelection(profile, preset.tier) : undefined);
    };
    const makeCustom = (next: ImageResolutionTier, ratio: string) => {
        const preset = imagePresetForRatio(next, ratio);
        // 精确支持值保持原值；支持值之外的像素仍遵守请求端的 16px 步长。
        if (profile.size.parameter === "size" && !profile.size.values.includes(preset.size)) {
            preset.width = Math.round(preset.width / 16) * 16;
            preset.height = Math.round(preset.height / 16) * 16;
            preset.size = `${preset.width}x${preset.height}`;
            validateImageSize(preset.width, preset.height);
        }
        return preset;
    };
    const changeTier = (next: ImageResolutionTier) => {
        const ratio = active?.ratio || (size.includes(":") ? size : "1:1");
        const candidate = presets.find((preset) => preset.tier === next && preset.ratio === ratio);
        try {
            if (candidate) select(candidate);
            else if (profile.size.allowCustom) select(makeCustom(next, ratio));
            else {
                const first = presets.find((preset) => preset.tier === next);
                if (first) select(first);
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "尺寸格式无效");
        }
    };
    const applyCustom = () => {
        try {
            if (custom.includes(":") || custom.includes("：")) {
                select(makeCustom(tier, custom));
                return;
            }
            const match = custom.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
            if (!match) throw new Error("输入比例 16:9，或像素 1824x1024");
            const width = Number(match[1]),
                height = Number(match[2]);
            if (profile.size.parameter === "aspect_ratio") {
                select(makeCustom(tier, `${width}:${height}`));
                return;
            }
            const value = `${width}x${height}`;
            validateImageSize(width, height, !profile.size.values.includes(value));
            const preset = presets.find((item) => item.size === value) || {
                ...imagePresetForRatio(width * height <= 2_000_000 ? "1k" : width * height <= 4_300_000 ? "2k" : "4k", `${width}:${height}`),
                width,
                height,
                size: value,
            };
            select(preset);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "尺寸格式无效");
        }
    };
    if (profile.size.parameter === "none") return null;
    return (
        <div className="image-size-picker">
            {visibleTiers.length ? (
                <>
                    <div className="image-size-label">分辨率</div>
                    <div className="image-size-tiers">
                        {visibleTiers.map((value) => (
                            <button type="button" key={value} aria-pressed={size !== "auto" && active?.tier === value} onClick={() => changeTier(value)}>
                                {value.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </>
            ) : null}
            {profile.size.values.includes("auto") ? (
                <button
                    type="button"
                    className="image-size-auto"
                    aria-pressed={size === "auto"}
                    onClick={() => {
                        setError("");
                        onChange("auto");
                    }}
                >
                    自动尺寸
                </button>
            ) : null}
            {choices.length ? <div className="image-size-label">宽高比</div> : null}
            <div className="image-size-ratios">
                {choices.map((preset) => (
                    <button
                        type="button"
                        key={`${preset.ratio}:${preset.size}`}
                        title={`${preset.ratio} · ${preset.width} × ${preset.height}`}
                        aria-pressed={size !== "auto" && active?.size === preset.size && active?.tier === tier}
                        onClick={() => select(preset)}
                    >
                        <span className="image-size-ratio-icon" style={{ width: 24 * Math.min(1, preset.width / preset.height), height: 24 * Math.min(1, preset.height / preset.width) }} />
                        <span>{preset.ratio}</span>
                    </button>
                ))}
            </div>
            {!choices.length ? <p className="image-size-hint">未配置预设尺寸{profile.size.allowCustom ? "，可输入自定义比例或尺寸" : ""}</p> : null}
            <output aria-live="polite" className="image-size-output">
                {size === "auto" ? "尺寸由模型决定" : active ? `${active.ratio} · ${active.width} × ${active.height} px` : size.replace("x", " × ")}
            </output>
            {profile.size.parameter === "aspect_ratio" ? <p className="image-size-hint">尺寸为换算参考，实际像素由模型决定{!imageResolutionUsesQuality(profile) && visibleTiers.length <= 1 ? "；当前协议未配置独立分辨率" : ""}。</p> : null}
            {profile.size.allowCustom ? (
                <details className="image-size-custom">
                    <summary>自定义比例或尺寸</summary>
                    <div className="image-size-custom-input">
                        <Input aria-label="自定义比例或尺寸" placeholder="16:9 或 1824x1024" value={custom} onChange={(event) => setCustom(event.target.value)} onPressEnter={applyCustom} />
                        <Button onClick={applyCustom}>应用</Button>
                    </div>
                </details>
            ) : null}
            {error ? (
                <p role="alert" className="image-size-error">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
