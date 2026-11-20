import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { BadgeCheck, Plus, RefreshCw, Search, Sparkles, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { Select } from "@/components/ui/base/select";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { StatusBadge } from "@/components/ui/base/badges";
import { formatCredits } from "@/constant/credits";
import { currentLocale } from "@/i18n";
import { useArkLibraryReconcile } from "@/hooks/use-ark-library-reconcile";
import { ARK_GROUP_KINDS, arkGroupLimit, arkGroupPrice, arkGroupQuotaLeft, arkKindEnabled, arkLibraryProgressMap, arkReviewRequired, formatArkDate, formatArkTime } from "@/lib/ark-assets";
import { cn } from "@/lib/utils";
import { arkPortraitOverviewQueryKey, getArkPortraitOverview, type ArkGroupKind, type ArkPortraitGroup, type ArkPortraitSession } from "@/services/api/ark-portraits";

import { ArkGroupDetail } from "./ark-group-detail";
import { ArkRealGroupComposer, ArkVirtualGroupComposer } from "./ark-group-create";
import "./ark-assets-pane.css";

type ScopeFilter = "owned" | "granted";
type ExpiryFilter = "all" | "valid" | "expiring" | "expired";
type Composer = { kind: "real"; resume?: ArkPortraitSession } | { kind: "virtual" } | null;

const KIND_ICONS: Record<ArkGroupKind, ReactNode> = {
    real: <UserRoundCheck aria-hidden />,
    virtual: <Sparkles aria-hidden />,
    ip: <BadgeCheck aria-hidden />,
};

/** 设置页「方舟素材库」：按真人 / 虚拟 / 版权 IP 管理素材组，真人认证在页面内原位完成，不使用抽屉。 */
export function ArkAssetsPane() {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const [kind, setKind] = useState<ArkGroupKind>("real");
    const [scope, setScope] = useState<ScopeFilter>("owned");
    const [keyword, setKeyword] = useState("");
    const [expiry, setExpiry] = useState<ExpiryFilter>("all");
    const [selectedId, setSelectedId] = useState("");
    const [composer, setComposer] = useState<Composer>(null);

    const overviewQuery = useQuery({
        queryKey: arkPortraitOverviewQueryKey,
        queryFn: ({ signal }) => getArkPortraitOverview(signal),
        // 有方舟审核中的素材时定时刷新；平台审核需要等管理员处理，不做高频轮询。
        refetchInterval: (query) => (query.state.data?.groups.some((group) => group.owned && group.assets.some((asset) => asset.status === "processing")) ? 6_000 : false),
    });
    const overview = overviewQuery.data;
    useArkLibraryReconcile(overview);
    const progress = useMemo(() => arkLibraryProgressMap(overview), [overview]);
    const refresh = () => queryClient.invalidateQueries({ queryKey: arkPortraitOverviewQueryKey });

    const kindGroups = useMemo(() => (overview?.groups || []).filter((group) => group.kind === kind), [kind, overview?.groups]);
    const effectiveScope: ScopeFilter = kind === "ip" ? "granted" : scope;
    const scopedGroups = kindGroups.filter((group) => (effectiveScope === "owned" ? group.owned : !group.owned));
    const query = keyword.trim().toLowerCase();
    const visibleGroups = scopedGroups.filter((group) => {
        if (query && !group.name.toLowerCase().includes(query) && !group.groupId.toLowerCase().includes(query)) return false;
        if (kind === "real" && expiry !== "all" && group.expiryStatus !== expiry) return false;
        return true;
    });
    const selected = kindGroups.find((group) => group.id === selectedId);

    useEffect(() => {
        if (composer || (selected && visibleGroups.some((group) => group.id === selected.id))) return;
        setSelectedId(visibleGroups[0]?.id || "");
        // 只在分组切换或列表变化时重新选择；visibleGroups 每次渲染都是新数组，按 ID 串比较。
    }, [composer, selected?.id, visibleGroups.map((group) => group.id).join(",")]);

    const selectKind = (next: ArkGroupKind) => {
        setKind(next);
        setComposer(null);
        setSelectedId("");
        setKeyword("");
        setExpiry("all");
        setScope("owned");
    };

    if (overviewQuery.isLoading) {
        return (
            <div className="ark-pane">
                <PaneHeader />
                <div className="ark-pane-loading" role="status">
                    {t("library.ark.loading")}
                </div>
            </div>
        );
    }
    if (overviewQuery.isError && !overview) {
        return (
            <div className="ark-pane">
                <PaneHeader />
                <WorkspaceErrorState
                    compact
                    title={t("library.ark.loadFailed")}
                    description={overviewQuery.error instanceof Error ? overviewQuery.error.message : undefined}
                    onRetry={() => void overviewQuery.refetch()}
                    actionLabel={t("library.ark.retry")}
                />
            </div>
        );
    }
    if (!overview?.enabled) {
        return (
            <div className="ark-pane">
                <PaneHeader />
                <WorkspaceState compact icon="assets" title={t("library.ark.disabledTitle")} description={t("library.ark.disabledDescription")} />
            </div>
        );
    }

    const config = overview.config;
    const price = arkGroupPrice(config, kind);
    const quotaLeft = arkGroupQuotaLeft(overview, kind);
    const kindEnabled = arkKindEnabled(config, kind);
    const pendingReview = kindGroups.reduce((sum, group) => sum + (group.owned ? group.assets.filter((asset) => asset.status === "pending_review").length : 0), 0);
    const processing = kindGroups.reduce((sum, group) => sum + (group.owned ? group.assets.filter((asset) => asset.status === "processing").length : 0), 0);
    const createDisabledReason = !kindEnabled ? t("library.ark.create.disabled") : quotaLeft <= 0 ? t("library.ark.create.limitReached", { limit: arkGroupLimit(config, kind) }) : "";
    const pendingSessions = kind === "real" ? overview.sessions : [];

    const openComposer = () => {
        if (kind === "real") setComposer({ kind: "real" });
        else if (kind === "virtual") setComposer({ kind: "virtual" });
        setSelectedId("");
    };

    const afterCreated = async (arkGroupId: string) => {
        setComposer(null);
        setScope("owned");
        const next = await queryClient.fetchQuery({ queryKey: arkPortraitOverviewQueryKey, queryFn: ({ signal }) => getArkPortraitOverview(signal) });
        const created = next.groups.find((group) => group.groupId === arkGroupId);
        if (created) setSelectedId(created.id);
    };

    return (
        <div className="ark-pane">
            <PaneHeader
                action={
                    <Button icon={<RefreshCw className="size-4" />} loading={overviewQuery.isFetching} onClick={() => void refresh()}>
                        {t("library.ark.refresh")}
                    </Button>
                }
            />

            <div className="ark-pane-kinds" role="tablist" aria-label={t("library.ark.title")}>
                {ARK_GROUP_KINDS.map((item) => {
                    const count = (overview.groups || []).filter((group) => group.kind === item).length;
                    return (
                        <button key={item} type="button" role="tab" aria-selected={kind === item} className={cn("ark-pane-kind", kind === item && "is-active")} onClick={() => selectKind(item)}>
                            <span className="ark-pane-kind-icon">{KIND_ICONS[item]}</span>
                            <span className="ark-pane-kind-copy">
                                <strong>{t(`library.ark.kinds.${item}`)}</strong>
                                <span>{t(`library.ark.kindHints.${item}`)}</span>
                            </span>
                            <span className="ark-pane-kind-count">{count}</span>
                        </button>
                    );
                })}
            </div>

            {kind !== "ip" ? (
                <div className="ark-pane-summary" aria-live="polite">
                    <StatusBadge
                        size="sm"
                        tone={kindEnabled ? "success" : "neutral"}
                        label={kindEnabled ? t("library.ark.summary.usage", { used: arkGroupLimit(config, kind) - quotaLeft, limit: arkGroupLimit(config, kind) }) : t("library.ark.create.disabled")}
                    />
                    <StatusBadge size="sm" tone="neutral" label={price > 0 ? t("library.ark.summary.fee", { price: formatCredits(price) }) : t("library.ark.summary.free")} />
                    <StatusBadge size="sm" tone="neutral" label={arkReviewRequired(config, kind) ? t("library.ark.summary.review") : t("library.ark.summary.noReview")} />
                    {pendingReview ? <StatusBadge size="sm" tone="warning" label={t("library.ark.summary.pendingReview", { count: pendingReview })} /> : null}
                    {processing ? <StatusBadge size="sm" tone="loading" label={t("library.ark.summary.processing", { count: processing })} /> : null}
                </div>
            ) : null}

            <div className="ark-pane-body">
                <aside className="ark-pane-list" aria-label={t(`library.ark.kinds.${kind}`)}>
                    {kind !== "ip" ? (
                        <SegmentedControl<ScopeFilter>
                            block
                            size="sm"
                            ariaLabel={t(`library.ark.kinds.${kind}`)}
                            value={scope}
                            onChange={(value) => {
                                setScope(value);
                                setComposer(null);
                                setSelectedId("");
                            }}
                            options={[
                                { value: "owned", label: `${t("library.ark.scope.owned")} ${kindGroups.filter((group) => group.owned).length}` },
                                { value: "granted", label: `${t("library.ark.scope.granted")} ${kindGroups.filter((group) => !group.owned).length}` },
                            ]}
                        />
                    ) : null}
                    <Input
                        allowClear
                        value={keyword}
                        prefix={<Search className="size-4 text-foreground/40" />}
                        placeholder={t("library.ark.searchPlaceholder")}
                        aria-label={t("library.ark.searchPlaceholder")}
                        onChange={(event) => setKeyword(event.target.value)}
                    />
                    {kind === "real" ? (
                        <Select
                            ariaLabel={t("library.ark.expiry.all")}
                            value={expiry}
                            onChange={(value) => setExpiry(value as ExpiryFilter)}
                            options={(["all", "valid", "expiring", "expired"] as const).map((value) => ({ value, label: t(`library.ark.expiry.${value}`) }))}
                        />
                    ) : null}
                    {kind !== "ip" && effectiveScope === "owned" ? (
                        <Button type="primary" block icon={<Plus className="size-4" />} disabled={Boolean(createDisabledReason)} title={createDisabledReason || undefined} onClick={openComposer}>
                            {t(`library.ark.create.${kind}`)}
                        </Button>
                    ) : null}
                    {createDisabledReason && kind !== "ip" && effectiveScope === "owned" ? <p className="ark-pane-list-note">{createDisabledReason}</p> : null}

                    {pendingSessions.length && effectiveScope === "owned" ? (
                        <section className="ark-pane-sessions" aria-label={t("library.ark.realFlow.pendingTitle")}>
                            <span className="ark-pane-list-heading">{t("library.ark.realFlow.pendingTitle")}</span>
                            {pendingSessions.map((session) => (
                                <button
                                    key={session.id}
                                    type="button"
                                    className={cn("ark-pane-session-item", composer?.kind === "real" && composer.resume?.id === session.id && "is-active")}
                                    onClick={() => {
                                        setSelectedId("");
                                        setComposer({ kind: "real", resume: session });
                                    }}
                                >
                                    <span className="ark-pane-dot is-pending" aria-hidden />
                                    <span>{t("library.ark.realFlow.pendingItem", { name: session.name, time: formatArkTime(session.expiresAt, currentLocale()) })}</span>
                                </button>
                            ))}
                        </section>
                    ) : null}

                    <div className="ark-pane-groups" role="list">
                        {visibleGroups.map((group) => (
                            <GroupListItem
                                key={group.id}
                                group={group}
                                active={!composer && group.id === selected?.id}
                                onSelect={() => {
                                    setComposer(null);
                                    setSelectedId(group.id);
                                }}
                            />
                        ))}
                        {!visibleGroups.length ? (
                            <p className="ark-pane-list-empty">
                                {query || expiry !== "all" ? t("library.ark.empty.noMatch") : kind === "ip" ? t("library.ark.empty.ip") : effectiveScope === "owned" ? t("library.ark.empty.owned") : t("library.ark.empty.granted")}
                            </p>
                        ) : null}
                    </div>
                </aside>

                <section className="ark-pane-main">
                    {composer?.kind === "real" ? (
                        <ArkRealGroupComposer key={composer.resume?.id || "new"} config={config} resume={composer.resume} onCancel={() => setComposer(null)} onSessionsChanged={() => void refresh()} onVerified={(groupId) => void afterCreated(groupId)} />
                    ) : composer?.kind === "virtual" ? (
                        <ArkVirtualGroupComposer config={config} onCancel={() => setComposer(null)} onCreated={(groupId) => void afterCreated(groupId)} />
                    ) : selected ? (
                        <ArkGroupDetail key={selected.id} group={selected} config={config} progress={progress} onChanged={refresh} onDeleted={() => setSelectedId("")} />
                    ) : (
                        <WorkspaceState
                            compact
                            icon="assets"
                            title={kind === "ip" ? t("library.ark.empty.ip") : t("library.ark.empty.select")}
                            description={t(`library.ark.kindHints.${kind}`)}
                            action={
                                kind !== "ip" && effectiveScope === "owned" && !createDisabledReason ? (
                                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openComposer}>
                                        {t(`library.ark.create.${kind}`)}
                                    </Button>
                                ) : undefined
                            }
                        />
                    )}
                </section>
            </div>
        </div>
    );
}

function PaneHeader({ action }: { action?: ReactNode }) {
    const { t } = useTranslation();
    return (
        <div className="settings-pane-header">
            <div className="min-w-0">
                <h2>{t("settings.sections.ark-assets.label")}</h2>
                <p>{t("library.ark.description")}</p>
            </div>
            {action}
        </div>
    );
}

function GroupListItem({ group, active, onSelect }: { group: ArkPortraitGroup; active: boolean; onSelect: () => void }) {
    const { t } = useTranslation();
    const approved = group.assets.filter((asset) => asset.status === "active").length;
    const expiryTone = group.expiryStatus === "expired" ? "is-expired" : group.expiryStatus === "expiring" ? "is-expiring" : "is-valid";
    return (
        <button type="button" role="listitem" aria-current={active ? "true" : undefined} className={cn("ark-pane-group", active && "is-active", !group.available && "is-unavailable")} onClick={onSelect}>
            <span className="ark-pane-group-name" title={group.name}>
                {group.name}
            </span>
            <span className="ark-pane-group-meta">
                <span>{t("library.ark.group.assetCount", { count: approved })}</span>
                {group.expiresAt ? (
                    <span className={cn("ark-pane-expiry", expiryTone)}>{group.expiryStatus === "expired" ? t("library.ark.expiry.expired") : t("library.ark.expiry.until", { date: formatArkDate(group.expiresAt, currentLocale()) })}</span>
                ) : null}
                {!group.owned ? <span className="ark-pane-tag">{t("library.ark.group.platform")}</span> : null}
            </span>
        </button>
    );
}
