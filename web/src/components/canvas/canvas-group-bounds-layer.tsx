import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Pencil } from "lucide-react";

import type { CanvasNodeData, Position } from "@/types/canvas";

type DragPreview = { x: number; y: number; nodeIds: Set<string> } | null;

type CanvasGroupBoundsLayerProps = {
    nodeById: Map<string, CanvasNodeData>;
    dragPreview: DragPreview;
    viewportScale: number;
    selectedNodeIds: Set<string>;
    /** 在组内空白/边框按下：选中整组并启动整组拖拽。 */
    onGroupPointerDown: (memberIds: string[], event: ReactMouseEvent) => void;
    onRenameGroup: (groupId: string, name: string) => void;
};

type GroupVisual = {
    groupId: string;
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    memberIds: string[];
    selected: boolean;
    /** 拖拽中因外部节点靠近而实时撑大预览（松手即定下）。 */
    previewing: boolean;
};

// 组边框内边距按 1/scale 补偿，保证屏幕上视觉恒定（与选中虚线框一致）。
const GROUP_PADDING = 12;

/**
 * 持久编组边框：按节点 groupId 推断逻辑组，渲染虚线边框与可编辑组名。
 * 组矩形内部（节点之外的空白）可按下即选中整组并整体拖动；边框四边同样可触发。
 * 渲染在世界层节点之下，节点区域优先接收点击；拖拽时通过 dragPreview 实时跟随。
 */
export const CanvasGroupBoundsLayer = memo(function CanvasGroupBoundsLayer({ nodeById, dragPreview, viewportScale, selectedNodeIds, onGroupPointerDown, onRenameGroup }: CanvasGroupBoundsLayerProps) {
    const inverseScale = 1 / Math.max(viewportScale, 0.05);
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [draftName, setDraftName] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingGroupId) inputRef.current?.select();
    }, [editingGroupId]);

    const groups = useMemo<GroupVisual[]>(() => {
        const byGroup = new Map<string, CanvasNodeData[]>();
        for (const node of nodeById.values()) {
            if (!node.groupId) continue;
            const list = byGroup.get(node.groupId);
            if (list) list.push(node);
            else byGroup.set(node.groupId, [node]);
        }

        type Acc = { groupId: string; memberIds: string[]; left: number; top: number; right: number; bottom: number };
        const acc: Acc[] = [];
        for (const [groupId, members] of byGroup) {
            const offsetOf = (node: CanvasNodeData): Position => (dragPreview && dragPreview.nodeIds.has(node.id) ? { x: dragPreview.x, y: dragPreview.y } : { x: 0, y: 0 });
            let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            for (const node of members) {
                const o = offsetOf(node);
                left = Math.min(left, node.position.x + o.x);
                top = Math.min(top, node.position.y + o.y);
                right = Math.max(right, node.position.x + node.width + o.x);
                bottom = Math.max(bottom, node.position.y + node.height + o.y);
            }
            acc.push({ groupId, memberIds: members.map((node) => node.id), left, top, right, bottom });
        }

        // 拖拽预览：组外（无编组）节点若碰到某编组可见框，实时把该组框撑大到包含该节点（取最小重叠组），松手时由自动编组逻辑定下。
        const previewing = new Set<string>();
        if (dragPreview) {
            for (const id of dragPreview.nodeIds) {
                const node = nodeById.get(id);
                if (!node || node.groupId) continue; // 仅真正组外节点触发预览撑大
                const o = { x: dragPreview.x, y: dragPreview.y };
                const nr = { left: node.position.x + o.x, top: node.position.y + o.y, right: node.position.x + node.width + o.x, bottom: node.position.y + node.height + o.y };
                let best: Acc | null = null;
                let bestArea = Infinity;
                for (const a of acc) {
                    const box = { left: a.left - GROUP_PADDING, top: a.top - GROUP_PADDING, right: a.right + GROUP_PADDING, bottom: a.bottom + GROUP_PADDING };
                    if (nr.left < box.right && nr.right > box.left && nr.top < box.bottom && nr.bottom > box.top) {
                        const area = (a.right - a.left) * (a.bottom - a.top);
                        if (area < bestArea) { bestArea = area; best = a; }
                    }
                }
                if (best) {
                    previewing.add(best.groupId);
                    best.left = Math.min(best.left, nr.left);
                    best.top = Math.min(best.top, nr.top);
                    best.right = Math.max(best.right, nr.right);
                    best.bottom = Math.max(best.bottom, nr.bottom);
                }
            }
        }

        const result: GroupVisual[] = acc.map((a) => ({
            groupId: a.groupId,
            name: byGroup.get(a.groupId)![0]?.groupName?.trim() || "Group",
            left: a.left - GROUP_PADDING * inverseScale,
            top: a.top - GROUP_PADDING * inverseScale,
            width: a.right - a.left + 2 * GROUP_PADDING * inverseScale,
            height: a.bottom - a.top + 2 * GROUP_PADDING * inverseScale,
            memberIds: a.memberIds,
            selected: a.memberIds.every((id) => selectedNodeIds.has(id)),
            previewing: previewing.has(a.groupId),
        }));
        return result;
    }, [nodeById, dragPreview, inverseScale, selectedNodeIds]);

    const stop = (event: ReactMouseEvent | ReactPointerEvent) => event.stopPropagation();

    const startEditing = (group: GroupVisual) => {
        setDraftName(group.name);
        setEditingGroupId(group.groupId);
    };

    const commitEditing = () => {
        if (editingGroupId) onRenameGroup(editingGroupId, draftName);
        setEditingGroupId(null);
    };

    if (!groups.length) return null;

    return (
        <>
            {groups.map((group) => {
                // 选中用主题强调色；未选中用强调色半透明，保证在浅/深背景上都清晰可见。
                const borderColor = group.selected || group.previewing ? "var(--workspace-accent)" : "color-mix(in srgb, var(--workspace-accent) 55%, transparent)";
                const borderStyle: CSSProperties = {
                    left: group.left,
                    top: group.top,
                    width: group.width,
                    height: group.height,
                    borderWidth: Math.max(inverseScale * 1.5, 1.5),
                    borderStyle: "dashed",
                    borderColor,
                };
                const handleDown = (event: ReactMouseEvent) => {
                    stop(event);
                    if (group.memberIds.length) onGroupPointerDown(group.memberIds, event);
                };
                return (
                    <div key={group.groupId} className="pointer-events-none absolute left-0 top-0">
                        <div className="absolute rounded-xl" style={borderStyle} />
                        {/* 组矩形内部（节点之外的空白）与四边：按下即选中整组并整体拖动 */}
                        <div className="pointer-events-auto absolute cursor-grab touch-none active:cursor-grabbing" style={{ left: group.left, top: group.top, width: group.width, height: group.height }} onMouseDown={handleDown} onPointerDown={stop} />
                        {/* 组名标签：铅笔入口单击编辑；不触发整组拖拽 */}
                        <div
                            className="pointer-events-auto absolute flex items-center gap-1 rounded-full border px-2"
                            data-canvas-no-zoom
                            style={{
                                left: group.left,
                                top: group.top - 26 * inverseScale,
                                height: 20 * inverseScale,
                                background: "var(--workspace-surface-strong)",
                                borderColor,
                                color: "var(--foreground)",
                                fontSize: 12 * inverseScale,
                            }}
                            onMouseDown={stop}
                            onPointerDown={stop}
                        >
                            {editingGroupId === group.groupId ? (
                                <input
                                    ref={inputRef}
                                    value={draftName}
                                    onChange={(event) => setDraftName(event.target.value)}
                                    onBlur={commitEditing}
                                    onKeyDown={(event) => {
                                        event.stopPropagation();
                                        if (event.key === "Enter") commitEditing();
                                        else if (event.key === "Escape") setEditingGroupId(null);
                                    }}
                                    onMouseDown={stop}
                                    onPointerDown={stop}
                                    className="bg-transparent outline-none"
                                    style={{ width: `${Math.max(4, draftName.length + 1)}ch`, fontSize: 12 * inverseScale }}
                                    aria-label="编组名称"
                                />
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className="max-w-[24ch] truncate rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                                        style={{ fontSize: 12 * inverseScale, lineHeight: `${20 * inverseScale}px` }}
                                        title="重命名编组"
                                        onClick={(event) => { stop(event); startEditing(group); }}
                                        onMouseDown={stop}
                                        onPointerDown={stop}
                                    >
                                        {group.name}
                                    </button>
                                    <button
                                        type="button"
                                        className="grid place-items-center rounded-full opacity-60 transition hover:opacity-100"
                                        style={{ width: 16 * inverseScale, height: 16 * inverseScale }}
                                        title="重命名编组"
                                        aria-label="重命名编组"
                                        onClick={(event) => { stop(event); startEditing(group); }}
                                        onMouseDown={stop}
                                        onPointerDown={stop}
                                    >
                                        <Pencil style={{ width: 10 * inverseScale, height: 10 * inverseScale }} strokeWidth={2} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                );
            })}
        </>
    );
});
