import { getActiveUserScope, scopedStorageKey } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { imageParameterAccepts } from "@/lib/image-parameters";
import type { ChannelModelFormValues } from "./channel-model-editor-form";

export type CapabilitySnapshot = Pick<ChannelModelFormValues, "capabilityConfig">;
export type SavedCapabilityTemplate = { id: string; revision: string; name: string; capability: "text" | "image" | "video"; config: CapabilitySnapshot };
export const CAPABILITY_TEMPLATES_CHANGED = "yingce:capability-templates-changed";
export const capabilityTemplatesKey = (scope: string) => scopedStorageKey("yingce:capability-templates", scope);
const MAX_STORAGE = 256_000;

type Shape = "string" | "number" | "boolean" | "value" | readonly [Shape] | { [key: string]: Shape };
const strings: Shape = ["string"];
const choice: Shape = { supported: "boolean", values: strings, default: "string" };
const toggle: Shape = { supported: "boolean", default: "boolean" };
const levels: Shape = { off: "string", minimal: "string", low: "string", medium: "string", high: "string", max: "string" };
const screen: Record<string, Shape> = { ratios: strings, defaultRatio: "string", resolutions: strings, defaultResolution: "string" };
// 只保存能力表单字段，模板不能携带模型身份、价格或连接凭据。
const shapes: Record<SavedCapabilityTemplate["capability"], Shape> = {
    text: {
        streaming: "boolean",
        contextWindowTokens: "number",
        maxOutputTokens: "number",
        references: { promptMaxChars: "number", maxImages: "number", maxImageBytes: "number", maxVideos: "number", maxVideoBytes: "number" },
        thinking: {
            preset: "string",
            mode: "string",
            levels: strings,
            default: "string",
            switch: { kind: "string", onValue: "string" },
            intensity: { kind: "string", field: "string", values: levels, budgets: { off: "number", minimal: "number", low: "number", medium: "number", high: "number", max: "number" } },
        },
    },
    image: {
        references: { promptMaxChars: "number", maxImages: "number", maxImageBytes: "number", maskSupported: "boolean" },
        size: { parameter: "string", values: strings, default: "string", allowCustom: "boolean", presets: [{ size: "string", tier: "string", ratio: "string", width: "number", height: "number" }], defaultTier: "string", defaultRatio: "string" },
        resolution: choice,
        quality: choice,
        resolutionUsesQuality: "boolean",
        transparentBackground: toggle,
        responseFormat: { supported: "boolean", default: "string" },
        outputFormat: { supported: "boolean" },
        maxOutputs: "number",
        parameters: [
            {
                name: "string",
                label: "string",
                type: "string",
                description: "string",
                values: ["value"],
                min: "number",
                max: "number",
                step: "number",
                maxLength: "number",
                default: "value",
                required: "boolean",
                pricing: "boolean",
                binding: "string",
                encoding: "string",
                models: strings,
                enabled: "boolean",
            },
        ],
    },
    video: {
        references: {
            promptMaxChars: "number",
            minImages: "number",
            maxImages: "number",
            maxImageBytes: "number",
            maxVideos: "number",
            maxVideoBytes: "number",
            maxVideoDurationSeconds: "number",
            maxAudios: "number",
            maxAudioBytes: "number",
            maxAudioDurationSeconds: "number",
        },
        duration: { selection: "string", min: "number", max: "number", step: "number", values: ["number"], default: "number" },
        durationSupported: "boolean",
        ...screen,
        fixedScreenSpec: screen,
        generateAudio: toggle,
        watermark: toggle,
        operations: strings,
        defaultOperation: "string",
        processing: { fpsPolicy: "string", fpsOptions: ["number"], maxSourceSeconds: "number" },
    },
};

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("能力模板格式无效");
    return value as Record<string, unknown>;
}

function copy(value: unknown, shape: Shape): unknown {
    if (value === undefined || value === null) return undefined;
    if (typeof shape === "string") {
        if (shape === "value" ? !["string", "number", "boolean"].includes(typeof value) : typeof value !== shape) throw new Error("能力模板字段类型无效");
        if (typeof value === "number" && !Number.isFinite(value)) throw new Error("能力参数须为有效数值");
        if (typeof value === "string" && value.length > 4096) throw new Error("能力参数过长");
        return value;
    }
    if (Array.isArray(shape)) {
        if (!Array.isArray(value) || value.length > 512) throw new Error("能力模板列表无效");
        return value.map((item) => copy(item, shape[0]));
    }
    const source = record(value);
    return Object.fromEntries(
        Object.entries(shape)
            .filter(([key]) => source[key] != null)
            .map(([key, child]) => [key, copy(source[key], child)]),
    );
}

export function capabilitySnapshot(values: Pick<ChannelModelFormValues, "capability" | "capabilityConfig">): CapabilitySnapshot {
    if (!["text", "image", "video"].includes(values.capability)) throw new Error("请选择文本、图片或视频能力类型");
    const capability = values.capability as SavedCapabilityTemplate["capability"];
    const source = record(values.capabilityConfig);
    const branch = record(copy(source[capability], shapes[capability]));
    const references = record(branch.references);
    if (!Object.keys(references).length || Object.values(references).some((value) => typeof value === "number" && value < 0)) throw new Error("引用限制无效");
    const config = normalizeModelCapabilityConfig({ version: 1, [capability]: branch } as ModelCapabilityConfig);
    if (source.mediaTransport != null) {
        const transport = copy(source.mediaTransport, { image: "string", video: "string", audio: "string" }) as NonNullable<ModelCapabilityConfig["mediaTransport"]>;
        if (Object.values(transport).some((value) => !["inherit", "protocol", "url", "base64"].includes(value))) throw new Error("素材发送方式无效");
        config.mediaTransport = transport;
    }
    for (const field of config.image?.parameters || []) {
        if (!field.name || !field.label || !["string", "number", "integer", "boolean"].includes(field.type)) throw new Error("图片参数定义无效");
        if (field.enabled !== false && field.default !== undefined && !imageParameterAccepts(field, field.default)) throw new Error(`${field.label}的默认值不在支持范围内`);
    }
    return { capabilityConfig: config };
}

export function assertCapabilityTemplateScope(scope: string) {
    if (scope === "guest" || useUserStore.getState().user?.id !== scope || getActiveUserScope() !== scope) throw new Error("账号已切换，请重新打开能力模板");
}

export function readCapabilityTemplates(scope: string): SavedCapabilityTemplate[] {
    const raw = window.localStorage.getItem(capabilityTemplatesKey(scope));
    if (raw === null) return [];
    try {
        if (raw.length > MAX_STORAGE) throw new Error();
        const data = record(JSON.parse(raw));
        if (data.version !== 1 || !Array.isArray(data.templates) || data.templates.length > 32) throw new Error();
        const ids = new Set<string>(),
            names = new Set<string>();
        return data.templates.map((rawItem) => {
            const item = record(rawItem);
            if (
                typeof item.id !== "string" ||
                !item.id ||
                item.id.length > 128 ||
                ids.has(item.id) ||
                typeof item.revision !== "string" ||
                !item.revision ||
                item.revision.length > 128 ||
                typeof item.name !== "string" ||
                !item.name.trim() ||
                item.name.length > 48 ||
                !["text", "image", "video"].includes(String(item.capability))
            )
                throw new Error();
            const capability = item.capability as SavedCapabilityTemplate["capability"];
            const nameKey = `${capability}:${item.name.trim().toLowerCase()}`;
            if (names.has(nameKey)) throw new Error();
            ids.add(item.id);
            names.add(nameKey);
            return { id: item.id, revision: item.revision, name: item.name.trim(), capability, config: capabilitySnapshot({ ...record(item.config), capability } as ChannelModelFormValues) };
        });
    } catch {
        throw new Error("本机能力模板数据无效，原数据已保留");
    }
}

export function saveCapabilityTemplate(scope: string, name: string, values: Pick<ChannelModelFormValues, "capability" | "capabilityConfig">, previous?: Pick<SavedCapabilityTemplate, "id" | "revision">) {
    assertCapabilityTemplateScope(scope);
    name = name.trim();
    if (!name || name.length > 48) throw new Error("模板名称须为 1–48 个字符");
    const config = capabilitySnapshot(values);
    const templates = readCapabilityTemplates(scope);
    if (previous && !templates.some((item) => item.id === previous.id && item.revision === previous.revision)) throw new Error("模板已被修改，请重新编辑");
    if (!previous && templates.length >= 32) throw new Error("最多保存 32 个能力模板");
    if (templates.some((item) => item.id !== previous?.id && item.capability === values.capability && item.name.toLowerCase() === name.toLowerCase())) throw new Error("模板名称已存在");
    const template: SavedCapabilityTemplate = { id: previous?.id || crypto.randomUUID(), revision: crypto.randomUUID(), name, capability: values.capability as SavedCapabilityTemplate["capability"], config };
    const next = previous ? templates.map((item) => (item.id === previous.id ? template : item)) : [...templates, template];
    const serialized = JSON.stringify({ version: 1, templates: next });
    if (serialized.length > MAX_STORAGE) throw new Error("能力模板存储已满，请减少模板内容");
    try {
        window.localStorage.setItem(capabilityTemplatesKey(scope), serialized);
    } catch {
        throw new Error("能力模板未保存：本机存储不可用或空间不足");
    }
    window.dispatchEvent(new CustomEvent(CAPABILITY_TEMPLATES_CHANGED, { detail: scope }));
    return template;
}

export function templateCapabilityForModel(template: SavedCapabilityTemplate, values: Pick<ChannelModelFormValues, "capability">) {
    if (template.capability !== values.capability) throw new Error("模板与当前能力类型不一致");
    return capabilitySnapshot({ ...template.config, capability: values.capability });
}
