import { Button, Switch } from "antd";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
    getAvailableWorkspaceSidebarItems,
    loadWorkspaceSidebarLayout,
    normalizeWorkspaceSidebarLayout,
    orderWorkspaceSidebarItems,
    reorderWorkspaceSidebarLayout,
    resetWorkspaceSidebarLayout,
    saveWorkspaceSidebarLayout,
    WORKSPACE_SIDEBAR_GROUPS,
    type WorkspaceSidebarGroupId,
    type WorkspaceSidebarItem,
    type WorkspaceSidebarLayout,
} from "@/lib/workspace-sidebar-layout";
import { useUserStore } from "@/stores/use-user-store";

import "./workbench-settings.css";

type DropPlacement = "before" | "after";
type DragOverState = { id: string; placement: DropPlacement } | null;

export function WorkbenchSettingsPane() {
    const userId = useUserStore((state) => state.user?.id);
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const features = useUserStore((state) => state.features);
    const items = useMemo(() => getAvailableWorkspaceSidebarItems(features, isAdmin), [features, isAdmin]);
    const [layout, setLayout] = useState<WorkspaceSidebarLayout>(() => loadWorkspaceSidebarLayout());
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<DragOverState>(null);
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const pendingFlipRef = useRef<Map<string, DOMRect> | null>(null);

    useEffect(() => {
        setLayout(loadWorkspaceSidebarLayout());
        setDraggingId(null);
        setDragOver(null);
        setSavedAt(null);
    }, [userId]);

    const orderedItems = useMemo(() => orderWorkspaceSidebarItems(items, normalizeWorkspaceSidebarLayout(layout)), [items, layout]);
    const visibleItems = orderedItems.filter((item) => !layout.hidden.includes(item.id));
    const itemsByGroup = useMemo(
        () => new Map<WorkspaceSidebarGroupId, WorkspaceSidebarItem[]>(WORKSPACE_SIDEBAR_GROUPS.map((group) => [group.id, orderedItems.filter((item) => item.group === group.id)])),
        [orderedItems],
    );

    useLayoutEffect(() => {
        const previousRects = pendingFlipRef.current;
        if (!previousRects) return;
        pendingFlipRef.current = null;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        previousRects.forEach((previousRect, id) => {
            const element = rowRefs.current[id];
            if (!element) return;
            const nextRect = element.getBoundingClientRect();
            const deltaX = previousRect.left - nextRect.left;
            const deltaY = previousRect.top - nextRect.top;
            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
            element.getAnimations().forEach((animation) => animation.cancel());
            element.animate(
                [
                    { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
                    { transform: "translate3d(0, 0, 0)" },
                ],
                { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
            );
        });
    }, [layout]);

    const commit = (nextLayout: WorkspaceSidebarLayout) => {
        const next = normalizeWorkspaceSidebarLayout(nextLayout);
        setLayout(next);
        saveWorkspaceSidebarLayout(next);
        setSavedAt(new Date());
    };

    const toggleItem = (id: string) => {
        const hidden = layout.hidden.includes(id) ? layout.hidden.filter((item) => item !== id) : [...layout.hidden, id];
        commit({ ...layout, hidden });
    };

    const moveItem = (sourceId: string, targetId: string, placement: DropPlacement = "before") => {
        const currentLayout = normalizeWorkspaceSidebarLayout(layout);
        const nextLayout = reorderWorkspaceSidebarLayout(currentLayout, sourceId, targetId, placement);
        if (nextLayout.order.every((id, index) => id === currentLayout.order[index])) return;

        const previousRects = new Map<string, DOMRect>();
        Object.entries(rowRefs.current).forEach(([id, element]) => {
            if (element) previousRects.set(id, element.getBoundingClientRect());
        });
        pendingFlipRef.current = previousRects;
        commit(nextLayout);
    };

    const resetLayout = () => {
        pendingFlipRef.current = null;
        const next = resetWorkspaceSidebarLayout();
        setLayout(next);
        setSavedAt(new Date());
    };

    const renderPreviewItem = (item: WorkspaceSidebarItem) => {
        const Icon = item.icon;
        return (
            <div key={item.id} className="settings-sidebar-preview-item">
                <Icon className="size-4" strokeWidth={1.6} />
                <span>{item.label}</span>
            </div>
        );
    };

    return (
        <div className="settings-workbench-pane">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>自定义区域</h2>
                    <p>管理左侧导航区域显示哪些入口和排列顺序：首页内容仍保持原来的创作页面。</p>
                </div>
                <span className="settings-workbench-save-state" role="status">{savedAt ? `已保存 ${savedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "自动保存"}</span>
            </div>

            <section className="settings-section settings-workbench-preview-section">
                <div className="settings-workbench-section-heading">
                    <div>
                        <h3>侧边栏预览</h3>
                        <p>这里只影响左侧导航，不会改变首页和各功能页面的内容。</p>
                    </div>
                    <span>{visibleItems.length} / {items.length} 个入口</span>
                </div>
                <div className="settings-sidebar-preview">
                    {WORKSPACE_SIDEBAR_GROUPS.map((group) => {
                        const groupItems = (itemsByGroup.get(group.id) || []).filter((item) => !layout.hidden.includes(item.id));
                        if (!groupItems.length) return null;
                        return (
                            <div key={group.id} className="settings-sidebar-preview-group">
                                {group.id === "management" ? <span className="settings-sidebar-preview-heading">{group.label}</span> : null}
                                <div className="settings-sidebar-preview-items">{groupItems.map(renderPreviewItem)}</div>
                            </div>
                        );
                    })}
                    {!visibleItems.length ? <div className="settings-workbench-preview-empty">当前没有显示中的入口，打开下面的开关即可恢复。</div> : null}
                </div>
            </section>

            <section className="settings-section settings-workbench-list-section">
                <div className="settings-workbench-section-heading">
                    <div>
                        <h3>入口显示与顺序</h3>
                        <p>拖动左侧把手，或使用上下按钮调整同一分组内的顺序。</p>
                    </div>
                    <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={resetLayout}>恢复默认</Button>
                </div>
                <div className="settings-workbench-list">
                    {WORKSPACE_SIDEBAR_GROUPS.map((group) => {
                        const groupItems = itemsByGroup.get(group.id) || [];
                        if (!groupItems.length) return null;
                        return (
                            <div key={group.id} className="settings-sidebar-group-list">
                                <div className="settings-sidebar-group-title">{group.label}</div>
                                {groupItems.map((item, index) => {
                                    const visible = !layout.hidden.includes(item.id);
                                    const Icon = item.icon;
                                    const dropPlacement = dragOver?.id === item.id && draggingId !== item.id ? dragOver.placement : null;
                                    return (
                                        <div
                                            key={item.id}
                                            ref={(element) => {
                                                rowRefs.current[item.id] = element;
                                            }}
                                            className={`settings-workbench-row${index === 0 ? " is-first-in-group" : ""}${draggingId === item.id ? " is-dragging" : ""}${dropPlacement ? " is-drag-over" : ""}${dropPlacement === "before" ? " is-drop-before" : ""}${dropPlacement === "after" ? " is-drop-after" : ""}${visible ? "" : " is-hidden"}`}
                                            draggable
                                            onDragStart={(event) => {
                                                setDraggingId(item.id);
                                                setDragOver(null);
                                                event.dataTransfer.effectAllowed = "move";
                                                event.dataTransfer.setData("text/plain", item.id);
                                            }}
                                            onDragOver={(event) => {
                                                event.preventDefault();
                                                event.dataTransfer.dropEffect = "move";
                                                if (!draggingId) return;
                                                if (draggingId === item.id) {
                                                    setDragOver((current) => current ? null : current);
                                                    return;
                                                }
                                                const rect = event.currentTarget.getBoundingClientRect();
                                                const placement: DropPlacement = event.clientY >= rect.top + rect.height / 2 ? "after" : "before";
                                                setDragOver((current) => current?.id === item.id && current.placement === placement ? current : { id: item.id, placement });
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();
                                                const sourceId = draggingId || event.dataTransfer.getData("text/plain");
                                                const placement = dragOver?.id === item.id ? dragOver.placement : "before";
                                                if (sourceId) moveItem(sourceId, item.id, placement);
                                                setDraggingId(null);
                                                setDragOver(null);
                                            }}
                                            onDragEnd={() => {
                                                setDraggingId(null);
                                                setDragOver(null);
                                            }}
                                        >
                                            <span className="settings-workbench-drag-handle" aria-hidden="true"><GripVertical className="size-4" /></span>
                                            <span className="settings-workbench-row-icon"><Icon className="size-4" strokeWidth={1.6} /></span>
                                            <span className="settings-workbench-row-copy">
                                                <strong>{item.label}</strong>
                                                <span>{item.description}</span>
                                            </span>
                                            <div className="settings-workbench-row-controls">
                                                <div className="settings-workbench-order-buttons">
                                                    <button type="button" disabled={index === 0} aria-label={`将${item.label}上移`} title="上移" onClick={() => index > 0 && moveItem(item.id, groupItems[index - 1].id, "before")}><ArrowUp className="size-3.5" /></button>
                                                    <button type="button" disabled={index === groupItems.length - 1} aria-label={`将${item.label}下移`} title="下移" onClick={() => index < groupItems.length - 1 && moveItem(item.id, groupItems[index + 1].id, "after")}><ArrowDown className="size-3.5" /></button>
                                                </div>
                                                <Switch size="small" checked={visible} onChange={() => toggleItem(item.id)} aria-label={`${item.label}显示状态`} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </section>

            <p className="settings-workbench-note">当前布局属于界面偏好，只保存在当前账号的本机浏览器，不会上传素材、密钥或插件代码。工作台插件只提供受控的侧边栏入口，不能直接注入页面脚本。</p>
        </div>
    );
}
