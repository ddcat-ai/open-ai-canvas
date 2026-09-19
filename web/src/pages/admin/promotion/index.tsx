import { useCallback, useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Switch, Table } from "antd";
import type { ColumnsType } from "antd/es/table";

import { StatusBadge } from "@/components/ui/base/badges/status-badge";
import { PaginationBar, TableSurface } from "@/components/layout/workspace-page";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { formatCredits } from "@/constant/credits";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import {
    getAdminPromotionPolicy,
    listAdminPromotionWithdrawals,
    reviewAdminPromotionWithdrawal,
    updateAdminPromotionPolicy,
    type PromotionWithdrawal,
    type PromotionWithdrawalPage,
} from "@/services/api/promotion";

const MICROCREDITS_PER_CREDIT = 1_000_000;

const statusOptions = [
    { value: "pending", label: "审核中" },
    { value: "approved", label: "已通过" },
    { value: "rejected", label: "已驳回" },
    { value: "", label: "全部" },
];

// 统一用项目 StatusBadge，避免 antd Tag 在主题 token 下出现不可读配色。
type BadgeTone = "neutral" | "success" | "warning" | "error" | "loading";

const statusTag: Record<PromotionWithdrawal["status"], { text: string; tone: BadgeTone }> = {
    pending: { text: "审核中", tone: "loading" },
    approved: { text: "已通过", tone: "success" },
    rejected: { text: "已驳回", tone: "error" },
};

const channelLabel: Record<string, string> = { alipay: "支付宝", wechat: "微信", bank: "银行卡" };

function formatDateTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function AdminPromotionPage() {
    const { message } = App.useApp();
    const promotionEnabled = useUserStore((state) => state.features.promotionEnabled);
    const [togglingPromotion, setTogglingPromotion] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [ratioPercent, setRatioPercent] = useState<number | null>(3);
    const [freezeDays, setFreezeDays] = useState<number | null>(3);
    const [minWithdrawCredits, setMinWithdrawCredits] = useState<number | null>(10);

    const [status, setStatus] = useState("pending");
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [withdrawals, setWithdrawals] = useState<PromotionWithdrawalPage | null>(null);
    const [recordsLoading, setRecordsLoading] = useState(false);
    const [reviewTarget, setReviewTarget] = useState<PromotionWithdrawal | null>(null);
    const [reviewApprove, setReviewApprove] = useState(true);
    const [reviewNote, setReviewNote] = useState("");
    const [reviewing, setReviewing] = useState(false);

    const loadPolicy = useCallback(async () => {
        try {
            const result = await getAdminPromotionPolicy();
            const policy = result.policy;
            setRatioPercent(policy.ratioBasisPoints / 100);
            setFreezeDays(policy.freezeDays);
            setMinWithdrawCredits(policy.minWithdrawalMicrocredits / MICROCREDITS_PER_CREDIT);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "推广策略加载失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    const loadWithdrawals = useCallback(
        async (targetStatus: string, targetPage: number) => {
            setRecordsLoading(true);
            try {
                setWithdrawals(await listAdminPromotionWithdrawals({ status: targetStatus || undefined, page: targetPage, pageSize }));
            } catch (error) {
                message.error(error instanceof Error ? error.message : "提现申请加载失败");
            } finally {
                setRecordsLoading(false);
            }
        },
        [message, pageSize],
    );

    useEffect(() => {
        void loadPolicy();
    }, [loadPolicy]);

    useEffect(() => {
        void loadWithdrawals(status, page);
    }, [loadWithdrawals, page, status]);

    // 与「系统配置 → 功能开放」共用同一个特性开关；保存后刷新会话态，侧边栏与路由立即响应。
    const togglePromotion = async (checked: boolean) => {
        setTogglingPromotion(true);
        try {
            await updateAdminFeatureAvailability({ promotionEnabled: checked });
            await refreshFeatureAvailability();
            message.success(checked ? "推广中心已开启" : "推广中心已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "开关保存失败");
        } finally {
            setTogglingPromotion(false);
        }
    };

    const savePolicy = async () => {
        const ratio = Number(ratioPercent ?? 0);
        if (ratio < 0 || ratio > 100) {
            message.warning("返佣比例必须在 0%-100% 之间");
            return;
        }
        const days = Number(freezeDays ?? 0);
        if (days < 0 || days > 365) {
            message.warning("冻结天数必须在 0-365 天之间");
            return;
        }
        setSaving(true);
        try {
            await updateAdminPromotionPolicy({
                ratioBasisPoints: Math.round(ratio * 100),
                freezeDays: Math.round(days),
                minWithdrawalMicrocredits: Math.round(Number(minWithdrawCredits ?? 0) * MICROCREDITS_PER_CREDIT),
            });
            message.success("推广策略已保存，对新的返佣结算立即生效");
            await loadPolicy();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存推广策略失败");
        } finally {
            setSaving(false);
        }
    };

    const openReview = (target: PromotionWithdrawal, approve: boolean) => {
        setReviewTarget(target);
        setReviewApprove(approve);
        setReviewNote("");
    };

    const submitReview = async () => {
        if (!reviewTarget) return;
        if (!reviewApprove && !reviewNote.trim()) {
            message.warning("驳回时必须填写原因");
            return;
        }
        setReviewing(true);
        try {
            await reviewAdminPromotionWithdrawal(reviewTarget.id, { approve: reviewApprove, note: reviewNote.trim() });
            message.success(reviewApprove ? "已通过，返佣标记为已提现" : "已驳回，占用额度已退回可用返佣");
            setReviewTarget(null);
            await Promise.all([loadWithdrawals(status, page), loadPolicy()]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "审核失败");
        } finally {
            setReviewing(false);
        }
    };

    const columns: ColumnsType<PromotionWithdrawal> = [
        {
            title: "用户",
            dataIndex: "userId",
            render: (value: string) => <span className="truncate font-mono text-[var(--fs-caption)]">{value || "—"}</span>,
        },
        {
            title: "提现方式",
            dataIndex: "channel",
            width: 110,
            render: (value: string) => <StatusBadge variant="filled" tone="neutral" label={channelLabel[value] || value} />,
        },
        {
            title: "收款账号",
            dataIndex: "account",
            render: (value: string, record) => (
                <div className="min-w-0">
                    <div className="truncate">{value || "—"}</div>
                    {record.accountName ? <div className="truncate text-[var(--fs-caption)] text-foreground/52">{record.accountName}</div> : null}
                </div>
            ),
        },
        {
            title: "金额",
            dataIndex: "amountMicrocredits",
            width: 130,
            render: (value: number) => <span className="font-medium tabular-nums">{formatCredits(value)} 积分</span>,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 110,
            render: (value: PromotionWithdrawal["status"]) => (
                <StatusBadge variant="filled" tone={statusTag[value]?.tone ?? "neutral"} label={statusTag[value]?.text || value} />
            ),
        },
        {
            title: "提交时间",
            dataIndex: "createdAt",
            width: 150,
            render: (value: string) => <span className="tabular-nums text-foreground/72">{formatDateTime(value)}</span>,
        },
        {
            title: "操作",
            key: "actions",
            width: 150,
            render: (_, record) =>
                record.status === "pending" ? (
                    <div className="flex items-center gap-2">
                        <Button size="small" type="primary" onClick={() => openReview(record, true)}>
                            通过
                        </Button>
                        <Button size="small" danger onClick={() => openReview(record, false)}>
                            驳回
                        </Button>
                    </div>
                ) : (
                    <span className="text-[var(--fs-caption)] text-foreground/52">{record.reviewNote || "已处理"}</span>
                ),
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-[var(--fs-heading-lg)] font-semibold leading-7">推广中心</h1>
                <p className="mt-1 text-[var(--fs-caption)] text-foreground/62">配置返佣策略，并处理用户提交的提现申请。</p>
            </div>

            <section className="rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-[var(--fs-body)] font-semibold">返佣策略</h2>
                        <p className="mt-1 text-[var(--fs-caption)] text-foreground/62">比例按充值入账积分计算；冻结期满自动转为可用返佣。</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[var(--fs-caption)] text-foreground/62">启用推广中心</span>
                        <Switch checked={promotionEnabled} loading={togglingPromotion} onChange={(checked) => void togglePromotion(checked)} />
                    </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[var(--fs-label)] font-medium text-foreground/62">返佣比例</span>
                        <InputNumber
                            className="w-full"
                            min={0}
                            max={100}
                            step={0.5}
                            value={ratioPercent}
                            onChange={(value) => setRatioPercent(typeof value === "number" ? value : null)}
                            addonAfter="%"
                            disabled={loading}
                        />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[var(--fs-label)] font-medium text-foreground/62">冻结天数</span>
                        <InputNumber
                            className="w-full"
                            min={0}
                            max={365}
                            step={1}
                            value={freezeDays}
                            onChange={(value) => setFreezeDays(typeof value === "number" ? value : null)}
                            addonAfter="天"
                            disabled={loading}
                        />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[var(--fs-label)] font-medium text-foreground/62">最低提现额度</span>
                        <InputNumber
                            className="w-full"
                            min={0}
                            step={1}
                            value={minWithdrawCredits}
                            onChange={(value) => setMinWithdrawCredits(typeof value === "number" ? value : null)}
                            addonAfter="积分"
                            disabled={loading}
                        />
                    </label>
                </div>

                <div className="mt-4 flex justify-end">
                    <Button type="primary" loading={saving} disabled={loading} onClick={() => void savePolicy()}>
                        保存策略
                    </Button>
                </div>
            </section>

            <section className="rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-[var(--fs-body)] font-semibold">提现审核</h2>
                        <p className="mt-1 text-[var(--fs-caption)] text-foreground/62">通过后占用额度转为已提现；驳回会立即把额度退回用户的可用返佣。</p>
                    </div>
                    <SegmentedControl
                        value={status}
                        options={statusOptions}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                    />
                </div>

                <TableSurface className="mt-3 rounded-xl border-border/70 bg-transparent">
                    <Table
                        rowKey="id"
                        size="small"
                        loading={recordsLoading}
                        columns={columns}
                        dataSource={withdrawals?.items || []}
                        pagination={false}
                        locale={{ emptyText: "当前筛选下没有提现申请。" }}
                    />
                </TableSurface>

                <div className="mt-3">
                    <PaginationBar total={withdrawals?.total || 0} current={page} pageSize={pageSize} onChange={(nextPage) => setPage(nextPage)} />
                </div>
            </section>

            <Modal
                open={Boolean(reviewTarget)}
                title={reviewApprove ? "通过提现申请" : "驳回提现申请"}
                okText={reviewApprove ? "确认通过" : "确认驳回"}
                cancelText="取消"
                confirmLoading={reviewing}
                onOk={() => void submitReview()}
                onCancel={() => setReviewTarget(null)}
            >
                <p className="mb-3 text-[var(--fs-caption)] text-foreground/62">
                    {reviewTarget ? `${formatCredits(reviewTarget.amountMicrocredits)} 积分 · ${channelLabel[reviewTarget.channel] || reviewTarget.channel} · ${reviewTarget.account}` : ""}
                </p>
                <Input.TextArea
                    rows={3}
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder={reviewApprove ? "审核备注（选填，可记录打款凭证）" : "请填写驳回原因，用户可在提现记录中看到"}
                />
            </Modal>
        </div>
    );
}
