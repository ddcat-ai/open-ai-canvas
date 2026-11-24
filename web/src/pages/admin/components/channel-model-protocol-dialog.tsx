import { useRef, useState } from "react";
import { Alert, App } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { Select } from "@/components/ui/base/select";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { getActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import { updateAdminAllChannelModelsProtocolGroups, updateAdminChannelModelsProtocolGroups, type ChannelModel } from "@/services/api/wallet";
import { assertBatchModelSelectionCurrent } from "./channel-model-batch-edit";
import { channelModelProtocolGroups, channelModelProtocolGroupUpdates, type ProtocolGroupSelection } from "./channel-model-protocol-groups";

/** 按原能力分组选择协议，能力配置与价格档由后端按新协议校验。
 * 不传 channelId 时为跨渠道切换，所选模型可来自不同系统渠道。 */
export function ChannelModelProtocolDialog({
    channelId,
    items,
    currentItems,
    contextKey,
    protocols,
    protocolLoading,
    protocolError,
    onClose,
    onSaved,
}: {
    channelId?: string;
    items: ChannelModel[];
    currentItems: ChannelModel[];
    contextKey: string;
    protocols: ModelProtocolDefinition[];
    protocolLoading: boolean;
    protocolError: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const [scope] = useState(getActiveUserScope);
    const [openedContext] = useState(contextKey);
    const groups = channelModelProtocolGroups(items);
    const unconfiguredCount = items.length - groups.reduce((count, group) => count + group.items.length, 0);
    const [selection, setSelection] = useState<ProtocolGroupSelection>({});
    const [saving, setSaving] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const saveLock = useRef(false);
    const callbacks = useRef({ onSaved, onClose });
    callbacks.current = { onSaved, onClose };
    const prepare = () => {
        if (scope === "guest" || userId !== scope || getActiveUserScope() !== scope || useUserStore.getState().user?.id !== scope) throw new Error("账号已切换，请重新打开协议设置");
        if (contextKey !== openedContext) throw new Error("当前 Key 或筛选已变化，请重新打开协议设置");
        if (protocolLoading) throw new Error("正在读取协议，请稍候");
        if (protocolError) throw new Error(protocolError);
        const updates = channelModelProtocolGroupUpdates(items, selection, protocols);
        const ids = new Set(updates.flatMap((group) => group.modelIds));
        const changed = items.filter((item) => ids.has(item.id));
        assertBatchModelSelectionCurrent(changed, currentItems);
        if (channelId && changed.some((item) => item.channelId !== channelId)) throw new Error("当前 Key 已变化，请重新选择模型");
        return updates;
    };
    let error = "",
        changedCount = 0;
    try {
        changedCount = prepare().reduce((count, group) => count + group.modelIds.length, 0);
    } catch (cause) {
        error = cause instanceof Error ? cause.message : "请检查协议选择";
    }

    const save = async () => {
        if (saveLock.current) return;
        let updates;
        try {
            updates = prepare();
            if (!updates.length) return;
        } catch (cause) {
            setSubmitError(cause instanceof Error ? cause.message : "请检查协议选择");
            return;
        }
        saveLock.current = true;
        setSaving(true);
        setSubmitError("");
        let updated = 0;
        try {
            const result = channelId ? await updateAdminChannelModelsProtocolGroups(channelId, updates) : await updateAdminAllChannelModelsProtocolGroups(updates);
            updated = result.updated;
        } catch (cause) {
            setSubmitError(cause instanceof Error ? cause.message : "批量修改协议失败");
            saveLock.current = false;
            setSaving(false);
            return;
        }
        try {
            if (useUserStore.getState().user?.id === scope && getActiveUserScope() === scope) await callbacks.current.onSaved();
            message.success(`已修改 ${updated} 个模型的调用协议`);
        } catch {
            message.warning("已保存，刷新失败，请手动刷新列表");
        } finally {
            // 成功后保持锁定；即使刷新失败，也不能重发已完成的写入。
            callbacks.current.onClose();
        }
    };

    return (
        <AdminModal
            title={`修改调用协议 · ${items.length} 个模型`}
            open
            centered
            width={600}
            onCancel={() => {
                if (!saveLock.current) onClose();
            }}
            closable={!saving}
            mask={{ closable: !saving }}
            keyboard={!saving}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
            okButtonProps={{ disabled: !changedCount || Boolean(error) }}
            okText="保存"
            cancelText="取消"
            onOk={() => void save()}
        >
            <div className="space-y-4">
                <p className="text-sm text-foreground/60">各类型分别选择，未选择的类型不修改。</p>
                {groups.map((group) => (
                    <div key={group.capability} className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-3">
                        <span>
                            {group.label} <span className="text-xs text-foreground/50">{group.items.length} 个</span>
                        </span>
                        <Select
                            ariaLabel={`${group.label}调用协议`}
                            className="w-full"
                            placeholder="不修改"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            value={selection[group.capability]}
                            loading={protocolLoading}
                            disabled={saving || protocolLoading || Boolean(protocolError)}
                            options={protocols.filter((protocol) => protocol.capability === group.capability && protocol.enabled !== false).map((protocol) => ({ value: protocol.value, label: `${protocol.label} · ${protocol.value}` }))}
                            onChange={(protocol) => {
                                setSelection((current) => ({ ...current, [group.capability]: protocol }));
                                setSubmitError("");
                            }}
                        />
                    </div>
                ))}
                {unconfiguredCount > 0 ? <Alert type="warning" showIcon title={`${unconfiguredCount} 个模型未配置能力，请先单独设置类型；其他组仍可修改。`} /> : null}
                <p className="text-xs text-foreground/60">按新协议核对能力参数与价格档，不兼容时整批不保存。</p>
                {error || submitError ? <Alert type="error" showIcon title={error || submitError} /> : null}
            </div>
        </AdminModal>
    );
}
