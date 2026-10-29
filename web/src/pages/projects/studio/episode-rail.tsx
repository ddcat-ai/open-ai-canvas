import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { Grid3x3, List, Plus, Search, X } from "lucide-react";

import type { DramaEpisodeRow } from "@/services/api/drama";

import { episodeStatusText, episodeTone, StagePips, STAGE_LABEL } from "../drama-shared";

type Filter = "all" | "ready" | "attention" | "active" | "done";

const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "ready", label: "待生成" },
    { key: "attention", label: "待处理" },
    { key: "active", label: "制作中" },
    { key: "done", label: "已完成" },
];

function matchesFilter(episode: DramaEpisodeRow, filter: Filter) {
    const tone = episodeTone(episode);
    if (filter === "ready") return tone === "ready";
    if (filter === "attention") return tone === "error" || tone === "review";
    if (filter === "active") return tone === "active";
    if (filter === "done") return tone === "done";
    return true;
}

export function EpisodeRail({ episodes, currentId, planning, onSelect, onAdd }: { episodes: DramaEpisodeRow[]; currentId: string; planning: boolean; onSelect: (id: string) => void; onAdd: () => void }) {
    const nextNumber = (episodes[episodes.length - 1]?.number || 0) + 1;
    const [filter, setFilter] = useState<Filter>("all");
    const [query, setQuery] = useState("");
    const [matrix, setMatrix] = useState(() => localStorage.getItem("drama-rail-matrix") === "1");
    const deferredQuery = useDeferredValue(query.trim());
    const listRef = useRef<HTMLDivElement>(null);
    const counts = useMemo(() => Object.fromEntries(FILTERS.map((item) => [item.key, episodes.filter((episode) => matchesFilter(episode, item.key)).length])) as Record<Filter, number>, [episodes]);
    const visible = useMemo(
        () =>
            episodes.filter((episode) => {
                if (!matchesFilter(episode, filter)) return false;
                if (!deferredQuery) return true;
                return String(episode.number) === deferredQuery.replace(/^第|集$/g, "") || episode.title.includes(deferredQuery) || episode.synopsis.includes(deferredQuery);
            }),
        [deferredQuery, episodes, filter],
    );
    const virtualizer = useVirtualizer({ count: visible.length, getScrollElement: () => listRef.current, estimateSize: () => 62, overscan: 10 });

    useEffect(() => {
        localStorage.setItem("drama-rail-matrix", matrix ? "1" : "0");
    }, [matrix]);
    // 切换集时让当前集保持在可视范围内，长列表里不会“丢失”位置。
    useEffect(() => {
        if (matrix) return;
        const index = visible.findIndex((episode) => episode.id === currentId);
        if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
    }, [currentId, matrix, virtualizer, visible]);

    return (
        <aside className="drama-rail" aria-label="分集">
            <div className="drama-rail-head">
                <div className="flex items-center gap-2">
                    <label className="drama-search flex-1">
                        <Search className="size-3.5 shrink-0 opacity-40" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && visible[0]) onSelect(visible[0].id);
                            }}
                            placeholder="集号或标题"
                            aria-label="搜索分集"
                        />
                        {query ? (
                            <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">
                                <X className="size-3.5 opacity-40" />
                            </button>
                        ) : null}
                    </label>
                    <Tooltip title={`添加第 ${nextNumber} 集：粘贴或导入下一集的原文、剧本或分镜`}>
                        <button type="button" className="drama-title-edit !h-8 !w-8" aria-label={`添加第 ${nextNumber} 集`} onClick={onAdd}>
                            <Plus className="size-4" />
                        </button>
                    </Tooltip>
                    <Tooltip title={matrix ? "列表视图" : "矩阵视图：一屏看清全剧进度"}>
                        <button type="button" className="drama-title-edit !h-8 !w-8" aria-pressed={matrix} aria-label="切换矩阵视图" onClick={() => setMatrix((value) => !value)}>
                            {matrix ? <List className="size-4" /> : <Grid3x3 className="size-4" />}
                        </button>
                    </Tooltip>
                </div>
                <div className="drama-filters" role="group" aria-label="筛选分集">
                    {FILTERS.filter((item) => item.key !== "ready" || counts.ready || filter === "ready").map((item) => (
                        <button key={item.key} type="button" className={`drama-filter ${item.key === "attention" && counts.attention ? "is-alert" : ""}`} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
                            {item.label}
                            <b>{counts[item.key]}</b>
                        </button>
                    ))}
                </div>
            </div>
            {matrix ? (
                <div className="drama-rail-list thin-scrollbar">
                    <div className="drama-matrix">
                        <div className="drama-matrix-legend">
                            <span>
                                <i style={{ background: "var(--status-success)" }} />
                                完成
                            </span>
                            <span>
                                <i style={{ background: "var(--workspace-accent)" }} />
                                制作中
                            </span>
                            <span>
                                <i className="is-ready" />
                                待生成
                            </span>
                            <span>
                                <i style={{ background: "var(--status-warning)" }} />
                                待审阅
                            </span>
                            <span>
                                <i style={{ background: "var(--status-error)" }} />
                                失败
                            </span>
                        </div>
                        <div className="drama-matrix-grid">
                            {visible.map((episode) => (
                                <Tooltip key={episode.id} title={`第 ${episode.number} 集 · ${episode.title} · ${episodeStatusText(episode)}`} mouseEnterDelay={0.25}>
                                    <button
                                        type="button"
                                        className={`drama-cell is-${episodeTone(episode)}`}
                                        aria-current={episode.id === currentId}
                                        aria-label={`第 ${episode.number} 集 ${STAGE_LABEL[episode.stage]}`}
                                        onClick={() => onSelect(episode.id)}
                                    >
                                        {episode.number}
                                    </button>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div ref={listRef} className="drama-rail-list thin-scrollbar">
                    {visible.length ? (
                        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                            {virtualizer.getVirtualItems().map((item) => {
                                const episode = visible[item.index];
                                const tone = episodeTone(episode);
                                return (
                                    <div key={episode.id} className="absolute left-0 top-0 w-full pb-[2px]" style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
                                        <button type="button" className={`drama-ep is-${tone}`} aria-current={episode.id === currentId} onClick={() => onSelect(episode.id)}>
                                            <span className="drama-ep-num">{String(episode.number).padStart(episodes.length >= 100 ? 3 : 2, "0")}</span>
                                            <span className="min-w-0">
                                                <span className="drama-ep-title block" title={episode.title}>
                                                    {episode.title}
                                                </span>
                                                <span className="drama-ep-meta">
                                                    <span>{episodeStatusText(episode)}</span>
                                                    <StagePips episode={episode} />
                                                </span>
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="px-3 py-10 text-center text-[var(--fs-tiny)] text-foreground/40">没有符合条件的分集</div>
                    )}
                    {planning ? <div className="px-3 py-3 text-center text-[var(--fs-micro)] text-foreground/40">后续章节正在分集…</div> : null}
                    {!planning && filter === "all" && !deferredQuery ? (
                        <button type="button" className="drama-rail-add" onClick={onAdd}>
                            <Plus className="size-3.5" />
                            添加第 {nextNumber} 集
                        </button>
                    ) : null}
                </div>
            )}
        </aside>
    );
}
