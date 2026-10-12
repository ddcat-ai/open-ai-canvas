import { useEffect, useState } from "react";
import { App, Pagination, Skeleton, Tag } from "antd";
import { CheckCircle2, XCircle, Globe, Monitor, Clock } from "lucide-react";
import { getLoginLogs, type LoginLogEntry } from "@/services/api/auth";

const methodLabels: Record<string, string> = {
    password: "密码登录",
    linuxdo: "LinuxDO",
    tapnow: "TapNow",
    libtv: "LibTV",
};

const failureLabels: Record<string, string> = {
    invalid_credentials: "账号或密码错误",
    user_disabled: "账号已禁用",
    rate_limited: "请求过于频繁",
    session_error: "会话创建失败",
};

function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function parseUserAgent(ua: string): string {
    if (!ua) return "未知";
    if (/Mobile|Android|iPhone/i.test(ua)) {
        if (/iPhone|iPad/i.test(ua)) return "iOS 设备";
        if (/Android/i.test(ua)) return "Android 设备";
        return "移动设备";
    }
    if (/Edg\//i.test(ua)) return "Edge";
    if (/Chrome\//i.test(ua)) return "Chrome";
    if (/Firefox\//i.test(ua)) return "Firefox";
    if (/Safari\//i.test(ua)) return "Safari";
    return "桌面浏览器";
}

export function LoginLogsPane() {
    const { message } = App.useApp();
    const [logs, setLogs] = useState<LoginLogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const pageSize = 20;

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getLoginLogs({ page, pageSize })
            .then((data) => {
                if (cancelled) return;
                setLogs(data.logs || []);
                setTotal(data.total);
            })
            .catch((err) => {
                if (!cancelled) message.error(err instanceof Error ? err.message : "加载登录日志失败");
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [page, message]);

    return (
        <div className="space-y-4">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>登录日志</h2>
                    <p>最近 90 天的登录记录，包含成功与失败尝试。</p>
                </div>
            </div>

            <div className="settings-section">
                {loading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} active avatar={false} paragraph={{ rows: 1 }} />
                        ))}
                    </div>
                ) : logs.length === 0 ? (
                    <div className="py-8 text-center text-sm text-foreground/50">暂无登录记录</div>
                ) : (
                    <div className="space-y-2">
                        {logs.map((log) => (
                            <div key={log.id} className="flex items-center gap-3 rounded-md border border-border/50 px-3 py-2.5 text-sm">
                                <div className="shrink-0">{log.status === "success" ? <CheckCircle2 className="size-4 text-green-500" /> : <XCircle className="size-4 text-red-500" />}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <span className="font-medium">{methodLabels[log.method] || log.method}</span>
                                        <Tag color={log.status === "success" ? "success" : "error"} className="m-0">
                                            {log.status === "success" ? "成功" : "失败"}
                                        </Tag>
                                        {log.failureReason && <span className="text-xs text-foreground/50">{failureLabels[log.failureReason] || log.failureReason}</span>}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/50">
                                        <span className="inline-flex items-center gap-1">
                                            <Clock className="size-3" />
                                            {formatTime(log.loginAt)}
                                        </span>
                                        {log.ip && (
                                            <span className="inline-flex items-center gap-1">
                                                <Globe className="size-3" />
                                                {log.ip}
                                            </span>
                                        )}
                                        <span className="inline-flex items-center gap-1">
                                            <Monitor className="size-3" />
                                            {parseUserAgent(log.userAgent)}
                                        </span>
                                        {log.location && <span>{log.location}</span>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {total > pageSize && (
                    <div className="mt-4 flex justify-center">
                        <Pagination current={page} pageSize={pageSize} total={total} onChange={setPage} showSizeChanger={false} />
                    </div>
                )}
            </div>
        </div>
    );
}
