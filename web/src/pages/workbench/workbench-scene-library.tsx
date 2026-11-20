import { Button, Input } from "antd";
import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { WorkspaceNoResultsState } from "@/components/layout/workspace-state";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { cn } from "@/lib/utils";
import type { WorkbenchKind, WorkbenchTool } from "@/services/api/workbench";

import { SceneGlyph } from "./workbench-composer";
import { filterWorkbenchTools, toolMatchesFacet, WORKBENCH_SCENE_FACETS, workbenchPageCategories, workbenchToolSubtitle } from "./workbench-presets";

const FACET_CATEGORIES = new Set(["all", "recommended", "ecommerce", "product"]);

function sceneRequirement(tool: WorkbenchTool) {
    const required = tool.inputContract?.slots.filter((slot) => slot.required || slot.minCount > 0) || [];
    if (required.length) return `需上传 ${required.map((slot) => slot.name).join("、")}`;
    if (tool.inputContract?.slots.length) return "素材可选";
    return "只需描述";
}

export function SceneLibraryModal({
    open,
    kind,
    tools,
    loading,
    error,
    selectedId,
    onRetry,
    onClose,
    onChoose,
}: {
    open: boolean;
    kind: WorkbenchKind;
    tools: WorkbenchTool[];
    loading: boolean;
    error: string;
    selectedId?: string;
    onRetry: () => void;
    onClose: () => void;
    onChoose: (tool: WorkbenchTool | null) => void;
}) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [facetKey, setFacetKey] = useState("");
    const categories = useMemo(() => [{ value: "all", label: "全部" }, ...workbenchPageCategories(tools)], [tools]);
    const facets = WORKBENCH_SCENE_FACETS[kind];
    const showFacets = FACET_CATEGORIES.has(category);
    const facet = showFacets ? facets.find((item) => item.key === facetKey) : undefined;
    const filtered = useMemo(() => filterWorkbenchTools(tools, category, query, facet), [category, facet, query, tools]);
    const counts = useMemo(() => new Map(categories.map((item) => [item.value, filterWorkbenchTools(tools, item.value, "").length])), [categories, tools]);
    const visibleFacets = useMemo(() => facets.filter((item) => filterWorkbenchTools(tools, category, "").some((tool) => toolMatchesFacet(tool, item))), [category, facets, tools]);

    useEffect(() => {
        if (!open) return;
        const selected = tools.find((tool) => tool.id === selectedId);
        setCategory(selected && categories.some((item) => item.value === selected.categoryId) ? selected.categoryId : "all");
        setFacetKey("");
        setQuery("");
        // 只在打开时定位到当前场景所在分类，浏览过程中不被目录刷新打断。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <AppModal open={open} flush footer={null} closable={false} width="min(1120px, calc(100vw - 32px))" onCancel={onClose} className="wb-library-modal" title={null}>
            <div className="wb-library">
                <header className="wb-library-head">
                    <div className="wb-library-title">
                        <h2>选择出品场景</h2>
                        <p>{kind === "image" ? "选定后自动套用提示词模板，并提示需要上传的商品素材" : "选定后自动套用镜头模板，并提示首帧等素材要求"}</p>
                    </div>
                    <Input className="wb-library-search" aria-label="搜索场景" prefix={<Search className="size-4" />} allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索场景，如 白底、模特、开箱" />
                    <button type="button" className="wb-icon-button" data-icon-only aria-label="关闭" onClick={onClose}>
                        <X />
                    </button>
                </header>
                <div className="wb-library-body">
                    <nav className="wb-library-rail" aria-label="场景分类">
                        {categories.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                aria-pressed={category === item.value}
                                className={cn("wb-rail-item", category === item.value && "is-active")}
                                onClick={() => {
                                    setCategory(item.value);
                                    setFacetKey("");
                                }}
                            >
                                <span>{item.label}</span>
                                <small>{counts.get(item.value) || 0}</small>
                            </button>
                        ))}
                    </nav>
                    <div className="wb-library-main">
                        {showFacets && visibleFacets.length ? (
                            <div className="wb-library-facets" role="group" aria-label="电商场景细分">
                                <button type="button" className="wb-chip" aria-pressed={!facet} onClick={() => setFacetKey("")}>
                                    不限
                                </button>
                                {visibleFacets.map((item) => (
                                    <button key={item.key} type="button" className="wb-chip" aria-pressed={facet?.key === item.key} onClick={() => setFacetKey(facet?.key === item.key ? "" : item.key)}>
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        {error ? (
                            <div className="wb-inline-error" role="alert">
                                <span>{error}</span>
                                <Button size="small" onClick={onRetry}>
                                    重试
                                </Button>
                            </div>
                        ) : loading ? (
                            <div className="wb-library-grid" aria-busy="true">
                                {Array.from({ length: 8 }, (_, index) => (
                                    <span key={index} className="wb-scene-card is-skeleton" />
                                ))}
                            </div>
                        ) : (
                            <div className="wb-library-grid">
                                {category === "all" && !query.trim() && !facet ? (
                                    <button type="button" className={cn("wb-scene-card", !selectedId && "is-selected")} aria-pressed={!selectedId} onClick={() => onChoose(null)}>
                                        <SceneGlyph tool={null} kind={kind} />
                                        <span className="wb-scene-card-copy">
                                            <strong>自由创作</strong>
                                            <small>不套用模板，直接描述想要的画面，适合已有成熟提示词</small>
                                        </span>
                                        <span className="wb-scene-card-meta">只需描述</span>
                                        {!selectedId ? (
                                            <span className="wb-scene-card-check">
                                                <Check />
                                            </span>
                                        ) : null}
                                    </button>
                                ) : null}
                                {filtered.map((tool) => {
                                    const selected = tool.id === selectedId;
                                    const subtitle = workbenchToolSubtitle(tool);
                                    return (
                                        <button key={tool.id} type="button" className={cn("wb-scene-card", selected && "is-selected")} aria-pressed={selected} title={`${tool.name}\n${subtitle}`} onClick={() => onChoose(tool)}>
                                            <SceneGlyph tool={tool} kind={kind} />
                                            <span className="wb-scene-card-copy">
                                                <strong>{tool.name}</strong>
                                                <small>{subtitle}</small>
                                            </span>
                                            <span className="wb-scene-card-meta">
                                                {sceneRequirement(tool)}
                                                {tool.presets.length ? ` · ${tool.presets.length} 个模板` : ""}
                                            </span>
                                            {selected ? (
                                                <span className="wb-scene-card-check">
                                                    <Check />
                                                </span>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {!loading && !error && !filtered.length && (query.trim() || facet || category !== "all") ? (
                            <WorkspaceNoResultsState
                                compact
                                query={query}
                                onClear={() => {
                                    setQuery("");
                                    setFacetKey("");
                                    setCategory("all");
                                }}
                            />
                        ) : null}
                    </div>
                </div>
            </div>
        </AppModal>
    );
}
