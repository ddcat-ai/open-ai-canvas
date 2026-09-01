import { useMemo, useState } from "react";
import { Drawer, Tag, Button, Input, Popconfirm, Empty, Tooltip } from "antd";
import { Clock, Clock3, ExternalLink, History, Search, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { cn } from "@/lib/utils";

type TimelineItem = {
    id: string;
    title: string;
    isDeleted: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
    nodeCount: number;
    timelineTime: string;
};

export function CanvasHistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const navigate = useNavigate();
    const activeProjects = useCanvasStore((state) => state.projects);
    const deletedProjects = useCanvasHistoryStore((state) => state.deletedProjects);
    const removeDeletedItem = useCanvasHistoryStore((state) => state.removeDeletedHistoryItem);
    const clearDeletedHistory = useCanvasHistoryStore((state) => state.clearDeletedHistory);
    const [keyword, setKeyword] = useState("");
    const [filter, setFilter] = useState<"all" | "active" | "deleted">("all");

    const timelineItems = useMemo<TimelineItem[]>(() => {
        const activeList: TimelineItem[] = activeProjects.map((p) => ({
            id: p.id,
            title: p.title || "未命名画布",
            isDeleted: false,
            createdAt: p.createdAt || p.updatedAt || new Date().toISOString(),
            updatedAt: p.updatedAt || new Date().toISOString(),
            nodeCount: p.nodes?.length || 0,
            timelineTime: p.createdAt || p.updatedAt || new Date().toISOString(),
        }));

        const deletedList: TimelineItem[] = deletedProjects.map((d) => ({
            id: d.id,
            title: d.title || "未命名画布",
            isDeleted: true,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            deletedAt: d.deletedAt,
            nodeCount: d.nodeCount,
            timelineTime: d.deletedAt || d.createdAt,
        }));

        const all = [...activeList, ...deletedList];
        all.sort((a, b) => new Date(b.timelineTime).getTime() - new Date(a.timelineTime).getTime());
        return all;
    }, [activeProjects, deletedProjects]);

    const filteredItems = useMemo(() => {
        const q = keyword.trim().toLowerCase();
        return timelineItems.filter((item) => {
            if (filter === "active" && item.isDeleted) return false;
            if (filter === "deleted" && !item.isDeleted) return false;
            if (!q) return true;
            return item.title.toLowerCase().includes(q);
        });
    }, [filter, keyword, timelineItems]);

    const openProject = (id: string) => {
        navigate(`/canvas/${id}`);
        onClose();
    };

    return (
        <Drawer
            title={
                <div className="flex items-center justify-between gap-2 pr-2">
                    <div className="flex items-center gap-2">
                        <History className="size-4 text-[var(--workspace-accent)]" />
                        <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">画布创建与变更历史时间线</span>
                    </div>
                    {deletedProjects.length > 0 ? (
                        <Popconfirm title="确定清空已删除画布的历史记录？" onConfirm={clearDeletedHistory} okText="清空" okButtonProps={{ danger: true }} cancelText="取消">
                            <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />}>
                                清理删除记录
                            </Button>
                        </Popconfirm>
                    ) : null}
                </div>
            }
            placement="right"
            width={460}
            open={open}
            onClose={onClose}
            className="workspace-drawer canvas-history-drawer"
            styles={{
                header: { borderBottom: "1px solid var(--border-color, rgba(255,255,255,0.08))" },
                body: { padding: "16px 20px" },
            }}
        >
            <div className="space-y-4">
                {/* 搜索与筛选 */}
                <div className="space-y-3">
                    <Input allowClear prefix={<Search className="size-3.5 text-stone-400" />} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索画布名称..." className="text-xs" />
                    <div className="flex items-center gap-2 text-xs">
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-1.5 font-medium transition-all",
                                filter === "all"
                                    ? "!bg-stone-900 !text-white shadow-sm dark:!bg-stone-100 dark:!text-stone-900 font-semibold"
                                    : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700",
                            )}
                            onClick={() => setFilter("all")}
                        >
                            全部 ({timelineItems.length})
                        </button>
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-1.5 font-medium transition-all",
                                filter === "active"
                                    ? "!bg-emerald-600 !text-white shadow-sm font-semibold"
                                    : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50",
                            )}
                            onClick={() => setFilter("active")}
                        >
                            活跃中 ({activeProjects.length})
                        </button>
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-1.5 font-medium transition-all",
                                filter === "deleted" ? "!bg-rose-600 !text-white shadow-sm font-semibold" : "bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50",
                            )}
                            onClick={() => setFilter("deleted")}
                        >
                            已删除 ({deletedProjects.length})
                        </button>
                    </div>
                </div>

                {/* 时间线列表 */}
                {filteredItems.length === 0 ? (
                    <div className="py-12">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配的历史记录" />
                    </div>
                ) : (
                    <div className="relative border-l-2 border-stone-200 dark:border-stone-800 pl-4 space-y-4 pt-1">
                        {filteredItems.map((item) => {
                            const isDeleted = item.isDeleted;
                            return (
                                <div key={item.id + (item.deletedAt || "")} className="group relative">
                                    {/* 时间轴圆点 */}
                                    <span className={cn("absolute -left-[23px] top-3.5 size-3 rounded-full border-2 border-background", isDeleted ? "bg-rose-500 ring-2 ring-rose-500/20" : "bg-emerald-500 ring-2 ring-emerald-500/20")} />

                                    <div
                                        className={cn(
                                            "rounded-xl border p-3.5 transition-all shadow-sm",
                                            isDeleted
                                                ? "border-rose-200/90 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20 hover:border-rose-300"
                                                : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/70 hover:border-stone-300 dark:hover:border-stone-700",
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-1.5">
                                                <div className="flex items-center gap-2">
                                                    {isDeleted ? (
                                                        <span className="truncate text-sm font-semibold text-stone-500 line-through decoration-rose-500/80 decoration-2 dark:text-stone-400" title={item.title}>
                                                            {item.title}
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="truncate text-left text-sm font-semibold text-stone-900 hover:text-blue-600 dark:text-stone-100 dark:hover:text-blue-400 transition-colors"
                                                            onClick={() => openProject(item.id)}
                                                            title={item.title}
                                                        >
                                                            {item.title}
                                                        </button>
                                                    )}
                                                    {isDeleted ? (
                                                        <Tag color="error" className="m-0 text-[11px] leading-tight px-1.5 py-0.5 font-medium">
                                                            已删除
                                                        </Tag>
                                                    ) : (
                                                        <Tag color="success" className="m-0 text-[11px] leading-tight px-1.5 py-0.5 font-medium">
                                                            活跃中
                                                        </Tag>
                                                    )}
                                                </div>

                                                <div className="space-y-1 text-xs text-stone-600 dark:text-stone-300">
                                                    <div className="flex items-center gap-1.5">
                                                        <Clock3 className="size-3.5 text-stone-400 shrink-0" />
                                                        <span>创建时间：{formatTimelineDate(item.createdAt)}</span>
                                                    </div>
                                                    {isDeleted && item.deletedAt ? (
                                                        <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                                                            <Trash2 className="size-3.5 text-rose-500 shrink-0" />
                                                            <span>删除时间：{formatTimelineDate(item.deletedAt)}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 text-stone-500 dark:text-stone-400">
                                                            <Clock className="size-3.5 text-stone-400 shrink-0" />
                                                            <span>最近更新：{formatTimelineDate(item.updatedAt)}</span>
                                                        </div>
                                                    )}
                                                    <div className="text-[11px] text-stone-500 dark:text-stone-400 pt-0.5">包含 {item.nodeCount} 个节点</div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                                {!isDeleted ? (
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<ExternalLink className="size-4 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100" />}
                                                        onClick={() => openProject(item.id)}
                                                        title="打开画布"
                                                    />
                                                ) : (
                                                    <Tooltip title="从历史列表中移除此条记录">
                                                        <Button type="text" size="small" danger icon={<X className="size-4" />} onClick={() => removeDeletedItem(item.id)} />
                                                    </Tooltip>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Drawer>
    );
}

function formatTimelineDate(isoString: string) {
    if (!isoString) return "--";
    const date = new Date(isoString);
    if (!Number.isFinite(date.getTime())) return "--";
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
