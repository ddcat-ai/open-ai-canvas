import { groupModelsByDisplayName, isDirectSystemModel, type DisplayModelGroup } from "@/lib/model-selection";
import { compareDisplayMembers, displayGroupComparator } from "./model-display-order";
import { modelIcon, modelOptionName, PUBLIC_MODEL_CATALOG_ID, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ModelPickerGroup = {
    key: string;
    label: string;
    icon: string;
    scope: string;
    kind: "product" | "channel";
    models: DisplayModelGroup[];
};

export { isDirectSystemModel } from "@/lib/model-selection";

export function modelChannelLabel(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (channel.scope === "system") return cost?.channelLabel?.trim() || modelOptionName(value);
    return cost?.channelLabel?.trim() || channel.name || "未命名渠道";
}

function modelSortOrder(config: AiConfig, value: string | undefined) {
    if (!value) return 0;
    const cost = resolveModelChannel(config, value).modelCosts?.find((item) => item.model === modelOptionName(value));
    return cost?.sortOrder ?? 0;
}

// 一级按已设置的模型展示名跨渠道聚合，空值归入未分类；二级保留独立调用与售价。
export function groupModelsForPicker(config: AiConfig, options: string[]): ModelPickerGroup[] {
    const groups = new Map<string, ModelPickerGroup>();
    for (const channel of config.channels) {
        const models = options.filter((value) => resolveModelChannel(config, value).id === channel.id);
        const directModels = models.filter((value) => isDirectSystemModel(config, value));
        for (const value of directModels) {
            const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
            const label = cost?.displayName?.trim() || "未分类";
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
                label: channel.scope === "system" ? "系统模型" : channel.name || "未命名渠道",
                icon: modelIcon(config, otherModels[0]),
                scope: channel.id === PUBLIC_MODEL_CATALOG_ID ? "" : "我的模型",
                kind: "channel",
                models: groupModelsByDisplayName(config, otherModels),
            });
        }
    }
    const result = Array.from(groups.values());
    const idFor = (value: string) => resolveModelChannel(config, value).modelCosts?.find((item) => item.model === modelOptionName(value))?.channelModelId ?? value;
    for (const group of result) {
        if (group.kind !== "product") continue;
        group.models.sort((left, right) => compareDisplayMembers(modelSortOrder(config, left.models[0]), modelSortOrder(config, right.models[0]), idFor(left.models[0]), idFor(right.models[0])));
    }
    const order = config.displayGroupOrder ?? [];
    {
        const compareGroups = displayGroupComparator(order);
        const index = new Map(order.map((name, position) => [name, position]));
        result.sort((left, right) => {
            const leftIndex = index.get(left.label);
            const rightIndex = index.get(right.label);
            if (leftIndex === undefined && rightIndex === undefined) {
                if (left.kind === right.kind) return left.kind === "product" ? compareGroups(left.label, right.label) : 0;
                return left.kind === "product" ? -1 : 1;
            }
            if (leftIndex === undefined) return 1;
            if (rightIndex === undefined) return -1;
            return leftIndex - rightIndex;
        });
    }
    return result;
}
