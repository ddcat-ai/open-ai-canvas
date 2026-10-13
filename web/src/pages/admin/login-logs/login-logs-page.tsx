import { Alert, Button, DatePicker } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { RefreshCw, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { Select } from "@/components/ui/base/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listAdminLoginLogs, type LoginLog } from "@/services/api/login-logs";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSearchInput } from "../components/admin-search-input";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "../components/admin-ui";
import { loginEventLabels, loginLogDevice, loginMethodLabels, loginSourceLabels } from "./login-log-display";
import { LoginLogDetailDrawer } from "./login-log-detail-drawer";
import "./login-logs-page.css";

export default function LoginLogsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("keyword") || "";
    const event = searchParams.get("event") || "";
    const method = searchParams.get("method") || "";
    const result = searchParams.get("result") || "";
    const ip = searchParams.get("ip") || "";
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const rawPage = Number(searchParams.get("page") || 1);
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawSize = Number(searchParams.get("pageSize") || 20);
    const pageSize = [20, 50, 100].includes(rawSize) ? rawSize : 20;
    const debouncedKeyword = useDebouncedValue(keyword);
    const debouncedIP = useDebouncedValue(ip);
    const [logs, setLogs] = useState<LoginLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const [detailId, setDetailId] = useState<string | null>(null);
    const filtered = Boolean(keyword || event || method || result || ip || from || to);

    const update = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        for (const [key, value] of Object.entries(patch)) {
            if (value === "" || (key === "page" && value === 1) || (key === "pageSize" && value === 20)) next.delete(key);
            else next.set(key, String(value));
        }
        setSearchParams(next, { replace });
    };

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError("");
        setLogs([]);
        setTotal(0);
        void listAdminLoginLogs(
            { keyword: debouncedKeyword || undefined, event: event || undefined, method: method || undefined, result: result || undefined, ip: debouncedIP || undefined, from: from || undefined, to: to || undefined, page, pageSize },
            controller.signal,
        )
            .then((data) => {
                if (controller.signal.aborted) return;
                setLogs(data.logs);
                setTotal(data.total);
                if (page > 1 && data.logs.length === 0) update({ page: 1 }, true);
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取登录日志失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [debouncedKeyword, event, method, result, debouncedIP, from, to, page, pageSize, retry]);

    const columns: ColumnsType<LoginLog> = [
        {
            title: "时间",
            width: 180,
            render: (_, log) => (
                <button type="button" className="admin-log-detail-link" aria-label={`查看登录日志 ${log.id} 详情`} onClick={() => setDetailId(log.id)}>
                    {dayjs(log.createdAt).format("YYYY-MM-DD HH:mm:ss")}
                </button>
            ),
        },
        {
            title: "用户 / 账号",
            width: 190,
            render: (_, log) => (
                <div className="min-w-0">
                    <div className="truncate font-medium">{log.displayName || log.username || "未关联用户"}</div>
                    <div className="truncate text-xs text-foreground/50">{log.username ? `@${log.username}` : log.account || "账号未识别"}</div>
                </div>
            ),
        },
        {
            title: "事件",
            width: 160,
            render: (_, log) => (
                <div>
                    <div>{loginEventLabels[log.event]}</div>
                    {log.source === "registration" ? <div className="text-xs text-foreground/50">{loginSourceLabels[log.source]}</div> : null}
                </div>
            ),
        },
        { title: "登录方式", width: 165, render: (_, log) => loginMethodLabels[log.method] },
        { title: "结果", width: 92, render: (_, log) => <AdminStatusBadge label={log.result === "success" ? "成功" : "失败"} tone={log.result === "success" ? "success" : "error"} /> },
        { title: "IP", dataIndex: "ip", width: 175, render: (value: string) => <span className="break-all font-mono text-xs">{value || "未记录"}</span> },
        {
            title: "浏览器 / 系统",
            width: 190,
            render: (_, log) => {
                const device = loginLogDevice(log.userAgent);
                return (
                    <div>
                        <div>{device.browser}</div>
                        <div className="text-xs text-foreground/50">{device.os}</div>
                    </div>
                );
            },
        },
        {
            title: "失败原因",
            width: 250,
            render: (_, log) =>
                log.result === "failed" ? (
                    <div className="line-clamp-2" title={log.message}>
                        {log.message}
                    </div>
                ) : (
                    <span className="text-foreground/35">—</span>
                ),
        },
    ];

    return (
        <AdminPageFrame
            title="用户登录日志"
            description="登录、注册后自动登录与主动退出 · 时间按当前设备时区显示"
            actions={
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => setRetry((value) => value + 1)}>
                    刷新
                </Button>
            }
        >
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title="登录日志读取失败"
                    description={error}
                    action={
                        <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                            重试
                        </Button>
                    }
                />
            ) : null}
            <AdminDataTable<LoginLog>
                toolbar={
                    <div className="admin-login-log-filters">
                        <AdminSearchInput
                            allowClear
                            className="admin-login-log-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="搜索用户昵称、账号或 ID"
                            aria-label="搜索登录日志用户"
                            onValueChange={(value) => update({ keyword: value, page: 1 }, true)}
                        />
                        <Select ariaLabel="事件类型" value={event} options={[{ value: "", label: "全部事件" }, ...Object.entries(loginEventLabels).map(([value, label]) => ({ value, label }))]} onChange={(value) => update({ event: value, page: 1 })} />
                        <Select
                            ariaLabel="登录方式"
                            value={method}
                            options={[{ value: "", label: "全部登录方式" }, ...Object.entries(loginMethodLabels).map(([value, label]) => ({ value, label }))]}
                            onChange={(value) => update({ method: value, page: 1 })}
                        />
                        <Select
                            ariaLabel="登录结果"
                            value={result}
                            options={[
                                { value: "", label: "全部结果" },
                                { value: "success", label: "成功" },
                                { value: "failed", label: "失败" },
                            ]}
                            onChange={(value) => update({ result: value, page: 1 })}
                        />
                        <AdminSearchInput allowClear value={ip} placeholder="筛选 IP" aria-label="筛选登录 IP" onValueChange={(value) => update({ ip: value, page: 1 }, true)} />
                        <DatePicker.RangePicker
                            className="admin-login-log-dates"
                            showTime
                            format="YYYY-MM-DD HH:mm:ss"
                            aria-label="登录日志时间范围"
                            value={[from && dayjs(from).isValid() ? dayjs(from) : null, to && dayjs(to).isValid() ? dayjs(to) : null]}
                            placeholder={["开始时间", "结束时间"]}
                            onChange={(dates) => update({ from: dates?.[0]?.toISOString() || "", to: dates?.[1]?.toISOString() || "", page: 1 })}
                        />
                        <Button
                            type="text"
                            className="admin-login-log-reset"
                            disabled={!filtered}
                            title={filtered ? "清除全部筛选条件" : "当前未应用筛选"}
                            icon={<RotateCcw className="size-3.5" />}
                            onClick={() => update({ keyword: "", event: "", method: "", result: "", ip: "", from: "", to: "", page: 1 })}
                        >
                            重置
                        </Button>
                    </div>
                }
                empty={
                    error ? (
                        <AdminTableEmpty title="日志暂时无法读取" description="请重试，当前未展示查询结果。" />
                    ) : (
                        <AdminTableEmpty filtered={filtered} title={filtered ? "没有匹配的登录日志" : "暂无登录日志"} description={filtered ? "调整筛选条件后重试。" : "开始记录后的登录与主动退出事件将显示在这里。"} />
                    )
                }
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(next, size) => update({ page: next, pageSize: size })} />}
                table={{ rowKey: "id", dataSource: logs, columns, loading, pagination: false, scroll: { x: 1400 }, size: "small" }}
            />
            <LoginLogDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
        </AdminPageFrame>
    );
}
