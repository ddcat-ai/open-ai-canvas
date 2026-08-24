import { useEffect, useState } from "react";
import { App, Button, Descriptions, Drawer, Empty, Progress, Skeleton, Tabs } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { formatCredits } from "@/constant/credits";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, type AdminStatusTone } from "./admin-ui";
import { getAdminUserDetail, listAdminUserAuditEvents, listAdminUserLedger, listAdminUserTasks, type AdminAuditEvent, type AdminUserDetail, type AdminUserTask } from "@/services/api/auth";
import type { CreditLedgerEntry } from "@/services/api/wallet";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export function AdminUserDetailDrawer({ userId, onClose, previousUserId, nextUserId, onNavigate }: { userId: string | null; onClose: () => void; previousUserId?: string; nextUserId?: string; onNavigate?: (userId: string) => void }) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [detail, setDetail] = useState<AdminUserDetail | null>(null);
    const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
    const [tasks, setTasks] = useState<AdminUserTask[]>([]);
    const [events, setEvents] = useState<AdminAuditEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [ledgerPage, setLedgerPage] = useState(1);
    const [ledgerTotal, setLedgerTotal] = useState(0);
    const [taskPage, setTaskPage] = useState(1);
    const [taskTotal, setTaskTotal] = useState(0);
    const [auditPage, setAuditPage] = useState(1);
    const [auditTotal, setAuditTotal] = useState(0);

    useEffect(() => {
        if (!userId) return;
        let active = true;
        setLoading(true);
        setDetail(null);
        setLedgerPage(1);
        setTaskPage(1);
        setAuditPage(1);
        void getAdminUserDetail(userId)
            .then((nextDetail) => {
                if (active) setDetail(nextDetail);
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("admin:failed-to-load-user-details")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [message, userId]);

    useEffect(() => {
        if (!userId) return;
        let active = true;
        void listAdminUserLedger(userId, { page: ledgerPage, limit: 20 })
            .then((result) => {
                if (active) {
                    setLedger(result.entries);
                    setLedgerTotal(result.total);
                }
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("admin:failed-to-load-credit-ledger")));
        return () => {
            active = false;
        };
    }, [ledgerPage, message, userId]);
    useEffect(() => {
        if (!userId) return;
        let active = true;
        void listAdminUserTasks(userId, { page: taskPage, limit: 20 })
            .then((result) => {
                if (active) {
                    setTasks(result.tasks);
                    setTaskTotal(result.total);
                }
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("admin:failed-to-load-task-history")));
        return () => {
            active = false;
        };
    }, [message, taskPage, userId]);
    useEffect(() => {
        if (!userId) return;
        let active = true;
        void listAdminUserAuditEvents(userId, { page: auditPage, limit: 20 })
            .then((result) => {
                if (active) {
                    setEvents(result.events);
                    setAuditTotal(result.total);
                }
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("admin:failed-to-load-admin-actions")));
        return () => {
            active = false;
        };
    }, [auditPage, message, userId]);

    return (
        <Drawer
            title={detail ? `${detail.user.displayName || detail.user.username} · 用户详情` : t("admin:user-details")}
            open={Boolean(userId)}
            onClose={onClose}
            size="min(920px, 100vw)"
            destroyOnHidden
            rootClassName="admin-drawer"
            extra={
                onNavigate ? (
                    <div className="flex items-center gap-1">
                        <Button type="text" size="small" aria-label={t("admin:previous-user")} disabled={!previousUserId} icon={<ChevronLeft className="size-4" />} onClick={() => previousUserId && onNavigate(previousUserId)} />
                        <Button type="text" size="small" aria-label={t("admin:next-user")} disabled={!nextUserId} icon={<ChevronRight className="size-4" />} onClick={() => nextUserId && onNavigate(nextUserId)} />
                    </div>
                ) : null
            }
        >
            {loading && !detail ? (
                <Skeleton active paragraph={{ rows: 10 }} />
            ) : detail ? (
                <Tabs
                    items={[
                        {
                            key: "overview",
                            label: t("admin:account-overview"),
                            children: (
                                <div className="space-y-5">
                                    <Descriptions
                                        bordered
                                        size="small"
                                        column={{ xs: 1, sm: 2 }}
                                        items={[
                                            { key: "username", label: t("admin:username"), children: `@${detail.user.username}` },
                                            { key: "email", label: t("admin:email"), children: detail.user.email || t("admin:not-filled-in-3") },
                                            { key: "role", label: t("admin:role"), children: detail.user.role === "admin" ? t("admin:admin") : t("admin:user") },
                                            {
                                                key: "status",
                                                label: t("admin:status"),
                                                children: <AdminStatusBadge label={detail.user.status === "active" ? t("admin:enabled-2") : t("admin:disabled-2")} tone={detail.user.status === "active" ? "success" : "neutral"} />,
                                            },
                                            { key: "available", label: t("admin:available-credits"), children: formatCredits(detail.account.availableMicrocredits) },
                                            { key: "reserved", label: t("admin:frozen-credits"), children: formatCredits(detail.account.reservedMicrocredits) },
                                            { key: "created", label: t("admin:registered-at"), children: formatTime(detail.user.createdAt) },
                                            { key: "login", label: t("admin:last-sign-in"), children: formatTime(detail.user.lastLoginAt) },
                                        ]}
                                    />
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                        {Object.entries({ 积分流水: detail.counts.ledgerEntries, 生成任务: detail.counts.tasks, 上游请求: detail.counts.apiCalls, 管理操作: detail.counts.auditEvents }).map(([label, value]) => (
                                            <div key={label} className="rounded-md border border-border p-3">
                                                <div className="text-xs text-foreground/50">{label}</div>
                                                <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div>
                                        <div className="mb-3 text-sm font-medium">{t("admin:resource-and-quota-usage")}</div>
                                        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                                            {quotaUsageItems(detail).map((item) => (
                                                <div key={item.label}>
                                                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                                                        <span className="text-foreground/60">{item.label}</span>
                                                        <span className="shrink-0 tabular-nums text-foreground/75">{item.display}</span>
                                                    </div>
                                                    <Progress percent={Math.min(100, item.limit > 0 ? Math.round((item.value / item.limit) * 100) : 0)} size="small" showInfo={false} status={item.value >= item.limit ? "exception" : "normal"} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "ledger",
                            label: t("admin:credit-ledger-param", { ledgerEntries: detail.counts.ledgerEntries }),
                            children: (
                                <AdminDataTable
                                    table={{
                                        rowKey: "id",
                                        size: "small",
                                        dataSource: ledger,
                                        pagination: false,
                                        columns: [
                                            { title: t("admin:time"), dataIndex: "createdAt", width: 170, render: formatTime },
                                            { title: t("admin:type"), dataIndex: "type", width: 130 },
                                            { title: t("admin:change"), dataIndex: "amountMicrocredits", width: 120, align: "right", render: (value) => formatCredits(value) },
                                            { title: t("admin:notes"), dataIndex: "note", ellipsis: true },
                                        ],
                                        scroll: { x: 720 },
                                    }}
                                    empty={<AdminTableEmpty />}
                                    footer={<PaginationBar alwaysShow current={ledgerPage} pageSize={20} total={ledgerTotal} onChange={(page) => setLedgerPage(page)} pageSizeOptions={[20]} />}
                                />
                            ),
                        },
                        {
                            key: "tasks",
                            label: t("admin:generation-tasks-param", { tasks: detail.counts.tasks }),
                            children: (
                                <AdminDataTable
                                    table={{
                                        rowKey: "id",
                                        size: "small",
                                        dataSource: tasks,
                                        pagination: false,
                                        columns: [
                                            { title: t("admin:time"), dataIndex: "createdAt", width: 170, render: formatTime },
                                            { title: t("admin:type"), dataIndex: "type", width: 180 },
                                            { title: t("admin:models"), dataIndex: "model", width: 180, ellipsis: true },
                                            { title: t("admin:status"), dataIndex: "status", width: 100, render: (value) => <AdminStatusBadge label={value || t("admin:unknown")} tone={taskStatusTone(value)} /> },
                                            { title: t("admin:stage"), dataIndex: "stage", ellipsis: true },
                                        ],
                                        scroll: { x: 820 },
                                    }}
                                    empty={<AdminTableEmpty />}
                                    footer={<PaginationBar alwaysShow current={taskPage} pageSize={20} total={taskTotal} onChange={(page) => setTaskPage(page)} pageSizeOptions={[20]} />}
                                />
                            ),
                        },
                        {
                            key: "audit",
                            label: t("admin:admin-actions-param", { auditEvents: detail.counts.auditEvents }),
                            children: (
                                <AdminDataTable
                                    table={{
                                        rowKey: "id",
                                        size: "small",
                                        dataSource: events,
                                        pagination: false,
                                        columns: [
                                            { title: t("admin:time"), dataIndex: "createdAt", width: 170, render: formatTime },
                                            { title: t("admin:admin"), dataIndex: "actorUserId", width: 160, ellipsis: true },
                                            { title: t("admin:action"), dataIndex: "action", width: 160 },
                                            { title: t("admin:summary"), dataIndex: "summary", ellipsis: true },
                                        ],
                                        scroll: { x: 720 },
                                    }}
                                    empty={<AdminTableEmpty />}
                                    footer={<PaginationBar alwaysShow current={auditPage} pageSize={20} total={auditTotal} onChange={(page) => setAuditPage(page)} pageSizeOptions={[20]} />}
                                />
                            ),
                        },
                    ]}
                />
            ) : (
                <Empty description={t("admin:no-user-details")} />
            )}
        </Drawer>
    );
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function taskStatusTone(value?: string): AdminStatusTone {
    const normalized = String(value || "").toLowerCase();
    if (["completed", "succeeded", "success", "done"].includes(normalized)) return "success";
    if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "error";
    if (["running", "processing", "pending", "queued"].includes(normalized)) return "warning";
    return "neutral";
}

function quotaUsageItems(detail: AdminUserDetail) {
    const structuredBytes = detail.storageUsage.assetBytes + detail.storageUsage.canvasBytes + detail.storageUsage.sessionBytes;
    const bytes = (value: number) => (value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`);
    const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
    return [
        { label: t("admin:resources-and-attachments"), value: detail.storedFileBytes, limit: detail.quota.storedFileGB * 1024 ** 3, display: `${bytes(detail.storedFileBytes)} / ${detail.quota.storedFileGB} GB` },
        { label: t("admin:uploads-today-utc"), value: detail.dailyUploadBytes, limit: detail.quota.dailyUploadMB * 1024 ** 2, display: `${bytes(detail.dailyUploadBytes)} / ${detail.quota.dailyUploadMB} MB` },
        { label: t("admin:canvas-asset-and-session-data"), value: structuredBytes, limit: detail.quota.structuredDataMB * 1024 ** 2, display: `${bytes(structuredBytes)} / ${detail.quota.structuredDataMB} MB` },
        { label: t("admin:task-and-request-log-data"), value: detail.storageUsage.taskBytes, limit: detail.quota.taskDataGB * 1024 ** 3, display: `${bytes(detail.storageUsage.taskBytes)} / ${detail.quota.taskDataGB} GB` },
        { label: t("admin:asset-count"), value: detail.storageUsage.assetCount, limit: detail.quota.assetCount, display: `${number(detail.storageUsage.assetCount)} / ${number(detail.quota.assetCount)}` },
        { label: t("admin:canvas-count"), value: detail.storageUsage.canvasCount, limit: detail.quota.canvasCount, display: `${number(detail.storageUsage.canvasCount)} / ${number(detail.quota.canvasCount)}` },
        { label: t("admin:agent-session-count"), value: detail.storageUsage.sessionCount, limit: detail.quota.sessionCount, display: `${number(detail.storageUsage.sessionCount)} / ${number(detail.quota.sessionCount)}` },
        { label: t("admin:task-history-count"), value: detail.storageUsage.taskCount, limit: detail.quota.taskCount, display: `${number(detail.storageUsage.taskCount)} / ${number(detail.quota.taskCount)}` },
        { label: t("admin:upstream-request-log-count"), value: detail.storageUsage.apiCallCount, limit: detail.quota.apiCallLogCount, display: `${number(detail.storageUsage.apiCallCount)} / ${number(detail.quota.apiCallLogCount)}` },
    ];
}
