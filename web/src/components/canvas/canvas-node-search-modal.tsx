import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Input, Modal, type InputRef } from "antd";
import { AudioLines, BookOpenText, Clock3, FileText, Image, Pencil, Search, Video } from "lucide-react";

import { CanvasVideoPreviewImage } from "@/components/canvas/canvas-video-preview-image";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { canvasNodeMaterialSummary, canvasNodeSearchContext, canvasNodeSearchTimes, canvasNodeSearchType, searchCanvasNodes } from "@/lib/canvas/canvas-node-search";
import { useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { getNodeListLabel } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const RESULT_LIST_ID = "canvas-node-search-results";

export function CanvasNodeSearchModal({ open, nodes, onClose, onFocus }: { open: boolean; nodes: CanvasNodeData[]; onClose: () => void; onFocus: (nodeId: string) => void }) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const searchInputRef = useRef<InputRef>(null);
    const config = useEffectiveConfig();
    const results = useMemo(() => searchCanvasNodes(nodes, query, 80, config), [config, nodes, query]);

    useEffect(() => setActiveIndex(0), [query, open]);
    useEffect(() => setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1))), [results.length]);
    useEffect(() => {
        if (!open) return;
        // Ant Design restores focus to the modal wrapper after its entrance
        // animation. Re-focus on the actual input after that handoff so the
        // Ctrl/Cmd+F search flow is ready for typing immediately.
        const frame = requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
        const timer = window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 0);
        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(timer);
        };
    }, [open]);

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
            afterClose={() => {
                setQuery("");
                setActiveIndex(0);
            }}
            styles={{ body: { paddingTop: 8 } }}
            centered
        >
            <Input
                ref={searchInputRef}
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
            <div className="mt-2 flex min-h-7 items-center justify-between gap-3 border-b pb-2 text-[var(--fs-label)] tracking-[0.015em] text-foreground/45">
                <span className="tabular-nums">{query.trim() ? `找到 ${results.length} 个节点` : `最近编辑 · ${results.length} 个节点`}</span>
                <span className="hidden sm:inline">↑↓ 选择 · Enter 定位 · Esc 关闭</span>
            </div>
            <div id={RESULT_LIST_ID} role="listbox" aria-label="画布节点搜索结果" className="thin-scrollbar max-h-[54vh] overflow-y-auto overscroll-contain py-2">
                {results.length ? (
                    results.map((node, index) => <CanvasNodeSearchResult key={node.id} node={node} config={config} active={index === activeIndex} onActivate={() => setActiveIndex(index)} onSelect={() => focusNode(node)} />)
                ) : (
                    <WorkspaceState icon="canvas" compact title="没有匹配节点" description="换一个节点、章节、镜头、模型或标签继续搜索。" />
                )}
            </div>
        </Modal>
    );
}

const CanvasNodeSearchResult = memo(function CanvasNodeSearchResult({ node, config, active, onActivate, onSelect }: { node: CanvasNodeData; config: AiConfig; active: boolean; onActivate: () => void; onSelect: () => void }) {
    const times = canvasNodeSearchTimes(node);
    const materialSummary = canvasNodeMaterialSummary(node, config);
    const context = canvasNodeSearchContext(node);
    const nodeType = canvasNodeSearchType(node);
    return (
        <button
            id={`canvas-node-search-result-${node.id}`}
            type="button"
            role="option"
            aria-selected={active}
            className="grid min-h-14 w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--r-md)] px-2 py-2 text-left transition-[background-color,box-shadow] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 max-sm:grid-cols-[56px_minmax(0,1fr)]"
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
                    <NodeTypeBadge kind={nodeType.kind} label={nodeType.label} />
                    <span className="min-w-0 truncate text-[var(--fs-ui)] font-medium leading-5 text-foreground" title={node.title}>
                        {node.title || getNodeListLabel(node.type)}
                    </span>
                    <span className="max-w-[210px] shrink truncate rounded-full bg-foreground/[0.055] px-2 py-0.5 text-[var(--fs-label)] font-medium tracking-[0.02em] text-foreground/50" title={materialSummary}>
                        {materialSummary}
                    </span>
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[var(--fs-label)] leading-4 text-foreground/45">
                    {node.metadata?.chapterTitle ? <BookOpenText className="size-3 shrink-0" /> : null}
                    <span className="truncate" title={context}>
                        {context}
                    </span>
                </span>
                <span className="mt-1 hidden items-center gap-3 text-[var(--fs-label)] tabular-nums tracking-[0.015em] text-foreground/40 max-sm:flex">
                    <time dateTime={times.createdAt} title={fullTime(times.createdAt)}>
                        创建 {times.createdLabel}
                    </time>
                    <time dateTime={times.updatedAt} title={fullTime(times.updatedAt)}>
                        编辑 {times.updatedLabel}
                    </time>
                </span>
            </span>
            <span className="grid min-w-[112px] gap-0.5 border-l pl-3 text-[var(--fs-label)] tabular-nums tracking-[0.015em] text-foreground/40 max-sm:hidden" style={{ borderColor: "color-mix(in srgb, var(--foreground) 8%, transparent)" }}>
                <span className="flex items-center gap-2">
                    <Clock3 className="size-3" />
                    <span>创建</span>
                    <time className="ml-auto" dateTime={times.createdAt} title={fullTime(times.createdAt)}>
                        {times.createdLabel}
                    </time>
                </span>
                <span className="flex items-center gap-2">
                    <Pencil className="size-3" />
                    <span>编辑</span>
                    <time className="ml-auto" dateTime={times.updatedAt} title={fullTime(times.updatedAt)}>
                        {times.updatedLabel}
                    </time>
                </span>
            </span>
        </button>
    );
});

function NodeTypeBadge({ kind, label }: { kind: ReturnType<typeof canvasNodeSearchType>["kind"]; label: string }) {
    const appearance = {
        image: { Icon: Image, className: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
        video: { Icon: Video, className: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
        audio: { Icon: AudioLines, className: "bg-amber-500/14 text-amber-700 dark:text-amber-300" },
        text: { Icon: FileText, className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
        drawing: { Icon: Pencil, className: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
        layout: { Icon: BookOpenText, className: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300" },
        workflow: { Icon: Video, className: "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300" },
        other: { Icon: FileText, className: "bg-foreground/[0.07] text-foreground/60" },
    }[kind];
    const Icon = appearance.Icon;
    return (
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[var(--fs-micro)] font-semibold leading-4 ${appearance.className}`}>
            <Icon className="size-3" aria-hidden="true" />
            {label}
        </span>
    );
}

function CanvasNodeSearchThumbnail({ node }: { node: CanvasNodeData }) {
    const [failed, setFailed] = useState(false);
    const mediaSource =
        node.metadata?.drawingPreviewUrl ||
        node.metadata?.characterCoverUrl ||
        node.metadata?.folder?.themeCover ||
        (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.ColorGrade ? node.metadata?.content : undefined);
    const commonClass = "h-11 w-16 rounded-[var(--r-sm)] border object-cover";
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };

    if (node.type === CanvasNodeType.Video) {
        const fallback = (
            <span aria-hidden="true" className="grid h-11 w-16 place-items-center rounded-[var(--r-sm)] border text-foreground/48" style={commonStyle}>
                <Video className="size-4" />
            </span>
        );
        return <CanvasVideoPreviewImage node={node} alt="" width={64} height={44} loading="lazy" decoding="async" className={commonClass} style={commonStyle} fallback={fallback} />;
    }

    if (mediaSource && !failed) {
        return <img src={mediaSource} alt="" width={64} height={44} loading="lazy" decoding="async" className={commonClass} style={commonStyle} onError={() => setFailed(true)} />;
    }

    const textPreview = node.metadata?.previewContent || node.metadata?.composerContent || node.metadata?.prompt || node.metadata?.content;
    if (textPreview && (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Script)) {
        return (
            <span aria-hidden="true" className="line-clamp-3 h-11 w-16 overflow-hidden rounded-[var(--r-sm)] border px-2 py-1 text-[var(--fs-label)] leading-[11px] text-foreground/55" style={commonStyle}>
                {textPreview}
            </span>
        );
    }

    return (
        <span aria-hidden="true" className="grid h-11 w-16 place-items-center rounded-[var(--r-sm)] border text-foreground/48" style={commonStyle}>
            {node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama ? (
                <Image className="size-4" />
            ) : node.type === CanvasNodeType.Video ? (
                <Video className="size-4" />
            ) : node.type === CanvasNodeType.Audio ? (
                <AudioLines className="size-4" />
            ) : node.type === CanvasNodeType.Drawing ? (
                <Pencil className="size-4" />
            ) : (
                <FileText className="size-4" />
            )}
        </span>
    );
}

function fullTime(value?: string) {
    if (!value) return "时间未记录";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
