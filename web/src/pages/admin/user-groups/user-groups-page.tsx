import { App, Button } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { UserGroupBadge } from "@/components/layout/user-group-badge";
import { deleteAdminUserGroup, formatRatioBasisPoints, listAdminUserGroups, type UserGroup } from "@/services/api/user-groups";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { UserGroupEditor } from "./user-group-editor";
import { formatPoints } from "./user-group-form";

/** 用户分组：分组 -> 系统渠道 -> 模型的可见范围、统一折扣和货币兑换积分比例。 */
export default function UserGroupsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [editing, setEditing] = useState<UserGroup | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError("");
        try {
            setGroups((await listAdminUserGroups()).groups);
        } catch (error) {
            const text = error instanceof Error ? error.message : "读取用户分组失败";
            setLoadError(text);
            message.error(text);
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    const channelNames = useMemo(() => new Map(references.channels.map((channel) => [channel.id, channel.name])), [references.channels]);

    const remove = useCallback(
        async (group: UserGroup) => {
            try {
                await deleteAdminUserGroup(group.id);
                setGroups((items) => items.filter((item) => item.id !== group.id));
                message.success("分组已删除");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "删除分组失败");
            }
        },
        [message],
    );

    const columns = useMemo<ColumnsType<UserGroup>>(
        () => [
            {
                key: "group",
                title: "分组",
                render: (_, group) => (
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className="admin-table-primary-link font-medium"
                                onClick={() => {
                                    setEditing(group);
                                    setEditorOpen(true);
                                }}
                            >
                                {group.name}
                            </button>
                            <UserGroupBadge group={group} />
                            {group.isDefault ? <AdminStatusBadge label="默认" tone="info" /> : null}
                        </div>
                        <div className="text-xs text-foreground/45">
                            {group.code}
                            {group.description ? ` · ${group.description}` : ""}
                        </div>
                    </div>
                ),
            },
            {
                key: "ratio",
                title: "分组倍率",
                width: 110,
                align: "center",
                render: (_, group) => <span className="tabular-nums">{formatRatioBasisPoints(group.ratioBasisPoints)}</span>,
            },
            {
                key: "currency",
                title: "货币兑换",
                width: 170,
                align: "center",
                render: (_, group) => (
                    <div className="text-xs tabular-nums leading-5">
                        <div>1 USD = {group.pointsPerUsdMicrocredits ? `${formatPoints(group.pointsPerUsdMicrocredits)} 积分` : "未配置"}</div>
                        <div>1 CNY = {group.pointsPerCnyMicrocredits ? `${formatPoints(group.pointsPerCnyMicrocredits)} 积分` : "未配置"}</div>
                    </div>
                ),
            },
            {
                key: "channels",
                title: "可用渠道",
                width: 200,
                render: (_, group) =>
                    group.allChannels ? (
                        <AdminStatusBadge label="全部系统渠道" tone="success" />
                    ) : group.channelIds.length ? (
                        <span className="text-xs" title={group.channelIds.map((id) => channelNames.get(id) || id).join("、")}>
                            {group.channelIds
                                .slice(0, 2)
                                .map((id) => channelNames.get(id) || id)
                                .join("、")}
                            {group.channelIds.length > 2 ? ` 等 ${group.channelIds.length} 个` : ""}
                        </span>
                    ) : (
                        <AdminStatusBadge label="未绑定渠道" tone="warning" />
                    ),
            },
            {
                key: "overrides",
                title: "模型倍率",
                width: 100,
                align: "center",
                render: (_, group) => (
                    <span className="tabular-nums" title={group.modelOverrides.map((item) => item.modelKey).join("\n")}>
                        {group.modelOverrides.length ? `${group.modelOverrides.length} 项` : "—"}
                    </span>
                ),
            },
            { key: "users", title: "用户数", dataIndex: "userCount", width: 90, align: "center", render: (value: number) => <span className="tabular-nums">{value}</span> },
            {
                key: "actions",
                title: "操作",
                width: 150,
                align: "center",
                render: (_, group) => (
                    <AdminRowActions
                        primary={{
                            label: "编辑",
                            icon: <Pencil className="size-3.5" />,
                            onClick: () => {
                                setEditing(group);
                                setEditorOpen(true);
                            },
                        }}
                        visibleActionCount={1}
                        actions={[
                            {
                                key: "delete",
                                label: "删除分组",
                                icon: <Trash2 className="size-3.5" />,
                                danger: true,
                                disabled: group.isDefault || group.userCount > 0,
                                confirm: { title: `删除分组「${group.name}」？`, description: "删除后不可恢复；分组下必须没有用户。", okText: "确认删除" },
                                onClick: () => remove(group),
                            },
                        ]}
                    />
                ),
            },
        ],
        [channelNames, remove],
    );

    return (
        <AdminPageFrame
            title="用户分组"
            description="分组 → 渠道 → 模型的可见范围、统一折扣与货币兑换积分比例"
            actions={
                <div className="flex items-center gap-2">
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setEditing(null);
                            setEditorOpen(true);
                        }}
                    >
                        新建分组
                    </Button>
                </div>
            }
        >
            <AdminDataTable
                skeletonColumns={columns.length}
                table={{ className: "app-data-table", size: "small", rowKey: "id", loading, columns, dataSource: groups, pagination: false, scroll: { x: 960 } }}
                empty={
                    loadError ? (
                        <div className="admin-inline-load-error" role="status">
                            <span>分组数据暂不可用：{loadError}</span>
                            <Button size="small" onClick={() => void load()}>
                                重试
                            </Button>
                        </div>
                    ) : (
                        <AdminTableEmpty title="还没有分组" />
                    )
                }
            />
            <UserGroupEditor
                open={editorOpen}
                group={editing}
                onClose={() => setEditorOpen(false)}
                onSaved={(saved) => {
                    setGroups((items) => {
                        const exists = items.some((item) => item.id === saved.id);
                        const next = exists ? items.map((item) => (item.id === saved.id ? saved : item)) : [...items, saved];
                        return next.sort((left, right) => left.sortOrder - right.sortOrder);
                    });
                    setEditorOpen(false);
                }}
            />
        </AdminPageFrame>
    );
}
