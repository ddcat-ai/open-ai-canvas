import { modelCapabilityConfigFor, normalizeImageValue, videoDurationAllowed, type ImageCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { imageHostControls, imageParameterAccepts, type ImageParameter } from "@/lib/image-parameters";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ModelProtocol } from "@/lib/model-protocols";
import { currentGenerationBatchLimit } from "@/lib/generation-batch-limit";

type ImageSettings = Pick<Partial<AiConfig>, "size" | "quality" | "imageResolution" | "imageParameters" | "count" | "transparentBackground">;
type VideoSettings = { seconds?: string; ratio?: string; resolution?: string };
export type MediaSettingIssue = { field: string; label: string; value: string; message: string; suggested?: string; extension?: boolean };

const present = (value: string | undefined): value is string => value !== undefined && value !== "";
const neutral = (value: string | undefined) => !present(value) || value === "auto";
const match = (values: string[], value: string) => values.find((item) => item.toLowerCase() === value.toLowerCase());

// Only the numeric p suffix is a legacy representation of the same resolution.
// 2K and 1440p (and 4K and 2160p) are not interchangeable without a protocol contract.
export function compatibleVideoResolution(profile: VideoCapabilityConfig, value: string) {
    const key = (input: string) =>
        input
            .trim()
            .toLowerCase()
            .replace(/^(\d+)p$/, "$1");
    return profile.resolutions.find((candidate) => key(candidate) === key(value));
}

function omitsVideoResolution(value: string | undefined, protocol?: ModelProtocol) {
    // These request adapters explicitly omit an automatic resolution. Other
    // protocols still adapt an unsupported value to their configured default.
    return value === "auto" && (protocol === "newapi" || protocol === "openai-video" || protocol === "newapi-channel-2");
}

export function preserveVideoSettings(profile: VideoCapabilityConfig, value: VideoSettings, protocol?: ModelProtocol) {
    const seconds = present(value.seconds) ? value.seconds : String(profile.duration.default);
    return {
        seconds: profile.durationSupported !== false && /^-?\d+$/.test(seconds) && !videoDurationAllowed(profile, Number(seconds)) ? String(profile.duration.default) : seconds,
        ratio: present(value.ratio) && (!profile.ratios.length || profile.ratios.includes(value.ratio)) ? value.ratio : profile.defaultRatio,
        resolution: omitsVideoResolution(value.resolution, protocol)
            ? "auto"
            : present(value.resolution)
              ? (compatibleVideoResolution(profile, value.resolution) ?? (!profile.resolutions.length ? value.resolution : profile.defaultResolution))
              : profile.defaultResolution,
    };
}

// Only capability mismatches are adapted. Malformed values remain visible to
// strict validation; an invalid/missing configured default is never invented.
function parameterTypeValid(field: ImageParameter, value: unknown) {
    return imageParameterAccepts({ ...field, values: undefined, min: undefined, max: undefined, step: undefined, maxLength: undefined }, value);
}

function adaptParameter(field: ImageParameter, raw: unknown) {
    const rawText = typeof raw === "string" ? raw : undefined;
    if (raw !== undefined && !parameterTypeValid(field, raw)) return raw;
    if (imageParameterAccepts(field, raw)) return raw;
    if (rawText !== undefined && field.values?.length) {
        const equivalent = field.values.find((candidate) => typeof candidate === "string" && candidate.toLowerCase() === rawText.toLowerCase());
        if (equivalent !== undefined) return equivalent;
    }
    return field.default;
}

export function preserveVideoBoolean(supported: boolean, initial: boolean, raw?: string) {
    if (present(raw) && raw !== "true" && raw !== "false") return raw;
    return supported ? raw || String(initial) : "false";
}

function imageSizeForSelection(profile: ImageCapabilityConfig, size: string, resolution?: string) {
    if (profile.size.values.includes(size)) return size;
    const declaredRatio = profile.size.presets?.find((preset) => preset.size === size)?.ratio;
    const pixels = /^(\d+)x(\d+)$/i.exec(size);
    const ratioMatches = (ratio: string) => {
        if (ratio === size || ratio === declaredRatio) return true;
        const pair = /^(\d+):(\d+)$/.exec(ratio);
        return Boolean(pixels && pair && Number(pixels[1]) * Number(pair[2]) === Number(pixels[2]) * Number(pair[1]));
    };
    const ratio = profile.size.values.find((candidate) => candidate.includes(":") && ratioMatches(candidate));
    if (ratio) return ratio;
    // Map only through the target model's declared presets, preserving the ratio.
    const tier = neutral(resolution) ? profile.size.defaultTier || profile.resolution.default : resolution;
    const preset = profile.size.presets?.find((item) => ratioMatches(item.ratio) && (!tier || tier === "auto" || item.tier.toLowerCase() === tier.toLowerCase()));
    if (preset && (profile.size.allowCustom || profile.size.values.includes(preset.size))) return preset.size;
    return size;
}

export function preserveImageSettings(profile: ImageCapabilityConfig, value: ImageSettings, protocol?: ModelProtocol) {
    const defaults = normalizeImageValue(profile, {}, protocol);
    const fields = ["size", "quality", "imageResolution", "imageParameters", "count", "transparentBackground"] as const;
    const result = { ...defaults, ...Object.fromEntries(fields.filter((field) => present(value[field])).map((field) => [field, value[field]])) } as typeof defaults & ImageSettings;
    // 这两个既有协议曾用 quality 保存分辨率；只迁移合同中确实存在的档位。
    // 显式的新分辨率优先。
    if (!profile.parameters && !profile.quality.supported && profile.resolution.supported && (protocol === "grok-image" || protocol === "agnes-image")) {
        const legacyResolution = profile.resolution.values.find((item) => item.trim().toLowerCase() === value.quality?.trim().toLowerCase());
        if (legacyResolution) {
            result.quality = defaults.quality;
            if (neutral(value.imageResolution?.trim().toLowerCase())) result.imageResolution = legacyResolution;
        }
    }
    const resolution = profile.parameters?.find((field) => field.name === "imageResolution" && field.enabled !== false);
    if (resolution) result.imageResolution = String(adaptParameter(resolution, result.imageResolution || undefined) ?? "");
    else if (!profile.parameters && profile.resolution.supported && profile.resolution.values.length) result.imageResolution = match(profile.resolution.values, result.imageResolution || "") || profile.resolution.default;
    result.size = imageSizeForSelection(profile, result.size, result.imageResolution);
    if (present(result.quality)) result.quality = match(profile.quality.values, result.quality) ?? result.quality;
    if (present(result.imageResolution)) result.imageResolution = match(profile.resolution.values, result.imageResolution) ?? result.imageResolution;
    let extensions: Record<string, unknown> = {};
    let malformed = false;
    if (value.imageParameters !== undefined) {
        try {
            const parsed = JSON.parse(value.imageParameters || "{}");
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
            extensions = parsed;
            // Typed host mirrors can be stale, but broken types must still fail.
            if (profile.parameters?.some((field) => field.enabled !== false && imageHostControls.has(field.name) && extensions[field.name] !== undefined && !parameterTypeValid(field, extensions[field.name]))) {
                result.imageParameters = value.imageParameters;
                malformed = true;
            }
        } catch {
            result.imageParameters = value.imageParameters;
            malformed = true;
        }
    }
    if (profile.parameters) {
        const adapted: Record<string, unknown> = {};
        for (const field of profile.parameters) {
            if (field.enabled === false) continue;
            let raw: unknown = extensions[field.name];
            if (imageHostControls.has(field.name)) {
                const text = result[field.name as keyof ImageSettings];
                raw =
                    text === undefined || text === ""
                        ? undefined
                        : field.type === "boolean"
                          ? text === "true"
                              ? true
                              : text === "false"
                                ? false
                                : text
                          : field.type === "integer" || field.type === "number"
                            ? Number.isFinite(Number(text))
                                ? Number(text)
                                : text
                            : text;
            }
            const selected = adaptParameter(field, raw);
            if (selected !== undefined) adapted[field.name] = selected;
        }
        for (const name of imageHostControls) {
            const fallback = name === "count" ? "1" : name === "transparentBackground" ? "false" : "";
            result[name as Exclude<keyof ImageSettings, "imageParameters">] = adapted[name] === undefined ? fallback : String(adapted[name]);
        }
        // Keep extension values typed. Do not allow old host-control mirrors to
        // reintroduce an omitted setting in a later request projection.
        if (!malformed) result.imageParameters = JSON.stringify(Object.fromEntries(Object.entries(adapted).filter(([name]) => !imageHostControls.has(name))));
    } else {
        const choose = (raw: string | undefined, initial: string, allowed: (v: string) => boolean) => (present(raw) && allowed(raw) ? raw : initial);
        result.size = profile.size.parameter === "none" ? "auto" : choose(result.size, profile.size.default, (v) => profile.size.allowCustom || profile.size.values.includes(v));
        result.quality = profile.quality.supported
            ? choose(result.quality, profile.quality.default, (v) => !profile.quality.values.length || profile.quality.values.includes(v))
            : !profile.resolution.supported && profile.size.presets?.some((p) => p.tier === result.quality)
              ? result.quality
              : defaults.quality;
        result.imageResolution = profile.resolution.supported ? choose(result.imageResolution, profile.resolution.default, (v) => !profile.resolution.values.length || profile.resolution.values.includes(v)) : "";
        if (/^-?\d+$/.test(result.count) && (Number(result.count) < 1 || Number(result.count) > profile.maxOutputs)) result.count = "1";
        result.transparentBackground = preserveVideoBoolean(profile.transparentBackground.supported, profile.transparentBackground.default, result.transparentBackground);
        if (!malformed) result.imageParameters = "{}";
    }
    return result;
}

const issue = (field: string, label: string, value: string, supported: string[], suggested?: string): MediaSettingIssue => ({
    field,
    label,
    value,
    suggested,
    message: `${label}“${value}”待调整：${supported.length ? `当前模型支持 ${supported.join("、")}` : "当前模型未提供此设置"}`,
});

export function imageSettingIssues(profile: ImageCapabilityConfig, input: ImageSettings, protocol?: ModelProtocol): MediaSettingIssue[] {
    const value = preserveImageSettings(profile, input, protocol);
    const issues: MediaSettingIssue[] = [];
    const defaults = normalizeImageValue(profile, {}, protocol);
    const add = (field: keyof ImageSettings, label: string, values: string[], allowed: boolean) => {
        const raw = value[field];
        if (present(raw) && !allowed) issues.push(issue(field, label, raw, values, defaults[field] ?? ""));
    };
    {
        add("size", "比例/尺寸", profile.size.values, profile.size.parameter === "none" ? neutral(value.size) : profile.size.allowCustom || profile.size.values.includes(value.size));
        add("imageResolution", "分辨率", profile.resolution.values, neutral(value.imageResolution) || Boolean(profile.resolution.supported && (!profile.resolution.values.length || match(profile.resolution.values, value.imageResolution!))));
        add(
            "quality",
            "质量",
            profile.quality.values,
            neutral(value.quality) ||
                Boolean(profile.quality.supported && (!profile.quality.values.length || match(profile.quality.values, value.quality))) ||
                Boolean(!profile.quality.supported && !profile.resolution.supported && profile.size.presets?.some((p) => p.tier === value.quality)),
        );
    }
    add("transparentBackground", "透明背景", ["false"], value.transparentBackground === "false" || (value.transparentBackground === "true" && profile.transparentBackground.supported));
    add("count", "生成张数", [`1–${profile.maxOutputs}`], Number.isInteger(Number(value.count)) && Number(value.count) >= 1 && Number(value.count) <= profile.maxOutputs);
    let extensions: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(value.imageParameters || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        extensions = parsed;
    } catch {
        issues.push({ field: "imageParameters", label: "扩展参数", value: value.imageParameters || "", message: "图片扩展参数格式无效，请重新设置", suggested: "{}" });
    }
    for (const [name, raw] of Object.entries(extensions)) {
        const field = profile.parameters?.find((p) => p.name === name && p.enabled !== false);
        if (imageHostControls.has(name) && (!field || parameterTypeValid(field, raw))) continue;
        if (!field || !imageParameterAccepts(field, raw)) issues.push({ ...issue(name, field?.label || name, String(raw), field?.values?.map(String) || [], field?.default === undefined ? undefined : String(field.default)), extension: true });
    }
    for (const field of profile.parameters || []) {
        if (field.enabled === false) continue;
        const host = imageHostControls.has(field.name);
        const text = host ? value[field.name as keyof ImageSettings] : undefined;
        const raw = host
            ? text === "" || text === undefined
                ? undefined
                : field.type === "boolean"
                  ? text === "true"
                      ? true
                      : text === "false"
                        ? false
                        : text
                  : field.type === "integer" || field.type === "number"
                    ? Number(text)
                    : text
            : extensions[field.name];
        if ((field.default !== undefined && !imageParameterAccepts(field, field.default)) || (field.required && (raw === undefined || raw === "")) || (host && raw !== undefined && !imageParameterAccepts(field, raw))) {
            issues.push({ ...issue(field.name, field.label, String(raw ?? "未填写"), field.values?.map(String) || []), extension: !host });
        }
    }
    return issues;
}

export function videoSettingIssues(profile: VideoCapabilityConfig, input: VideoSettings & { generateAudio?: string; watermark?: string }, protocol?: ModelProtocol): MediaSettingIssue[] {
    const value = preserveVideoSettings(profile, input, protocol);
    const issues: MediaSettingIssue[] = [];
    if (profile.durationSupported !== false && !videoDurationAllowed(profile, Number(value.seconds)))
        issues.push(
            issue(
                "videoSeconds",
                "时长",
                value.seconds,
                profile.duration.selection === "enum" ? (profile.duration.values || []).map(String) : [`${profile.duration.min}–${profile.duration.max} 秒（步长 ${profile.duration.step || 1}）`],
                String(profile.duration.default),
            ),
        );
    if (profile.ratios.length && !profile.ratios.includes(value.ratio)) issues.push(issue("size", "比例", value.ratio, profile.ratios, profile.defaultRatio));
    if (profile.resolutions.length && !omitsVideoResolution(value.resolution, protocol) && !compatibleVideoResolution(profile, value.resolution)) issues.push(issue("vquality", "分辨率", value.resolution, profile.resolutions, profile.defaultResolution));
    for (const [field, raw] of [
        ["videoGenerateAudio", input.generateAudio],
        ["videoWatermark", input.watermark],
    ])
        if (present(raw) && raw !== "true" && raw !== "false") issues.push(issue(field!, "布尔参数", raw, ["true", "false"]));
    return issues;
}

export function mediaSettingIssues(config: AiConfig, capability: string, model = config.model): MediaSettingIssue[] {
    if (capability !== "image" && capability !== "video") return [];
    const profile = modelCapabilityConfigFor(config, model);
    if (capability === "video" && profile.video?.processing) return [];
    const issues =
        capability === "image" && profile.image
            ? imageSettingIssues(profile.image, config, resolveModelRequestConfig(config, model).interfaceType)
            : capability === "video" && profile.video
              ? videoSettingIssues(
                    profile.video,
                    { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality, generateAudio: config.videoGenerateAudio, watermark: config.videoWatermark },
                    resolveModelRequestConfig(config, model).interfaceType,
                )
              : [];
    return issues;
}

export function resolvedMediaConfig(config: AiConfig, capability: string, model = config.model): AiConfig {
    const profile = modelCapabilityConfigFor(config, model);
    const protocol = resolveModelRequestConfig(config, model).interfaceType;
    if (capability === "video" && profile.video?.processing) return config;
    if (capability === "image" && profile.image) {
        const adapted = preserveImageSettings(profile.image, config, resolveModelRequestConfig(config, model).interfaceType);
        // 调用方会将图片批次拆成独立任务；模型单次输出数不能改变批次张数。
        const count = /^\d+$/.test(config.count) && Number(config.count) >= 1 ? String(Math.min(Number(config.count), currentGenerationBatchLimit())) : adapted.count;
        return { ...config, model, ...adapted, count };
    }
    if (capability === "video" && profile.video) {
        const value = preserveVideoSettings(profile.video, { ratio: config.size, seconds: config.videoSeconds, resolution: config.vquality }, protocol);
        return {
            ...config,
            model,
            size: value.ratio,
            videoSeconds: value.seconds,
            vquality: value.resolution,
            videoGenerateAudio: preserveVideoBoolean(profile.video.generateAudio.supported, profile.video.generateAudio.default, config.videoGenerateAudio),
            videoWatermark: preserveVideoBoolean(profile.video.watermark.supported, profile.video.watermark.default, config.videoWatermark),
        };
    }
    return config;
}

export function assertMediaSettings(config: AiConfig, capability: string, model = config.model) {
    const issues = mediaSettingIssues(config, capability, model);
    if (issues.length) throw new Error(issues.map((item) => item.message).join("；"));
}
