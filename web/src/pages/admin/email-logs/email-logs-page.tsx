import { Alert, Button, DatePicker } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { RefreshCw, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Select } from "@/components/ui/base/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listAdminEmailLogs, type EmailLog, type EmailLogPage, type EmailLogPurpose, type EmailLogStatus } from "@/services/api/email";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSearchInput } from "../components/admin-search-input";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "../components/admin-ui";
import "./email-logs-page.css";

export const emailPurposeLabels: Record<EmailLogPurpose, string> = {
    registration: "注册验证码",
    password_reset: "找回密码",
    verification: "身份验证码",
    profile_email: "更换邮箱验证码",
    email_changed: "邮箱变更通知",
    test: "测试邮件",
    consumption_report: "消费日报",
};

const statusMeta: Record<EmailLogStatus, { label: string; tone: "success" | "error" | "neutral" }> = {
    sent: { label: "已投递", tone: "success" },
    failed: { label: "发送失败", tone: "error" },
    skipped: { label: "未发送", tone: "neutral" },
};

const stageLabels: Record<string, string> = {
    connect: "连接服务器",
    connect_tls: "TLS 连接",
    greeting: "等待欢迎语",
    starttls: "STARTTLS 握手",
    auth: "SMTP 登录",
    mail_from: "发件人校验",
    rcpt_to: "收件人校验",
    data: "开始传输",
    write_body: "写入正文",
    finish_data: "提交正文",
    quit: "结束会话",
};

export default function EmailLogsPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("keyword") || "";
    const purpose = searchParams.get("purpose") || "";
    const status = searchParams.get("status") || "";
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const rawPage = Number(searchParams.get("page") || 1);
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawSize = Number(searchParams.get("pageSize") || 20);
    const pageSize = [20, 50, 100].includes(rawSize) ? rawSize : 20;
    const debouncedKeyword = useDebouncedValue(keyword);
    const [data, setData] = useState<EmailLogPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const filtered = Boolean(keyword || purpose || status || from || to);

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
        void listAdminEmailLogs({ keyword: debouncedKeyword || undefined, purpose: purpose || undefined, status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize }, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setData(result);
                if (page > 1 && result.logs.length === 0) update({ page: 1 }, true);
            })
            .catch((cause) => {
                if (controller.signal.aborted) return;
                setData(null);
                setError(cause instanceof Error ? cause.message : "读取邮件发送记录失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [debouncedKeyword, purpose, status, from, to, page, pageSize, retry]);

    const columns: ColumnsType<EmailLog> = [
        { title: "时间", width: 170, render: (_, log) => <span className="font-mono text-xs">{dayjs(log.createdAt).format("YYYY-MM-DD HH:mm:ss")}</span> },
        { title: "收件人", width: 230, render: (_, log) => <span className="break-all">{log.recipient || "—"}</span> },
        { title: "类型", width: 140, render: (_, log) => emailPurposeLabels[log.purpose] ?? log.purpose },
        { title: "结果", width: 100, render: (_, log) => <AdminStatusBadge label={statusMeta[log.status]?.label ?? log.status} tone={statusMeta[log.status]?.tone ?? "neutral"} /> },
        {
            title: "原因 / 失败环节",
            render: (_, log) =>
                log.status === "sent" ? (
                    <span className="text-foreground/40">{log.durationMs ? `用时 ${(log.durationMs / 1000).toFixed(1)} 秒` : "—"}</span>
                ) : (
                    <div className="admin-email-log-reason" title={log.reason}>
                        {log.stage ? <span className="admin-email-log-stage">{stageLabels[log.stage] ?? log.stage}</span> : null}
                        <span>{log.reason || "—"}</span>
                    </div>
                ),
        },
        {
            title: "标题",
            width: 260,
            render: (_, log) => (
                <span className="line-clamp-1 text-foreground/60" title={log.subject}>
                    {log.subject || "—"}
                </span>
            ),
        },
    ];

    const stats = data?.last24h ?? {};
    const failedRecently = (stats.failed ?? 0) > 0;

    return (
        <AdminPageFrame
            title="邮件发送记录"
            description="每封系统邮件的投递结果，保留 90 天 · 不保存正文和验证码"
            actions={
                <div className="flex items-center gap-2">
                    <Link to="/admin/settings/email">
                        <Button>邮件服务设置</Button>
                    </Link>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => setRetry((value) => value + 1)}>
                        刷新
                    </Button>
                </div>
            }
        >
            <div className="admin-email-log-stats" aria-label="近 24 小时发送概况">
                {(["sent", "failed", "skipped"] as const).map((key) => (
                    <button type="button" key={key} className="admin-email-log-stat" aria-pressed={status === key} onClick={() => update({ status: status === key ? "" : key, page: 1 })}>
                        <span>近 24 小时{statusMeta[key].label}</span>
                        <strong data-tone={statusMeta[key].tone}>{stats[key] ?? 0}</strong>
                    </button>
                ))}
            </div>
            {failedRecently ? <Alert type="warning" showIcon title="近 24 小时有邮件发送失败" description="常见原因：SMTP 密码应填写授权码而非登录密码；465 端口须使用直接 TLS；发件邮箱须与 SMTP 账号一致。可在邮件服务设置里发送测试邮件验证。" /> : null}
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title="邮件发送记录读取失败"
                    description={error}
                    action={
                        <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                            重试
                        </Button>
                    }
                />
            ) : null}
            <AdminDataTable<EmailLog>
                toolbar={
                    <div className="admin-email-log-filters">
                        <AdminSearchInput
                            allowClear
                            className="admin-email-log-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="搜索收件邮箱、标题或用户 ID"
                            aria-label="搜索邮件发送记录"
                            onValueChange={(value) => update({ keyword: value, page: 1 }, true)}
                        />
                        <Select
                            ariaLabel="邮件类型"
                            value={purpose}
                            options={[{ value: "", label: "全部类型" }, ...Object.entries(emailPurposeLabels).map(([value, label]) => ({ value, label }))]}
                            onChange={(value) => update({ purpose: value, page: 1 })}
                        />
                        <Select
                            ariaLabel="发送结果"
                            value={status}
                            options={[{ value: "", label: "全部结果" }, ...Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))]}
                            onChange={(value) => update({ status: value, page: 1 })}
                        />
                        <DatePicker.RangePicker
                            showTime
                            format="YYYY-MM-DD HH:mm:ss"
                            aria-label="发送时间范围"
                            value={[from && dayjs(from).isValid() ? dayjs(from) : null, to && dayjs(to).isValid() ? dayjs(to) : null]}
                            placeholder={["开始时间", "结束时间"]}
                            onChange={(dates) => update({ from: dates?.[0]?.toISOString() || "", to: dates?.[1]?.toISOString() || "", page: 1 })}
                        />
                        <Button type="text" disabled={!filtered} icon={<RotateCcw className="size-3.5" />} onClick={() => update({ keyword: "", purpose: "", status: "", from: "", to: "", page: 1 })}>
                            重置
                        </Button>
                    </div>
                }
                empty={
                    error ? (
                        <AdminTableEmpty title="记录暂时无法读取" description="请重试，当前未展示查询结果。" />
                    ) : (
                        <AdminTableEmpty filtered={filtered} title={filtered ? "没有匹配的发送记录" : "暂无邮件发送记录"} description={filtered ? "调整筛选条件后重试。" : "用户请求验证码、找回密码或收到消费日报后，记录会出现在这里。"} />
                    )
                }
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={data?.total ?? 0} onChange={(next, size) => update({ page: next, pageSize: size })} />}
                table={{ rowKey: "id", dataSource: data?.logs ?? [], columns, loading, pagination: false, scroll: { x: 1300 }, size: "small" }}
            />
        </AdminPageFrame>
    );
}
