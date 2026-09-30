// 工作流（RunningHub 等）字段到模型能力的推导：字段角色、取值范围、可选项、默认值与提交值。
//
// 与后端 workflow_provider_values.go 的取值规则保持一致；改动任何一边都要同步另一边。

import { type ImageCapabilityConfig, type VideoCapabilityConfig, defaultModelCapabilityConfig } from "./model-capabilities";

// 工作流字段是供应商参数的唯一事实来源；不能用普通视频模型的固定清晰度列表覆盖它。
export type WorkflowVideoFieldLike = {
    nodeId?: string;
    classType?: string;
    fieldName?: string;
    label?: string;
    role?: string;
    safeToOverride?: boolean;
    optionsSource?: string;
    enabled?: boolean;
    source?: string;
    sourceFromUpstream?: boolean;
    randomEnabled?: boolean;
    fieldType?: string;
    options?: unknown[];
    fieldValue?: unknown;
    value?: unknown;
    default?: unknown;
    defaultValue?: unknown;
    min?: unknown;
    max?: unknown;
    step?: unknown;
};

export type WorkflowFieldNumberBounds = { min?: number; max?: number; step?: number };

export function workflowFieldKey(field: WorkflowVideoFieldLike) {
    return `field:${String(field.nodeId || "").trim()}:${String(field.fieldName || "").trim()}`;
}

export function workflowFieldRandomKey(field: WorkflowVideoFieldLike) {
    return `random:${String(field.nodeId || "").trim()}:${String(field.fieldName || "").trim()}`;
}

export function workflowFieldSource(field: WorkflowVideoFieldLike) {
    return String(field.source || "")
        .trim()
        .replace(/[\s_-]/g, "")
        .toLowerCase();
}

export function workflowParameterFields(fields: readonly WorkflowVideoFieldLike[]) {
    return fields.filter((field) => {
        const source = workflowFieldSource(field);
        const fieldType = String(field.fieldType || "")
            .trim()
            .toUpperCase();
        if (!field.fieldName || !field.nodeId || field.enabled === false || !workflowFieldSafeToOverride(field)) return false;
        if (["prompt", "text", "positiveprompt", "positive", "referenceimage", "image", "referencevideo", "video", "referenceaudio", "audio", "mask"].includes(source)) return false;
        if (["IMAGE", "VIDEO", "AUDIO"].includes(fieldType)) return false;
        return true;
    });
}

export function workflowFieldSafeToOverride(field: WorkflowVideoFieldLike) {
    if (field.safeToOverride === false) return false;
    const classType = String(field.classType || "")
        .trim()
        .toLowerCase();
    const fieldName = String(field.fieldName || "")
        .trim()
        .toLowerCase();
    if (classType === "int" && fieldName === "value") return false;
    return classType !== "imageresize+" || !["width", "height", "multiple_of"].includes(fieldName);
}

export function workflowFieldRole(field: WorkflowVideoFieldLike) {
    if (["prompt", "media", "business", "internal"].includes(String(field.role || ""))) return String(field.role);
    const source = workflowFieldSource(field);
    const fieldType = String(field.fieldType || "")
        .trim()
        .toUpperCase();
    if (["prompt", "text", "positiveprompt", "positive"].includes(source)) return "prompt";
    if (["referenceimage", "image", "referencevideo", "video", "referenceaudio", "audio", "mask"].includes(source) || ["IMAGE", "VIDEO", "AUDIO"].includes(fieldType)) return "media";
    if (!workflowFieldSafeToOverride(field)) return "internal";
    const key = normalizeWorkflowVideoFieldKey(String(field.fieldName || ""));
    if (
        [
            "aspectratio",
            "ratio",
            "duration",
            "durationseconds",
            "seconds",
            "videoseconds",
            "quality",
            "resolution",
            "seed",
            "noiseseed",
            "steps",
            "step",
            "sigmapoints",
            "cfg",
            "cfgscale",
            "guidance",
            "guidancescale",
            "sampler",
            "samplername",
            "scheduler",
            "fps",
            "count",
            "batch",
            "batchsize",
            "generateaudio",
            "watermark",
            "negativeprompt",
            "systemprompt",
        ].includes(key)
    )
        return "business";
    return field.classType ? "internal" : "business";
}

/** 读取工作流字段声明的连续数值范围；兼容 RunningHub 将范围包在 options/range 中的返回格式。 */
export function workflowFieldNumberBounds(field: WorkflowVideoFieldLike | undefined): WorkflowFieldNumberBounds {
    if (!field) return {};
    const sources: Record<string, unknown>[] = [field as unknown as Record<string, unknown>];
    const options = Array.isArray(field.options) ? field.options : [];
    options.forEach((option) => {
        if (!option || typeof option !== "object" || Array.isArray(option)) return;
        const item = option as Record<string, unknown>;
        const nested = item.range;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) sources.push(nested as Record<string, unknown>);
        if (["min", "max", "step", "minValue", "maxValue", "stepValue"].some((key) => item[key] !== undefined)) sources.push(item);
    });
    const read = (keys: string[]) => {
        for (const source of sources) {
            for (const key of keys) {
                const raw = source[key];
                if (raw === undefined || raw === null || String(raw).trim() === "") continue;
                const value = Number(raw);
                if (Number.isFinite(value)) return value;
            }
        }
        return undefined;
    };
    return { min: read(["min", "minValue", "min_value"]), max: read(["max", "maxValue", "max_value"]), step: read(["step", "stepValue", "step_value"]) };
}

/** 只有真正的枚举项才作为下拉选项；范围对象交给 InputNumber。 */
export function workflowFieldChoiceValues(field: WorkflowVideoFieldLike | undefined) {
    const bounds = workflowFieldNumberBounds(field);
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.step !== undefined) return [];
    const protocolOptions = workflowFieldChoiceValuesFromProtocol(field);
    if (protocolOptions.length) return protocolOptions;
    const options = Array.isArray(field?.options) ? field.options : [];
    return options.filter((option) => !workflowFieldOptionIsRange(option));
}

/** ComfyUI 的枚举按完整字符串校验；旧画布中的比例简写只能映射到唯一同前缀原值。 */
export function workflowFieldSubmissionValue(field: WorkflowVideoFieldLike, value: unknown) {
    const choices = workflowFieldSubmissionChoices(field);
    const submitted = workflowFieldOptionValue(value);
    if (!choices.length || choices.some((choice) => workflowFieldOptionValue(choice) === submitted)) return value;
    const ratio = workflowRatioPrefix(submitted);
    if (!ratio) return value;
    const matches = choices.filter((choice) => workflowRatioPrefix(workflowFieldOptionValue(choice)) === ratio);
    return matches.length === 1 ? workflowFieldOptionValue(matches[0]) : value;
}

export const resolutionSelectorAspectRatioOptions = ["1:1 (Square)", "2:3 (Portrait Photo)", "3:2 (Photo)", "3:4 (Portrait Standard)", "4:3 (Standard)", "9:16 (Portrait Widescreen)", "16:9 (Widescreen)", "21:9 (Ultrawide)"];

export function workflowFieldSubmissionChoices(field: WorkflowVideoFieldLike) {
    const classType = normalizeWorkflowVideoFieldKey(String(field.classType || ""));
    const fieldName = normalizeWorkflowVideoFieldKey(String(field.fieldName || ""));
    // RunningHub 的 API JSON 只有当前值，没有 ComfyUI object_info。该节点的真实枚举
    // 来自节点类型合同，不能使用通用比例模板冒充上游 options。
    if (classType === "resolutionselector" && fieldName === "aspectratio") return resolutionSelectorAspectRatioOptions;
    return workflowFieldChoiceValues(field);
}

export function workflowRatioPrefix(value: string) {
    const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(?:\s|\(|$)/);
    return match ? `${match[1]}:${match[2]}` : "";
}

export const workflowKnownOptions: Record<string, string[]> = {
    aspectratio: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9", "9:21"],
    ratio: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9", "9:21"],
    resolution: ["512", "768", "1024", "1280", "1536", "2048", "1k", "2k", "4k"],
    size: ["512", "768", "1024", "1280", "1536", "2048"],
    sampler: ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpmpp_2m", "dpmpp_sde", "ddim", "uni_pc"],
    samplername: ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpmpp_2m", "dpmpp_sde", "ddim", "uni_pc"],
    scheduler: ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"],
};

export function workflowFieldPresetOptions(field: WorkflowVideoFieldLike | undefined) {
    if (!field) return [];
    const fieldType = String(field.fieldType || "")
        .trim()
        .toUpperCase();
    if (["NUMBER", "FLOAT", "INTEGER", "INT", "SLIDER", "BOOLEAN", "BOOL", "IMAGE", "VIDEO", "AUDIO"].includes(fieldType)) return [];
    const classType = normalizeWorkflowVideoFieldKey(String(field.classType || ""));
    const key = normalizeWorkflowVideoFieldKey(String(field.fieldName || ""));
    if (classType === "resolutionselector" && key === "aspectratio") return resolutionSelectorAspectRatioOptions;
    return workflowKnownOptions[key] || [];
}

export function workflowFieldConfigurationError(field: WorkflowVideoFieldLike) {
    const bounds = workflowFieldNumberBounds(field);
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) return "最小值不能大于最大值";
    if (bounds.step !== undefined && bounds.step <= 0) return "步长必须大于 0";
    return "";
}

export function workflowFieldValueError(field: WorkflowVideoFieldLike, value: unknown) {
    const configurationError = workflowFieldConfigurationError(field);
    if (configurationError) return configurationError;
    const fieldType = String(field.fieldType || "")
        .trim()
        .toUpperCase();
    const bounds = workflowFieldNumberBounds(field);
    const numeric = ["NUMBER", "FLOAT", "INTEGER", "INT", "SLIDER"].includes(fieldType) || bounds.min !== undefined || bounds.max !== undefined || bounds.step !== undefined;
    if (numeric) {
        if (value === undefined || value === null || String(value).trim() === "" || !Number.isFinite(Number(value))) return "请输入有效数字";
        const parsed = Number(value);
        if ((bounds.min !== undefined && parsed < bounds.min) || (bounds.max !== undefined && parsed > bounds.max)) return "数值超出允许范围";
        if (bounds.step !== undefined) {
            const start = bounds.min ?? 0;
            const steps = (parsed - start) / bounds.step;
            if (Math.abs(steps - Math.round(steps)) > 1e-7) return "数值不符合步长";
        }
    }
    const options = workflowFieldChoiceValues(field).map(workflowFieldOptionValue);
    if (options.length && !options.includes(workflowFieldOptionValue(value))) return "当前值不在允许选项中";
    return "";
}

export function workflowImageCapabilityConfig(fields: readonly WorkflowVideoFieldLike[], fallback = defaultModelCapabilityConfig().image!): ImageCapabilityConfig {
    const ratioField = fields.find((field) => workflowVideoFieldMatches(field, "aspectratio"));
    const sizeField = fields.find((field) => workflowVideoFieldMatches(field, "size"));
    const qualityField = fields.find((field) => workflowVideoFieldMatches(field, "quality"));
    const ratioOptions = workflowFieldChoiceValues(ratioField).map(workflowFieldOptionValue).filter(Boolean);
    const ratioDefault = workflowFieldDefaultValue(ratioField);
    const sizeOptions = workflowFieldChoiceValues(sizeField).map(workflowFieldOptionValue).filter(Boolean);
    const sizeDefault = workflowFieldDefaultValue(sizeField);
    const qualityOptions = workflowFieldChoiceValues(qualityField).map(workflowFieldOptionValue).filter(Boolean);
    return {
        ...fallback,
        size: ratioField
            ? { parameter: "aspect_ratio", values: ratioOptions.length ? ratioOptions : ratioDefault ? [ratioDefault] : [], default: ratioDefault || ratioOptions[0] || "auto", allowCustom: false }
            : sizeField
              ? { parameter: "size", values: sizeOptions.length ? sizeOptions : sizeDefault ? [sizeDefault] : [], default: sizeDefault || sizeOptions[0] || "auto", allowCustom: false }
              : { ...fallback.size, values: [], default: "auto", allowCustom: false },
        quality: qualityField ? { supported: qualityOptions.length > 0, values: qualityOptions, default: workflowFieldDefaultValue(qualityField) || qualityOptions[0] || "auto" } : { supported: false, values: [], default: "auto" },
        transparentBackground: { supported: false, default: false },
        maxOutputs: 1,
    };
}

export function workflowVideoCapabilityConfig(fields: readonly WorkflowVideoFieldLike[], fallback = defaultModelCapabilityConfig().video!): VideoCapabilityConfig {
    const profile: VideoCapabilityConfig = {
        ...fallback,
        references: { ...fallback.references },
        duration: { ...fallback.duration, values: fallback.duration.values ? [...fallback.duration.values] : undefined },
        ratios: [...fallback.ratios],
        resolutions: [...fallback.resolutions],
        generateAudio: { ...fallback.generateAudio },
        watermark: { ...fallback.watermark },
    };
    // 工作流没有统一的分辨率/时长协议。清空普通模型的候选值，
    // 后面只根据工作流字段自身声明的 options 或数值范围恢复控件。
    profile.resolutions = [];
    profile.defaultResolution = "";
    profile.ratios = [];
    profile.defaultRatio = "";
    profile.duration = { selection: "enum", values: [], default: fallback.duration.default };
    profile.generateAudio = { supported: false, default: false };
    profile.watermark = { supported: false, default: false };
    const resolutionField = fields.find((field) => workflowVideoFieldMatches(field, "vquality"));
    const durationField = fields.find((field) => workflowVideoFieldMatches(field, "videoseconds"));
    const ratioField = fields.find((field) => workflowVideoFieldMatches(field, "aspectratio"));

    if (resolutionField) {
        const options = workflowFieldChoiceValues(resolutionField).map(workflowFieldOptionValue).filter(Boolean);
        const bounds = workflowFieldNumberBounds(resolutionField);
        const generated = options.length ? options : bounds.min !== undefined && bounds.max !== undefined ? [] : workflowNumericFieldValues(resolutionField);
        const defaultValue = workflowFieldDefaultValue(resolutionField);
        if (bounds.min === undefined || bounds.max === undefined || bounds.max < bounds.min) {
            if (generated.length) profile.resolutions = generated;
        } else if (defaultValue !== "") profile.resolutions = [defaultValue];
        if (profile.resolutions.length) profile.defaultResolution = matchWorkflowValue(defaultValue, profile.resolutions) || profile.resolutions[0];
    }
    if (durationField) {
        const options = workflowFieldChoiceValues(durationField)
            .map(workflowFieldOptionValue)
            .map(workflowDurationNumber)
            .filter((value): value is number => value !== undefined);
        const bounds = workflowFieldNumberBounds(durationField);
        const generated = options.length ? options : workflowNumericFieldValues(durationField).map(Number).filter(Number.isFinite);
        const defaultValue = Number(workflowFieldDefaultValue(durationField));
        if (generated.length) {
            profile.duration = { selection: "enum", values: [...new Set(generated)], default: Number.isFinite(defaultValue) ? defaultValue : generated[0] };
        } else {
            const min = bounds.min;
            const max = bounds.max;
            const step = bounds.step;
            if (min !== undefined && max !== undefined && max >= min) {
                profile.duration = { selection: "range", min, max, ...(step !== undefined && step > 0 ? { step } : {}), default: Number.isFinite(defaultValue) ? defaultValue : min };
            } else if (Number.isFinite(defaultValue)) {
                // 只有默认值时不能臆造通用时长选项，只保留工作流当前值。
                profile.duration = { selection: "enum", values: [defaultValue], default: defaultValue };
            }
        }
    }
    if (ratioField) {
        const options = workflowFieldOptionValues(ratioField.options);
        const defaultValue = workflowFieldDefaultValue(ratioField);
        // 工作流声明了比例字段时，不能继续沿用普通模型的比例列表。
        // 没有 options 时只保留该字段当前默认值（例如 `auto`）。
        profile.ratios = options.length ? options : defaultValue ? [defaultValue] : [];
        if (profile.ratios.length) profile.defaultRatio = matchWorkflowValue(defaultValue, profile.ratios) || profile.ratios[0];
    }
    const generateAudioField = fields.find((field) => workflowBooleanFieldMatches(field, "generateaudio"));
    const watermarkField = fields.find((field) => workflowBooleanFieldMatches(field, "watermark"));
    if (generateAudioField) profile.generateAudio = { supported: true, default: workflowBooleanDefault(generateAudioField) };
    if (watermarkField) profile.watermark = { supported: true, default: workflowBooleanDefault(watermarkField) };
    return profile;
}

/** 读取工作流当前选择的比例/尺寸；字段没有语义名时仅识别纯尺寸枚举。 */
export function workflowOutputSizeValue(fields: readonly WorkflowVideoFieldLike[], values: Readonly<Record<string, unknown>>) {
    const field =
        fields.find((item) => workflowVideoFieldMatches(item, "aspectratio")) ||
        fields.find((item) => workflowVideoFieldMatches(item, "size")) ||
        fields.find((item) => {
            const options = workflowFieldChoiceValues(item).map(workflowFieldOptionValue).filter(Boolean);
            return options.length > 1 && options.every(workflowOutputSizeLike);
        });
    const value = workflowFieldCurrentValue(field, values);
    const submitted = !field || value === undefined ? "" : workflowFieldOptionValue(workflowFieldSubmissionValue(field, value));
    return submitted || workflowVideoDefaultSize(fields, values);
}

/** 从工作流同一节点的 width/height 字段读取默认输出尺寸。 */
export function workflowVideoDefaultSize(fields: readonly WorkflowVideoFieldLike[], values: Readonly<Record<string, unknown>> = {}) {
    const candidates = fields.filter((field) => workflowDimensionFieldMatches(field, "width") || workflowDimensionFieldMatches(field, "height"));
    const groups = Array.from(new Set(candidates.map((field) => String(field.nodeId || "").trim()).filter(Boolean)));
    const orderedGroups = groups.sort((left, right) => {
        const leftResize = candidates.some(
            (field) =>
                String(field.nodeId || "").trim() === left &&
                String(field.label || "")
                    .toLowerCase()
                    .includes("imageresize"),
        );
        const rightResize = candidates.some(
            (field) =>
                String(field.nodeId || "").trim() === right &&
                String(field.label || "")
                    .toLowerCase()
                    .includes("imageresize"),
        );
        return Number(leftResize) - Number(rightResize);
    });
    for (const nodeId of orderedGroups) {
        const nodeFields = candidates.filter((field) => String(field.nodeId || "").trim() === nodeId);
        const width = nodeFields.find((field) => workflowDimensionFieldMatches(field, "width"));
        const height = nodeFields.find((field) => workflowDimensionFieldMatches(field, "height"));
        const widthValue = workflowNumber(workflowFieldCurrentValue(width, values));
        const heightValue = workflowNumber(workflowFieldCurrentValue(height, values));
        if (widthValue !== undefined && widthValue > 0 && heightValue !== undefined && heightValue > 0) return `${Math.round(widthValue)}x${Math.round(heightValue)}`;
    }
    return "";
}

export function workflowVideoFieldsFromJson(value: Record<string, unknown> | undefined) {
    if (!value || typeof value !== "object") return [] as WorkflowVideoFieldLike[];
    const fields: WorkflowVideoFieldLike[] = [];
    Object.entries(value).forEach(([nodeId, rawNode]) => {
        if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) return;
        const node = rawNode as Record<string, unknown>;
        const classType = String(node.class_type || node.type || "").trim();
        const inputs = node.inputs;
        if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return;
        Object.entries(inputs as Record<string, unknown>).forEach(([fieldName, fieldValue]) => {
            if (Array.isArray(fieldValue)) return;
            const fieldType = typeof fieldValue === "number" ? "NUMBER" : typeof fieldValue === "boolean" ? "BOOLEAN" : "TEXT";
            const candidate = { nodeId, classType, fieldName, fieldValue, fieldType };
            const safeToOverride = workflowFieldSafeToOverride(candidate);
            const role = workflowFieldRole(candidate);
            fields.push({ ...candidate, safeToOverride, role, enabled: safeToOverride && role !== "internal" });
        });
    });
    return fields;
}

export function workflowVideoFieldMatches(field: WorkflowVideoFieldLike, source: string) {
    const keys = [field.source, field.fieldName, field.label].map((value) => normalizeWorkflowVideoFieldKey(String(value || ""))).filter(Boolean);
    if (source === "vquality") {
        // quality 是工作流自己的质量参数（可能是 0.1-3 这类连续值），
        // 只有显式 videoquality/videoresolution/vquality 才属于视频分辨率。
        if (workflowFieldSource(field) === "quality" || keys.some((key) => ["quality", "imagequality"].includes(key))) return false;
        return keys.some((key) => ["vquality", "videoresolution", "videoquality", "resolution"].includes(key) || key.includes("清晰度") || key.includes("分辨率"));
    }
    if (source === "videoseconds") {
        return keys.some((key) => ["videoseconds", "duration", "seconds", "durationseconds", "videoduration", "videodurationseconds", "videolength", "clipduration"].includes(key) || key.includes("时长") || key.includes("秒数"));
    }
    if (source === "size") {
        return keys.some((key) => ["size", "imagesize", "imageresolution", "resolution"].includes(key));
    }
    if (source === "quality") {
        return workflowFieldSource(field) === "quality" || keys.some((key) => ["quality", "imagequality"].includes(key) || key.includes("清晰度"));
    }
    return keys.some((key) => ["aspectratio", "ratio", "imageaspectratio", "imageratio", "videoaspectratio", "videoratio"].includes(key));
}

export function workflowDimensionFieldMatches(field: WorkflowVideoFieldLike, dimension: "width" | "height") {
    const keys = [field.source, field.fieldName, field.label].map((value) => normalizeWorkflowVideoFieldKey(String(value || ""))).filter(Boolean);
    return keys.some((key) => key === dimension || key.endsWith(dimension) || key.includes(`${dimension}pixels`));
}

export function workflowBooleanFieldMatches(field: WorkflowVideoFieldLike, name: "generateaudio" | "watermark") {
    const keys = [field.source, field.fieldName, field.label].map((value) => normalizeWorkflowVideoFieldKey(String(value || ""))).filter(Boolean);
    return keys.some((key) => key === name || key.endsWith(name));
}

export function workflowBooleanDefault(field: WorkflowVideoFieldLike) {
    const value = workflowFieldDefaultValue(field).toLowerCase();
    return value === "true" || value === "1" || value === "yes";
}

export function normalizeWorkflowVideoFieldKey(value: string) {
    return String(value)
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

export function workflowFieldOptionValues(options: unknown[] | undefined) {
    if (!Array.isArray(options)) return [] as string[];
    return options
        .filter((option) => !workflowFieldOptionIsRange(option))
        .map(workflowFieldOptionValue)
        .filter(Boolean);
}

export function workflowFieldChoiceValuesFromProtocol(field: WorkflowVideoFieldLike | undefined) {
    const explicit = workflowFieldOptionValues(field?.options);
    if (explicit.length) return explicit;
    const classType = normalizeWorkflowVideoFieldKey(String(field?.classType || ""));
    const fieldName = normalizeWorkflowVideoFieldKey(String(field?.fieldName || ""));
    // RunningHub 对该节点有固定枚举，但 getJsonApiFormat 可能只返回默认值；
    // 只有节点类型和字段名同时匹配时才补齐，避免把所有工作流比例强制成同一套选项。
    if (classType === "resolutionselector" && fieldName === "aspectratio") return resolutionSelectorAspectRatioOptions;
    return [] as string[];
}

export function workflowFieldOptionIsRange(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    const nested = item.range;
    return [item, nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : undefined].some(
        (candidate) => candidate && ["min", "max", "step", "minValue", "maxValue", "stepValue"].some((key) => candidate[key] !== undefined),
    );
}

export function workflowFieldOptionValue(value: unknown): string {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const item = value as Record<string, unknown>;
        for (const key of ["value", "id", "key", "name", "label"]) {
            if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) return String(item[key]).trim();
        }
    }
    return value === undefined || value === null ? "" : String(value).trim();
}

export function workflowOutputSizeLike(value: string) {
    return /^\d+(?:\.\d+)?(?:x|:)\d+(?:\.\d+)?(?:-|$)/i.test(value.trim());
}

export function workflowFieldDefaultValue(field: WorkflowVideoFieldLike | undefined) {
    if (!field) return "";
    return workflowFieldOptionValue(field.fieldValue ?? field.defaultValue ?? field.value ?? field.default);
}

/**
 * 读取画布当前的工作流字段值。新版本按 nodeId + fieldName 保存；旧画布曾按
 * source 语义键保存，比例字段必须兼容读取，否则会静默回退到工作流默认的 1:1。
 */
export function workflowFieldCurrentValue(field: WorkflowVideoFieldLike | undefined, values: Readonly<Record<string, unknown>>) {
    if (!field) return undefined;
    for (const key of [workflowFieldKey(field), ...workflowFieldLegacyKeys(field)]) {
        if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    }
    // 旧画布和新工作流 schema 可能分别使用 aspectRatio / aspect_ratio，
    // 字段语义相同但存储键不同。读取时按节点号和规范化字段名兼容，
    // 避免找不到用户已选值后回退到工作流或全局默认比例。
    const nodeKey = normalizeWorkflowParameterPart(field.nodeId);
    const fieldKeys = [field.fieldName, field.source, field.label].map((value) => normalizeWorkflowParameterPart(value)).filter(Boolean);
    if (nodeKey && fieldKeys.length) {
        for (const [key, value] of Object.entries(values)) {
            const match = key.match(/^field:([^:]+):(.+)$/i);
            if (!match) continue;
            if (normalizeWorkflowParameterPart(match[1]) === nodeKey && fieldKeys.includes(normalizeWorkflowParameterPart(match[2]))) return value;
        }
    }
    return field.fieldValue ?? field.defaultValue ?? field.value ?? field.default;
}

export function workflowFieldHasStoredValue(field: WorkflowVideoFieldLike | undefined, values: Readonly<Record<string, unknown>>) {
    if (!field) return false;
    if ([workflowFieldKey(field), ...workflowFieldLegacyKeys(field)].some((key) => Object.prototype.hasOwnProperty.call(values, key))) return true;
    const nodeKey = normalizeWorkflowParameterPart(field.nodeId);
    const fieldKeys = [field.fieldName, field.source, field.label].map((value) => normalizeWorkflowParameterPart(value)).filter(Boolean);
    if (!nodeKey || !fieldKeys.length) return false;
    return Object.keys(values).some((key) => {
        const match = key.match(/^field:([^:]+):(.+)$/i);
        return Boolean(match && normalizeWorkflowParameterPart(match[1]) === nodeKey && fieldKeys.includes(normalizeWorkflowParameterPart(match[2])));
    });
}

export function normalizeWorkflowParameterPart(value: unknown) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]/g, "");
}

export function workflowFieldLegacyKeys(field: WorkflowVideoFieldLike) {
    const keys = [field.source, field.fieldName, field.label].map((value) => normalizeWorkflowVideoFieldKey(String(value || ""))).filter(Boolean);
    if (keys.some((key) => ["aspectratio", "ratio", "imageaspectratio", "imageratio", "videoaspectratio", "videoratio"].includes(key))) {
        return ["source:aspectRatio", "source:aspect_ratio", "source:ratio"];
    }
    if (keys.some((key) => ["size", "imagesize", "imageresolution"].includes(key))) return ["source:size"];
    if (keys.some((key) => ["quality", "imagequality"].includes(key))) return ["source:quality"];
    if (keys.some((key) => ["vquality", "videoresolution", "videoquality"].includes(key))) return ["source:vquality", "source:videoResolution"];
    if (keys.some((key) => ["videoseconds", "duration", "durationseconds", "seconds"].includes(key))) return ["source:videoSeconds", "source:duration", "source:duration_seconds"];
    if (keys.some((key) => ["count", "batch", "batchsize"].includes(key))) return ["source:count", "source:batch"];
    return [] as string[];
}

export function workflowNumericFieldValues(field: WorkflowVideoFieldLike) {
    const bounds = workflowFieldNumberBounds(field);
    const min = bounds.min;
    const max = bounds.max;
    const step = bounds.step;
    if (min === undefined || max === undefined || max < min || step === undefined || step <= 0) return [] as string[];
    const count = Math.floor((max - min) / step) + 1;
    if (count <= 0 || count > 32) return [] as string[];
    return Array.from({ length: count }, (_, index) => String(Number((min + index * step).toFixed(6))));
}

export function workflowNumber(value: unknown) {
    if (value === undefined || value === null || String(value).trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function workflowDurationNumber(value: string) {
    const parsed = Number(
        String(value)
            .trim()
            .replace(/(?:s|秒)$/i, ""),
    );
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function matchWorkflowValue(value: string, options: string[]) {
    if (!value) return "";
    return options.find((option) => option.toLowerCase() === value.toLowerCase()) || options.find((option) => option.replace(/p$/i, "").toLowerCase() === value.replace(/p$/i, "").toLowerCase()) || "";
}
