import { useEffect, useState, type ReactNode } from "react";
import { Alert, App, Button, Drawer, Input, Skeleton, Tabs, Typography } from "antd";
import { AdminEmpty, AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import { Activity, Clipboard, Link2, RefreshCw, Save, Video } from "lucide-react";
import { formatCredits } from "@/constant/credits";
import { getAdminApiLog, queryAdminApiLogTask, recoverAdminApiLogVideoByURL, type ApiCallLog } from "@/services/api/auth";

export function ApiLogDetailDrawer({ logId, onClose, onLogUpdated }: { logId: string | null; onClose: () => void; onLogUpdated?: (log: ApiCallLog) => void }) {
    const { message } = App.useApp();
    const [log, setLog] = useState<ApiCallLog | null>(null);
    const [loading, setLoading] = useState(false);
    const [querying, setQuerying] = useState(false);
    const [providerRequestId, setProviderRequestId] = useState("");
    const [videoURL, setVideoURL] = useState("");
    const [resultText, setResultText] = useState("");

    const refresh = async (id: string) => {
        const refreshed = await getAdminApiLog(id);
        setLog(refreshed.log);
        setProviderRequestId(refreshed.log.providerRequestId || "");
        onLogUpdated?.(refreshed.log);
        return refreshed.log;
    };

    useEffect(() => {
        if (!logId) return;
        let active = true;
        setLoading(true);
        setLog(null);
        setResultText("");
        setVideoURL("");
        void getAdminApiLog(logId)
            .then((result) => {
                if (!active) return;
                setLog(result.log);
                setProviderRequestId(result.log.providerRequestId || "");
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取请求详情失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [logId, message]);

    const runQuery = async () => {
        if (!log) return;
        setQuerying(true);
        setResultText("");
        try {
            const result = await queryAdminApiLogTask(log.id, providerRequestId.trim() || undefined);
            await refresh(log.id);
            if (result.recovered) {
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                setResultText(result.billingSettled ? "查询成功，视频已转存并完成结算。" : "视频已转存，计费状态待核对。");
                message.success("视频任务恢复成功");
            } else {
                setResultText(`上游仍在生成中${result.providerStatus ? `（${result.providerStatus}）` : ""}，暂不扣费。`);
            }
        } catch (error) {
            setResultText(error instanceof Error ? error.message : "查询上游任务失败");
        } finally {
            setQuerying(false);
        }
    };

    const runURLRecovery = async () => {
        if (!log || !videoURL.trim()) return;
        setQuerying(true);
        setResultText("");
        try {
            const result = await recoverAdminApiLogVideoByURL(log.id, videoURL.trim(), providerRequestId.trim() || undefined);
            await refresh(log.id);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            setResultText(result.billingSettled ? "视频已转存并完成结算。" : "视频已转存，计费状态待核对。");
            message.success("视频转存成功");
        } catch (error) {
            setResultText(error instanceof Error ? error.message : "视频转存失败");
        } finally {
            setQuerying(false);
        }
    };

    const title = log ? (
        <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-500/12 text-blue-500">
                <Activity className="size-[18px]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">请求日志详情</div>
                <div className="mt-0.5 truncate text-xs font-normal text-foreground/50">
                    {capabilityText(log.capability)} · {log.model || "未识别模型"} · {formatTime(log.startedAt || log.createdAt)}
                </div>
            </div>
        </div>
    ) : "请求日志详情";

    return (
        <Drawer title={title} open={Boolean(logId)} onClose={onClose} size="min(1120px, 66vw)" destroyOnHidden className="api-log-detail-drawer-panel" rootClassName="admin-drawer api-log-detail-drawer">
            {loading ? <Skeleton active paragraph={{ rows: 10 }} /> : log ? <LogDetail log={log} providerRequestId={providerRequestId} videoURL={videoURL} resultText={resultText} querying={querying} onProviderRequestIdChange={setProviderRequestId} onVideoURLChange={setVideoURL} onQuery={runQuery} onRecoverURL={runURLRecovery} /> : <AdminEmpty size="compact" title="没有请求详情" />}
        </Drawer>
    );
}

type LogDetailProps = {
    log: ApiCallLog;
    providerRequestId: string;
    videoURL: string;
    resultText: string;
    querying: boolean;
    onProviderRequestIdChange: (value: string) => void;
    onVideoURLChange: (value: string) => void;
    onQuery: () => void;
    onRecoverURL: () => void;
};

function LogDetail({ log, providerRequestId, videoURL, resultText, querying, onProviderRequestIdChange, onVideoURLChange, onQuery, onRecoverURL }: LogDetailProps) {
    const providerStatus = log.providerStatus?.toLowerCase();
    const processing = ["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "");
    const failed = log.status === "failed" || ["failed", "cancelled", "expired"].includes(providerStatus || "");
    const storedMedia = log.mediaPreviewUrl?.includes("/api/admin/api-logs/") ?? false;
    const canRepairSucceededTask = log.taskStatus === "succeeded" && !storedMedia;
    const status = failed ? { label: "失败", tone: "error" as const } : processing ? { label: "处理中", tone: "warning" as const } : { label: "成功", tone: "success" as const };

    return (
        <div className="api-log-detail-body">
            <section className="api-log-detail-section">
                <div className="api-log-detail-section-heading">
                    <div>
                        <div className="api-log-detail-eyebrow">REQUEST OVERVIEW</div>
                        <h2>请求概览</h2>
                    </div>
                    <AdminStatusBadge label={status.label} tone={status.tone} />
                </div>
                <div className="api-log-detail-summary-grid">
                    <InfoItem label="能力类型" value={capabilityText(log.capability)} />
                    <InfoItem label="请求阶段" value={requestKindText(log.requestKind)} />
                    <InfoItem label="模型 / 渠道" value={`${log.model || "未识别模型"} / ${log.channelName || "未记录渠道"}`} />
                    <InfoItem label="用户" value={log.userDisplayName || log.userAccount || "未知用户"} detail={log.userAccount ? `@${log.userAccount}` : undefined} />
                    <InfoItem label="任务状态" value={mediaDeliveryText(log)} />
                    <InfoItem label="计费" value={billingText(log)} />
                    <InfoItem label="请求 ID" value={<CopyValue value={log.id} />} />
                    <InfoItem label="任务 ID" value={log.taskId ? <CopyValue value={log.taskId} /> : "未记录"} />
                    <InfoItem label="供应商任务 ID" value={log.providerRequestId ? <CopyValue value={log.providerRequestId} /> : "未记录"} />
                    <InfoItem label="耗时" value={<span className="tabular-nums">{formatDuration(log.durationMs)}</span>} />
                    <InfoItem label="HTTP 状态" value={log.statusCode || "未记录"} />
                    <InfoItem label="请求地址" value={<span className="break-all font-mono text-xs">{log.method} {log.path || "未记录"}</span>} />
                </div>
                {log.error || log.errorCode ? (
                    <div className="api-log-detail-error">
                        <div className="text-xs font-semibold text-red-500">{log.errorCode || `HTTP ${log.statusCode || "失败"}`}</div>
                        <div className="mt-1 text-sm text-foreground/70">{log.error || "上游未返回错误详情"}</div>
                    </div>
                ) : null}
            </section>

            {log.capability === "video" ? (
                <section className="api-log-detail-section api-log-recovery-section">
                    <div className="api-log-detail-section-heading">
                        <div className="flex items-center gap-2.5">
                            <div className="grid size-8 place-items-center rounded-md bg-violet-500/12 text-violet-500">
                                <Video className="size-4" aria-hidden="true" />
                            </div>
                            <div>
                                <div className="api-log-detail-eyebrow">VIDEO RECOVERY</div>
                                <h2>视频任务恢复</h2>
                            </div>
                        </div>
                        <span className="text-xs text-foreground/45">{canRepairSucceededTask ? "成功任务未入库，可补拉" : "失败任务可用"}</span>
                    </div>
                    <div className="api-log-recovery-body">
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>供应商任务 ID</span>
                                <small>默认使用当前记录，可手动覆盖</small>
                            </div>
                            <Input className="api-log-recovery-input" value={providerRequestId} onChange={(event) => onProviderRequestIdChange(event.target.value)} placeholder="输入供应商任务 ID" />
                            <Button icon={<RefreshCw className="size-3.5" />} loading={querying} onClick={onQuery}>{canRepairSucceededTask ? "补拉并入库" : "自动查询"}</Button>
                            <Button type="primary" icon={<Save className="size-3.5" />} loading={querying} onClick={onQuery}>保存并查询</Button>
                        </div>
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>视频 URL 转存</span>
                                <small>仅支持公网 HTTP / HTTPS 视频地址</small>
                            </div>
                            <Input className="api-log-recovery-input" prefix={<Link2 className="size-4 text-foreground/35" />} value={videoURL} onChange={(event) => onVideoURLChange(event.target.value)} placeholder="https://example.com/video.mp4" />
                            <Button icon={<Save className="size-3.5" />} loading={querying} disabled={!videoURL.trim()} onClick={onRecoverURL}>转存并回写</Button>
                        </div>
                        {resultText ? <Alert className="api-log-recovery-result" type={resultText.includes("失败") || resultText.includes("错误") ? "error" : resultText.includes("生成中") ? "warning" : "success"} showIcon message={resultText} /> : null}
                    </div>
                </section>
            ) : null}

            <section className="api-log-detail-section api-log-payload-section">
                <div className="api-log-detail-section-heading">
                    <div>
                        <div className="api-log-detail-eyebrow">RAW PAYLOAD</div>
                        <h2>请求报文</h2>
                    </div>
                    <span className="text-xs text-foreground/45">{log.requestBody || log.responseBody ? "可复制原始内容" : "暂无报文"}</span>
                </div>
                <Tabs items={[{ key: "request", label: "请求", children: <PayloadPanel value={log.requestBody} empty="该请求未记录请求报文" /> }, { key: "response", label: "响应", children: <PayloadPanel value={log.responseBody} empty="该请求未记录响应报文" /> }]} />
            </section>
        </div>
    );
}

function InfoItem({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
    return (
        <div className="api-log-detail-info-item">
            <div className="api-log-detail-info-label">{label}</div>
            <div className="api-log-detail-info-value">{value}</div>
            {detail ? <div className="api-log-detail-info-detail">{detail}</div> : null}
        </div>
    );
}

function CopyValue({ value }: { value: string }) {
    return (
        <Typography.Text className="api-log-copy-value" copyable={{ text: value, tooltips: ["复制", "已复制"] }}>
            <code>{value}</code>
        </Typography.Text>
    );
}

function PayloadPanel({ value, empty }: { value?: string; empty: string }) {
    if (!value) return <AdminEmpty size="compact" title={empty} />;
    return (
        <div className="api-log-payload-wrap">
            <div className="api-log-payload-actions">
                <Typography.Text copyable={{ text: value, tooltips: ["复制报文", "已复制"] }}>
                    <Clipboard className="mr-1 inline size-3.5" />复制报文
                </Typography.Text>
            </div>
            <pre className="api-log-payload">{value}</pre>
        </div>
    );
}

function billingText(log: ApiCallLog) {
    if (!log.billable) return "不计费";
    if (!log.billingAvailable) return "未扣积分";
    const labels = { settled: "已结算", refunded: "已退回", uncertain: "待核对", running: "运行中", reserved: "已预授权" } as const;
    return `${formatCredits(log.billingAmountMicrocredits)} 积分 · ${labels[log.billingStatus || "reserved"]}`;
}

function mediaDeliveryText(log: ApiCallLog) {
    if (log.taskStatus === "succeeded") return log.mediaStage === "completed" ? "已保存并登记" : "任务成功";
    if (log.taskStatus === "failed") return "任务失败";
    return log.taskStatus || "未记录";
}

function requestKindText(value: ApiCallLog["requestKind"]) {
    const labels: Partial<Record<ApiCallLog["requestKind"], string>> = { create: "模型生成", poll: "状态查询", download: "结果下载", upload: "上传 OSS", local_save: "保存文件", register: "登记素材", repair: "结果修复" };
    return labels[value] || "上游请求";
}

function capabilityText(value: string) {
    return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[value] || "未知";
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
    return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1_000)} 秒`;
}
