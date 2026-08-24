import { useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Grid, Input, Segmented, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, Coins, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, TicketCheck } from "lucide-react";
import i18next from "i18next";

import { formatCredits } from "@/constant/credits";
import { PaginationBar, TableSurface } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { checkinCredits, getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { modelDisplayName, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useTranslation } from "react-i18next";
import { t as translate } from "@/i18n";

type LedgerFilter = "all" | "income" | "consume" | "refund";

export default function WalletPage() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const screens = Grid.useBreakpoint();
    const reducedMotion = useReducedMotion();
    const config = useEffectiveConfig();
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [code, setCode] = useState("");
    const [filter, setFilter] = useState<LedgerFilter>("all");
    const [loading, setLoading] = useState(false);
    const [redeeming, setRedeeming] = useState(false);
    const [checkingIn, setCheckingIn] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const requestSequence = useRef(0);
    const ledgerFilterOptions = [
        { label: t("wallet:all"), value: "all" },
        { label: t("wallet:top-ups-and-adjustments"), value: "income" },
        { label: t("wallet:model-usage"), value: "consume" },
        { label: t("wallet:refunds"), value: "refund" },
    ];

    const reload = async (targetPage = page, targetPageSize = pageSize) => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        try {
            const nextWallet = await getWallet(targetPage, targetPageSize, filter);
            if (sequence === requestSequence.current) setWallet(nextWallet);
        } catch (error) {
            if (sequence === requestSequence.current) message.error(error instanceof Error ? error.message : t("wallet:failed-to-load-credit-history"));
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        void reload(page, pageSize);
    }, [filter, page, pageSize]);

    const redeem = async () => {
        const normalized = code.trim().toLowerCase();
        if (normalized.length !== 32) {
            message.error(t("wallet:enter-the-full-32-character-redeem-code"));
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            setPage(1);
            await reload(1, pageSize);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success(t("wallet:redeemed-credits-added"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("wallet:redemption-failed"));
        } finally {
            setRedeeming(false);
        }
    };

    const checkin = async () => {
        setCheckingIn(true);
        try {
            await checkinCredits();
            await reload(page, pageSize);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            message.success(t("wallet:checked-in-credits-added"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("wallet:check-in-failed"));
        } finally {
            setCheckingIn(false);
        }
    };

    const entries = wallet?.entries || [];
    const account = wallet?.account;
    const totalMicrocredits = (account?.availableMicrocredits || 0) + (account?.reservedMicrocredits || 0);

    const columns: ColumnsType<CreditLedgerEntry> = [
        { title: t("wallet:occurred-at"), dataIndex: "createdAt", width: 180, render: formatTime },
        { title: t("wallet:type"), dataIndex: "type", width: 120, render: (type) => <LedgerTypeTag type={type} /> },
        {
            title: t("wallet:details"),
            width: 400,
            ellipsis: true,
            render: (_, entry) => (
                <div className="min-w-0 max-w-full overflow-hidden" title={[ledgerModelName(config, entry), [sceneLabel(entry.scene), entry.note].filter(Boolean).join(" · ")].filter(Boolean).join("\n")}>
                    <div className="truncate font-medium">{ledgerModelName(config, entry)}</div>
                    <div className="mt-1 truncate text-xs text-foreground/50">{[sceneLabel(entry.scene), entry.note].filter(Boolean).join(" · ") || t("wallet:no-notes")}</div>
                </div>
            ),
        },
        {
            title: t("wallet:credit-change"),
            dataIndex: "amountMicrocredits",
            width: 145,
            align: "right",
            render: (value: number) => <CreditDelta value={value} />,
        },
        { title: t("wallet:balance-after-change"), dataIndex: "availableAfterMicrocredits", width: 145, align: "right", render: (value) => <span className="tabular-nums">{formatCredits(value)}</span> },
    ];

    return (
        <main className="app-user-content app-workspace-scroll library-page wallet-library-page relative h-full overflow-y-auto text-foreground">
            <div className="relative w-full px-4 py-6 sm:px-6 lg:px-8">
                <div className="studio-band">
                    <motion.header
                        initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="app-page-header flex flex-wrap items-start justify-between gap-4"
                    >
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="min-w-0">
                                <h1 className="text-[var(--fs-heading-lg)] font-semibold leading-7">{t("wallet:credits-center")}</h1>
                                <p className="mt-1 text-xs leading-5 text-foreground/58">{t("wallet:model-calls-freezes-and-refunds-share-one-traceable-ledger")}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="app-projects-header-meta wallet-credit-meta">
                                <Coins className="size-3" />
                                {t("wallet:available")} {formatCredits(account?.availableMicrocredits || 0, 6)}
                            </span>
                            <Button
                                className="library-primary-action"
                                icon={<CalendarCheck className="size-4" />}
                                type={wallet?.policy.checkedInToday ? "default" : "primary"}
                                loading={checkingIn}
                                disabled={wallet?.policy.checkedInToday}
                                onClick={() => void checkin()}
                            >
                                {wallet?.policy.checkedInToday ? t("wallet:already-checked-in-today") : t("wallet:check-in-with-bonus", { amount: formatCredits(wallet?.policy.checkinBonusMicrocredits || 0) })}
                            </Button>
                            <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                                {t("wallet:refresh-balance")}
                            </Button>
                        </div>
                    </motion.header>
                </div>

                <section className="library-feature-grid mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
                    <section className="credit-balance-card">
                        <div className="wallet-balance-inner">
                            <div className="wallet-balance-primary">
                                <div className="wallet-balance-heading">
                                    <span className="library-icon-tile wallet-balance-icon">
                                        <Coins />
                                    </span>
                                    <div>
                                        <strong>{t("wallet:available-creative-credits")}</strong>
                                        <span>
                                            {t("wallet:recently-updated")} {formatTime(account?.updatedAt)}
                                        </span>
                                    </div>
                                </div>
                                <div className="wallet-balance-number">
                                    <strong>{formatCredits(account?.availableMicrocredits || 0, 6)}</strong>
                                    <span>{t("wallet:credits")}</span>
                                </div>
                            </div>
                            <div className="wallet-balance-details">
                                <span className="wallet-account-status">
                                    <ShieldCheck />
                                    {t("wallet:account-healthy")}
                                </span>
                                <BalanceMetric label={t("wallet:frozen-credits")} description={t("wallet:in-use-or-under-review")} value={account?.reservedMicrocredits || 0} icon={<TicketCheck className="size-4" />} />
                                <BalanceMetric label={t("wallet:total-balance")} description={t("wallet:available-plus-frozen")} value={totalMicrocredits} icon={<Coins className="size-4" />} />
                            </div>
                        </div>
                    </section>

                    <motion.div
                        initial={reducedMotion ? false : { opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="wallet-redeem-panel app-workspace-surface flex flex-col rounded-lg p-5 backdrop-blur-xl sm:p-6"
                    >
                        <div className="flex items-start gap-3">
                            <span className="wallet-redeem-icon grid size-9 shrink-0 place-items-center rounded-lg">
                                <TicketCheck className="size-4" />
                            </span>
                            <div>
                                <h2 className="text-base font-semibold">{t("wallet:redeem-credits-2")}</h2>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">{t("wallet:enter-the-32-character-code-issued-by-an-admin")}</p>
                            </div>
                        </div>
                        <label className="mt-6 block">
                            <span className="text-xs font-medium text-foreground/70">{t("wallet:redemption-codes")}</span>
                            <Input
                                className="mt-2 font-mono"
                                size="large"
                                value={code}
                                maxLength={32}
                                spellCheck={false}
                                autoComplete="off"
                                onChange={(event) => setCode(event.target.value.replace(/[-\s]/g, ""))}
                                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                onPressEnter={() => void redeem()}
                            />
                        </label>
                        <div className="mt-2 flex items-center justify-between text-xs text-foreground/45">
                            <span>{t("wallet:credits-arrive-immediately-after-redemption")}</span>
                            <span className="tabular-nums">{code.length} / 32</span>
                        </div>
                        <Button className="mt-5" type="primary" size="large" block loading={redeeming} disabled={code.length !== 32} onClick={() => void redeem()}>
                            {t("wallet:redeem-credits-2")}
                        </Button>
                    </motion.div>
                </section>

                <section className="wallet-ledger-panel app-workspace-surface mt-9 rounded-lg p-4 backdrop-blur-xl sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 className="text-base font-semibold">{t("wallet:credit-ledger")}</h2>
                            <p className="mt-1 text-xs text-foreground/55">
                                {t("wallet:showing-the-latest")} {wallet?.entries.length || 0} {t("wallet:entries")}
                            </p>
                        </div>
                        <Segmented
                            block={!screens.sm}
                            value={filter}
                            options={ledgerFilterOptions}
                            onChange={(value) => {
                                setFilter(value as LedgerFilter);
                                setPage(1);
                            }}
                        />
                    </div>

                    {screens.md ? (
                        <TableSurface className="mt-0 rounded-xl border-border/70 bg-transparent">
                            <Table className="app-data-table wallet-ledger-table" rowKey="id" size="middle" loading={loading} columns={columns} dataSource={entries} pagination={false} tableLayout="fixed" scroll={{ x: 990 }} />
                        </TableSurface>
                    ) : (
                        <div className="grid gap-1 overflow-hidden rounded-md bg-transparent">
                            {entries.length ? (
                                entries.map((entry) => <LedgerMobileRow key={entry.id} config={config} entry={entry} />)
                            ) : (
                                <WorkspaceState compact icon="wallet" title={t("wallet:no-matching-credit-records")} description={t("wallet:switch-ledger-type-or-come-back-after-your-next-generation")} />
                            )}
                        </div>
                    )}
                    <PaginationBar
                        current={page}
                        pageSize={pageSize}
                        total={wallet?.total || 0}
                        pageSizeOptions={[20, 50, 100]}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                </section>
            </div>
        </main>
    );
}

function BalanceMetric({ label, description, value, icon }: { label: string; description: string; value: number; icon: ReactNode }) {
    return (
        <div className="wallet-balance-metric">
            <span className="wallet-balance-metric-icon">{icon}</span>
            <div>
                <span>{label}</span>
                <strong>{formatCredits(value, 6)}</strong>
                <small>{description}</small>
            </div>
        </div>
    );
}

function LedgerMobileRow({ config, entry }: { config: AiConfig; entry: CreditLedgerEntry }) {
    const meta = ledgerTypeMeta(entry.type);
    return (
        <article className="flex items-start gap-3 rounded-md bg-foreground/[.025] px-4 py-4">
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${meta.iconClass}`}>{meta.icon}</span>
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{ledgerModelName(config, entry)}</div>
                        <div className="mt-1 text-xs text-foreground/45">{formatTime(entry.createdAt)}</div>
                    </div>
                    <CreditDelta value={entry.amountMicrocredits} />
                </div>
                <div className="mt-2 line-clamp-2 break-words text-xs leading-5 text-foreground/55">{[sceneLabel(entry.scene), entry.note].filter(Boolean).join(" · ") || meta.label}</div>
            </div>
        </article>
    );
}

function CreditDelta({ value }: { value: number }) {
    const colorClass = value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground/60";
    return (
        <span className={`shrink-0 font-medium tabular-nums ${colorClass}`}>
            {value > 0 ? "+" : ""}
            {formatCredits(value, 6)}
        </span>
    );
}

function LedgerTypeTag({ type }: { type: CreditLedgerEntry["type"] }) {
    const meta = ledgerTypeMeta(type);
    return (
        <Tag variant="filled" color={meta.tagColor}>
            {meta.label}
        </Tag>
    );
}

function ledgerTypeMeta(type: CreditLedgerEntry["type"]) {
    const values = {
        redeem: { label: translate("wallet:redemption-top-up"), tagColor: "default", icon: <ArrowDownLeft className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        admin_grant: { label: translate("wallet:admin-top-up"), tagColor: "default", icon: <ArrowDownLeft className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        consume: { label: translate("wallet:model-usage"), tagColor: "error", icon: <Sparkles className="size-4" />, iconClass: "bg-rose-500/10 text-rose-600 dark:text-rose-300" },
        reserve: { label: translate("wallet:credit-freeze"), tagColor: "warning", icon: <ArrowUpRight className="size-4" />, iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
        refund: { label: translate("wallet:usage-refund"), tagColor: "warning", icon: <RotateCcw className="size-4" />, iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-300" },
        admin_adjustment: { label: translate("wallet:admin-adjustment"), tagColor: "default", icon: <SlidersHorizontal className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        signup_bonus: { label: translate("wallet:sign-up-bonus"), tagColor: "default", icon: <Sparkles className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
        checkin_bonus: { label: translate("wallet:daily-check-in-bonus"), tagColor: "default", icon: <CalendarCheck className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" },
    } as const;
    return values[type] || { label: translate("wallet:other-credit-changes"), tagColor: "default", icon: <ArrowUpRight className="size-4" />, iconClass: "bg-foreground/8 text-foreground/70" };
}

function ledgerTitle(entry: CreditLedgerEntry) {
    if (entry.type === "redeem") return translate("wallet:redeem-code-top-up");
    if (entry.type === "refund") return translate("wallet:model-usage-refund");
    if (entry.type === "consume") return translate("wallet:model-call");
    if (entry.type === "signup_bonus") return translate("wallet:new-user-sign-up-bonus");
    if (entry.type === "checkin_bonus") return translate("wallet:daily-check-in-reward");
    return entry.note || translate("wallet:credit-adjustment");
}

function ledgerModelName(config: AiConfig, entry: CreditLedgerEntry) {
    return entry.model ? modelDisplayName(config, entry.model) : ledgerTitle(entry);
}

function sceneLabel(scene?: string) {
    const labels: Record<string, string> = { image: translate("wallet:image-generation"), text: translate("wallet:text-generation"), video: translate("wallet:video-generation"), audio: translate("wallet:audio-generation"), storyboard: translate("wallet:storyboard-generation") };
    return scene ? labels[scene] || translate("wallet:other-scenarios") : "";
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString(getLocale(), { hour12: false }) : "--";
}

function getLocale() {
    return i18next.resolvedLanguage || i18next.language || "en";
}
