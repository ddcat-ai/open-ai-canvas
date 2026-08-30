import { useEffect, useState } from "react";
import { App, Button, Descriptions, Drawer, Empty, Skeleton, Tabs, Typography } from "antd";
import { RefreshCw } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { getAdminApiLog, queryAdminApiLogTask, type ApiCallLog } from "@/services/api/auth";
import { AdminStatusBadge } from "./admin-ui";

export function ApiLogDetailDrawer({ logId, onClose, onLogUpdated }: { logId: string | null; onClose: () => void; onLogUpdated?: (log: ApiCallLog) => void }) {
    const { message } = App.useApp();
    const [log, setLog] = useState<ApiCallLog | null>(null);
    const [loading, setLoading] = useState(false);
    const [querying, setQuerying] = useState(false);
    useEffect(() => {
        if (!logId) return;
        let active = true;
        setLoading(true);
        setLog(null);
        void getAdminApiLog(logId)
            .then((result) => active && setLog(result.log))
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取请求详情失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [logId, message]);

    const queryProviderTask = async () => {
        if (!log) return;
        setQuerying(true);
        try {
            const result = await queryAdminApiLogTask(log.id);
            const refreshed = await getAdminApiLog(log.id);
            setLog(refreshed.log);
            onLogUpdated?.(refreshed.log);
            if (result.recovered) {
                window.dispatchEvent(new CustomEvent("wallet:updated"));
                if (result.billingSettled) message.success("已获取上游视频，任务已恢复并完成结算");
                else message.warning("已获取上游视频，任务已恢复，计费状态待核对");
            } else {
                message.info(`上游任务仍在处理中${result.providerStatus ? `（${result.providerStatus}）` : ""}`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "查询上游任务失败");
        } finally {
            setQuerying(false);
        }
    };

    return (
        <Drawer title="请求详情" open={Boolean(logId)} onClose={onClose} size="min(920px, 100vw)" destroyOnHidden rootClassName="admin-drawer">
            {loading ? <Skeleton active paragraph={{ rows: 12 }} /> : log ? <LogDetail log={log} querying={querying} onQueryProviderTask={queryProviderTask} /> : <Empty description="没有请求详情" />}
        </Drawer>
    );
}

function LogDetail({ log, querying, onQueryProviderTask }: { log: ApiCallLog; querying: boolean; onQueryProviderTask: () => void }) {
    const providerStatus = log.providerStatus?.toLowerCase();
    const processing = ["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "");
    const failed = log.status === "failed" || ["failed", "cancelled", "expired"].includes(providerStatus || "");
    const items = [
        ["时间", new Date(log.startedAt || log.createdAt).toLocaleString("zh-CN", { hour12: false })],
        ["状态", <AdminStatusBadge label={failed ? "失败" : processing ? "处理中" : "成功"} tone={failed ? "error" : processing ? "warning" : "success"} />],
        [
            "用户",
            <span>
                {log.userDisplayName || log.userAccount || "未知用户"}
                {log.userAccount ? <span className="ml-2 text-foreground/45">@{log.userAccount}</span> : null}
            </span>,
        ],
        ["渠道 / 模型", `${log.channelName || "未记录渠道"} / ${log.model || "未识别模型"}`],
        ["能力", capabilityText(log.capability)],
        ["总耗时", formatDuration(log.durationMs)],
        ["视频轮询", log.capability === "video" ? `${log.pollCount || 0} 次` : "--"],
        ["Token", log.usageAvailable ? `${log.inputTokens} 输入 / ${log.outputTokens} 输出 / ${log.cachedTokens} 缓存` : "未返回"],
        ["积分计费", billingText(log)],
        ["上游成本", log.costAvailable ? `${log.currency || "USD"} ${(log.estimatedCostMicros / 1_000_000).toFixed(6)}` : "未配置成本"],
        ["错误信息", [log.errorCode, log.error].filter(Boolean).join(" · ") || "--"],
        ["方法与路径", `${log.method} ${log.path}`],
        ["请求 Content-Type", log.requestContentType || "--"],
        ["HTTP 状态", String(log.statusCode || "--")],
        ["任务 ID", log.taskId || "--"],
        ["供应商任务 ID", log.providerRequestId || "--"],
        ["上游地址", log.upstreamUrl || "--"],
    ].map(([label, children], index) => ({ key: String(index), label, children }));

    const canQueryProviderTask = log.capability === "video" && log.taskStatus === "failed" && Boolean(log.taskId && log.providerRequestId);

    return (
        <div className="space-y-6">
            {canQueryProviderTask ? (
                <div className="flex justify-end">
                    <Button icon={<RefreshCw className="size-4" />} loading={querying} onClick={onQueryProviderTask}>
                        手动查询任务
                    </Button>
                </div>
            ) : null}
            <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }} items={items} />
            <section>
                <div className="mb-2 text-sm font-semibold text-foreground/85">原始报文</div>
                <Tabs
                    items={[
                        { key: "request", label: "请求报文", children: <PayloadPanel value={log.requestBody} empty="该请求未记录请求报文" /> },
                        { key: "response", label: "响应报文", children: <PayloadPanel value={log.responseBody} empty="该请求未记录响应报文" /> },
                    ]}
                />
            </section>
        </div>
    );
}

function billingText(log: ApiCallLog) {
    if (!log.billingAvailable) return "未扣积分";
    const status = log.billingStatus || "reserved";
    const statusLabel = ({ settled: "已结算", refunded: "已退回", uncertain: "待核对", running: "运行中", reserved: "已预授权" } as const)[status];
    return `${formatCredits(log.billingAmountMicrocredits)} 积分 · ${statusLabel}`;
}

function PayloadPanel({ value, empty }: { value?: string; empty: string }) {
    if (!value) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />;
    return (
        <div className="relative">
            <div className="absolute right-3 top-2 z-10">
                <Typography.Text copyable={{ text: value }} className="text-xs text-foreground/50">
                    复制报文
                </Typography.Text>
            </div>
            <pre className="thin-scrollbar max-h-[46vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/70 bg-foreground/[.035] px-4 pb-4 pt-10 font-mono text-xs leading-5 text-foreground/75">{value}</pre>
        </div>
    );
}

function capabilityText(value: string) {
    return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[value] || "未知";
}
function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(1)} 秒`;
    return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1_000)} 秒`;
}
