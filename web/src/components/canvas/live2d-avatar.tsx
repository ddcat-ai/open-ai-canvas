import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";
import { installLive2DLoader } from "@/services/live2d-loader";
import { adaptLive2DRenderOrders } from "@/lib/canvas/live2d-core-adapter";

let corePromise: Promise<void> | undefined;

function loadCore() {
    if ("Live2DCubismCore" in window) return Promise.resolve();
    if (corePromise) return corePromise;
    corePromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        // Bundled same-origin runtime only. Uploaded models may never provide executable code.
        script.src = `${import.meta.env.BASE_URL}live2d/live2dcubismcore.min.js`;
        const timer = window.setTimeout(() => fail(), 15000);
        const fail = () => {
            clearTimeout(timer);
            script.remove();
            reject(new Error(translate("canvasC.live2d.coreLoadFailed")));
        };
        script.onload = () => {
            if (!("Live2DCubismCore" in window)) {
                fail();
                return;
            }
            clearTimeout(timer);
            resolve();
        };
        script.onerror = fail;
        document.head.append(script);
    }).catch((error) => {
        corePromise = undefined;
        throw error;
    });
    return corePromise;
}

// pixi-live2d-display 的 Cubism 着色器是进程级单例，只绑定最近初始化的 WebGL 上下文，
// 任一模型销毁时还会删除这个单例。两个实例同时渲染时，先挂载的那个会把绘制状态写进
// 后挂载的画布（例如后台预览框把悬浮形象"吸"进去）。因此同一时刻只让一个实例渲染：
// renderPriority 高的优先，同级时最后挂载的优先；其余实例释放上下文并显示回退形象，
// 等占用者卸载后再重新初始化。
type Live2DSlot = { priority: number; suspend: () => void; resume: () => void };
const live2DSlots: Live2DSlot[] = [];

function live2DOwner() {
    let owner: Live2DSlot | undefined;
    for (const slot of live2DSlots) if (!owner || slot.priority >= owner.priority) owner = slot;
    return owner;
}

function claimLive2DSlot(slot: Live2DSlot) {
    const previous = live2DOwner();
    live2DSlots.push(slot);
    const owner = live2DOwner();
    // 先同步释放上一个占用者，保证它的单例清理发生在新实例初始化之前。
    if (previous && previous !== owner) previous.suspend();
    if (owner === slot) slot.resume();
    else slot.suspend();
    return () => {
        const index = live2DSlots.indexOf(slot);
        if (index < 0) return;
        const wasOwner = live2DOwner() === slot;
        live2DSlots.splice(index, 1);
        if (wasOwner) live2DOwner()?.resume();
    };
}

export function Live2DAvatar({
    url,
    width,
    height,
    reducedMotion = false,
    fallback,
    renderPriority = 0,
    onReady,
    onError,
}: {
    url: string;
    width: number;
    height: number;
    reducedMotion?: boolean;
    fallback?: ReactNode;
    /** 同页多个 Live2D 时谁先渲染；后台预览高于悬浮入口。 */
    renderPriority?: number;
    onReady?: () => void;
    onError?: (message: string) => void;
}) {
    const { t } = useTranslation();
    const host = useRef<HTMLSpanElement>(null);
    const callbacks = useRef({ onReady, onError });
    callbacks.current = { onReady, onError };
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);
    const [suspended, setSuspended] = useState(false);
    const ownsSlot = useRef(false);
    const teardown = useRef<(() => void) | undefined>(undefined);
    // 必须声明在渲染 effect 之前：同一次提交里先确定渲染权，再决定是否初始化模型。
    useEffect(() => {
        const release = claimLive2DSlot({
            priority: renderPriority,
            suspend: () => {
                ownsSlot.current = false;
                teardown.current?.();
                teardown.current = undefined;
                setSuspended(true);
            },
            resume: () => {
                ownsSlot.current = true;
                setSuspended(false);
            },
        });
        return () => {
            ownsSlot.current = false;
            release();
        };
        // 优先级只在挂载时登记。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (suspended || !ownsSlot.current) return;
        let disposed = false;
        let cleanup: (() => void) | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        let cancelLoading: (() => void) | undefined;
        setFailed(false);
        setReady(false);
        const init = async () => {
            await loadCore();
            const [PIXI, { Live2DModel, Live2DFactory, Live2DLoader, MotionPreloadStrategy, Cubism4InternalModel }] = await Promise.all([import("pixi.js"), import("pixi-live2d-display/cubism4")]);
            if (disposed) return;
            installLive2DLoader(Live2DLoader);
            const app = new PIXI.Application({ width, height, backgroundAlpha: 0, resolution: Math.min(window.devicePixelRatio || 1, 1.5), autoDensity: true, autoStart: false, antialias: true });
            const canvas = app.view as HTMLCanvasElement;
            canvas.style.width = "100%";
            canvas.style.height = "100%";
            canvas.setAttribute("aria-hidden", "true");
            host.current?.append(canvas);
            let model: InstanceType<typeof Live2DModel> | undefined;
            let visible = true;
            let lost = false;
            let destroyed = false;
            let elapsed = performance.now();
            const failRendering = (message: string) => {
                lost = true;
                clearTimeout(deadline);
                cancelLoading?.();
                cleanup?.();
                setFailed(true);
                callbacks.current.onError?.(message);
            };
            const draw = () => {
                if (document.hidden || disposed || lost || !visible || !model) return;
                try {
                    const now = performance.now();
                    model.update(Math.min(now - elapsed, 100));
                    elapsed = now;
                    app.render();
                } catch (error) {
                    failRendering(error instanceof Error && error.message ? translate("canvasC.live2d.renderFailedWithDetail", { detail: error.message }) : translate("canvasC.live2d.renderFailed"));
                }
            };
            const sync = () => {
                clearInterval(timer);
                if (!document.hidden && visible && !lost && !reducedMotion && model) {
                    elapsed = performance.now();
                    timer = setInterval(draw, 1000 / 30);
                }
            };
            const observer = new IntersectionObserver(([entry]) => {
                visible = entry.isIntersecting;
                sync();
            });
            observer.observe(canvas);
            const contextLost = (event: Event) => {
                event.preventDefault();
                failRendering(translate("canvasC.live2d.contextLost"));
            };
            canvas.addEventListener("webglcontextlost", contextLost);
            document.addEventListener("visibilitychange", sync);
            cleanup = () => {
                if (destroyed) return;
                destroyed = true;
                clearInterval(timer);
                observer.disconnect();
                document.removeEventListener("visibilitychange", sync);
                canvas.removeEventListener("webglcontextlost", contextLost);
                app.destroy(true, { children: true, texture: true, baseTexture: true });
            };
            const loaded = new Live2DModel({ autoUpdate: false, autoInteract: false });
            const releaseLoaded = () => {
                // Cubism's destroy() assumes internalModel exists, even after failed setup.
                if (loaded.internalModel) loaded.destroy({ children: true, texture: true, baseTexture: true });
                else {
                    loaded.emit("destroy");
                    loaded.textures.forEach((texture) => texture.destroy(true));
                }
            };
            cancelLoading = () => loaded.emit("destroy");
            deadline = setTimeout(() => {
                disposed = true;
                cancelLoading?.();
                cleanup?.();
                setFailed(true);
                callbacks.current.onError?.(translate("canvasC.live2d.loadTimeout"));
            }, 30000);
            try {
                await Live2DFactory.setupLive2DModel(loaded, url, { autoUpdate: false, autoInteract: false, crossOrigin: "use-credentials", motionPreload: MotionPreloadStrategy.IDLE });
            } catch (error) {
                releaseLoaded();
                throw error;
            } finally {
                clearTimeout(deadline);
                cancelLoading = undefined;
            }
            if (disposed || lost) {
                releaseLoaded();
                cleanup?.();
                return;
            }
            model = loaded;
            app.stage.addChild(loaded);
            if (!(loaded.internalModel instanceof Cubism4InternalModel)) throw new Error(translate("canvasC.live2d.unsupportedRuntime"));
            adaptLive2DRenderOrders(loaded.internalModel.coreModel);
            if (!(loaded.width > 0 && loaded.height > 0)) throw new Error(translate("canvasC.live2d.invalidSize"));
            const scale = Math.min(width / loaded.width, height / loaded.height);
            loaded.scale.set(scale);
            loaded.anchor.set(0.5, 1);
            loaded.position.set(width / 2, height);
            loaded.update(0);
            app.render();
            sync();
            setReady(true);
            callbacks.current.onReady?.();
        };
        void init().catch((error) => {
            cleanup?.();
            cleanup = undefined;
            if (!disposed) {
                setFailed(true);
                callbacks.current.onError?.(error instanceof Error ? error.message : translate("canvasC.live2d.loadFailed"));
            }
        });
        const stop = () => {
            if (disposed && !cancelLoading && !cleanup) return;
            disposed = true;
            clearTimeout(deadline);
            cancelLoading?.();
            cancelLoading = undefined;
            cleanup?.();
            cleanup = undefined;
        };
        teardown.current = stop;
        return () => {
            stop();
            if (teardown.current === stop) teardown.current = undefined;
        };
    }, [url, width, height, reducedMotion, suspended]);
    const showModel = !suspended && !failed && ready;
    return (
        <span aria-busy={!suspended && !failed && !ready} style={{ display: "grid", placeItems: "center", width, height, pointerEvents: "none" }}>
            <span ref={host} style={{ gridArea: "1 / 1", visibility: showModel ? "visible" : "hidden", width, height }} />
            {suspended || failed ? (
                <span style={{ gridArea: "1 / 1" }}>{fallback}</span>
            ) : !ready ? (
                <span role="status" style={{ gridArea: "1 / 1" }}>
                    <LoaderCircle className={reducedMotion ? "size-6" : "size-6 motion-safe:animate-spin"} aria-hidden="true" />
                    <span className="sr-only">{t("canvasC.live2d.loading")}</span>
                </span>
            ) : null}
        </span>
    );
}
