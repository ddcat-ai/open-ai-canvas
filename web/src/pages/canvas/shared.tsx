import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { App, Button, Result } from "antd";
import { Clapperboard, Eye, FileText, Image as ImageIcon, LockKeyhole, LogIn, Send, Share2, Video } from "lucide-react";
import { Link, useParams } from "react-router";
import { nanoid } from "nanoid";

import { ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import { isFrameNode, isNodeHiddenByCollapsedFrame, resolveFrameConnection } from "@/lib/canvas/canvas-frame";
import { getPublicCanvasShare } from "@/services/api/canvas-share";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type Position, type ViewportTransform } from "@/types/canvas";

type ContextMenu = { x: number; y: number; world: Position; nodeId?: string };
type DragState = { primaryId: string; nodeIds: string[]; startX: number; startY: number; origins: Map<string, Position>; moved: boolean };

export default function SharedCanvasPage() {
    const { token = "" } = useParams();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const dragRef = useRef<DragState | null>(null);
    const toolbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [title, setTitle] = useState("共享画布");
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<Awaited<ReturnType<typeof getPublicCanvasShare>>["project"]["connections"]>([]);
    const [backgroundMode, setBackgroundMode] = useState<"lines" | "dots" | "blank">("lines");
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState<Position | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    const unauthorized = useCallback(() => message.warning("未授权：分享画布仅供查看，该操作不会执行。"), [message]);
    const infoNode = nodes.find((node) => node.id === infoNodeId) || null;
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const frameChildrenById = useMemo(() => {
        const result = new Map<string, CanvasNodeData[]>();
        nodes.forEach((node) => {
            if (!node.parentId) return;
            const children = result.get(node.parentId) || [];
            children.push(node);
            result.set(node.parentId, children);
        });
        return result;
    }, [nodes]);
    const visibleNodes = useMemo(() => nodes.filter((node) => !isNodeHiddenByCollapsedFrame(node, nodes)), [nodes]);
    const visibleConnections = useMemo(() => connections.flatMap((connection) => {
        const resolved = resolveFrameConnection(connection, nodes);
        return resolved ? [{ connection, ...resolved }] : [];
    }), [connections, nodes]);
    const connectionBounds = useMemo(() => {
        if (!nodes.length) return { left: -1, top: -1, width: 2, height: 2 };
        const padding = 320;
        const left = Math.min(...nodes.map((node) => node.position.x)) - padding;
        const top = Math.min(...nodes.map((node) => node.position.y)) - padding;
        const right = Math.max(...nodes.map((node) => node.position.x + node.width)) + padding;
        const bottom = Math.max(...nodes.map((node) => node.position.y + node.height)) + padding;
        return { left, top, width: right - left, height: bottom - top };
    }, [nodes]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        getPublicCanvasShare(token).then(({ project }) => {
            if (!active) return;
            setTitle(project.title || "共享画布");
            setNodes(project.nodes || []);
            setConnections(project.connections || []);
            setBackgroundMode(project.backgroundMode || "lines");
            const initial = project.viewport || { x: 0, y: 0, k: 1 };
            viewportRef.current = initial;
            setViewport(initial);
        }).catch((error) => {
            if (active) setLoadError(error instanceof Error ? error.message : "分享链接无效或已失效");
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [token]);

    useEffect(() => {
        const onMove = (event: MouseEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const next = { x: (event.clientX - drag.startX) / viewportRef.current.k, y: (event.clientY - drag.startY) / viewportRef.current.k };
            if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
            setDragOffset(next);
        };
        const onUp = (event: MouseEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const offset = { x: (event.clientX - drag.startX) / viewportRef.current.k, y: (event.clientY - drag.startY) / viewportRef.current.k };
            if (drag.moved) setNodes((current) => current.map((node) => {
                const origin = drag.origins.get(node.id);
                return origin ? { ...node, position: { x: origin.x + offset.x, y: origin.y + offset.y } } : node;
            }));
            else setInfoNodeId(drag.primaryId);
            dragRef.current = null;
            setDragOffset(null);
            document.body.style.cursor = "default";
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "default";
            if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
        };
    }, []);

    const keepToolbar = useCallback((nodeId: string) => {
        if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
        toolbarTimerRef.current = null;
        setToolbarNodeId(nodeId);
    }, []);
    const hideToolbar = useCallback(() => {
        if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
        toolbarTimerRef.current = setTimeout(() => {
            toolbarTimerRef.current = null;
            setToolbarNodeId(null);
        }, 160);
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                unauthorized();
            }
            if (event.key === "Escape") setContextMenu(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [unauthorized]);

    const onViewportChange = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        setViewport(next);
        setContextMenu(null);
    }, []);
    const setZoom = (scale: number) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const current = viewportRef.current;
        onViewportChange({
            x: rect.width / 2 - ((rect.width / 2 - current.x) / current.k) * scale,
            y: rect.height / 2 - ((rect.height / 2 - current.y) / current.k) * scale,
            k: scale,
        });
    };
    const resetViewport = () => {
        const container = containerRef.current;
        if (!container || !nodes.length) return onViewportChange({ x: 0, y: 0, k: 1 });
        const rect = container.getBoundingClientRect();
        const left = Math.min(...nodes.map((node) => node.position.x));
        const top = Math.min(...nodes.map((node) => node.position.y));
        const right = Math.max(...nodes.map((node) => node.position.x + node.width));
        const bottom = Math.max(...nodes.map((node) => node.position.y + node.height));
        const scale = Math.min(1, Math.max(0.05, Math.min((rect.width - 120) / Math.max(right - left, 1), (rect.height - 140) / Math.max(bottom - top, 1))));
        onViewportChange({ x: rect.width / 2 - ((left + right) / 2) * scale, y: rect.height / 2 - ((top + bottom) / 2) * scale, k: scale });
    };
    const openContextMenu = (event: ReactMouseEvent, nodeId?: string) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const current = viewportRef.current;
        setContextMenu({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            world: { x: (event.clientX - rect.left - current.x) / current.k, y: (event.clientY - rect.top - current.y) / current.k },
            nodeId,
        });
    };
    const addNode = (type: CanvasNodeType) => {
        if (!contextMenu) return;
        const size = NODE_DEFAULT_SIZE[type];
        setNodes((current) => [...current, {
            id: `shared-${nanoid()}`,
            type,
            title: type === CanvasNodeType.Text ? "临时文本" : type === CanvasNodeType.Image ? "临时图片" : type === CanvasNodeType.Video ? "临时视频" : "临时分镜",
            position: contextMenu.world,
            width: size.width,
            height: size.height,
            metadata: type === CanvasNodeType.Text ? { content: "此节点只存在于当前浏览器页面，刷新后消失。" } : {},
        }]);
        setContextMenu(null);
        message.info("已添加临时节点，刷新页面后会消失");
    };
    const toggleFrame = (nodeId: string) => setNodes((current) => current.map((node) => {
        if (node.id !== nodeId || !isFrameNode(node)) return node;
        const collapsed = !node.metadata?.frame?.collapsed;
        const frame = node.metadata?.frame;
        return {
            ...node,
            width: collapsed ? 240 : frame?.expandedWidth || node.width,
            height: collapsed ? 144 : frame?.expandedHeight || node.height,
            metadata: { ...node.metadata, frame: { collapsed, expandedWidth: collapsed ? node.width : frame?.expandedWidth || node.width, expandedHeight: collapsed ? node.height : frame?.expandedHeight || node.height } },
        };
    }));
    const renderSharedNode = useCallback((node: CanvasNodeData): ReactNode => node.type === CanvasNodeType.Script ? <SharedScriptNode node={node} onUnauthorized={unauthorized} /> : <SharedConfigNode node={node} onUnauthorized={unauthorized} />, [unauthorized]);
    const toolbarNodeKey = toolbarNodeId || selectedNodeId;
    const toolbarNode = toolbarNodeKey ? nodeById.get(toolbarNodeKey) || null : null;

    if (loading) return <FullScreenLoader label="正在打开共享画布" detail="读取节点、连线和视图状态" />;
    if (loadError) return <div className="grid h-screen place-items-center" style={{ background: theme.canvas.background }}><Result status="404" title="分享链接不可用" subTitle={loadError} extra={<Link to="/"><Button>返回首页</Button></Link>} /></div>;

    return (
        <main className="relative h-screen overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <header className="pointer-events-none absolute inset-x-0 top-0 z-[80] flex h-16 items-center justify-between px-5">
                <div className="pointer-events-auto flex min-w-0 items-center gap-3">
                    <Share2 className="size-4" style={{ color: theme.node.muted }} />
                    <span className="max-w-[45vw] truncate text-base font-semibold">{title}</span>
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: theme.node.muted }}><Eye className="size-3.5" />只读分享</span>
                </div>
                <Link className="pointer-events-auto" to="/login"><Button type="text" icon={<LogIn className="size-4" />}>登录</Button></Link>
            </header>

            <InfiniteCanvas containerRef={containerRef} viewport={viewport} backgroundMode={backgroundMode} onViewportChange={onViewportChange} onViewportPreviewChange={(next) => { viewportRef.current = next; }} onCanvasDeselect={() => { setSelectedNodeId(null); setContextMenu(null); }} onContextMenu={(event) => openContextMenu(event)} onDrop={(event) => { event.preventDefault(); unauthorized(); }}>
                <svg className="absolute overflow-visible" viewBox={`${connectionBounds.left} ${connectionBounds.top} ${connectionBounds.width} ${connectionBounds.height}`} style={{ left: connectionBounds.left, top: connectionBounds.top, width: connectionBounds.width, height: connectionBounds.height, pointerEvents: "none", zIndex: 0 }}>
                    {visibleConnections.map(({ connection, from, to }) => <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={false} onSelect={() => setInfoNodeId(to.id)} />)}
                </svg>
                {visibleNodes.map((node) => isFrameNode(node) ? <CanvasFrameNode key={node.id} data={node} dragOffset={dragRef.current?.nodeIds.includes(node.id) && dragOffset ? dragOffset : undefined} childNodes={frameChildrenById.get(node.id) || []} scale={viewport.k} isSelected={selectedNodeId === node.id} isDropTarget={false} readOnly onMouseDown={(event, nodeId) => {
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    setSelectedNodeId(nodeId);
                    setContextMenu(null);
                    const dragged = [node, ...(frameChildrenById.get(nodeId) || [])];
                    dragRef.current = { primaryId: nodeId, nodeIds: dragged.map((item) => item.id), startX: event.clientX, startY: event.clientY, origins: new Map(dragged.map((item) => [item.id, item.position])), moved: false };
                    document.body.style.cursor = "grabbing";
                }} onResize={() => undefined} onToggleCollapsed={toggleFrame} onTitleChange={unauthorized} onHoverStart={keepToolbar} onHoverEnd={hideToolbar} onContextMenu={(event, nodeId) => openContextMenu(event, nodeId)} /> : <CanvasNode key={node.id} data={node} dragOffset={dragRef.current?.nodeIds.includes(node.id) && dragOffset ? dragOffset : undefined} scale={viewport.k} isSelected={selectedNodeId === node.id} isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showImageInfo={false} readOnly renderNodeContent={renderSharedNode} onMouseDown={(event, nodeId) => {
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    const target = nodes.find((item) => item.id === nodeId);
                    if (!target) return;
                    setSelectedNodeId(nodeId);
                    setContextMenu(null);
                    dragRef.current = { primaryId: nodeId, nodeIds: [nodeId], startX: event.clientX, startY: event.clientY, origins: new Map([[nodeId, target.position]]), moved: false };
                    document.body.style.cursor = "grabbing";
                }} onHoverStart={keepToolbar} onHoverEnd={hideToolbar} onConnectStart={unauthorized} onResize={() => undefined} onContentChange={unauthorized} onRetry={unauthorized} onCancelTask={unauthorized} onOpenTaskDetails={unauthorized} onGenerateImage={unauthorized} onViewImage={(target) => setInfoNodeId(target.id)} onContextMenu={(event, nodeId) => openContextMenu(event, nodeId)} />)}
            </InfiniteCanvas>

            <CanvasNodeHoverToolbar node={dragRef.current ? null : toolbarNode} viewport={viewport} containerRef={containerRef} onKeep={keepToolbar} onLeave={hideToolbar} onInfo={(node) => setInfoNodeId(node.id)} onEditText={unauthorized} onDecreaseFont={unauthorized} onIncreaseFont={unauthorized} onToggleDialog={unauthorized} onAnnotate={unauthorized} onGenerateImage={unauthorized} onUpload={unauthorized} onDownload={unauthorized} onSaveAsset={unauthorized} onMaskEdit={unauthorized} onCrop={unauthorized} onSplit={unauthorized} onUpscale={unauthorized} onSuperResolve={unauthorized} onAngle={unauthorized} onViewImage={unauthorized} onExtractVideoLastFrame={unauthorized} extractingVideoFrame={false} onReversePrompt={unauthorized} onRetry={unauthorized} onToggleFreeResize={unauthorized} onToggleLocked={unauthorized} onDelete={unauthorized} />

            <div className="absolute bottom-5 left-5 z-[70]"><CanvasZoomControls scale={viewport.k} containerRef={containerRef} onScaleChange={setZoom} onReset={resetViewport} isMiniMapOpen={false} onToggleMiniMap={unauthorized} onOpenShortcuts={unauthorized} /></div>
            <div className="pointer-events-none absolute bottom-5 right-5 z-[70] max-w-[340px] text-right text-xs leading-5" style={{ color: theme.node.muted }}>访客操作仅在当前页面临时生效</div>

            {contextMenu ? <SharedContextMenu menu={contextMenu} onAdd={addNode} onInfo={() => { if (contextMenu.nodeId) setInfoNodeId(contextMenu.nodeId); setContextMenu(null); }} onUnauthorized={() => { setContextMenu(null); unauthorized(); }} /> : null}
            <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} readOnly onUnauthorized={unauthorized} />
        </main>
    );
}

function SharedContextMenu({ menu, onAdd, onInfo, onUnauthorized }: { menu: ContextMenu; onAdd: (type: CanvasNodeType) => void; onInfo: () => void; onUnauthorized: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div data-canvas-no-zoom className="absolute z-[90] min-w-48 rounded-lg border p-1.5 shadow-xl" style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
        {menu.nodeId ? <><MenuButton icon={<Eye />} label="查看节点信息" onClick={onInfo} /><MenuButton icon={<LockKeyhole />} label="编辑或生成" onClick={onUnauthorized} /></> : <>
            <div className="px-2 py-1.5 text-[11px]" style={{ color: theme.node.muted }}>添加临时节点</div>
            <MenuButton icon={<FileText />} label="文本节点" onClick={() => onAdd(CanvasNodeType.Text)} />
            <MenuButton icon={<ImageIcon />} label="图片节点" onClick={() => onAdd(CanvasNodeType.Image)} />
            <MenuButton icon={<Video />} label="视频节点" onClick={() => onAdd(CanvasNodeType.Video)} />
            <MenuButton icon={<Clapperboard />} label="分镜脚本" onClick={() => onAdd(CanvasNodeType.Script)} />
        </>}
    </div>;
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return <button type="button" className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClick}><span className="grid size-4 place-items-center [&>svg]:size-4">{icon}</span>{label}</button>;
}

function SharedConfigNode({ node, onUnauthorized }: { node: CanvasNodeData; onUnauthorized: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="flex h-full w-full flex-col overflow-hidden rounded-[17px]">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}><ImageIcon className="size-4" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title}</span></div>
        <div className="min-h-0 flex-1 whitespace-pre-wrap break-words p-4 text-sm leading-6" style={{ color: theme.node.muted }}>{node.metadata?.composerContent || node.metadata?.prompt || "未填写提示词"}</div>
        <div className="flex h-12 shrink-0 items-center justify-end border-t px-3" style={{ borderColor: theme.node.stroke }}><Button size="small" icon={<Send className="size-3.5" />} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onUnauthorized(); }}>生成</Button></div>
    </div>;
}

function SharedScriptNode({ node, onUnauthorized }: { node: CanvasNodeData; onUnauthorized: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const rows = node.metadata?.storyboard?.rows || [];
    return <div className="flex h-full w-full flex-col overflow-hidden rounded-[17px]">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}><Clapperboard className="size-4" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title}</span><span className="text-xs" style={{ color: theme.node.muted }}>{rows.length} 镜</span><button type="button" className="grid size-7 place-items-center rounded hover:bg-black/5 dark:hover:bg-white/10" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onUnauthorized(); }} aria-label="一键创建视频节点"><Video className="size-3.5" /></button></div>
        <div data-canvas-wheel-scroll className="min-h-0 flex-1 overflow-y-auto" onWheel={(event) => event.stopPropagation()}>{rows.length ? rows.map((row) => <div key={row.id} className="grid grid-cols-[52px_72px_minmax(180px,1fr)_minmax(150px,.8fr)] border-b text-xs leading-5" style={{ minHeight: 48, borderColor: theme.node.stroke }}><span className="grid place-items-center border-r" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>#{row.shotNumber}</span><span className="grid place-items-center border-r" style={{ borderColor: theme.node.stroke }}>{row.durationSeconds}s</span><span className="border-r px-3 py-2" style={{ borderColor: theme.node.stroke }}>{row.plotDescription || "-"}</span><span className="px-3 py-2" style={{ color: theme.node.muted }}>{row.dialogue || "-"}</span></div>) : <div className="grid h-full place-items-center text-sm" style={{ color: theme.node.muted }}>暂无分镜</div>}</div>
        {node.metadata?.composerContent ? <div className="max-h-24 shrink-0 overflow-y-auto border-t px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{node.metadata.composerContent}</div> : null}
    </div>;
}
