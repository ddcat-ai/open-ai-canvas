import type { ModelCatalogResponse } from "@/services/api/logical-models";
import { systemChannelModelChannels } from "@/lib/user-session";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { defaultConfig, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { encodeChannelModel, modelOptionName } from "@/stores/config-model-options";

/** 阶段模型必须能读商品图；不能选时直接告诉管理员去哪里开启。 */
export const COMMERCE_VISION_DISABLED_REASON = "未开启识图：渠道管理 → 该模型 → 能力与参数 → 引用与限制，把「最多识别图片数」设为 1 以上";

/**
 * 阶段模型下拉用的模型目录：与创作端同一份公开目录和同一个通用下拉组件，
 * 持久化身份仍是渠道模型行 ID（channelModelId），不是展示名。
 */
export function commerceStageModelConfig(catalog: ModelCatalogResponse): AiConfig {
    if (catalog.source !== "system" || !Array.isArray(catalog.channels)) throw new Error("模型目录响应无效");
    return { ...defaultConfig, channels: systemChannelModelChannels(catalog.channels) };
}

/** 渠道模型行 ID → 下拉选择值（channelId::modelKey）；不在当前目录里时返回空串。 */
export function commerceStageModelValue(config: AiConfig, channelModelId?: string) {
    if (!channelModelId) return "";
    for (const channel of config.channels) {
        const cost = channel.modelCosts?.find((item) => item.channelModelId === channelModelId);
        if (cost) return encodeChannelModel(channel.id, cost.model);
    }
    return "";
}

/** 下拉选择值 → 渠道模型行 ID。 */
export function commerceStageChannelModelId(config: AiConfig, value: string) {
    if (!value) return "";
    return resolveModelChannel(config, value).modelCosts?.find((item) => item.model === modelOptionName(value))?.channelModelId || "";
}

export function commerceModelImageLimit(config: AiConfig, value: string) {
    return modelCapabilityConfigFor(config, value).text?.references.maxImages || 0;
}

export function commerceVisionDisabledReason(config: AiConfig, value: string) {
    return commerceModelImageLimit(config, value) > 0 ? "" : COMMERCE_VISION_DISABLED_REASON;
}

/** 目录里的文本模型总数与其中能读图的数量，用于告诉管理员当前还差什么。 */
export function commerceStageModelCounts(config: AiConfig) {
    const text = selectableModelsByCapability(config, "text");
    return { text: text.length, vision: text.filter((value) => commerceModelImageLimit(config, value) > 0).length };
}
