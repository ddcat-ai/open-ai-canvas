import { App, Button } from "antd";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, GripVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { listAdminAllChannelModels, saveDisplayGroupModelOrder, type AdminChannelModelListItem } from "@/services/api/wallet";

export function GroupModelOrderDialog({ group, onClose, onSaved }: { group: string; onClose: () => void; onSaved: () => Promise<void> }) {
    const { message } = App.useApp();
    const [original, setOriginal] = useState<AdminChannelModelListItem[]>([]);
    const [rows, setRows] = useState<AdminChannelModelListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [drag, setDrag] = useState("");
    const [over, setOver] = useState("");

    useEffect(() => {
        let active = true;
        listAdminAllChannelModels().then(({ models }) => {
            if (!active) return;
            const members = models.filter((m) => (m.displayName?.trim() || "未分类") === group)
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.modelKey.localeCompare(b.modelKey) || a.channelName.localeCompare(b.channelName, "zh-CN"));
            setOriginal(members);
            setRows(members);
        }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "读取分组失败"); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [group]);

    function move(from: number, to: number) {
        if (saving || from < 0 || to < 0 || to >= rows.length || from === to) return;
        const next = [...rows];
        next.splice(to, 0, ...next.splice(from, 1));
        setRows(next);
    }

    async function save() {
        setSaving(true);
        try {
            await saveDisplayGroupModelOrder(group, rows.map((m) => m.id), Object.fromEntries(original.map((m) => [m.id, m.sortOrder ?? 0])));
        } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败");
            setSaving(false);
            return;
        }
        message.success("组内顺序已保存");
        onClose();
        try { await onSaved(); } catch { message.error("顺序已保存，刷新列表失败"); }
    }

    const dirty = rows.some((m, i) => m.id !== original[i]?.id);
    return <AdminModal open title={`组内排序 · ${group}`} width={740} onCancel={() => { if (!saving) onClose(); }}
        footer={<><Button onClick={onClose} disabled={saving}>取消</Button><Button type="primary" loading={saving} disabled={!dirty} onClick={save}>保存顺序</Button></>}>
        {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
        <p className="mb-2 text-xs text-foreground/60">{loading ? "读取中…" : `共 ${rows.length} 个模型`}</p>
        <div style={{ maxHeight: "55vh", overflowY: "auto" }} className="space-y-1">
            {rows.map((m, i) => <div key={m.id} className="flex items-center gap-2 rounded-md border border-[var(--admin-border)] px-2 py-1.5"
                style={{ outline: over === m.id && drag !== m.id ? "1px solid var(--ant-color-primary, #1677ff)" : undefined }}
                onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(m.id); } }}
                onDrop={(e) => { if (drag) { e.preventDefault(); move(rows.findIndex((item) => item.id === drag), i); setDrag(""); setOver(""); } }}>
                <span draggable={!saving} title="拖动排序" style={{ cursor: "grab" }} onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", m.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDrag(m.id);
                }} onDragEnd={() => { setDrag(""); setOver(""); }}><GripVertical size={16} /></span>
                <span className="w-6 text-xs text-foreground/50">{i + 1}</span>
                <div className="min-w-0 flex-1 break-all"><div className="text-sm">{m.modelKey}</div><div className="text-xs text-foreground/60">{m.channelName}</div></div>
                {([
                    ["置顶", ArrowUpToLine, 0], ["上移", ArrowUp, i - 1],
                    ["下移", ArrowDown, i + 1], ["置底", ArrowDownToLine, rows.length - 1],
                ] as const).map(([label, Icon, target]) => <Button key={label} size="small" type="text" title={label} aria-label={`${label} ${m.modelKey}`}
                    disabled={saving || target === i || target < 0 || target >= rows.length} icon={<Icon size={15} />} onClick={() => move(i, target)} />)}
            </div>)}
        </div>
    </AdminModal>;
}
