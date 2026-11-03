import { App, Button, Radio, Spin } from "antd";
import { useRef, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { listTaskRetryRoutes, retryGenerationTaskOnRoute, type GenerationTask, type TaskRetryRoute } from "@/services/api/task-center";

export function TaskRouteRetryButton({ taskId, disabled, onRetried }: { taskId: string; disabled?: boolean; onRetried?: (task: GenerationTask) => void }) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [routes, setRoutes] = useState<TaskRetryRoute[]>([]);
    const [selected, setSelected] = useState<number>();
    const [error, setError] = useState("");
    const busy = useRef(false);
    const sequence = useRef(0);
    const load = async () => {
        const request = ++sequence.current;
        setOpen(true);
        setLoading(true);
        setError("");
        setRoutes([]);
        setSelected(undefined);
        try {
            const choices = await listTaskRetryRoutes(taskId);
            if (request === sequence.current) setRoutes(choices);
        } catch (e) {
            if (request === sequence.current) setError(e instanceof Error ? e.message : "读取线路失败");
        } finally {
            if (request === sequence.current) setLoading(false);
        }
    };
    const confirm = async () => {
        const route = selected === undefined ? undefined : routes[selected];
        if (!route || busy.current) return;
        busy.current = true;
        setSaving(true);
        try {
            const task = await retryGenerationTaskOnRoute(taskId, route);
            setOpen(false);
            onRetried?.(task);
            message.success("已按所选线路重新提交");
        } catch (e) {
            setError(e instanceof Error ? e.message : "重试失败");
            setSelected(undefined);
        } finally {
            busy.current = false;
            setSaving(false);
        }
    };
    const price = (route: TaskRetryRoute) => `${(route.amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`;
    return (
        <span data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <Button size="small" disabled={disabled} onClick={() => void load()}>
                换线路重试
            </Button>
            <AppModal
                title="选择另一条线路"
                open={open}
                onCancel={() => {
                    if (!saving) {
                        ++sequence.current;
                        setOpen(false);
                    }
                }}
                onOk={() => void confirm()}
                confirmLoading={saving}
                okButtonProps={{ disabled: selected === undefined || loading || Boolean(error) }}
                okText={selected === undefined ? "确认重试" : `确认重试 · 最多 ${price(routes[selected])}`}
                mask={{ closable: !saving }}
            >
                <p className="mb-4 text-foreground/60">保留原提示词、参考素材和生成参数。只列出支持原参数的同模型线路，本次按所选线路重新计费。</p>
                {loading ? (
                    <Spin />
                ) : error ? (
                    <div role="alert">
                        <p>{error}</p>
                        <Button className="mt-3" onClick={() => void load()}>
                            刷新线路与价格
                        </Button>
                    </div>
                ) : !routes.length ? (
                    <p>暂时没有可用的替代线路。管理员需要为同一模型启用其他分组并配置价格。</p>
                ) : (
                    <Radio.Group value={selected} onChange={(event) => setSelected(event.target.value)} className="flex! flex-col gap-3">
                        {routes.map((route, index) => (
                            <Radio key={`${route.channelId}:${route.modelKey}`} value={index}>
                                <strong>
                                    {route.modelName} · {route.label}
                                </strong>
                                <span className="ml-3">最多 {price(route)}</span>
                            </Radio>
                        ))}
                    </Radio.Group>
                )}
            </AppModal>
        </span>
    );
}
