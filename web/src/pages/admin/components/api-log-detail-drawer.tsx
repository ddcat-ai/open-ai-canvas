import { useEffect, useState } from "react";
import { App, Button, Descriptions, Drawer, Skeleton, Tabs, Typography } from "antd";
import { EmptyState } from "@/components/ui/product/empty-state";
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
        <Drawer title="请求详情" open={Boolean(logId)} onClose={onClose} width="min(1200px, 90vw)" destroyOnHidden rootClassName="admin-drawer">
            {loading ? <Skeleton active paragraph={{ rows: 12 }} /> : log ? <LogDetail log={log} querying={querying} onQueryProviderTask={queryProviderTask} /> : <EmptyState size="compact" title="没有请求详情" />}
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
            <div>
                <div className="font-medium text-foreground/90">{log.userDisplayName || log.userAccount || "未知用户"}</div>
                {log.userAccount ? <div className="mt-0.5 text-xs text-foreground/50">@{log.userAccount}</div> : null}
            </div>,
        ],
        [
            "渠道 / 模型",
            <div>
                <div className="text-foreground/85">{log.channelName || "未记录渠道"}</div>
                <div className="mt-0.5 font-mono text-xs text-foreground/55" title={log.model}>
                    {log.model || "未识别模型"}
                </div>
            </div>,
        ],
        ["能力", capabilityText(log.capability)],
        ["请求阶段", requestKindText(log.requestKind)],
        ["计费属性", log.billable ? "计费调用" : "不计费"],
        ["总耗时", <span className="tabular-nums">{formatDuration(log.durationMs)}</span>],
        ["视频轮询", log.capability === "video" ? <span className="tabular-nums">{log.pollCount || 0} 次</span> : <span className="text-foreground/35">--</span>],
        [
            "Token 用量",
            log.usageAvailable ? (
                <div className="space-y-1 font-mono text-sm tabular-nums">
                    <div>
                        <span className="text-foreground/55">输入</span> <span className="ml-2 text-foreground/85">{log.inputTokens.toLocaleString()}</span>
                    </div>
                    <div>
                        <span className="text-foreground/55">输出</span> <span className="ml-2 text-foreground/85">{log.outputTokens.toLocaleString()}</span>
                    </div>
                    {log.cachedTokens > 0 ? (
                        <div>
                            <span className="text-foreground/55">缓存</span> <span className="ml-2 text-foreground/85">{log.cachedTokens.toLocaleString()}</span>
                        </div>
                    ) : null}
                </div>
            ) : (
                <span className="text-foreground/35">未返回</span>
            ),
        ],
        ["积分计费", billingText(log)],
        ["上游成本", log.costAvailable ? <span className="font-mono tabular-nums">{log.currency || "USD"} {(log.estimatedCostMicros / 1_000_000).toFixed(6)}</span> : <span className="text-foreground/35">未配置成本</span>],
        [
            "错误信息",
            [log.errorCode, log.error].filter(Boolean).length > 0 ? (
                <div>
                    {log.errorCode ? <div className="mb-1 font-mono text-sm font-medium text-red-500">{log.errorCode}</div> : null}
                    {log.error ? <div className="text-sm text-foreground/75">{log.error}</div> : null}
                </div>
            ) : (
                <span className="text-foreground/35">--</span>
            ),
        ],
        ["方法与路径", <code className="text-sm text-foreground/80">{log.method} {log.path}</code>],
        ["请求 Content-Type", log.requestContentType ? <code className="text-sm text-foreground/70">{log.requestContentType}</code> : <span className="text-foreground/35">--</span>],
        ["HTTP 状态", log.statusCode ? <span className="tabular-nums">{log.statusCode}</span> : <span className="text-foreground/35">--</span>],
        ["任务 ID", log.taskId ? <code className="font-mono text-sm text-foreground/70">{log.taskId}</code> : <span className="text-foreground/35">--</span>],
        ["供应商任务 ID", log.providerRequestId ? <code className="font-mono text-sm text-foreground/70">{log.providerRequestId}</code> : <span className="text-foreground/35">--</span>],
        ["上游地址", log.upstreamUrl ? <code className="break-all text-sm text-foreground/70">{log.upstreamUrl}</code> : <span className="text-foreground/35">--</span>],
    ].map(([label, children], index) => ({ key: String(index), label, children }));

    const canQueryProviderTask = log.capability === "video" && log.taskStatus === "failed" && Boolean(log.taskId && log.providerRequestId);

    return (
        <div className="space-y-6">
            {canQueryProviderTask ? (
                <div className="flex justify-end">
                    <Button icon={<RefreshCw className="size-4" />} loading={querying} onClick={onQueryProviderTask}>
                        {querying ? "正在下载并入库" : "手动查询任务"}
                    </Button>
                </div>
            ) : null}
            <Descriptions bordered size="middle" column={{ xs: 1, sm: 1, md: 1, lg: 2, xl: 2 }} labelStyle={{ width: "160px", fontWeight: 500 }} items={items} />
            <section>
                <div className="mb-3 text-base font-semibold text-foreground/90">原始报文</div>
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
    if (!log.billable) return "不计费";
    if (!log.billingAvailable) return "未扣积分";
    const status = log.billingStatus || "reserved";
    const statusLabel = ({ settled: "已结算", refunded: "已退回", uncertain: "待核对", running: "运行中", reserved: "已预授权" } as const)[status];
    return `${formatCredits(log.billingAmountMicrocredits)} 积分 · ${statusLabel}`;
}

function requestKindText(value: ApiCallLog["requestKind"]) {
    const labels: Partial<Record<ApiCallLog["requestKind"], string>> = { create: "模型生成", poll: "状态查询", download: "结果下载", repair: "结果修复" };
    return labels[value] || "上游请求";
}

function PayloadPanel({ value, empty }: { value?: string; empty: string }) {
    if (!value) return <EmptyState size="compact" title={empty} />;
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
