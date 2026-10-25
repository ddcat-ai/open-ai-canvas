import { Alert, App, Button, Input, InputNumber, Table, Tooltip } from "antd";
import { RotateCcw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import type { AdminUser } from "@/services/api/auth";
import { getUserGroupRates, saveUserGroupRates, type UserGroupRate, type UserGroupRates } from "@/services/api/user-group-rates";

const formatRate = (value: number | null) => value == null || value === 10000 ? "常规售价" : `售价再享 ${value / 1000} 折`;

export function UserGroupRatesDrawer({ user, onClose }: { user: AdminUser; onClose: () => void }) {
    const { message, modal } = App.useApp();
    const [view, setView] = useState<UserGroupRates>();
    const [items, setItems] = useState<UserGroupRate[]>([]);
    const [query, setQuery] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [retry, setRetry] = useState(0);
    const pending = useRef(false);
    const changed = !!view && JSON.stringify(view.items) !== JSON.stringify(items);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        void getUserGroupRates(user.id).then((result) => {
            if (!cancelled) { setView(result); setItems(result.items); }
        }).catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : "读取额外优惠失败");
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [user.id, retry]);

    const close = () => {
        if (pending.current) return;
        if (changed) modal.confirm({ title: "放弃未保存的优惠修改？", okText: "放弃修改", cancelText: "继续编辑", onOk: onClose });
        else onClose();
    };
    const update = (id: string, value: number | null) => setItems((current) => current.map((item) => item.id === id ? { ...item, multiplierBasisPoints: value } : item));
    const save = async () => {
        if (!view || pending.current) return;
        pending.current = true;
        setSaving(true);
        setError("");
        try {
            const rates = Object.fromEntries(items.filter((item) => item.multiplierBasisPoints != null).map((item) => [item.id, item.multiplierBasisPoints!]));
            await saveUserGroupRates(user.id, rates, view.version);
            message.success("用户额外优惠已保存");
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "保存失败");
        } finally { pending.current = false; setSaving(false); }
    };
    return <AppDrawer open title={`额外优惠 · ${user.displayName || user.username}`} size={720} onClose={close}
        footer={<div className="flex items-center justify-between gap-3"><span className="text-sm text-foreground/55">{items.filter((item) => item.multiplierBasisPoints != null).length} 个额外折扣</span><div className="flex gap-2"><Button onClick={close} disabled={saving}>取消</Button><Button type="primary" loading={saving} disabled={!changed || loading} onClick={() => void save()}>保存</Button></div></div>}>
        <Input aria-label="搜索分组" prefix={<Search size={16} />} placeholder="搜索分组" allowClear value={query} onChange={(event) => setQuery(event.target.value)} className="mb-4" />
        {error && <Alert className="mb-4" type="error" showIcon title={error} action={<Button size="small" disabled={saving} onClick={() => {
            if (changed) modal.confirm({ title: "重新加载会放弃当前修改", okText: "重新加载", cancelText: "继续编辑", onOk: () => setRetry((n) => n + 1) });
            else setRetry((n) => n + 1);
        }}>重新加载</Button>} />}
        <Table<UserGroupRate> rowKey="id" size="small" loading={loading} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 590 }}
            locale={{ emptyText: query ? "没有匹配的分组" : "暂无分组" }}
            dataSource={items.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))}
            columns={[
                { title: "分组", dataIndex: "name", width: 160 },
                { title: "计价基准", width: 115, render: () => "模型常规售价" },
                { title: "额外折扣", width: 185, render: (_, item) => <div className="flex items-center gap-1"><InputNumber aria-label={`${item.name} 额外折扣`} min={0.001} max={10} precision={3} step={0.1} addonAfter="折" disabled={saving || loading}
                    value={item.multiplierBasisPoints == null ? null : item.multiplierBasisPoints / 1000} placeholder="不额外打折" style={{ width: 120 }}
                    onChange={(value) => update(item.id, value == null ? null : Math.round(Number(value) * 1000))} />
                    <Tooltip title="取消额外优惠"><Button type="text" aria-label={`${item.name} 取消额外优惠`} disabled={saving || loading || item.multiplierBasisPoints == null} icon={<RotateCcw size={14} />} onClick={() => update(item.id, null)} /></Tooltip></div> },
                { title: "计费规则", width: 120, render: (_, item) => <span className="tabular-nums font-medium">{formatRate(item.multiplierBasisPoints)}</span> },
            ]} />
    </AppDrawer>;
}
