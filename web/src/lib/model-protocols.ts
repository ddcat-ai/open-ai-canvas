export type ModelProtocol = string;
export type ProtocolCapability = "text" | "image" | "video" | "audio";
export type ModelProtocolWorkflow = { id: string; label: string; providerId: string; capability: ProtocolCapability; parameters: Array<{ name: string; type: string; required?: boolean; description?: string; values?: string[]; mapping?: string }>; defaults?: Record<string, string | number | boolean> };
export type ModelProtocolDefinition = { value: ModelProtocol; label: string; vendor?: string; capability: ProtocolCapability; create: string; contentType: string; poll?: string; media: string; enabled?: boolean; baseUrl?: string; workflows?: ModelProtocolWorkflow[] };

export function protocolGroups(protocols: ModelProtocolDefinition[]) {
    return (["text", "image", "video", "audio"] as ProtocolCapability[]).map((capability) => ({ label: { text: "文本", image: "图片", video: "视频", audio: "音频" }[capability], options: protocols.filter((item) => item.capability === capability && item.enabled !== false).map((item) => ({ label: `${item.label} · ${item.create.replace(/^POST /, "")}`, value: item.value })) }));
}
export function modelProtocolDefinition(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return definitions.find((item) => item.value === value); }
export function modelProtocolLabel(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return modelProtocolDefinition(value, definitions)?.label || (value ? value : "未安装协议"); }

// 协议 ID 自描述能力回退：当调用方没有传入插件协议目录(definitions)时，
// 无法用注册表查到协议，因此按后端内置协议(builtin.go)的 ID 规范推断能力。
// 优先级恒为 definitions 优先，这里仅兜底"拿不到目录"的场景，保证协议的
// 视频/图片/音频语义在模型过滤链路中不会因缺失 definitions 而静默失效。
const BUILTIN_VIDEO_PROTOCOL_IDS = new Set([
    "newapi",
    "newapi-channel-1",
    "newapi-channel-2",
    "xai-video",
    "volcengine-ark-video",
    "volcengine-jimeng-video",
    "gemini-veo",
    "novita-video",
    "minimax-video",
    "agnes-video",
    "seedance-video",
    "hailuo-video",
    "abab-video",
]);
const BUILTIN_IMAGE_PROTOCOL_IDS = new Set([
    "openai-image",
    "grok-image",
    "volcengine-ark-image",
    "volcengine-jimeng-image",
    "gemini-image",
    "seedream-image",
    "doubao-image",
    "flux-image",
    "midjourney-image",
    "ideogram-image",
    "stable-diffusion-image",
]);
const BUILTIN_AUDIO_PROTOCOL_IDS = new Set([
    "openai-audio",
    "async-audio",
    "gemini-audio",
    "minimax-audio",
    "cartesia-tts",
]);
const BUILTIN_TEXT_PROTOCOL_IDS = new Set([
    "chat-completion",
    "openai-response",
    "claude-api",
    "gemini-text",
    "gemini-chat",
    "deepseek-chat",
    "anthropic-text",
    "qwen-chat",
    "doubao-chat",
]);

// 仅供推断协议 ID 的能力归属（协议 ID 已足够自描述，无需额外后端请求）。
export function builtinProtocolCapability(value: string | undefined): ProtocolCapability | undefined {
    if (!value) return undefined;
    if (BUILTIN_VIDEO_PROTOCOL_IDS.has(value)) return "video";
    if (BUILTIN_IMAGE_PROTOCOL_IDS.has(value)) return "image";
    if (BUILTIN_AUDIO_PROTOCOL_IDS.has(value)) return "audio";
    if (BUILTIN_TEXT_PROTOCOL_IDS.has(value)) return "text";
    // 未显式列出的协议，按 ID 后缀兜底识别媒体类能力，避免误归为 text。
    const lowered = value.toLowerCase();
    if (/(^|[_-])video$/i.test(value) || lowered.includes("veo") || lowered === "newapi") return "video";
    if (/(^|[_-])image$/i.test(value) || lowered.includes("dall-e") || lowered.includes("seedream")) return "image";
    if (/(^|[_-])audio$/i.test(value) || lowered.includes("tts") || lowered.includes("speech")) return "audio";
    return undefined;
}

export function modelProtocolCapability(value: string | undefined, definitions: ModelProtocolDefinition[] = []) {
    const fromCatalog = modelProtocolDefinition(value, definitions)?.capability;
    if (fromCatalog) return fromCatalog;
    return builtinProtocolCapability(value);
}
export function modelProtocolSupportsTokenBilling(capability?: string, protocol?: string) {
    return capability === "text" || (capability === "video" && protocol === "volcengine-ark-video");
}

export function protocolForModelCatalog(_endpointTypes: string[] = []): ModelProtocol | undefined {
    // A provider catalog cannot invent a protocol ID. The channel's selected
    // plugin or an explicit model configuration must supply it.
    return undefined;
}
export function modelProtocolSummary(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { const protocol = modelProtocolDefinition(value, definitions); return protocol ? [protocol.create, protocol.contentType, protocol.poll, protocol.media].filter(Boolean).join(" · ") : "当前协议未安装或尚未选择。"; }
export function normalizeModelProtocol(value: unknown): ModelProtocol | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
