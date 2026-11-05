import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowRight, ClipboardCheck, Copyright, FolderPlus, Plus, RefreshCw, Search, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { deleteAdminArkGroup, listAdminArkGroups, type ArkExpiryStatus, type ArkGroupKind, type ArkGroupScope, type ArkPortraitGroup, type ArkPortraitSession } from "@/services/api/ark-portraits";
import { AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "../../components/admin-ui";
import { Callout, Select, Tooltip } from "../../ui/controls";
import { ArkAdminCreateModal } from "./ark-admin-create-modal";
import { ArkAdminGroupDrawer } from "./ark-admin-group-drawer";
import { ARK_KIND_LABEL, ARK_SOURCE_LABEL, ArkExpiryBadge, arkGrantSummary, formatArkAdminDate } from "./ark-admin-shared";

type ExpiryFilter = Exclude<ArkExpiryStatus, "none">;

export const adminArkGroupsQueryKey = ["admin-ark-groups"] as const;

const ARK_KIND_ICON: Record<ArkGroupKind, LucideIcon> = { real: UserRound, virtual: Sparkles, ip: Copyright };

/** 全部素材组：用户自建与平台素材组统一管理；类型卡片即类型筛选，归属与授权状态在工具栏筛选。 */
export function ArkAdminGroupsTab({ onOpenReviews }: { onOpenReviews: () => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [kind, setKind] = useState<ArkGroupKind | "">("");
    const [scope, setScope] = useState<ArkGroupScope | "">("");
    const [expiry, setExpiry] = useState<ExpiryFilter | "">("");
    const [keyword, setKeyword] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [detailId, setDetailId] = useState<string | null>(null);
    const [creating, setCreating] = useState<{ resume?: ArkPortraitSession } | null>(null);
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const query = useQuery({
        queryKey: [...adminArkGroupsQueryKey, kind, scope, expiry, debouncedKeyword, page, pageSize],
        queryFn: ({ signal }) => listAdminArkGroups({ kind: kind || undefined, scope: scope || undefined, expiry: expiry || undefined, keyword: debouncedKeyword || undefined, page, pageSize }, signal),
        placeholderData: keepPreviousData,
    });
    const data = query.data;
    const filtered = Boolean(kind || scope || expiry || debouncedKeyword);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: adminArkGroupsQueryKey });
    const resetFilters = () => {
        setKind("");
        setScope("");
        setExpiry("");
        setKeyword("");
        setPage(1);
    };
    const toggleKind = (next: ArkGroupKind) => {
        setKind((current) => (current === next ? "" : next));
        setPage(1);
    };
    const showPagination = Boolean(data && (data.total > pageSize || page > 1));
    const stats = data?.stats;
    const pendingReview = data?.pendingReview ?? 0;

    const columns: ColumnsType<ArkPortraitGroup> = [
        {
            title: "素材组",
            key: "name",
            render: (_, group) => {
                const Icon = ARK_KIND_ICON[group.kind] || UserRound;
                return (
                    <div className="admin-ark-group-cell">
                        <span className="admin-ark-group-avatar" aria-hidden="true">
                            <Icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium" title={group.name}>
                                    {group.name}
                                </span>
                                {group.available === false ? <AdminStatusBadge label="不可用" tone="error" title="管理员已更换站点、Region 或项目，此素材组不能再使用" /> : null}
                            </div>
                            <div className="admin-ark-group-id" title={group.groupId}>
                                {group.groupId}
                            </div>
                        </div>
                    </div>
                );
            },
        },
        {
            title: "类型",
            key: "kind",
            width: 128,
            render: (_, group) => <ArkStackedCell primary={ARK_KIND_LABEL[group.kind]} secondary={ARK_SOURCE_LABEL[group.source] || group.source} />,
        },
        {
            title: "归属",
            key: "scope",
            width: 190,
            render: (_, group) =>
                group.scope === "platform" ? (
                    <ArkStackedCell primary="平台素材组" secondary={`授权：${arkGrantSummary(group)}`} />
                ) : (
                    <ArkStackedCell primary={group.owner?.displayName || group.owner?.username || "-"} secondary={group.owner?.displayName && group.owner.username ? group.owner.username : "用户自建"} />
                ),
        },
        {
            title: "素材",
            key: "assets",
            width: 150,
            render: (_, group) => {
                const counts = group.assetCounts || {};
                return (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="admin-ark-count">
                            <strong>{counts.active || 0}</strong> 张已通过
                        </span>
                        {counts.pending_review ? <AdminStatusBadge label={`${counts.pending_review} 待审`} tone="warning" /> : null}
                        {counts.processing ? <AdminStatusBadge label={`${counts.processing} 审核中`} tone="info" /> : null}
                    </div>
                );
            },
        },
        { title: "授权", key: "expiry", width: 180, render: (_, group) => <ArkExpiryBadge group={group} /> },
        { title: "创建时间", key: "createdAt", width: 112, render: (_, group) => <span className="admin-ark-muted">{formatArkAdminDate(group.createdAt)}</span> },
        {
            title: "操作",
            key: "actions",
            width: 120,
            render: (_, group) => (
                <AdminRowActions
                    primary={{ label: "查看", onClick: () => setDetailId(group.id) }}
                    actions={[
                        {
                            key: "delete",
                            label: "删除",
                            danger: true,
                            confirm: { title: `删除素材组「${group.name}」？`, description: "会同时删除方舟侧的素材组和组内全部素材，用户素材库中已认证的图片会取消认证并恢复原分类。已支付的建组费用不退还。", okText: "删除素材组" },
                            onClick: async () => {
                                try {
                                    await deleteAdminArkGroup(group.id);
                                    message.success("素材组已删除");
                                    refresh();
                                } catch (error) {
                                    message.error(error instanceof Error ? error.message : "删除失败");
                                }
                            },
                        },
                    ]}
                />
            ),
        },
    ];

    const expiryDetail = stats ? (
        stats.expiring || stats.expired ? (
            <>
                {stats.expiring ? <span className="is-warning">{stats.expiring} 个 30 天内到期</span> : null}
                {stats.expiring && stats.expired ? " · " : null}
                {stats.expired ? <span className="is-error">{stats.expired} 个已过期</span> : null}
            </>
        ) : (
            "授权均在有效期内"
        )
    ) : null;

    return (
        <div className="admin-ark-groups">
            <div className="admin-ark-stats" role="group" aria-label="素材组概览，点击类型卡片按类型筛选">
                <ArkStatCard icon={UserRound} label="真人素材组" value={stats?.real} detail={expiryDetail} active={kind === "real"} onClick={() => toggleKind("real")} />
                <ArkStatCard icon={Sparkles} label="虚拟素材组" value={stats?.virtual} detail="AI 生成或绘制的虚拟形象" active={kind === "virtual"} onClick={() => toggleKind("virtual")} />
                <ArkStatCard icon={Copyright} label="版权 IP 素材组" value={stats?.ip} detail="仅管理员创建并授权" active={kind === "ip"} onClick={() => toggleKind("ip")} />
                <ArkStatCard
                    icon={ClipboardCheck}
                    label="待审核上传"
                    value={data ? pendingReview : undefined}
                    tone={pendingReview ? "warning" : undefined}
                    detail={
                        pendingReview ? (
                            <span className="admin-ark-stat-link">
                                去审核 <ArrowRight className="size-3" aria-hidden="true" />
                            </span>
                        ) : (
                            "暂无待审核"
                        )
                    }
                    onClick={onOpenReviews}
                />
            </div>

            {data?.sessions.length ? (
                <Callout tone="info" title="进行中的平台真人认证">
                    <div className="flex flex-wrap gap-2 pt-1">
                        {data.sessions.map((session) => (
                            <Button key={session.id} size="small" onClick={() => setCreating({ resume: session })}>
                                {session.name} · {formatArkAdminDate(session.expiresAt, true)} 前有效
                            </Button>
                        ))}
                    </div>
                </Callout>
            ) : null}

            <AdminDataTable<ArkPortraitGroup>
                toolbar={
                    <Input
                        allowClear
                        className="admin-ark-search"
                        prefix={<Search className="size-4 opacity-40" />}
                        placeholder="搜索名称或方舟素材组 ID"
                        value={keyword}
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarActive={filtered}
                toolbarFilters={
                    <>
                        <Select<ArkGroupScope | "">
                            ariaLabel="素材组归属"
                            value={scope}
                            onChange={(value) => {
                                setScope(value);
                                setPage(1);
                            }}
                            options={[
                                { value: "", label: "全部归属" },
                                { value: "user", label: "用户自建" },
                                { value: "platform", label: "平台素材组" },
                            ]}
                        />
                        <Select<ExpiryFilter | "">
                            ariaLabel="授权状态"
                            value={expiry}
                            onChange={(value) => {
                                setExpiry(value);
                                setPage(1);
                            }}
                            options={[
                                { value: "", label: "全部授权状态" },
                                { value: "valid", label: "有效" },
                                { value: "expiring", label: "30 天内到期" },
                                { value: "expired", label: "已过期" },
                            ]}
                        />
                    </>
                }
                toolbarActiveFilters={kind ? <AdminFilterChip label={`类型：${ARK_KIND_LABEL[kind]}`} onRemove={() => toggleKind(kind)} /> : undefined}
                onReset={resetFilters}
                trailing={
                    <>
                        <Tooltip title="刷新列表">
                            <Button aria-label="刷新列表" icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={refresh} />
                        </Tooltip>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating({})}>
                            新建平台素材组
                        </Button>
                    </>
                }
                table={{ rowKey: "id", columns, dataSource: data?.items || [], loading: query.isLoading, pagination: false, size: "middle", scroll: data?.items.length ? { x: 980 } : undefined }}
                empty={
                    filtered ? (
                        <AdminTableEmpty filtered action={<Button onClick={resetFilters}>清除筛选</Button>} />
                    ) : (
                        <div className="admin-ark-empty-state">
                            <span className="admin-ark-empty-icon" aria-hidden="true">
                                <FolderPlus className="size-5" />
                            </span>
                            <h3>还没有素材组</h3>
                            <p>用户自建的真人、虚拟素材组，以及管理员创建的平台素材组都会显示在这里。</p>
                            <Button icon={<Plus className="size-4" />} onClick={() => setCreating({})}>
                                新建平台素材组
                            </Button>
                        </div>
                    )
                }
                footer={
                    data && showPagination ? (
                        <PaginationBar
                            current={page}
                            pageSize={pageSize}
                            total={data.total}
                            onChange={(nextPage, nextSize) => {
                                setPage(nextSize !== pageSize ? 1 : nextPage);
                                setPageSize(nextSize);
                            }}
                            itemLabel="组"
                        />
                    ) : null
                }
            />
            <ArkAdminGroupDrawer groupId={detailId} onClose={() => setDetailId(null)} onChanged={refresh} />
            <ArkAdminCreateModal
                open={Boolean(creating)}
                resume={creating?.resume}
                onClose={() => setCreating(null)}
                onCreated={(arkGroupId) => {
                    refresh();
                    if (!arkGroupId) return;
                    setCreating(null);
                }}
            />
        </div>
    );
}

/** 概览卡片：传 active 时是类型筛选开关（aria-pressed），否则是跳转按钮。 */
function ArkStatCard({ icon: Icon, label, value, detail, active, tone, onClick }: { icon: LucideIcon; label: string; value?: number; detail?: ReactNode; active?: boolean; tone?: "warning"; onClick: () => void }) {
    return (
        <button type="button" className={cn("admin-ark-stat", active && "is-active", tone && `is-${tone}`)} aria-pressed={active} onClick={onClick}>
            <span className="admin-ark-stat-head">
                <span className="admin-ark-stat-icon" aria-hidden="true">
                    <Icon className="size-4" />
                </span>
                <span className="admin-ark-stat-label">{label}</span>
                {active ? <span className="admin-ark-stat-flag">筛选中</span> : null}
            </span>
            <span className="admin-ark-stat-value">{value ?? "–"}</span>
            <span className="admin-ark-stat-detail">{detail}</span>
        </button>
    );
}

function ArkStackedCell({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="truncate">{primary}</div>
            {secondary ? <div className="admin-ark-muted truncate">{secondary}</div> : null}
        </div>
    );
}
