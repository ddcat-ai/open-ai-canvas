import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";
import type { BatchChannelModelChanges, BatchChannelModelUpdate, ChannelModel } from "@/services/api/wallet";
import { initialChannelModelValues, updateChannelModelUpstreamCapabilities, validateChannelModelPrices, validateChannelModelProtocol } from "./channel-model-editor-form";
import { priceTierAmountsComplete, priceTierPayloadFromForm } from "./channel-model-price-tier-form";
import { applyCapabilityTemplate } from "./channel-model-templates";
import { protocolCapabilityLabels } from "./channel-model-protocol-groups";
import { capabilitySnapshot, templateCapabilityForModel, type SavedCapabilityTemplate } from "./saved-capability-templates";
import { templatePricingForModel, type SavedPricingTemplate } from "./saved-pricing-templates";

export type BatchCapabilityTemplate = { builtin: string } | { saved: SavedCapabilityTemplate };
export type BatchModelGroupKey = ProtocolCapability | "unset";
export type BatchModelGroupDraft = Pick<BatchChannelModelChanges, "capability" | "protocol"> & {
    capabilityTemplate?: BatchCapabilityTemplate;
    pricingTemplate?: SavedPricingTemplate;
};
export type ChannelModelBatchDraft = Omit<BatchChannelModelChanges, "capabilityTemplate" | "pricingTemplate"> &
    BatchModelGroupDraft & {
        groups?: Partial<Record<BatchModelGroupKey, BatchModelGroupDraft>>;
    };

export function batchModelGroups(items: ChannelModel[]) {
    return [...Object.entries(protocolCapabilityLabels), ["unset", "未设置类型"]]
        .map(([key, label]) => ({
            key: key as BatchModelGroupKey,
            label,
            items: items.filter((item) => (item.capability || "unset") === key),
        }))
        .filter((group) => group.items.length);
}

/** 停用和元信息更新不依赖调用协议；调用配置和启用路径必须校验。 */
export function batchDraftRequiresProtocol(draft: ChannelModelBatchDraft): boolean {
    return (
        draft.enabled === true ||
        draft.pricingEnabled === true ||
        draft.capability !== undefined ||
        draft.protocol !== undefined ||
        Boolean(draft.capabilityTemplate || draft.pricingTemplate) ||
        Object.values(draft.groups || {}).some((group) => group && batchDraftRequiresProtocol(group))
    );
}

export function assertBatchModelSelectionCurrent(items: ChannelModel[], current: ChannelModel[]) {
    const latest = new Map(current.map((item) => [item.id, item]));
    for (const item of items) {
        const model = latest.get(item.id);
        if (!model || model.channelId !== item.channelId || model.priceVersion !== item.priceVersion || (model.capabilityVersion ?? 0) !== (item.capabilityVersion ?? 0) || model.updatedAt !== item.updatedAt) {
            throw new Error("所选模型已变化，请刷新后重新打开批量修改");
        }
    }
}

/** 先合成最终能力、价格和开关，再校验；只把已选择的字段交给服务端。 */
export function batchChannelModelUpdates(items: ChannelModel[], draft: ChannelModelBatchDraft, protocols: ModelProtocolDefinition[]): BatchChannelModelUpdate[] {
    if (!items.length || items.length > 100) throw new Error("请选择 1–100 个模型");
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("所选模型存在重复项，请重新选择");
    if (draft.description !== undefined && [...draft.description].length > 500) throw new Error("备注最多 500 字");
    const { groups, ...common } = draft;
    const updates = items.flatMap((item) => {
        try {
            const selected = { ...common, ...groups?.[item.capability || "unset"] };
            if (!Object.values(selected).some((value) => value !== undefined)) return [];
            const changes: BatchChannelModelChanges = {};
            if (selected.displayName !== undefined) changes.displayName = selected.displayName.trim();
            if (selected.description !== undefined) changes.description = selected.description.trim();
            if (selected.enabled !== undefined) changes.enabled = selected.enabled;
            if (selected.pricingEnabled !== undefined) changes.pricingEnabled = selected.pricingEnabled;
            const update = () => ({ modelId: item.id, priceVersion: item.priceVersion, capabilityVersion: item.capabilityVersion ?? 0, updatedAt: item.updatedAt, changes });
            if (!batchDraftRequiresProtocol(selected)) return [update()];

            const capability = selected.capability ?? item.capability;
            if (!capability || !Object.hasOwn(protocolCapabilityLabels, capability)) throw new Error("请选择模型类型");
            if (item.capability && item.capability !== capability) throw new Error("已有模型类型不能跨类型修改");
            if (selected.capability !== undefined) changes.capability = capability;
            if (selected.protocol !== undefined) changes.protocol = selected.protocol;
            // 新模型必须显式选择类型和协议，不能继承单模型表单的文本默认值。
            let values = initialChannelModelValues(item.capability ? item : { ...item, capability, protocol: selected.protocol || "", capabilityConfig: undefined }, protocols);
            if (selected.protocol !== undefined) values = updateChannelModelUpstreamCapabilities({ ...values, protocol: selected.protocol }, protocols);
            if (!item.priceTiers?.length && item.priceConfigured === false) {
                // 旧模型只有顶层价格；其可用性取决于价格配置，不能继承模型启停。
                const amount = (value: number | null) => (value === 0 ? null : value);
                values = {
                    ...values,
                    priceTiers: values.priceTiers.map((tier) => ({
                        ...tier,
                        enabled: false,
                        unitPrice: amount(tier.unitPrice),
                        inputTokenPrice: amount(tier.inputTokenPrice),
                        outputTokenPrice: amount(tier.outputTokenPrice),
                        cachedTokenPrice: amount(tier.cachedTokenPrice),
                        cacheWriteTokenPrice: amount(tier.cacheWriteTokenPrice),
                        referenceVideoUnitPrice: amount(tier.referenceVideoUnitPrice),
                        referenceVideoOutputTokenPrice: amount(tier.referenceVideoOutputTokenPrice),
                    })),
                };
            }
            if (selected.capabilityTemplate) {
                const selection = selected.capabilityTemplate;
                const snapshot = "saved" in selection ? templateCapabilityForModel(selection.saved, values) : capabilitySnapshot(applyCapabilityTemplate(selection.builtin, values));
                values = { ...values, ...snapshot };
                changes.capabilityTemplate = { capabilityConfig: snapshot.capabilityConfig! };
            }
            if (selected.pricingTemplate) values = { ...values, ...templatePricingForModel(selected.pricingTemplate, values) };
            if (selected.pricingEnabled !== undefined) {
                // 必须在更改标志前核对原值，不能让未配置的 0 在开启时变成免费。
                if (selected.pricingEnabled) {
                    const incomplete = values.priceTiers.findIndex((tier) => !priceTierAmountsComplete(values.capability, tier, values.referenceVideoBilling));
                    if (incomplete >= 0) throw new Error(`价格档 ${incomplete + 1} 金额尚未填写完整，请先编辑或应用积分模板`);
                }
                values = { ...values, priceTiers: values.priceTiers.map((tier) => ({ ...tier, enabled: selected.pricingEnabled! })) };
            }
            validateChannelModelProtocol(values.capability, values.protocol, protocols);
            validateChannelModelPrices({ ...values, protocols });
            if (selected.pricingTemplate) {
                changes.pricingTemplate = {
                    priceCurrency: values.priceCurrency,
                    referenceVideoBilling: values.referenceVideoBilling,
                    // 空上游型号沿用各自模型；不能把源模板 SKU 复制到目标模型。
                    priceTiers: values.priceTiers.map((tier) => priceTierPayloadFromForm(values.capability, tier, "", values.capabilityConfig)),
                };
            }
            return [update()];
        } catch (error) {
            throw new Error(`${item.modelKey}：${error instanceof Error ? error.message : "配置无效"}`);
        }
    });
    if (!updates.length) throw new Error("请勾选或选择要修改的项目");
    return updates;
}
