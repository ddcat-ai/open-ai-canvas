import { App, Button, Checkbox, Form, Input, InputNumber } from "antd";
import { ChevronDown, Gift, HandCoins, Percent, RefreshCw, RotateCcw, Save, ArrowLeftRight, Tags } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router";

import { AdminPageFrame } from "../components/admin-shell";
import { SettingsSectionCard } from "../components/admin-ui";
import { Callout, SegmentedControl, Switch } from "../ui/controls";
import { getAdminInviteSetting, updateAdminInviteSetting, type InvitePolicy, type InviteRewardScope, type InviteSetting, type WithdrawMethod } from "@/services/api/invite";
import { listAdminTopupProducts, type TopupProduct } from "@/services/api/payments";

const withdrawMethodOptions: Array<{ value: WithdrawMethod; label: string }> = [
    { value: "wechat", label: "微信" },
    { value: "alipay", label: "支付宝" },
    { value: "bank", label: "银行卡" },
];

type ItemRateDraft = { l1: string; l2: string };

export default function InviteSettingsPage() {
    const { message, modal } = App.useApp();
    const [setting, setSetting] = useState<InviteSetting | null>(null);
    const [policy, setPolicy] = useState<InvitePolicy | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [productRates, setProductRates] = useState<Record<string, ItemRateDraft>>({});
    const [itemsExpanded, setItemsExpanded] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            const [settingResult, productResult] = await Promise.all([getAdminInviteSetting(), listAdminTopupProducts()]);
            const nextSetting = settingResult.setting;
            setSetting(nextSetting);
            setPolicy(stripAudit(nextSetting));
            setProducts(productResult.products ?? []);
            setProductRates(toDraft(nextSetting.productRates));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "读取邀请配置失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    const dirty = useMemo(() => {
        if (!setting || !policy) return false;
        return JSON.stringify({ policy, productRates }) !== JSON.stringify({ policy: stripAudit(setting), productRates: toDraft(setting.productRates) });
    }, [setting, policy, productRates]);
    const blocker = useBlocker(dirty && !saving);

    useEffect(() => {
        if (blocker.state !== "blocked") return;
        modal.confirm({
            title: "放弃邀请配置修改？",
            content: "当前修改尚未保存，离开后草稿会丢失。",
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => blocker.proceed(),
            onCancel: () => blocker.reset(),
        });
    }, [blocker, modal]);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, saving]);

    const submit = async () => {
        if (!policy) return;
        setSaving(true);
        try {
            const payload = normalizePolicy(policy, productRates);
            const result = await updateAdminInviteSetting(payload);
            setSetting(result.setting);
            setPolicy(stripAudit(result.setting));
            setProductRates(toDraft(result.setting.productRates));
            message.success("邀请配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存邀请配置失败");
        } finally {
            setSaving(false);
        }
    };

    const revert = () => {
        if (!setting) return;
        setPolicy(stripAudit(setting));
        setProductRates(toDraft(setting.productRates));
    };

    const patch = (next: Partial<InvitePolicy>) => setPolicy((current) => (current ? { ...current, ...next } : current));

    return (
        <AdminPageFrame
            title="邀请配置"
            description="邀请层级、奖励率、提现与划转规则"
            actions={
                <div className="flex items-center gap-2">
                    <Button icon={<RotateCcw className="size-4" />} disabled={!dirty || saving || loading} onClick={revert}>
                        撤销
                    </Button>
                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading} onClick={() => void submit()}>
                        保存
                    </Button>
                </div>
            }
            scroll
        >
            {loadError ? (
                <div className="admin-settings-stack">
                    <Callout
                        tone="error"
                        title="读取邀请配置失败"
                        action={
                            <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                                重试
                            </Button>
                        }
                    >
                        {loadError}
                    </Callout>
                </div>
            ) : loading || !policy ? (
                <div className="admin-settings-stack" role="status" aria-label="正在读取邀请配置">
                    加载中…
                </div>
            ) : (
                <div className="admin-settings-stack">
                    {dirty ? (
                        <Callout tone="warning" title="有未保存的修改">
                            修改完成后请点击右上角“保存”，离开页面前会确认。
                        </Callout>
                    ) : null}

                    <SettingsSectionCard
                        icon={<Gift className="size-4" />}
                        title="邀请功能"
                        description="关闭后注册页不再展示邀请码输入框，也不再产生新的邀请奖励；已有余额与记录不受影响。"
                        status={{ label: policy.enabled ? "已开启" : "已关闭", color: policy.enabled ? "success" : "neutral" }}
                        layout="stacked"
                    >
                        <div className="flex flex-col gap-4 px-3 py-3">
                            <Form.Item label="开启邀请功能" style={{ marginBottom: 0 }}>
                                <Switch checked={policy.enabled} onChange={(checked) => patch({ enabled: checked })} />
                            </Form.Item>
                        </div>
                    </SettingsSectionCard>

                    {policy.enabled ? (
                        <SettingsSectionCard icon={<Gift className="size-4" />} title="邀请规则" description="层级与奖励率决定被邀请人订单产生奖励的方式；单品奖励率在下方单独覆盖。" layout="stacked">
                            <div className="grid gap-4 px-3 py-3 md:grid-cols-2">
                                <Form.Item label="邀请层级" style={{ marginBottom: 0 }}>
                                    <SegmentedControl
                                        value={String(policy.level) as "1" | "2"}
                                        onChange={(value) => patch({ level: Number(value) === 2 ? 2 : 1 })}
                                        options={[
                                            { label: "一级（A 邀请 B）", value: "1" },
                                            { label: "二级（含 B 邀请的 C）", value: "2" },
                                        ]}
                                    />
                                </Form.Item>
                                <Form.Item label="邀请奖励范围" style={{ marginBottom: 0 }}>
                                    <Checkbox.Group options={[{ label: "充值商品", value: "product" }]} value={policy.rewardScopes} onChange={(values) => patch({ rewardScopes: values as InviteRewardScope[] })} />
                                </Form.Item>
                                <Form.Item label="一级邀请奖励率（%）" style={{ marginBottom: 0 }}>
                                    <RateInput rateBp={policy.l1RateBp} onChange={(bp) => patch({ l1RateBp: bp })} />
                                </Form.Item>
                                {policy.level === 2 ? (
                                    <Form.Item label="二级邀请奖励率（%）" style={{ marginBottom: 0 }}>
                                        <RateInput rateBp={policy.l2RateBp} onChange={(bp) => patch({ l2RateBp: bp })} />
                                    </Form.Item>
                                ) : null}
                                <Form.Item label="邀请奖励次数（0 = 无上限）" extra="每个被邀请人只有前 N 笔订单产生奖励" style={{ marginBottom: 0 }}>
                                    <InputNumber min={0} max={100000} value={policy.rewardCountLimit} onChange={(value) => patch({ rewardCountLimit: Number(value) || 0 })} />
                                </Form.Item>
                                <Form.Item label="邀请人数上限（0 = 无限制，含一级+二级）" extra="超过上限后新邀请码不再生效" style={{ marginBottom: 0 }}>
                                    <InputNumber min={0} max={1000000} value={policy.inviteeCountLimit} onChange={(value) => patch({ inviteeCountLimit: Number(value) || 0 })} />
                                </Form.Item>
                                <Form.Item label="邀请审核" extra="开启后被邀请人充值的奖励需管理员在邀请记录中通过后才进入可用余额" style={{ marginBottom: 0 }}>
                                    <Switch checked={policy.auditEnabled} onChange={(checked) => patch({ auditEnabled: checked })} />
                                </Form.Item>
                            </div>
                        </SettingsSectionCard>
                    ) : (
                        <Callout tone="info" title="邀请功能已关闭">
                            暂停新增邀请奖励，历史余额仍可按下方提现与划转设置处理。
                        </Callout>
                    )}

                    <SettingsSectionCard
                        icon={<HandCoins className="size-4" />}
                        title="提现设置"
                        description="提现由管理员线下打款并在此审核记账。"
                        status={{ label: policy.withdrawEnabled ? "已开启" : "已关闭", color: policy.withdrawEnabled ? "success" : "neutral" }}
                        layout="stacked"
                    >
                        <div className="grid gap-4 px-3 py-3 md:grid-cols-2">
                            <Form.Item label="支持提现" style={{ marginBottom: 0 }}>
                                <Switch checked={policy.withdrawEnabled} onChange={(checked) => patch({ withdrawEnabled: checked })} />
                            </Form.Item>
                            {policy.withdrawEnabled ? (
                                <>
                                    <Form.Item label="提现方式（可多选）" style={{ marginBottom: 0 }}>
                                        <Checkbox.Group options={withdrawMethodOptions} value={policy.withdrawMethods} onChange={(values) => patch({ withdrawMethods: values as WithdrawMethod[] })} />
                                    </Form.Item>
                                    <Form.Item label="提现最低金额（元，最低 0.01）" style={{ marginBottom: 0 }}>
                                        <YuanInput fen={policy.withdrawMinFen} minFen={1} onChange={(fen) => patch({ withdrawMinFen: fen })} />
                                    </Form.Item>
                                    <Form.Item label="每日提现次数上限（0 = 不限）" style={{ marginBottom: 0 }}>
                                        <InputNumber min={0} max={100} value={policy.withdrawDailyLimit} onChange={(value) => patch({ withdrawDailyLimit: Number(value) || 0 })} />
                                    </Form.Item>
                                    <Form.Item label="提现手续费（%）" style={{ marginBottom: 0 }}>
                                        <RateInput rateBp={policy.withdrawFeeBp} onChange={(bp) => patch({ withdrawFeeBp: bp })} />
                                    </Form.Item>
                                </>
                            ) : null}
                        </div>
                    </SettingsSectionCard>

                    <SettingsSectionCard
                        icon={<ArrowLeftRight className="size-4" />}
                        title="划转设置"
                        description="用户把奖励余额按比例划转为可用积分。"
                        status={{ label: policy.transferEnabled ? "已开启" : "已关闭", color: policy.transferEnabled ? "success" : "neutral" }}
                        layout="stacked"
                    >
                        <div className="grid gap-4 px-3 py-3 md:grid-cols-2">
                            <Form.Item label="开启划转" style={{ marginBottom: 0 }}>
                                <Switch checked={policy.transferEnabled} onChange={(checked) => patch({ transferEnabled: checked })} />
                            </Form.Item>
                            {policy.transferEnabled ? (
                                <>
                                    <Form.Item label="划转积分比例" extra={`展示为 1 元 = ${(policy.transferRateMilli / 1000).toFixed(policy.transferRateMilli % 1000 === 0 ? 0 : 3)} 积分`} style={{ marginBottom: 0 }}>
                                        <InputNumber min={0.001} max={1000} step={0.1} value={policy.transferRateMilli / 1000} onChange={(value) => patch({ transferRateMilli: Math.max(1, Math.round((Number(value) || 1) * 1000)) })} />
                                    </Form.Item>
                                    <Form.Item label="最低划转金额（元）" style={{ marginBottom: 0 }}>
                                        <YuanInput fen={policy.transferMinFen} minFen={1} onChange={(fen) => patch({ transferMinFen: fen })} />
                                    </Form.Item>
                                </>
                            ) : null}
                        </div>
                    </SettingsSectionCard>

                    {policy.enabled ? (
                        <SettingsSectionCard
                            icon={<Tags className="size-4" />}
                            title="单品奖励率覆盖"
                            description="为充值商品单独设置奖励率；留空则使用上方通用配置。仅展示奖励范围内可购买的项目。"
                            status={
                                <Button type="text" size="small" icon={<ChevronDown className={itemsExpanded ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />} onClick={() => setItemsExpanded((value) => !value)}>
                                    {itemsExpanded ? "收起" : "展开"}
                                </Button>
                            }
                            layout="stacked"
                        >
                            {itemsExpanded ? (
                                <div className="flex flex-col gap-6 px-3 py-3">
                                    {policy.rewardScopes.includes("product") ? (
                                        <ItemRateEditor
                                            caption="充值商品"
                                            groups={[
                                                {
                                                    key: "products",
                                                    label: "",
                                                    rows: products.filter((product) => product.enabled).map((product) => ({ id: product.id, label: `${product.name} · ¥${(product.amountFen / 100).toFixed(2)}` })),
                                                },
                                            ]}
                                            drafts={productRates}
                                            onChange={setProductRates}
                                            level={policy.level}
                                        />
                                    ) : null}
                                </div>
                            ) : null}
                        </SettingsSectionCard>
                    ) : null}
                </div>
            )}
        </AdminPageFrame>
    );
}

function stripAudit(setting: InviteSetting): InvitePolicy {
    const { updatedBy: _updatedBy, createdAt: _createdAt, updatedAt: _updatedAt, ...policy } = setting;
    return policy;
}

function toDraft(rates?: Record<string, { l1RateBp?: number; l2RateBp?: number }>): Record<string, ItemRateDraft> {
    const draft: Record<string, ItemRateDraft> = {};
    for (const [id, rate] of Object.entries(rates ?? {})) {
        draft[id] = {
            l1: rate.l1RateBp != null ? String(rate.l1RateBp / 100) : "",
            l2: rate.l2RateBp != null ? String(rate.l2RateBp / 100) : "",
        };
    }
    return draft;
}

function normalizePolicy(policy: InvitePolicy, productRates: Record<string, ItemRateDraft>): InvitePolicy {
    const compact = (drafts: Record<string, ItemRateDraft>) => {
        const result: Record<string, { l1RateBp?: number; l2RateBp?: number }> = {};
        for (const [id, draft] of Object.entries(drafts)) {
            const parseRate = (value: string) => {
                if (!value.trim()) return undefined;
                if (!/^\d{1,3}(\.\d{1,2})?$/.test(value.trim()) || Number(value) > 100) throw new Error("商品奖励率必须为 0 至 100，最多两位小数");
                return Math.round(Number(value) * 100);
            };
            const l1 = parseRate(draft.l1);
            const l2 = parseRate(draft.l2);
            if (l1 === undefined && l2 === undefined) continue;
            result[id] = { l1RateBp: l1, l2RateBp: l2 };
        }
        return result;
    };
    return { ...policy, productRates: compact(productRates) };
}

function RateInput({ rateBp, onChange }: { rateBp: number; onChange: (bp: number) => void }) {
    return <InputNumber min={0} max={100} step={0.1} addonAfter="%" value={rateBp / 100} onChange={(value) => onChange(Math.max(0, Math.round((Number(value) || 0) * 100)))} />;
}

function YuanInput({ fen, minFen, onChange }: { fen: number; minFen: number; onChange: (fen: number) => void }) {
    return <InputNumber min={minFen / 100} step={0.01} addonAfter="元" value={fen / 100} onChange={(value) => onChange(Math.max(minFen, Math.round((Number(value) || 0) * 100)))} />;
}

function ItemRateEditor({
    caption,
    groups,
    drafts,
    onChange,
    level,
}: {
    caption: string;
    groups: Array<{ key: string; label: string; rows: Array<{ id: string; label: string }> }>;
    drafts: Record<string, ItemRateDraft>;
    onChange: (drafts: Record<string, ItemRateDraft>) => void;
    level: number;
}) {
    const update = (id: string, patch: Partial<ItemRateDraft>) => {
        onChange({ ...drafts, [id]: { ...(drafts[id] ?? { l1: "", l2: "" }), ...patch } });
    };
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
                <Percent className="size-4 text-foreground/45" />
                {caption}
            </div>
            {groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-2">
                    {group.label ? <div className="text-xs text-foreground/45">{group.label}</div> : null}
                    {group.rows.length === 0 ? <div className="text-xs text-foreground/35">暂无可配置项目</div> : null}
                    {group.rows.map((row) => {
                        const draft = drafts[row.id] ?? { l1: "", l2: "" };
                        return (
                            <div key={row.id} className="grid items-center gap-2 rounded-lg border border-border/50 px-3 py-2 md:grid-cols-[minmax(0,1fr)_150px_150px]">
                                <span className="truncate text-sm">{row.label}</span>
                                <Input size="small" addonBefore="一级%" placeholder="通用" value={draft.l1} onChange={(event) => update(row.id, { l1: event.target.value })} />
                                {level === 2 ? <Input size="small" addonBefore="二级%" placeholder="通用" value={draft.l2} onChange={(event) => update(row.id, { l2: event.target.value })} /> : null}
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
