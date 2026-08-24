import type { ColumnsType } from "antd/es/table";
import { Eye, Pencil, Power } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { IdentityProviderBadge } from "@/components/layout/identity-provider-badge";
import { AdminRowActions, AdminStatusBadge } from "../components/admin-ui";
import type { AdminUser } from "@/services/api/auth";
import { t } from "@/i18n";

export type UserColumnKey = "user" | "email" | "credits" | "role" | "status" | "createdAt" | "actions";

export const userColumnOptions: Array<{ key: UserColumnKey; label: string; locked?: boolean }> = [
    { key: "user", label: t("admin:users-2"), locked: true },
    { key: "email", label: t("admin:email") },
    { key: "credits", label: t("admin:credits") },
    { key: "role", label: t("admin:role") },
    { key: "status", label: t("admin:status") },
    { key: "createdAt", label: t("admin:registered-at") },
    { key: "actions", label: t("admin:actions"), locked: true },
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
            title: t("admin:users-2"),
            dataIndex: "username",
            render: (_, user) => (
                <div>
                    <div className="flex items-center gap-1.5">
                        <button type="button" className="admin-table-primary-link font-medium" onClick={() => onView(user)}>
                            {user.displayName || user.username}
                        </button>
                        <IdentityProviderBadge user={user} />
                    </div>
                    <div className="text-xs text-foreground/45">@{user.username}</div>
                </div>
            ),
        },
        { key: "email", title: t("admin:email"), dataIndex: "email", render: (email) => email || <span className="text-foreground/40">{t("admin:not-filled-in-3")}</span> },
        {
            key: "credits",
            title: t("admin:credits"),
            dataIndex: "availableMicrocredits",
            width: 130,
            align: "right",
            render: (value, user) => (
                <span className="tabular-nums" title={`冻结积分：${formatCredits(user.reservedMicrocredits)}`}>
                    {formatCredits(value)}
                </span>
            ),
        },
        { key: "role", title: t("admin:role"), dataIndex: "role", width: 110, render: (role) => <AdminStatusBadge label={role === "admin" ? t("admin:admin") : t("admin:user")} tone={role === "admin" ? "info" : "neutral"} /> },
        { key: "status", title: t("admin:status"), dataIndex: "status", width: 110, render: (status) => <AdminStatusBadge label={status === "active" ? t("admin:enabled") : t("admin:disabled")} tone={status === "active" ? "success" : "neutral"} /> },
        { key: "createdAt", title: t("admin:registered-at"), dataIndex: "createdAt", width: 180, render: formatTime },
        {
            key: "actions",
            title: t("admin:actions"),
            width: 180,
            align: "right",
            render: (_, user) => (
                <AdminRowActions
                    primary={{ label: t("admin:details"), icon: <Eye className="size-3.5" />, onClick: () => onView(user) }}
                    actions={[
                        { key: "edit", label: t("admin:edit-user"), icon: <Pencil className="size-3.5" />, onClick: () => onEdit(user) },
                        {
                            key: "toggle-status",
                            label: user.status === "active" ? t("admin:disable-user") : t("admin:re-enable"),
                            icon: <Power className="size-3.5" />,
                            danger: user.status === "active",
                            disabled: user.id === actorId,
                            confirm: {
                                title: user.status === "active" ? t("admin:disable-this-user") : t("admin:re-enable-this-user"),
                                description: user.status === "active" ? t("admin:disabling-clears-the-user-s-sessions-but-keeps-identity-tasks-and-credit") : t("admin:after-enabling-the-user-can-sign-in-again-and-keeps-all-existing-data"),
                                okText: user.status === "active" ? t("admin:confirm-disable") : t("admin:confirm-enable"),
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
