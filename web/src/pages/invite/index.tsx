import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Switch } from "antd";
import { ArrowLeftRight, Banknote, Check, Copy, Gift, HandCoins, Smartphone, Ticket, UserRoundPlus, UsersRound, Wallet, CircleAlert, RefreshCw } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { cn } from "@/lib/utils";
import { formatMicroYuan, invitationStatusLabels, rewardAmountState, spendableRewardYuan, withdrawalAccountError, withdrawalStatusLabels } from "@/lib/invite";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import {
    createTransfer,
    createWithdrawal,
    getInviteOverview,
    getMyWithdrawAccount,
    listMyInviteRecords,
    listMyTransfers,
    listMyWithdrawals,
    type InviteOverview,
    type Paged,
    type TransferRecord,
    type UserInviteRecord,
    type WithdrawAccountInfo,
    type WithdrawMethod,
    type WithdrawRecord,
} from "@/services/api/invite";

type ListTab = "invites" | "withdrawals" | "transfers";

const PAGE_SIZE = 10;
const LIST_TABS: ListTab[] = ["invites", "withdrawals", "transfers"];

function ratePercent(bp: number) {
    return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
}

export default function InvitePage() {
    const { message } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const [overview, setOverview] = useState<InviteOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [tab, setTab] = useState<ListTab>("invites");
    const [copied, setCopied] = useState(false);
    const [withdrawOpen, setWithdrawOpen] = useState(false);
    const [transferOpen, setTransferOpen] = useState(false);

    const loadOverview = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            setOverview(await getInviteOverview());
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "读取邀请信息失败");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadOverview();
    }, [loadOverview]);

    const policy = overview?.policy;
    const account = overview?.account;
    const availableActions = [policy?.withdrawEnabled ? "提现" : "", policy?.transferEnabled ? "划转" : ""].filter(Boolean).join("或");
    const inviteLink = useMemo(() => {
        if (!overview?.inviteCode) return "";
        const origin = window.location.origin;
        return `${origin}/register?invite=${overview.inviteCode}`;
    }, [overview?.inviteCode]);

    const copyLink = async () => {
        if (!inviteLink) return;
        try {
            await navigator.clipboard.writeText(inviteLink);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
            message.success("邀请链接已复制");
        } catch {
            message.error("复制失败，请手动复制");
        }
    };

    const rewardRuleText = useMemo(() => {
        if (!policy || !policy.enabled) return "";
        const levels = policy.level === 2 ? `一级 ${ratePercent(policy.l1RateBp)}、二级 ${ratePercent(policy.l2RateBp)}` : `一级 ${ratePercent(policy.l1RateBp)}`;
        return `好友通过你的邀请注册并购买充值商品，可产生邀请奖励。默认${levels}，具体以充值商品配置为准。`;
    }, [policy]);

    return (
        <div className="invite-page">
            <section className="invite-intro" aria-labelledby="invite-page-title" aria-busy={loading}>
                <div className="invite-intro-copy">
                    <span className="invite-intro-eyebrow">
                        <Gift className="size-4" />
                        邀请好友 · 共享创作收益
                    </span>
                    <h1 id="invite-page-title" className="invite-intro-title">
                        分享{brandName}，邀请好友获取奖励
                    </h1>
                    {policy?.enabled ? <p className="invite-intro-description">{rewardRuleText}</p> : null}
                    {policy && !policy.enabled ? <p className="invite-intro-description">邀请活动已暂停，历史奖励与记录不受影响{availableActions ? `，可继续${availableActions}。` : "。"}</p> : null}
                </div>

                {overview && (policy?.enabled || policy?.withdrawEnabled || policy?.transferEnabled) ? (
                    <div className="invite-intro-footer">
                        {policy?.enabled ? (
                            <div className="invite-code">
                                <span className="invite-code-label">我的邀请码</span>
                                <span className="sr-only">{overview.inviteCode}</span>
                                <span className="invite-code-text" aria-hidden="true">
                                    {Array.from(overview.inviteCode).map((character, index) => (
                                        <span key={index}>{character}</span>
                                    ))}
                                </span>
                            </div>
                        ) : null}
                        <div className="invite-actions">
                            {policy?.enabled ? (
                                <Button className="invite-action invite-copy-action" size="large" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copyLink()}>
                                    {copied ? "已复制" : "复制邀请链接"}
                                </Button>
                            ) : null}
                            {policy?.withdrawEnabled ? (
                                <Button className="invite-action" type="primary" size="large" icon={<HandCoins className="size-4" />} onClick={() => setWithdrawOpen(true)}>
                                    提现
                                </Button>
                            ) : null}
                            {policy?.transferEnabled ? (
                                <Button className="invite-action" size="large" variant="outlined" icon={<ArrowLeftRight className="size-4" />} onClick={() => setTransferOpen(true)}>
                                    划转积分
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ) : null}
                {!overview && loading ? (
                    <div className="invite-intro-loading" role="status">
                        正在读取邀请信息…
                    </div>
                ) : null}
            </section>

            {loadError ? (
                <div className="invite-read-error" role="alert">
                    <span>
                        <CircleAlert className="size-4 text-destructive" />
                        {loadError}
                    </span>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void loadOverview()}>
                        重试
                    </Button>
                </div>
            ) : null}

            <section className="invite-balances" aria-label="奖励余额">
                <BalanceCard label="总获得奖励" value={account ? formatMicroYuan(account.totalMicroYuan) : "--"} hint="累计产生的邀请奖励" loading={loading} accent />
                <BalanceCard label="当前可用余额" value={account ? formatMicroYuan(account.availableMicroYuan) : "--"} hint={availableActions ? `可${availableActions}` : "当前可用奖励余额"} loading={loading} />
                <BalanceCard label="今日获得" value={account ? formatMicroYuan(account.todayRewardMicroYuan) : "--"} hint="今天新入账的奖励" loading={loading} />
                <BalanceCard label="冻结余额" value={account ? formatMicroYuan(account.frozenMicroYuan) : "--"} hint="审核中或提现处理中" loading={loading} />
            </section>

            <section className="invite-records" aria-label="邀请记录">
                <div className="invite-records-toolbar">
                    <div
                        className="invite-list-tabs"
                        role="tablist"
                        aria-label="邀请记录列表"
                        onKeyDown={(event) => {
                            const current = LIST_TABS.indexOf(tab);
                            let next: ListTab | undefined;
                            if (event.key === "ArrowRight") next = LIST_TABS[(current + 1) % LIST_TABS.length];
                            if (event.key === "ArrowLeft") next = LIST_TABS[(current + LIST_TABS.length - 1) % LIST_TABS.length];
                            if (event.key === "Home") next = LIST_TABS[0];
                            if (event.key === "End") next = LIST_TABS[LIST_TABS.length - 1];
                            if (!next) return;
                            event.preventDefault();
                            setTab(next);
                            event.currentTarget.querySelector<HTMLButtonElement>(`#invite-tab-${next}`)?.focus();
                        }}
                    >
                        <ListTabButton id="invites" active={tab === "invites"} onClick={() => setTab("invites")} icon={<UsersRound className="size-4" />} label={`邀请记录${account ? ` · ${overview?.inviteeCount ?? 0}` : ""}`} />
                        <ListTabButton id="withdrawals" active={tab === "withdrawals"} onClick={() => setTab("withdrawals")} icon={<Banknote className="size-4" />} label="提现记录" />
                        <ListTabButton id="transfers" active={tab === "transfers"} onClick={() => setTab("transfers")} icon={<ArrowLeftRight className="size-4" />} label="划转记录" />
                    </div>
                </div>
                {LIST_TABS.map((listTab) => (
                    <div key={listTab} id={`invite-panel-${listTab}`} role="tabpanel" aria-labelledby={`invite-tab-${listTab}`} hidden={tab !== listTab}>
                        {tab === listTab && listTab === "invites" ? <InviteRecordsTab overview={overview} /> : null}
                        {tab === listTab && listTab === "withdrawals" ? <WithdrawalsTab onCreated={() => void loadOverview()} /> : null}
                        {tab === listTab && listTab === "transfers" ? <TransfersTab onCreated={() => void loadOverview()} /> : null}
                    </div>
                ))}
            </section>

            <WithdrawModal
                open={withdrawOpen}
                policy={policy ?? null}
                availableMicroYuan={account?.availableMicroYuan ?? 0}
                onClose={() => setWithdrawOpen(false)}
                onDone={() => {
                    setWithdrawOpen(false);
                    void loadOverview();
                }}
            />
            <TransferModal
                open={transferOpen}
                policy={policy ?? null}
                availableMicroYuan={account?.availableMicroYuan ?? 0}
                onClose={() => setTransferOpen(false)}
                onDone={() => {
                    setTransferOpen(false);
                    void loadOverview();
                }}
            />
        </div>
    );
}

function BalanceCard({ label, value, hint, loading, accent = false }: { label: string; value: string; hint: string; loading: boolean; accent?: boolean }) {
    return (
        <div className={cn("invite-balance", accent && "invite-card-accent")} aria-busy={loading}>
            <span className="invite-balance-label">{label}</span>
            <span className="invite-balance-value">
                {loading ? (
                    <span className="invite-balance-placeholder" />
                ) : (
                    <>
                        <span className="invite-balance-currency">¥</span>
                        <span>{value}</span>
                    </>
                )}
            </span>
            <span className="invite-balance-hint">{hint}</span>
        </div>
    );
}

function ListTabButton({ id, active, onClick, icon, label }: { id: ListTab; active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
    return (
        <button type="button" id={`invite-tab-${id}`} role="tab" tabIndex={active ? 0 : -1} aria-selected={active} aria-controls={`invite-panel-${id}`} onClick={onClick} className="invite-list-tab">
            {icon}
            {label}
        </button>
    );
}

function InviteRecordsTab({ overview }: { overview: InviteOverview | null }) {
    const [page, setPage] = useState(1);
    const [data, setData] = useState<Paged<UserInviteRecord> | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [retryIndex, setRetryIndex] = useState(0);
    const sequence = useRef(0);

    useEffect(() => {
        const current = ++sequence.current;
        setLoading(true);
        setLoadError("");
        listMyInviteRecords(page, PAGE_SIZE)
            .then((result) => {
                if (current === sequence.current) setData(result);
            })
            .catch((error) => {
                if (current === sequence.current) setLoadError(error instanceof Error ? error.message : "读取邀请记录失败");
            })
            .finally(() => {
                if (current === sequence.current) setLoading(false);
            });
    }, [page, retryIndex]);

    return (
        <div className="flex flex-col gap-3">
            {loadError ? <ListReadError message={loadError} retry={() => setRetryIndex((value) => value + 1)} /> : null}
            {!loadError && data && data.records.length === 0 ? <EmptyHint icon={<UserRoundPlus className="size-5" />} title="还没有邀请记录" body="复制你的邀请链接发给好友，TA 注册成功后就会出现在这里。" /> : null}
            {loading && !data ? (
                <div role="status" className="py-4 text-sm text-foreground/50">
                    正在读取邀请记录…
                </div>
            ) : null}
            {data?.records.map((record) => (
                <article key={record.userId} className="invite-record">
                    <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-full bg-foreground/5">
                            <UsersRound className="size-4 text-foreground/50" />
                        </span>
                        <div>
                            <div className="text-sm font-medium">{record.inviteeDisplayName || record.inviteeUsername}</div>
                            <div className="text-xs text-foreground/45">
                                {record.myLevel === 1 ? "一级邀请" : "二级邀请"} · {new Date(record.createdAt).toLocaleDateString("zh-CN")}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <InviteStatusBadge status={record.status} />
                        <div className="text-right">
                            <div className="font-mono text-sm font-semibold tabular-nums">¥ {formatMicroYuan(record.myCreditedMicroYuan)}</div>
                            {record.myPendingMicroYuan > 0 ? <div className="text-xs text-amber-500">待审核 ¥ {formatMicroYuan(record.myPendingMicroYuan)}</div> : <div className="text-xs text-foreground/35">已到账奖励</div>}
                        </div>
                    </div>
                </article>
            ))}
            <SimplePagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} loading={loading} onChange={setPage} />
            {overview?.invitedBy && (overview.invitedBy.l1Username || overview.invitedBy.l2Username) ? (
                <p className="text-xs text-foreground/40">我的邀请人：{[overview.invitedBy.l1Username, overview.invitedBy.l2Username].filter(Boolean).join(" · ")}</p>
            ) : null}
        </div>
    );
}

export function InviteStatusBadge({ status }: { status: "pending" | "approved" | "frozen" }) {
    const map = {
        pending: { label: invitationStatusLabels.pending, className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
        approved: { label: invitationStatusLabels.approved, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
        frozen: { label: invitationStatusLabels.frozen, className: "border-border/60 bg-foreground/5 text-foreground/45" },
    } as const;
    const item = map[status];
    return <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", item.className)}>{item.label}</span>;
}

function WithdrawalsTab({ onCreated }: { onCreated: () => void }) {
    const [page, setPage] = useState(1);
    const [data, setData] = useState<Paged<WithdrawRecord> | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const sequence = useRef(0);

    const reload = useCallback((targetPage: number) => {
        const current = ++sequence.current;
        setLoading(true);
        setLoadError("");
        listMyWithdrawals(targetPage, PAGE_SIZE)
            .then((result) => {
                if (current === sequence.current) setData(result);
            })
            .catch((error) => {
                if (current === sequence.current) setLoadError(error instanceof Error ? error.message : "读取提现记录失败");
            })
            .finally(() => {
                if (current === sequence.current) setLoading(false);
            });
    }, []);

    useEffect(() => {
        reload(page);
    }, [page, reload]);

    useEffect(() => {
        const handler = () => {
            setPage(1);
            reload(1);
            onCreated();
        };
        window.addEventListener("invite:withdrawals-updated", handler);
        return () => window.removeEventListener("invite:withdrawals-updated", handler);
    }, [reload, onCreated]);

    return (
        <div className="flex flex-col gap-3">
            {loadError ? <ListReadError message={loadError} retry={() => reload(page)} /> : null}
            {!loadError && data && data.records.length === 0 ? <EmptyHint icon={<Banknote className="size-5" />} title="还没有提现记录" body="获得邀请奖励后，即可申请提现到微信、支付宝或银行卡。" /> : null}
            {loading && !data ? (
                <div role="status" className="py-4 text-sm text-foreground/50">
                    正在读取提现记录…
                </div>
            ) : null}
            {data?.records.map((record) => (
                <article key={record.id} className="invite-record">
                    <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-full bg-foreground/5">
                            <Wallet className="size-4 text-foreground/50" />
                        </span>
                        <div>
                            <div className="text-sm font-medium">提现 · {withdrawMethodLabel(record.method)}</div>
                            <div className="text-xs text-foreground/45">{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <WithdrawStatusBadge status={record.status} rejectReason={record.rejectReason} />
                        <div className="text-right">
                            <div className="font-mono text-sm font-semibold tabular-nums">¥ {formatMicroYuan(record.amountMicroYuan)}</div>
                            <div className="text-xs text-foreground/40">
                                手续费 ¥ {formatMicroYuan(record.feeMicroYuan)} · 实到 ¥ {formatMicroYuan(record.actualMicroYuan)}
                            </div>
                        </div>
                    </div>
                </article>
            ))}
            <SimplePagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} loading={loading} onChange={setPage} />
        </div>
    );
}

export function WithdrawStatusBadge({ status, rejectReason }: { status: 0 | 1 | 2; rejectReason?: string }) {
    if (status === 1) {
        return (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs text-red-600 dark:text-red-400" title={rejectReason}>
                {withdrawalStatusLabels[1]}
                {rejectReason ? ` · ${rejectReason}` : ""}
            </span>
        );
    }
    if (status === 2) {
        return <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">{withdrawalStatusLabels[2]}</span>;
    }
    return <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">{withdrawalStatusLabels[0]}</span>;
}

export function withdrawMethodLabel(method: WithdrawMethod) {
    return method === "wechat" ? "微信" : method === "alipay" ? "支付宝" : "银行卡";
}

function TransfersTab({ onCreated }: { onCreated: () => void }) {
    const [page, setPage] = useState(1);
    const [data, setData] = useState<Paged<TransferRecord> | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const sequence = useRef(0);

    const reload = useCallback((targetPage: number) => {
        const current = ++sequence.current;
        setLoading(true);
        setLoadError("");
        listMyTransfers(targetPage, PAGE_SIZE)
            .then((result) => {
                if (current === sequence.current) setData(result);
            })
            .catch((error) => {
                if (current === sequence.current) setLoadError(error instanceof Error ? error.message : "读取划转记录失败");
            })
            .finally(() => {
                if (current === sequence.current) setLoading(false);
            });
    }, []);

    useEffect(() => {
        reload(page);
    }, [page, reload]);

    useEffect(() => {
        const handler = () => {
            setPage(1);
            reload(1);
            onCreated();
        };
        window.addEventListener("invite:transfers-updated", handler);
        return () => window.removeEventListener("invite:transfers-updated", handler);
    }, [reload, onCreated]);

    return (
        <div className="flex flex-col gap-3">
            {loadError ? <ListReadError message={loadError} retry={() => reload(page)} /> : null}
            {!loadError && data && data.records.length === 0 ? <EmptyHint icon={<Ticket className="size-5" />} title="还没有划转记录" body="把奖励余额划转为积分，可以直接用于创作消费。" /> : null}
            {loading && !data ? (
                <div role="status" className="py-4 text-sm text-foreground/50">
                    正在读取划转记录…
                </div>
            ) : null}
            {data?.records.map((record) => (
                <article key={record.id} className="invite-record">
                    <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-full bg-foreground/5">
                            <ArrowLeftRight className="size-4 text-foreground/50" />
                        </span>
                        <div>
                            <div className="text-sm font-medium">奖励划转积分</div>
                            <div className="text-xs text-foreground/45">{new Date(record.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="font-mono text-sm font-semibold tabular-nums">
                            ¥ {formatMicroYuan(record.amountMicroYuan)} → {formatCreditsDisplay(record.creditsMicrocredits)} 积分
                        </div>
                        <div className="text-xs text-foreground/40">比例 1 元 = {(record.rateMilli / 1000).toFixed(record.rateMilli % 1000 === 0 ? 0 : 3)} 积分</div>
                    </div>
                </article>
            ))}
            <SimplePagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} loading={loading} onChange={setPage} />
        </div>
    );
}

export function formatCreditsDisplay(microcredits: number) {
    const value = microcredits / 1_000_000;
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function EmptyHint({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
    return (
        <div className="invite-empty">
            <span className="invite-empty-icon">{icon}</span>
            <div className="invite-empty-title">{title}</div>
            <div className="invite-empty-description">{body}</div>
        </div>
    );
}

function ListReadError({ message, retry }: { message: string; retry: () => void }) {
    return (
        <div className="invite-read-error" role="alert">
            <span>
                <CircleAlert className="size-4 text-destructive" />
                {message}
            </span>
            <Button icon={<RefreshCw className="size-4" />} onClick={retry}>
                重试
            </Button>
        </div>
    );
}

function SimplePagination({ page, pageSize, total, loading, onChange }: { page: number; pageSize: number; total: number; loading: boolean; onChange: (page: number) => void }) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (total <= 0) return null;
    return (
        <div className="flex items-center justify-end gap-3 pt-1 text-xs text-foreground/45">
            <span>
                第 {page} / {totalPages} 页
            </span>
            <Button size="small" disabled={page <= 1 || loading} onClick={() => onChange(page - 1)}>
                上一页
            </Button>
            <Button size="small" disabled={page >= totalPages || loading} onClick={() => onChange(page + 1)}>
                下一页
            </Button>
        </div>
    );
}

const emptyAccount: WithdrawAccountInfo = {};

function WithdrawModal({ open, policy, availableMicroYuan, onClose, onDone }: { open: boolean; policy: InviteOverview["policy"] | null; availableMicroYuan: number; onClose: () => void; onDone: () => void }) {
    const { message } = App.useApp();
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState<WithdrawMethod>("wechat");
    const [info, setInfo] = useState<WithdrawAccountInfo>(emptyAccount);
    const [saveAccount, setSaveAccount] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [prefilled, setPrefilled] = useState(false);
    const submittingRef = useRef(false);

    useEffect(() => {
        if (!open) {
            setAmount("");
            setInfo(emptyAccount);
            setSaveAccount(false);
            setPrefilled(false);
            return;
        }
        const controller = new AbortController();
        getMyWithdrawAccount(controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                if (result.account) {
                    setMethod(result.account.method);
                    setInfo(result.account.info);
                    setSaveAccount(true);
                }
                setPrefilled(true);
            })
            .catch(() => {
                if (!controller.signal.aborted) setPrefilled(true);
            });
        return () => controller.abort();
    }, [open]);

    useEffect(() => {
        if (!open || !policy) return;
        if (policy.withdrawMethods.length && !policy.withdrawMethods.includes(method)) {
            setMethod(policy.withdrawMethods[0]);
        }
    }, [open, policy, method]);

    const availableYuan = formatMicroYuan(availableMicroYuan);
    const amountState = rewardAmountState(amount, availableMicroYuan, policy?.withdrawMinFen ?? 1);
    const { amountFen, belowMin, overBalance } = amountState;
    const feeBp = policy?.withdrawFeeBp ?? 0;
    const feeMicro = amountFen ? Math.floor((amountFen * 10_000 * feeBp) / 10_000) : 0;
    const actualMicro = amountFen ? amountFen * 10_000 - feeMicro : 0;
    const accountError = withdrawalAccountError(method, info);
    const canSubmit = Boolean(policy?.withdrawEnabled && policy.withdrawMethods.includes(method) && amountState.valid && !accountError && !submitting && prefilled);

    const submit = async () => {
        if (!canSubmit || !amountFen || submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            await createWithdrawal({ amountFen, method, account: info, saveAccount });
            window.dispatchEvent(new CustomEvent("invite:withdrawals-updated"));
            message.success("提现申请已提交，等待管理员审核");
            onDone();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提交提现申请失败");
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    const updateInfo = (patch: Partial<WithdrawAccountInfo>) => setInfo((current) => ({ ...current, ...patch }));

    return (
        <AppModal open={open} flush className="invite-modal" onCancel={onClose} title={null} footer={null} centered width={460}>
            <div className="invite-modal-content">
                <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                        <HandCoins className="size-4" />
                        申请提现
                    </span>
                    <span className="text-xs text-foreground/45">当前可用余额 ¥ {availableYuan}</span>
                </div>

                <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground/60">提现金额（元）</span>
                    <div className="invite-modal-amount">
                        <Input size="large" inputMode="decimal" placeholder={`最低 ${((policy?.withdrawMinFen ?? 100) / 100).toFixed(2)}`} value={amount} onChange={(event) => setAmount(event.target.value)} />
                        <Button onClick={() => setAmount(spendableRewardYuan(availableMicroYuan))} disabled={availableMicroYuan < 10_000}>
                            全部
                        </Button>
                    </div>
                    {belowMin ? <span className="text-xs text-destructive">单次提现不低于 {((policy?.withdrawMinFen ?? 100) / 100).toFixed(2)} 元</span> : null}
                    {overBalance ? <span className="text-xs text-destructive">金额超过当前可用余额</span> : null}
                    {amount && amountFen === null ? <span className="text-xs text-destructive">请输入大于零且最多两位小数的金额</span> : null}
                </label>

                <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground/60">提现方式</span>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="提现方式">
                        {(policy?.withdrawMethods ?? []).map((candidate) => (
                            <button
                                key={candidate}
                                type="button"
                                role="radio"
                                aria-checked={method === candidate}
                                onClick={() => setMethod(candidate)}
                                className={cn("rounded-xl border px-3 py-2.5 text-sm transition-colors", method === candidate ? "border-primary bg-primary/5 font-medium text-primary" : "border-border/60 text-foreground/60 hover:border-foreground/25")}
                            >
                                {withdrawMethodLabel(candidate)}
                            </button>
                        ))}
                    </div>
                </div>

                {method === "wechat" || method === "alipay" ? (
                    <>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-foreground/60">{method === "wechat" ? "微信绑定的手机号" : "支付宝账号（手机号或邮箱）"}</span>
                            <Input prefix={<Smartphone className="size-4 text-foreground/30" />} value={info.account ?? ""} onChange={(event) => updateInfo({ account: event.target.value })} placeholder="收款账号" />
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-foreground/60">{method === "wechat" ? "微信实名认证的真实姓名" : "支付宝实名姓名"}</span>
                            <Input value={info.realName ?? ""} onChange={(event) => updateInfo({ realName: event.target.value })} placeholder="实名姓名" />
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-foreground/60">收款码链接（选填）</span>
                            <Input value={info.qrCodeUrl ?? ""} onChange={(event) => updateInfo({ qrCodeUrl: event.target.value })} placeholder="开启了手机号转账则无需填写" />
                        </label>
                    </>
                ) : (
                    <>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-foreground/60">开户行</span>
                            <Input value={info.bankName ?? ""} onChange={(event) => updateInfo({ bankName: event.target.value })} placeholder="例如：中国工商银行北京分行" />
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-foreground/60">银行卡号</span>
                            <Input value={info.cardNumber ?? ""} onChange={(event) => updateInfo({ cardNumber: event.target.value.replace(/\s/g, "") })} placeholder="储蓄卡卡号" />
                        </label>
                        <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-foreground/60">持卡人姓名</span>
                            <Input value={info.holderName ?? ""} onChange={(event) => updateInfo({ holderName: event.target.value })} placeholder="持卡人真实姓名" />
                        </label>
                    </>
                )}

                <div className="invite-modal-summary">
                    <span className="text-foreground/55">手续费（{ratePercent(feeBp)}）</span>
                    <span className="font-mono tabular-nums">
                        ¥ {formatMicroYuan(feeMicro)} · 实到 <b>¥ {formatMicroYuan(actualMicro)}</b>
                    </span>
                </div>
                {accountError ? (
                    <p className="text-xs text-foreground/50" role="status">
                        {accountError}
                    </p>
                ) : null}

                <label className="flex items-center justify-between text-sm text-foreground/60">
                    <span>保存收款信息，下次自动填写</span>
                    <Switch size="small" checked={saveAccount} onChange={setSaveAccount} />
                </label>

                <Button type="primary" size="large" block loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>
                    提交提现申请
                </Button>
            </div>
        </AppModal>
    );
}

function TransferModal({ open, policy, availableMicroYuan, onClose, onDone }: { open: boolean; policy: InviteOverview["policy"] | null; availableMicroYuan: number; onClose: () => void; onDone: () => void }) {
    const { message } = App.useApp();
    const [amount, setAmount] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);

    useEffect(() => {
        if (!open) setAmount("");
    }, [open]);

    const rateMilli = policy?.transferRateMilli ?? 1000;
    const amountState = rewardAmountState(amount, availableMicroYuan, policy?.transferMinFen ?? 1);
    const { amountFen, belowMin, overBalance } = amountState;
    const credits = amountFen ? Math.floor((amountFen * 10_000 * rateMilli) / 1000) : 0;
    const canSubmit = Boolean(policy?.transferEnabled && amountState.valid && credits > 0 && !submitting);

    const submit = async () => {
        if (!canSubmit || !amountFen || submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            await createTransfer({ amountFen });
            window.dispatchEvent(new CustomEvent("invite:transfers-updated"));
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success("划转成功，积分已到账");
            onDone();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "划转失败");
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };

    return (
        <AppModal open={open} flush className="invite-modal" onCancel={onClose} title={null} footer={null} centered width={420}>
            <div className="invite-modal-content">
                <div className="flex flex-col gap-1">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                        <ArrowLeftRight className="size-4" />
                        奖励划转积分
                    </span>
                    <span className="text-xs text-foreground/45">
                        1 元 = {(rateMilli / 1000).toFixed(rateMilli % 1000 === 0 ? 0 : 3)} 积分 · 可用余额 ¥ {formatMicroYuan(availableMicroYuan)}
                    </span>
                </div>
                <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground/60">划转金额（元）</span>
                    <div className="invite-modal-amount">
                        <Input size="large" inputMode="decimal" placeholder={`最低 ${((policy?.transferMinFen ?? 100) / 100).toFixed(2)}`} value={amount} onChange={(event) => setAmount(event.target.value)} />
                        <Button onClick={() => setAmount(spendableRewardYuan(availableMicroYuan))} disabled={availableMicroYuan < 10_000}>
                            全部
                        </Button>
                    </div>
                    {belowMin ? <span className="text-xs text-destructive">单次划转不低于 {((policy?.transferMinFen ?? 100) / 100).toFixed(2)} 元</span> : null}
                    {overBalance ? <span className="text-xs text-destructive">金额超过当前可用余额</span> : null}
                    {amount && amountFen === null ? <span className="text-xs text-destructive">请输入大于零且最多两位小数的金额</span> : null}
                </label>
                <div className="invite-modal-summary">
                    <span className="text-foreground/55">预计到账</span>
                    <span className="font-mono font-semibold tabular-nums">{formatCreditsDisplay(credits)} 积分</span>
                </div>
                <Button type="primary" size="large" block loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>
                    确认划转
                </Button>
            </div>
        </AppModal>
    );
}
