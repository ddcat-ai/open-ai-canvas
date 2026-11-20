// 图生图默认尺寸：节点尺寸未由用户明确选择时，跟随第一张参考图的宽高比。纯函数。

import { buildImageResolutionOptions, type ImageResolutionOption, type ImageResolutionTier } from "@/lib/image-resolution-tiers";
import { imagePresetValue, imageQualityForSelection, imageQualityForTier, imageResolutionUsesQuality, imageSizePresets, imageTierAvailable } from "@/lib/image-size-presets";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig, resolveModelGenerationDefaults } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { CANVAS_IMAGE_PRESETS } from "./canvas-image-presets";
import { getGenerationResourceNodes, parseToolMentionTokens } from "./canvas-resource-references";

export type ImageDimensions = { width: number; height: number };
export type ImageSizeSelection = { size: string; quality?: string; imageResolution?: string };
type ImageSizeValues = { size?: string; quality?: string; imageResolution?: string };

// 3% 内视为方图；与参考图横竖方向不一致的比例只在相差 10% 内优先采用，避免横图落成方图或竖图。
const SQUARE_RATIO = Math.log(1.03);
const NEAR_RATIO = Math.log(1.1);

export function canvasImageNodeDimensions(node: CanvasNodeData | undefined): ImageDimensions | undefined {
    if (node?.type !== CanvasNodeType.Image || (!node.metadata?.content && !node.metadata?.storageKey)) return undefined;
    const natural = node.metadata.naturalWidth && node.metadata.naturalHeight ? { width: node.metadata.naturalWidth, height: node.metadata.naturalHeight } : undefined;
    const dimensions = natural || { width: node.width, height: node.height };
    return validDimensions(dimensions) ? dimensions : undefined;
}

/** 与提示词面板展示的入边顺序一致：取第一张有内容的上游图片。 */
export function canvasReferenceImageDimensions(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    for (const node of getGenerationResourceNodes(nodeId, nodes, connections)) {
        if (node.id === nodeId) continue;
        const dimensions = canvasImageNodeDimensions(node);
        if (dimensions) return dimensions;
    }
    return undefined;
}

/**
 * 没有尺寸、尺寸是 auto，或尺寸由模型默认值/参考图填入时跟随参考图。
 * 用户在图像设置里选过（含主动选「自动尺寸」）或旧节点已有具体尺寸时保持原值。
 */
export function followsReferenceImageSize(node: CanvasNodeData | undefined) {
    if (node?.type !== CanvasNodeType.Image) return false;
    const metadata = node.metadata;
    if (metadata?.imageSizeSource === "user") return false;
    return !metadata?.size || metadata.size.trim().toLowerCase() === "auto" || metadata.imageSizeSource === "default" || metadata.imageSizeSource === "reference";
}

export function withReferenceImageSize(config: AiConfig, node: CanvasNodeData, model: string, reference: ImageDimensions | undefined): CanvasNodeData {
    if (!followsReferenceImageSize(node)) return node;
    const metadata = node.metadata || {};
    const presetToken = parseToolMentionTokens(metadata.generationSpec?.prompt ?? metadata.composerContent ?? metadata.prompt ?? "").find((tool) => tool.type === "nine_grid");
    const ratio = presetToken && CANVAS_IMAGE_PRESETS.find((preset) => preset.id === presetToken.toolId)?.ratio;
    if (ratio && ratio !== "original") {
        const [width, height] = ratio.split(":").map(Number);
        reference = { width, height };
    }
    if (!reference) return node;
    // 档位沿用不跟随参考图时会生效的值，只替换宽高比。
    const current = resolveModelGenerationDefaults(
        config,
        model,
        "image",
        { size: metadata.size, quality: metadata.quality, imageResolution: metadata.imageResolution },
        { size: config.size, quality: config.quality, imageResolution: config.imageResolution },
    );
    const selection = referenceImageSizeSelection(config, model, reference, current);
    return selection ? { ...node, metadata: { ...metadata, ...selection } } : node;
}

/** 按模型（同名模型组）的尺寸选项为参考图挑选宽高比，返回值与尺寸选择器点击预设时提交的字段一致。 */
export function referenceImageSizeSelection(config: AiConfig, model: string, reference: ImageDimensions, current: ImageSizeValues = {}): ImageSizeSelection | undefined {
    if (!validDimensions(reference)) return undefined;
    const profile = mergedImageCapabilityConfig(config, model);
    // 无尺寸参数、或声明式参数里尺寸字段已停用的模型没有可选比例。
    if (profile.size.parameter === "none") return undefined;
    if (profile.parameters && !profile.parameters.some((field) => field.name === "size" && field.enabled !== false)) return undefined;
    const target = Math.log(reference.width / reference.height);
    const ratioValues = profile.size.values.filter((value) => Number.isFinite(ratioLog(value)));
    const ratioSelection = () => {
        const ratio = nearestRatio(ratioValues, ratioLog, target);
        return ratio ? { size: ratio } : undefined;
    };
    // 像素协议的比例值（如默认 1:1）由请求端按质量换算像素；只换比例，避免把高质量请求降成 1K 预设。
    if (profile.size.parameter === "size" && ratioValues.length && !isPixelSize(current.size || profile.size.default)) return ratioSelection();
    const presets = imageSizePresets(profile).filter((preset) => imageTierAvailable(profile, preset.tier) && validDimensions(preset));
    const tier = currentImageTier(profile, presets, current);
    const preset = tier
        ? nearestRatio(
              presets.filter((item) => item.tier === tier),
              (item) => Math.log(item.width / item.height),
              target,
          )
        : undefined;
    // 没有可用预设时退回模型声明的比例值。
    return preset ? presetSelection(profile, preset) : ratioSelection();
}

/** 参考图比例不标准时取最接近的：优先横竖方向一致或相差 10% 内的比例，都没有时取整体最接近的，不留在 auto。 */
function nearestRatio<T>(items: T[], logRatio: (item: T) => number, target: number): T | undefined {
    let preferred: { item: T; distance: number } | undefined;
    let fallback: { item: T; distance: number } | undefined;
    for (const item of items) {
        const value = logRatio(item);
        const distance = Math.abs(value - target);
        if (!Number.isFinite(distance)) continue;
        if (!fallback || distance < fallback.distance) fallback = { item, distance };
        const accepted = distance <= NEAR_RATIO || orientation(value) === orientation(target);
        if (accepted && (!preferred || distance < preferred.distance)) preferred = { item, distance };
    }
    return (preferred || fallback)?.item;
}

function currentImageTier(profile: ImageCapabilityConfig, presets: ImageResolutionOption[], current: ImageSizeValues): ImageResolutionTier | undefined {
    const tiers = [...new Set(presets.map((preset) => preset.tier))];
    const lower = (value?: string) => (value || "").trim().toLowerCase();
    if (profile.resolution.supported) {
        const tier = lower(current.imageResolution || profile.resolution.default);
        if (tiers.includes(tier)) return tier;
    } else if (profile.size.parameter === "aspect_ratio" && imageResolutionUsesQuality(profile)) {
        const quality = current.quality || profile.quality.default;
        const tier = tiers.find((value) => imageQualityForTier(profile, value) === quality);
        if (tier) return tier;
    } else if (profile.size.parameter === "aspect_ratio" && !profile.quality.supported) {
        const tier = lower(current.quality);
        if (tiers.includes(tier)) return tier;
    }
    const sizeTier = (size?: string) => {
        if (!size) return undefined;
        const tier = (presets.find((preset) => imagePresetValue(profile, preset) === size) || buildImageResolutionOptions([size])[0])?.tier;
        return tier && tiers.includes(tier) ? tier : undefined;
    };
    return sizeTier(current.size) || sizeTier(profile.size.default) || tiers[0];
}

function presetSelection(profile: ImageCapabilityConfig, preset: ImageResolutionOption): ImageSizeSelection {
    const selection: ImageSizeSelection = { size: imagePresetValue(profile, preset) };
    if (profile.resolution.supported) selection.imageResolution = profile.resolution.values.find((value) => value.toLowerCase() === preset.tier) || preset.tier;
    else if (profile.size.parameter === "aspect_ratio") {
        const quality = imageQualityForSelection(profile, preset.tier);
        if (quality) selection.quality = quality;
    }
    return selection;
}

function ratioLog(value: string) {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!match) return Number.NaN;
    const width = Number(match[1]);
    const height = Number(match[2]);
    return width > 0 && height > 0 ? Math.log(width / height) : Number.NaN;
}

function isPixelSize(value?: string) {
    return /^\d+\s*[x×]\s*\d+$/i.test((value || "").trim());
}

function orientation(logRatio: number) {
    return Math.abs(logRatio) <= SQUARE_RATIO ? 0 : Math.sign(logRatio);
}

function validDimensions(value: ImageDimensions) {
    return Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0;
}
