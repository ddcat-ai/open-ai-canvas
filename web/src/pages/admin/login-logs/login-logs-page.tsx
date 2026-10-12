import { App, Button, Segmented } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminFilterChip, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { AdminSearchInput } from "../components/admin-search-input";
import { getAdminLoginLogs, type LoginLogEntry } from "@/services/api/auth";
import type { ColumnsType } from "antd/es/table";

const methodLabels: Record<string, string> = {
    password: "密码登录",
    google: "Google",
    github: "GitHub",
    wechat: "微信",
    qq: "QQ",
    phone: "手机号",
    email_code: "邮箱验证码",
};

const failureLabels: Record<string, string> = {
    invalid_credentials: "用户名或密码错误",
    user_not_found: "用户不存在",
    account_disabled: "账号已禁用",
    rate_limited: "尝试过于频繁",
    invalid_code: "验证码错误",
    oauth_failed: "第三方授权失败",
};

function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function updateUrl(searchParams: URLSearchParams, setSearchParams: (next: URLSearchParams) => void, patch: Record<string, string | number>, resetPage = false) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
        if (value === "" || value === "all") next.delete(key);
        else next.set(key, String(value));
    }
    if (resetPage) next.set("page", "1");
    setSearchParams(next);
}

export default function LoginLogsPage() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = searchParams.get("status") || "all";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10) || 20);

    const [logs, setLogs] = useState<LoginLogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        setLoading(true);
        getAdminLoginLogs({
            keyword: keyword || undefined,
            status: status === "all" ? undefined : status,
            page,
            pageSize,
        })
            .then((data) => {
                setLogs(data.logs);
                setTotal(data.total);
            })
            .catch((err) => {
                message.error(err instanceof Error ? err.message : "加载失败");
                setLogs([]);
                setTotal(0);
            })
            .finally(() => setLoading(false));
    }, [keyword, status, page, pageSize, retry, message]);

    const columns: ColumnsType<LoginLogEntry> = [
        {
            title: "用户",
            dataIndex: "username",
            width: 140,
            render: (username: string, record) => (
                <div className="min-w-0">
                    <div className="truncate font-medium text-foreground/85">{username}</div>
                    {record.userId && <div className="truncate text-xs text-foreground/45">{record.userId}</div>}
                </div>
            ),
        },
        {
            title: "登录方式",
            dataIndex: "method",
            width: 100,
            render: (method: string) => methodLabels[method] || method,
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 80,
            render: (status: string) => <AdminStatusBadge label={status === "success" ? "成功" : "失败"} tone={status === "success" ? "success" : "error"} />,
        },
        {
            title: "失败原因",
            dataIndex: "failureReason",
            width: 140,
            render: (reason: string) => (reason ? failureLabels[reason] || reason : "—"),
        },
        {
            title: "IP 地址",
            dataIndex: "ip",
            width: 130,
            render: (ip: string) => ip || "—",
        },
        {
            title: "地理位置",
            dataIndex: "location",
            width: 100,
            render: (loc: string) => loc || "—",
        },
        {
            title: "User-Agent",
            dataIndex: "userAgent",
            ellipsis: true,
            render: (ua: string) => <span className="text-xs text-foreground/50">{ua || "—"}</span>,
        },
        {
            title: "登录时间",
            dataIndex: "loginAt",
            width: 160,
            render: (t: string) => formatTime(t),
        },
        {
            title: "登出时间",
            dataIndex: "logoutAt",
            width: 160,
            render: (t: string) => (t ? formatTime(t) : "—"),
        },
    ];

    return (
        <AdminPageFrame
            title="登录日志"
            description="全体用户的登录成功与失败记录"
            actions={
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => setRetry((r) => r + 1)}>
                    刷新列表
                </Button>
            }
        >
            <AdminDataTable<LoginLogEntry>
                toolbar={
                    <AdminSearchInput
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索用户名"
                        onValueChange={(value) => updateUrl(searchParams, setSearchParams, { filter: value }, true)}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => updateUrl(searchParams, setSearchParams, { filter: "" }, true)} /> : null}
                        {status !== "all" ? <AdminFilterChip label={`结果：${status === "success" ? "成功" : "失败"}`} onRemove={() => updateUrl(searchParams, setSearchParams, { status: "all" }, true)} /> : null}
                    </>
                }
                toolbarFilters={
                    <Segmented
                        aria-label="登录结果筛选"
                        value={status}
                        onChange={(value) => updateUrl(searchParams, setSearchParams, { status: value as string }, true)}
                        options={[
                            { label: "全部", value: "all" },
                            { label: "成功", value: "success" },
                            { label: "失败", value: "failed" },
                        ]}
                    />
                }
                table={{
                    rowKey: "id",
                    columns,
                    dataSource: logs,
                    loading,
                    pagination: {
                        current: page,
                        pageSize,
                        total,
                        onChange: (p: number, ps: number) => updateUrl(searchParams, setSearchParams, { page: p, pageSize: ps }),
                    },
                    locale: {
                        emptyText: <AdminTableEmpty title="暂无登录记录" description="用户登录后将在此显示" />,
                    },
                }}
            />
        </AdminPageFrame>
    );
}
