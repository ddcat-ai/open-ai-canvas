import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { deleteAdminArkGroup, listAdminArkGroups, type ArkExpiryStatus, type ArkGroupKind, type ArkGroupScope, type ArkPortraitGroup, type ArkPortraitSession } from "@/services/api/ark-portraits";
import { AdminDataTable, AdminRowActions, AdminStatTile, AdminTableEmpty, PaginationBar } from "../../components/admin-ui";
import { Callout, Select } from "../../ui/controls";
import { ArkAdminCreateModal } from "./ark-admin-create-modal";
import { ArkAdminGroupDrawer } from "./ark-admin-group-drawer";
import { ARK_KIND_LABEL, ARK_SOURCE_LABEL, ArkExpiryBadge, arkGrantSummary, arkUserLabel, formatArkAdminDate } from "./ark-admin-shared";

type ExpiryFilter = Exclude<ArkExpiryStatus, "none">;

export const adminArkGroupsQueryKey = ["admin-ark-groups"] as const;

/** 全部素材组：用户自建与平台素材组统一管理，按类型、归属与真人授权期限筛选。 */
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

    const columns: ColumnsType<ArkPortraitGroup> = [
        {
            title: "素材组",
            key: "name",
            render: (_, group) => (
                <div className="min-w-0">
                    <div className="truncate font-medium" title={group.name}>
                        {group.name}
                    </div>
                    <div className="truncate font-mono text-xs opacity-60" title={group.groupId}>
                        {group.groupId}
                    </div>
                </div>
            ),
        },
        { title: "类型", key: "kind", width: 120, render: (_, group) => `${ARK_KIND_LABEL[group.kind]} · ${ARK_SOURCE_LABEL[group.source] || group.source}` },
        { title: "归属", key: "scope", width: 180, render: (_, group) => (group.scope === "platform" ? `平台 · ${arkGrantSummary(group)}` : arkUserLabel(group.owner)) },
        {
            title: "素材",
            key: "assets",
            width: 120,
            render: (_, group) => {
                const counts = group.assetCounts || {};
                return `${counts.active || 0} 已通过${counts.pending_review ? ` · ${counts.pending_review} 待审` : ""}${counts.processing ? ` · ${counts.processing} 审核中` : ""}`;
            },
        },
        { title: "授权", key: "expiry", width: 180, render: (_, group) => <ArkExpiryBadge group={group} /> },
        { title: "创建时间", key: "createdAt", width: 120, render: (_, group) => formatArkAdminDate(group.createdAt) },
        {
            title: "操作",
            key: "actions",
            width: 140,
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

    return (
        <div className="admin-settings-stack">
            {data ? (
                <div className="admin-ark-overview">
                    <AdminStatTile label="真人素材组" value={data.stats.real} detail={`${data.stats.expiring} 个 30 天内到期 · ${data.stats.expired} 个已过期`} />
                    <AdminStatTile label="虚拟素材组" value={data.stats.virtual} />
                    <AdminStatTile label="版权 IP 素材组" value={data.stats.ip} />
                    <AdminStatTile label="待审核上传" value={data.pendingReview} detail={data.pendingReview ? "通过后才提交方舟" : "暂无待审核"} />
                </div>
            ) : null}
            {data?.pendingReview ? (
                <Callout
                    tone="warning"
                    action={
                        <Button size="small" onClick={onOpenReviews}>
                            去审核
                        </Button>
                    }
                >
                    有 {data.pendingReview} 份用户上传等待审核，审核通过后才会提交到方舟。
                </Callout>
            ) : null}
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
                        className="admin-search-input w-full sm:w-72"
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
                        <Select<ArkGroupKind | "">
                            ariaLabel="素材组类型"
                            value={kind}
                            onChange={(value) => {
                                setKind(value);
                                setPage(1);
                            }}
                            options={[{ value: "", label: "全部类型" }, ...(["real", "virtual", "ip"] as const).map((value) => ({ value, label: ARK_KIND_LABEL[value] }))]}
                        />
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
                onReset={() => {
                    setKind("");
                    setScope("");
                    setExpiry("");
                    setKeyword("");
                    setPage(1);
                }}
                trailing={
                    <>
                        <Button icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={refresh}>
                            刷新
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setCreating({})}>
                            新建平台素材组
                        </Button>
                    </>
                }
                table={{ rowKey: "id", columns, dataSource: data?.items || [], loading: query.isLoading, pagination: false, size: "middle" }}
                empty={<AdminTableEmpty filtered={filtered} title={filtered ? undefined : "还没有素材组"} description={filtered ? undefined : "用户自建的真人、虚拟素材组和平台素材组都会显示在这里。"} />}
                footer={
                    data ? (
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
