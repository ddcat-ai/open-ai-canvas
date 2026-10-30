import { App, Button, Form, Input, InputNumber } from "antd";
import { useEffect, useState } from "react";

import { formatCredits } from "@/constant/credits";
import type { AdminUser } from "@/services/api/auth";
import { adjustAdminUserCredits } from "@/services/api/wallet";
import { AdminModal } from "@/pages/admin/ui/overlays";

type AdjustValues = { amount: number; note: string };

function toMicrocredits(value: number) {
    const result = Math.round(Number(value) * 1_000_000);
    if (!Number.isSafeInteger(result)) throw new Error("积分变化超出可处理范围");
    return result;
}

/**
 * 从用户列表直接调账：目标用户已确定，不再重新搜索。
 * 先填写变化量与依据，再进入核对步骤展示变化前后余额，确认后才写入；写入期间锁定关闭。
 */
export function UserCreditAdjustModal({ user, onClose, onAdjusted }: { user: AdminUser | null; onClose: () => void; onAdjusted: (patch: Pick<AdminUser, "id" | "availableMicrocredits" | "reservedMicrocredits">) => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<AdjustValues>();
    const [pending, setPending] = useState<AdjustValues | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!user) return;
        form.resetFields();
        setPending(null);
    }, [form, user]);

    const review = async () => {
        if (!user) return;
        const values = await form.validateFields();
        const amount = Number(values.amount);
        if (!amount) {
            message.error("积分变化不能为 0");
            return;
        }
        if (user.availableMicrocredits + toMicrocredits(amount) < 0) {
            message.error("扣减后可用积分不能低于 0");
            return;
        }
        setPending({ amount, note: values.note.trim() });
    };

    const apply = async () => {
        if (!user || !pending) return;
        setSaving(true);
        try {
            const result = await adjustAdminUserCredits(user.id, { amountMicrocredits: toMicrocredits(pending.amount), note: pending.note });
            onAdjusted({ id: user.id, availableMicrocredits: result.account.availableMicrocredits, reservedMicrocredits: result.account.reservedMicrocredits });
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success(`已调整，当前可用积分 ${formatCredits(result.account.availableMicrocredits)}`);
            onClose();
        } catch (error) {
            // 结果不确定时不自动重试，保留核对内容让管理员先刷新列表确认。
            message.error(error instanceof Error ? error.message : "调整积分失败，请刷新列表核对余额后再操作");
        } finally {
            setSaving(false);
        }
    };

    const negative = Boolean(pending && pending.amount < 0);

    return (
        <AdminModal
            title={user ? `调整积分 · ${user.displayName || user.username}` : "调整积分"}
            open={Boolean(user)}
            width={480}
            onCancel={() => !saving && onClose()}
            mask={{ closable: !saving }}
            closable={!saving}
            keyboard={!saving}
            footer={
                pending ? (
                    <div className="flex justify-end gap-2">
                        <Button disabled={saving} onClick={() => setPending(null)}>
                            返回修改
                        </Button>
                        <Button type="primary" danger={negative} loading={saving} onClick={() => void apply()}>
                            {negative ? "确认扣减" : "确认增加"}
                        </Button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" onClick={() => void review()}>
                            下一步：核对
                        </Button>
                    </div>
                )
            }
        >
            {user ? (
                <div className="admin-user-credit-adjust">
                    <dl className="admin-user-credit-summary">
                        <div>
                            <dt>可用积分</dt>
                            <dd>{formatCredits(user.availableMicrocredits)}</dd>
                        </div>
                        <div>
                            <dt>冻结积分</dt>
                            <dd>{formatCredits(user.reservedMicrocredits)}</dd>
                        </div>
                        {pending ? (
                            <>
                                <div>
                                    <dt>本次变化</dt>
                                    <dd className={negative ? "is-negative" : "is-positive"}>
                                        {pending.amount > 0 ? "+" : ""}
                                        {formatCredits(toMicrocredits(pending.amount))}
                                    </dd>
                                </div>
                                <div>
                                    <dt>调整后可用</dt>
                                    <dd>{formatCredits(user.availableMicrocredits + toMicrocredits(pending.amount))}</dd>
                                </div>
                            </>
                        ) : null}
                    </dl>
                    {pending ? (
                        <p className="admin-user-credit-note">依据：{pending.note}</p>
                    ) : (
                        <Form form={form} layout="vertical" requiredMark={false}>
                            <Form.Item name="amount" label="积分变化" extra="正数为增加，负数为扣减。" rules={[{ required: true, message: "请填写积分变化" }]}>
                                <InputNumber className="w-full" precision={6} placeholder="例如 100 或 -20" autoFocus />
                            </Form.Item>
                            <Form.Item name="note" label="调整原因" rules={[{ required: true, whitespace: true, message: "请填写工单号或处理依据" }]}>
                                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={200} showCount placeholder="例如：工单 #1234 补偿失败任务" />
                            </Form.Item>
                        </Form>
                    )}
                </div>
            ) : null}
        </AdminModal>
    );
}
