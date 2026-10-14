import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import type { CapabilitySpec, OptionConstraint } from "@/services/api/logical-models";
import { DEFAULT_IMAGE_RATIOS, imagePresetForRatio, imageSizeConfigWithPresets } from "./image-size-presets";

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
        const preset = profile.size.presets?.find((p) => p.size === values.size && (!values.imageResolution || p.tier === values.imageResolution));
        if (preset && imageParameterAccepts(size, preset.ratio)) values.size = preset.ratio;
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
        maxOutputs: active.get("count")?.max ?? 1,
        size: size
            ? {
                  ...profile.size,
                  parameter: size.encoding ? (size.encoding === "pixels" && !size.values?.some((v) => String(v).includes(":")) ? "size" : "aspect_ratio") : profile.size.parameter === "none" ? "aspect_ratio" : profile.size.parameter,
                  values: (size.values || []).map(String),
                  default: String(size.default ?? size.values?.[0] ?? "auto"),
                  allowCustom: !size.values?.length,
                  presets: profile.size.presets?.filter(
                      (p) =>
                          (!size.values?.length || size.values.includes(p.ratio) || size.values.includes(p.size)) &&
                          (!active.has("imageResolution") || !active.get("imageResolution")?.values?.length || active.get("imageResolution")!.values!.includes(p.tier)),
                  ),
              }
            : { parameter: "none", values: [], default: "auto", allowCustom: false },
    };
}

export function updateImageParameterSize(profile: ImageCapabilityConfig, size: ImageCapabilityConfig["size"]): ImageCapabilityConfig {
    const parameters = (profile.parameters || []).map((field) => {
        if (field.name === "size") return { ...field, values: size.values, default: size.default };
        return field;
    });
    return projectImageParameters({ ...profile, size }, parameters);
}

export function updateImageParameterSchema(profile: ImageCapabilityConfig, parameters: ImageParameter[], definitions: ImageParameter[] = parameters): ImageCapabilityConfig {
    const resolution = parameters.find((field) => field.name === "imageResolution");
    const size = profile.resolution.supported && resolution?.enabled === false ? { ...profile.size, defaultTier: profile.resolution.default } : profile.size;
    const next = projectImageParameters({ ...profile, size }, parameters);
    const previous = profile.parameters?.find((field) => field.name === "imageResolution")?.values || [];
    const added = next.resolution.supported ? next.resolution.values.filter((tier) => !previous.includes(tier)) : [];
    return initializeImageRatioDefaults(next, definitions, added);
}

export function initializeImageRatioDefaults(profile: ImageCapabilityConfig, definitions: ImageParameter[], tiers?: string[]): ImageCapabilityConfig {
    const field = profile.parameters?.find((p) => p.name === "size");
    const definition = definitions.find((p) => p.name === "size");
    if (!field || field.enabled === false || !definition) return profile;
    const ratios = DEFAULT_IMAGE_RATIOS.filter((ratio) => imageParameterAccepts(definition, ratio));
    if (!ratios.length) return profile;
    if (!profile.resolution.supported && field.encoding !== "pixels" && tiers === undefined) {
        return projectImageParameters(
            profile,
            profile.parameters!.map((p) => (p.name === "size" ? { ...p, values: ratios, default: ratios.includes(String(p.default)) ? p.default : ratios[0] } : p)),
        );
    }
    const existing = profile.size.presets || [];
    const added = (tiers ?? profile.resolution.values)
        .filter((tier) => !existing.some((p) => p.tier === tier))
        .flatMap((tier) =>
            ratios.flatMap((ratio) => {
                try {
                    return [imagePresetForRatio(tier, ratio)];
                } catch {
                    return [];
                }
            }),
        );
    if (!added.length) return profile;
    return updateImageParameterSize(profile, imageSizeConfigWithPresets(profile, [...existing, ...added]));
}

export function resolveImageParameters(profile: ImageCapabilityConfig, definitions: ImageParameter[], model: string) {
    const applicable = definitions.filter((p) => !p.models?.length || p.models.includes(model.trim().replace(/^models\//, "")));
    const configured = new Map(profile.parameters?.map((p) => [p.name, p]));
    const hasQuality = applicable.some((p) => p.name === "quality");
    const parameters = applicable.map((definition) => {
        const current = configured.get(definition.name);
        if (current) return { ...definition, enabled: current.enabled, values: current.values ?? definition.values, min: current.min ?? definition.min, max: current.max ?? definition.max, step: current.step ?? definition.step, default: current.default };
        if (profile.parameters) return definition;
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
                enabled = profile.resolution.supported;
                values = profile.resolution.values;
                initial = profile.resolution.default;
                if (!enabled && !hasQuality && profile.quality.supported && profile.quality.values.length && profile.quality.values.every((v) => imageParameterAccepts(definition, v))) {
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
                return { ...definition, max: Math.min(profile.maxOutputs, definition.max ?? profile.maxOutputs) };
        }
        const selected = values?.length ? values.filter((v) => imageParameterAccepts(definition, v)) : definition.values;
        if (values?.length && !selected?.length) enabled = false;
        const field = { ...definition, enabled, values: selected };
        return { ...field, default: imageParameterAccepts(field, initial) ? initial : (selected?.[0] ?? definition.default) };
    });
    return projectImageParameters(profile, parameters);
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
        return { ...p, enabled: true, ...(values?.length ? { values } : {}), min: constraint.min ?? p.min, max: constraint.max ?? p.max, step: constraint.step ?? p.step };
    });
}
