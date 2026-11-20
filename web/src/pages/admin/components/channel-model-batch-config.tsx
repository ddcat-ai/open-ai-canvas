import { Select } from "@/components/ui/base/select";
import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";
import type { ChannelModel } from "@/services/api/wallet";
import { batchModelGroups, type BatchModelGroupKey } from "./channel-model-batch-edit";
import { protocolCapabilityLabels } from "./channel-model-protocol-groups";
import { capabilityTemplateReason, capabilityTemplates } from "./channel-model-templates";
import type { SavedCapabilityTemplate } from "./saved-capability-templates";
import type { SavedPricingTemplate } from "./saved-pricing-templates";

export type BatchGroupSelection = {
    capability?: ProtocolCapability;
    protocol?: string;
    capabilityId?: string;
    pricingId?: string;
};

type Props = {
    items: ChannelModel[];
    selection: Partial<Record<BatchModelGroupKey, BatchGroupSelection>>;
    protocols: ModelProtocolDefinition[];
    capabilityTemplates: SavedCapabilityTemplate[];
    pricingTemplates: SavedPricingTemplate[];
    capabilityError: string;
    pricingError: string;
    saving: boolean;
    protocolLoading: boolean;
    protocolError: string;
    onChange: (key: BatchModelGroupKey, value: BatchGroupSelection) => void;
};

export function ChannelModelBatchConfig({ items, selection, protocols, capabilityTemplates: savedCapabilities, pricingTemplates, capabilityError, pricingError, saving, protocolLoading, protocolError, onChange }: Props) {
    return (
        <div className="space-y-4">
            {batchModelGroups(items).map((group) => {
                const value = selection[group.key] || {};
                const capability = group.key === "unset" ? value.capability : group.key;
                const availableProtocols = protocols.filter((item) => item.capability === capability && item.enabled !== false);
                const options = [
                    ...savedCapabilities.filter((item) => item.capability === capability).map((item) => ({ value: `saved:${item.id}`, label: item.name })),
                    ...(capability === "image"
                        ? capabilityTemplates.map((template) => ({
                              value: `builtin:${template.id}`,
                              label: `${template.name}（内置）`,
                              disabled: Boolean(capabilityTemplateReason(template.id, { capability })),
                          }))
                        : []),
                ];
                return (
                    <section key={group.key} aria-label={`${group.label}模型配置`} className="space-y-2">
                        <div className="flex items-center gap-3 text-sm font-medium">
                            <span>
                                {group.label}
                                <span className="ml-2 text-xs font-normal text-foreground/50">{group.items.length} 个</span>
                            </span>
                            {group.key === "unset" ? (
                                <Select
                                    ariaLabel="未设置类型的模型类型"
                                    className="w-36"
                                    size="small"
                                    placeholder="选择类型"
                                    value={value.capability}
                                    allowClear
                                    disabled={saving}
                                    options={Object.entries(protocolCapabilityLabels).map(([key, label]) => ({ value: key, label }))}
                                    onChange={(next: ProtocolCapability | undefined) => onChange(group.key, { capability: next })}
                                />
                            ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <label className="min-w-0 space-y-1 text-xs text-foreground/60">
                                <span>调用协议</span>
                                <Select
                                    ariaLabel={`${group.label}调用协议`}
                                    className="w-full"
                                    placeholder="不修改"
                                    value={value.protocol}
                                    allowClear
                                    showSearch={{ optionFilterProp: "label" }}
                                    disabled={saving || !capability || protocolLoading || Boolean(protocolError)}
                                    options={availableProtocols.map((item) => ({ value: item.value, label: availableProtocols.some((other) => other.value !== item.value && other.label === item.label) ? `${item.label} · ${item.value}` : item.label }))}
                                    onChange={(protocol: string | undefined) => onChange(group.key, { ...value, protocol })}
                                />
                            </label>
                            <label className="min-w-0 space-y-1 text-xs text-foreground/60">
                                <span>能力模板</span>
                                <Select
                                    ariaLabel={`${group.label}能力模板`}
                                    className="w-full"
                                    placeholder={capability === "audio" ? "暂无模板" : "不修改"}
                                    value={value.capabilityId}
                                    allowClear
                                    showSearch={{ optionFilterProp: "label" }}
                                    disabled={saving || !capability || capability === "audio" || Boolean(capabilityError)}
                                    options={options}
                                    onChange={(capabilityId: string | undefined) => onChange(group.key, { ...value, capabilityId })}
                                />
                            </label>
                            <label className="min-w-0 space-y-1 text-xs text-foreground/60">
                                <span>积分模板</span>
                                <Select
                                    ariaLabel={`${group.label}积分模板`}
                                    className="w-full"
                                    placeholder="不修改"
                                    value={value.pricingId}
                                    allowClear
                                    showSearch={{ optionFilterProp: "label" }}
                                    disabled={saving || !capability || Boolean(pricingError)}
                                    options={pricingTemplates.filter((item) => item.capability === capability).map((item) => ({ value: item.id, label: item.name }))}
                                    onChange={(pricingId: string | undefined) => onChange(group.key, { ...value, pricingId })}
                                />
                            </label>
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
