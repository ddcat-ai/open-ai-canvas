import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";

import { RelativeTime } from "@/components/ui/product/relative-time";
import { Switch } from "@/pages/admin/ui/controls";
import { getAdminInspirationFeed, syncAdminInspirationFeed, updateAdminInspirationFeed, type AdminInspirationFeedStatus } from "@/services/api/inspiration-feed";
import { invalidateInspirationCatalog } from "@/services/inspiration-catalog";
import { AdminStatusBadge } from "./admin-ui";

const QUERY_KEY = ["admin", "inspiration-feed"] as const;
const SOURCE_NAMES: Record<string, string> = { youmind: "YouMind", seedance: "awesome-seedance" };

/**
 * 灵感上新：后端定时从上游同步中文提示词，补在灵感大厅的内置目录之后。
 * 开关与同步走独立接口，不进「功能开放」的整包保存。
 */
export function InspirationFeedRow() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState<"toggle" | "sync" | null>(null);
    const query = useQuery({ queryKey: QUERY_KEY, queryFn: ({ signal }) => getAdminInspirationFeed(signal) });
    const status = query.data;

    const apply = (next: AdminInspirationFeedStatus) => {
        queryClient.setQueryData(QUERY_KEY, next);
        invalidateInspirationCatalog();
    };

    const toggle = async (enabled: boolean) => {
        setBusy("toggle");
        try {
            apply(await updateAdminInspirationFeed({ enabled }));
            message.success(enabled ? "灵感上新已开启，稍后自动同步" : "灵感上新已关闭，前台只展示内置目录");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存灵感上新设置失败");
        } finally {
            setBusy(null);
        }
    };

    const sync = async () => {
        setBusy("sync");
        try {
            const next = await syncAdminInspirationFeed();
            apply(next);
            const created = next.sources.reduce((sum, item) => sum + item.created, 0);
            if (next.lastError) message.warning(`部分来源同步失败：${next.lastError}`);
            else message.success(created ? `同步完成，新收录 ${created} 条` : "同步完成，上游暂无新内容");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "灵感上新同步失败");
            void query.refetch();
        } finally {
            setBusy(null);
        }
    };

    const enabled = status?.enabled ?? false;
    return (
        <article id="admin-feature-inspirationFeed" className={`afp-row${enabled ? "" : " is-off"}`}>
            <div className="afp-row-main">
                <span className="afp-row-icon">
                    <Sparkles className="size-4" aria-hidden="true" />
                </span>
                <div className="afp-row-copy">
                    <div className="afp-row-title">
                        <strong>灵感上新</strong>
                        <span className="afp-location">创作首页 · 灵感</span>
                    </div>
                    <p>每 {status?.intervalHours ?? 6} 小时从 YouMind、awesome-seedance 同步正文为中文的新提示词，补充到灵感大厅；英文条目仍随版本更新。</p>
                    {query.isError ? (
                        <p className="afp-row-warning" role="alert">
                            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                            <span>{query.error instanceof Error ? query.error.message : "读取灵感上新状态失败"}</span>
                        </p>
                    ) : status ? (
                        <>
                            <p>
                                已收录 {status.total.toLocaleString("zh-CN")} 条
                                {status.lastAttemptAt ? (
                                    <>
                                        {" · 上次同步 "}
                                        <RelativeTime value={status.lastAttemptAt} />
                                        {status.sources.length ? `（${status.sources.map((item) => `${SOURCE_NAMES[item.sourceId] ?? item.sourceId} 新增 ${item.created}`).join("，")}）` : ""}
                                    </>
                                ) : enabled ? (
                                    " · 等待首次同步（服务启动约 2 分钟后）"
                                ) : null}
                                ，与内置目录重复的条目在灵感大厅自动去重。
                            </p>
                            {status.lastError ? (
                                <p className="afp-row-warning" role="alert">
                                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                                    <span>{status.lastError}</span>
                                </p>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </div>
            <div className="afp-row-control">
                <AdminStatusBadge label={!status ? "读取中" : enabled ? "已开放" : "已关闭"} tone={enabled ? "success" : "neutral"} />
                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={busy === "sync"} disabled={!enabled || busy !== null} onClick={() => void sync()}>
                    立即同步
                </Button>
                <Switch checked={enabled} loading={busy === "toggle"} disabled={!status || busy !== null} onChange={(checked) => void toggle(checked)} aria-label="灵感上新，切换后立即保存" />
            </div>
        </article>
    );
}
