import { App } from "antd";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { getChannelOrder, saveChannelOrder } from "@/services/api/channel-order";
import { moveWebsiteKeyGroup } from "./channel-key-order";

export function useChannelKeySort({ scopeId, groupIds, onSaved }: { scopeId?: string; groupIds: string[]; onSaved: () => Promise<void> }) {
    const { message } = App.useApp();
    const [sorting, setSorting] = useState(false);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const dragging = useRef<string | null>(null);
    const pending = useRef(false);
    const signature = JSON.stringify(groupIds);
    const clearDrag = () => {
        dragging.current = null;
        setDraggedId(null);
        setDropTarget(null);
    };
    useEffect(clearDrag, [scopeId, signature]);

    const move = async (source: string, target: string) => {
        if (pending.current || source === target || !groupIds.includes(source) || !groupIds.includes(target)) return;
        pending.current = true;
        setSorting(true);
        try {
            const { items } = await getChannelOrder();
            const expected = items.map((item) => item.id);
            const next = moveWebsiteKeyGroup(expected, groupIds, source, target);
            await saveChannelOrder(undefined, next, expected);
            message.success("分组顺序已保存");
            try {
                await onSaved();
            } catch (error) {
                message.warning(error instanceof Error ? `顺序已保存，刷新失败：${error.message}` : "顺序已保存，请刷新页面");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分组排序失败，请重试");
        } finally {
            pending.current = false;
            setSorting(false);
        }
    };

    return {
        sorting,
        draggedId,
        dropTarget,
        dropPosition: draggedId && dropTarget && groupIds.indexOf(draggedId) < groupIds.indexOf(dropTarget) ? "after" : "before",
        handleProps: (id: string) => ({
            draggable: !sorting && groupIds.length > 1,
            disabled: sorting || groupIds.length < 2,
            onDragStart: (event: DragEvent<HTMLButtonElement>) => {
                if (pending.current || groupIds.length < 2) {
                    event.preventDefault();
                    return;
                }
                dragging.current = id;
                setDraggedId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
            },
            onDragEnd: clearDrag,
            onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const target = groupIds[groupIds.indexOf(id) + (event.key === "ArrowUp" ? -1 : 1)];
                if (target) void move(id, target);
            },
        }),
        targetProps: (id: string) => ({
            onDragOver: (event: DragEvent<HTMLElement>) => {
                if (!dragging.current || pending.current || !groupIds.includes(dragging.current)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(id === dragging.current ? null : id);
            },
            onDrop: (event: DragEvent<HTMLElement>) => {
                const source = dragging.current;
                if (!source) return;
                event.preventDefault();
                event.stopPropagation();
                clearDrag();
                void move(source, id);
            },
        }),
    };
}
