export type ModelProtocol = string;
export type ProtocolCapability = "text" | "image" | "video" | "audio";
export type ModelProtocolParameter = { name: string; type: string; required?: boolean; description?: string; values?: string[]; mapping?: string };
export type ModelProtocolWorkflow = { id: string; label: string; providerId: string; capability: ProtocolCapability; parameters: ModelProtocolParameter[]; defaults?: Record<string, string | number | boolean> };
/** 后端按插件 create 路径识别的文本请求格式；识别不出（插件自定义接口）时缺省。 */
export type TextWire = "chat-completion" | "responses" | "claude-api";
export type ModelProtocolDefinition = {
    value: ModelProtocol;
    label: string;
    vendor?: string;
    capability: ProtocolCapability;
    create: string;
    contentType: string;
    poll?: string;
    media: string;
    enabled?: boolean;
    baseUrl?: string;
    parameters?: ModelProtocolParameter[];
    imageParameters?: import("./image-parameters").ImageParameter[];
    workflows?: ModelProtocolWorkflow[];
    textWire?: TextWire;
    /** 插件 auth 声明了第二把密钥（Secret Key），渠道必须同时填写。 */
    requiresSecretKey?: boolean;
};

export function isTextWire(value: unknown): value is TextWire {
    return value === "chat-completion" || value === "responses" || value === "claude-api";
}

export function protocolGroups(protocols: ModelProtocolDefinition[]) {
    return (["text", "image", "video", "audio"] as ProtocolCapability[]).map((capability) => ({ label: { text: "文本", image: "图片", video: "视频", audio: "音频" }[capability], options: protocols.filter((item) => item.capability === capability && item.enabled !== false).map((item) => ({ label: `${item.label} · ${item.create.replace(/^POST /, "")}`, value: item.value })) }));
}
export function modelProtocolDefinition(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return definitions.find((item) => item.value === value); }
export function modelProtocolLabel(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return modelProtocolDefinition(value, definitions)?.label || (value ? value : "未安装协议"); }
export function modelProtocolCapability(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { return modelProtocolDefinition(value, definitions)?.capability; }
export function isVolcengineArkImageProtocol(protocol?: string) {
    return protocol === "volcengine-ark-image" || protocol === "volcengine-ark-agent-plan-image";
}

export function isVolcengineArkVideoProtocol(protocol?: string) {
    return protocol === "volcengine-ark-video" || protocol === "volcengine-ark-agent-plan-video";
}

export function modelProtocolSupportsTokenBilling(capability?: string, _protocol?: string) {
    return capability === "text" || capability === "video";
}

export function protocolForModelCatalog(_endpointTypes: string[] = []): ModelProtocol | undefined {
    // A provider catalog cannot invent a protocol ID. The channel's selected
    // plugin or an explicit model configuration must supply it.
    return undefined;
}
export function modelProtocolSummary(value: string | undefined, definitions: ModelProtocolDefinition[] = []) { const protocol = modelProtocolDefinition(value, definitions); return protocol ? [protocol.create, protocol.contentType, protocol.poll, protocol.media].filter(Boolean).join(" · ") : "当前协议未安装或尚未选择。"; }
export function normalizeModelProtocol(value: unknown): ModelProtocol | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
