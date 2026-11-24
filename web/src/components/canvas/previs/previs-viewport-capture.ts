import { Color, HalfFloatType, MeshBasicMaterial, MeshDepthMaterial, MeshNormalMaterial, NoToneMapping, PerspectiveCamera, SRGBColorSpace, Vector4, WebGLRenderTarget, type Object3D } from "three";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { applyClaySceneMaterials } from "@/lib/canvas/previs/previs-clay-materials";
import { PREVIS_AUTO_ASPECT_FALLBACK, previsAspectValue, resolvePrevisOutputSize } from "@/lib/canvas/previs/previs-optics";
import { resolvePrevisActiveShot, resolvePrevisViewFraming } from "@/lib/canvas/previs/previs-view-modes";
import { PREVIS_WORLD_CAMERA_FAR } from "@/lib/canvas/previs/previs-world";
import type { PrevisRenderMode } from "@/types/previs";
import type { CaptureContext } from "./previs-viewport";

export type PrevisCaptureOptions = { longEdge?: number; depthNear?: number; depthFar?: number; signal?: AbortSignal };
export type PrevisCaptureSource = () => CaptureContext | null;

/** 近白远黑，固定米制范围。禁止逐帧自动归一化，否则深度视频会闪烁。 */
export function createPrevisDepthMaterial(near: number, far: number) {
    if (!Number.isFinite(near) || !Number.isFinite(far) || near < 0 || far <= near) throw new Error("深度范围必须满足 0 ≤ 近端 < 远端");
    const material = new MeshDepthMaterial();
    let captureNear = 0.05;
    let captureFar = 500;
    material.onBeforeCompile = (shader) => {
        shader.uniforms.depthNear = { value: near };
        shader.uniforms.depthFar = { value: far };
        shader.uniforms.captureNear = { value: captureNear };
        shader.uniforms.captureFar = { value: captureFar };
        material.userData.depthUniforms = shader.uniforms;
        shader.fragmentShader = `uniform float depthNear; uniform float depthFar; uniform float captureNear; uniform float captureFar;\n${shader.fragmentShader}`.replace(
            "1.0 - fragCoordZ",
            "1.0 - clamp((-perspectiveDepthToViewZ(fragCoordZ, captureNear, captureFar) - depthNear) / (depthFar - depthNear), 0.0, 1.0)",
        );
    };
    material.onBeforeRender = (_renderer, _scene, camera) => {
        const uniforms = material.userData.depthUniforms;
        if (camera instanceof PerspectiveCamera) {
            captureNear = camera.near;
            captureFar = camera.far;
            if (uniforms) {
                uniforms.captureNear.value = captureNear;
                uniforms.captureFar.value = captureFar;
            }
        }
    };
    return material;
}

/** 截图、录制、第二屏共用一个镜头渲染出口，不改变编辑视口尺寸或活动相机。 */
export function createPrevisShotSurface(source: PrevisCaptureSource, options: PrevisCaptureOptions = {}) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法创建捕捉画布");
    const camera = new PerspectiveCamera();
    const target = new WebGLRenderTarget(2, 2);
    // 颜色先保留 HDR 线性值，再做显示转换；数据 pass 始终写无色彩转换的独立字节目标。
    // 不能在已分配的同一纹理上切换 sRGB/线性格式，否则深度读回可能被硬件编码。
    const colorTarget = new WebGLRenderTarget(2, 2, { type: HalfFloatType });
    const output = new OutputPass();
    const depth = createPrevisDepthMaterial(options.depthNear ?? 0, options.depthFar ?? 30);
    const normal = new MeshNormalMaterial();
    const wire = new MeshBasicMaterial({ color: "#ffffff", wireframe: true });
    let pixels = new Uint8Array(16);
    let image = new ImageData(2, 2);
    let disposed = false;
    // 自适应画幅取会话开始时的视口比例并冻结：录制或监看期间调整窗口不能改变输出尺寸。
    let viewportAspect: number | undefined;
    return {
        canvas,
        render(mode: PrevisRenderMode, time?: number) {
            if (disposed) throw new Error("捕捉会话已关闭");
            options.signal?.throwIfAborted();
            const context = source();
            if (!context || context.gl.getContext().isContextLost()) throw new Error("3D 视口尚未就绪或已失去上下文");
            const { gl, scene, document: data, playhead } = context;
            viewportAspect ??= readPrevisViewportAspect(gl.domElement) ?? PREVIS_AUTO_ASPECT_FALLBACK;
            const shot = resolvePrevisActiveShot(data);
            const framing = resolvePrevisViewFraming({ scene: data, mode: "camera", playhead: time ?? playhead, viewportAspect });
            if (!shot || !framing || !data.cameras.some((item) => item.id === shot.cameraId)) throw new Error("镜头未绑定有效摄影机");
            const { width, height } = resolvePrevisOutputSize(previsAspectValue(shot.aspectRatio, viewportAspect), options.longEdge ?? 1280);
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
                target.setSize(width, height);
                colorTarget.setSize(width, height);
                pixels = new Uint8Array(width * height * 4);
                image = new ImageData(width, height);
            }
            camera.position.set(...framing.position);
            camera.up.set(...framing.up);
            camera.lookAt(...framing.target);
            camera.fov = framing.fov;
            camera.aspect = width / height;
            camera.near = framing.near;
            // 世界环境的地面与远山远超镜头默认 500m 远裁剪面。
            camera.far = data.world ? Math.max(framing.far, PREVIS_WORLD_CAMERA_FAR) : framing.far;
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld(true);
            const previousTarget = gl.getRenderTarget();
            const viewport = gl.getViewport(new Vector4());
            const scissor = gl.getScissor(new Vector4());
            const scissorTest = gl.getScissorTest();
            const previousMaterial = scene.overrideMaterial;
            const background = scene.background;
            const toneMapping = gl.toneMapping;
            const clearColor = gl.getClearColor(new Color());
            const clearAlpha = gl.getClearAlpha();
            const resume = context.suspendDisplayMaterialOverride();
            const hidden: Object3D[] = [];
            let restoreClay: (() => void) | undefined;
            try {
                const controlPass = mode === "depth" || mode === "normal" || mode === "pose";
                scene.traverse((object) => {
                    // 天空、雨雪只属于成片：控制图里会被 overrideMaterial 画成实体遮挡。
                    if (object.visible && (isPrevisCaptureHelper(object) || (controlPass && object.userData.previsDataPassExclude))) {
                        hidden.push(object);
                        object.visible = false;
                    }
                    object.userData.previsEvaluate?.(time ?? playhead);
                });
                scene.updateMatrixWorld(true);
                scene.overrideMaterial = mode === "depth" ? depth : mode === "normal" ? normal : mode === "pose" ? wire : null;
                if (mode === "clay") restoreClay = applyClaySceneMaterials(scene);
                if (mode !== "beauty") scene.background = new Color(mode === "depth" || mode === "pose" ? "#000000" : "#d8dde3");
                const dataPass = mode === "depth" || mode === "normal" || mode === "pose";
                // 视口的纯色背景直接清屏，不受 tone mapping 影响；输出时保持同样语义。
                const flatBackground = !dataPass && scene.background instanceof Color ? scene.background.clone().getHex(SRGBColorSpace) : null;
                if (flatBackground !== null) {
                    scene.background = null;
                    gl.setClearColor(0x000000, 0);
                }
                if (dataPass) gl.toneMapping = NoToneMapping;
                gl.setRenderTarget(dataPass ? target : colorTarget);
                gl.setScissorTest(false);
                gl.clear();
                gl.render(scene, camera);
                if (!dataPass) output.render(gl, target, colorTarget, 0, false);
                gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
                if (flatBackground !== null) {
                    const rgb = [(flatBackground >> 16) & 255, (flatBackground >> 8) & 255, flatBackground & 255];
                    for (let i = 0; i < pixels.length; i += 4) {
                        const alpha = pixels[i + 3] / 255;
                        if (alpha === 1) continue;
                        for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round(pixels[i + channel] * alpha + rgb[channel] * (1 - alpha));
                        pixels[i + 3] = 255;
                    }
                }
                for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - y - 1) * width * 4, (height - y) * width * 4), y * width * 4);
                ctx.putImageData(image, 0, 0);
            } finally {
                restoreClay?.();
                scene.overrideMaterial = previousMaterial;
                scene.background = background;
                hidden.forEach((object) => {
                    object.visible = true;
                });
                scene.traverse((object) => object.userData.previsEvaluate?.(playhead));
                scene.updateMatrixWorld(true);
                gl.toneMapping = toneMapping;
                gl.setClearColor(clearColor, clearAlpha);
                gl.setRenderTarget(previousTarget);
                gl.setViewport(viewport);
                gl.setScissor(scissor);
                gl.setScissorTest(scissorTest);
                resume();
            }
            return canvas;
        },
        dispose() {
            disposed = true;
            target.dispose();
            colorTarget.dispose();
            output.dispose();
            depth.dispose();
            normal.dispose();
            wire.dispose();
        },
    };
}

export async function captureFrame(source: PrevisCaptureSource, mode: PrevisRenderMode, options?: PrevisCaptureOptions) {
    const surface = createPrevisShotSurface(source, options);
    try {
        surface.render(mode);
        return await canvasToBlob(surface.canvas);
    } finally {
        surface.dispose();
    }
}

/** 浏览器实时录制；独立求值镜头时间，不依赖播放头循环，也不修改工作台状态。 */
export async function recordCanvas(source: PrevisCaptureSource, duration: number, fps: number, mode: PrevisRenderMode = "clay", options: PrevisCaptureOptions = {}) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60 || !Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("录制时长或帧率无效");
    if (typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持录屏，请使用 Chrome 或 Edge");
    const surface = createPrevisShotSurface(source, options);
    let stream: MediaStream | undefined;
    let timer = 0;
    let watchdog = 0;
    let recorder: MediaRecorder | undefined;
    let onAbort = () => {};
    let onHidden = () => {};
    try {
        surface.render(mode, 0);
        if (!surface.canvas.captureStream) throw new Error("当前浏览器不支持画面录制");
        stream = surface.canvas.captureStream(fps);
        const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/mp4", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw new Error("当前浏览器没有可用的视频编码器");
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
        const activeRecorder = recorder;
        const chunks: Blob[] = [];
        return await new Promise<Blob>((resolve, reject) => {
            let failure: Error | null = null;
            const stop = (error?: Error) => {
                failure ||= error ?? null;
                window.clearTimeout(timer);
                if (activeRecorder.state !== "inactive") activeRecorder.stop();
            };
            onAbort = () => stop(new Error("录制已取消"));
            onHidden = () => {
                if (document.hidden) stop(new Error("录制已中止：请保持世界引擎标签页可见"));
            };
            activeRecorder.ondataavailable = (event) => {
                if (event.data.size) chunks.push(event.data);
            };
            activeRecorder.onerror = () => {
                reject(new Error("视频编码失败"));
            };
            activeRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: activeRecorder.mimeType });
                if (failure) reject(failure);
                else if (!blob.size) reject(new Error("录制没有产生视频数据"));
                else resolve(blob);
            };
            options.signal?.addEventListener("abort", onAbort, { once: true });
            document.addEventListener("visibilitychange", onHidden);
            activeRecorder.start(250);
            const start = performance.now();
            const tick = () => {
                try {
                    const elapsed = (performance.now() - start) / 1000;
                    if (elapsed >= duration) {
                        stop();
                        return;
                    }
                    surface.render(mode, Math.floor(elapsed * fps) / fps);
                    timer = window.setTimeout(tick, 1000 / fps);
                } catch (error) {
                    stop(error instanceof Error ? error : new Error("录制期间渲染失败"));
                }
            };
            timer = window.setTimeout(tick, 1000 / fps);
            watchdog = window.setTimeout(
                () => {
                    stop(new Error("视频编码超时"));
                    reject(new Error("视频编码超时"));
                },
                duration * 1000 + 10000,
            );
            if (options.signal?.aborted) onAbort();
            if (document.hidden) onHidden();
        });
    } finally {
        window.clearTimeout(timer);
        window.clearTimeout(watchdog);
        options.signal?.removeEventListener("abort", onAbort);
        document.removeEventListener("visibilitychange", onHidden);
        if (recorder && recorder.state !== "inactive") recorder.stop();
        stream?.getTracks().forEach((track) => track.stop());
        surface.dispose();
    }
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("3D 预览图导出失败"))), "image/png"));
}

/** 视口 CSS 尺寸的宽高比；canvas 尚未布局时返回 undefined。 */
function readPrevisViewportAspect(element: HTMLCanvasElement) {
    const width = element.clientWidth;
    const height = element.clientHeight;
    return width > 0 && height > 0 ? width / height : undefined;
}

/** 编辑辅助物（网格、机位模型、路径、gizmo、骨骼线、关节球）不进入成片与控制图。 */
function isPrevisCaptureHelper(object: Object3D) {
    if (object.userData.previsCaptureExclude) return true;
    const flags = object as Object3D & { isTransformControls?: boolean; isTransformControlsGizmo?: boolean; isTransformControlsPlane?: boolean };
    return Boolean(flags.isTransformControls || flags.isTransformControlsGizmo || flags.isTransformControlsPlane) || object.type === "SkeletonHelper";
}
