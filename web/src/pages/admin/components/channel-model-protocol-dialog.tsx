import { useState } from "react";
import { Alert, App } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { ModelProtocolBrowser } from "@/components/model-protocol-browser";
import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";
import { updateAdminAllChannelModelsProtocol, updateAdminChannelModelsProtocol, type ChannelModel } from "@/services/api/wallet";

/** 批量切换所选模型的调用协议；协议只能在同一能力内切换，能力配置与价格档由后端按新协议校验。
 * 不传 channelId 时为跨渠道切换，所选模型可来自不同系统渠道。 */
export function ChannelModelProtocolDialog({
    channelId,
    items,
    protocols,
    protocolLoading,
    protocolError,
    onClose,
    onSaved,
}: {
    channelId?: string;
    items: ChannelModel[];
    protocols: ModelProtocolDefinition[];
    protocolLoading: boolean;
    protocolError: string;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const { message } = App.useApp();
    const capabilities = Array.from(new Set(items.map((item) => item.capability)));
    const capability = capabilities.length === 1 && capabilities[0] ? (capabilities[0] as ProtocolCapability) : undefined;
    const [protocol, setProtocol] = useState<string | undefined>(() => {
        const current = Array.from(new Set(items.map((item) => item.protocol)));
        return current.length === 1 ? current[0] : undefined;
    });
    const [saving, setSaving] = useState(false);
    const unchanged = items.every((item) => item.protocol === protocol);

    const save = async () => {
        if (!protocol || !capability || unchanged || saving) return;
        setSaving(true);
        try {
            const ids = items.map((item) => item.id);
            const result = channelId ? await updateAdminChannelModelsProtocol(channelId, ids, protocol) : await updateAdminAllChannelModelsProtocol(ids, protocol);
            message.success(`已修改 ${result.updated} 个模型的调用协议`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "批量修改协议失败");
            setSaving(false);
            return;
        }
        try {
            await onSaved();
        } catch {
            message.warning("协议已保存，但列表刷新失败，请手动刷新");
        } finally {
            setSaving(false);
            onClose();
        }
    };

    return (
        <AdminModal
            title={`修改调用协议 · ${items.length} 个模型`}
            open
            centered
            width={760}
            onCancel={onClose}
            closable={!saving}
            mask={{ closable: !saving }}
            keyboard={!saving}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
            okButtonProps={{ disabled: !capability || !protocol || unchanged || protocolLoading || Boolean(protocolError) }}
            okText="保存协议"
            onOk={() => void save()}
        >
            {capability ? (
                <div className="flex flex-col gap-3">
                    <ModelProtocolBrowser capability={capability} protocols={protocols} loading={protocolLoading} error={protocolError} disabled={saving} value={protocol} onChange={setProtocol} />
                    <Alert
                        type="info"
                        showIcon
                        title="能力参数和价格档保留原值，不会重置为新协议的默认值；只按新协议的参数范围校验，超出范围或价格档规格不匹配时整批不修改，需单独编辑该模型。图片协议会去掉新协议不支持的参数，并按新协议补齐它新增的参数。建议修改后逐个测试模型。"
                    />
                </div>
            ) : (
                <Alert type="warning" showIcon title="所选模型的能力不一致（或尚未配置能力），协议只能在同一能力内切换。请按能力筛选后再批量修改。" />
            )}
        </AdminModal>
    );
}
