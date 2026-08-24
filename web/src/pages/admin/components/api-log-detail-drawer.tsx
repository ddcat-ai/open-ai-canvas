import { useEffect, useState } from "react";
import { App, Button, Descriptions, Drawer, Empty, Skeleton, Tabs, Typography } from "antd";
import { RefreshCw } from "lucide-react";

import { getAdminApiLog, queryAdminApiLogTask, type ApiCallLog } from "@/services/api/auth";
import { AdminStatusBadge } from "./admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

export function ApiLogDetailDrawer({ logId, onClose, onLogUpdated }: { logId: string | null; onClose: () => void; onLogUpdated?: (log: ApiCallLog) => void }) {
    const { t } = useTranslation("canvas");
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
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("admin:failed-to-load-request-details")))
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
                if (result.billingSettled) message.success(t("admin:upstream-video-retrieved-task-recovered-and-settled"));
                else message.warning(t("admin:upstream-video-retrieved-task-recovered-billing-pending-verification"));
            } else {
                message.info(`上游任务仍在处理中${result.providerStatus ? `（${result.providerStatus}）` : ""}`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-query-upstream-task"));
        } finally {
            setQuerying(false);
        }
    };

    return (
        <Drawer title={t("admin:request-details-2")} open={Boolean(logId)} onClose={onClose} size="min(920px, 100vw)" destroyOnHidden rootClassName="admin-drawer">
            {loading ? <Skeleton active paragraph={{ rows: 12 }} /> : log ? <LogDetail log={log} querying={querying} onQueryProviderTask={queryProviderTask} /> : <Empty description={t("admin:no-request-details")} />}
        </Drawer>
    );
}

function LogDetail({ log, querying, onQueryProviderTask }: { log: ApiCallLog; querying: boolean; onQueryProviderTask: () => void }) {
    const { t } = useTranslation("canvas");
    const providerStatus = log.providerStatus?.toLowerCase();
    const processing = ["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "");
    const failed = log.status === "failed" || ["failed", "cancelled", "expired"].includes(providerStatus || "");
    const items = [
        [t("admin:time"), new Date(log.startedAt || log.createdAt).toLocaleString("zh-CN", { hour12: false })],
        [t("admin:status"), <AdminStatusBadge label={failed ? t("admin:failed") : processing ? t("admin:processing") : t("admin:succeeded")} tone={failed ? "error" : processing ? "warning" : "success"} />],
        [
            t("admin:users-2"),
            <span>
                {log.userDisplayName || log.userAccount || t("admin:unknown-user")}
                {log.userAccount ? <span className="ml-2 text-foreground/45">@{log.userAccount}</span> : null}
            </span>,
        ],
        [t("admin:channel-model"), `${log.channelName || t("admin:channel-not-recorded")} / ${log.model || t("admin:model-not-identified")}`],
        [t("admin:capability"), capabilityText(log.capability)],
        [t("admin:total-duration"), formatDuration(log.durationMs)],
        [t("admin:video-polling"), log.capability === "video" ? `${log.pollCount || 0} 次` : "--"],
        ["Token", log.usageAvailable ? t("admin:param-in-param-out-param-cached", { inputTokens: log.inputTokens, outputTokens: log.outputTokens, cachedTokens: log.cachedTokens }) : t("admin:not-returned-2")],
        [t("admin:billing"), log.costAvailable ? `${log.currency || "USD"} ${(log.estimatedCostMicros / 1_000_000).toFixed(6)}` : t("admin:no-pricing-configured")],
        [t("admin:error-message"), [log.errorCode, log.error].filter(Boolean).join(" · ") || "--"],
        [t("admin:method-and-path"), `${log.method} ${log.path}`],
        [t("admin:request-content-type"), log.requestContentType || "--"],
        [t("admin:http-status"), String(log.statusCode || "--")],
        [t("admin:task-id"), log.taskId || "--"],
        [t("admin:vendor-task-id"), log.providerRequestId || "--"],
        [t("admin:upstream-url"), log.upstreamUrl || "--"],
    ].map(([label, children], index) => ({ key: String(index), label, children }));

    const canQueryProviderTask = log.capability === "video" && log.taskStatus === "failed" && Boolean(log.taskId && log.providerRequestId);

    return (
        <div className="space-y-6">
            {canQueryProviderTask ? (
                <div className="flex justify-end">
                    <Button icon={<RefreshCw className="size-4" />} loading={querying} onClick={onQueryProviderTask}>
                        {t("admin:query-task-manually")}
                    </Button>
                </div>
            ) : null}
            <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }} items={items} />
            <section>
                <div className="mb-2 text-sm font-semibold text-foreground/85">{t("admin:raw-payloads")}</div>
                <Tabs
                    items={[
                        { key: "request", label: t("admin:request-payload"), children: <PayloadPanel value={log.requestBody} empty={t("admin:the-request-payload-was-not-recorded")} /> },
                        { key: "response", label: t("admin:response-payload"), children: <PayloadPanel value={log.responseBody} empty={t("admin:the-response-payload-was-not-recorded")} /> },
                    ]}
                />
            </section>
        </div>
    );
}

function PayloadPanel({ value, empty }: { value?: string; empty: string }) {
    const { t } = useTranslation("canvas");
    if (!value) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />;
    return (
        <div className="relative">
            <div className="absolute right-3 top-2 z-10">
                <Typography.Text copyable={{ text: value }} className="text-xs text-foreground/50">
                    {t("admin:copy-payload")}
                </Typography.Text>
            </div>
            <pre className="thin-scrollbar max-h-[46vh] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/70 bg-foreground/[.035] px-4 pb-4 pt-10 font-mono text-xs leading-5 text-foreground/75">{value}</pre>
        </div>
    );
}

function capabilityText(value: string) {
    return ({ text: t("admin:text"), image: t("admin:image"), video: t("admin:video"), audio: t("admin:audio") } as Record<string, string>)[value] || t("admin:unknown");
}
function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(1)} 秒`;
    return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1_000)} 秒`;
}
