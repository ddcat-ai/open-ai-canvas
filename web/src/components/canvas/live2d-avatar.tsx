import { useEffect, useRef, useState, type ReactNode } from "react";
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
            reject(new Error("Live2D 运行库加载失败，请确认部署产物包含 Cubism Core 且静态资源可访问后重试"));
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

export function Live2DAvatar({
    url,
    width,
    height,
    reducedMotion = false,
    fallback,
    onReady,
    onError,
}: {
    url: string;
    width: number;
    height: number;
    reducedMotion?: boolean;
    fallback?: ReactNode;
    onReady?: () => void;
    onError?: (message: string) => void;
}) {
    const host = useRef<HTMLSpanElement>(null);
    const callbacks = useRef({ onReady, onError });
    callbacks.current = { onReady, onError };
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);
    useEffect(() => {
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
                } catch {
                    failRendering("Live2D 渲染失败，已回退默认形象");
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
                failRendering("Live2D 渲染上下文丢失，已回退默认形象");
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
                callbacks.current.onError?.("Live2D 加载超时，请检查模型和网络后重试");
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
            if (!(loaded.internalModel instanceof Cubism4InternalModel)) throw new Error("不支持的 Live2D 模型运行时");
            adaptLive2DRenderOrders(loaded.internalModel.coreModel);
            if (!(loaded.width > 0 && loaded.height > 0)) throw new Error("Live2D 模型尺寸无效");
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
                callbacks.current.onError?.(error instanceof Error ? error.message : "Live2D 加载失败");
            }
        });
        return () => {
            disposed = true;
            clearTimeout(deadline);
            cancelLoading?.();
            cleanup?.();
        };
    }, [url, width, height, reducedMotion]);
    return (
        <span style={{ display: "grid", placeItems: "center", width, height, pointerEvents: "none" }}>
            <span ref={host} style={{ gridArea: "1 / 1", visibility: failed || !ready ? "hidden" : "visible", width, height }} />
            {failed || !ready ? <span style={{ gridArea: "1 / 1" }}>{fallback}</span> : null}
        </span>
    );
}
