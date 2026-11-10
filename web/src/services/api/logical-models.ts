import { http } from "@/services/api/request";
import type { ModelTag } from "@/lib/model-tags";
import type { ImageResolutionOption } from "@/lib/image-resolution-tiers";
import type { TokenPriceRule } from "@/services/api/wallet";

export type InputConstraint = { min: number; max: number };
export type OptionConstraint = { values?: unknown[]; min?: number; max?: number; step?: number };
export type CapabilityImageSizePreset = ImageResolutionOption;
export type CapabilityImageSize = {
    defaultTier?: string;
    parameter?: "size" | "aspect_ratio";
    allowCustom?: boolean;
    presets?: CapabilityImageSizePreset[];
};
export type CapabilitySpec = {
    imageParameters?: import("@/lib/image-parameters").ImageParameter[];
    version: 1;
    capability: "text" | "image" | "video" | "audio";
    operations?: string[];
    inputs?: Record<string, InputConstraint>;
    options?: Record<string, OptionConstraint>;
    imageSize?: CapabilityImageSize;
};

export type ModelRequestIntent = {
    capability: CapabilitySpec["capability"];
    operation?: string;
    inputs?: Record<string, number>;
    options?: Record<string, unknown>;
    /** 仅报价：按顺序给出参考视频时长（毫秒），长度必须等于 inputs.video；真实任务由后端实测。 */
    referenceVideoDurationsMs?: number[];
};

export type PublicLogicalModel = {
    id: string;
    code: string;
    name: string;
    icon?: string;
    description: string;
    capability: CapabilitySpec["capability"];
    sortOrder: number;
    pricePolicy: "channel" | "unified";
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    inputPriceMicrocredits: number;
    outputPriceMicrocredits: number;
    cachedPriceMicrocredits: number;
    cacheWritePriceMicrocredits?: number;
    priceTiers: PublicLogicalModelPriceTier[];
    legacyModelIds: string[];
    capabilitySpec: CapabilitySpec;
    capabilityProfiles: CapabilitySpec[];
    defaultOptions: Record<string, unknown>;
    available: boolean;
};

export type PublicLogicalModelPriceTier = {
    selector: Record<string, string>;
    resolution: string;
    videoSeconds: number;
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
    cacheWriteTokenPriceMicrocredits?: number;
    /** 仅系统渠道直连的文本 Token 档：启用中的分时与上下文规则，单价已换算为当前分组实扣积分。 */
    tokenPriceRules?: TokenPriceRule[];
    referenceVideoUnitPriceMicrocredits?: number;
    referenceVideoOutputTokenPriceMicrocredits?: number;
};

export type AdminLogicalRoute = {
    id: string;
    channelModelId: string;
    channelId: string;
    channelModelKey: string;
    channelModelName: string;
    enabled: boolean;
    priority: number;
    weight: number;
    available: boolean;
    capabilitySpec: CapabilitySpec;
};

export type AdminLogicalModel = PublicLogicalModel & {
    enabled: boolean;
    activeRevisionId: string;
    revisionVersion: number;
    configurationError?: string;
    availabilityError?: string;
    routes: AdminLogicalRoute[];
};

/**
 * Keep admin model responses usable when a server is upgraded before its
 * existing process or historical response shape has caught up with the
 * current contract. Collection fields must always be arrays for the page.
 */
export function normalizeAdminLogicalModel(model: AdminLogicalModel): AdminLogicalModel {
    return {
        ...model,
        priceTiers: Array.isArray(model.priceTiers) ? model.priceTiers : [],
        legacyModelIds: Array.isArray(model.legacyModelIds) ? model.legacyModelIds : [],
        capabilityProfiles: Array.isArray(model.capabilityProfiles) ? model.capabilityProfiles : [],
        defaultOptions: model.defaultOptions && typeof model.defaultOptions === "object" ? model.defaultOptions : {},
        routes: Array.isArray(model.routes) ? model.routes : [],
    };
}

export type LogicalModelMutation = {
    code: string;
    name: string;
    icon: string;
    description: string;
    capability: CapabilitySpec["capability"];
    enabled: boolean;
    sortOrder: number;
    pricePolicy: PublicLogicalModel["pricePolicy"];
    billingMode: PublicLogicalModel["billingMode"];
    unitPriceMicrocredits: number;
    inputPriceMicrocredits: number;
    outputPriceMicrocredits: number;
    cachedPriceMicrocredits: number;
    cacheWritePriceMicrocredits?: number;
    legacyModelIds?: string[];
    capabilitySpec: CapabilitySpec;
    defaultOptions: Record<string, unknown>;
    routes: Array<{ channelModelId: string; enabled: boolean; priority: number; weight: number }>;
};

export type RouteSimulationResult = {
    productMatch: { matched: boolean; reasons?: string[] };
    candidates: Array<{ routeId: string; channelModelId: string; channelModelKey: string; channelModelName: string; priority: number; weight: number; enabled: boolean; matched: boolean; blocked: boolean; inPool: boolean; reasons?: string[] }>;
};

export type LogicalModelQuote = {
    logicalModelId: string;
    billingMode: PublicLogicalModel["billingMode"];
    quantity: number;
    amountMicrocredits: number;
    estimated: boolean;
    videoTokenEstimate?: {
        formulaTokens: number;
        reservedTokens: number;
        outputWidth: number;
        outputHeight: number;
        framesPerSecond: number;
        outputSeconds: number;
        referenceSeconds: number;
        referenceDurationEstimated: boolean;
        dimensionsEstimated: boolean;
        reservationMarginPercent: number;
    };
    /** 仅视频请求挂参考视频时返回的报价构成。 */
    referenceVideo?: {
        count: number;
        /** true：参考视频按带参考视频价格另计费；false：参考视频不计费。 */
        billed: boolean;
        generatedSeconds: number;
        referenceSeconds: number;
        /** 按秒计费时计入数量的参考视频秒数（向上取整）；Token 计费为 0。 */
        billedSeconds: number;
        estimated: boolean;
    };
};

export type ModelQuoteRequest = {
    logicalModelID?: string;
    channelId?: string;
    modelKey?: string;
    intent: ModelRequestIntent;
};

export type ModelCatalogSource = "system";

export type PublicChannelCatalog = {
    id: string;
    name: string;
    displayName: string;
    sortOrder?: number;
    models: PublicChannelModel[];
};

export type PublicChannelModel = {
    id: string;
    modelKey: string;
    displayName: string;
    channelLabel?: string;
    tags?: ModelTag[];
    description?: string;
    sortOrder?: number;
    icon: string;
    capability: string;
    protocol?: string;
    /** 文本模型协议按插件 create 路径识别出的请求格式；插件自定义接口时缺省。 */
    textWire?: string;
    capabilityConfig?: Record<string, any>;
    priceTiers: PublicChannelModelPriceTier[];
    pricingMode: string;
    displayPrice?: number;
    priceLabel: string;
    available: boolean;
    availability?: PublicChannelModelAvailability;
    /** 仅视频模型：挂参考视频的请求是否按带参考视频价格另计费。 */
    referenceVideoBilling?: boolean;
};

export type PublicChannelModelAvailability = {
    rate24h: number | null;
    sampleCount24h: number;
    trend7d: PublicChannelModelAvailabilityDay[];
    recentResults?: boolean[];
    dataState: "ready" | "insufficient" | "no_data";
    computedAt: string;
    dataThrough?: string;
};

export type PublicChannelModelAvailabilityDay = {
    day: string;
    rate: number | null;
    sampleCount: number;
    dataState: "ready" | "insufficient" | "no_data";
};

export type PublicChannelModelPriceTier = {
    id: string;
    selector?: Record<string, string>;
    resolution: string;
    videoSeconds: number;
    billingMode: string;
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
    cacheWriteTokenPriceMicrocredits?: number;
    tokenPriceRules?: TokenPriceRule[];
    /** 模型开启参考视频计费时发布的带参考视频价格（已按分组换算）。 */
    referenceVideoUnitPriceMicrocredits?: number;
    referenceVideoOutputTokenPriceMicrocredits?: number;
};

export type ModelCatalogResponse = {
    source: ModelCatalogSource;
    models?: PublicLogicalModel[];
    channels?: PublicChannelCatalog[];
};

// 创作目录直接读取系统渠道模型，不使用逻辑模型及其功能开关。
export function getModelCatalog() {
    return http.get<ModelCatalogResponse>("/model-catalog");
}

export function quoteLogicalModel(id: string, intent: ModelRequestIntent, signal?: AbortSignal) {
    return http.post<{ quote: LogicalModelQuote }>(`/models/${encodeURIComponent(id)}/quote`, intent, { signal });
}

export function quoteModel(request: ModelQuoteRequest, signal?: AbortSignal) {
    if (request.logicalModelID) return quoteLogicalModel(request.logicalModelID, request.intent, signal);
    if (!request.channelId || !request.modelKey) return Promise.reject(new Error("请选择需要报价的系统模型"));
    return http.post<{ quote: LogicalModelQuote }>("/model-catalog/quote", { channelId: request.channelId, modelKey: request.modelKey, intent: request.intent }, { signal });
}

export function listAdminLogicalModels() {
    return http.get<{ models?: AdminLogicalModel[] }>("/admin/logical-models").then((result) => ({
        models: Array.isArray(result?.models) ? result.models.filter(Boolean).map(normalizeAdminLogicalModel) : [],
    }));
}

export function createAdminLogicalModel(input: LogicalModelMutation) {
    return http.post<{ model: AdminLogicalModel }>("/admin/logical-models", input);
}

export function updateAdminLogicalModel(id: string, input: LogicalModelMutation) {
    return http.patch<{ model: AdminLogicalModel }>(`/admin/logical-models/${encodeURIComponent(id)}`, input);
}

export function deleteAdminLogicalModel(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/logical-models/${encodeURIComponent(id)}`);
}

export function simulateAdminLogicalModel(id: string, intent: ModelRequestIntent) {
    return http.post<RouteSimulationResult>(`/admin/logical-models/${encodeURIComponent(id)}/simulate`, intent);
}
