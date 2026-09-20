import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Camera, Globe, Grid3x3, Loader2, Maximize2, RotateCcw, X } from "lucide-react";

import { useCanvasNodeActions } from "@/components/canvas/canvas-node-action-context";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

type PanoramaNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    reduceMediaEffects?: boolean;
};

/** 节点外壳调用查看器能力的最小控制面；实现由 PanoramaViewport 注入。 */
type PanoramaViewportController = {
    /** 渲染当前帧并返回 WebGL 画布（preserveDrawingBuffer 已开启，可直接 toDataURL/drawImage）。 */
    captureCanvas: () => HTMLCanvasElement | null;
    /** 以方形画幅渲染一帧，返回画布与恢复函数；四宫格导出用，画完必须调用 release 还原节点尺寸。 */
    captureSquare: (size: number) => { canvas: HTMLCanvasElement; release: () => void } | null;
    getView: () => { lon: number; lat: number };
    setView: (lonDeg: number, latDeg: number) => void;
};

type PanoramaView = { lon: number; lat: number };

const PANORAMA_KEY_STEP = 4;
const PANORAMA_FOV_MIN = 25;
const PANORAMA_FOV_MAX = 110;
const PANORAMA_QUAD_SIZE = 1024;

function clampFov(value: number) {
    return Math.max(PANORAMA_FOV_MIN, Math.min(PANORAMA_FOV_MAX, value));
}

/**
 * 360° 全景查看器节点：取上游图片，拖拽环视。
 *
 * 刻意的取舍：
 * 1. **点击才激活 WebGL**。浏览器对同时存在的 WebGL 上下文有硬上限（十几个），
 *    画布上可以有任意多个全景节点，自动激活必然在某个数量后整片黑。默认只显示平面预览，
 *    与既有的 DeferredMediaLoad「点击加载」是同一套交互习惯。
 * 2. **用原生 three 而不是 @react-three/fiber**。这里需要精确控制 dispose——
 *    上下文/纹理/几何体漏一个就逼近上限，节点还会被频繁增删。
 * 3. **性能模式下不提供激活入口**。错题本里多条崩溃出在画布高频渲染，
 *    reduceMediaEffects 时只给静态预览。
 * 4. **截图/四宫格导出走 preserveDrawingBuffer + 同步重渲染**。captureSquare
 *    临时把 renderer 切到方形画幅再恢复，不依赖 rAF 时序；全屏展开时同一时刻
 *    只挂一个 viewer 实例（节点体退回静态预览），上下文数量不翻倍。
 * 5. **节点内不消费滚轮**，滚轮留给画布缩放；全屏覆盖层内画布缩放不存在，
 *    才用滚轮调视场角。
 */
export function PanoramaNodeContent({ node, theme, reduceMediaEffects }: PanoramaNodeContentProps) {
    const upstream = useUpstreamNodes(node.id);
    const actions = useCanvasNodeActions();
    const inherited = upstream.find((item) => getNodeResourceKind(item) === "image");
    const url = node.metadata?.content || inherited?.metadata?.content || node.metadata?.panoramaConfig?.directImageUrl || "";
    const projection = node.metadata?.panoramaConfig?.projection || "spherical";
    const projectionLabel = projection === "spherical" ? "720° 球体" : "360° 环绕";
    const [active, setActive] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [failed, setFailed] = useState(false);
    const controllerRef = useRef<PanoramaViewportController | null>(null);
    const lastViewRef = useRef<PanoramaView | null>(null);

    // 上游换图后退出环视，避免旧上下文继续持有已被替换的纹理。
    useEffect(() => {
        setActive(false);
        setExpanded(false);
        setFailed(false);
    }, [url]);

    const rememberView = () => {
        const controller = controllerRef.current;
        if (controller) lastViewRef.current = controller.getView();
    };

    const handleScreenshot = async () => {
        const controller = controllerRef.current;
        const exportNode = actions.addPanoramaCaptureNode;
        if (!controller || !exportNode) return;
        const canvas = controller.captureCanvas();
        if (!canvas) return;
        await exportNode(node, canvas.toDataURL("image/png"), `${node.title || "全景"} · 当前视角`);
    };

    const handleQuadExport = async () => {
        const controller = controllerRef.current;
        const exportNode = actions.addPanoramaCaptureNode;
        if (!controller || !exportNode) return;
        const restore = controller.getView();
        const off = document.createElement("canvas");
        off.width = PANORAMA_QUAD_SIZE * 2;
        off.height = PANORAMA_QUAD_SIZE * 2;
        const ctx = off.getContext("2d");
        if (!ctx) return;
        const yaws = [0, 90, 180, 270];
        for (let index = 0; index < yaws.length; index += 1) {
            controller.setView(yaws[index], 0);
            const capture = controller.captureSquare(PANORAMA_QUAD_SIZE);
            if (!capture) {
                controller.setView(restore.lon, restore.lat);
                return;
            }
            ctx.drawImage(capture.canvas, (index % 2) * PANORAMA_QUAD_SIZE, Math.floor(index / 2) * PANORAMA_QUAD_SIZE, PANORAMA_QUAD_SIZE, PANORAMA_QUAD_SIZE);
            capture.release();
        }
        const labels = ["前 (0°)", "右 (90°)", "后 (180°)", "左 (270°)"];
        ctx.font = "bold 36px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.lineWidth = 4;
        labels.forEach((label, index) => {
            const x = (index % 2) * PANORAMA_QUAD_SIZE + 24;
            const y = Math.floor(index / 2) * PANORAMA_QUAD_SIZE + 56;
            ctx.strokeText(label, x, y);
            ctx.fillText(label, x, y);
        });
        controller.setView(restore.lon, restore.lat);
        await exportNode(node, off.toDataURL("image/png"), `${node.title || "全景"} · 四向视图`);
    };

    const handleViewportError = () => {
        setFailed(true);
        setActive(false);
        setExpanded(false);
    };

    if (!url) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.muted }}>
                <Globe className="size-5 opacity-60" />
                <span style={{ fontSize: "var(--fs-label)" }}>连接一张 360° 等距柱状全景图</span>
            </div>
        );
    }

    const previewContent = (
        <div className="relative h-full w-full overflow-hidden" style={{ background: theme.node.fill }}>
            <img src={url} alt={node.title || "全景"} className="h-full w-full object-cover opacity-80" draggable={false} />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2" style={{ background: "linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,.35))", boxShadow: "0 -1px 0 rgba(0,0,0,.25)" }}>
                <span className="min-w-0 truncate text-white" style={{ fontSize: "var(--fs-label)", textShadow: "0 1px 3px rgba(0,0,0,.85)" }}>
                    {failed ? "全景加载失败（图片可能不允许跨域读取）" : expanded ? "已展开全屏环视" : reduceMediaEffects ? "性能模式下仅显示预览" : `${projectionLabel} · 360° 全景`}
                </span>
                {reduceMediaEffects || expanded ? null : (
                    <button
                        type="button"
                        className="shrink-0 rounded-[var(--r-md)] px-2 py-1 font-medium text-white outline-none transition-colors"
                        style={{ fontSize: "var(--fs-label)", background: "rgba(0,0,0,.78)", boxShadow: "0 1px 4px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.32)" }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => { setFailed(false); setActive(true); }}
                    >
                        进入环视
                    </button>
                )}
            </div>
        </div>
    );

    if (expanded) {
        // 展开时同一时刻只挂一个 viewer：节点体退回静态预览，viewer 移到全屏 portal。
        return (
            <>
                {previewContent}
                {createPortal(
                    <div
                        className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/[0.88] p-5 backdrop-blur-sm"
                        // portal 挂在 body，React 合成事件仍沿 React 树冒泡回画布容器；不标记
                        // data-canvas-no-zoom 会被 handlePointerDown 判为画布空白并 setPointerCapture，
                        // click 被重定向到 body，覆盖层内所有按钮（含关闭）都收不到点击。
                        data-canvas-no-zoom
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => { rememberView(); setExpanded(false); }}
                    >
                        <div className="flex h-[min(88vh,920px)] w-[min(94vw,1440px)] flex-col overflow-hidden rounded-[var(--r-2xl)] border border-white/15 bg-black shadow-2xl" onClick={(event) => event.stopPropagation()}>
                            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-white">{node.title || "全景环视"}</div>
                                    <div className="mt-0.5 text-white/45" style={{ fontSize: "var(--fs-tiny)" }}>{projectionLabel} · 拖拽环视 · 方向键旋转 · 滚轮缩放</div>
                                </div>
                                <button
                                    type="button"
                                    aria-label="退出全屏"
                                    className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => { rememberView(); setExpanded(false); }}
                                >
                                    <X className="size-4" />
                                </button>
                            </div>
                            <div className="relative min-h-0 flex-1">
                                <PanoramaViewport url={url} controllerRef={controllerRef} initialView={lastViewRef.current} allowWheelZoom autoFocus onError={handleViewportError} />
                                <PanoramaViewerToolbar
                                    canCapture={Boolean(actions.addPanoramaCaptureNode)}
                                    onScreenshot={handleScreenshot}
                                    onQuadExport={handleQuadExport}
                                    onResetView={() => controllerRef.current?.setView(0, 0)}
                                    onClose={() => { rememberView(); setExpanded(false); }}
                                    closeLabel="退出全屏"
                                />
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
            </>
        );
    }

    if (!active) {
        return previewContent;
    }

    return (
        <div className="relative h-full w-full overflow-hidden" style={{ background: "#000" }}>
            <PanoramaViewport url={url} controllerRef={controllerRef} initialView={lastViewRef.current} onError={handleViewportError} />
            <PanoramaViewerToolbar
                canCapture={Boolean(actions.addPanoramaCaptureNode)}
                onScreenshot={handleScreenshot}
                onQuadExport={handleQuadExport}
                onResetView={() => controllerRef.current?.setView(0, 0)}
                onExpand={() => { rememberView(); setExpanded(true); }}
                onClose={() => setActive(false)}
                closeLabel="退出环视"
            />
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/55 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-sm">
                {projectionLabel} · 拖拽环视 · 方向键旋转
            </div>
        </div>
    );
}

function PanoramaViewerToolbar({ canCapture, onScreenshot, onQuadExport, onResetView, onExpand, onClose, closeLabel }: {
    canCapture: boolean;
    onScreenshot: () => void | Promise<void>;
    onQuadExport: () => void | Promise<void>;
    onResetView: () => void;
    onExpand?: () => void;
    onClose: () => void;
    closeLabel: string;
}) {
    return (
        <div className="absolute right-2.5 top-2.5 flex gap-1.5" onMouseDown={(event) => event.stopPropagation()}>
            {onExpand ? (
                <ViewerToolbarButton title="全屏环视" onClick={onExpand}><Maximize2 className="size-4" /></ViewerToolbarButton>
            ) : null}
            {canCapture ? (
                <>
                    <ViewerToolbarButton title="截图当前视角" onClick={() => void onScreenshot()}><Camera className="size-4" /></ViewerToolbarButton>
                    <ViewerToolbarButton title="导出四向视图" onClick={() => void onQuadExport()}><Grid3x3 className="size-4" /></ViewerToolbarButton>
                </>
            ) : null}
            <ViewerToolbarButton title="重置视角" onClick={onResetView}><RotateCcw className="size-4" /></ViewerToolbarButton>
            <ViewerToolbarButton title={closeLabel} danger onClick={onClose}><X className="size-4" /></ViewerToolbarButton>
        </div>
    );
}

function ViewerToolbarButton({ title, danger, onClick, children }: { title: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            aria-label={title}
            title={title}
            className={`grid size-8 place-items-center rounded-[var(--r-md)] text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/40 ${danger ? "bg-black/70 hover:bg-red-500/90" : "bg-black/70 hover:bg-black/90"}`}
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.22)" }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onClick(); }}
        >
            {children}
        </button>
    );
}

function PanoramaViewport({ url, controllerRef, initialView, allowWheelZoom, autoFocus, onError }: {
    url: string;
    controllerRef: { current: PanoramaViewportController | null };
    initialView?: PanoramaView | null;
    allowWheelZoom?: boolean;
    autoFocus?: boolean;
    onError: () => void;
}) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    // onError 是内联箭头函数，每次渲染都是新引用；直接放进 effect 依赖会让
    // 父级任何重渲染（悬停/选中/画布状态）都销毁重建 WebGL 上下文 ——
    // 表现就是环视画面闪动、视角回到初始位置。用 ref 稳定它。
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (autoFocus) hostRef.current?.focus({ preventScroll: true });
    }, [autoFocus]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let disposed = false;
        let frame = 0;
        // three 体积大，按需加载，不进主包。
        const teardown: Array<() => void> = [];
        let lon = initialView?.lon ?? 0;
        let lat = initialView?.lat ?? 0;
        let fov = 75;

        void (async () => {
            const THREE = await import("three");
            if (disposed) return;

            // 截图/四宫格导出要求渲染缓冲跨帧可读，必须开启 preserveDrawingBuffer。
            const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 1100);

            const loader = new THREE.TextureLoader();
            loader.setCrossOrigin("anonymous");
            const texture = await new Promise<InstanceType<typeof THREE.Texture> | null>((resolve) => {
                loader.load(url, resolve, undefined, () => resolve(null));
            });
            if (disposed) { renderer.dispose(); return; }
            if (!texture) { renderer.dispose(); onErrorRef.current(); return; }

            texture.colorSpace = THREE.SRGBColorSpace;
            const geometry = new THREE.SphereGeometry(500, 60, 40);
            const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
            scene.add(new THREE.Mesh(geometry, material));
            host.appendChild(renderer.domElement);
            renderer.domElement.style.cssText = "width:100%;height:100%;display:block;cursor:grab";

            let dragging = false;
            let lastX = 0;
            let lastY = 0;

            const onPointerDown = (event: PointerEvent) => {
                dragging = true;
                lastX = event.clientX;
                lastY = event.clientY;
                renderer.domElement.setPointerCapture(event.pointerId);
                event.stopPropagation();
            };
            const onPointerMove = (event: PointerEvent) => {
                if (!dragging) return;
                lon -= (event.clientX - lastX) * 0.18;
                lat += (event.clientY - lastY) * 0.18;
                lat = Math.max(-85, Math.min(85, lat));
                lastX = event.clientX;
                lastY = event.clientY;
            };
            const onPointerUp = (event: PointerEvent) => {
                dragging = false;
                if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
            };
            // 节点内滚轮留给画布缩放（见组件头注释 5）；仅全屏覆盖层消费滚轮调视场角。
            const onWheel = (event: WheelEvent) => {
                if (!allowWheelZoom) return;
                event.preventDefault();
                event.stopPropagation();
                fov = clampFov(fov + event.deltaY * 0.05);
                camera.fov = fov;
                camera.updateProjectionMatrix();
            };
            const onKeyDown = (event: KeyboardEvent) => {
                let lonStep = 0;
                let latStep = 0;
                if (event.key === "ArrowLeft") lonStep = -PANORAMA_KEY_STEP;
                else if (event.key === "ArrowRight") lonStep = PANORAMA_KEY_STEP;
                else if (event.key === "ArrowUp") latStep = PANORAMA_KEY_STEP;
                else if (event.key === "ArrowDown") latStep = -PANORAMA_KEY_STEP;
                else return;
                event.preventDefault();
                event.stopPropagation();
                lon += lonStep;
                lat = Math.max(-85, Math.min(85, lat + latStep));
                host.focus({ preventScroll: true });
            };
            renderer.domElement.addEventListener("pointerdown", onPointerDown);
            renderer.domElement.addEventListener("pointermove", onPointerMove);
            renderer.domElement.addEventListener("pointerup", onPointerUp);
            renderer.domElement.addEventListener("pointercancel", onPointerUp);
            if (allowWheelZoom) renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
            host.addEventListener("keydown", onKeyDown);

            const resize = () => {
                const { clientWidth, clientHeight } = host;
                if (!clientWidth || !clientHeight) return;
                renderer.setSize(clientWidth, clientHeight, false);
                camera.aspect = clientWidth / clientHeight;
                camera.updateProjectionMatrix();
            };
            const observer = new ResizeObserver(resize);
            observer.observe(host);
            resize();

            const applyView = () => {
                const phi = THREE.MathUtils.degToRad(90 - lat);
                const theta = THREE.MathUtils.degToRad(lon);
                camera.lookAt(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
            };
            const tick = () => {
                applyView();
                renderer.render(scene, camera);
                frame = requestAnimationFrame(tick);
            };
            tick();
            setLoading(false);

            const controller: PanoramaViewportController = {
                captureCanvas: () => {
                    applyView();
                    renderer.render(scene, camera);
                    return renderer.domElement;
                },
                captureSquare: (size) => {
                    const { clientWidth, clientHeight } = host;
                    if (!clientWidth || !clientHeight) return null;
                    renderer.setSize(size, size, false);
                    camera.aspect = 1;
                    camera.updateProjectionMatrix();
                    applyView();
                    renderer.render(scene, camera);
                    return {
                        canvas: renderer.domElement,
                        release: resize,
                    };
                },
                getView: () => ({ lon, lat }),
                setView: (lonDeg, latDeg) => {
                    lon = lonDeg;
                    lat = Math.max(-85, Math.min(85, latDeg));
                },
            };
            controllerRef.current = controller;

            teardown.push(() => {
                cancelAnimationFrame(frame);
                observer.disconnect();
                renderer.domElement.removeEventListener("pointerdown", onPointerDown);
                renderer.domElement.removeEventListener("pointermove", onPointerMove);
                renderer.domElement.removeEventListener("pointerup", onPointerUp);
                renderer.domElement.removeEventListener("pointercancel", onPointerUp);
                if (allowWheelZoom) renderer.domElement.removeEventListener("wheel", onWheel);
                host.removeEventListener("keydown", onKeyDown);
                renderer.domElement.remove();
                geometry.dispose();
                material.dispose();
                texture.dispose();
                if (controllerRef.current === controller) controllerRef.current = null;
                // forceContextLoss 才真正释放上下文；只 dispose 在部分浏览器上仍占着配额。
                renderer.forceContextLoss();
                renderer.dispose();
            });
        })();

        return () => {
            disposed = true;
            teardown.forEach((fn) => fn());
        };
    }, [allowWheelZoom, controllerRef, initialView, url]);

    return (
        <div ref={hostRef} className="relative h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-white/40" tabIndex={0} data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()}>
            {loading ? (
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/70 text-xs text-white/85">
                    <Loader2 className="size-4 animate-spin" /> 全景加载中...
                </div>
            ) : null}
        </div>
    );
}
