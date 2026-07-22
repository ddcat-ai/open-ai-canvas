import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Crosshair, FolderOpen, ImageIcon, Images, PanelLeftClose, Plus, Search, X } from "lucide-react";

import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes } from "@/lib/canvas-theme";
import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ImageAsset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export const CANVAS_IMAGE_ASSET_DND_TYPE = "application/x-infinite-canvas-image-asset";

type TrayTab = "library" | "canvas";

const TRAY_DEFAULT_HEIGHT = 520;
const TRAY_MIN_HEIGHT = 400;
const TRAY_BOTTOM_SAFE_SPACE = 82;

function getMaxTrayHeight() {
    if (typeof window === "undefined") return 520;
    return Math.max(360, window.innerHeight - TRAY_BOTTOM_SAFE_SPACE);
}

function clampTrayHeight(height: number) {
    const maxHeight = getMaxTrayHeight();
    const minHeight = Math.min(TRAY_MIN_HEIGHT, maxHeight);
    return Math.min(Math.max(height, minHeight), maxHeight);
}

type CanvasAssetTrayProps = {
    assetImages: ImageAsset[];
    canvasImages: CanvasNodeData[];
    activeNodeId?: string | null;
    onInsertAssetImage: (asset: ImageAsset) => void;
    onFocusCanvasImage: (nodeId: string) => void;
};

export function CanvasAssetTray({ assetImages, canvasImages, activeNodeId, onInsertAssetImage, onFocusCanvasImage }: CanvasAssetTrayProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<TrayTab>("library");
    const [keyword, setKeyword] = useState("");
    const [trayHeight, setTrayHeight] = useState(() => clampTrayHeight(TRAY_DEFAULT_HEIGHT));
    const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const query = keyword.trim().toLowerCase();
    const filteredAssets = useMemo(() => assetImages.filter((asset) => !query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)), [assetImages, query]);
    const filteredNodes = useMemo(() => canvasImages.filter((node) => !query || canvasImageTitle(node).toLowerCase().includes(query)), [canvasImages, query]);
    const activeItems = tab === "library" ? filteredAssets : filteredNodes;
    const safeTrayHeight = clampTrayHeight(trayHeight);
    const motionEnabled = !reducedMotion;

    const startAssetDrag = (event: DragEvent<HTMLElement>, asset: ImageAsset) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(CANVAS_IMAGE_ASSET_DND_TYPE, asset.id);
        event.dataTransfer.setData("text/plain", asset.title);
    };

    const startResize = useCallback(
        (event: ReactPointerEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            resizeRef.current = { startY: event.clientY, startHeight: safeTrayHeight };

            const updateHeight = (moveEvent: PointerEvent) => {
                if (!resizeRef.current) return;
                setTrayHeight(clampTrayHeight(resizeRef.current.startHeight + resizeRef.current.startY - moveEvent.clientY));
            };
            const stopResize = () => {
                resizeRef.current = null;
                window.removeEventListener("pointermove", updateHeight);
                window.removeEventListener("pointerup", stopResize);
                window.removeEventListener("pointercancel", stopResize);
            };

            window.addEventListener("pointermove", updateHeight);
            window.addEventListener("pointerup", stopResize, { once: true });
            window.addEventListener("pointercancel", stopResize, { once: true });
        },
        [safeTrayHeight],
    );

    useEffect(() => {
        const syncHeight = () => setTrayHeight((height) => clampTrayHeight(height));
        window.addEventListener("resize", syncHeight);
        return () => window.removeEventListener("resize", syncHeight);
    }, []);

    useEffect(() => {
        if (!open) return;
        const closeTray = (event: PointerEvent) => {
            const target = event.target instanceof Node ? event.target : null;
            if (target && rootRef.current?.contains(target)) return;
            setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", closeTray, true);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeTray, true);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);

    const dockItems: FloatingDockEntry[] = [
        {
            id: "asset-tray-toggle",
            label: open ? "收起素材空间" : `打开素材空间，共 ${assetImages.length + canvasImages.length} 项`,
            icon: <span className="relative"><Images /><span className="absolute -right-1.5 -top-1.5 min-w-3 rounded-full px-0.5 text-center text-[6px] font-bold leading-3" style={{ background: theme.accent.primary, color: "#ffffff" }}>{assetImages.length + canvasImages.length}</span></span>,
            active: open,
            onClick: () => setOpen((value) => !value),
        },
    ];

    return (
        <div ref={rootRef} data-canvas-no-zoom className="relative z-[62]" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <AnimatePresence>
                {open ? (
                    <motion.aside
                        initial={{ opacity: 0, y: 20, scale: 0.92, rotateX: 5 }}
                        animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                        exit={{ opacity: 0, y: 14, scale: 0.95, rotateX: 3 }}
                        transition={aceternityMotion.spring.panel}
                        className="aceternity-floating-panel absolute bottom-[50px] left-0 flex w-[min(88vw,312px)] origin-bottom-left flex-col overflow-hidden rounded-[18px] border p-2.5 backdrop-blur-2xl"
                        style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, height: safeTrayHeight, minHeight: Math.min(TRAY_MIN_HEIGHT, getMaxTrayHeight()), maxHeight: "calc(100vh - 6rem)", boxShadow: `0 32px 100px ${theme.spatial.shadow}` }}
                    >
                        <div className="absolute inset-x-10 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.spatial.glowStrong}, transparent)` }} />
                        <button type="button" className="absolute left-1/2 top-1 z-10 flex h-5 w-28 -translate-x-1/2 cursor-ns-resize items-center justify-center rounded-full opacity-35 transition-opacity hover:opacity-75" onPointerDown={startResize} aria-label="从顶部调整素材托盘高度" title="拖动调整高度">
                            <span className="h-1 w-12 rounded-full bg-current" />
                        </button>

                        <div className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-1.5">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.accent.primary }}>
                                    <FolderOpen className="size-3.5" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-xs font-semibold">素材空间</span>
                                    <span className="mt-0.5 block truncate text-[9px]" style={{ color: theme.node.muted }}>拖入画布，或定位已经使用的图片</span>
                                </span>
                            </div>
                            <motion.button type="button" whileHover={motionEnabled ? { rotate: -5, scale: 1.05 } : undefined} whileTap={motionEnabled ? { scale: 0.92 } : undefined} className="grid size-7 shrink-0 place-items-center rounded-full border outline-none focus-visible:ring-2" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.node.muted }} onClick={() => setOpen(false)} aria-label="收起素材空间">
                                <PanelLeftClose className="size-3" />
                            </motion.button>
                        </div>

                        <div className="relative grid grid-cols-2 gap-1 rounded-[12px] border p-0.5" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                            <TrayTabButton active={tab === "library"} label={`素材库 ${assetImages.length}`} theme={theme} onClick={() => setTab("library")} />
                            <TrayTabButton active={tab === "canvas"} label={`当前画布 ${canvasImages.length}`} theme={theme} onClick={() => setTab("canvas")} />
                        </div>

                        <label className="mt-2 flex h-8 items-center gap-1.5 rounded-[11px] border px-2.5 focus-within:ring-2" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                            <Search className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                            <input type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索图片素材..." className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:opacity-55" aria-label="搜索图片素材" />
                            {keyword ? <button type="button" className="grid size-6 shrink-0 place-items-center rounded-full opacity-55 hover:opacity-100" onClick={() => setKeyword("")} aria-label="清空搜索"><X className="size-3" /></button> : null}
                        </label>

                        <div className="thin-scrollbar mt-2.5 min-h-0 flex-1 overflow-y-auto pr-1">
                            {tab === "library" ? (
                                filteredAssets.length ? (
                                    <div className="space-y-1.5">
                                        {filteredAssets.map((asset) => (
                                            <AssetTrayRow key={asset.id} title={asset.title} imageUrl={asset.coverUrl || asset.data.dataUrl} storageKey={asset.data.storageKey} draggable motionEnabled={motionEnabled} onDragStart={(event) => startAssetDrag(event, asset)} onClick={() => onInsertAssetImage(asset)} icon={<Plus className="size-3.5" />} />
                                        ))}
                                    </div>
                                ) : (
                                    <TrayEmpty text="没有匹配的图片素材" theme={theme} />
                                )
                            ) : filteredNodes.length ? (
                                <div className="space-y-1.5">
                                    {filteredNodes.map((node) => (
                                        <AssetTrayRow key={node.id} title={canvasImageTitle(node)} imageUrl={node.metadata?.content || ""} storageKey={node.metadata?.storageKey} active={activeNodeId === node.id} motionEnabled={motionEnabled} onClick={() => onFocusCanvasImage(node.id)} icon={<Crosshair className="size-3.5" />} />
                                    ))}
                                </div>
                            ) : (
                                <TrayEmpty text="当前画布没有匹配图片" theme={theme} />
                            )}
                        </div>

                        <div className="flex items-center justify-between px-1 pt-2.5 text-[10px]" style={{ color: theme.node.muted }}>
                            <span>{tab === "library" ? "点击插入 · 拖拽定位" : "点击回到节点"}</span>
                            <span className="rounded-full border px-2 py-0.5 tabular-nums" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>{activeItems.length} 项</span>
                        </div>
                    </motion.aside>
                ) : null}
            </AnimatePresence>

            <FloatingDock items={dockItems} className="canvas-floating-dock" style={canvasDockStyle(theme)} ariaLabel="素材空间" />
        </div>
    );
}

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

function TrayTabButton({ active, label, theme, onClick }: { active: boolean; label: string; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" className={cn("relative z-10 h-7 rounded-[9px] px-2 text-[10px] font-semibold outline-none transition-colors focus-visible:ring-2", active ? "" : "opacity-55 hover:opacity-90")} style={{ color: active ? theme.node.text : theme.node.muted }} onClick={onClick}>
            {active ? <motion.span layoutId="canvas-asset-tray-active-tab" className="absolute inset-0 -z-10 rounded-[9px] border" style={{ background: theme.node.panel, borderColor: theme.toolbar.border, boxShadow: `0 6px 16px ${theme.spatial.shadow}` }} transition={aceternityMotion.spring.dock} /> : null}
            {label}
        </button>
    );
}

function AssetTrayRow({ title, imageUrl, storageKey, icon, active = false, draggable = false, motionEnabled, onClick, onDragStart }: { title: string; imageUrl: string; storageKey?: string; icon: ReactNode; active?: boolean; draggable?: boolean; motionEnabled: boolean; onClick: () => void; onDragStart?: (event: DragEvent<HTMLElement>) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const location = resourceStorageLocation(storageKey);
    return (
        <motion.button
            type="button"
            draggable={draggable}
            whileHover={motionEnabled ? { x: 4, scale: 1.008 } : undefined}
            whileTap={motionEnabled ? { scale: 0.985 } : undefined}
            transition={aceternityMotion.spring.dock}
            className="group grid h-12 w-full grid-cols-[36px_minmax(0,1fr)_auto_24px] items-center gap-1.5 rounded-[12px] border px-1.5 text-left outline-none focus-visible:ring-2"
            style={{ background: active ? theme.accent.primarySoft : theme.spatial.surface, borderColor: active ? theme.spatial.glowStrong : theme.toolbar.border, color: active ? theme.accent.primary : theme.node.text }}
            onClick={onClick}
            onDragStartCapture={onDragStart}
        >
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[9px] border" style={{ background: theme.node.fill, borderColor: theme.toolbar.border }}>
                {imageUrl ? <img src={imageUrl} alt="" width={36} height={36} className="size-full object-cover" draggable={false} /> : <ImageIcon className="size-3.5 opacity-55" />}
            </span>
            <span className="min-w-0">
                <span className="block truncate text-[10px] font-semibold">{title}</span>
                <span className="mt-0.5 block text-[8px] opacity-45">{active ? "当前已选择" : draggable ? "拖入画布或点击插入" : "点击定位到画布"}</span>
            </span>
            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", location === "oss" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : location === "local" ? "bg-amber-500/12 text-amber-700 dark:text-amber-300" : "bg-black/5 text-stone-400 dark:bg-white/8 dark:text-stone-500")} title={resourceStorageTitle(storageKey)}>
                {resourceStorageLabel(storageKey)}
            </span>
            <span className="grid size-6 place-items-center rounded-full border opacity-45 transition-opacity group-hover:opacity-90" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>{icon}</span>
        </motion.button>
    );
}

function TrayEmpty({ text, theme }: { text: string; theme: CanvasTheme }) {
    return (
        <div className="grid h-full min-h-[200px] place-items-center rounded-[14px] border border-dashed text-center" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.node.muted }}>
            <span><Images className="mx-auto size-5 opacity-35" /><span className="mt-2 block text-xs opacity-55">{text}</span></span>
        </div>
    );
}

function canvasImageTitle(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image) return node.title;
    return node.title || node.metadata?.prompt || "图片节点";
}
