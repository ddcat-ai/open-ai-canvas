import { useEffect, useState } from "react";
import { App, Descriptions, Drawer, Empty, Skeleton, Tag } from "antd";

import { getAdminApiLog, type ApiCallLog } from "@/services/api/auth";

export function ApiLogDetailDrawer({ logId, onClose }: { logId: string | null; onClose: () => void }) {
    const { message } = App.useApp();
    const [log, setLog] = useState<ApiCallLog | null>(null);
    const [loading, setLoading] = useState(false);
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
    const items = log
        ? [
              ["时间", new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })],
              ["状态", <Tag color={log.status === "succeeded" ? "success" : "error"}>{log.status === "succeeded" ? "成功" : "失败"}</Tag>],
              ["用户 ID", log.userId],
              ["任务 ID", log.taskId || "--"],
              ["渠道", log.channelName || log.channelId || "--"],
              ["模型", log.model || "--"],
              ["请求阶段", log.requestKind || "--"],
              ["供应商任务 ID", log.providerRequestId || "--"],
              ["方法与路径", `${log.method} ${log.path}`],
              ["HTTP 状态", String(log.statusCode || "--")],
              ["耗时", `${log.durationMs} ms`],
              ["Token", log.usageAvailable ? `${log.inputTokens} 输入 / ${log.outputTokens} 输出 / ${log.cachedTokens} 缓存` : "未返回"],
              ["错误码", log.errorCode || "--"],
              ["错误详情", log.error || "--"],
              ["上游地址", log.upstreamUrl || "--"],
          ].map(([label, children], index) => ({ key: String(index), label, children }))
        : [];
    return (
        <Drawer title="请求详情" open={Boolean(logId)} onClose={onClose} width="min(760px, 100vw)" destroyOnHidden>
            {loading ? <Skeleton active paragraph={{ rows: 10 }} /> : log ? <Descriptions bordered size="small" column={1} items={items} /> : <Empty description="没有请求详情" />}
        </Drawer>
    );
}
