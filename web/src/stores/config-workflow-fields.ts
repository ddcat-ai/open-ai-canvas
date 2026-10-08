// RunningHub 工作流字段映射的规范化与合并，兼容历史配置里的字段来源写法。

import { workflowFieldRole, workflowFieldSafeToOverride, workflowVideoFieldsFromJson } from "@/lib/model-capabilities";
import type { RunningHubCapability, RunningHubWorkflowKind } from "./use-config-store";

export type WorkflowFieldMapping = {
    id?: string;
    nodeId: string;
    classType?: string;
    fieldName: string;
    fieldValue?: unknown;
    value?: unknown;
    default?: unknown;
    defaultValue?: unknown;
    fieldType?: string;
    label?: string;
    role?: string;
    safeToOverride?: boolean;
    optionsSource?: "workflow" | "manual" | "preset";
    options?: unknown[];
    min?: unknown;
    max?: unknown;
    step?: unknown;
    enabled?: boolean;
    source?: string;
    sourceIndex?: number;
    imageOrder?: number;
    required?: boolean;
    randomEnabled?: boolean;
    bindPrompt?: boolean;
    sourceFromUpstream?: boolean;
    sourceAutomatic?: boolean;
};

export function normalizeRunningHubCapability(value: unknown, fallback: RunningHubCapability = "image"): RunningHubCapability {
    return value === "image" || value === "video" || value === "audio" ? value : fallback;
}

export function normalizeRunningHubWorkflowKind(value: unknown): RunningHubWorkflowKind {
    return value === "app" ? "app" : "workflow";
}

export function normalizeWorkflowFieldSourceName(value: unknown, capability?: RunningHubCapability) {
    const source = String(value || "").trim();
    const normalized = source.toLowerCase().replace(/[\s_-]/g, "");
    const aliases: Record<string, string> = {
        text: "prompt",
        positive: "prompt",
        positiveprompt: "prompt",
        image: "referenceImage",
        referenceimage: "referenceImage",
        referenceimages: "referenceImage",
        video: "referenceVideo",
        referencevideo: "referenceVideo",
        referencevideos: "referenceVideo",
        audio: "referenceAudio",
        referenceaudio: "referenceAudio",
        referenceaudios: "referenceAudio",
        sizewidth: "width",
        imagewidth: "width",
        videowidth: "width",
        sizeheight: "height",
        imageheight: "height",
        videoheight: "height",
        ratio: "aspectRatio",
        aspectratio: "aspectRatio",
        imageaspectratio: "aspectRatio",
        imageratio: "aspectRatio",
        videoaspectratio: "aspectRatio",
        videoratio: "aspectRatio",
        videoresolution: "vquality",
        batch: "count",
        batchsize: "count",
        duration: "videoSeconds",
        videoseconds: "videoSeconds",
        videoquality: "vquality",
        generateaudio: "videoGenerateAudio",
        videogenerateaudio: "videoGenerateAudio",
        watermark: "videoWatermark",
        videowatermark: "videoWatermark",
        voice: "audioVoice",
        systemprompt: "systemPrompt",
        transparentbackground: "transparentBackground",
        audiovoice: "audioVoice",
        audioformat: "audioFormat",
        audiospeed: "audioSpeed",
        audioinstructions: "audioInstructions",
        audiolanguage: "audioLanguage",
        audiodialect: "audioDialect",
    };
    if (normalized === "resolution") return capability === "video" ? "vquality" : "size";
    // 工作流的 quality 可能是连续数值（例如 0.1-3），不能按视频分辨率处理。
    if (normalized === "quality") return "quality";
    return aliases[normalized] || source;
}

export const workflowDimensionPrefixes = ["", "image", "video", "size", "output", "target", "latent", "frame", "canvas", "source", "resolution", "final"];

export function workflowDimensionSource(key: string) {
    if (workflowDimensionPrefixes.some((prefix) => key === `${prefix}width`) || key === "pixelwidth" || key === "widthpixels") return "width";
    if (workflowDimensionPrefixes.some((prefix) => key === `${prefix}height`) || key === "pixelheight" || key === "heightpixels") return "height";
    return "";
}

export function inferWorkflowFieldSource(fieldName: string, fieldType: string, capability?: RunningHubCapability) {
    const key = fieldName.toLowerCase().replace(/[\s_-]/g, "");
    const normalizedFieldType = fieldType.trim().toLowerCase();
    if (["text", "prompt", "positive", "positiveprompt"].includes(key)) return "prompt";
    if (key.includes("mask")) return "mask";
    const dimensionSource = workflowDimensionSource(key);
    if (dimensionSource) return dimensionSource;
    if (["ratio", "aspectratio", "imageaspectratio", "imageratio", "videoaspectratio", "videoratio"].includes(key)) return "aspectRatio";
    if (["videoresolution", "videoquality", "vquality"].includes(key)) return "vquality";
    if (["size", "imagesize", "imageresolution"].includes(key)) return "size";
    if (key === "resolution") return capability === "video" ? "vquality" : capability === "image" ? "size" : "";
    if (["batch", "batchsize", "count", "numimages", "numberofimages", "imagecount", "imagescount"].includes(key)) return "count";
    if (key === "quality") return "quality";
    if (["duration", "seconds", "durationseconds", "videoseconds", "videoduration", "videodurationseconds", "videolength", "clipduration"].includes(key)) return "videoSeconds";
    if (["generateaudio", "videogenerateaudio"].includes(key)) return "videoGenerateAudio";
    if (["watermark", "videowatermark"].includes(key)) return "videoWatermark";
    if (key === "audioformat" || (key === "format" && normalizedFieldType === "audio")) return "audioFormat";
    if (["voice", "audiovoice"].includes(key)) return "audioVoice";
    if ((key === "speed" && normalizedFieldType === "audio") || key === "audiospeed") return "audioSpeed";
    if ((key === "instructions" && normalizedFieldType === "audio") || key === "audioinstructions") return "audioInstructions";
    if (key === "audiolanguage" || (key === "language" && normalizedFieldType === "audio")) return "audioLanguage";
    if (key === "audiodialect" || (key === "dialect" && normalizedFieldType === "audio")) return "audioDialect";
    if (["transparentbackground", "transparent"].includes(key)) return "transparentBackground";
    if (normalizedFieldType === "image") return "referenceImage";
    if (normalizedFieldType === "video") return "referenceVideo";
    if (normalizedFieldType === "audio") return "referenceAudio";
    return "";
}

export function shouldRepairLegacyWorkflowSource(fieldName: string, source: string, inferredSource: string, capability?: RunningHubCapability) {
    if (!source || !inferredSource || source === inferredSource) return false;
    const key = fieldName.toLowerCase().replace(/[\s_-]/g, "");
    const wasMistakenForMedia = ["referenceImage", "referenceVideo", "referenceAudio"].includes(source);
    if (wasMistakenForMedia && (workflowDimensionSource(key) || inferredSource === "aspectRatio" || inferredSource === "vquality")) return true;
    // 旧版把通用 resolution 固定识别为图片尺寸；视频条目必须恢复为视频清晰度。
    if (key === "resolution" && capability === "video" && source === "size") return true;
    if (key === "resolution" && capability === "image" && source === "vquality") return true;
    if (key === "quality" && source === "vquality") return true;
    return false;
}

export function normalizeWorkflowFieldMappings(value: unknown, capability?: RunningHubCapability): WorkflowFieldMapping[] {
    if (!Array.isArray(value)) return [];
    const fields = value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const raw = item as Record<string, unknown>;
        const nodeId = String(raw.nodeId || raw.node || raw.node_id || "").trim();
        const fieldName = String(raw.fieldName || raw.input || raw.inputName || raw.input_name || "").trim();
        if (!nodeId || !fieldName) return [];
        // source 明确存在但为空，表示用户要求保留工作流默认值；只有旧数据完全缺少来源字段时才自动补绑定。
        const sourceKey = ["source", "bind", "from"].find((key) => Object.prototype.hasOwnProperty.call(raw, key));
        const sourceConfigured = Boolean(sourceKey);
        const configuredSource = sourceKey ? raw[sourceKey] : raw.bindPrompt === true || raw.bind_prompt === true ? "prompt" : "";
        let source = normalizeWorkflowFieldSourceName(configuredSource, capability);
        const rawSourceAutomatic = raw.sourceAutomatic ?? raw.source_automatic;
        let sourceAutomatic = typeof rawSourceAutomatic === "boolean" ? rawSourceAutomatic : !sourceConfigured && Boolean(source);
        const upstreamAllowed = raw.sourceFromUpstream !== false && raw.source_from_upstream !== false;
        const upstreamExplicit = raw.sourceFromUpstream === true || raw.source_from_upstream === true;
        const fieldType = String(raw.fieldType || raw.type || "").trim();
        const inferredSource = inferWorkflowFieldSource(fieldName, fieldType, capability);
        if (!source && !sourceConfigured && upstreamAllowed) {
            source = inferredSource;
            sourceAutomatic = Boolean(source);
            if (!source && upstreamExplicit && ["text", "prompt", "positiveprompt", "positive"].includes(fieldName.toLowerCase().replace(/[\s_-]/g, ""))) {
                source = "prompt";
                sourceAutomatic = true;
            }
        } else if (shouldRepairLegacyWorkflowSource(fieldName, source, inferredSource, capability)) {
            source = inferredSource;
        }
        // 比例、清晰度、时长等标量必须按 nodeId + fieldName 独立配置。
        // 旧版自动来源会把两个同类字段折叠到同一个全局参数，重新归一化为直接字段值。
        if (sourceAutomatic && !["prompt", "referenceImage", "referenceVideo", "referenceAudio", "mask"].includes(source)) {
            source = "";
            sourceAutomatic = false;
        }
        const fieldValue = raw.fieldValue ?? raw.defaultValue ?? raw.default_value ?? raw.default ?? raw.value;
        const rawOptions = raw.options ?? raw.values ?? raw.choices ?? raw.enum ?? raw.fieldOptions ?? raw.field_options;
        const options = Array.isArray(rawOptions)
            ? rawOptions
            : rawOptions && typeof rawOptions === "object"
              ? ((rawOptions as Record<string, unknown>).choices ?? (rawOptions as Record<string, unknown>).options ?? (rawOptions as Record<string, unknown>).values)
              : undefined;
        const range = workflowFieldRange(rawOptions);
        const min = raw.min ?? raw.minValue ?? raw.min_value ?? range.min;
        const max = raw.max ?? raw.maxValue ?? raw.max_value ?? range.max;
        const step = raw.step ?? raw.stepValue ?? raw.step_value ?? range.step;
        const required = raw.required ?? raw.isRequired ?? raw.is_required;
        const randomEnabled = raw.randomEnabled ?? raw.random_enabled;
        const sourceIndex = Number(raw.sourceIndex ?? raw.source_index ?? raw.index);
        const imageOrder = Number(raw.imageOrder ?? raw.image_order);
        const candidate: WorkflowFieldMapping = {
            ...raw,
            nodeId,
            classType: String(raw.classType || raw.class_type || "").trim() || undefined,
            fieldName,
            id: String(raw.id || `${nodeId}::${fieldName}`),
            source,
            ...(fieldValue !== undefined ? { fieldValue } : {}),
            ...(Array.isArray(options) ? { options } : {}),
            ...(min !== undefined ? { min } : {}),
            ...(max !== undefined ? { max } : {}),
            ...(step !== undefined ? { step } : {}),
            ...(typeof required === "boolean" ? { required } : {}),
            ...(typeof randomEnabled === "boolean" ? { randomEnabled } : {}),
            sourceAutomatic,
            ...(Number.isFinite(sourceIndex) ? { sourceIndex } : {}),
            ...(Number.isFinite(imageOrder) ? { imageOrder } : {}),
        } as WorkflowFieldMapping;
        const safeToOverride = raw.safeToOverride !== false && raw.safe_to_override !== false && workflowFieldSafeToOverride(candidate);
        const role = workflowFieldRole({ ...candidate, role: String(raw.role || "") });
        const configuredEnabled = typeof raw.enabled === "boolean" ? raw.enabled : role !== "internal";
        const optionsSource = ["workflow", "manual", "preset"].includes(String(raw.optionsSource || raw.options_source || ""))
            ? (String(raw.optionsSource || raw.options_source) as WorkflowFieldMapping["optionsSource"])
            : Array.isArray(options)
              ? "workflow"
              : undefined;
        return [{ ...candidate, role, safeToOverride, enabled: safeToOverride && configuredEnabled, ...(optionsSource ? { optionsSource } : {}) }];
    });
    let imageOrder = 0;
    let videoOrder = 0;
    let audioOrder = 0;
    return fields.map((field) => {
        if (field.source === "referenceImage") {
            const configuredOrder = Number(field.imageOrder);
            const nextOrder = Number.isInteger(configuredOrder) && configuredOrder > 0 ? configuredOrder : imageOrder + 1;
            imageOrder = Math.max(imageOrder, nextOrder);
            return { ...field, imageOrder: nextOrder, sourceIndex: nextOrder - 1, required: field.required ?? nextOrder === 1 };
        }
        if (field.source === "referenceVideo") {
            const configuredIndex = Number(field.sourceIndex);
            const nextIndex = Number.isInteger(configuredIndex) && configuredIndex >= 0 ? configuredIndex : videoOrder;
            videoOrder = Math.max(videoOrder, nextIndex + 1);
            return { ...field, sourceIndex: nextIndex, required: field.required ?? nextIndex === 0 };
        }
        if (field.source === "referenceAudio") {
            const configuredIndex = Number(field.sourceIndex);
            const nextIndex = Number.isInteger(configuredIndex) && configuredIndex >= 0 ? configuredIndex : audioOrder;
            audioOrder = Math.max(audioOrder, nextIndex + 1);
            return { ...field, sourceIndex: nextIndex, required: field.required ?? nextIndex === 0 };
        }
        if (field.source === "prompt") return { ...field, required: field.required ?? true };
        return field;
    });
}

export function mergeWorkflowFieldMappings(current: unknown, incoming: unknown, capability?: RunningHubCapability) {
    const previousFields = normalizeWorkflowFieldMappings(current, capability);
    const nextFields = normalizeWorkflowFieldMappings(incoming, capability);
    const previousByKey = new Map(previousFields.map((field) => [`${field.nodeId}::${field.fieldName}`, field]));
    const policyKeys: Array<keyof WorkflowFieldMapping> = ["label", "enabled", "randomEnabled", "source", "sourceAutomatic", "sourceFromUpstream", "sourceIndex", "imageOrder", "required", "bindPrompt"];
    return nextFields.map((field) => {
        const previous = previousByKey.get(`${field.nodeId}::${field.fieldName}`);
        if (!previous) return field;
        const merged = { ...field } as WorkflowFieldMapping;
        const target = merged as unknown as Record<string, unknown>;
        const source = previous as unknown as Record<string, unknown>;
        policyKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
        });
        // 字段类型、枚举和数值范围属于上游协议。只有本次拉取未返回时，才沿用本地补充配置。
        if (!field.fieldType && previous.fieldType) merged.fieldType = previous.fieldType;
        if (!field.options?.length && previous.options?.length) {
            merged.options = previous.options;
            merged.optionsSource = previous.optionsSource;
        }
        if (field.min === undefined && previous.min !== undefined) merged.min = previous.min;
        if (field.max === undefined && previous.max !== undefined) merged.max = previous.max;
        if (field.step === undefined && previous.step !== undefined) merged.step = previous.step;
        // 首次获得角色信息时采用服务端的内部参数默认值；之后才保留用户明确的启用选择。
        if (field.role === "internal" && previous.role !== "internal") merged.enabled = field.enabled;
        if (field.safeToOverride === false) merged.enabled = false;
        return merged;
    });
}

export function normalizeSavedWorkflowFields(workflow: { fields?: unknown; workflowJson?: Record<string, unknown> }, capability: RunningHubCapability) {
    const schemaFields = workflowVideoFieldsFromJson(workflow.workflowJson);
    return schemaFields.length ? mergeWorkflowFieldMappings(workflow.fields, schemaFields, capability) : normalizeWorkflowFieldMappings(workflow.fields, capability);
}

export function workflowFieldRange(value: unknown) {
    const candidates: Record<string, unknown>[] = [];
    const add = (item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return;
        const record = item as Record<string, unknown>;
        candidates.push(record);
        add(record.range);
    };
    add(value);
    if (Array.isArray(value)) value.forEach(add);
    const read = (keys: string[]) => candidates.map((item) => keys.map((key) => item[key]).find((candidate) => candidate !== undefined)).find((candidate) => candidate !== undefined);
    return { min: read(["min", "minValue", "min_value"]), max: read(["max", "maxValue", "max_value"]), step: read(["step", "stepValue", "step_value"]) };
}
