import { EmptyState } from "@/components/ui/product/empty-state";
import { Button, Spin } from "antd";
import { ArrowLeft, Eye, History, Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasNodeActionContext } from "@/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "@/components/canvas/canvas-node-graph-context";
import { isFrameNode, isNodeHiddenByCollapsedFrame, resolveFrameConnection } from "@/lib/canvas/canvas-frame";
import { getCanvasNodesBounds, viewportAtScale, viewportForBounds } from "@/lib/canvas/canvas-viewport";
import { resolveCanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasVersionPreviewState } from "./canvas-version-history";

const noAction = () => undefined;
const readOnlyActions = {};
const previewNodeId = (id: string) => `version-preview:${id}`;

export function CanvasVersionPreview({ preview, onReturn, onShowVersions }: { preview: CanvasVersionPreviewState; onReturn: () => void; onShowVersions: () => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [selectedId, setSelectedId] = useState<string>();
    const [localMedia, setLocalMedia] = useState<Record<string, string>>({});
    const [mediaError, setMediaError] = useState("");
    const theme = useActiveTheme();
    const project = preview.project;
    useEffect(() => {
        const node = project?.nodes.find((item) => item.id === selectedId);
        const key = node?.metadata?.storageKey;
        if (!node || !key || resourceIdFromStorageKey(key) || !["video", "audio"].includes(node.type)) return;
        let active = true;
        setMediaError("");
        void resolveMediaUrl(key, node.metadata?.content)
            .then((url) => {
                if (active) setLocalMedia((current) => ({ ...current, [node.id]: url }));
            })
            .catch(() => {
                if (active) setMediaError("本机媒体读取失败，可下载草稿后检查素材");
            });
        return () => {
            active = false;
        };
    }, [project, selectedId]);
    const nodes = useMemo(
        () =>
            (project?.nodes || []).map((node) => {
                const resourceId = resourceIdFromStorageKey(node.metadata?.storageKey);
                return resourceId && ["image", "video", "audio"].includes(node.type)
                    ? { ...node, metadata: { ...node.metadata, content: resourceFileUrl(resourceId) } }
                    : localMedia[node.id]
                      ? { ...node, metadata: { ...node.metadata, content: localMedia[node.id] } }
                      : node;
            }),
        [project, localMedia],
    );
    const visibleNodes = useMemo(() => nodes.filter((node) => !isNodeHiddenByCollapsedFrame(node, nodes)), [nodes]);
    const connections = useMemo(
        () =>
            (project?.connections || []).flatMap((connection) => {
                const resolved = resolveFrameConnection(connection, nodes);
                return resolved ? [{ connection, ...resolved }] : [];
            }),
        [project, nodes],
    );
    const graph = useMemo(() => {
        const byId = new Map(nodes.map((node) => [node.id, node]));
        return {
            getUpstreamNodes: (id: string) =>
                (project?.connections || [])
                    .filter((connection) => previewNodeId(connection.toNodeId) === id)
                    .flatMap((connection) => {
                        const node = byId.get(connection.fromNodeId);
                        return node ? [node] : [];
                    }),
        };
    }, [nodes, project]);
    const fit = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        const sourceNodes = project?.nodes || [];
        const bounds = getCanvasNodesBounds(sourceNodes.filter((node) => !isNodeHiddenByCollapsedFrame(node, sourceNodes)));
        if (rect && bounds) setViewport(viewportForBounds(bounds, rect, { padding: 72 }));
    }, [project]);
    useLayoutEffect(() => {
        fit();
    }, [fit]);
    const zoom = (scale: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) setViewport((current) => viewportAtScale(current, rect, scale));
    };

    return (
        <div className="absolute inset-0 flex min-h-0 flex-col" data-canvas-version-preview style={{ background: resolveCanvasAppearance(project?.appearance, theme).background }}>
            <header data-canvas-no-zoom className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-sidebar px-5 py-3 text-foreground sm:flex">
                <Eye size={16} className="text-muted-foreground" />
                <div className="min-w-0 flex-1">
                    <strong className="text-sm">{preview.label} · 只读预览</strong>
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(preview.date).toLocaleString("zh-CN")}</p>
                </div>
                <Button type="text" className="lg:!hidden" icon={<History size={15} />} onClick={onShowVersions}>
                    版本
                </Button>
                <Button className="col-span-3" icon={<ArrowLeft size={15} />} onClick={onReturn}>
                    返回当前画布
                </Button>
            </header>
            {preview.error ? (
                <div role="alert" className="grid flex-1 place-content-center gap-4 p-6 text-center text-sm text-destructive">
                    <p>{preview.error}</p>
                    <Button onClick={onShowVersions}>重新选择版本</Button>
                </div>
            ) : !project ? (
                <div className="grid flex-1 place-items-center">
                    <Spin tip="正在读取版本内容">
                        <div className="p-10" />
                    </Spin>
                </div>
            ) : (
                <div className="relative min-h-0 flex-1">
                    {/* No editor callbacks, drawing cache key, or action context may cross this boundary. */}
                    <CanvasNodeActionContext.Provider value={readOnlyActions}>
                        <CanvasNodeGraphContext.Provider value={graph}>
                            <InfiniteCanvas
                                containerRef={containerRef}
                                viewport={viewport}
                                appearance={project.appearance}
                                backgroundMode={project.backgroundMode}
                                onViewportChange={setViewport}
                                onContextMenu={(event) => event.preventDefault()}
                                onDrop={(event) => event.preventDefault()}
                                onCanvasDeselect={() => setSelectedId(undefined)}
                            >
                                <svg className="pointer-events-none absolute overflow-visible" width={1} height={1}>
                                    {connections.map(({ connection, from, to }) => (
                                        <ConnectionPath key={connection.id} connection={{ ...connection, id: previewNodeId(connection.id) }} from={from} to={to} active={false} onSelect={noAction} />
                                    ))}
                                </svg>
                                {visibleNodes.map((node) =>
                                    isFrameNode(node) ? (
                                        <CanvasFrameNode
                                            key={node.id}
                                            data={{ ...node, id: previewNodeId(node.id) }}
                                            childNodes={nodes.filter((child) => child.parentId === node.id)}
                                            scale={viewport.k}
                                            isSelected={false}
                                            isDropTarget={false}
                                            readOnly
                                            onMouseDown={noAction}
                                            onResize={noAction}
                                            onToggleCollapsed={noAction}
                                            onFolderStyleChange={noAction}
                                            onTitleChange={noAction}
                                            onContextMenu={(event) => event.preventDefault()}
                                        />
                                    ) : (
                                        <CanvasNode
                                            key={node.id}
                                            data={{ ...node, id: previewNodeId(node.id) }}
                                            scale={viewport.k}
                                            readOnly
                                            isSelected={selectedId === node.id}
                                            mediaActive={selectedId === node.id}
                                            isRelated={false}
                                            isFocusRelated={false}
                                            isConnectionTarget={false}
                                            showImageInfo={false}
                                            reduceMediaEffects
                                            renderNodeContent={renderReadOnlyContent}
                                            onMouseDown={() => setSelectedId(node.id)}
                                            onHoverStart={noAction}
                                            onHoverEnd={noAction}
                                            onConnectStart={noAction}
                                            onResize={noAction}
                                            onContentChange={noAction}
                                            onContextMenu={(event) => event.preventDefault()}
                                        />
                                    ),
                                )}
                            </InfiniteCanvas>
                        </CanvasNodeGraphContext.Provider>
                    </CanvasNodeActionContext.Provider>
                    {!nodes.length ? (
                        <div className="pointer-events-none absolute inset-0 grid place-items-center">
                            <EmptyState description="此版本没有节点" />
                        </div>
                    ) : null}
                    {mediaError ? (
                        <p role="alert" className="absolute left-5 top-3 rounded-md bg-sidebar p-2 text-xs text-destructive">
                            {mediaError}
                        </p>
                    ) : null}
                    <div data-canvas-no-zoom className="absolute bottom-5 left-5 flex items-center gap-1 rounded-lg border border-border bg-sidebar p-1 text-foreground shadow-sm">
                        <Button type="text" aria-label="缩小预览" icon={<Minus size={15} />} onClick={() => zoom(viewport.k / 1.2)} />
                        <span className="w-12 text-center text-xs tabular-nums" aria-label="预览缩放比例">
                            {Math.round(viewport.k * 100)}%
                        </span>
                        <Button type="text" aria-label="放大预览" icon={<Plus size={15} />} onClick={() => zoom(viewport.k * 1.2)} />
                        <Button type="text" aria-label="适应预览内容" icon={<Maximize size={15} />} onClick={fit} />
                    </div>
                </div>
            )}
        </div>
    );
}

function renderReadOnlyContent(node: CanvasNodeData) {
    const rows = node.metadata?.storyboard?.rows;
    return (
        <div className="flex h-full flex-col overflow-hidden rounded-lg bg-card text-card-foreground">
            <strong className="shrink-0 border-b border-border px-4 py-3 text-sm">{node.title}</strong>
            <div data-canvas-wheel-scroll className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-6">
                {rows?.length
                    ? rows.map((row) => (
                          <div key={row.id} className="mb-3 border-b border-border pb-3">
                              <p className="text-xs text-muted-foreground">
                                  镜头 {row.shotNumber} · {row.durationSeconds}s
                              </p>
                              <p>{row.plotDescription}</p>
                              <p>{row.dialogue}</p>
                          </div>
                      ))
                    : node.metadata?.content || node.metadata?.composerContent || node.metadata?.prompt || "此节点没有文本内容"}
            </div>
        </div>
    );
}
