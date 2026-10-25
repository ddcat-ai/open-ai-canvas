import { compatibleModelInGroup, configuredModelDisplayName, groupModelsByDisplayName, isDirectSystemModel, modelCompatibilityError, type DisplayModelGroup, type ModelRequirements } from "@/lib/model-selection";
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

export function compatibleModelForPickerGroup(config: AiConfig, group: ModelPickerGroup, requirements?: ModelRequirements, current = "") {
    const selectedModelGroup = group.models.find((item) => item.models.includes(current));
    const candidates = selectedModelGroup ? [selectedModelGroup, ...group.models.filter((item) => item !== selectedModelGroup)] : group.models;
    return candidates.map((item) => compatibleModelInGroup(config, item.models, requirements, item.models[0])).find(Boolean) || "";
}

export function modelPickerGroupCompatibilityError(config: AiConfig, group: ModelPickerGroup, requirements?: ModelRequirements) {
    return group.models.flatMap((item) => item.models).map((model) => modelCompatibilityError(config, model, requirements)).find(Boolean) || "当前输入没有可用模型";
}

export function modelChannelLabel(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    // 系统渠道名称属于平台内部信息，永不回退显示；手动分组的模型使用配置展示名。
    if (channel.scope === "system") return cost?.channelLabel?.trim() || (cost?.displayGroup ? configuredModelDisplayName(config, value) : modelOptionName(value));
    return cost?.channelLabel?.trim() || (cost?.displayGroup ? modelOptionName(value) : channel.name) || "未命名模型";
}

export function modelDisplayGroup(config: AiConfig, value: string) {
    if (!isDirectSystemModel(config, value)) return undefined;
    return resolveModelChannel(config, value).modelCosts?.find((item) => item.model === modelOptionName(value))?.displayGroup;
}

// 一级按已设置的模型展示名跨渠道聚合，空值归入未分类；二级保留独立调用与售价。
export function groupModelsForPicker(config: AiConfig, options: string[]): ModelPickerGroup[] {
    const groups = new Map<string, ModelPickerGroup>();
    for (const channel of config.channels) {
        const models = options.filter((value) => resolveModelChannel(config, value).id === channel.id);
        const directModels = models.filter((value) => isDirectSystemModel(config, value));
        for (const value of directModels) {
            const metadata = modelDisplayGroup(config, value);
            const label = metadata?.name || configuredModelDisplayName(config, value);
            const key = metadata ? JSON.stringify(["display-group", metadata.id]) : JSON.stringify(["product", label]);
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
    const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    for (const group of result) {
        if (!modelDisplayGroup(config, group.models[0]?.models[0])) continue;
        group.models.sort((a, b) => {
            const first = modelDisplayGroup(config, a.models[0])!;
            const second = modelDisplayGroup(config, b.models[0])!;
            return first.memberOrder - second.memberOrder || compare(a.key, b.key);
        });
        group.icon = modelIcon(config, group.models[0].models[0]);
    }
    // Metadata order is independent of channel iteration; legacy and personal lists stay stable.
    return result.sort((a, b) => {
        const first = modelDisplayGroup(config, a.models[0].models[0]);
        const second = modelDisplayGroup(config, b.models[0].models[0]);
        if (first && second) return first.order - second.order || compare(a.key, b.key);
        return first ? -1 : second ? 1 : 0;
    });
}
