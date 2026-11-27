import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "antd";
import { RotateCcw } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { AppModal } from "@/components/ui/product/app-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import type { NodeToolbarEntry } from "@/lib/canvas/node-toolbar-entries";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { ToolbarSettingsItem } from "./toolbar-settings-modal";

type Props = {
    open: boolean;
    entries: NodeToolbarEntry[];
    pinnedEntryIds?: string[];
    loading: boolean;
    readError: Error | null;
    onReload: () => void;
    onSave: (ids: string[] | null) => Promise<void>;
    onClose: () => void;
    renderPreview?: (pinnedEntryIds: string[]) => ReactNode;
};

export function NodeToolbarSettingsModal({ open, entries, pinnedEntryIds, loading, readError, onReload, onSave, onClose, renderPreview }: Props) {
    const theme = canvasThemes[useActiveTheme()];
    const reducedMotion = Boolean(useReducedMotion());
    const [draft, setDraft] = useState<string[] | null>(pinnedEntryIds ?? null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const dragged = useRef<string | null>(null);
    const dragTarget = useRef<string | null>(null);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const draftInitialized = useRef(false);
    useEffect(() => {
        if (!open) {
            draftInitialized.current = false;
            return;
        }
        // 本次打开完成首次读取后保留草稿，后台重取不能覆盖用户尚未保存的修改。
        if (loading || readError || draftInitialized.current) return;
        draftInitialized.current = true;
        setDraft(pinnedEntryIds ?? null);
        setSaveError("");
    }, [open, loading, readError, pinnedEntryIds]);
    const defaults = entries.filter((entry) => entry.defaultPinned).map((entry) => entry.id);
    const selected = draft ?? defaults;
    const selectedSet = new Set(selected);
    const entryIds = new Set(entries.map((entry) => entry.id));
    const movable = selected.filter((id) => entryIds.has(id));
    const order = new Map(selected.map((id, index) => [id, index]));
    const sorted = [...entries].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    const move = (id: string, target: string) => {
        const next = [...selected];
        const from = next.indexOf(id);
        const to = next.indexOf(target);
        if (saving || loading || readError || from < 0 || to < 0 || from === to) return;
        next.splice(from, 1);
        next.splice(to, 0, id);
        setDraft(next);
    };
    const save = async () => {
        if (saving || loading || readError) return;
        setSaving(true);
        setSaveError("");
        try {
            await onSave(draft);
            onClose();
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "工具栏配置保存失败，请重试");
        } finally {
            setSaving(false);
        }
    };
    return (
        <AppModal
            open={open}
            title="自定义工具栏"
            width={720}
            centered
            onCancel={() => !saving && onClose()}
            onOk={() => void save()}
            okText="保存"
            confirmLoading={saving}
            okButtonProps={{ disabled: loading || Boolean(readError) }}
            cancelButtonProps={{ disabled: saving }}
            mask={{ closable: !saving }}
            keyboard={!saving}
        >
            <p className="mb-4 text-sm text-muted-foreground">固定后可拖动把手，或点击左右箭头调整位置；预览会实时更新。点击保存后同步到账号。</p>
            {renderPreview ? <div className="mb-4">{renderPreview(selected)}</div> : null}
            {readError ? (
                <div role="alert" className="mb-4 text-sm text-destructive">
                    读取工具栏配置失败：{readError.message}{" "}
                    <Button size="small" onClick={onReload}>
                        重试
                    </Button>
                </div>
            ) : null}
            {saveError ? (
                <p role="alert" className="mb-4 text-sm text-destructive">
                    {saveError}
                </p>
            ) : null}
            <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{loading ? "正在读取账号配置…" : `已固定 ${entries.filter((entry) => selectedSet.has(entry.id)).length}/${entries.length}`}</span>
                <Button size="small" icon={<RotateCcw className="size-3" />} disabled={loading || saving || Boolean(readError)} onClick={() => setDraft(null)}>
                    恢复默认
                </Button>
            </div>
            <fieldset disabled={loading || saving || Boolean(readError)} className="grid max-h-[45vh] grid-cols-2 gap-2 overflow-y-auto border-0 p-0 md:grid-cols-5" aria-label="工具栏入口">
                {sorted.map((entry) => (
                    <ToolbarSettingsItem
                        key={entry.id}
                        item={{ id: entry.id, label: entry.label, icon: entry.icon, visible: selectedSet.has(entry.id) }}
                        theme={theme}
                        reducedMotion={reducedMotion}
                        dragging={draggedId === entry.id}
                        reorderable={selectedSet.has(entry.id)}
                        canMoveBackward={movable.indexOf(entry.id) > 0}
                        canMoveForward={movable.indexOf(entry.id) < movable.length - 1}
                        toggleLabel={`${selectedSet.has(entry.id) ? "取消固定" : "固定"}${entry.label}`}
                        onToggleVisible={(id, visible) => setDraft(visible ? [...selected, id] : selected.filter((value) => value !== id))}
                        onDragStart={(id) => {
                            if (selectedSet.has(id)) {
                                dragged.current = id;
                                dragTarget.current = id;
                                setDraggedId(id);
                            }
                        }}
                        onDragEnter={(id) => {
                            if (dragged.current && dragTarget.current !== id) {
                                dragTarget.current = id;
                                move(dragged.current, id);
                            }
                        }}
                        onDragEnd={() => {
                            dragged.current = null;
                            dragTarget.current = null;
                            setDraggedId(null);
                        }}
                        onMove={
                            selectedSet.has(entry.id)
                                ? (direction) => {
                                      const target = movable[movable.indexOf(entry.id) + direction];
                                      if (target) move(entry.id, target);
                                  }
                                : undefined
                        }
                    />
                ))}
            </fieldset>
        </AppModal>
    );
}
