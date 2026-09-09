import { memo, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Input, Modal } from "antd";
import { AudioLines, FileText, Folder, Globe2, Image as ImageIcon, Pencil, Search, Video } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { canvasNodeSearchCategory, canvasNodeSearchContext, searchCanvasNodes, type CanvasNodeSearchCategory } from "@/lib/canvas/canvas-node-search";
import { canvasNodeVideoPreviewUrl } from "@/lib/canvas/canvas-media-preview";
import { getNodeListLabel } from "@/lib/canvas/node-registry";
import { resourceIdFromFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const RESULT_LIST_ID = "canvas-node-search-results";

const SEARCH_CATEGORIES: Array<{ id: CanvasNodeSearchCategory; label: string; icon?: ReactNode }> = [
    { id: "all", label: "全部", icon: <Search className="size-3.5" /> },
    { id: "image", label: "图片", icon: <ImageIcon className="size-3.5" /> },
    { id: "video", label: "视频", icon: <Video className="size-3.5" /> },
    { id: "text", label: "文本", icon: <FileText className="size-3.5" /> },
    { id: "audio", label: "音频", icon: <AudioLines className="size-3.5" /> },
    { id: "panorama", label: "全景", icon: <Globe2 className="size-3.5" /> },
    { id: "group", label: "分组", icon: <Folder className="size-3.5" /> },
];

export function CanvasNodeSearchModal({ open, nodes, onClose, onFocus }: { open: boolean; nodes: CanvasNodeData[]; onClose: () => void; onFocus: (nodeId: string) => void }) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<CanvasNodeSearchCategory>("all");
    const [activeIndex, setActiveIndex] = useState(0);
    const results = useMemo(() => searchCanvasNodes(nodes, query, 80, category), [category, nodes, query]);

    useEffect(() => setActiveIndex(0), [category, query, open]);
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
            className="canvas-node-search-modal"
            title={null}
            open={open}
            footer={null}
            closable={false}
            keyboard
            destroyOnHidden
            width="min(640px, calc(100vw - 28px))"
            onCancel={onClose}
            afterClose={() => { setQuery(""); setCategory("all"); setActiveIndex(0); }}
            styles={{
                container: { padding: 0, overflow: "hidden", background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--r-2xl)", boxShadow: "var(--elevation-overlay)", backdropFilter: "blur(24px)" },
                body: { maxHeight: "min(520px, calc(100vh - 72px))", overflow: "hidden", padding: 0 },
            }}
            centered
        >
            <div className="canvas-node-search-shell">
                <div className="canvas-node-search-input-shell">
                    <Search aria-hidden="true" className="size-4 shrink-0 text-foreground/50" />
                    <Input
                        autoFocus
                        allowClear
                        variant="borderless"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder="搜索节点..."
                        aria-label="搜索画布节点"
                        aria-controls={RESULT_LIST_ID}
                        aria-activedescendant={results[activeIndex] ? `canvas-node-search-result-${results[activeIndex].id}` : undefined}
                    />
                </div>
                <div className="canvas-node-search-categories" role="toolbar" aria-label="按素材类型筛选">
                    {SEARCH_CATEGORIES.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="canvas-node-search-category"
                            aria-pressed={category === item.id}
                            onClick={() => setCategory(item.id)}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
                <div id={RESULT_LIST_ID} role="listbox" aria-label="画布节点搜索结果" className="canvas-node-search-results thin-scrollbar">
                    {results.length ? results.map((node, index) => (
                        <CanvasNodeSearchResult
                            key={node.id}
                            node={node}
                            active={index === activeIndex}
                            onActivate={() => setActiveIndex(index)}
                            onSelect={() => focusNode(node)}
                        />
                    )) : (
                        <WorkspaceState
                            icon="canvas"
                            compact
                            title="没有匹配节点"
                            description={query.trim() ? "换一个关键词继续搜索。" : "当前素材类型暂无节点。"}
                        />
                    )}
                </div>
            </div>
        </Modal>
    );
}

const CanvasNodeSearchResult = memo(function CanvasNodeSearchResult({ node, active, onActivate, onSelect }: { node: CanvasNodeData; active: boolean; onActivate: () => void; onSelect: () => void }) {
    const context = canvasNodeSearchContext(node);
    return (
        <button
            id={`canvas-node-search-result-${node.id}`}
            type="button"
            role="option"
            aria-selected={active}
            className="canvas-node-search-result"
            data-active={active ? "true" : "false"}
            onMouseEnter={onActivate}
            onFocus={onActivate}
            onClick={onSelect}
        >
            <CanvasNodeSearchThumbnail node={node} />
            <span className="canvas-node-search-result-copy">
                <span className="canvas-node-search-result-title" title={node.title}>{node.title || getNodeListLabel(node.type)}</span>
                <span className="canvas-node-search-result-context" title={context}>{context}</span>
            </span>
        </button>
    );
});

function CanvasNodeSearchThumbnail({ node }: { node: CanvasNodeData }) {
    const [failed, setFailed] = useState(false);
    const category = canvasNodeSearchCategory(node);
    const mediaSource = node.type === CanvasNodeType.Video ? canvasNodeVideoPreviewUrl(node) : node.metadata?.drawingPreviewUrl
        || node.metadata?.characterCoverUrl
        || node.metadata?.folder?.themeCover
        || ((node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.ColorGrade) ? node.metadata?.content : undefined);
    const commonClass = "canvas-node-search-thumbnail";
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };

    if (mediaSource && !failed) {
        const previewStorageKey = node.type === CanvasNodeType.Video ? node.metadata?.videoPreview?.storageKey : node.metadata?.storageKey;
        const resourceId = resourceIdFromStorageKey(previewStorageKey) || resourceIdFromFileUrl(mediaSource);
        if (resourceId) return <CachedResourceImage storageKey={resourceStorageKey(resourceId)} src={mediaSource} alt="" width={40} height={40} loading="lazy" decoding="async" className={commonClass} style={commonStyle} onError={() => setFailed(true)} />;
        return <img src={mediaSource} alt="" width={40} height={40} loading="lazy" decoding="async" className={commonClass} style={commonStyle} onError={() => setFailed(true)} />;
    }

    const textPreview = node.metadata?.previewContent || node.metadata?.composerContent || node.metadata?.prompt || node.metadata?.content;
    if (textPreview && (node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Markdown || node.type === CanvasNodeType.Script)) {
        return <span aria-hidden="true" className={`${commonClass} canvas-node-search-thumbnail-text`} style={commonStyle}>{textPreview}</span>;
    }

    return (
        <span aria-hidden="true" className={`${commonClass} canvas-node-search-thumbnail-icon`} style={commonStyle}>
            {category === "image" ? <ImageIcon className="size-4" />
                : category === "video" ? <Video className="size-4" />
                    : category === "audio" ? <AudioLines className="size-4" />
                        : category === "panorama" ? <Globe2 className="size-4" />
                            : category === "group" ? <Folder className="size-4" />
                                : node.type === CanvasNodeType.Drawing ? <Pencil className="size-4" />
                                    : <FileText className="size-4" />}
        </span>
    );
}
