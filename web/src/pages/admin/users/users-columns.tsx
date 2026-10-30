import type { ColumnsType } from "antd/es/table";
import { Coins, Eye, Pencil, Power } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { IdentityProviderBadge } from "@/components/layout/identity-provider-badge";
import { AdminRowActions, AdminStatusBadge } from "../components/admin-ui";
import type { AdminUser } from "@/services/api/auth";
import { UserGroupBadge } from "@/components/layout/user-group-badge";
import { userGroupCode, type UserGroup } from "@/services/api/user-groups";

export type UserColumnKey = "user" | "email" | "credits" | "recharged" | "consumed" | "role" | "group" | "status" | "lastLoginAt" | "createdAt" | "actions";

export const userColumnOptions: Array<{ key: UserColumnKey; label: string; locked?: boolean }> = [
    { key: "user", label: "用户", locked: true },
    { key: "email", label: "邮箱" },
    { key: "credits", label: "可用积分" },
    { key: "recharged", label: "累计充值" },
    { key: "consumed", label: "累计消耗" },
    { key: "role", label: "角色" },
    { key: "group", label: "分组" },
    { key: "status", label: "状态" },
    { key: "lastLoginAt", label: "最近登录" },
    { key: "createdAt", label: "注册时间" },
    { key: "actions", label: "操作", locked: true },
];

export function createUserColumns({
    actorId,
    visibleColumns,
    groups,
    onView,
    onEdit,
    onAdjustCredits,
    onToggleStatus,
}: {
    actorId?: string;
    visibleColumns: Set<UserColumnKey>;
    groups: UserGroup[];
    onView: (user: AdminUser) => void;
    onEdit: (user: AdminUser) => void;
    onAdjustCredits: (user: AdminUser) => void;
    onToggleStatus: (user: AdminUser) => Promise<void>;
}): ColumnsType<AdminUser> {
    const columns: Array<ColumnsType<AdminUser>[number] & { key: UserColumnKey }> = [
        {
            key: "user",
            title: "用户",
            dataIndex: "username",
            fixed: "left",
            width: 200,
            render: (_, user) => (
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <button type="button" className="admin-table-primary-link truncate font-medium" onClick={() => onView(user)}>
                            {user.displayName || user.username}
                        </button>
                        <IdentityProviderBadge user={user} />
                    </div>
                    <div className="truncate text-xs text-foreground/45">@{user.username}</div>
                </div>
            ),
        },
        { key: "email", title: "邮箱", dataIndex: "email", width: 200, ellipsis: true, render: (email) => email || <span className="text-foreground/40">未填写</span> },
        {
            key: "credits",
            title: "可用积分",
            dataIndex: "availableMicrocredits",
            width: 120,
            align: "right",
            render: (value, user) => (
                <div className="tabular-nums">
                    <div>{formatCredits(value)}</div>
                    {user.reservedMicrocredits ? <div className="text-xs text-foreground/45">冻结 {formatCredits(user.reservedMicrocredits)}</div> : null}
                </div>
            ),
        },
        {
            key: "recharged",
            title: "累计充值",
            dataIndex: "rechargedMicrocredits",
            width: 110,
            align: "right",
            render: (value?: number) => (value ? <span className="tabular-nums">{formatCredits(value)}</span> : <span className="text-foreground/35">—</span>),
        },
        {
            key: "consumed",
            title: "累计消耗",
            dataIndex: "consumedMicrocredits",
            width: 110,
            align: "right",
            render: (value?: number) => (value ? <span className="tabular-nums">{formatCredits(value)}</span> : <span className="text-foreground/35">—</span>),
        },
        {
            key: "role",
            title: "角色",
            dataIndex: "role",
            width: 130,
            align: "center",
            render: (role, user) => (
                <span className="inline-flex flex-wrap items-center justify-center gap-1">
                    <AdminStatusBadge label={role === "admin" ? "管理员" : "普通用户"} tone={role === "admin" ? "info" : "neutral"} />
                    {user.isPromoter ? <AdminStatusBadge label="推广人" tone="success" /> : null}
                </span>
            ),
        },
        {
            key: "group",
            title: "分组",
            dataIndex: "userGroup",
            width: 120,
            align: "center",
            render: (_, user) => {
                const code = userGroupCode(user.userGroup);
                const group = groups.find((item) => item.code === code);
                return (
                    <span className="inline-flex items-center justify-center gap-1">
                        <span className="text-xs">{group?.name || code}</span>
                        {group ? <UserGroupBadge group={group} compact /> : null}
                    </span>
                );
            },
        },
        { key: "status", title: "状态", dataIndex: "status", width: 90, align: "center", render: (status) => <AdminStatusBadge label={status === "active" ? "已启用" : "已停用"} tone={status === "active" ? "success" : "neutral"} /> },
        {
            key: "lastLoginAt",
            title: "最近登录",
            dataIndex: "lastLoginAt",
            width: 112,
            align: "center",
            render: (value?: string) =>
                value ? (
                    <span className="tabular-nums" title={formatTime(value)}>
                        {formatRelativeDay(value)}
                    </span>
                ) : (
                    <span className="text-foreground/35">从未登录</span>
                ),
        },
        {
            key: "createdAt",
            title: "注册时间",
            dataIndex: "createdAt",
            width: 112,
            align: "center",
            render: (value) => (
                <span className="tabular-nums" title={formatTime(value)}>
                    {formatCompactTime(value)}
                </span>
            ),
        },
        {
            key: "actions",
            title: "操作",
            width: 268,
            align: "center",
            fixed: "right",
            // 高频操作全部外露，不收进“更多”：查看、编辑、调积分；停用带二次确认。
            render: (_, user) => (
                <AdminRowActions
                    primary={{ label: "详情", icon: <Eye className="size-3.5" />, onClick: () => onView(user) }}
                    visibleActionCount={3}
                    actions={[
                        { key: "edit", label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => onEdit(user) },
                        { key: "credits", label: "调积分", icon: <Coins className="size-3.5" />, onClick: () => onAdjustCredits(user) },
                        {
                            key: "toggle-status",
                            label: user.status === "active" ? "停用" : "启用",
                            icon: <Power className="size-3.5" />,
                            danger: user.status === "active",
                            disabled: user.id === actorId,
                            confirm: {
                                title: user.status === "active" ? "停用这个用户？" : "重新启用这个用户？",
                                description: user.status === "active" ? "停用后会清除该用户登录态，但保留身份、任务和积分流水。" : "启用后，该用户可以重新登录并继续使用原有数据。",
                                okText: user.status === "active" ? "确认停用" : "确认启用",
                            },
                            onClick: () => onToggleStatus(user),
                        },
                    ]}
                />
            ),
        },
    ];
    return columns.filter((column) => visibleColumns.has(column.key));
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function formatCompactTime(value?: string) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

// 最近登录按“今天 / 昨天 / N 天前”显示，运营判断活跃度时比精确时间更快；完整时间在悬停提示里。
function formatRelativeDay(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const days = Math.floor((startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
    if (days <= 0) return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    if (days === 1) return "昨天";
    if (days < 30) return `${days} 天前`;
    return formatCompactTime(value);
}
