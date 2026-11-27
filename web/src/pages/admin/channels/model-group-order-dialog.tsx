import { App, Button } from "antd";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { saveModelGroupOrder } from "@/services/api/model-group-order";
import { AdminModal } from "@/pages/admin/ui/overlays";

/** 一级目录排序：只调整前台选择器的分组顺序，不改变模型归属。 */
export function ModelGroupOrderDialog({ open, groups, initialOrder, onClose, onSaved }: { open: boolean; groups: string[]; initialOrder: string[]; onClose: () => void; onSaved: (order: string[]) => void }) {
    const { message } = App.useApp();
    const [order, setOrder] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    const orderedGroups = useMemo(() => {
        const known = new Set(groups);
        const picked = initialOrder.filter((name) => known.has(name));
        const seen = new Set(picked);
        const rest = groups.filter((name) => !seen.has(name)).sort((left, right) => left.localeCompare(right, "zh-CN"));
        return [...picked, ...rest];
    }, [groups, initialOrder]);

    useEffect(() => {
        if (open) setOrder(orderedGroups);
    }, [open, orderedGroups]);

    const move = (index: number, offset: number) => {
        const target = index + offset;
        if (target < 0 || target >= order.length) return;
        setOrder((current) => {
            const next = [...current];
            const [item] = next.splice(index, 1);
            next.splice(target, 0, item);
            return next;
        });
    };

    const save = async () => {
        setSaving(true);
        try {
            const result = await saveModelGroupOrder(order);
            message.success("目录顺序已保存");
            onSaved(result.order);
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存目录顺序失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminModal
            open={open}
            title="一级目录排序"
            onCancel={onClose}
            footer={
                <>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" loading={saving} onClick={() => void save()}>
                        保存顺序
                    </Button>
                </>
            }
        >
            <p className="mb-3 text-xs text-foreground/50">只影响前台模型选择器的分组顺序，不改变模型归属。未列出的目录按名称排在后面。</p>
            <div className="max-h-[50vh] space-y-1 overflow-auto">
                {order.map((name, index) => (
                    <div key={name} className="flex items-center gap-2 rounded-md border border-[var(--admin-border)] px-2 py-1.5">
                        <span className="w-6 text-xs text-foreground/40 tabular-nums">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                        <Button size="small" type="text" aria-label={`上移 ${name}`} disabled={index === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => move(index, -1)} />
                        <Button size="small" type="text" aria-label={`下移 ${name}`} disabled={index === order.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => move(index, 1)} />
                    </div>
                ))}
                {order.length === 0 ? <p className="py-6 text-center text-sm text-foreground/45">还没有可排序的一级目录</p> : null}
            </div>
        </AdminModal>
    );
}
