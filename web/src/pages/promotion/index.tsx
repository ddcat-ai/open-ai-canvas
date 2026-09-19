import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, Coins, Copy, Gift, Link2, ShieldCheck, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";

import { StatusBadge } from "@/components/ui/base/badges/status-badge";
import { PaginationBar, TableSurface } from "@/components/layout/workspace-page";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Tooltip } from "@/components/ui/base/tooltip";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { formatCredits } from "@/constant/credits";
import {
    createPromotionWithdrawal,
    getPromotionOverview,
    listPromotionCommissions,
    listPromotionInvitations,
    listPromotionWithdrawals,
    transferPromotionCommission,
    type PromotionCommissionPage,
    type PromotionCommissionRecord,
    type PromotionInvitationPage,
    type PromotionInvitationItem,
    type PromotionOverview,
    type PromotionWithdrawal,
    type PromotionWithdrawalPage,
} from "@/services/api/promotion";

const MICROCREDITS_PER_CREDIT = 1_000_000;

type RecordTab = "invited" | "commission" | "withdrawal";

const tabOptions = [
    { value: "invited", label: "已邀请" },
    { value: "commission", label: "返佣流水" },
    { value: "withdrawal", label: "提现记录" },
];

// 统一用项目 StatusBadge，避免 antd Tag 在主题 token 下出现不可读配色。
type BadgeTone = "neutral" | "success" | "warning" | "error" | "loading";

const commissionStatusLabel: Record<PromotionCommissionRecord["status"], { text: string; tone: BadgeTone }> = {
    frozen: { text: "冻结中", tone: "warning" },
    available: { text: "可提现", tone: "success" },
    transferred: { text: "已转积分", tone: "neutral" },
    withdrawing: { text: "审核中", tone: "loading" },
    withdrawn: { text: "已提现", tone: "neutral" },
};

const withdrawalStatusLabel: Record<PromotionWithdrawal["status"], { text: string; tone: BadgeTone }> = {
    pending: { text: "审核中", tone: "loading" },
    approved: { text: "已通过", tone: "success" },
    rejected: { text: "已驳回", tone: "error" },
};

const channelLabel: Record<string, string> = { alipay: "支付宝", wechat: "微信", bank: "银行卡" };

const invitationSourceLabel: Record<string, string> = { link: "邀请链接", code: "邀请码", manual: "手动邀请码" };

function formatPercent(ratioBasisPoints: number) {
    const percent = ratioBasisPoints / 100;
    return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

function maskContact(value: string) {
    const text = value.trim();
    if (!text) return "—";
    if (text.includes("@")) {
        const [name, domain] = text.split("@");
        const head = name.slice(0, 1);
        return `${head}${"*".repeat(Math.max(3, name.length - 1))}@${domain}`;
    }
    if (text.length <= 3) return `${text.slice(0, 1)}***`;
    return `${text.slice(0, 3)}****${text.slice(-2)}`;
}

function formatDateTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 指标卡：推广中心首屏四个关键数字，保持同一视觉权重。 */
function MetricCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-xl border border-border/70 bg-surface p-4">
            <div className="flex items-center gap-2 text-foreground/62">
                <span className="text-foreground/45">{icon}</span>
                <span className="text-[var(--fs-label)] font-medium">{label}</span>
            </div>
            <div className="mt-3 text-[var(--fs-heading-lg)] font-semibold leading-7">{value}</div>
            {hint ? <div className="mt-1 text-[var(--fs-caption)] text-foreground/52">{hint}</div> : null}
        </div>
    );
}

export default function PromotionPage() {
    const { message } = App.useApp();
    const [overview, setOverview] = useState<PromotionOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [tab, setTab] = useState<RecordTab>("invited");
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [invitations, setInvitations] = useState<PromotionInvitationPage | null>(null);
    const [commissions, setCommissions] = useState<PromotionCommissionPage | null>(null);
    const [withdrawals, setWithdrawals] = useState<PromotionWithdrawalPage | null>(null);
    const [recordsLoading, setRecordsLoading] = useState(false);
    const [copied, setCopied] = useState<"code" | "link" | "">("");
    const [transferOpen, setTransferOpen] = useState(false);
    const [transferAmount, setTransferAmount] = useState<number | null>(null);
    const [transferring, setTransferring] = useState(false);
    const [withdrawOpen, setWithdrawOpen] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState<number | null>(null);
    const [withdrawChannel, setWithdrawChannel] = useState("alipay");
    const [withdrawAccount, setWithdrawAccount] = useState("");
    const [withdrawAccountName, setWithdrawAccountName] = useState("");
    const [withdrawing, setWithdrawing] = useState(false);

    // 可用返佣为 0 时资金操作没有意义，但必须说明原因，避免用户误判为按钮失效。
    const availableCredits = overview?.availableMicrocredits ?? 0;
    // 推广中心被管理员关闭时，资金按钮必须停用并说明原因，避免用户以为余额被吞。
    const canOperateCommission = Boolean(overview) && Boolean(overview?.enabled) && availableCredits > 0;
    const actionHint = !overview
        ? "推广数据加载中"
        : !overview.enabled
          ? "推广中心暂未开放，请联系管理员"
          : availableCredits > 0
            ? undefined
            : `暂无可用返佣：好友充值后返佣先冻结 ${overview.freezeDays} 天，解冻后才能转入或提现`;

    const loadOverview = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getPromotionOverview();
            setOverview(result.overview);
            setLoadError("");
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "推广数据加载失败");
        } finally {
            setLoading(false);
        }
    }, []);

    const loadRecords = useCallback(
        async (target: RecordTab, targetPage: number) => {
            setRecordsLoading(true);
            try {
                if (target === "invited") {
                    setInvitations(await listPromotionInvitations({ page: targetPage, pageSize }));
                } else if (target === "commission") {
                    setCommissions(await listPromotionCommissions({ page: targetPage, pageSize }));
                } else {
                    setWithdrawals(await listPromotionWithdrawals({ page: targetPage, pageSize }));
                }
            } catch (error) {
                message.error(error instanceof Error ? error.message : "推广记录加载失败");
            } finally {
                setRecordsLoading(false);
            }
        },
        [message, pageSize],
    );

    useEffect(() => {
        void loadOverview();
    }, [loadOverview]);

    useEffect(() => {
        void loadRecords(tab, page);
    }, [loadRecords, page, tab]);

    const inviteLink = useMemo(() => {
        if (!overview?.inviteCode || typeof window === "undefined") return "";
        return `${window.location.origin}/register?invite=${overview.inviteCode}&source=share`;
    }, [overview?.inviteCode]);

    const copyText = async (value: string, kind: "code" | "link") => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            setCopied(kind);
            message.success(kind === "code" ? "邀请码已复制" : "邀请链接已复制");
            window.setTimeout(() => setCopied(""), 1600);
        } catch {
            message.warning("复制失败，请手动选择文本复制");
        }
    };

    const submitTransfer = async () => {
        const amount = Number(transferAmount || 0);
        if (!amount || amount <= 0) {
            message.warning("请输入要转入的积分数量");
            return;
        }
        setTransferring(true);
        try {
            // requestId 由前端生成并在重试时复用，保证重复点击不会重复入账。
            await transferPromotionCommission({
                amountMicrocredits: Math.round(amount * MICROCREDITS_PER_CREDIT),
                requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            });
            message.success("已转入账户积分");
            setTransferOpen(false);
            setTransferAmount(null);
            await loadOverview();
            if (tab === "commission") await loadRecords(tab, page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "转入积分失败");
        } finally {
            setTransferring(false);
        }
    };

    const submitWithdraw = async () => {
        const amount = Number(withdrawAmount || 0);
        if (!amount || amount <= 0) {
            message.warning("请输入提现金额");
            return;
        }
        if (!withdrawAccount.trim()) {
            message.warning("请填写收款账号");
            return;
        }
        setWithdrawing(true);
        try {
            await createPromotionWithdrawal({
                amountMicrocredits: Math.round(amount * MICROCREDITS_PER_CREDIT),
                channel: withdrawChannel,
                account: withdrawAccount.trim(),
                accountName: withdrawAccountName.trim(),
            });
            message.success("提现申请已提交，等待管理员审核");
            setWithdrawOpen(false);
            setWithdrawAmount(null);
            setWithdrawAccount("");
            setWithdrawAccountName("");
            await loadOverview();
            setTab("withdrawal");
            setPage(1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提现申请失败");
        } finally {
            setWithdrawing(false);
        }
    };

    const invitationColumns: ColumnsType<PromotionInvitationItem> = [
        {
            title: "受邀用户",
            dataIndex: "inviteeName",
            render: (_, record) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{record.inviteeName || "未命名用户"}</div>
                    <div className="truncate text-[var(--fs-caption)] text-foreground/52">{maskContact(record.inviteeContact)}</div>
                </div>
            ),
        },
        {
            title: "邀请来源",
            dataIndex: "source",
            width: 140,
            render: (value: string) => <StatusBadge variant="filled" tone="neutral" label={invitationSourceLabel[value] || value || "邀请链接"} />,
        },
        {
            title: "累计贡献",
            dataIndex: "contributedMicrocredits",
            width: 160,
            render: (value: number) => <span className="font-medium tabular-nums">{formatCredits(value)} 积分</span>,
        },
        {
            title: "注册时间",
            dataIndex: "createdAt",
            width: 170,
            render: (value: string) => <span className="tabular-nums text-foreground/72">{formatDateTime(value)}</span>,
        },
    ];

    const commissionColumns: ColumnsType<PromotionCommissionRecord> = [
        {
            title: "来源用户",
            dataIndex: "inviteeId",
            render: (value: string) => <span className="truncate text-foreground/72">{value || "—"}</span>,
        },
        {
            title: "充值金额",
            dataIndex: "baseMicrocredits",
            width: 150,
            render: (value: number) => <span className="tabular-nums">{formatCredits(value)} 积分</span>,
        },
        {
            title: "比例",
            dataIndex: "ratioBasisPoints",
            width: 100,
            render: (value: number) => <span className="tabular-nums">{formatPercent(value)}</span>,
        },
        {
            title: "返佣",
            dataIndex: "amountMicrocredits",
            width: 150,
            render: (value: number) => <span className="font-medium tabular-nums">{formatCredits(value)} 积分</span>,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 120,
            render: (value: PromotionCommissionRecord["status"], record) => (
                <div className="flex flex-col gap-1">
                    <StatusBadge
                        variant="filled"
                        tone={commissionStatusLabel[value]?.tone ?? "neutral"}
                        label={commissionStatusLabel[value]?.text || value}
                    />
                    {value === "frozen" ? <span className="text-[var(--fs-caption)] text-foreground/52">{formatDateTime(record.availableAt)} 解冻</span> : null}
                </div>
            ),
        },
        {
            title: "时间",
            dataIndex: "createdAt",
            width: 170,
            render: (value: string) => <span className="tabular-nums text-foreground/72">{formatDateTime(value)}</span>,
        },
    ];

    const withdrawalColumns: ColumnsType<PromotionWithdrawal> = [
        {
            title: "提现方式",
            dataIndex: "channel",
            width: 130,
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
            width: 150,
            render: (value: number) => <span className="font-medium tabular-nums">{formatCredits(value)} 积分</span>,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 120,
            render: (value: PromotionWithdrawal["status"]) => (
                <StatusBadge
                    variant="filled"
                    tone={withdrawalStatusLabel[value]?.tone ?? "neutral"}
                    label={withdrawalStatusLabel[value]?.text || value}
                />
            ),
        },
        {
            title: "审核备注",
            dataIndex: "reviewNote",
            render: (value: string) => <span className="text-foreground/72">{value || "—"}</span>,
        },
        {
            title: "提交时间",
            dataIndex: "createdAt",
            width: 170,
            render: (value: string) => <span className="tabular-nums text-foreground/72">{formatDateTime(value)}</span>,
        },
    ];

    const recordTotal = tab === "invited" ? invitations?.total || 0 : tab === "commission" ? commissions?.total || 0 : withdrawals?.total || 0;

    if (loadError) {
        return <WorkspaceState icon="wallet" title="推广数据加载失败" description={loadError} />;
    }

    return (
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 p-4 md:p-6">
            {overview && !overview.enabled ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[var(--fs-caption)] text-amber-700 dark:text-amber-300">
                    推广中心暂未开放：管理员在「系统配置 → 功能开放」中开启后，邀请返佣与提现才会生效。
                </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-[var(--fs-heading-lg)] font-semibold leading-7">推广中心</h1>
                    <p className="mt-1 text-[var(--fs-caption)] text-foreground/62">邀请好友加入，好友充值后返佣进入冻结账户。</p>
                </div>
                <StatusBadge
                    variant="filled"
                    tone="neutral"
                    label={`当前比例 ${overview ? formatPercent(overview.ratioBasisPoints) : "—"} · 平台`}
                />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                    icon={<Sparkles className="size-4" />}
                    label="我的返佣比例"
                    value={overview ? formatPercent(overview.ratioBasisPoints) : "—"}
                    hint="跟随平台默认"
                />
                <MetricCard
                    icon={<Users className="size-4" />}
                    label="邀请人数"
                    value={overview ? String(overview.invitedCount) : "—"}
                    hint="注册并绑定邀请关系"
                />
                <MetricCard
                    icon={<Coins className="size-4" />}
                    label="冻结返佣"
                    value={overview ? `${formatCredits(overview.frozenMicrocredits)} 积分` : "—"}
                    hint={`充值后冻结 ${overview?.freezeDays ?? 3} 天`}
                />
                <MetricCard
                    icon={<TrendingUp className="size-4" />}
                    label="累计返佣"
                    value={overview ? `${formatCredits(overview.totalMicrocredits)} 积分` : "—"}
                    hint={overview ? `已解冻 ${formatCredits(overview.unfrozenMicrocredits)} 积分` : undefined}
                />
            </div>

            <section className="rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex items-center gap-2">
                    <Gift className="size-4 text-foreground/45" />
                    <h2 className="text-[var(--fs-body)] font-semibold">邀请好友</h2>
                </div>
                <p className="mt-1 text-[var(--fs-caption)] text-foreground/62">好友通过你的邀请码完成注册后，关系永久绑定；仅标记为充值的积分入账会产生返佣。</p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                        <div className="mb-2 text-[var(--fs-label)] font-medium text-foreground/62">我的邀请码</div>
                        <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2">
                            <span className="flex-1 truncate font-mono text-[var(--fs-body)] tracking-wider">{overview?.inviteCode || "—"}</span>
                            <Button
                                size="small"
                                icon={copied === "code" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                                disabled={!overview?.inviteCode}
                                onClick={() => void copyText(overview?.inviteCode || "", "code")}
                            >
                                复制
                            </Button>
                        </div>
                    </div>
                    <div>
                        <div className="mb-2 text-[var(--fs-label)] font-medium text-foreground/62">邀请链接</div>
                        <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2">
                            <Link2 className="size-3.5 shrink-0 text-foreground/45" />
                            <span className="min-w-0 flex-1 truncate text-[var(--fs-caption)] text-foreground/72">{inviteLink || "—"}</span>
                            <Button
                                size="small"
                                icon={copied === "link" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                                disabled={!inviteLink}
                                onClick={() => void copyText(inviteLink, "link")}
                            >
                                复制
                            </Button>
                        </div>
                    </div>
                </div>

                <ol className="mt-4 grid gap-2 text-[var(--fs-caption)] text-foreground/62 md:grid-cols-3">
                    <li>01 分享邀请码或邀请链接，注册时完成绑定。</li>
                    <li>02 被邀请人充值后，返佣立即入账并冻结 {overview?.freezeDays ?? 3} 天。</li>
                    <li>03 冻结期满自动转为可用返佣，可转入账户积分或提交提现审核。</li>
                </ol>
            </section>

            <section className="rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Wallet className="size-4 text-foreground/45" />
                        <h2 className="text-[var(--fs-body)] font-semibold">返佣账户</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <Tooltip title={actionHint}>
                            <span>
                                <Button
                                    icon={<Coins className="size-4" />}
                                    disabled={!canOperateCommission}
                                    onClick={() => setTransferOpen(true)}
                                >
                                    转入积分
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={actionHint}>
                            <span>
                                <Button
                                    type="primary"
                                    icon={<ShieldCheck className="size-4" />}
                                    disabled={!canOperateCommission}
                                    onClick={() => setWithdrawOpen(true)}
                                >
                                    申请提现
                                </Button>
                            </span>
                        </Tooltip>
                    </div>
                </div>
                <p className="mt-1 text-[var(--fs-caption)] text-foreground/62">可用返佣可直接转入账户积分；提现按当前策略收取手续费并由管理员线下结算。</p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard icon={<Coins className="size-4" />} label="可用返佣" value={overview ? `${formatCredits(overview.availableMicrocredits)} 积分` : "—"} />
                    <MetricCard icon={<ShieldCheck className="size-4" />} label="审核占用" value={overview ? `${formatCredits(overview.reviewMicrocredits)} 积分` : "—"} />
                    <MetricCard icon={<TrendingUp className="size-4" />} label="已转积分" value={overview ? `${formatCredits(overview.transferredMicrocredits)} 积分` : "—"} />
                    <MetricCard icon={<Wallet className="size-4" />} label="已提现" value={overview ? `${formatCredits(overview.withdrawnMicrocredits)} 积分` : "—"} />
                </div>
            </section>

            <section className="rounded-xl border border-border/70 bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-[var(--fs-body)] font-semibold">推广记录</h2>
                        <p className="mt-1 text-[var(--fs-caption)] text-foreground/62">邀请关系、返佣流水与提现进度集中查询。</p>
                    </div>
                    <SegmentedControl
                        value={tab}
                        options={tabOptions}
                        onChange={(value) => {
                            setTab(value as RecordTab);
                            setPage(1);
                        }}
                    />
                </div>

                <TableSurface className="mt-3 rounded-xl border-border/70 bg-transparent">
                    {tab === "invited" ? (
                        <Table
                            rowKey="id"
                            size="small"
                            loading={recordsLoading}
                            columns={invitationColumns}
                            dataSource={invitations?.items || []}
                            pagination={false}
                            locale={{ emptyText: "还没有邀请记录，把邀请链接分享给好友试试。" }}
                        />
                    ) : null}
                    {tab === "commission" ? (
                        <Table
                            rowKey="id"
                            size="small"
                            loading={recordsLoading}
                            columns={commissionColumns}
                            dataSource={commissions?.items || []}
                            pagination={false}
                            locale={{ emptyText: "暂无返佣流水，好友充值后会在这里显示。" }}
                        />
                    ) : null}
                    {tab === "withdrawal" ? (
                        <Table
                            rowKey="id"
                            size="small"
                            loading={recordsLoading}
                            columns={withdrawalColumns}
                            dataSource={withdrawals?.items || []}
                            pagination={false}
                            locale={{ emptyText: "暂无提现记录。" }}
                        />
                    ) : null}
                </TableSurface>

                <div className="mt-3">
                    <PaginationBar
                        total={recordTotal}
                        current={page}
                        pageSize={pageSize}
                        onChange={(nextPage) => setPage(nextPage)}
                    />
                </div>
            </section>

            <Modal
                open={transferOpen}
                title="转入账户积分"
                okText="确认转入"
                cancelText="取消"
                confirmLoading={transferring}
                onOk={() => void submitTransfer()}
                onCancel={() => setTransferOpen(false)}
            >
                <p className="mb-3 text-[var(--fs-caption)] text-foreground/62">
                    可用返佣 {overview ? formatCredits(overview.availableMicrocredits) : "0"} 积分，转入后可直接用于生成消耗。
                </p>
                <InputNumber
                    className="w-full"
                    min={0}
                    step={0.1}
                    value={transferAmount}
                    onChange={(value) => setTransferAmount(typeof value === "number" ? value : null)}
                    placeholder="请输入要转入的积分数量"
                    addonAfter="积分"
                />
            </Modal>

            <Modal
                open={withdrawOpen}
                title="申请提现"
                okText="提交申请"
                cancelText="取消"
                confirmLoading={withdrawing}
                onOk={() => void submitWithdraw()}
                onCancel={() => setWithdrawOpen(false)}
            >
                <div className="flex flex-col gap-3">
                    <p className="text-[var(--fs-caption)] text-foreground/62">
                        可用返佣 {overview ? formatCredits(overview.availableMicrocredits) : "0"} 积分
                        {overview && overview.minWithdrawalMicrocredits > 0 ? `，最低提现 ${formatCredits(overview.minWithdrawalMicrocredits)} 积分` : ""}。
                    </p>
                    <InputNumber
                        className="w-full"
                        min={0}
                        step={1}
                        value={withdrawAmount}
                        onChange={(value) => setWithdrawAmount(typeof value === "number" ? value : null)}
                        placeholder="请输入提现积分数量"
                        addonAfter="积分"
                    />
                    <SegmentedControl
                        value={withdrawChannel}
                        options={[
                            { value: "alipay", label: "支付宝" },
                            { value: "wechat", label: "微信" },
                            { value: "bank", label: "银行卡" },
                        ]}
                        onChange={setWithdrawChannel}
                    />
                    <Input value={withdrawAccount} onChange={(event) => setWithdrawAccount(event.target.value)} placeholder="收款账号（手机号 / 邮箱 / 卡号）" />
                    <Input value={withdrawAccountName} onChange={(event) => setWithdrawAccountName(event.target.value)} placeholder="收款人姓名（选填）" />
                </div>
            </Modal>
        </div>
    );
}
