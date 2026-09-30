// 渠道模型选项的编码、解析与展示：channelId + 模型名组合成选择值，按能力过滤可选模型。

import { type AiConfig, type ModelChannel, resolveModelChannel } from "./use-config-store";

export const CHANNEL_MODEL_SEPARATOR = "::";

export function uniqueModelOptions(models: string[]) {
    return Array.from(
        new Set(
            (models || [])
                .filter((model): model is string => typeof model === "string")
                .map((model) => model.trim())
                .filter(Boolean),
        ),
    );
}

export function normalizeRawModelName(value: unknown) {
    if (typeof value !== "string") return "";
    const model = modelOptionName(value).trim();
    return model && model !== "undefined" && model !== "null" ? model : "";
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelDisplayName(config: AiConfig, value: string) {
    const model = modelOptionName(value);
    const channel = resolveModelChannel(config, value);
    const displayName = channel.modelCosts?.find((item) => item.model === model)?.displayName?.trim();
    if (displayName) return displayName;
    return channel.scope === "system" ? "系统模型" : model;
}

export function modelIcon(config: AiConfig, value: string) {
    const model = modelOptionName(value);
    return resolveModelChannel(config, value).modelCosts?.find((item) => item.model === model)?.icon || "";
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return modelDisplayName(config, value);
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const displayName = modelDisplayName(config, value);
    // 平台前台模型只展示公开名称；供应来源和内部目录适配器不属于创作端信息。
    if (!channel || channel.scope === "system") return displayName;
    return `${displayName}（${channel.name}）`;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(
        channels.flatMap((channel) =>
            channel.models
                .map(normalizeRawModelName)
                .filter(Boolean)
                .filter((model) => channel.scope !== "system" || hasSystemModelPrice(channel, model))
                .map((model) => encodeChannelModel(channel.id, model)),
        ),
    );
}

export function hasSystemModelPrice(channel: ModelChannel, model: string) {
    if (channel.scope !== "system") return true;
    // 价格字段已由后端按“非负数”校验；0 表示免费模型，不能在目录重建时被过滤。
    const configured = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0;
    return (
        channel.modelCosts?.some((item) => {
            if (item.model !== model) return false;
            const tiers = item.logicalPriceTiers || [];
            if (tiers.length) {
                return tiers.some((tier) => (tier.billingMode === "token" ? [tier.inputTokenPriceMicrocredits, tier.outputTokenPriceMicrocredits, tier.cachedTokenPriceMicrocredits].every(configured) : configured(tier.unitPriceMicrocredits)));
            }
            if (item.billingMode === "token") {
                return [item.inputTokenPriceMicrocredits, item.outputTokenPriceMicrocredits, item.cachedTokenPriceMicrocredits].every(configured);
            }
            return configured(item.unitPriceMicrocredits);
        }) === true
    );
}

export function normalizeModelOptionValue(value: unknown, channels: ModelChannel[]) {
    const model = typeof value === "string" ? value.trim() : "";
    if (!normalizeRawModelName(model)) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        const resolved = channel?.modelAliases?.[decoded.model] || decoded.model;
        return channel && channel.models.includes(resolved) ? encodeChannelModel(channel.id, resolved) : "";
    }
    const channel = channels.find((item) => item.models.includes(model) || Boolean(item.modelAliases?.[model])) || channels[0];
    const resolved = channel?.modelAliases?.[model] || model;
    return channel && channel.models.includes(resolved) ? encodeChannelModel(channel.id, resolved) : "";
}
