import { Drawer, Button, Input, Popconfirm } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useMemo, useState } from "react";

import { Clock, Clock3, ExternalLink, History, Search, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { StatusBadge } from "@/components/ui/base/badges";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasHistoryStore } from "@/stores/canvas/use-canvas-history-store";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/product/empty-state";

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
    const { t } = useTranslation();
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
            title: p.title || t("canvasB.common.untitledCanvas"),
            isDeleted: false,
            createdAt: p.createdAt || p.updatedAt || new Date().toISOString(),
            updatedAt: p.updatedAt || new Date().toISOString(),
            nodeCount: p.nodes?.length || 0,
            timelineTime: p.createdAt || p.updatedAt || new Date().toISOString(),
        }));

        const deletedList: TimelineItem[] = deletedProjects.map((d) => ({
            id: d.id,
            title: d.title || t("canvasB.common.untitledCanvas"),
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
    }, [activeProjects, deletedProjects, t]);

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
                        <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{t("canvasB.historyDrawer.title")}</span>
                    </div>
                    {deletedProjects.length > 0 ? (
                        <Popconfirm title={t("canvasB.historyDrawer.clearConfirm")} onConfirm={clearDeletedHistory} okText={t("canvasB.common.clear")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                            <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />}>
                                {t("canvasB.historyDrawer.clearDeleted")}
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
                    <Input allowClear prefix={<Search className="size-3.5 text-stone-400" />} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t("canvasB.historyDrawer.searchPlaceholder")} className="text-xs" />
                    <div className="flex items-center gap-2 text-xs">
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-2 font-medium transition-[color,background-color,border-color,box-shadow] duration-150",
                                filter === "all"
                                    ? "!bg-stone-900 !text-white shadow-sm dark:!bg-stone-100 dark:!text-stone-900 font-semibold"
                                    : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700",
                            )}
                            onClick={() => setFilter("all")}
                        >
                            {t("canvasB.historyDrawer.filterAll", { count: timelineItems.length })}
                        </button>
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-2 font-medium transition-[color,background-color,border-color,box-shadow] duration-150",
                                filter === "active"
                                    ? "!bg-emerald-600 !text-white shadow-sm font-semibold"
                                    : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50",
                            )}
                            onClick={() => setFilter("active")}
                        >
                            {t("canvasB.historyDrawer.filterActive", { count: activeProjects.length })}
                        </button>
                        <button
                            type="button"
                            className={cn(
                                "cursor-pointer rounded-lg px-3 py-2 font-medium transition-[color,background-color,border-color,box-shadow] duration-150",
                                filter === "deleted" ? "!bg-rose-600 !text-white shadow-sm font-semibold" : "bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50",
                            )}
                            onClick={() => setFilter("deleted")}
                        >
                            {t("canvasB.historyDrawer.filterDeleted", { count: deletedProjects.length })}
                        </button>
                    </div>
                </div>

                {/* 时间线列表 */}
                {filteredItems.length === 0 ? (
                    <EmptyState description={t("canvasB.historyDrawer.empty")} />
                ) : (
                    <div className="space-y-3 pt-1">
                        {filteredItems.map((item) => {
                            const isDeleted = item.isDeleted;
                            return (
                                <div key={item.id + (item.deletedAt || "")} className="group relative">
                                    <div
                                        className={cn(
                                            "rounded-xl border p-4 transition-colors duration-150 shadow-sm",
                                            isDeleted
                                                ? "border-rose-200/90 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20 hover:border-rose-300"
                                                : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/70 hover:border-stone-300 dark:hover:border-stone-700",
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-2">
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
                                                        <StatusBadge tone="error" size="sm" label={t("canvasB.historyDrawer.deleted")} className="m-0" />
                                                    ) : (
                                                        <StatusBadge tone="success" size="sm" label={t("canvasB.historyDrawer.active")} className="m-0" />
                                                    )}
                                                </div>

                                                <div className="space-y-1 text-xs text-stone-600 dark:text-stone-300">
                                                    <div className="flex items-center gap-2">
                                                        <Clock3 className="size-3.5 text-stone-400 shrink-0" />
                                                        <span>{t("canvasB.historyDrawer.createdAt", { time: formatTimelineDate(item.createdAt) })}</span>
                                                    </div>
                                                    {isDeleted && item.deletedAt ? (
                                                        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-medium">
                                                            <Trash2 className="size-3.5 text-rose-500 shrink-0" />
                                                            <span>{t("canvasB.historyDrawer.deletedAt", { time: formatTimelineDate(item.deletedAt) })}</span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2 text-stone-500 dark:text-stone-400">
                                                            <Clock className="size-3.5 text-stone-400 shrink-0" />
                                                            <span>{t("canvasB.historyDrawer.updatedAt", { time: formatTimelineDate(item.updatedAt) })}</span>
                                                        </div>
                                                    )}
                                                    <div className="text-[var(--fs-label)] text-stone-500 dark:text-stone-400 pt-0.5">{t("canvasB.historyDrawer.nodeCount", { count: item.nodeCount })}</div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                                                {!isDeleted ? (
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<ExternalLink className="size-4 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100" />}
                                                        onClick={() => openProject(item.id)}
                                                        title={t("canvasB.historyDrawer.openCanvas")}
                                                    />
                                                ) : (
                                                    <Tooltip title={t("canvasB.historyDrawer.removeRecord")}>
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
