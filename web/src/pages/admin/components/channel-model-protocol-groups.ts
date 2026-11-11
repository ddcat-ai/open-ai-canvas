import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";
import type { ChannelModel, ChannelModelProtocolGroup } from "@/services/api/wallet";

export const protocolCapabilityLabels: Record<ProtocolCapability, string> = { text: "文本", image: "图片", video: "视频", audio: "音频" };
export type ProtocolGroupSelection = Partial<Record<ProtocolCapability, string>>;

export function channelModelProtocolGroups(items: ChannelModel[]) {
    return (Object.keys(protocolCapabilityLabels) as ProtocolCapability[])
        .map((capability) => ({ capability, label: protocolCapabilityLabels[capability], items: items.filter((item) => item.capability === capability) }))
        .filter((group) => group.items.length);
}

export function channelModelProtocolGroupUpdates(items: ChannelModel[], selection: ProtocolGroupSelection, protocols: ModelProtocolDefinition[]): ChannelModelProtocolGroup[] {
    const result: ChannelModelProtocolGroup[] = [];
    const ids = new Set<string>();
    for (const group of channelModelProtocolGroups(items)) {
        const protocol = selection[group.capability];
        if (!protocol) continue;
        if (!protocols.some((item) => item.value === protocol && item.capability === group.capability && item.enabled !== false)) throw new Error(`${group.label}协议已失效，请重新选择`);
        const modelIds = group.items.filter((item) => item.protocol !== protocol).map((item) => item.id);
        for (const id of modelIds) {
            if (ids.has(id)) throw new Error("所选模型重复，请重新选择");
            ids.add(id);
        }
        if (modelIds.length) result.push({ modelIds, protocol });
    }
    if (ids.size > 100) throw new Error("单次最多修改 100 个模型");
    return result;
}
