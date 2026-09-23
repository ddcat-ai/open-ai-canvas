import { memo, useState } from "react";
import { AudioLines, Clock3, FileText, Image, Layers, Pencil, Search, X } from "lucide-react";

import { CanvasVideoPreviewImage } from "@/components/canvas/canvas-video-preview-image";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { canvasNodeMaterialSummary, canvasNodeSearchContext, canvasNodeSearchTimes } from "@/lib/canvas/canvas-node-search";
import { getNodeListLabel } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { Video as CanvasVideoIcon } from "lucide-react";

export function CanvasWorkspaceNodeListPanel({
    nodes,
    results,
    query,
    deferredQuery,
    selectedNodeIds,
    onQueryChange,
    onFocus,
}: {
    nodes: CanvasNodeData[];
    results: CanvasNodeData[];
    query: string;
    deferredQuery: string;
    selectedNodeIds: Set<string>;
    onQueryChange: (value: string) => void;
    onFocus: (nodeId: string) => void;
}) {
    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2.5">
                <Layers className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-semibold">画布节点</span>
                <span className="tabular-nums text-foreground/32">{nodes.length.toLocaleString("zh-CN")}</span>
            </header>
            <div className="shrink-0 border-b border-border/70 p-2">
                <label className="flex h-8 items-center gap-1.5 rounded-md border border-border/75 bg-foreground/[.025] px-2 focus-within:border-[var(--workspace-accent)] focus-within:ring-2 focus-within:ring-[var(--workspace-accent-soft)]">
                    <Search className="size-3.5 shrink-0 text-foreground/32" />
                    <input
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-foreground/28"
                        placeholder="搜索节点、章节、镜头、模型或标签…"
                        aria-label="搜索画布节点"
                    />
                    {query ? (
                        <button type="button" onClick={() => onQueryChange("")} className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover hover:text-foreground" aria-label="清空搜索">
                            <X className="size-3" />
                        </button>
                    ) : null}
                </label>
                {deferredQuery ? <div className="mt-1 px-0.5 text-[var(--fs-micro)] tabular-nums text-foreground/35">找到 {results.length.toLocaleString("zh-CN")} 个节点</div> : null}
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain py-1" role="listbox" aria-label="画布节点列表">
                {results.length ? (
                    results.map((node) => <CanvasNodeListItem key={node.id} node={node} active={selectedNodeIds.has(node.id)} onSelect={() => onFocus(node.id)} />)
                ) : (
                    <WorkspaceState icon="canvas" compact title="没有匹配节点" description="换一个关键词继续搜索。" />
                )}
            </div>
        </>
    );
}

const CanvasNodeListItem = memo(function CanvasNodeListItem({ node, active, onSelect }: { node: CanvasNodeData; active: boolean; onSelect: () => void }) {
    const times = canvasNodeSearchTimes(node);
    const materialSummary = canvasNodeMaterialSummary(node);
    const context = canvasNodeSearchContext(node);
    return (
        <button
            type="button"
            role="option"
            aria-selected={active}
            className="grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 text-left transition-[background-color,box-shadow] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            style={{
                background: active ? "var(--surface-active)" : undefined,
                boxShadow: active ? "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent)" : undefined,
                contentVisibility: "auto",
                containIntrinsicSize: "48px",
            }}
            onClick={onSelect}
        >
            <CanvasNodeListThumbnail node={node} />
            <span className="min-w-0 self-center">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-xs font-medium leading-4 text-foreground" title={node.title}>
                        {node.title || getNodeListLabel(node.type)}
                    </span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] leading-3 text-foreground/45" title={materialSummary}>
                    {materialSummary}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-foreground/40">
                    <Clock3 className="size-2.5 shrink-0" />
                    <span className="mt-0.5 block text-[10px] tabular-nums text-foreground/35" title={fullTime(times.updatedAt)}>
                        {times.updatedLabel}
                    </span>
                </span>
            </span>
        </button>
    );
});

function CanvasNodeListThumbnail({ node }: { node: CanvasNodeData }) {
    const [failed, setFailed] = useState(false);
    const mediaSource =
        node.metadata?.drawingPreviewUrl ||
        node.metadata?.characterCoverUrl ||
        node.metadata?.folder?.themeCover ||
        (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.ColorGrade ? node.metadata?.content : undefined);
    const commonClass = "h-9 w-11 rounded-[var(--r-sm)] border object-cover";
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };

    if (node.type === CanvasNodeType.Video) {
        const fallback = <span aria-hidden="true" className="grid h-9 w-11 place-items-center rounded-[var(--r-sm)] border text-foreground/48" style={commonStyle}><CanvasVideoIcon className="size-3.5" /></span>;
        return <CanvasVideoPreviewImage node={node} alt="" width={44} height={36} loading="lazy" decoding="async" className={commonClass} style={commonStyle} fallback={fallback} />;
    }

    if (mediaSource && !failed) {
        return <img src={mediaSource} alt="" width={44} height={36} loading="lazy" decoding="async" className={commonClass} style={commonStyle} onError={() => setFailed(true)} />;
    }

    const textPreview = node.metadata?.previewContent || node.metadata?.composerContent || node.metadata?.prompt || node.metadata?.content;
    if (textPreview && (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Markdown || node.type === CanvasNodeType.Script)) {
        return (
            <span aria-hidden="true" className="line-clamp-3 h-9 w-11 overflow-hidden rounded-[var(--r-sm)] border px-1 py-0.5 text-[7px] leading-[10px] text-foreground/55" style={commonStyle}>
                {textPreview}
            </span>
        );
    }

    return (
        <span aria-hidden="true" className="grid h-9 w-11 place-items-center rounded-[var(--r-sm)] border text-foreground/48" style={commonStyle}>
            {node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama ? (
                <Image className="size-3.5" />
            ) : node.type === CanvasNodeType.Video ? (
                <CanvasVideoIcon className="size-3.5" />
            ) : node.type === CanvasNodeType.Audio ? (
                <AudioLines className="size-3.5" />
            ) : node.type === CanvasNodeType.Drawing ? (
                <Pencil className="size-3.5" />
            ) : (
                <FileText className="size-3.5" />
            )}
        </span>
    );
}

function fullTime(value?: string) {
    if (!value) return "时间未记录";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
