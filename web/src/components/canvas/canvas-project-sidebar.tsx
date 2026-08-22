import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpRight, BookOpenText, ChevronLeft, ChevronRight, Crosshair, FolderKanban, GripVertical, Images, LocateFixed, LoaderCircle, Palette, Plus, Search, Settings2, X } from "lucide-react";
import { Link } from "react-router";

import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { getProject, getProjectUnit, type ProjectDetail, type ProjectUnit } from "@/services/api/projects";

export const CANVAS_PROJECT_CHAPTER_DND_TYPE = "application/x-infinite-canvas-project-chapter";
export type CanvasProjectChapterPayload = Pick<ProjectUnit, "id" | "title" | "position"> & { projectId: string; sourceText?: string };

const CHAPTER_ROW_HEIGHT = 36;

type CanvasProjectSidebarProps = {
    projectId: string;
    detail?: ProjectDetail;
    onAddChapter: (chapter: CanvasProjectChapterPayload) => void | Promise<void>;
    onLocateStyle: () => void;
    onOpenAssets: () => void;
};

export function CanvasProjectSidebar({ projectId, detail, onAddChapter, onLocateStyle, onOpenAssets }: CanvasProjectSidebarProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [addingId, setAddingId] = useState("");
    const [pendingScrollId, setPendingScrollId] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("zh-CN"));
    const projectQuery = useQuery({ queryKey: ["project", projectId], queryFn: () => getProject(projectId), enabled: Boolean(projectId) && !detail });
    const projectDetail = detail || projectQuery.data;
    const style = resolveProjectCanvasStyle(projectDetail?.project.stylePresetId, projectDetail?.project.styleProfileJson);
    const mediaAssetCount = projectDetail?.assets.filter((asset) => asset.mediaType === "image" || asset.mediaType === "video").length || 0;
    const orderedUnits = useMemo(() => projectDetail?.units.slice().sort((left, right) => left.position - right.position) || [], [projectDetail?.units]);
    const visibleUnits = useMemo(() => {
        if (!deferredQuery) return orderedUnits.map((unit, index) => ({ unit, index }));
        const numericQuery = /^\d+$/.test(deferredQuery) ? deferredQuery.replace(/^0+/, "") || "0" : "";
        return orderedUnits.reduce<Array<{ unit: ProjectUnit; index: number }>>((result, unit, index) => {
            const chapterNumber = String(index + 1);
            const matchesNumber = numericQuery && chapterNumber.startsWith(numericQuery);
            const matchesTitle = unit.title.toLocaleLowerCase("zh-CN").includes(deferredQuery);
            if (matchesNumber || matchesTitle) result.push({ unit, index });
            return result;
        }, []);
    }, [deferredQuery, orderedUnits]);
    const selectedUnit = orderedUnits.find((unit) => unit.id === selectedId);
    const selectedUnitQuery = useQuery({
        queryKey: ["project-unit", projectId, selectedId],
        queryFn: () => getProjectUnit(projectId, selectedId),
        enabled: Boolean(projectId && selectedId),
    });
    const chapterVirtualizer = useVirtualizer({
        count: visibleUnits.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => CHAPTER_ROW_HEIGHT,
        getItemKey: (index) => visibleUnits[index]?.unit.id || index,
        initialOffset: () => readStoredScroll(`canvas-project-chapters:${projectId}`),
        onChange: (instance, scrolling) => {
            if (!scrolling && instance.scrollOffset !== null) sessionStorage.setItem(`canvas-project-chapters:${projectId}`, String(instance.scrollOffset));
        },
        overscan: 12,
    });

    useEffect(() => {
        if (!pendingScrollId) return;
        const index = visibleUnits.findIndex(({ unit }) => unit.id === pendingScrollId);
        if (index < 0) return;
        chapterVirtualizer.scrollToIndex(index, { align: "center" });
        setPendingScrollId("");
    }, [chapterVirtualizer, pendingScrollId, visibleUnits]);

    useEffect(() => {
        if (!selectedId) return;
        const closePreview = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSelectedId("");
        };
        document.addEventListener("keydown", closePreview);
        return () => document.removeEventListener("keydown", closePreview);
    }, [selectedId]);

    const revealSelectedChapter = () => {
        if (!selectedId) return;
        setQuery("");
        setPendingScrollId(selectedId);
    };
    const selectFirstSearchResult = () => {
        const first = visibleUnits[0];
        if (!first) return;
        setSelectedId(first.unit.id);
        chapterVirtualizer.scrollToIndex(0, { align: "center" });
    };
    const insertChapter = async (unit: ProjectUnit, sourceText?: string) => {
        if (addingId) return;
        setAddingId(unit.id);
        try {
            await onAddChapter({ id: unit.id, projectId, title: unit.title, position: unit.position, sourceText });
        } finally {
            setAddingId("");
        }
    };

    if (collapsed) {
        return (
            <aside className="relative z-[var(--z-panel)] hidden w-11 shrink-0 flex-col items-center border-r border-border bg-background/94 py-2 backdrop-blur-xl lg:flex">
                <button type="button" className="grid size-7 place-items-center rounded-md text-foreground/55 hover:bg-surface-hover" title="展开项目侧栏" aria-label="展开项目侧栏" onClick={() => setCollapsed(false)}>
                    <ChevronRight className="size-4" />
                </button>
                <Link to={`/projects/${projectId}/canvases`} className="mt-2 grid size-7 place-items-center rounded-md text-foreground/55 hover:bg-surface-hover" title="返回项目画布列表">
                    <FolderKanban className="size-4" />
                </Link>
            </aside>
        );
    }

    return (
        <aside className="relative z-[var(--z-panel)] hidden w-[var(--canvas-sidebar-width)] shrink-0 flex-col border-r border-border bg-background/94 backdrop-blur-xl lg:flex">
            <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5">
                <Link to={`/projects/${projectId}/canvases`} className="flex min-w-0 items-center gap-2 text-xs font-semibold" title="返回项目画布列表">
                    <FolderKanban className="size-3.5 shrink-0" />
                    <span className="truncate">{projectDetail?.project.name || "项目空间"}</span>
                </Link>
                <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md text-foreground/45 hover:bg-surface-hover" title="收起项目侧栏" aria-label="收起项目侧栏" onClick={() => setCollapsed(true)}>
                    <ChevronLeft className="size-4" />
                </button>
            </header>

            <section className="shrink-0 border-b border-border/70 p-2">
                <div className="mb-1.5 flex h-5 items-center justify-between px-1 text-[var(--fs-label)] font-medium text-foreground/48">
                    <span className="flex items-center gap-1.5">
                        <Palette className="size-3.5" />
                        项目画风
                    </span>
                    <Link to={`/projects/${projectId}/settings`} className="grid size-6 place-items-center rounded text-foreground/35 hover:bg-surface-hover hover:text-foreground" title="编辑项目画风" aria-label="编辑项目画风">
                        <Settings2 className="size-3.5" />
                    </Link>
                </div>
                <button
                    type="button"
                    disabled={!style}
                    onClick={onLocateStyle}
                    className="group flex h-11 w-full items-center gap-2 rounded-md px-1.5 text-left hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
                    title={style ? "定位画布中的项目画风节点" : "项目尚未设置画风"}
                >
                    {style ? (
                        <img src={style.imageUrl} alt="" width={48} height={32} className="h-8 w-12 shrink-0 rounded object-cover" />
                    ) : (
                        <span className="grid h-8 w-12 shrink-0 place-items-center rounded border border-dashed border-border text-foreground/30">
                            <Palette className="size-3.5" />
                        </span>
                    )}
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{style?.title || "尚未设置画风"}</span>
                        <span className="mt-0.5 block truncate text-[var(--fs-micro)] text-foreground/38">{style ? "随项目设置自动同步" : "前往项目设置选择"}</span>
                    </span>
                    {style ? <LocateFixed className="size-3.5 shrink-0 text-foreground/25 group-hover:text-[var(--workspace-accent)]" /> : null}
                </button>
            </section>

            <section className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-9 shrink-0 items-center justify-between px-3">
                    <span className="flex items-center gap-1.5 text-[var(--fs-label)] font-medium text-foreground/48">
                        <BookOpenText className="size-3.5" />
                        剧情章节 <span className="tabular-nums text-foreground/32">{orderedUnits.length.toLocaleString("zh-CN")}</span>
                    </span>
                    {selectedId ? (
                        <button type="button" onClick={revealSelectedChapter} className="grid size-6 place-items-center rounded text-foreground/35 hover:bg-surface-hover hover:text-foreground" title="回到当前章节" aria-label="回到当前章节">
                            <Crosshair className="size-3.5" />
                        </button>
                    ) : null}
                </div>
                <div className="shrink-0 px-2 pb-2">
                    <label className="flex h-8 items-center gap-1.5 rounded-md border border-border/75 bg-foreground/[.025] px-2 focus-within:border-[var(--workspace-accent)] focus-within:ring-2 focus-within:ring-[var(--workspace-accent-soft)]">
                        <Search className="size-3.5 shrink-0 text-foreground/32" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") selectFirstSearchResult();
                            }}
                            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-foreground/28"
                            placeholder="搜索标题或输入章节序号"
                            aria-label="搜索项目章节"
                        />
                        {query ? (
                            <button type="button" onClick={() => setQuery("")} className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover hover:text-foreground" aria-label="清空章节搜索">
                                <X className="size-3" />
                            </button>
                        ) : null}
                    </label>
                    {deferredQuery ? <div className="mt-1 px-0.5 text-[var(--fs-micro)] tabular-nums text-foreground/35">找到 {visibleUnits.length.toLocaleString("zh-CN")} 章</div> : null}
                </div>

                <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5" aria-label="项目章节列表">
                    {visibleUnits.length ? (
                        <div className="relative w-full" style={{ height: chapterVirtualizer.getTotalSize() }}>
                            {chapterVirtualizer.getVirtualItems().map((virtualItem) => {
                                const item = visibleUnits[virtualItem.index];
                                if (!item) return null;
                                const { unit, index } = item;
                                const active = unit.id === selectedId;
                                return (
                                    <div key={unit.id} className="absolute left-0 top-0 w-full" style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}>
                                        <div
                                            draggable
                                            onDragStart={(event) => {
                                                const payload: CanvasProjectChapterPayload = { id: unit.id, projectId, title: unit.title, position: unit.position };
                                                event.dataTransfer.setData(CANVAS_PROJECT_CHAPTER_DND_TYPE, JSON.stringify(payload));
                                                event.dataTransfer.effectAllowed = "copy";
                                            }}
                                            className={`group flex h-9 cursor-grab items-center gap-1 rounded-md px-1 text-xs active:cursor-grabbing ${active ? "bg-surface-active" : "hover:bg-surface-hover"}`}
                                        >
                                            <GripVertical className="size-3.5 shrink-0 text-foreground/22" />
                                            <button
                                                type="button"
                                                onClick={() => setSelectedId(unit.id)}
                                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]"
                                                aria-label={`预览第 ${index + 1} 章 ${unit.title}`}
                                            >
                                                <span className="w-7 shrink-0 text-[var(--fs-micro)] tabular-nums text-foreground/34">{String(index + 1).padStart(Math.max(2, String(orderedUnits.length).length), "0")}</span>
                                                <span className="min-w-0 flex-1 truncate text-foreground/68">{unit.title}</span>
                                            </button>
                                            <button
                                                type="button"
                                                disabled={Boolean(addingId)}
                                                className="grid size-6 shrink-0 place-items-center rounded text-foreground/30 opacity-0 hover:bg-[var(--workspace-accent-soft)] hover:text-[var(--workspace-accent)] group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-wait"
                                                title="添加到画布中央"
                                                aria-label={`添加${unit.title}到画布`}
                                                onClick={() => void insertChapter(unit)}
                                            >
                                                {addingId === unit.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="px-2 py-8 text-center text-xs text-foreground/40">{orderedUnits.length ? "没有匹配的章节" : "暂无章节"}</div>
                    )}
                </div>
            </section>

            <section className="shrink-0 border-t border-border/70 p-2">
                <button type="button" onClick={onOpenAssets} className="flex h-9 w-full items-center gap-2 rounded-md border border-border/45 px-2 text-xs text-foreground/65 hover:border-[var(--workspace-accent)] hover:bg-[var(--workspace-accent-soft)]">
                    <Images className="size-3.5 text-foreground/42" />
                    <span className="flex-1 text-left">引用项目资产</span>
                    <span className="rounded bg-foreground/[.06] px-1.5 py-0.5 text-[var(--fs-micro)] tabular-nums text-foreground/45">{mediaAssetCount.toLocaleString("zh-CN")}</span>
                </button>
            </section>

            {selectedUnit ? (
                <ChapterPreview
                    projectId={projectId}
                    unit={selectedUnitQuery.data?.unit || selectedUnit}
                    chapterNumber={orderedUnits.findIndex((unit) => unit.id === selectedUnit.id) + 1}
                    loading={selectedUnitQuery.isLoading}
                    loadError={selectedUnitQuery.isError}
                    adding={addingId === selectedUnit.id}
                    onAdd={() => insertChapter(selectedUnit, selectedUnitQuery.data?.unit.sourceText)}
                    onClose={() => setSelectedId("")}
                />
            ) : null}
        </aside>
    );
}

function ChapterPreview({
    projectId,
    unit,
    chapterNumber,
    loading,
    loadError,
    adding,
    onAdd,
    onClose,
}: {
    projectId: string;
    unit: ProjectUnit;
    chapterNumber: number;
    loading: boolean;
    loadError: boolean;
    adding: boolean;
    onAdd: () => void | Promise<void>;
    onClose: () => void;
}) {
    const text = htmlToPlainText(unit.sourceText);
    return (
        <section
            className="absolute bottom-20 left-[calc(100%+8px)] top-14 z-[var(--z-panel-floating)] flex w-[var(--panel-width-compact)] flex-col overflow-hidden rounded-lg border border-border/85 bg-background/[.96] shadow-[0_18px_48px_rgba(0,0,0,.22)] backdrop-blur-xl"
            aria-label={`第 ${chapterNumber} 章预览`}
        >
            <header className="flex items-start gap-2 border-b border-border/70 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                    <div className="text-[var(--fs-tiny)] tabular-nums text-foreground/38">第 {chapterNumber.toLocaleString("zh-CN")} 章</div>
                    <h2 className="mt-0.5 truncate text-sm font-semibold">{unit.title}</h2>
                </div>
                <button type="button" onClick={onClose} className="grid size-6 shrink-0 place-items-center rounded text-foreground/38 hover:bg-surface-hover hover:text-foreground" aria-label="关闭章节预览">
                    <X className="size-3.5" />
                </button>
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <p className="whitespace-pre-wrap text-xs leading-5 text-foreground/58">{loading ? "正在读取本章正文…" : loadError ? "正文读取失败，请稍后重试" : text || "本章还没有正文"}</p>
                {!loading && !loadError ? <div className="mt-2 text-[var(--fs-tiny)] tabular-nums text-foreground/35">{text.length.toLocaleString("zh-CN")} 字</div> : null}
            </div>
            <footer className="flex shrink-0 items-center justify-between border-t border-border/70 px-2 py-2">
                <button
                    type="button"
                    disabled={adding}
                    onClick={() => void onAdd()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[var(--workspace-accent)] hover:bg-[var(--workspace-accent-soft)] disabled:cursor-wait"
                >
                    {adding ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}添加到画布
                </button>
                <Link to={`/projects/${projectId}/chapters/${unit.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-foreground/62 hover:bg-surface-hover hover:text-foreground">
                    打开编辑器
                    <ArrowUpRight className="size-3.5" />
                </Link>
            </footer>
        </section>
    );
}

function htmlToPlainText(value: string) {
    if (!value) return "";
    const documentNode = new DOMParser().parseFromString(value, "text/html");
    return (documentNode.body.textContent || "").replace(/\u00a0/g, " ").trim();
}

function readStoredScroll(key: string) {
    const value = Number(sessionStorage.getItem(key) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}
