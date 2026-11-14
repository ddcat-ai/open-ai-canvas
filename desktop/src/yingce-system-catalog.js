const PROVIDER_PREFIX = "peekreel-lite:";
const MODEL_PAGE_LIMIT = 100;

function remoteProviderID(channelId) {
    if (typeof channelId !== "string" || !/^[A-Za-z0-9_-]{1,48}$/.test(channelId)) throw new Error("影策模型目录包含无效的渠道标识");
    return `${PROVIDER_PREFIX}${channelId}`;
}

function assertCatalog(catalog) {
    if (!catalog || catalog.source !== "system" || !Array.isArray(catalog.channels) || catalog.channels.length > 500) {
        throw new Error("影策模型目录响应无效");
    }
    for (const channel of catalog.channels) {
        remoteProviderID(channel?.id);
        if (!Array.isArray(channel.models) || channel.models.length > 500) throw new Error("影策模型目录响应无效");
        for (const model of channel.models) {
            if (!model || typeof model.modelKey !== "string" || !model.modelKey || model.modelKey.length > 120 ||
                typeof model.capability !== "string" || typeof model.protocol !== "string" || !Array.isArray(model.priceTiers)) {
                throw new Error("影策模型目录响应无效");
            }
        }
    }
}

function channelRequestBody(channel, localOrigin, relayKey) {
    const remoteID = channel.id;
    const enabledModels = channel.models.filter((model) => model.available && model.priceTiers?.length).map((model) => model.modelKey);
    return {
        name: `PeekReel Lite Remote ${remoteID}`,
        sortOrder: channel.sortOrder || 0,
        baseUrl: `${localOrigin}/api/ai/system/${encodeURIComponent(remoteID)}`,
        apiKey: relayKey,
        secretKey: relayKey,
        models: enabledModels,
        headers: [{ name: "X-Yingce-Lite-Relay-Key", value: relayKey }],
        useGlobalConcurrency: true,
        enabled: true,
        catalogProviderId: remoteProviderID(remoteID),
    };
}

function channelModelRequest(model) {
    const tiers = model.priceTiers.filter((tier) => tier && ["fixed_request", "per_second", "token"].includes(tier.billingMode));
    const first = tiers[0] || {};
    const priceTiers = tiers.map((tier) => ({
        costPricing: { configured: false },
        selector: tier.selector || {},
        resolution: tier.resolution || "*",
        videoSeconds: tier.videoSeconds || 0,
        providerModelKey: model.modelKey,
        billingMode: tier.billingMode,
        unitPriceMicrocredits: tier.unitPriceMicrocredits || 0,
        inputTokenPriceMicrocredits: tier.inputTokenPriceMicrocredits || 0,
        outputTokenPriceMicrocredits: tier.outputTokenPriceMicrocredits || 0,
        cachedTokenPriceMicrocredits: tier.cachedTokenPriceMicrocredits || 0,
        cacheWriteTokenPriceMicrocredits: tier.cacheWriteTokenPriceMicrocredits || 0,
        tokenPriceRulesEnabled: Array.isArray(tier.tokenPriceRules) && tier.tokenPriceRules.length > 0,
        tokenPriceRules: tier.tokenPriceRules || [],
        referenceVideoUnitPriceMicrocredits: tier.referenceVideoUnitPriceMicrocredits || 0,
        referenceVideoOutputTokenPriceMicrocredits: tier.referenceVideoOutputTokenPriceMicrocredits || 0,
        priceConfigured: true,
        enabled: true,
    }));
    return {
        modelKey: model.modelKey,
        providerModelKey: model.modelKey,
        displayName: model.displayName || model.modelKey,
        channelLabel: model.channelLabel || "",
        tags: model.tags || [],
        description: model.description || "",
        icon: model.icon || "",
        capability: model.capability,
        protocol: model.protocol,
        billingMode: first.billingMode || "fixed_request",
        unitPriceMicrocredits: first.unitPriceMicrocredits || 0,
        inputTokenPriceMicrocredits: first.inputTokenPriceMicrocredits || 0,
        outputTokenPriceMicrocredits: first.outputTokenPriceMicrocredits || 0,
        cachedTokenPriceMicrocredits: first.cachedTokenPriceMicrocredits || 0,
        cacheWriteTokenPriceMicrocredits: first.cacheWriteTokenPriceMicrocredits || 0,
        priceConfigured: priceTiers.length > 0,
        priceCurrency: "credits",
        enabled: model.available === true && priceTiers.length > 0,
        capabilityConfig: model.capabilityConfig || null,
        referenceVideoBilling: model.referenceVideoBilling === true,
        priceTiers,
    };
}

function localEcommerceOrchestration(setting, channelMap, modelMap) {
    if (!setting || typeof setting !== "object") return null;
    function modelRef(ref) {
        if (!ref || typeof ref !== "object") return {};
        if (ref.logicalModelId) throw new Error("电商远端配置使用了未镜像的逻辑模型");
        let modelID = ref.channelModelId && modelMap.get(ref.channelModelId);
        if (!modelID && ref.channelId && ref.modelKey) {
            const channelID = channelMap.get(ref.channelId);
            modelID = channelID && modelMap.get(`${ref.channelId}:${ref.modelKey}`);
        }
        if (!modelID) return {};
        return { channelModelId: modelID };
    }
    const role = (value) => ({
        model: modelRef(value?.model),
        fallback: modelRef(value?.fallback),
        ...(value?.reuse ? { reuse: value.reuse } : {}),
    });
    if (setting.version === 1 && setting.vision && setting.marketing && setting.director) {
        const mapped = {
            version: 1,
            enabled: false,
            vision: role(setting.vision),
            marketing: role(setting.marketing),
            director: role(setting.director),
        };
        if (!mapped.vision.model.channelModelId || (!mapped.marketing.model.channelModelId && mapped.director.reuse !== "marketing")) return null;
        return mapped;
    }
    const planning = modelRef(setting);
    const vision = modelRef(setting.vision || setting);
    if (!planning.channelModelId || !vision.channelModelId) return null;
    return {
        version: 1,
        enabled: false,
        vision: { model: vision, fallback: {} },
        marketing: { model: planning, fallback: {} },
        director: { model: {}, fallback: {}, reuse: "marketing" },
    };
}

async function syncYingceSystemCatalogAtBoot({ backendBaseUrl, localOrigin, localSession, relayKey, catalog, ecommerceSetting, signal, fetchImpl = fetch }) {
    assertCatalog(catalog);
    if (typeof localSession !== "string" || !localSession || typeof relayKey !== "string" || relayKey.length < 32) throw new Error("Lite 本地渠道同步凭据不可用");
    const api = async (path, { method = "GET", body } = {}) => {
        signal?.throwIfAborted();
        const response = await fetchImpl(`${backendBaseUrl}${path}`, {
            method,
            headers: {
                accept: "application/json",
                cookie: `open_ai_canvas_session=${localSession}`,
                ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: "error",
            signal,
        });
        let envelope;
        try { envelope = await response.json(); }
        catch { throw new Error("本地模型目录服务响应无效"); }
        if (!response.ok || envelope?.code !== 0) throw new Error("本地模型目录同步失败，请查看本地日志");
        return envelope.data;
    };

    const existing = [];
    for (let page = 1; ; page++) {
        const result = await api(`/api/admin/channels?page=${page}&pageSize=${MODEL_PAGE_LIMIT}`);
        if (!Array.isArray(result?.channels) || !Number.isSafeInteger(result.total)) throw new Error("本地渠道列表响应无效");
        existing.push(...result.channels);
        if (existing.length >= result.total || result.channels.length < MODEL_PAGE_LIMIT) break;
        if (page > 100) throw new Error("本地渠道数量超过同步上限");
    }

    const desired = new Set();
    const channelMap = new Map();
    const modelMap = new Map();
    for (const remote of catalog.channels) {
        signal?.throwIfAborted();
        const marker = remoteProviderID(remote.id);
        desired.add(marker);
        const body = channelRequestBody(remote, localOrigin, relayKey);
        const current = existing.find((channel) => channel.catalogProviderId === marker);
        const saved = current
            ? await api(`/api/admin/channels/${encodeURIComponent(current.id)}`, { method: "PATCH", body })
            : await api("/api/admin/channels", { method: "POST", body });
        const channel = saved?.channel;
        if (!channel?.id) throw new Error("本地模型渠道保存失败");
        channelMap.set(remote.id, channel.id);

        const local = await api(`/api/admin/channels/${encodeURIComponent(channel.id)}/models`);
        if (!Array.isArray(local?.models)) throw new Error("本地渠道模型列表响应无效");
        const byKey = new Map(local.models.map((item) => [item.modelKey, item]));
        const currentKeys = new Set();
        for (const model of remote.models) {
            const request = channelModelRequest(model);
            if (!request.enabled) continue;
            currentKeys.add(model.modelKey);
            const currentModel = byKey.get(model.modelKey);
            const path = `/api/admin/channels/${encodeURIComponent(channel.id)}/models${currentModel?.id ? `/${encodeURIComponent(currentModel.id)}` : ""}`;
            const savedModel = await api(path, { method: currentModel?.id ? "PATCH" : "POST", body: request });
            if (model.id && savedModel?.model?.id) modelMap.set(model.id, savedModel.model.id);
            modelMap.set(`${remote.id}:${model.modelKey}`, savedModel?.model?.id || currentModel?.id);
        }
        for (const currentModel of local.models) {
            if (currentKeys.has(currentModel.modelKey) || currentModel.enabled === false) continue;
            await api(`/api/admin/channels/${encodeURIComponent(channel.id)}/models/${encodeURIComponent(currentModel.id)}`, {
                method: "PATCH", body: { ...channelModelRequest(currentModel), enabled: false },
            });
        }
    }

    for (const channel of existing) {
        if (!channel.catalogProviderId?.startsWith(PROVIDER_PREFIX) || desired.has(channel.catalogProviderId) || channel.enabled === false) continue;
        await api(`/api/admin/channels/${encodeURIComponent(channel.id)}`, {
            method: "PATCH",
            body: {
                name: channel.name,
                baseUrl: channel.baseUrl,
                apiKey: relayKey,
                secretKey: relayKey,
                models: channel.models || [],
                headers: [{ name: "X-Yingce-Lite-Relay-Key", value: relayKey }],
                useGlobalConcurrency: true,
                enabled: false,
                catalogProviderId: channel.catalogProviderId,
            },
        });
    }
    const orchestration = localEcommerceOrchestration(ecommerceSetting, channelMap, modelMap);
    if (orchestration) await api("/api/ecommerce/knowledge/orchestration", { method: "PUT", body: orchestration });
    return { channels: channelMap, models: modelMap };
}

module.exports = { PROVIDER_PREFIX, remoteProviderID, channelModelRequest, localEcommerceOrchestration, syncYingceSystemCatalogAtBoot };
