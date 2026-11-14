import { getActiveUserScope } from "@/lib/user-scope";
import type { ModelCatalogResponse, PublicChannelCatalog } from "@/services/api/logical-models";
import { decodeChannelModel, modelOptionName, type AiConfig } from "@/stores/use-config-store";

export type YingceFormEntry = { name: string; value: string } | { name: string; filename: string; mimeType: string; bytes: Uint8Array };
export type YingceRecoveryContext = {
    id: string;
    capability: "text" | "image" | "audio";
    prompt: string;
    model: string;
    createdAt: string;
    projectId?: string;
    nodeId?: string;
    sourceNodeId?: string;
    domainProjectId?: string;
    edit?: string;
    layerDecomposition?: boolean;
    textWire?: string;
    protocol?: string;
    format?: string;
    batchId?: string;
    batchIndex?: number;
    batchCount?: number;
};
export type YingceJournalRecord = { version: 1; context: YingceRecoveryContext; status: "pending" | "unknown" | "failed" | "completed"; result?: unknown } | { version: 1; context: { id: string }; status: "invalid" };
export type YingceGenerationInput = { channelId: string; providerPath: string; capability: "text" | "image" | "audio"; recovery?: YingceRecoveryContext } & (
    { body: Record<string, unknown>; multipart?: never } | { body?: never; multipart: YingceFormEntry[] }
);

export async function serializeYingceImageForm(form: FormData): Promise<YingceFormEntry[]> {
    return Promise.all(Array.from(form.entries(), async ([name, value]) => (typeof value === "string" ? { name, value } : { name, filename: value.name, mimeType: value.type, bytes: new Uint8Array(await value.arrayBuffer()) })));
}
type IpcReply = { ok: true; data: unknown } | { ok: false; error: { message: string; status?: number; code?: number; reason?: string; outcomeUnknown?: boolean } };
type IpcRequest = (method: string, input?: unknown) => Promise<IpcReply>;

export class YingceLiteError extends Error {
    readonly status?: number;
    readonly code?: number;
    readonly reason?: string;
    readonly outcomeUnknown?: boolean;

    constructor(message: string, details: { status?: number; code?: number; reason?: string; outcomeUnknown?: boolean } = {}) {
        super(message);
        this.name = "YingceLiteError";
        this.status = details.status;
        this.code = details.code;
        this.reason = details.reason;
        this.outcomeUnknown = details.outcomeUnknown;
    }
}

function desktopRequest(): IpcRequest {
    const desktop = (window as Window & { desktop?: { yingceRequest?: IpcRequest } }).desktop;
    if (!desktop?.yingceRequest) throw new Error("影策桌面服务不可用，请重新启动客户端");
    return desktop.yingceRequest;
}

/** Bind acknowledgement to the main-process account that supplied the records. */
export async function readYingceGenerationJournal(options: { request?: IpcRequest; getScope?: () => string } = {}) {
    const scope = (options.getScope || getActiveUserScope)();
    if (!scope || scope === "guest") throw new Error("请先登录后查看生成记录");
    const reply = await (options.request || desktopRequest())("generationJournal");
    if (scope !== (options.getScope || getActiveUserScope)()) throw new YingceLiteError("账号已切换，无法读取之前的生成记录。", { reason: "auth_superseded" });
    if (!reply.ok) throw new YingceLiteError(reply.error.message, reply.error);
    const value = reply.data as { owner?: unknown; records?: unknown } | null;
    if (!value || typeof value.owner !== "string" || !/^[a-f0-9]{64}$/.test(value.owner) || !Array.isArray(value.records)) throw new Error("本地生成恢复记录响应无效");
    return { owner: value.owner, records: value.records as YingceJournalRecord[], scope };
}

export async function acknowledgeYingceGeneration(owner: string, id: string, options: { request?: IpcRequest; getScope?: () => string; expectedScope?: string } = {}) {
    if (options.expectedScope && options.expectedScope !== (options.getScope || getActiveUserScope)()) throw new YingceLiteError("账号已切换，无法确认之前的生成记录。", { reason: "auth_superseded" });
    const reply = await (options.request || desktopRequest())("acknowledgeGeneration", { owner, id });
    if (!reply.ok) throw new YingceLiteError(reply.error.message, reply.error);
}

/** Resolve an exact catalog selection; the normal resolver may fall back to another channel. */
export function resolveYingceSystemModel(config: AiConfig, capability: "text" | "image" | "audio" | "video") {
    const selection = decodeChannelModel(config.model);
    const modelKey = modelOptionName(config.model);
    const matches = selection ? config.channels.filter((channel) => channel.id === selection.channelId) : config.channels.filter((channel) => channel.models.includes(modelKey));
    if (matches.length !== 1) throw new Error("模型渠道无法确定，请重新选择模型");
    const channel = matches[0];
    if (channel.scope !== "system" || !channel.yingceChannelId || channel.enabled === false || !channel.models.includes(modelKey)) throw new Error("当前影策模型不可用，请重新选择模型");
    const models = channel.modelCosts?.filter((model) => model.model === modelKey && model.capability === capability && model.available !== false) || [];
    if (models.length !== 1) throw new Error("当前模型不支持该生成类型，请重新选择模型");
    return { channelId: channel.yingceChannelId, modelKey, model: models[0] };
}

/** Do not let a late catalog response populate a different account's workspace. */
export async function requestYingceCatalog(options: { request?: IpcRequest; getScope?: () => string } = {}): Promise<ModelCatalogResponse> {
    const getScope = options.getScope || getActiveUserScope;
    const scope = getScope();
    const reply = await (options.request || desktopRequest())("catalog");
    if (scope !== getScope()) throw new YingceLiteError("账号已切换，无法接收之前的模型目录。", { reason: "auth_superseded" });
    if (!reply.ok) throw new YingceLiteError(reply.error.message, reply.error);
    const data = reply.data as ModelCatalogResponse | null;
    if (!data || (data.source !== undefined && data.source !== "system") || !Array.isArray(data.channels) || !data.channels.every(isCatalogChannel)) throw new Error("影策模型目录响应无效");
    return {
        ...data,
        source: "system",
        channels: data.channels.map((channel) => ({
            ...channel,
            displayName: channel.displayName || channel.name || channel.id,
            models: channel.models.map((model) => ({ ...model, displayName: model.displayName || model.modelKey, available: model.available ?? true })),
        })),
    };
}

export async function requestYingceLegacyWorkspaceImport() {
    const desktop = (window as Window & { desktop?: { yingceRequest?: IpcRequest } }).desktop;
    if (!desktop?.yingceRequest) return { enabled: false, sourceScope: "" };
    const reply = await desktop.yingceRequest("legacyWorkspaceImport");
    if (!reply.ok) throw new YingceLiteError(reply.error.message, reply.error);
    const value = reply.data as { enabled?: unknown; sourceScope?: unknown } | null;
    if (!value || typeof value.enabled !== "boolean" || (value.enabled && (typeof value.sourceScope !== "string" || !value.sourceScope))) {
        throw new Error("旧版本地资料导入状态无效");
    }
    return { enabled: value.enabled, sourceScope: value.enabled ? (value.sourceScope as string) : "" };
}

function isCatalogChannel(value: PublicChannelCatalog) {
    return (
        !!value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        !!value.id &&
        Array.isArray(value.models) &&
        value.models.every((model) => model && typeof model.modelKey === "string" && !!model.modelKey && typeof model.capability === "string" && (model.available === undefined || typeof model.available === "boolean"))
    );
}

/** A dispatched IPC is one intent. Never silently replace it or retry it. */
export async function requestYingceGeneration(input: YingceGenerationInput, options: { signal?: AbortSignal; request?: IpcRequest; getScope?: () => string; retainForOriginalScope?: boolean } = {}) {
    if (options.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    const getScope = options.getScope || getActiveUserScope;
    const scope = getScope();
    const request = options.request || desktopRequest();
    let reply: IpcReply;
    try {
        reply = await request("generate", input);
    } catch {
        throw new YingceLiteError("连接中断，生成状态未知。请核对结果后再手动发起新请求。", { reason: "outcome_unknown" });
    }
    if (!options.retainForOriginalScope && scope !== getScope()) throw new YingceLiteError("账号已切换，无法接收之前的生成结果。", { reason: "auth_superseded" });
    if (options.signal?.aborted) throw new YingceLiteError("请求已停止等待，生成状态可能已改变。请核对结果后再手动发起新请求。", { reason: "outcome_unknown" });
    if (!reply.ok) throw new YingceLiteError(reply.error.message, reply.error);
    return reply.data;
}
