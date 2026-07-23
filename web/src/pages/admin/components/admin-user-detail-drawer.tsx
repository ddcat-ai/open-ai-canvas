import { useEffect, useState } from "react";
import { App, Descriptions, Drawer, Empty, Progress, Skeleton, Table, Tabs, Tag } from "antd";

import { formatCredits } from "@/constant/credits";
import { getAdminUserDetail, listAdminUserAuditEvents, listAdminUserLedger, listAdminUserTasks, type AdminAuditEvent, type AdminUserDetail, type AdminUserTask } from "@/services/api/auth";
import type { CreditLedgerEntry } from "@/services/api/wallet";

export function AdminUserDetailDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
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
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取用户详情失败"))
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
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取积分流水失败"));
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
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取任务记录失败"));
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
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取管理操作失败"));
        return () => {
            active = false;
        };
    }, [auditPage, message, userId]);

    return (
        <Drawer title={detail ? `${detail.user.displayName || detail.user.username} · 用户详情` : "用户详情"} open={Boolean(userId)} onClose={onClose} width="min(920px, 100vw)" destroyOnHidden>
            {loading && !detail ? (
                <Skeleton active paragraph={{ rows: 10 }} />
            ) : detail ? (
                <Tabs
                    items={[
                        {
                            key: "overview",
                            label: "账号概览",
                            children: (
                                <div className="space-y-5">
                                    <Descriptions
                                        bordered
                                        size="small"
                                        column={{ xs: 1, sm: 2 }}
                                        items={[
                                            { key: "username", label: "用户名", children: `@${detail.user.username}` },
                                            { key: "email", label: "邮箱", children: detail.user.email || "未填写" },
                                            { key: "role", label: "角色", children: detail.user.role === "admin" ? "管理员" : "普通用户" },
                                            { key: "status", label: "状态", children: <Tag color={detail.user.status === "active" ? "success" : "default"}>{detail.user.status === "active" ? "启用" : "停用"}</Tag> },
                                            { key: "available", label: "可用积分", children: formatCredits(detail.account.availableMicrocredits) },
                                            { key: "reserved", label: "冻结积分", children: formatCredits(detail.account.reservedMicrocredits) },
                                            { key: "created", label: "注册时间", children: formatTime(detail.user.createdAt) },
                                            { key: "login", label: "最后登录", children: formatTime(detail.user.lastLoginAt) },
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
                                        <div className="mb-3 text-sm font-medium">资源与配额占用</div>
                                        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                                            {quotaUsageItems(detail).map((item) => (
                                                <div key={item.label}>
                                                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                                                        <span className="text-foreground/60">{item.label}</span>
                                                        <span className="shrink-0 tabular-nums text-foreground/75">{item.display}</span>
                                                    </div>
                                                    <Progress percent={Math.min(100, item.limit > 0 ? Math.round(item.value / item.limit * 100) : 0)} size="small" showInfo={false} status={item.value >= item.limit ? "exception" : "normal"} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ),
                        },
                        {
                            key: "ledger",
                            label: `积分流水 ${detail.counts.ledgerEntries}`,
                            children: (
                                <Table
                                    rowKey="id"
                                    size="small"
                                    dataSource={ledger}
                                    pagination={{ current: ledgerPage, pageSize: 20, total: ledgerTotal, showSizeChanger: false, onChange: setLedgerPage }}
                                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无积分流水" /> }}
                                    columns={[
                                        { title: "时间", dataIndex: "createdAt", width: 170, render: formatTime },
                                        { title: "类型", dataIndex: "type", width: 130 },
                                        { title: "变化", dataIndex: "amountMicrocredits", width: 120, align: "right", render: (value) => formatCredits(value) },
                                        { title: "说明", dataIndex: "note", ellipsis: true },
                                    ]}
                                    scroll={{ x: 720 }}
                                />
                            ),
                        },
                        {
                            key: "tasks",
                            label: `生成任务 ${detail.counts.tasks}`,
                            children: (
                                <Table
                                    rowKey="id"
                                    size="small"
                                    dataSource={tasks}
                                    pagination={{ current: taskPage, pageSize: 20, total: taskTotal, showSizeChanger: false, onChange: setTaskPage }}
                                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成任务" /> }}
                                    columns={[
                                        { title: "时间", dataIndex: "createdAt", width: 170, render: formatTime },
                                        { title: "类型", dataIndex: "type", width: 180 },
                                        { title: "模型", dataIndex: "model", width: 180, ellipsis: true },
                                        { title: "状态", dataIndex: "status", width: 100 },
                                        { title: "阶段", dataIndex: "stage", ellipsis: true },
                                    ]}
                                    scroll={{ x: 820 }}
                                />
                            ),
                        },
                        {
                            key: "audit",
                            label: `管理操作 ${detail.counts.auditEvents}`,
                            children: (
                                <Table
                                    rowKey="id"
                                    size="small"
                                    dataSource={events}
                                    pagination={{ current: auditPage, pageSize: 20, total: auditTotal, showSizeChanger: false, onChange: setAuditPage }}
                                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无管理员操作" /> }}
                                    columns={[
                                        { title: "时间", dataIndex: "createdAt", width: 170, render: formatTime },
                                        { title: "管理员", dataIndex: "actorUserId", width: 160, ellipsis: true },
                                        { title: "动作", dataIndex: "action", width: 160 },
                                        { title: "摘要", dataIndex: "summary", ellipsis: true },
                                    ]}
                                    scroll={{ x: 720 }}
                                />
                            ),
                        },
                    ]}
                />
            ) : (
                <Empty description="没有用户详情" />
            )}
        </Drawer>
    );
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function quotaUsageItems(detail: AdminUserDetail) {
    const structuredBytes = detail.storageUsage.assetBytes + detail.storageUsage.canvasBytes + detail.storageUsage.sessionBytes;
    const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
    const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
    return [
        { label: "资源与附件", value: detail.storedFileBytes, limit: detail.quota.storedFileGB * 1024 ** 3, display: `${bytes(detail.storedFileBytes)} / ${detail.quota.storedFileGB} GB` },
        { label: "今日上传（UTC）", value: detail.dailyUploadBytes, limit: detail.quota.dailyUploadMB * 1024 ** 2, display: `${bytes(detail.dailyUploadBytes)} / ${detail.quota.dailyUploadMB} MB` },
        { label: "画布、素材与会话数据", value: structuredBytes, limit: detail.quota.structuredDataMB * 1024 ** 2, display: `${bytes(structuredBytes)} / ${detail.quota.structuredDataMB} MB` },
        { label: "任务与请求日志数据", value: detail.storageUsage.taskBytes, limit: detail.quota.taskDataGB * 1024 ** 3, display: `${bytes(detail.storageUsage.taskBytes)} / ${detail.quota.taskDataGB} GB` },
        { label: "素材数量", value: detail.storageUsage.assetCount, limit: detail.quota.assetCount, display: `${number(detail.storageUsage.assetCount)} / ${number(detail.quota.assetCount)}` },
        { label: "画布数量", value: detail.storageUsage.canvasCount, limit: detail.quota.canvasCount, display: `${number(detail.storageUsage.canvasCount)} / ${number(detail.quota.canvasCount)}` },
        { label: "Agent 会话数量", value: detail.storageUsage.sessionCount, limit: detail.quota.sessionCount, display: `${number(detail.storageUsage.sessionCount)} / ${number(detail.quota.sessionCount)}` },
        { label: "任务历史数量", value: detail.storageUsage.taskCount, limit: detail.quota.taskCount, display: `${number(detail.storageUsage.taskCount)} / ${number(detail.quota.taskCount)}` },
        { label: "上游请求日志数量", value: detail.storageUsage.apiCallCount, limit: detail.quota.apiCallLogCount, display: `${number(detail.storageUsage.apiCallCount)} / ${number(detail.quota.apiCallLogCount)}` },
    ];
}
