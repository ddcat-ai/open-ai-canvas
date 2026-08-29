import type { ColumnsType } from "antd/es/table";
import { Eye, Pencil, Power } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { IdentityProviderBadge } from "@/components/layout/identity-provider-badge";
import { AdminRowActions, AdminStatusBadge } from "../components/admin-ui";
import type { AdminUser } from "@/services/api/auth";

export type UserColumnKey = "user" | "email" | "credits" | "role" | "status" | "createdAt" | "actions";

export const userColumnOptions: Array<{ key: UserColumnKey; label: string; locked?: boolean }> = [
    { key: "user", label: "用户", locked: true },
    { key: "email", label: "邮箱" },
    { key: "credits", label: "当前积分" },
    { key: "role", label: "角色" },
    { key: "status", label: "状态" },
    { key: "createdAt", label: "注册时间" },
    { key: "actions", label: "操作", locked: true },
];

export function createUserColumns({
    actorId,
    visibleColumns,
    onView,
    onEdit,
    onToggleStatus,
}: {
    actorId?: string;
    visibleColumns: Set<UserColumnKey>;
    onView: (user: AdminUser) => void;
    onEdit: (user: AdminUser) => void;
    onToggleStatus: (user: AdminUser) => Promise<void>;
}): ColumnsType<AdminUser> {
    const columns: Array<ColumnsType<AdminUser>[number] & { key: UserColumnKey }> = [
        {
            key: "user",
            title: "用户",
            dataIndex: "username",
            render: (_, user) => (
                <div>
                    <div className="flex items-center gap-1.5"><button type="button" className="admin-table-primary-link font-medium" onClick={() => onView(user)}>{user.displayName || user.username}</button><IdentityProviderBadge user={user} /></div>
                    <div className="text-xs text-foreground/45">@{user.username}</div>
                </div>
            ),
        },
        { key: "email", title: "邮箱", dataIndex: "email", align: "center", render: (email) => email || <span className="text-foreground/40">未填写</span> },
        {
            key: "credits",
            title: "当前积分",
            dataIndex: "availableMicrocredits",
            width: 130,
            align: "center",
            render: (value, user) => <span className="tabular-nums" title={`冻结积分：${formatCredits(user.reservedMicrocredits)}`}>{formatCredits(value)}</span>,
        },
        { key: "role", title: "角色", dataIndex: "role", width: 110, align: "center", render: (role) => <AdminStatusBadge label={role === "admin" ? "管理员" : "普通用户"} tone={role === "admin" ? "info" : "neutral"} /> },
        { key: "status", title: "状态", dataIndex: "status", width: 110, align: "center", render: (status) => <AdminStatusBadge label={status === "active" ? "已启用" : "已停用"} tone={status === "active" ? "success" : "neutral"} /> },
        { key: "createdAt", title: "注册时间", dataIndex: "createdAt", width: 180, align: "center", render: formatTime },
        {
            key: "actions",
            title: "操作",
            width: 280,
            align: "center",
            render: (_, user) => (
                <AdminRowActions
                    primary={{ label: "详情", icon: <Eye className="size-3.5" />, onClick: () => onView(user) }}
                    visibleActionCount={2}
                    actions={[
                        { key: "edit", label: "编辑用户", icon: <Pencil className="size-3.5" />, onClick: () => onEdit(user) },
                        {
                            key: "toggle-status",
                            label: user.status === "active" ? "停用用户" : "重新启用",
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
