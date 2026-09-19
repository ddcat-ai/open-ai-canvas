import { configuredModelDisplayName, groupModelsByDisplayName, type DisplayModelGroup } from "@/lib/model-selection";
import { modelIcon, modelOptionName, PUBLIC_MODEL_CATALOG_ID, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ModelPickerGroup = {
    key: string;
    label: string;
    icon: string;
    scope: string;
    kind: "product" | "channel";
    models: DisplayModelGroup[];
};

export function isDirectSystemModel(config: AiConfig, value: string) {
    if (!value) return false;
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    return channel.scope === "system" && channel.id !== PUBLIC_MODEL_CATALOG_ID && !cost?.logicalModelId;
}

export function modelChannelLabel(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    return cost?.channelLabel?.trim() || channel.name || "未命名渠道";
}

// 一级按模型展示名跨渠道聚合；二级保留每条渠道模型的独立选择值、能力和售价。
export function groupModelsForPicker(config: AiConfig, options: string[]): ModelPickerGroup[] {
    const groups = new Map<string, ModelPickerGroup>();
    for (const channel of config.channels) {
        const models = options.filter((value) => resolveModelChannel(config, value).id === channel.id);
        const directModels = models.filter((value) => isDirectSystemModel(config, value));
        for (const value of directModels) {
            const label = configuredModelDisplayName(config, value);
            const key = JSON.stringify(["product", label]);
            let group = groups.get(key);
            if (!group) {
                group = { key, label, icon: modelIcon(config, value), scope: "平台服务", kind: "product", models: [] };
                groups.set(key, group);
            }
            group.models.push({ key: value, label: modelChannelLabel(config, value), models: [value] });
        }
        const otherModels = models.filter((value) => !isDirectSystemModel(config, value));
        if (otherModels.length) {
            const key = JSON.stringify(["channel", channel.id]);
            groups.set(key, {
                key,
                label: channel.name || "未命名渠道",
                icon: modelIcon(config, otherModels[0]),
                scope: channel.id === PUBLIC_MODEL_CATALOG_ID ? "" : "我的模型",
                kind: "channel",
                models: groupModelsByDisplayName(config, otherModels),
            });
        }
    }
    return Array.from(groups.values());
}
