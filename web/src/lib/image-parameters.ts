import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import type { CapabilitySpec, OptionConstraint } from "@/services/api/logical-models";
import { DEFAULT_IMAGE_RATIOS, imagePresetForRatio, imageSizeConfigWithPresets } from "./image-size-presets";
import { protocolImageSizePresets } from "./protocol-image-presets";

export type ImageParameterValue = string | number | boolean;
export type ImageParameter = {
    name: string;
    label: string;
    type: "string" | "number" | "integer" | "boolean";
    description?: string;
    values?: ImageParameterValue[];
    min?: number;
    max?: number;
    step?: number;
    maxLength?: number;
    default?: ImageParameterValue;
    required?: boolean;
    pricing?: boolean;
    binding?: string;
    encoding?: "pixels" | "ratio";
    models?: string[];
    enabled?: boolean;
};

export function imageParameterAccepts(field: ImageParameter, value: unknown): value is ImageParameterValue {
    if (field.type === "string" && (typeof value !== "string" || (field.maxLength !== undefined && value.length > field.maxLength))) return false;
    if (field.type === "boolean" && typeof value !== "boolean") return false;
    if (field.type === "number" || field.type === "integer") {
        if (typeof value !== "number" || !Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) return false;
        if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) return false;
        if (field.step) {
            const steps = (value - (field.min ?? 0)) / field.step;
            if (Math.abs(steps - Math.round(steps)) > 1e-8) return false;
        }
    }
    return !field.values?.length || field.values.includes(value as ImageParameterValue);
}

// 后端把插件未声明参数的能力切片序列化为 null（Go nil slice），默认参数语法
// 只兜 undefined，读路径必须显式归一，避免 null.filter 渲染崩溃。
export function imageParameterDefaults(parameters?: ImageParameter[] | null) {
    return Object.fromEntries((parameters || []).filter((p) => p.enabled !== false && p.default !== undefined).map((p) => [p.name, p.default!])) as Record<string, ImageParameterValue>;
}

export function parseImageParameters(value: unknown): Record<string, ImageParameterValue> {
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return {};
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))));
}

export function normalizeImageParameters(parameters?: ImageParameter[] | null, input: unknown = {}) {
    const fields = parameters || [];
    const values = parseImageParameters(input);
    const result = imageParameterDefaults(fields);
    for (const field of fields) {
        if (field.enabled !== false && imageParameterAccepts(field, values[field.name])) result[field.name] = values[field.name];
    }
    return result;
}

// Only transport encoding knows these host controls. All other names are
// plugin-defined and travel as typed values without a frontend whitelist.
export const imageHostControls = new Set(["size", "imageResolution", "quality", "transparentBackground", "count"]);

export function commonImageParameter(name: string): ImageParameter | undefined {
    const fields: Record<string, ImageParameter> = {
        size: { name, label: "画幅 / 尺寸", type: "string", binding: "aspectRatio", pricing: true },
        imageResolution: { name, label: "分辨率", type: "string", binding: "resolution", pricing: true },
        quality: { name, label: "图片质量", type: "string", binding: "quality", pricing: true },
        count: { name, label: "生成数量", type: "integer", binding: "imageCount", min: 1, step: 1, pricing: true },
        transparentBackground: { name, label: "透明背景", type: "boolean", binding: "transparentBackground", pricing: true },
    };
    return fields[name];
}

export function imageParameterRequest(profile: ImageCapabilityConfig, config: { imageParameters?: string; size?: string; imageResolution?: string; quality?: string; count?: string; transparentBackground?: string }, strict = false) {
    if (!profile.parameters) return undefined;
    if (strict && config.imageParameters) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(config.imageParameters);
        } catch {
            throw new Error("图片扩展参数格式无效，请重新设置");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("图片扩展参数必须是对象");
        for (const field of profile.parameters) {
            if (field.enabled !== false && !imageHostControls.has(field.name) && Object.hasOwn(parsed, field.name) && !imageParameterAccepts(field, (parsed as Record<string, unknown>)[field.name])) throw new Error(`${field.label}超出模型支持范围`);
        }
    }
    const values = parseImageParameters(config.imageParameters);
    for (const field of profile.parameters) {
        if (!imageHostControls.has(field.name)) continue;
        const raw = config[field.name as keyof typeof config];
        if (raw === undefined || raw === "" || ((field.name === "quality" || field.name === "imageResolution") && raw === "auto" && !field.values?.includes("auto"))) continue;
        values[field.name] = field.type === "boolean" ? raw === "true" : field.type === "number" || field.type === "integer" ? Number(raw) : raw;
    }
    const size = profile.parameters.find((p) => p.name === "size" && p.enabled !== false);
    if (size && values.size !== undefined && !imageParameterAccepts(size, values.size)) {
        const requestedTier = values.imageResolution === "auto" ? (profile.resolution.default !== "auto" ? profile.resolution.default : profile.size.defaultTier) : values.imageResolution;
        const preset = profile.size.presets?.find((p) => (p.size === values.size || p.ratio === values.size) && (!requestedTier || p.tier === requestedTier));
        if (preset) {
            if (imageParameterAccepts(size, preset.size)) values.size = preset.size;
            else if (imageParameterAccepts(size, preset.ratio)) values.size = preset.ratio;
        }
    }
    if (strict) {
        for (const field of profile.parameters) {
            if (field.enabled === false) continue;
            const value = values[field.name] ?? field.default;
            if ((value !== undefined && !imageParameterAccepts(field, value)) || (field.required && (value === undefined || value === ""))) throw new Error(`${field.label}超出模型支持范围或尚未填写`);
        }
    }
    return normalizeImageParameters(profile.parameters, values);
}

export function projectImageParameters(profile: ImageCapabilityConfig, parameters: ImageParameter[]): ImageCapabilityConfig {
    const active = new Map(parameters.filter((p) => p.enabled !== false).map((p) => [p.name, p]));
    const stringOption = (name: string) => {
        const p = active.get(name);
        return { supported: Boolean(p), values: (p?.values || []).map(String), default: String(p?.default ?? p?.values?.[0] ?? "auto") };
    };
    const size = active.get("size");
    return {
        ...profile,
        parameters,
        resolutionUsesQuality: false,
        quality: stringOption("quality"),
        resolution: stringOption("imageResolution"),
        transparentBackground: { supported: active.has("transparentBackground"), default: active.get("transparentBackground")?.default === true },
        maxOutputs: active.has("count") ? (active.get("count")?.max ?? Math.max(1, profile.maxOutputs)) : 1,
        size: size
            ? {
                  ...profile.size,
                  parameter: size.encoding
                      ? (size.encoding === "pixels" || size.values?.some((v) => String(v).includes("x"))) && !size.values?.some((v) => String(v).includes(":"))
                          ? "size"
                          : "aspect_ratio"
                      : profile.size.parameter === "none"
                        ? "aspect_ratio"
                        : profile.size.parameter,
                  values: (size.values || []).map(String),
                  default: String(size.default ?? size.values?.[0] ?? "auto"),
                  allowCustom: !size.values?.length,
                  presets: profile.size.presets?.filter(
                      (p) =>
                          (!size.values?.length || size.values.includes(p.ratio) || size.values.includes(p.size)) &&
                          (!active.has("imageResolution") || !active.get("imageResolution")?.values?.length || active.get("imageResolution")!.values!.includes(p.tier)),
                  ),
              }
            : { ...profile.size, parameter: "none", values: [], default: "auto", allowCustom: false },
    };
}

export function updateImageParameterSize(profile: ImageCapabilityConfig, size: ImageCapabilityConfig["size"]): ImageCapabilityConfig {
    const parameters = (profile.parameters || []).map((field) => {
        if (field.name === "size") return { ...field, values: size.values, default: size.default };
        return field;
    });
    return projectImageParameters({ ...profile, size }, parameters);
}

export function updateImageParameterSchema(profile: ImageCapabilityConfig, parameters: ImageParameter[], definitions: ImageParameter[] = parameters, protocol?: string): ImageCapabilityConfig {
    const resolution = parameters.find((field) => field.name === "imageResolution");
    const size = profile.resolution.supported && resolution?.enabled === false ? { ...profile.size, defaultTier: profile.resolution.default === "auto" ? profile.size.defaultTier : profile.resolution.default } : profile.size;
    const next = projectImageParameters({ ...profile, size }, parameters);
    const sizeField = parameters.find((field) => field.name === "size");
    const wasSizeEnabled = profile.parameters?.some((field) => field.name === "size" && field.enabled !== false);
    const added = next.resolution.supported ? next.resolution.values.filter((tier) => !wasSizeEnabled || !profile.resolution.supported || !profile.resolution.values.includes(tier)) : [];
    // 在投影裁剪旧档位前提取已选比例；像素支持值通过已有精确预设还原比例。
    const values = sizeField?.values || [];
    const ratios = [
        ...new Set([
            ...values.filter((value): value is string => typeof value === "string" && /^\d+:\d+$/.test(value)),
            ...(profile.size.presets || []).filter((preset) => !values.length || values.includes(preset.ratio) || values.includes(preset.size)).map((preset) => preset.ratio),
        ]),
    ];
    return initializeImageRatioDefaults(next, definitions, added, ratios.length ? ratios : DEFAULT_IMAGE_RATIOS, protocol);
}

export function initializeImageRatioDefaults(profile: ImageCapabilityConfig, definitions: ImageParameter[], tiers?: string[], preferredRatios = DEFAULT_IMAGE_RATIOS, protocol?: string): ImageCapabilityConfig {
    const field = profile.parameters?.find((p) => p.name === "size");
    const definition = definitions.find((p) => p.name === "size");
    if (!field || field.enabled === false || !definition) return profile;
    const declaredPresets = protocolImageSizePresets(protocol);
    const ratios = preferredRatios.filter((ratio) => imageParameterAccepts(definition, ratio) || declaredPresets.some((p) => p.ratio === ratio && imageParameterAccepts(definition, p.size)));
    if (!ratios.length) return profile;
    if (!profile.resolution.supported && field.encoding === "pixels" && !definition.values?.length && !profile.size.presets?.length && tiers === undefined) {
        const tier = profile.size.defaultTier || "1k";
        return projectImageParameters({ ...profile, size: { ...profile.size, defaultTier: tier, presets: ratios.map((ratio) => imagePresetForRatio(tier, ratio)) } }, profile.parameters!);
    }
    if (!profile.resolution.supported && field.encoding !== "pixels" && tiers === undefined) {
        return projectImageParameters(
            profile,
            profile.parameters!.map((p) => (p.name === "size" ? { ...p, values: ratios, default: ratios.includes(String(p.default)) ? p.default : ratios[0] } : p)),
        );
    }
    const existing = profile.size.presets || [];
    const added = (tiers ?? profile.resolution.values)
        .filter((tier) => tier !== "auto")
        .filter((tier) => !existing.some((p) => p.tier === tier))
        .flatMap((tier) =>
            ratios.flatMap((ratio) => {
                try {
                    const exact = declaredPresets.find((p) => p.tier === tier && p.ratio === ratio);
                    if (declaredPresets.length && !exact && definition.values?.length) return [];
                    return [exact || { ...imagePresetForRatio(tier, ratio), ratio }];
                } catch {
                    // 保留待填写项，避免没有换算规则的档位静默丢失已选比例。
                    return [{ tier, ratio, width: 0, height: 0, size: "" }];
                }
            }),
        );
    if (!added.length) return profile;
    return updateImageParameterSize(profile, imageSizeConfigWithPresets(profile, [...existing, ...added]));
}

export function standardImageSizeEncoding(create = ""): "pixels" | "ratio" | undefined {
    const path = create.split("?", 1)[0].replace(/\/$/, "");
    if (/\/images\/(generations|edits)$/.test(path)) return "pixels";
    if (path.includes("/models/") && path.endsWith(":generateContent")) return "ratio";
    return undefined;
}

export function resolveImageParameters(profile: ImageCapabilityConfig, definitions: ImageParameter[], model: string, protocol?: string, create?: string) {
    const resolutionDefinition = definitions.find((p) => p.name === "imageResolution");
    if (
        !profile.parameters &&
        !profile.resolution.supported &&
        profile.quality.supported &&
        profile.quality.values.length &&
        !definitions.some((p) => p.name === "quality") &&
        resolutionDefinition &&
        profile.quality.values.every((value) => imageParameterAccepts(resolutionDefinition, value))
    ) {
        profile = { ...profile, resolution: { ...profile.quality }, quality: { supported: false, values: [], default: "auto" } };
    }
    const targetEncoding = standardImageSizeEncoding(create);
    definitions = definitions.map((field) => (field.name === "size" && !field.encoding ? { ...field, encoding: targetEncoding || profile.parameters?.find((p) => p.name === "size")?.encoding } : field));
    const configured = new Map(profile.parameters?.map((p) => [p.name, p]));
    for (const name of imageHostControls) {
        if (definitions.some((p) => p.name === name)) continue;
        const legacyEnabled =
            (name === "size" && profile.size.parameter !== "none") ||
            (name === "imageResolution" && profile.resolution.supported) ||
            (name === "quality" && profile.quality.supported) ||
            (name === "count" && profile.maxOutputs > 1) ||
            (name === "transparentBackground" && profile.transparentBackground.supported);
        if (!configured.has(name) && (profile.parameters !== undefined || !legacyEnabled)) continue;
        const field = commonImageParameter(name)!;
        if (name === "size") field.encoding = targetEncoding || configured.get(name)?.encoding || (profile.size.parameter === "size" ? "pixels" : "ratio");
        definitions.push(field);
    }
    const defaults = protocolImageSizePresets(protocol);
    const resolutionDefaults = defaults.length > 0 || protocol === "gemini-image";
    const applicable = definitions.filter((p) => imageHostControls.has(p.name) || !p.models?.length || p.models.includes(model.trim().replace(/^models\//, "")));
    const importAutomaticResolution = protocol === "openai-image" && !configured.has("imageResolution") && !profile.resolution.values.length && profile.size.default === "auto";
    if (resolutionDefaults && profile.size.presets?.length && !configured.has("imageResolution") && !profile.resolution.values.length) {
        const definition = applicable.find((p) => p.name === "imageResolution");
        if (definition) {
            const tiers = [...new Set(profile.size.presets.map((p) => p.tier).filter((tier) => imageParameterAccepts(definition, tier)))];
            const initial = [profile.size.defaultTier, profile.resolution.default, profile.quality.default, String(definition.default)].find((candidate) => candidate && tiers.includes(candidate)) || (tiers.length === 1 ? tiers[0] : undefined);
            if (initial)
                profile = { ...profile, resolution: { supported: true, values: imageParameterAccepts(definition, "auto") ? ["auto", ...tiers] : tiers, default: initial }, size: { ...profile.size, defaultTier: profile.size.defaultTier || initial } };
        }
    }
    const hasQuality = applicable.some((p) => p.name === "quality");
    const parameters: ImageParameter[] = applicable.map((definition) => {
        const current = configured.get(definition.name);
        const common = commonImageParameter(definition.name);
        if (current && common)
            return {
                ...definition,
                type: common.type,
                binding: common.binding,
                pricing: true,
                models: undefined,
                enabled: current.enabled,
                values: current.values,
                min: current.min ?? common.min,
                max: current.max,
                step: current.step ?? common.step,
                maxLength: current.maxLength,
                default: current.default,
            };
        if (current)
            return {
                ...definition,
                enabled: current.enabled,
                values: current.values ?? definition.values,
                min: current.min ?? definition.min,
                max: current.max ?? definition.max,
                step: current.step ?? definition.step,
                default: current.default,
            };
        if (resolutionDefaults && definition.name === "imageResolution" && profile.resolution.values.length) return { ...definition, enabled: profile.resolution.supported, values: profile.resolution.values, default: profile.resolution.default };
        if (profile.parameters) {
            if (definition.name === "imageResolution" && !definition.values?.length && profile.resolution.supported) {
                return { ...definition, values: profile.resolution.values, default: profile.resolution.default };
            }
            return { ...definition };
        }
        let enabled = definition.enabled !== false;
        let values: string[] | undefined;
        let initial: ImageParameterValue | undefined = definition.default;
        switch (definition.name) {
            case "size":
                enabled = profile.size.parameter !== "none";
                values = profile.size.values;
                initial = profile.size.default;
                break;
            case "quality":
                enabled = profile.quality.supported;
                values = profile.quality.values;
                initial = profile.quality.default;
                break;
            case "imageResolution":
                enabled = profile.resolution.supported || (resolutionDefaults && !profile.resolution.values.length && definition.enabled !== false);
                values = profile.resolution.values;
                initial = profile.resolution.default === "auto" && resolutionDefaults ? definition.default : profile.resolution.default;
                if (!profile.resolution.supported && !hasQuality && profile.quality.supported && profile.quality.values.length && profile.quality.values.every((v) => imageParameterAccepts(definition, v))) {
                    enabled = true;
                    values = profile.quality.values;
                    initial = profile.quality.default;
                }
                break;
            case "transparentBackground":
                enabled = profile.transparentBackground.supported;
                initial = profile.transparentBackground.default;
                break;
            case "count":
                return { ...definition, max: profile.maxOutputs };
        }
        const selected = values?.length ? values.filter((v) => common || imageParameterAccepts(definition, v)) : definition.values;
        if (values?.length && !selected?.length) enabled = false;
        const field = { ...definition, enabled, values: selected };
        return { ...field, default: imageParameterAccepts(field, initial) ? initial : (selected?.[0] ?? definition.default) };
    });
    // Keep private extensions visible until the target plugin can validate their
    // mapping. A protocol change must never silently delete model settings.
    for (const field of configured.values()) if (!parameters.some((p) => p.name === field.name)) parameters.push({ ...field });
    if (importAutomaticResolution) for (const field of parameters) if (field.name === "imageResolution" && imageParameterAccepts(field, "auto")) field.default = "auto";
    let resolved = projectImageParameters(profile, parameters);
    const defaultResolution = definitions.find((p) => p.name === "imageResolution")?.default;
    if (resolutionDefaults && !resolved.size.defaultTier && defaultResolution && defaultResolution !== "auto") resolved = { ...resolved, size: { ...resolved.size, defaultTier: String(defaultResolution) } };
    if (!defaults.length || profile.size.presets?.length) return resolved;
    const size = parameters.find((p) => p.name === "size" && p.enabled !== false);
    if (!size) return resolved;
    const unconfigured = !size.values?.length || size.values.every((v) => v === "auto");
    const presets = defaults.filter((p) => (!resolved.resolution.supported || resolved.resolution.values.includes(p.tier)) && (unconfigured || size.values?.includes(p.size) || size.values?.includes(p.ratio)));
    if (!presets.length) return resolved;
    if (size.values?.length && unconfigured) {
        resolved = projectImageParameters(
            resolved,
            parameters.map((p) => (p.name === "size" ? { ...p, values: [...p.values!, ...new Set(presets.map((preset) => preset.size))] } : p)),
        );
    }
    return { ...resolved, size: { ...resolved.size, presets } };
}

export function imageParameterConstraints(parameters: ImageParameter[]) {
    return Object.fromEntries(
        parameters
            .filter((p) => p.enabled !== false)
            .map((p): [string, OptionConstraint] => [
                p.name,
                p.values?.length ? { values: p.values } : p.type === "boolean" ? { values: [false, true] } : p.type === "string" || p.min === undefined || p.max === undefined ? { values: ["*"] } : { min: p.min, max: p.max, step: p.step },
            ]),
    );
}

export function imageParametersForSpec(spec: CapabilitySpec): ImageParameter[] {
    return (spec.imageParameters || []).map((p) => {
        const constraint = spec.options?.[p.name];
        if (!constraint) return { ...p, enabled: false };
        const values = constraint.values?.filter((v): v is ImageParameterValue => v !== "*" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"));
        return { ...p, enabled: true, ...(constraint.values?.includes("*") ? { values: [] } : values?.length ? { values } : {}), min: constraint.min ?? p.min, max: constraint.max ?? p.max, step: constraint.step ?? p.step };
    });
}
