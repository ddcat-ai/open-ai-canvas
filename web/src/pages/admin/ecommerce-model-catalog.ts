import type { ModelCatalogResponse } from "@/services/api/logical-models";
import { systemChannelModelChannels } from "@/lib/user-session";
import { defaultConfig, selectableModelsByCapability } from "@/stores/use-config-store";
import { decodeChannelModel } from "@/stores/config-model-options";

export type CommerceModelOption = { value: string; label: string; disabled: boolean };

// Use the same public projection and capability filter as the creation picker.
// The channel-model row ID remains the persisted identity, not its display name.
export function commercePlanningModelOptions(catalog: ModelCatalogResponse, requiresVision = true): CommerceModelOption[] {
    if (catalog.source !== "system" || !Array.isArray(catalog.channels)) throw new Error("模型目录响应无效");
    const channels = systemChannelModelChannels(catalog.channels);
    const options = selectableModelsByCapability({ ...defaultConfig, channels }, "text");
    const result: CommerceModelOption[] = [];
    for (const option of options) {
        const parsed = decodeChannelModel(option);
        const channel = catalog.channels.find((item) => item.id === parsed?.channelId);
        const model = channel?.models.find((item) => item.modelKey === parsed?.model);
        if (!channel || !model) continue;
        const max = model.capabilityConfig?.text?.references?.maxImages;
        const vision = typeof max === "number" ? (max > 0 ? `图片 ≤${max} 张` : "未配置图片输入") : "图片能力未知";
        result.push({
            value: `channel:${model.id}`,
            label: `${model.displayName && model.displayName !== model.modelKey ? `${model.displayName} · ` : ""}${model.modelKey} · ${channel.displayName || channel.name} · ${vision}`,
            disabled: requiresVision && (typeof max !== "number" || max < 1),
        });
    }
    for (const group of catalog.models || []) {
        if (group.capability !== "text" || !group.available) continue;
        const max = group.capabilitySpec?.inputs?.image?.max;
        const vision = typeof max === "number" ? (max > 0 ? `图片 ≤${max} 张` : "未配置图片输入") : "图片能力未知";
        result.push({ value: `logical:${group.id}`, label: `${group.name} · ${group.code} · ${vision}`, disabled: requiresVision && (typeof max !== "number" || max < 1) });
    }
    return result;
}
