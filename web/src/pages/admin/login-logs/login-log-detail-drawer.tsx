import { Alert, Button, Skeleton } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { AppDrawer } from "@/components/ui/product/app-drawer/app-drawer";
import { getAdminLoginLog, type LoginLog } from "@/services/api/login-logs";
import { loginEventLabels, loginLogDevice, loginMethodLabels, loginSourceLabels } from "./login-log-display";

export function LoginLogDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
    const [detail, setDetail] = useState<LoginLog | null>(null);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        setDetail(null);
        setError("");
        if (!id) return;
        const controller = new AbortController();
        void getAdminLoginLog(id, controller.signal)
            .then(({ log }) => {
                if (!controller.signal.aborted) setDetail(log);
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取日志详情失败");
            });
        return () => controller.abort();
    }, [id, retry]);
    const device = detail ? loginLogDevice(detail.userAgent) : null;
    const entries = detail
        ? [
              ["时间", dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm:ss.SSS Z")],
              ["用户昵称", detail.displayName || "未关联用户"],
              ["账号", detail.username || detail.account || "未识别"],
              ["用户 ID", detail.userId || "未关联用户"],
              ["事件", loginEventLabels[detail.event]],
              ["来源", loginSourceLabels[detail.source]],
              ["登录方式", loginMethodLabels[detail.method]],
              ["结果", detail.result === "success" ? "成功" : "失败"],
              ["IP", detail.ip || "未记录"],
              ["浏览器", device?.browser || "未记录"],
              ["操作系统", device?.os || "未记录"],
              ["客户端自报信息", detail.userAgent || "未记录"],
              ["失败原因", detail.message || "无"],
              ["原因码", detail.reason || "无"],
              ["关联会话标识", detail.sessionRef || "未关联会话"],
              ["日志 ID", detail.id],
          ]
        : [];
    return (
        <AppDrawer title="登录日志详情" open={Boolean(id)} onClose={onClose} size={560}>
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title="详情读取失败"
                    description={error}
                    action={
                        <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                            重试
                        </Button>
                    }
                />
            ) : !detail ? (
                <Skeleton active />
            ) : (
                <dl className="space-y-5">
                    {entries.map(([label, value]) => (
                        <div key={label}>
                            <dt className="mb-1 text-xs text-foreground/50">{label}</dt>
                            <dd className="break-words text-sm text-foreground">{value}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </AppDrawer>
    );
}
