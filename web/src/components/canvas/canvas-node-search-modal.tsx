import { memo, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Input, Modal } from "antd";
import { AudioLines, BookOpenText, Clock3, FileText, Image, Pencil, Search, Video } from "lucide-react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { canvasNodeMaterialSummary, canvasNodeSearchContext, canvasNodeSearchTimes, searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { canvasNodeVideoPreviewUrl } from "@/lib/canvas/canvas-media-preview";
import { getNodeListLabel } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const RESULT_LIST_ID = "canvas-node-search-results";

export function CanvasNodeSearchModal({ open, nodes, onClose, onFocus }: { open: boolean; nodes: CanvasNodeData[]; onClose: () => void; onFocus: (nodeId: string) => void }) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const results = useMemo(() => searchCanvasNodes(nodes, query), [nodes, query]);

    useEffect(() => setActiveIndex(0), [query, open]);
    useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1))), [results.length]);

    const focusNode = (node: CanvasNodeData | undefined) => {
        if (!node) return;
        onFocus(node.id);
        onClose();
    };

    const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => Math.min(results.length - 1, current + 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(0, current - 1));
        } else if (event.key === "Enter") {
            event.preventDefault();
            focusNode(results[activeIndex]);
        }
    };

    return (
        <Modal
            title="搜索画布节点"
            open={open}
            footer={null}
            width="min(760px, calc(100vw - 32px))"
            onCancel={onClose}
            afterClose={() => { setQuery(""); setActiveIndex(0); }}
            styles={{ body: { paddingTop: 8 } }}
            centered
        >
            <Input
                autoFocus
                allowClear
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                prefix={<Search className="size-4 opacity-50" />}
                placeholder="搜索节点、章节、镜头、模型或标签…"
                aria-label="搜索画布节点"
                aria-controls={RESULT_LIST_ID}
                aria-activedescendant={results[activeIndex] ? `canvas-node-search-result-${results[activeIndex].id}` : undefined}
            />
            <div className="mt-2 flex min-h-7 items-center justify-between gap-3 border-b pb-2 text-[11px] tracking-[0.015em] text-foreground/45">
                <span className="tabular-nums">{query.trim() ? `找到 ${results.length} 个节点` : `最近编辑 · ${results.length} 个节点`}</span>
                <span className="hidden sm:inline">↑↓ 选择 · Enter 定位 · Esc 关闭</span>
            </div>
            <div id={RESULT_LIST_ID} role="listbox" aria-label="画布节点搜索结果" className="thin-scrollbar max-h-[54vh] overflow-y-auto overscroll-contain py-1.5">
                {results.length ? results.map((node, index) => (
                    <CanvasNodeSearchResult
                        key={node.id}
                        node={node}
                        active={index === activeIndex}
                        onActivate={() => setActiveIndex(index)}
                        onSelect={() => focusNode(node)}
                    />
                )) : <WorkspaceState icon="canvas" compact title="没有匹配节点" description="换一个节点、章节、镜头、模型或标签继续搜索。" />}
            </div>
        </Modal>
    );
}

const CanvasNodeSearchResult = memo(function CanvasNodeSearchResult({ node, active, onActivate, onSelect }: { node: CanvasNodeData; active: boolean; onActivate: () => void; onSelect: () => void }) {
    const times = canvasNodeSearchTimes(node);
    const materialSummary = canvasNodeMaterialSummary(node);
    const context = canvasNodeSearchContext(node);
    return (
        <button
            id={`canvas-node-search-result-${node.id}`}
            type="button"
            role="option"
            aria-selected={active}
            className="grid min-h-14 w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[var(--r-md)] px-2 py-1.5 text-left transition-[background-color,box-shadow] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 max-sm:grid-cols-[56px_minmax(0,1fr)]"
            style={{
                background: active ? "var(--surface-active)" : undefined,
                boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent)" : undefined,
                contentVisibility: "auto",
                containIntrinsicSize: "56px",
            }}
            onMouseEnter={onActivate}
            onFocus={onActivate}
            onClick={onSelect}
        >
            <CanvasNodeSearchThumbnail node={node} />
            <span className="min-w-0 self-center">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-foreground" title={node.title}>{node.title || getNodeListLabel(node.type)}</span>
                    <span className="max-w-[210px] shrink truncate rounded-full bg-foreground/[0.055] px-2 py-0.5 text-[10px] font-medium tracking-[0.02em] text-foreground/50" title={materialSummary}>{materialSummary}</span>
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-foreground/45">
                    {node.metadata?.chapterTitle ? <BookOpenText className="size-3 shrink-0" /> : null}
                    <span className="truncate" title={context}>{context}</span>
                </span>
                <span className="mt-1 hidden items-center gap-3 text-[10px] tabular-nums tracking-[0.015em] text-foreground/40 max-sm:flex">
                    <time dateTime={times.createdAt} title={fullTime(times.createdAt)}>创建 {times.createdLabel}</time>
                    <time dateTime={times.updatedAt} title={fullTime(times.updatedAt)}>编辑 {times.updatedLabel}</time>
                </span>
            </span>
            <span className="grid min-w-[112px] gap-0.5 border-l pl-3 text-[10px] tabular-nums tracking-[0.015em] text-foreground/40 max-sm:hidden" style={{ borderColor: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
                <span className="flex items-center gap-1.5"><Clock3 className="size-3" /><span>创建</span><time className="ml-auto" dateTime={times.createdAt} title={fullTime(times.createdAt)}>{times.createdLabel}</time></span>
                <span className="flex items-center gap-1.5"><Pencil className="size-3" /><span>编辑</span><time className="ml-auto" dateTime={times.updatedAt} title={fullTime(times.updatedAt)}>{times.updatedLabel}</time></span>
            </span>
        </button>
    );
});

function CanvasNodeSearchThumbnail({ node }: { node: CanvasNodeData }) {
    const [failed, setFailed] = useState(false);
    const mediaSource = node.type === CanvasNodeType.Video ? canvasNodeVideoPreviewUrl(node) : node.metadata?.drawingPreviewUrl
        || node.metadata?.characterCoverUrl
        || node.metadata?.folder?.themeCover
        || ((node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.ColorGrade) ? node.metadata?.content : undefined);
    const commonClass = "h-11 w-16 rounded-[var(--r-sm)] border object-cover";
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };

    if (mediaSource && !failed) {
        return <img src={mediaSource} alt="" width={64} height={44} loading="lazy" decoding="async" className={commonClass} style={commonStyle} onError={() => setFailed(true)} />;
    }

    const textPreview = node.metadata?.previewContent || node.metadata?.composerContent || node.metadata?.prompt || node.metadata?.content;
    if (textPreview && (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Markdown || node.type === CanvasNodeType.Script)) {
        return <span aria-hidden="true" className="line-clamp-3 h-11 w-16 overflow-hidden rounded-[var(--r-sm)] border px-1.5 py-1 text-[8px] leading-[11px] text-foreground/55" style={commonStyle}>{textPreview}</span>;
    }

    return (
        <span aria-hidden="true" className="grid h-11 w-16 place-items-center rounded-[var(--r-sm)] border text-foreground/48" style={commonStyle}>
            {node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama ? <Image className="size-4" />
                : node.type === CanvasNodeType.Video ? <Video className="size-4" />
                    : node.type === CanvasNodeType.Audio ? <AudioLines className="size-4" />
                        : node.type === CanvasNodeType.Drawing ? <Pencil className="size-4" />
                            : <FileText className="size-4" />}
        </span>
    );
}

function fullTime(value?: string) {
    if (!value) return "时间未记录";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
