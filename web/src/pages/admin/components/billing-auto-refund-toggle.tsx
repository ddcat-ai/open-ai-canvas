import { useEffect, useState } from "react";
import { App } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";

import { Switch } from "@/components/ui/base/switch";
import { getAdminBillingAutoRefund, updateAdminBillingAutoRefund } from "@/services/api/wallet";

/**
 * 积分运营页右上角的“自动退回”开关。默认关闭；开启后后台定时把待核对队列中
 * 冻结的预授权积分退回用户。开启前二次确认，因为部分订单可能已在上游产生费用。
 */
export function BillingAutoRefundToggle() {
    const { message } = App.useApp();
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    useEffect(() => {
        let active = true;
        void getAdminBillingAutoRefund()
            .then(({ setting }) => {
                if (active) setEnabled(setting.enabled);
            })
            .catch((error) => {
                if (active) message.error(error instanceof Error ? error.message : "读取自动退回设置失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [message]);

    const save = async (next: boolean) => {
        setSaving(true);
        try {
            const { setting } = await updateAdminBillingAutoRefund(next);
            setEnabled(setting.enabled);
            setConfirmOpen(false);
            message.success(setting.enabled ? "已开启自动退回，待核对订单的冻结积分将自动退回" : "已关闭自动退回");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存自动退回设置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <label className="inline-flex h-8 items-center gap-2 rounded-[var(--r-md)] px-2 text-[var(--fs-body)]" title="开启后，待核对队列中的冻结积分会自动退回用户">
                <span>自动退回</span>
                <Switch
                    size="sm"
                    aria-label="冻结积分自动退回"
                    checked={enabled}
                    loading={loading || (saving && !confirmOpen)}
                    disabled={loading || saving}
                    onChange={(checked) => {
                        if (checked) setConfirmOpen(true);
                        else void save(false);
                    }}
                />
            </label>
            <AdminModal
                title="开启冻结积分自动退回"
                open={confirmOpen}
                okText="确认开启"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                confirmLoading={saving}
                closable={!saving}
                mask={{ closable: !saving }}
                onCancel={() => {
                    if (!saving) setConfirmOpen(false);
                }}
                onOk={() => void save(true)}
                destroyOnHidden
            >
                <p className="admin-operation-confirmation-copy">开启后，系统每分钟会把“待核对队列”中的订单（费用待核对、运行超时、任务已失败或取消但仍冻结）自动退回预授权积分，不再等待人工核对。</p>
                <p className="admin-operation-confirmation-copy">这些订单中可能有已在上游产生费用的请求，自动退回后平台将承担这部分成本。退回会写入积分流水，可随时关闭。</p>
            </AdminModal>
        </>
    );
}
