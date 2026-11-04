import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { CanvasToolPopover } from "./canvas-tool-popover";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Camera, LoaderCircle, Wrench, X } from "lucide-react";

import { listTools, type ToolScope, type ToolSummary } from "@/services/api/tools";
import { FEED_TABS, SUB_TAB_TAGS, toAbsoluteUrl } from "@/lib/canvas/canvas-tool-presentation";

const MOTION_TOOL_PAGE_SIZE = 40;
const SEARCH_DEBOUNCE_MS = 250;

export function CanvasChooseMotionPicker({
    open,
    onOpenChange,
    activeToolIds,
    activeLabel,
    scope = "public",
    tag,
    onSelect,
    onClear,
}: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** 当前提示词中所有 motion 工具标签的 toolId 列表，未选择时为空。 */
    activeToolIds?: number[];
    /** 当前 motion 标签的 label 段，列表未加载或查不到时用于按钮回显。 */
    activeLabel?: string;
    /** 工具范围初始值（public/favorites/custom），弹层内可切换，语义与侧边栏工具面板一致。 */
    scope?: ToolScope;
    /** 标签过滤初始值，弹层内可切换。 */
    tag?: string;
    onSelect: (toolId: number, label: string) => void;
    /** 关闭已选运镜：从提示词移除 motion 工具标签。 */
    onClear?: () => void;
}) {
    const { t } = useTranslation();
    const [internalOpen, setInternalOpen] = useState(false);
    const [searchInput, setSearchInput] = useState("");
    const [searchText, setSearchText] = useState("");
    const [scopeTab, setScopeTab] = useState(scope);
    const [tagFilter, setTagFilter] = useState(tag ?? "");
    const actualOpen = open ?? internalOpen;
    const setOpen = (next: boolean) => {
        setInternalOpen(next);
        onOpenChange?.(next);
    };

    useEffect(() => {
        const timer = window.setTimeout(() => setSearchText(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    const userId = useUserStore((s) => s.user?.id);
    const toolsQuery = useInfiniteQuery({
        queryKey: ["canvas-tools", userId, "motion-picker", scopeTab, tagFilter, searchText],
        queryFn: ({ signal, pageParam }) => listTools({ page: pageParam, pageSize: MOTION_TOOL_PAGE_SIZE, scope: scopeTab, type: "motion", tag: tagFilter || undefined, search: searchText || undefined }, { signal }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
        enabled: actualOpen && Boolean(userId),
    });
    const tools = toolsQuery.data?.pages.flatMap((page) => page.tools) ?? [];
    const activeIdSet = new Set(activeToolIds ?? []);
    const activeTool = tools.find((tool) => activeIdSet.has(tool.id));
    const resolvedLabel = activeTool?.label || activeLabel;

    const handleSelect = (tool: ToolSummary) => {
        setOpen(false);
        onSelect(tool.id, tool.label);
    };

    return (
        <CanvasToolPopover
            label={t("canvasA.toolPicker.motion.select")}
            open={actualOpen}
            onOpenChange={setOpen}
            trigger={["click"]}
            autoAdjustOverflow
            content={
                <div
                    className="canvas-node-toolbar-menu canvas-node-toolbar-menu-style"
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <div className="canvas-node-toolbar-menu-stack">
                        <div className="asset-filters border-b border-border/70 px-2 py-2">
                            <div className="asset-filter-row">
                                <div className="col-feed-tabs shrink-0">
                                    {FEED_TABS.map((tab) => (
                                        <button key={tab.id} type="button" className={`col-feed-tab${scopeTab === tab.id ? " on" : ""}`} aria-pressed={scopeTab === tab.id} onClick={() => setScopeTab(tab.id)}>
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                                <input
                                    className="asset-search min-w-0 flex-1"
                                    placeholder={t("canvasA.toolPicker.searchPlaceholder")}
                                    value={searchInput}
                                    onChange={(event) => setSearchInput(event.target.value)}
                                    aria-label={t("canvasA.toolPicker.motion.search")}
                                />
                                {searchInput ? (
                                    <button
                                        type="button"
                                        className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover hover:text-foreground"
                                        onClick={() => setSearchInput("")}
                                        aria-label={t("canvasA.toolPicker.clearSearch")}
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </div>
                            <div className="col-tag-filter mt-2">
                                {[{ id: "", label: t("canvasA.toolPicker.all") }, ...SUB_TAB_TAGS.motion].map((chip) => (
                                    <button key={chip.id || "all"} type="button" className={`col-tag-chip${tagFilter === chip.id ? " on" : ""}`} aria-pressed={tagFilter === chip.id} onClick={() => setTagFilter(chip.id)}>
                                        {chip.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* 窄屏减到 3 列，网格高度随视口收缩，筛选栏始终可见。 */}
                        <div className="thin-scrollbar grid max-h-[min(20rem,calc(100dvh-14rem))] grid-cols-3 gap-2 overflow-y-auto p-2 min-[520px]:grid-cols-5" role="listbox" aria-label={t("canvasA.toolPicker.motion.list")}>
                            {toolsQuery.isPending ? (
                                <div className="col-span-full grid h-24 place-items-center text-foreground/40">
                                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                                </div>
                            ) : toolsQuery.isError ? (
                                <div className="col-span-full grid h-24 place-items-center text-xs text-foreground/40">{t("canvasA.toolPicker.motion.loadFailed")}</div>
                            ) : tools.length === 0 ? (
                                <div className="col-span-full grid h-24 place-items-center text-xs text-foreground/40">{searchText ? t("canvasA.toolPicker.motion.noMatch") : t("canvasA.toolPicker.motion.empty")}</div>
                            ) : (
                                tools.map((tool) => <MotionToolCard key={tool.id} tool={tool} selected={activeIdSet.has(tool.id)} onSelect={handleSelect} />)
                            )}
                        </div>
                        {toolsQuery.hasNextPage && (
                            <button type="button" disabled={toolsQuery.isFetchingNextPage} onClick={() => void toolsQuery.fetchNextPage()}>
                                {t("canvasA.toolPicker.loadMore")}
                            </button>
                        )}
                    </div>
                </div>
            }
        >
            <div
                role="button"
                tabIndex={0}
                className="canvas-node-composer-header-action canvas-node-fixed-chip relative overflow-hidden cursor-pointer"
                title={resolvedLabel ? t("canvasA.toolPicker.motion.withLabel", { label: resolvedLabel }) : t("canvasA.toolPicker.motion.select")}
                aria-expanded={actualOpen}
                aria-haspopup="dialog"
                onClick={() => setOpen(true)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <Camera className="size-3 shrink-0" />
                <span className="truncate">{resolvedLabel || t("canvasA.toolPicker.motion.short")}</span>
                {activeIdSet.size > 0 && onClear ? (
                    <button
                        type="button"
                        aria-label={t("canvasA.toolPicker.motion.remove")}
                        onClick={(event) => {
                            event.stopPropagation();
                            onClear();
                        }}
                    >
                        <X className="size-3" />
                    </button>
                ) : null}
            </div>
        </CanvasToolPopover>
    );
}

function MotionToolCard({ tool, selected, onSelect }: { tool: ToolSummary; selected: boolean; onSelect: (tool: ToolSummary) => void }) {
    const coverUrl = toAbsoluteUrl(tool.cover);
    const mediaUrl = toAbsoluteUrl(tool.mediaUrl);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [hovered, setHovered] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (hovered && mediaUrl) {
            video.currentTime = 0;
            void video.play().catch(() => {});
        } else {
            video.pause();
        }
    }, [hovered, mediaUrl]);

    return (
        <button
            type="button"
            role="option"
            aria-selected={selected}
            title={tool.desc}
            className={`group flex flex-col gap-1 rounded-[var(--r-md)] border p-2 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none ${selected ? "border-primary/60 ring-1 ring-primary/40" : "border-transparent"}`}
            onClick={() => onSelect(tool)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--r-sm)] border border-border/60">
                {mediaUrl ? (
                    <video ref={videoRef} src={mediaUrl} poster={coverUrl ?? undefined} muted loop playsInline preload="none" className="h-full w-full object-cover" />
                ) : coverUrl ? (
                    <img src={coverUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                    <div className="grid h-full w-full place-items-center text-foreground/30">
                        <Wrench className="size-4" />
                    </div>
                )}
            </div>
            <span className="truncate text-center text-[var(--fs-label)] font-medium leading-4 text-foreground">{tool.label}</span>
        </button>
    );
}
