import { App, Button, InputNumber, Modal, Select, Spin } from "antd";
import { ArrowDown, ArrowUp, GripVertical, ListOrdered } from "lucide-react";
import { useRef, useState } from "react";
import { AdminEmpty } from "@/pages/admin/components/admin-ui";
import { getChannelOrder, saveChannelOrder, type ChannelOrderItem } from "@/services/api/channel-order";

export function moveOrderItem<T extends { id: string }>(items: T[], id: string, target: number): T[] {
    const from = items.findIndex((item) => item.id === id);
    if (from < 0 || !Number.isInteger(target) || target < 0 || target >= items.length || from === target) return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(target, 0, item!);
    return next;
}

export function ChannelOrderDialog({ channelId, onSaved }: { channelId?: string; onSaved: () => Promise<void> }) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false),
        [loading, setLoading] = useState(false),
        [saving, setSaving] = useState(false);
    const [items, setItems] = useState<ChannelOrderItem[]>([]),
        [original, setOriginal] = useState<string[]>([]);
    const [targetId, setTargetId] = useState<string>();
    const [targetPosition, setTargetPosition] = useState<number | null>(null);
    const dragged = useRef<string | null>(null),
        pending = useRef(false);
    const changed = items.some((item, index) => item.id !== original[index]);
    const start = async () => {
        setOpen(true);
        setLoading(true);
        setItems([]);
        setOriginal([]);
        setTargetId(undefined);
        setTargetPosition(null);
        try {
            const result = await getChannelOrder(channelId);
            setItems(result.items);
            setOriginal(result.items.map((item) => item.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取排序失败");
            setOpen(false);
        } finally {
            setLoading(false);
        }
    };
    const save = async () => {
        if (pending.current || !changed) return;
        pending.current = true;
        setSaving(true);
        try {
            await saveChannelOrder(
                channelId,
                items.map((item) => item.id),
                original,
            );
            setOpen(false);
            message.success("排序已保存，用户端按此顺序展示");
            try {
                await onSaved();
            } catch (error) {
                message.warning(error instanceof Error ? `排序已保存，但列表刷新失败：${error.message}` : "排序已保存，请刷新页面查看");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存排序失败");
        } finally {
            pending.current = false;
            setSaving(false);
        }
    };
    return (
        <>
            <Button icon={<ListOrdered className="size-4" />} onClick={() => void start()}>
                {channelId ? "自定义排序" : "设置排序"}
            </Button>
            <Modal
                title={channelId ? "自定义模型排序" : "调整渠道顺序"}
                open={open}
                onCancel={() => setOpen(false)}
                closable={!saving && !loading}
                mask={{ closable: !saving && !loading }}
                keyboard={!saving && !loading}
                width={600}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={saving || loading} onClick={() => setOpen(false)}>
                            取消
                        </Button>
                        <Button type="primary" loading={saving} disabled={!changed || loading} onClick={() => void save()}>
                            保存排序
                        </Button>
                    </div>
                }
            >
                <p className="mb-4 text-sm text-foreground/60">选择条目并输入目标位置，或拖动、点击上下箭头调整顺序。点击“保存排序”后生效，取消会放弃本次调整。这里包含全部条目，不受列表筛选和分页影响。</p>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Select
                        className="min-w-40 flex-1"
                        aria-label={channelId ? "选择要排序的模型" : "选择要排序的渠道"}
                        placeholder={channelId ? "搜索并选择模型" : "搜索并选择渠道"}
                        showSearch={{ optionFilterProp: "label" }}
                        value={targetId}
                        disabled={loading || saving || !items.length}
                        options={items.map((item, index) => ({ value: item.id, label: `${index + 1}. ${item.name}${item.enabled ? "" : "（已停用）"}` }))}
                        onChange={(id: string) => {
                            setTargetId(id);
                            setTargetPosition(items.findIndex((item) => item.id === id) + 1);
                        }}
                    />
                    <InputNumber aria-label="目标位置" placeholder="位置" min={1} max={items.length || 1} precision={0} value={targetPosition} disabled={loading || saving || !targetId} onChange={setTargetPosition} />
                    <Button
                        disabled={loading || saving || !targetId || targetPosition === null || !Number.isInteger(targetPosition) || targetPosition < 1 || targetPosition > items.length}
                        onClick={() => {
                            if (targetId && targetPosition !== null) setItems((current) => moveOrderItem(current, targetId, targetPosition - 1));
                        }}
                    >
                        移动到此位置
                    </Button>
                </div>
                <Spin spinning={loading}>
                    <div className="max-h-[55vh] overflow-y-auto space-y-2" role="list" aria-label="展示顺序">
                        {!loading && !items.length ? (
                            <AdminEmpty size="compact" title="暂无可排序条目" />
                        ) : (
                            items.map((item, index) => (
                                <div
                                    role="listitem"
                                    key={item.id}
                                    draggable={!saving}
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData("text/plain", item.id);
                                        dragged.current = item.id;
                                    }}
                                    onDragEnd={() => {
                                        dragged.current = null;
                                    }}
                                    onDragOver={(event) => {
                                        if (!saving) event.preventDefault();
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const source = dragged.current;
                                        if (!saving && source) setItems((current) => moveOrderItem(current, source, index));
                                        dragged.current = null;
                                    }}
                                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                                >
                                    <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-foreground/40" />
                                    <span className="shrink-0 text-xs tabular-nums text-foreground/50">{index + 1}</span>
                                    <span className="min-w-0 flex-1 break-words">
                                        {item.name}
                                        {!item.enabled && <span className="ml-2 text-xs text-foreground/45">已停用</span>}
                                    </span>
                                    <Button aria-label={`上移${item.name}`} title="上移" icon={<ArrowUp className="size-4" />} disabled={saving || index === 0} onClick={() => setItems((current) => moveOrderItem(current, item.id, index - 1))} />
                                    <Button
                                        aria-label={`下移${item.name}`}
                                        title="下移"
                                        icon={<ArrowDown className="size-4" />}
                                        disabled={saving || index === items.length - 1}
                                        onClick={() => setItems((current) => moveOrderItem(current, item.id, index + 1))}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </Spin>
            </Modal>
        </>
    );
}
