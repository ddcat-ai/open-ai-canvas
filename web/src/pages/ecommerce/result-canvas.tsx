import { createClientUUID } from "@/lib/client-id";
import { Tooltip } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { Check, Eye, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { CanvasViewport } from "@/components/canvas/canvas-viewport";
import { HandIcon, ImagePlusIcon, LayersIcon, PointerIcon, RedoIcon, TextToolIcon, UndoIcon } from "@/components/ui/ecommerce-icons";
import { resolveCanvasSelectionStrategy } from "@/lib/canvas/canvas-selection";
import { resourceStorageKey, resolveResourceVariantUrl, uploadResourceFile } from "@/services/api/resources";
import type { ViewportTransform } from "@/types/canvas";
import { arrangeCommerceBoxes } from "./canvas-arrange";
import { CommerceArrangeMenu, type CommerceArrangeAction } from "./canvas-arrange-bar";
import { commerceCanvasLayout } from "./canvas-layout";
import { COMMERCE_SNAP_THRESHOLD, measureCommerceSnapScene, paintCommerceSnapGuides, snapCommerceMove, type SnapScene } from "./canvas-snap";
import { useResultNodeDrag } from "./use-result-node-drag";

type CanvasLayer = { id: string; type: "text" | "image" | "result"; x: number; y: number; text?: string; resourceId?: string };
type CanvasHistory = { past: CanvasLayer[][]; present: CanvasLayer[]; future: CanvasLayer[][] };
type CanvasTool = "select" | "hand" | "text";
type GroupBounds = { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number; inset: number };

/** 与视口组件的缩放范围一致；快捷键缩放落在常用整档比例上。 */
const ZOOM_STOPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const clampZoom = (k: number) => Math.min(2, Math.max(0.05, k));
/** 排布动画时长，结束后再重新测量选区外框。 */
const ARRANGE_MOTION_MS = 380;

/** 底部工具条与画布边缘、右下角图层组之间的最小间距。 */
const TOOLBAR_EDGE = 16;
const TOOLBAR_GAP = 12;

/**
 * 左侧 Agent 面板悬浮在画布上时，从画布左边缘算起被面板占住的宽度；面板收起，
 * 或窄屏下面板改为与画布上下堆叠（不再绝对定位）时为 0。
 * 用 offsetLeft/offsetWidth 而不是 getBoundingClientRect，收起/展开动画里的 transform 不会让结果抖动。
 */
function overlayPanelInset(section: HTMLElement | null) {
    const panel = section?.parentElement?.querySelector<HTMLElement>(".flylep-workspace:not(.is-collapsed)");
    if (!section || !panel || getComputedStyle(panel).position !== "absolute") return 0;
    return Math.max(0, Math.min(section.clientWidth, panel.offsetLeft + panel.offsetWidth - section.offsetLeft));
}

function readLayers(storageKey: string): CanvasLayer[] {
    try {
        const value = JSON.parse(localStorage.getItem(`ecommerce-canvas:${storageKey}`) || "[]");
        return Array.isArray(value) ? value.filter((item): item is CanvasLayer => item && typeof item.id === "string" && ["text", "image", "result"].includes(item.type) && Number.isFinite(item.x) && Number.isFinite(item.y)) : [];
    } catch {
        return [];
    }
}

type ResultLayer = { id: string; label: string; src?: string; ready: boolean };
export function EcommerceResultCanvas({
    children,
    count,
    ratio,
    actions,
    emptyState,
    storageKey,
    resultLayers = [],
    selectedResults = new Set<string>(),
    onSelectResult,
    onSelectResults,
    onSelectAll,
    onExportSelection,
    onInspectResult,
}: {
    children: ReactNode;
    count: number;
    ratio: string;
    actions: ReactNode;
    emptyState?: ReactNode;
    storageKey: string;
    resultLayers?: ResultLayer[];
    selectedResults?: Set<string>;
    onSelectResult?: (id: string) => void;
    onSelectResults?: (ids: string[]) => void;
    onSelectAll?: () => void;
    onExportSelection?: () => void;
    onInspectResult?: (id: string) => void;
}) {
    const reducedMotion = useReducedMotion();
    const root = useRef<HTMLElement>(null);
    const container = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const imageFitFrame = useRef<number | null>(null);
    const manuallyNavigated = useRef(false);
    const uploadInput = useRef<HTMLInputElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const layerToggleRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ id: string; pointerId: number; startX: number; startY: number; layerX: number; layerY: number; before: CanvasLayer[]; snap: SnapScene | null } | null>(null);
    const guideLayer = useRef<HTMLDivElement>(null);
    const layout = commerceCanvasLayout(count, ratio);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 450, y: 160, k: 0.8 });
    const navigateViewport = useCallback((next: ViewportTransform) => {
        manuallyNavigated.current = true;
        setViewport(next);
    }, []);
    const [tool, setTool] = useState<CanvasTool>("select");
    const [history, setHistory] = useState<CanvasHistory>(() => ({ past: [], present: readLayers(storageKey), future: [] }));
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [layersOpen, setLayersOpen] = useState(false);
    const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [groupBounds, setGroupBounds] = useState<GroupBounds | null>(null);
    const [arranging, setArranging] = useState(false);
    const arrangeTimer = useRef<number | null>(null);
    const marqueeFrame = useRef<number | null>(null);
    const selectionCleanup = useRef<(() => void) | null>(null);
    useEffect(
        () => () => {
            selectionCleanup.current?.();
            if (arrangeTimer.current !== null) window.clearTimeout(arrangeTimer.current);
            if (marqueeFrame.current !== null) cancelAnimationFrame(marqueeFrame.current);
        },
        [],
    );
    const commit = useCallback((next: CanvasLayer[]) => setHistory((current) => ({ past: [...current.past.slice(-39), current.present], present: next, future: [] })), []);
    const resultDrag = useResultNodeDrag({
        content,
        root,
        enabled: tool === "select",
        positions: history.present.filter((item) => item.type === "result"),
        selected: selectedResults,
        onSelect: (ids) => {
            setSelectedId(null);
            onSelectResults?.(ids);
        },
        onCommit: (positions) => {
            const moved = new Set(positions.map((item) => item.id));
            commit([...history.present.filter((item) => item.type !== "result" || !moved.has(item.id)), ...positions.map((item) => ({ ...item, type: "result" as const }))]);
        },
    });
    useLayoutEffect(() => {
        if (selectedResults.size < 2) {
            setGroupBounds(null);
            return;
        }
        // 排布动画进行中节点仍在过渡，等动画结束再测量；期间外框与排布条由样式隐藏。
        if (arranging) return;
        const frame = container.current?.getBoundingClientRect();
        if (!frame) return;
        const selected = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]") || []).filter((item) => selectedResults.has(item.dataset.ecommerceImageId || ""));
        if (selected.length < 2) {
            setGroupBounds(null);
            return;
        }
        const bounds = selected.map((item) => item.getBoundingClientRect());
        const left = Math.min(...bounds.map((item) => item.left));
        const top = Math.min(...bounds.map((item) => item.top));
        const right = Math.max(...bounds.map((item) => item.right));
        const bottom = Math.max(...bounds.map((item) => item.bottom));
        const inset = Number.parseFloat(root.current?.style.getPropertyValue("--commerce-sidebar-width") || "") || 0;
        const outline = root.current?.querySelector<HTMLElement>(".commerce-canvas-group-outline");
        if (outline) outline.style.translate = "";
        setGroupBounds({ x: left - frame.left, y: top - frame.top, width: right - left, height: bottom - top, frameWidth: frame.width, frameHeight: frame.height, inset });
    }, [selectedResults, viewport, history.present, arranging]);
    const undo = useCallback(() => setHistory((current) => (current.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future] } : current)), []);
    const redo = useCallback(() => setHistory((current) => (current.future.length ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) } : current)), []);
    useEffect(() => {
        try {
            localStorage.setItem(`ecommerce-canvas:${storageKey}`, JSON.stringify(history.present));
        } catch {
            /* Storage is optional; editing remains available. */
        }
    }, [history.present, storageKey]);
    // 快捷键处理依赖较多实时状态，用 ref 保存最新处理函数，只订阅一次窗口事件。
    const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => keyHandler.current(event);
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    const fitTarget = useCallback((): ViewportTransform => {
        const width = container.current?.clientWidth || 1200;
        const height = container.current?.clientHeight || 700;
        // 只有面板真正悬浮在画布上方时才让出左侧空间（与样式断点一致，不再按画布宽度猜测）。
        const occupied = overlayPanelInset(root.current);
        const inset = occupied ? occupied + 20 : 24;
        root.current?.style.setProperty("--commerce-sidebar-width", `${occupied}px`);
        const rightInset = 24;
        const bounds = commerceCanvasLayout(count, ratio);
        const origin = content.current?.getBoundingClientRect();
        const scale = origin && content.current?.offsetWidth ? origin.width / content.current.offsetWidth : 1;
        const nodes = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-node-id]") || []).map((node) => node.getBoundingClientRect());
        const left = origin && nodes.length ? Math.min(...nodes.map((node) => (node.left - origin.left) / scale)) : 0;
        const top = origin && nodes.length ? Math.min(...nodes.map((node) => (node.top - origin.top) / scale)) : 0;
        const contentWidth = origin && nodes.length ? Math.max(...nodes.map((node) => (node.right - origin.left) / scale)) - left : bounds.width;
        const contentHeight = origin && nodes.length ? Math.max(...nodes.map((node) => (node.bottom - origin.top) / scale)) - top : bounds.height;
        const k = Math.min(1, Math.max(0.05, Math.min((width - inset - rightInset) / Math.max(1, contentWidth), (height - 140) / Math.max(1, contentHeight))));
        return { x: inset + (width - inset - rightInset - contentWidth * k) / 2 - left * k, y: Math.max(80, (height - contentHeight * k) / 2) - top * k, k };
    }, [count, ratio]);
    const fit = useCallback(() => setViewport(fitTarget()), [fitTarget]);
    useEffect(
        () => () => {
            if (imageFitFrame.current !== null) cancelAnimationFrame(imageFitFrame.current);
        },
        [],
    );
    useLayoutEffect(() => {
        fit();
        const observer = new ResizeObserver(fit);
        if (container.current) observer.observe(container.current);
        const sidebar = container.current?.parentElement?.parentElement?.querySelector<HTMLElement>(".flylep-workspace");
        if (sidebar) observer.observe(sidebar);
        const classObserver = new MutationObserver(fit);
        if (sidebar) classObserver.observe(sidebar, { attributes: true, attributeFilter: ["class"] });
        return () => {
            observer.disconnect();
            classObserver.disconnect();
        };
    }, [fit]);
    /**
     * 底部工具条居中在可见画布里（左侧面板右缘到画布右缘），并夹在面板与右下角图层组之间；
     * 空间不够时退而保证整条留在画布内。画布、面板、工具条或图层组尺寸变化、面板收起展开时重新计算，
     * 不依赖 fitTarget 的副作用，也不受画布按项目重新挂载的影响。
     */
    const placeToolbar = useCallback(() => {
        const section = root.current,
            bar = toolbarRef.current;
        if (!section || !bar) return;
        const width = section.clientWidth;
        const half = bar.offsetWidth / 2;
        const left = overlayPanelInset(section);
        const toggle = layerToggleRef.current;
        const right = toggle?.offsetWidth ? Math.min(width, toggle.offsetLeft - TOOLBAR_GAP) : width - TOOLBAR_EDGE;
        const min = left + TOOLBAR_EDGE + half,
            max = right - half;
        const center = min <= max ? Math.min(max, Math.max(min, (left + width) / 2)) : Math.min(width - TOOLBAR_EDGE - half, Math.max(TOOLBAR_EDGE + half, (left + right) / 2));
        section.style.setProperty("--commerce-toolbar-x", `${Math.round(center)}px`);
    }, []);
    useLayoutEffect(() => {
        const section = root.current;
        if (!section) return;
        placeToolbar();
        const observer = new ResizeObserver(() => placeToolbar());
        observer.observe(section);
        for (const element of [toolbarRef.current, layerToggleRef.current]) if (element) observer.observe(element);
        const panel = section.parentElement?.querySelector<HTMLElement>(".flylep-workspace");
        const panelClass = new MutationObserver(() => placeToolbar());
        if (panel) {
            observer.observe(panel);
            panelClass.observe(panel, { attributes: true, attributeFilter: ["class"] });
        }
        window.addEventListener("resize", placeToolbar);
        return () => {
            observer.disconnect();
            panelClass.disconnect();
            window.removeEventListener("resize", placeToolbar);
        };
    }, [placeToolbar]);
    const worldPoint = (clientX: number, clientY: number) => {
        const rect = container.current?.getBoundingClientRect();
        return { x: Math.round((clientX - (rect?.left || 0) - viewport.x) / viewport.k), y: Math.round((clientY - (rect?.top || 0) - viewport.y) / viewport.k) };
    };
    /**
     * 框选：拖动时实时高亮命中的图片（直接改 DOM 属性，不触发页面重渲染），松开后一次性提交选择。
     * Shift 追加、Ctrl/⌘ 反选、Alt 减选，与主画布一致；Esc 取消本次框选并保留原选择。
     */
    const startMarquee = (event: PointerEvent<HTMLDivElement>) => {
        const frame = container.current?.getBoundingClientRect();
        if (!frame) return;
        // 画布获得焦点后 V/H/T、Ctrl+A、方向键等快捷键才会生效。
        root.current?.focus({ preventScroll: true });
        const startX = event.clientX,
            startY = event.clientY,
            pointerId = event.pointerId;
        const strategy = resolveCanvasSelectionStrategy(event);
        const base = new Set(selectedResults);
        const ready = new Set(resultLayers.filter((item) => item.ready).map((item) => item.id));
        const candidates = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]") || [])
            .filter((node) => ready.has(node.dataset.ecommerceImageId || ""))
            .map((node) => ({ node, id: node.dataset.ecommerceImageId!, rect: node.getBoundingClientRect() }));
        let latest = { x: startX, y: startY };
        const hits = () => {
            const left = Math.min(startX, latest.x),
                right = Math.max(startX, latest.x),
                top = Math.min(startY, latest.y),
                bottom = Math.max(startY, latest.y);
            return new Set(candidates.filter(({ rect }) => rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top).map(({ id }) => id));
        };
        const combine = (hit: Set<string>) => {
            if (strategy === "add") return new Set([...base, ...hit]);
            if (strategy === "subtract") return new Set([...base].filter((id) => !hit.has(id)));
            if (strategy === "toggle") return new Set([...[...base].filter((id) => !hit.has(id)), ...[...hit].filter((id) => !base.has(id))]);
            return hit;
        };
        const paint = () => {
            marqueeFrame.current = null;
            setSelectionBox({ x: Math.min(startX, latest.x) - frame.left, y: Math.min(startY, latest.y) - frame.top, width: Math.abs(latest.x - startX), height: Math.abs(latest.y - startY) });
            const next = combine(hits());
            for (const { node, id } of candidates) node.toggleAttribute("data-marquee-hit", next.has(id));
        };
        const finish = (apply: boolean) => {
            selectionCleanup.current?.();
            selectionCleanup.current = null;
            if (marqueeFrame.current !== null) {
                cancelAnimationFrame(marqueeFrame.current);
                marqueeFrame.current = null;
            }
            for (const { node } of candidates) node.removeAttribute("data-marquee-hit");
            setSelectionBox(null);
            if (!apply) return;
            if (Math.abs(latest.x - startX) < 5 && Math.abs(latest.y - startY) < 5) {
                if (strategy === "replace") onSelectResults?.([]);
                return;
            }
            onSelectResults?.(Array.from(combine(hits())));
        };
        const move = (pointer: globalThis.PointerEvent) => {
            if (pointer.pointerId !== pointerId) return;
            latest = { x: pointer.clientX, y: pointer.clientY };
            if (marqueeFrame.current === null) marqueeFrame.current = requestAnimationFrame(paint);
        };
        const end = (pointer: globalThis.PointerEvent) => {
            if (pointer.pointerId !== pointerId) return;
            latest = { x: pointer.clientX, y: pointer.clientY };
            finish(pointer.type === "pointerup");
        };
        const cancel = (key: KeyboardEvent) => {
            if (key.key === "Escape") {
                key.preventDefault();
                finish(false);
            }
        };
        selectionCleanup.current?.();
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("keydown", cancel);
        selectionCleanup.current = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            window.removeEventListener("keydown", cancel);
        };
    };
    const addText = (event: PointerEvent<HTMLDivElement>) => {
        if (tool !== "text") {
            setSelectedId(null);
            if (tool === "select") startMarquee(event);
            return;
        }
        const point = worldPoint(event.clientX, event.clientY);
        const id = createClientUUID();
        commit([...history.present, { id, type: "text", ...point, text: "电商 Agent" }]);
        setSelectedId(id);
        setTool("select");
    };
    const uploadImage = async (files: FileList | null) => {
        if (!files?.length || uploading) return;
        setUploading(true);
        setUploadError("");
        try {
            const resources = await Promise.all(Array.from(files).map((file) => uploadResourceFile(file, "image", { fileName: file.name })));
            const rect = container.current?.getBoundingClientRect();
            const point = worldPoint((rect?.left || 0) + (rect?.width || 1000) / 2, (rect?.top || 0) + (rect?.height || 700) / 2);
            commit([...history.present, ...resources.map((resource, index) => ({ id: createClientUUID(), type: "image" as const, x: point.x + index * 28, y: point.y + index * 28, resourceId: resource.id }))]);
            setTool("select");
        } catch (cause) {
            setUploadError(cause instanceof Error ? cause.message : "图片上传失败，请重试");
        } finally {
            setUploading(false);
        }
    };
    const startDrag = (event: PointerEvent<HTMLDivElement>, layer: CanvasLayer) => {
        if (tool !== "select" || editingId) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        // 按下时记录其他元素的位置，拖动中据此吸附对齐。
        drag.current = {
            id: layer.id,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            layerX: layer.x,
            layerY: layer.y,
            before: history.present,
            snap: content.current ? measureCommerceSnapScene(content.current, [event.currentTarget], viewport.k) : null,
        };
        setSelectedId(layer.id);
    };
    const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const dx = (event.clientX - current.startX) / viewport.k;
        const dy = (event.clientY - current.startY) / viewport.k;
        // 按住 Ctrl/⌘ 拖动时暂时关闭吸附。
        const snapped = current.snap?.moving && !event.ctrlKey && !event.metaKey ? snapCommerceMove(current.snap.moving, dx, dy, current.snap.targets, COMMERCE_SNAP_THRESHOLD / viewport.k) : { dx, dy, guides: [] };
        paintCommerceSnapGuides(guideLayer.current, snapped.guides, viewport.k);
        const x = Math.round(current.layerX + snapped.dx);
        const y = Math.round(current.layerY + snapped.dy);
        setHistory((state) => ({ ...state, present: state.present.map((item) => (item.id === current.id ? { ...item, x, y } : item)) }));
    };
    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        drag.current = null;
        paintCommerceSnapGuides(guideLayer.current, [], viewport.k);
        setHistory((state) => (state.present.some((item) => item.id === current.id && (item.x !== current.layerX || item.y !== current.layerY)) ? { past: [...state.past.slice(-39), current.before], present: state.present, future: [] } : state));
    };
    const finishEdit = () => {
        if (!editingId) return;
        const next = history.present.map((item) => (item.id === editingId ? { ...item, text: editingText.trim() || "电商 Agent" } : item));
        if (next.some((item, index) => item.text !== history.present[index]?.text)) commit(next);
        setEditingId(null);
    };
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;
    const flight = useRef<number | null>(null);
    useEffect(
        () => () => {
            if (flight.current !== null) cancelAnimationFrame(flight.current);
        },
        [],
    );
    /**
     * 平滑飞行到目标视口：位置与缩放同步插值，缩放在对数空间插值（视觉上匀速），
     * 远距离时先略微拉远再推近，路径连贯不跳帧。用户中途拖动/缩放会立即接管。
     */
    const flyTo = useCallback(
        (target: ViewportTransform, quick = false) => {
            if (flight.current !== null) cancelAnimationFrame(flight.current);
            const from = viewportRef.current;
            if (reducedMotion) {
                setViewport(target);
                return;
            }
            const frame = container.current?.getBoundingClientRect();
            const span = Math.hypot(target.x - from.x, target.y - from.y) / Math.max(1, Math.hypot(frame?.width || 1200, frame?.height || 800));
            // 缩放按钮/快捷键使用短促的直接过渡，不做先拉远再推近。
            const dip = quick ? 0 : Math.min(0.28, span * 0.35);
            const duration = quick ? 240 : Math.min(820, 460 + span * 260);
            const start = performance.now();
            const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
            const step = (now: number) => {
                const t = Math.min(1, (now - start) / duration);
                const e = ease(t);
                const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e) * (1 - dip * Math.sin(Math.PI * e));
                // 屏幕中心对应的世界点按 e 插值，保证缩放过程中目标始终朝中心移动。
                const cx = (frame?.width || 1200) / 2,
                    cy = (frame?.height || 800) / 2;
                const wx0 = (cx - from.x) / from.k,
                    wy0 = (cy - from.y) / from.k;
                const wx1 = (cx - target.x) / target.k,
                    wy1 = (cy - target.y) / target.k;
                const wx = wx0 + (wx1 - wx0) * e,
                    wy = wy0 + (wy1 - wy0) * e;
                setViewport(t >= 1 ? target : { k, x: cx - wx * k, y: cy - wy * k });
                flight.current = t < 1 ? requestAnimationFrame(step) : null;
            };
            flight.current = requestAnimationFrame(step);
        },
        [reducedMotion],
    );
    const userNavigate = useCallback(
        (next: ViewportTransform) => {
            if (flight.current !== null) {
                cancelAnimationFrame(flight.current);
                flight.current = null;
            }
            navigateViewport(next);
        },
        [navigateViewport],
    );
    /** 以可见画布区域（扣除左侧 Agent 面板）的中心为锚点缩放。 */
    const zoomTo = (resolve: (k: number) => number) => {
        const frame = container.current?.getBoundingClientRect();
        if (!frame) return;
        const current = viewportRef.current;
        const k = clampZoom(resolve(current.k));
        if (Math.abs(k - current.k) < 0.001) return;
        const inset = Number.parseFloat(root.current?.style.getPropertyValue("--commerce-sidebar-width") || "") || 0;
        const cx = (inset + frame.width) / 2,
            cy = frame.height / 2;
        const wx = (cx - current.x) / current.k,
            wy = (cy - current.y) / current.k;
        manuallyNavigated.current = true;
        flyTo({ k, x: cx - wx * k, y: cy - wy * k }, true);
    };
    const zoomIn = () => zoomTo((k) => ZOOM_STOPS.find((stop) => stop > k * 1.01) ?? 2);
    const zoomOut = () => zoomTo((k) => [...ZOOM_STOPS].reverse().find((stop) => stop < k * 0.99) ?? 0.05);
    const zoomReset = () => zoomTo(() => 1);
    /** 手动“适应画布”后恢复自动适配，新图片载入时继续保持全部可见。 */
    const fitAll = () => {
        manuallyNavigated.current = false;
        flyTo(fitTarget());
    };
    const animateLayout = () => {
        if (reducedMotion) return;
        if (arrangeTimer.current !== null) window.clearTimeout(arrangeTimer.current);
        setArranging(true);
        arrangeTimer.current = window.setTimeout(() => {
            arrangeTimer.current = null;
            setArranging(false);
        }, ARRANGE_MOTION_MS);
    };
    const resultOffsets = () => new Map(history.present.filter((item) => item.type === "result").map((item) => [item.id, item]));
    const commitResultOffsets = (positions: Array<{ id: string; x: number; y: number }>) => {
        const moved = new Set(positions.map((item) => item.id));
        commit([...history.present.filter((item) => item.type !== "result" || !moved.has(item.id)), ...positions.map((item) => ({ ...item, type: "result" as const }))]);
    };
    /**
     * 读取选中图片当前的世界坐标框（含已有偏移），计算排布结果后换算回“相对默认套版的偏移量”，
     * 作为一步可撤销操作提交；节点以过渡动画移动到新位置。
     */
    const arrangeSelection = (action: CommerceArrangeAction) => {
        const world = content.current;
        if (!world) return;
        const origin = world.getBoundingClientRect();
        const scale = world.offsetWidth ? origin.width / world.offsetWidth : 1;
        const saved = resultOffsets();
        const boxes = Array.from(world.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]"))
            .filter((node) => selectedResults.has(node.dataset.ecommerceImageId || ""))
            .map((node) => {
                const rect = node.getBoundingClientRect();
                const id = node.dataset.ecommerceImageId!;
                return {
                    id,
                    x: Math.round((rect.left - origin.left) / scale),
                    y: Math.round((rect.top - origin.top) / scale),
                    width: Math.round(rect.width / scale),
                    height: Math.round(rect.height / scale),
                    offsetX: saved.get(id)?.x || 0,
                    offsetY: saved.get(id)?.y || 0,
                };
            });
        if (!boxes.length) return;
        const byId = new Map(boxes.map((box) => [box.id, box]));
        const positions =
            action === "reset"
                ? boxes.map(({ id }) => ({ id, x: 0, y: 0 }))
                : arrangeCommerceBoxes(boxes, action).map((point) => {
                      const box = byId.get(point.id)!;
                      return { id: point.id, x: Math.round(box.offsetX + point.x - box.x), y: Math.round(box.offsetY + point.y - box.y) };
                  });
        if (
            positions.every((point) => {
                const box = byId.get(point.id)!;
                return Math.abs(point.x - box.offsetX) < 0.5 && Math.abs(point.y - box.offsetY) < 0.5;
            })
        )
            return;
        animateLayout();
        commitResultOffsets(positions);
    };
    /** 方向键微移：优先移动选中的文字/上传图层，否则移动选中的生成图片。 */
    const nudgeSelection = (dx: number, dy: number) => {
        if (selectedId) {
            commit(history.present.map((item) => (item.id === selectedId ? { ...item, x: item.x + dx, y: item.y + dy } : item)));
            return true;
        }
        const mounted = new Set(Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]") || []).map((node) => node.dataset.ecommerceImageId || ""));
        const ids = Array.from(selectedResults).filter((id) => mounted.has(id));
        if (!ids.length) return false;
        const saved = resultOffsets();
        commitResultOffsets(ids.map((id) => ({ id, x: (saved.get(id)?.x || 0) + dx, y: (saved.get(id)?.y || 0) + dy })));
        return true;
    };
    const selectAllReady = () => {
        const ids = resultLayers.filter((item) => item.ready).map((item) => item.id);
        if (!ids.length) return;
        setSelectedId(null);
        onSelectResults?.(ids);
    };
    keyHandler.current = (event: KeyboardEvent) => {
        if (!root.current?.contains(document.activeElement) || (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]"))) return;
        const command = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (command && key === "z") {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
        } else if (command && key === "y") {
            event.preventDefault();
            redo();
        } else if (command && key === "a") {
            event.preventDefault();
            selectAllReady();
        } else if (command && !event.altKey && (key === "=" || key === "+")) {
            event.preventDefault();
            zoomIn();
        } else if (command && !event.altKey && key === "-") {
            event.preventDefault();
            zoomOut();
        } else if (command && !event.altKey && key === "0") {
            event.preventDefault();
            zoomReset();
        } else if (event.shiftKey && !command && !event.altKey && event.code === "Digit1") {
            event.preventDefault();
            fitAll();
        } else if (!command && !event.altKey && ["v", "h", "t"].includes(key)) {
            event.preventDefault();
            setTool(({ v: "select", h: "hand", t: "text" } as const)[key as "v" | "h" | "t"]);
        }
        // 框选进行中的 Esc 只取消框选，由框选自身处理。
        else if (event.key === "Escape" && !selectionCleanup.current && (selectedResults.size || selectedId)) {
            setSelectedId(null);
            onSelectResults?.([]);
        } else if (event.key.startsWith("Arrow") && !command && !event.altKey && !(event.target instanceof Element && event.target.closest("[role=slider],[role=listbox],[role=menu],[role=combobox],[role=tablist]"))) {
            const step = event.shiftKey ? 10 : 1;
            const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
            const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
            if ((dx || dy) && nudgeSelection(dx, dy)) event.preventDefault();
        } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
            event.preventDefault();
            commit(history.present.filter((item) => item.id !== selectedId));
            setSelectedId(null);
        }
    };
    /** 图层单击：只选中这一张，放大并定位到画布中的位置，到达后轻微高亮。 */
    const focusResult = (id: string) => {
        const target = Array.from(content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]") || []).find((item) => item.dataset.ecommerceImageId === id);
        const frame = container.current?.getBoundingClientRect();
        if (!target || !frame) return;
        onSelectResults?.([id]);
        onInspectResult?.(id);
        manuallyNavigated.current = true;
        const current = viewportRef.current;
        const rect = target.getBoundingClientRect();
        const world = { x: (rect.left - frame.left - current.x) / current.k, y: (rect.top - frame.top - current.y) / current.k, width: rect.width / current.k, height: rect.height / current.k };
        const occupied = overlayPanelInset(root.current);
        const usableLeft = occupied ? occupied + 18 : 12;
        const usableRight = frame.width - (layersOpen && frame.width > 1100 ? 300 : 12);
        const usableTop = 72,
            usableBottom = frame.height - 96;
        const k = Math.max(0.1, Math.min(1.6, ((usableRight - usableLeft) * 0.82) / world.width, ((usableBottom - usableTop) * 0.86) / world.height));
        const centerX = (usableLeft + usableRight) / 2,
            centerY = (usableTop + usableBottom) / 2;
        flyTo({ k, x: centerX - (world.x + world.width / 2) * k, y: centerY - (world.y + world.height / 2) * k });
        target.classList.remove("is-located");
        window.setTimeout(
            () => {
                target.classList.add("is-located");
                window.setTimeout(() => target.classList.remove("is-located"), 1300);
            },
            reducedMotion ? 0 : 520,
        );
    };
    const toolButton = (label: string, hint: string, shortcut: string, icon: ReactNode, action: () => void, active = false, disabled = false) => (
        <Tooltip
            key={label}
            title={
                <span className="commerce-tool-hint">
                    <span>{hint}</span>
                    {shortcut ? <kbd>{shortcut}</kbd> : null}
                </span>
            }
            placement="top"
            mouseEnterDelay={0.12}
        >
            <button type="button" aria-label={label} aria-pressed={["选择", "抓手", "输入文字"].includes(label) ? active : undefined} className={active ? "is-active" : ""} disabled={disabled} onClick={action}>
                {active ? <motion.span className="commerce-canvas-tool-active" layoutId={reducedMotion ? undefined : "commerce-canvas-tool"} transition={{ type: "spring", stiffness: 440, damping: 34 }} aria-hidden="true" /> : null}
                {icon}
            </button>
        </Tooltip>
    );
    return (
        <section ref={root} tabIndex={-1} className="commerce-result-canvas" data-layers-open={layersOpen} data-canvas-tool={tool} data-arranging={arranging || undefined} aria-label="商品图片画布">
            <CanvasViewport containerRef={container} viewport={viewport} onViewportChange={userNavigate} boxSelectEnabled={tool !== "hand"} panOverNodes={tool === "hand"} onCanvasMouseDown={addText}>
                <div
                    ref={content}
                    className="commerce-canvas-results"
                    {...resultDrag}
                    onLoadCapture={(event) => {
                        if (!(event.target instanceof HTMLImageElement) || !event.target.closest(".commerce-result-image-shell")) return;
                        if (imageFitFrame.current !== null) cancelAnimationFrame(imageFitFrame.current);
                        imageFitFrame.current = requestAnimationFrame(() => {
                            imageFitFrame.current = null;
                            if (!manuallyNavigated.current) fit();
                        });
                    }}
                    style={{ width: layout.width, "--commerce-columns": layout.columns, position: "relative" } as CSSProperties}
                >
                    {children}
                    {history.present
                        .filter((layer) => layer.type !== "result")
                        .map((layer) => (
                            <div
                                key={layer.id}
                                data-node-id={layer.id}
                                className={`commerce-canvas-layer${selectedId === layer.id ? " is-selected" : ""}`}
                                style={{ left: layer.x, top: layer.y }}
                                onPointerDown={(event) => startDrag(event, layer)}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onLostPointerCapture={endDrag}
                                onDoubleClick={(event) => {
                                    event.stopPropagation();
                                    if (layer.type === "text") {
                                        setEditingId(layer.id);
                                        setEditingText(layer.text || "电商 Agent");
                                    }
                                }}
                            >
                                {layer.type === "image" ? (
                                    <img src={resolveResourceVariantUrl(resourceStorageKey(layer.resourceId!), "thumbnail")} alt="画布上传图片" draggable={false} />
                                ) : editingId === layer.id ? (
                                    <textarea
                                        autoFocus
                                        aria-label="编辑画布文字"
                                        value={editingText}
                                        onChange={(event) => setEditingText(event.target.value)}
                                        onBlur={finishEdit}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" && !event.shiftKey) {
                                                event.preventDefault();
                                                finishEdit();
                                            }
                                        }}
                                    />
                                ) : (
                                    <span>{layer.text}</span>
                                )}
                                {selectedId === layer.id && editingId !== layer.id ? (
                                    <div className="commerce-canvas-layer-actions" data-canvas-no-zoom>
                                        {layer.type === "text" ? (
                                            <button
                                                type="button"
                                                aria-label="编辑选中文字"
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={() => {
                                                    setEditingId(layer.id);
                                                    setEditingText(layer.text || "电商 Agent");
                                                }}
                                            >
                                                <Pencil size={13} />
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            aria-label="删除选中元素"
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={() => {
                                                commit(history.present.filter((item) => item.id !== layer.id));
                                                setSelectedId(null);
                                            }}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    {/* 拖动时的对齐参考线，由拖动逻辑直接绘制，不经过 React 渲染。 */}
                    <div ref={guideLayer} className="commerce-snap-guides" aria-hidden="true" />
                </div>
            </CanvasViewport>
            {selectionBox ? <div className="commerce-canvas-selection-box" aria-hidden="true" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} /> : null}
            {groupBounds ? (
                <div className="commerce-canvas-group-outline" aria-hidden="true" style={{ left: groupBounds.x, top: groupBounds.y, width: groupBounds.width, height: groupBounds.height }}>
                    <span className="top-left" />
                    <span className="top-center" />
                    <span className="top-right" />
                    <span className="middle-left" />
                    <span className="middle-right" />
                    <span className="bottom-left" />
                    <span className="bottom-center" />
                    <span className="bottom-right" />
                </div>
            ) : null}
            {groupBounds && selectedResults.size > 1 ? (
                <CommerceArrangeMenu
                    bounds={groupBounds}
                    frame={{ width: groupBounds.frameWidth, height: groupBounds.frameHeight }}
                    leftInset={groupBounds.inset}
                    rightInset={layersOpen ? 266 : 0}
                    count={selectedResults.size}
                    onArrange={arrangeSelection}
                    onDownload={onExportSelection}
                    onClear={() => onSelectResults?.([])}
                />
            ) : null}

            {emptyState ? (
                <div className="commerce-canvas-empty-overlay" aria-live="polite">
                    {emptyState}
                </div>
            ) : null}
            <div className="commerce-canvas-actions" data-canvas-no-zoom>
                {actions}
            </div>
            <aside className="commerce-canvas-layers" aria-label="画布图层" aria-hidden={!layersOpen} inert={!layersOpen} data-canvas-no-zoom data-canvas-wheel-scroll>
                <header>
                    <strong>
                        <LayersIcon size={16} />
                        图层
                        {resultLayers.length ? (
                            <span className="commerce-count-badge is-neutral" aria-label={`共 ${resultLayers.length} 张`}>
                                {resultLayers.length}
                            </span>
                        ) : null}
                    </strong>
                    <button type="button" onClick={onSelectAll} disabled={!resultLayers.some((item) => item.ready)}>
                        全选
                    </button>
                </header>
                <div className="commerce-canvas-layer-list">
                    {resultLayers.length ? (
                        resultLayers.map((item) => (
                            <button type="button" key={item.id} className={selectedResults.has(item.id) ? "is-selected" : ""} onClick={() => focusResult(item.id)}>
                                <span className="commerce-canvas-layer-check" aria-hidden="true">
                                    {selectedResults.has(item.id) ? <Check size={11} strokeWidth={3} /> : null}
                                </span>
                                {item.src ? <img src={item.src} alt="" /> : <span className="commerce-canvas-layer-thumb" />}
                                <span className="commerce-canvas-layer-name">{item.label}</span>
                                <Eye size={15} />
                            </button>
                        ))
                    ) : (
                        <p>生成后的图片会显示在这里</p>
                    )}
                    {history.present
                        .filter((item) => item.type !== "result")
                        .map((item) => (
                            <button type="button" key={item.id} onClick={() => setSelectedId(item.id)}>
                                {item.type === "image" ? <ImagePlusIcon size={17} /> : <TextToolIcon size={17} />}
                                <span className="commerce-canvas-layer-name">{item.type === "text" ? item.text : "上传图片"}</span>
                            </button>
                        ))}
                </div>
            </aside>
            <div ref={layerToggleRef} className="commerce-canvas-layer-toggle" data-canvas-no-zoom>
                <button type="button" aria-expanded={layersOpen} onClick={() => setLayersOpen((open) => !open)}>
                    <LayersIcon size={16} />
                    图层
                </button>
                <Tooltip
                    title={
                        <span className="commerce-tool-hint">
                            <span>全选已完成的图片</span>
                            <kbd>Ctrl A</kbd>
                        </span>
                    }
                    placement="top"
                    mouseEnterDelay={0.12}
                >
                    <button type="button" onClick={onSelectAll} disabled={!resultLayers.some((item) => item.ready)}>
                        全选
                    </button>
                </Tooltip>
            </div>
            <input
                ref={uploadInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="commerce-canvas-file-input"
                aria-label="上传图片到画布"
                onChange={(event) => {
                    void uploadImage(event.target.files);
                    event.target.value = "";
                }}
            />
            <div ref={toolbarRef} className="commerce-canvas-toolbar" role="toolbar" aria-label="画布操作" data-canvas-no-zoom>
                {toolButton("选择", "选择与移动，拖动时自动吸附对齐（按住 Ctrl 关闭）", "V", <PointerIcon size={19} />, () => setTool("select"), tool === "select")}
                {toolButton("抓手", "拖动画布", "H", <HandIcon size={19} />, () => setTool("hand"), tool === "hand")}
                {toolButton("上传图片", "添加图片", "", <ImagePlusIcon size={19} />, () => uploadInput.current?.click(), false, uploading)}
                {toolButton("输入文字", "点击画布添加文字", "T", <TextToolIcon size={19} />, () => setTool("text"), tool === "text")}
                <i className="commerce-canvas-tool-divider" aria-hidden="true" />
                {toolButton("撤回画布操作", "撤回", "Ctrl Z", <UndoIcon size={19} />, undo, false, !history.past.length)}
                {toolButton("前进画布操作", "重做", "Ctrl Shift Z", <RedoIcon size={19} />, redo, false, !history.future.length)}
            </div>
            {uploadError ? (
                <div className="commerce-canvas-upload-error" role="alert">
                    {uploadError}
                </div>
            ) : null}
        </section>
    );
}
