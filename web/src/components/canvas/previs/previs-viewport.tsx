import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, TransformControls } from "@react-three/drei";
import { Component, forwardRef, memo, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { AnimationClip, AnimationMixer, Camera, Color, Matrix4, Euler, EquirectangularReflectionMapping, Group, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshNormalMaterial, MOUSE, Object3D, OrthographicCamera, PerspectiveCamera, Plane, Quaternion, Raycaster, Scene, SkeletonHelper, SRGBColorSpace, Texture, TextureLoader, TOUCH, Vector2, Vector3, WebGLRenderer } from "three";
import { GLTFLoader, SkeletonUtils } from "three-stdlib";

import { applyClaySceneMaterials } from "@/lib/canvas/previs/previs-clay-materials";
import { createPrevisTransaction, installPrevisTerminalListeners } from "@/lib/canvas/previs/previs-gesture-transaction";
import { emptyPrevisPlacementIntent, finitePrevisGroundPoint, type PrevisGroundPoint, type PrevisPlacementIntent } from "@/lib/canvas/previs/previs-placement";
import { previsDiagnosticObjectKind } from "@/lib/canvas/previs/previs-diagnostics";
import { recordPrevisDiagnostic } from "@/lib/canvas/previs/previs-diagnostics-recorder";
import { previsCaptureInitial, previsCaptureUsable, previsLoadIdentity, previsLoadInitial, installPrevisContextListeners, reducePrevisCapture, reducePrevisLoad, releasePrevisCapture, resolvePrevisDisplay, restorePrevisCapture, upsertPrevisFailedLoad, type PrevisFailedLoads, type PrevisLoadSignal } from "@/lib/canvas/previs/previs-recovery";
import { disposePrevisAdoptionFailure, disposePrevisHelper, disposePrevisModelResources, disposePrevisObject3D, resolvePrevisLoadOwnership } from "@/lib/canvas/previs/previs-resources";
import { PREVIS_DEFAULT_ACTOR_URL, previsActorProfileForArchetype, resolvePrevisActorColor, previsTransformPathLength, finitePrevisTransformKeyframes, interpolatePrevisTransform } from "@/lib/canvas/previs/previs-scene";
import { PREVIS_DEFAULT_VIEW_MODE, previsViewFramingKey, resolvePrevisEffectiveViewport, resolvePrevisOrthographicFraming, resolvePrevisOrthographicFrustum, resolvePrevisViewFraming, type PrevisOrthographicFraming, type PrevisViewFraming, type PrevisViewMode } from "@/lib/canvas/previs/previs-view-modes";
import { PrevisViewToolbar } from "@/components/canvas/previs/previs-view-toolbar";
import { resolveMediaUrl } from "@/services/file-storage";
import type { PrevisCamera, PrevisEnvironment, PrevisHumanoidBone, PrevisLight, PrevisObject, PrevisQuat, PrevisRenderMode, PrevisRig, PrevisScene, PrevisTransform, PrevisVec3 } from "@/types/previs";
import { applyActorReferenceMaterial, applyPrevisBoneTracks, previsFingerGroup, inferPrevisRig, normalizeModel, readRigRestRotations, screenPixelsToWorldRadius, updateActorReferenceColor } from "./previs-viewport-rig";
import { captureFrame, recordCanvas } from "./previs-viewport-capture";

export type PrevisOrbitControls = ComponentRef<typeof OrbitControls>;

export type PrevisViewportHandle = {
    capture: (mode: PrevisRenderMode) => Promise<Blob>;
    recordVideo: (duration: number, fps: number) => Promise<Blob>;
    readCameraTransform: () => PrevisTransform | null;
    focusSelected: () => void;
    frameScene: () => void;
    resetCamera: () => void;
    zoom: (factor: number) => void;
    /** 只读放置意图。上下文不可用或从未产生合法点时返回空意图，绝不抛异常。 */
    readPlacementIntent: () => PrevisPlacementIntent;
};

type PrevisViewportProps = {
    scene: PrevisScene;
    selectedObjectId: string | null;
    selectedBone: string | null;
    transformMode: "translate" | "rotate" | "scale";
    renderMode: PrevisRenderMode;
    playhead: number;
    playing: boolean;
    /** 动画模式下显示演员与摄影机 Transform 关键帧形成的空间路径。 */
    showMotionPaths?: boolean;
    /** 取景模式。省略即自由视角，保持接线前的行为不变。 */
    viewMode?: PrevisViewMode;
    /** 提供该回调即在视口内渲染 3D/CAM 切换器；不提供则不显示，视口仍按 viewMode 取景。 */
    onViewModeChange?: (mode: PrevisViewMode) => void;
    /** 宿主自带导航工具条时关闭内置的聚焦/缩放浮层，避免两套控件重叠。 */
    showNavigation?: boolean;
    /** 辅助监看不重复显示同一模型的错误提示；主视口保留唯一可操作重试入口。 */
    showModelLoadNotice?: boolean;
    onSelectObject: (id: string | null) => void;
    onSelectBone: (bone: string | null) => void;
    /** 点击地面直接落位；不提供则只保留视口观察行为。 */
    onGroundClick?: (point: PrevisGroundPoint) => void;
    /** 显式进入轨迹绘制态时，拖动地面会采样一条路径。 */
    trajectoryDrawing?: boolean;
    onTrajectoryComplete?: (points: PrevisGroundPoint[]) => void;
    onObjectTransform: (id: string, from: PrevisTransform, to: PrevisTransform) => void;
    onBoneTransform: (id: string, bone: string, rotation: PrevisQuat) => void;
    onActorRigReady: (id: string, rig: PrevisRig, animations: AnimationClip[]) => void;
    /** 选中的摄影机 id；导演视角中显示可拖动的摄影机 gizmo。 */
    selectedCameraId?: string | null;
    onSelectCamera?: (id: string) => void;
    onCameraTransform?: (id: string, from: PrevisTransform, to: PrevisTransform) => void;
    onNavigationReady?: (navigation: Pick<PrevisViewportHandle, "focusSelected" | "frameScene" | "resetCamera" | "zoom">) => void;
};

export type CaptureContext = { gl: WebGLRenderer; scene: Scene; camera: Camera; suspendDisplayMaterialOverride: () => () => void };

// 稳定空值：identity 不匹配时返回同一引用，避免下游 effect 依赖每次 render 都变化。
const emptyAnimations: AnimationClip[] = [];
const emptyRestRotations: Partial<Record<PrevisHumanoidBone, PrevisQuat>> = {};

// Canvas 配置必须是稳定引用：inline literal 每次父级 render 都是新对象，
// context lost 的 dispatch 触发重渲染后 R3F 会 configure 并在失效 context 上
// 重建 WebGLRenderer，抛 getMaxPrecision / autoReset。稳定后 lost 只显示 notice。
const previsCanvasGl = { antialias: true, preserveDrawingBuffer: true, alpha: false } as const;
const previsCanvasCamera = { position: [4.8, 2.7, 6.8] as [number, number, number], fov: 50, near: 0.05, far: 500 } as const;
const previsCanvasDpr: [number, number] = [1, 1.5];
// 自由视角固定环绕焦点：free 是独立观察相机，不跟随 shot 摄影机的 target 走，
// 否则切换镜头/摄影机会连带把用户正在环绕的焦点也悄悄挪走。
const PREVIS_FREE_ORBIT_TARGET: PrevisVec3 = [0, 1, 0];

export const PrevisViewport = forwardRef<PrevisViewportHandle, PrevisViewportProps>(function PrevisViewport(props, ref) {
    // onViewModeChange 只服务 DOM 层的切换器，绝不进 Canvas 子树：它的身份每次父级
    // render 都可能变化，穿透到 memo 化的 Canvas 会触发 configure 重建 renderer。
    const { onViewModeChange, showModelLoadNotice = true, showNavigation = true, ...sceneProps } = props;
    const captureContext = useRef<CaptureContext | null>(null);
    // 地面点连同 owner canvas 一起记录：owner 不是当前 renderer 的 canvas 就是陈旧值。
    const groundRef = useRef<{ owner: HTMLCanvasElement; point: PrevisGroundPoint } | null>(null);
    const orbitControlsRef = useRef<PrevisOrbitControls | null>(null);
    /** pointermove 高频路径只写 ref，不触发 render；清空只允许由该点的 owner 发起。 */
    const onGroundPoint = useCallback((owner: HTMLCanvasElement, point: PrevisGroundPoint | null) => {
        if (point) {
            groundRef.current = { owner, point };
            return;
        }
        if (groundRef.current?.owner === owner) groundRef.current = null;
    }, []);
    const onOrbitControls = useCallback((controls: PrevisOrbitControls | null) => {
        orbitControlsRef.current = controls;
    }, []);
    // retryKey 变化会真正重建 Canvas 与 ErrorBoundary，而不是只换文案。
    const [retryKey, setRetryKey] = useState(0);
    // capture 可用性：上下文丢失期间不得再使用失效 renderer；恢复后需重新登记。
    const [capture, dispatchCapture] = useReducer(reducePrevisCapture, previsCaptureInitial);
    const captureRef = useRef(capture);
    captureRef.current = capture;
    // 加载失败的对象 id -> 该对象自己的 retry；Canvas 内部无法呈现可操作提示，统一提到 DOM 层。
    const [failedLoads, setFailedLoads] = useState<PrevisFailedLoads>({});
    const onCaptureContext = useCallback((context: CaptureContext) => {
        captureContext.current = context;
        dispatchCapture("register");
    }, []);
    /** 子树卸载 / boundary 捕获：清掉指向已销毁 renderer 的引用并打回不可用。 */
    const releaseCapture = useCallback(() => {
        releasePrevisCapture({
            clearContext: () => {
                captureContext.current = null;
            },
            onAvailability: dispatchCapture,
        });
        // 地面点与 controls 都属于已销毁的 renderer，必须一并作废。
        groundRef.current = null;
        orbitControlsRef.current = null;
    }, []);
    const retry = useCallback(() => {
        releaseCapture();
        setFailedLoads({});
        setRetryKey((value) => value + 1);
    }, [releaseCapture]);
    const onLoadStateChange = useCallback((id: string, signal: PrevisLoadSignal, retryLoad: () => void) => {
        setFailedLoads((current) => upsertPrevisFailedLoad(current, id, signal, retryLoad));
    }, []);
    // 稳定引用：否则新的监听 effect 会在每次父级 render 时摘除重装。
    const onContextLost = useCallback(() => {
        // 上下文丢失后相机与射线结果都不可信，旧地面点必须作废，恢复后需重新移动 pointer。
        groundRef.current = null;
        recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_LOST");
        dispatchCapture("lost");
    }, []);
    const onContextRestored = useCallback(() => {
        recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_RESTORED");
        dispatchCapture("restored");
    }, []);
    const failedIds = Object.keys(failedLoads);
    // 上下文失效时 renderer 不可用：capture/record/readCamera 必须明确失败而不是画出脏帧。
    const usableContext = () => {
        if (!previsCaptureUsable(captureRef.current)) return null;
        return captureContext.current;
    };
    const navigationRef = useRef<Pick<PrevisViewportHandle, "focusSelected" | "frameScene" | "resetCamera" | "zoom"> | null>(null);
    const [navigation, setNavigation] = useState<Pick<PrevisViewportHandle, "focusSelected" | "frameScene" | "resetCamera" | "zoom"> | null>(null);
    const handleNavigationReady = useCallback((next: Pick<PrevisViewportHandle, "focusSelected" | "frameScene" | "resetCamera" | "zoom">) => { navigationRef.current = next; setNavigation(next); }, []);
    useImperativeHandle(ref, () => ({
        capture: (mode) => captureFrame(usableContext(), mode),
        recordVideo: (duration, fps) => recordCanvas(usableContext(), duration, fps),
        readCameraTransform: () => {
            const camera = usableContext()?.camera;
            return camera ? { position: camera.position.toArray() as PrevisTransform["position"], rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z], scale: [1, 1, 1] } : null;
        },
        focusSelected: () => navigationRef.current?.focusSelected(),
        frameScene: () => navigationRef.current?.frameScene(),
        resetCamera: () => navigationRef.current?.resetCamera(),
        zoom: (factor) => navigationRef.current?.zoom(factor),
        readPlacementIntent: () => {
            const context = usableContext();
            if (!context) return emptyPrevisPlacementIntent;
            // owner 校验：上下文重建后，旧 renderer canvas 记录的点一律不采用。
            const tracked = groundRef.current;
            const pointer = tracked && tracked.owner === context.gl.domElement ? tracked.point : null;
            // 读实例当前 target，而不是 activeCamera.target prop；投影到 y=0 即取 x/z。
            const target = orbitControlsRef.current?.target;
            return { pointer, orbitTarget: finitePrevisGroundPoint(target?.x, target?.z) };
        },
    }), []);

    return (
        // data-renderer-ready 直接来自 previsCaptureUsable：capture context 已登记且未 lost。
        // 这是真实就绪信号，供 E2E 在触发 context loss 前确定监听器已安装。
        <div className="previs-viewport-shell" data-renderer-ready={previsCaptureUsable(capture) ? "true" : "false"}>
            <PrevisViewportErrorBoundary key={`boundary-${retryKey}`} onRelease={releaseCapture} onRetry={retry}>
                <PrevisCanvasSurface
                    scene={props.scene}
                    selectedObjectId={props.selectedObjectId}
                    selectedBone={props.selectedBone}
                    transformMode={props.transformMode}
                    renderMode={props.renderMode}
                    playhead={props.playhead}
                    playing={props.playing}
                    showMotionPaths={props.showMotionPaths}
                    viewMode={props.viewMode}
                    onSelectObject={props.onSelectObject}
                    onSelectBone={props.onSelectBone}
                    onGroundClick={props.onGroundClick}
                    trajectoryDrawing={props.trajectoryDrawing}
                    onTrajectoryComplete={props.onTrajectoryComplete}
                    onObjectTransform={props.onObjectTransform}
                    onBoneTransform={props.onBoneTransform}
                    onActorRigReady={props.onActorRigReady}
                    selectedCameraId={props.selectedCameraId}
                    onSelectCamera={props.onSelectCamera}
                    onCameraTransform={props.onCameraTransform}
                    showModelLoadNotice={props.showModelLoadNotice}
                    onCaptureContext={onCaptureContext}
                    onRelease={releaseCapture}
                    onContextLost={onContextLost}
                    onContextRestored={onContextRestored}
                    onLoadStateChange={onLoadStateChange}
                    onGroundPoint={onGroundPoint}
                    onOrbitControls={onOrbitControls}
                    onNavigationReady={handleNavigationReady}
                />
            </PrevisViewportErrorBoundary>
            {/* 取景切换是纯视口状态：放在 DOM 层，不随 Canvas 重建而丢失。 */}
            {onViewModeChange ? <PrevisViewToolbar viewMode={props.viewMode ?? PREVIS_DEFAULT_VIEW_MODE} onViewModeChange={onViewModeChange} /> : null}
            {showNavigation ? <PrevisNavigationToolbar navigation={navigation} /> : null}
            {capture.contextLost ? (
                <PrevisViewportNotice
                    title="3D 显示上下文已丢失"
                    description="浏览器回收了 WebGL 上下文。等待自动恢复，或立即重建视口。"
                    actionLabel="重建 3D 视口"
                    onAction={retry}
                />
            ) : null}
            {!capture.contextLost && showModelLoadNotice && failedIds.length ? (
                <PrevisViewportNotice
                    variant="corner"
                    title={`${failedIds.length} 个 3D 模型加载失败`}
                    description="已用占位人偶继续显示场景。可能是网络或模型地址不可用，重试将重新加载。"
                    actionLabel="重试加载"
                    onAction={() => {
                        // 重试触发新的 load generation，旧的晚到回调会被忽略并释放资源。
                        Object.values(failedLoads).forEach((retryLoad) => retryLoad());
                        setFailedLoads({});
                    }}
                />
            ) : null}
        </div>
    );
});

// onViewModeChange 被显式排除：切换器活在 DOM 层，Canvas 子树只需要 viewMode 取值。
type PrevisCanvasSurfaceProps = Omit<PrevisViewportProps, "onViewModeChange"> & {
    onCaptureContext: (context: CaptureContext) => void;
    onRelease: () => void;
    onContextLost: () => void;
    onContextRestored: () => void;
    onLoadStateChange: (id: string, signal: PrevisLoadSignal, retry: () => void) => void;
    onGroundPoint: (owner: HTMLCanvasElement, point: PrevisGroundPoint | null) => void;
    onOrbitControls: (controls: PrevisOrbitControls | null) => void;
    onNavigationReady?: (navigation: Pick<PrevisViewportHandle, "focusSelected" | "frameScene" | "resetCamera" | "zoom">) => void;
};

/**
 * Canvas 表面独立 memo。
 *
 * R3F 本地 CanvasImpl 的 layout effect 没有依赖数组，父级每次 rerender 都会 configure。
 * context lost 时 PrevisViewport 会 dispatchCapture 触发 rerender，若 Canvas 跟着重渲染，
 * configure 就会在已失效的 canvas 上重建 WebGLRenderer 并抛 getMaxPrecision / autoReset。
 * 隔离在 memo 子组件后，contextLost / failedLoads 这类外层状态变化不再穿透到 Canvas；
 * 只有 props 真的变化才重渲染，retryKey 变化仍由外层 key 触发真正 remount。
 */
const PrevisCanvasSurface = memo(function PrevisCanvasSurface(props: PrevisCanvasSurfaceProps) {
    const { onCaptureContext, onRelease, onContextLost, onContextRestored, onLoadStateChange, onGroundPoint, onOrbitControls, onNavigationReady, ...sceneProps } = props;
    const onSelectObject = sceneProps.onSelectObject;
    const onPointerMissed = useCallback(() => onSelectObject(null), [onSelectObject]);

    return (
        <Canvas
            shadows
            frameloop="demand"
            dpr={previsCanvasDpr}
            camera={previsCanvasCamera}
            gl={previsCanvasGl}
            onPointerMissed={onPointerMissed}
        >
            <Suspense fallback={null}>
                <PrevisSceneContent
                    scene={props.scene}
                    selectedObjectId={props.selectedObjectId}
                    selectedBone={props.selectedBone}
                    transformMode={props.transformMode}
                    renderMode={props.renderMode}
                    playhead={props.playhead}
                    playing={props.playing}
                    showMotionPaths={props.showMotionPaths}
                    viewMode={props.viewMode}
                    onSelectObject={props.onSelectObject}
                    onSelectBone={props.onSelectBone}
                    onGroundClick={props.onGroundClick}
                    trajectoryDrawing={props.trajectoryDrawing}
                    onTrajectoryComplete={props.onTrajectoryComplete}
                    onObjectTransform={props.onObjectTransform}
                    onBoneTransform={props.onBoneTransform}
                    onActorRigReady={props.onActorRigReady}
                    selectedCameraId={props.selectedCameraId}
                    onSelectCamera={props.onSelectCamera}
                    onCameraTransform={props.onCameraTransform}
                    showModelLoadNotice={props.showModelLoadNotice}
                    onCaptureContext={onCaptureContext}
                    onRelease={onRelease}
                    onContextLost={onContextLost}
                    onContextRestored={onContextRestored}
                    onLoadStateChange={onLoadStateChange}
                    onGroundPoint={onGroundPoint}
                    onOrbitControls={onOrbitControls}
                    onNavigationReady={onNavigationReady}
                />
            </Suspense>
        </Canvas>
    );
});

/** 本地失败隔离：3D 视口异常只替换视口本身，不影响画布/项目其余部分。 */
class PrevisViewportErrorBoundary extends Component<{ children: ReactNode; onRelease: () => void; onRetry: () => void }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch() {
        // 只记录稳定错误码：原始 error / componentStack 可能带素材 URL 或正文，不落日志。
        recordPrevisDiagnostic("PREVIS_VIEWPORT_RENDER_FAILED");
        // 子树已被 React 卸载，capture context 指向已销毁的 renderer，必须同步释放。
        this.props.onRelease();
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <PrevisViewportNotice
                title="3D 视口渲染失败"
                description="预演台其余面板仍可使用。可重试重建视口；若持续失败请检查显卡驱动或浏览器 WebGL 支持。"
                actionLabel="重试 3D 视口"
                onAction={() => {
                    this.setState({ failed: false });
                    this.props.onRetry();
                }}
            />
        );
    }
}

function PrevisNavigationToolbar({ navigation }: { navigation: Pick<PrevisViewportHandle, "focusSelected" | "frameScene" | "resetCamera" | "zoom"> | null }) {
    const action = (run: () => void) => { run(); };
    return <div className="previs-viewport-navigation" aria-label="视口导航工具">
        <button type="button" aria-label="聚焦选中对象" title="聚焦选中对象" disabled={!navigation} onClick={() => navigation && action(navigation.focusSelected)}>聚焦</button>
        <button type="button" aria-label="适配全部对象" title="适配全部对象" disabled={!navigation} onClick={() => navigation && action(navigation.frameScene)}>全景</button>
        <button type="button" aria-label="重置视角" title="重置视角" disabled={!navigation} onClick={() => navigation && action(navigation.resetCamera)}>重置</button>
        <span className="previs-viewport-navigation-divider" />
        <button type="button" aria-label="拉近视角" title="拉近视角" disabled={!navigation} onClick={() => navigation && action(() => navigation.zoom(0.72))}>＋</button>
        <button type="button" aria-label="拉远视角" title="拉远视角" disabled={!navigation} onClick={() => navigation && action(() => navigation.zoom(1.38))}>−</button>
    </div>;
}

function PrevisViewportNotice({ title, description, actionLabel, onAction, variant = "cover" }: { title: string; description: string; actionLabel: string; onAction: () => void; variant?: "cover" | "corner" }) {
    return (
        <div className={`previs-viewport-notice ${variant === "corner" ? "is-corner" : "is-cover"}`} role="alert">
            <div className="previs-viewport-notice-title">{title}</div>
            <p className="previs-viewport-notice-text">{description}</p>
            <button type="button" className="previs-viewport-notice-action" onClick={onAction}>{actionLabel}</button>
        </div>
    );
}

function PrevisSceneContent({ scene, selectedObjectId, selectedBone, transformMode, renderMode, playhead, showMotionPaths = false, viewMode = PREVIS_DEFAULT_VIEW_MODE, onSelectObject, onSelectBone, onGroundClick, trajectoryDrawing = false, onTrajectoryComplete, onObjectTransform, onBoneTransform, onActorRigReady, selectedCameraId, onSelectCamera, onCameraTransform, onCaptureContext, onRelease, onContextLost, onContextRestored, onLoadStateChange, onGroundPoint, onOrbitControls, onNavigationReady }: PrevisCanvasSurfaceProps) {
    const { gl, camera, scene: threeScene, invalidate, set, size } = useThree();
    const orbitRef = useRef<PrevisOrbitControls>(null);
    const [transforming, setTransforming] = useState(false);
    const [draftPath, setDraftPath] = useState<PrevisVec3[]>([]);
    const pointerHitRef = useRef(false);
    const displayClayRestoreRef = useRef<(() => void) | null>(null);
    // 三台相机各司其职、互不共享：free 只由 OrbitControls 驱动，CAM/正交只在各自模式下
    // 由取景数据接管。切换 viewMode 只挪动「谁是活动相机」这个指针，任何一台的内部状态
    // 都不会因为切换而被读写——这是「切换不丢失/不污染任一相机状态」的唯一来源。
    const [freeCamera] = useState(() => {
        const instance = new PerspectiveCamera(previsCanvasCamera.fov, 1, previsCanvasCamera.near, previsCanvasCamera.far);
        instance.position.set(...previsCanvasCamera.position);
        instance.lookAt(...PREVIS_FREE_ORBIT_TARGET);
        return instance;
    });
    const [camCamera] = useState(() => new PerspectiveCamera(previsCanvasCamera.fov, 1, previsCanvasCamera.near, previsCanvasCamera.far));
    const [orthoCamera] = useState(() => new OrthographicCamera(-1, 1, 1, -1, 0.05, 500));
    // CAM 与正交轴向的取景解算都是纯函数：mode 不匹配时各自返回 null，互不冲突。
    // 活动相机不直接看 viewMode：CAM 取景失败必须回落 free，否则会露出从未写入的 camCamera。
    const camFraming = resolvePrevisViewFraming({ scene, mode: viewMode, playhead, cameraId: selectedCameraId });
    const orthoFraming = resolvePrevisOrthographicFraming({ scene, mode: viewMode });
    const effectiveViewport = resolvePrevisEffectiveViewport({ mode: viewMode, framing: camFraming });
    const setTransformingState = useCallback((active: boolean) => {
        setTransforming(active);
        if (orbitRef.current) orbitRef.current.enabled = !active && effectiveViewport.orbit;
    }, [effectiveViewport.orbit]);
    const actorMotionPaths = useMemo(() => showMotionPaths ? scene.objects.filter((object) => object.visible && (object.kind === "actor" || object.primitive === "character") && previsTransformPathLength(object.keyframes) > 0.001) : [], [scene.objects, showMotionPaths]);
    const cameraMotionPaths = useMemo(() => showMotionPaths ? scene.cameras.filter((item) => previsTransformPathLength(item.keyframes) > 0.001) : [], [scene.cameras, showMotionPaths]);
    const suspendDisplayMaterialOverride = useCallback(() => {
        const suspended = Boolean(displayClayRestoreRef.current);
        displayClayRestoreRef.current?.();
        displayClayRestoreRef.current = null;
        return () => {
            if (suspended) displayClayRestoreRef.current = applyClaySceneMaterials(threeScene);
        };
    }, [threeScene]);

    const readCaptureContext = useCallback((): CaptureContext => ({ gl, camera: camera as Camera, scene: threeScene, suspendDisplayMaterialOverride }), [camera, gl, suspendDisplayMaterialOverride, threeScene]);

    useEffect(() => {
        onCaptureContext(readCaptureContext());
    }, [onCaptureContext, readCaptureContext]);

    // 子树卸载（重试重建、boundary 捕获后 React 卸载）时同步释放：
    // 此后 captureContext 指向已销毁的 renderer，必须清空并打回不可用。
    // 单独 effect 且只依赖稳定的 onRelease，不会被 readCaptureContext 变化连带触发。
    useEffect(() => () => onRelease(), [onRelease]);

    // 上下文丢失/恢复监听绑定在 renderer 自己的 canvas 上，随 renderer 与重试精确摘除。
    useEffect(() => installPrevisContextListeners(gl.domElement, {
        onLost: onContextLost,
        // 恢复后 registered 会被置回 false，必须用当前 renderer 重新登记，
        // 否则 capture/record/readCameraTransform 会一直不可用。走与测试共用的序列 helper。
        onRestored: () => restorePrevisCapture({
            readContext: readCaptureContext,
            onAvailability: onContextRestored,
            onRegister: onCaptureContext,
            invalidate,
        }),
    }), [gl, invalidate, onCaptureContext, onContextLost, onContextRestored, readCaptureContext]);

    /**
     * 地面拾取：renderer 自己的 canvas 上做 pointer 监听，再用真实 Raycaster 与
     * 世界 y=0 Plane 求交。不走 mesh onPointerMove（会被物体 stopPropagation 截断），
     * 也不做 DOM 像素伪换算；因此 pointer 悬停在物体上方时射线仍与地面相交。
     * 高频路径只写 ref，绝不 setState。
     */
    useEffect(() => {
        const canvasElement = gl.domElement;
        const raycaster = new Raycaster();
        const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
        const hit = new Vector3();
        const ndc = new Vector2();
        let pointerDown: { id: number; x: number; y: number; button: number } | null = null;
        let pathDrawing = false;
        let pathPoints: PrevisVec3[] = [];
        pointerHitRef.current = false;

        const resolveGroundPoint = (event: PointerEvent) => {
            const bounds = canvasElement.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return null;
            ndc.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
            return finitePrevisGroundPoint(hit.x, hit.z);
        };

        const onPointerMove = (event: PointerEvent) => {
            const point = resolveGroundPoint(event);
            // 射线与地面平行或背离时保留上一个合法点，不写非法值。
            if (!point) return;
            onGroundPoint(canvasElement, point);
            if (!pathDrawing) return;
            const next: PrevisVec3 = [point.x, 0, point.z];
            const previous = pathPoints[pathPoints.length - 1];
            if (previous && Math.hypot(next[0] - previous[0], next[2] - previous[2]) < 0.04) return;
            pathPoints = [...pathPoints, next];
            setDraftPath(pathPoints);
        };

            const onPointerDown = (event: PointerEvent) => {
                // 原生 canvas 监听先于 R3F（挂在父容器）触发：先清零，命中对象时 R3F 再置位。
                pointerHitRef.current = false;
                if (!onGroundClick || event.isPrimary === false || event.button !== 0) return;
                pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button };
                if (!trajectoryDrawing) return;
                const point = resolveGroundPoint(event);
                if (!point) return;
                try { canvasElement.setPointerCapture(event.pointerId); } catch { /* pointer capture may be unavailable */ }
                pathDrawing = true;
                pathPoints = [[point.x, 0, point.z]];
                setDraftPath(pathPoints);
                if (orbitRef.current) orbitRef.current.enabled = false;
            };

            const onPointerUp = (event: PointerEvent) => {
                const start = pointerDown;
                pointerDown = null;
                if (!start || start.id !== event.pointerId || start.button !== 0 || event.button !== 0) return;
                if (pathDrawing) {
                    try { if (canvasElement.hasPointerCapture(event.pointerId)) canvasElement.releasePointerCapture(event.pointerId); } catch { /* pointer capture may already be gone */ }
                    pathDrawing = false;
                    const completed = pathPoints;
                    pathPoints = [];
                    setDraftPath([]);
                    if (orbitRef.current) orbitRef.current.enabled = !transforming && effectiveViewport.orbit;
                    if (completed.length > 1) onTrajectoryComplete?.(completed.map(([x, , z]) => ({ x, z })));
                    return;
                }
            // OrbitControls 旋转、平移或缩放结束时也会收到 pointerup，移动阈值避免误落位。
            const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (distance > 5 || pointerHitRef.current) return;
            const point = resolveGroundPoint(event);
            if (point) onGroundClick?.(point);
        };

        const onPointerCancel = (event: PointerEvent) => {
            if (pointerDown?.id === event.pointerId) pointerDown = null;
            if (!pathDrawing) return;
            try { if (canvasElement.hasPointerCapture(event.pointerId)) canvasElement.releasePointerCapture(event.pointerId); } catch { /* pointer capture may already be gone */ }
            pathDrawing = false;
            pathPoints = [];
            setDraftPath([]);
            if (orbitRef.current) orbitRef.current.enabled = !transforming && effectiveViewport.orbit;
        };

        canvasElement.addEventListener("pointermove", onPointerMove, { passive: true });
        canvasElement.addEventListener("pointerdown", onPointerDown, { passive: true });
        canvasElement.addEventListener("pointerup", onPointerUp, { passive: true });
        canvasElement.addEventListener("pointercancel", onPointerCancel, { passive: true });
        return () => {
            canvasElement.removeEventListener("pointermove", onPointerMove);
            canvasElement.removeEventListener("pointerdown", onPointerDown);
            canvasElement.removeEventListener("pointerup", onPointerUp);
            canvasElement.removeEventListener("pointercancel", onPointerCancel);
            if (pointerDown) {
                try { if (canvasElement.hasPointerCapture(pointerDown.id)) canvasElement.releasePointerCapture(pointerDown.id); } catch { /* pointer capture may already be gone */ }
            }
            pointerDown = null;
            pathDrawing = false;
            pathPoints = [];
            setDraftPath([]);
            // 这个 renderer 的 canvas 卸载后，它记录的地面点不得再被读到。
            onGroundPoint(canvasElement, null);
        };
    }, [camera, effectiveViewport.orbit, gl, onGroundClick, onGroundPoint, onTrajectoryComplete, trajectoryDrawing, transforming]);

    // 导航只改 free 相机，不写回场景坐标。初次挂载自动适配一次，避免对象出现在视口角落；之后由用户按钮控制取景。
    const initialFrameSceneRef = useRef<string | null>(null);
    useEffect(() => {
        const resetCamera = () => {
            freeCamera.position.set(...previsCanvasCamera.position);
            freeCamera.lookAt(...PREVIS_FREE_ORBIT_TARGET);
            orbitRef.current?.target.set(...PREVIS_FREE_ORBIT_TARGET);
            orbitRef.current?.update();
            invalidate();
        };
        const frame = (ids?: Set<string>) => {
            const objects = scene.objects.filter((object) => object.visible && (!ids || ids.has(object.id)));
            if (!objects.length) return resetCamera();

            const min = new Vector3(Infinity, Infinity, Infinity);
            const max = new Vector3(-Infinity, -Infinity, -Infinity);
            objects.forEach((object) => {
                const [x, y, z] = object.transform.position;
                const [sx, sy, sz] = object.transform.scale;
                const actor = object.kind === "actor" || object.primitive === "character";
                const primitiveBounds: [number, number, number] = actor
                    ? [0.55, 1.45, 0.55]
                    : object.primitive === "sphere" ? [0.6, 0.6, 0.6]
                        : object.primitive === "cylinder" ? [0.55, 0.8, 0.55]
                            : object.primitive === "plane" ? [1.2, 0.05, 1.2]
                                : [0.6, 0.6, 0.6];
                const half = new Vector3(primitiveBounds[0] * Math.max(0.1, Math.abs(sx)), primitiveBounds[1] * Math.max(0.1, Math.abs(sy)), primitiveBounds[2] * Math.max(0.1, Math.abs(sz)));
                min.min(new Vector3(x, y, z).sub(half));
                max.max(new Vector3(x, y, z).add(half));
            });

            const target = min.clone().add(max).multiplyScalar(0.5);
            const span = max.clone().sub(min);
            const radius = Math.max(1.8, Math.max(span.x, span.y, span.z) * 0.72 + 0.7);
            const orbitTarget = orbitRef.current?.target || new Vector3(...PREVIS_FREE_ORBIT_TARGET);
            const direction = freeCamera.position.clone().sub(orbitTarget);
            if (direction.lengthSq() < 0.01) direction.set(4.8, 2.7, 6.8);
            direction.normalize();
            orbitRef.current?.target.copy(target);
            freeCamera.position.copy(target).add(direction.multiplyScalar(radius));
            freeCamera.lookAt(target);
            orbitRef.current?.update();
            invalidate();
        };
        const navigation = {
            focusSelected: () => selectedObjectId ? frame(new Set([selectedObjectId])) : frame(),
            frameScene: () => frame(),
            resetCamera,
            zoom: (factor: number) => {
                const target = orbitRef.current?.target || new Vector3(...PREVIS_FREE_ORBIT_TARGET);
                const offset = freeCamera.position.clone().sub(target).multiplyScalar(Math.max(0.2, Math.min(2, factor)));
                freeCamera.position.copy(target).add(offset);
                freeCamera.lookAt(target);
                orbitRef.current?.update();
                invalidate();
            },
        };
        onNavigationReady?.(navigation);
        if (initialFrameSceneRef.current !== scene.id) {
            initialFrameSceneRef.current = scene.id;
            frame();
        }
        return () => onNavigationReady?.({ focusSelected: () => undefined, frameScene: () => undefined, resetCamera: () => undefined, zoom: () => undefined });
    }, [freeCamera, invalidate, onNavigationReady, scene.id, scene.objects, selectedObjectId]);

    useEffect(() => {
        threeScene.background = new Color(scene.background);
        invalidate();
    }, [invalidate, scene.background, threeScene]);

    useEffect(() => {
        const material = renderMode === "depth" ? new MeshDepthMaterial() : renderMode === "normal" ? new MeshNormalMaterial() : renderMode === "pose" ? new MeshBasicMaterial({ color: "#ffffff", wireframe: true }) : null;
        if (renderMode === "clay") displayClayRestoreRef.current = applyClaySceneMaterials(threeScene);
        threeScene.overrideMaterial = material;
        invalidate();
        return () => {
            if (threeScene.overrideMaterial === material) threeScene.overrideMaterial = null;
            displayClayRestoreRef.current?.();
            displayClayRestoreRef.current = null;
            material?.dispose();
        };
    }, [invalidate, renderMode, scene.objects, threeScene]);

    // 透视相机（free/CAM）的宽高比随容器尺寸变化；正交相机的半范围在自己的同步 effect 里
    // 按水平/竖直跨度与 aspect 同时拟合，这里只负责两台透视相机的 aspect + 投影矩阵。
    useEffect(() => {
        const aspect = size.width / Math.max(size.height, 1);
        freeCamera.aspect = aspect;
        freeCamera.updateProjectionMatrix();
        camCamera.aspect = aspect;
        camCamera.updateProjectionMatrix();
        invalidate();
    }, [camCamera, freeCamera, invalidate, size]);

    // 唯一决定「视口活动相机是谁」的入口：只挪动 state.camera 指针，从不读写另外两台
    // 相机对象的内部状态——这是「切换模式互不污染」的保证来源。
    // CAM 无合法取景时指针指向 freeCamera，取景恢复后再指回 camCamera。
    useEffect(() => {
        const next = effectiveViewport.camera === "orthographic" ? orthoCamera : effectiveViewport.camera === "camera" ? camCamera : freeCamera;
        set({ camera: next });
        invalidate();
    }, [camCamera, effectiveViewport.camera, freeCamera, invalidate, orthoCamera, set]);

    return (
        <>
            {/* CAM 与正交轴向的取景各自独立同步到专属相机对象，互不干扰；free 完全交给
                下面的 OrbitControls，这里不对它做任何写入。 */}
            <PrevisShotCameraSync camera={camCamera} framing={camFraming} />
            <PrevisOrthoCameraSync camera={orthoCamera} framing={orthoFraming} aspect={size.width / Math.max(size.height, 1)} />
            <PrevisEnvironmentView environment={scene.environment} fallbackColor={scene.background} />
            <ambientLight intensity={scene.environmentIntensity * 0.35} />
            {scene.lights.map((light) => <PrevisLightView key={light.id} light={light} />)}
            {scene.gridVisible ? <Grid position={[0, 0, 0]} infiniteGrid fadeDistance={40} fadeStrength={5} cellSize={0.5} sectionSize={5} cellColor="#8f99a3" sectionColor="#626d77" /> : null}
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.012, 0]}>
                <planeGeometry args={[120, 120]} />
                <meshStandardMaterial color="#aeb7bf" roughness={0.92} />
            </mesh>
            {draftPath.length > 1 ? <PrevisDraftPath points={draftPath} /> : null}
            {actorMotionPaths.map((object) => <PrevisTransformPath key={`actor-path-${object.id}`} objectId={object.id} keyframes={object.keyframes} playhead={playhead} color="#61d2ad" onSelectObject={onSelectObject} />)}
            {cameraMotionPaths.map((item) => <PrevisTransformPath key={`camera-path-${item.id}`} keyframes={item.keyframes} playhead={playhead} color="#78a9ff" />)}
            {scene.objects.filter((item) => item.visible).map((object) => (
                <PrevisObjectView
                    key={object.id}
                    object={object}
                    selected={selectedObjectId === object.id}
                    selectedBone={selectedObjectId === object.id ? selectedBone : null}
                    transformMode={transformMode}
                    playhead={playhead}
                    onSelect={() => { pointerHitRef.current = true; onSelectObject(object.id); }}
                    onSelectBone={(bone) => { onSelectObject(object.id); onSelectBone(bone); }}
                    onTransforming={setTransformingState}
                    onTransform={(from, to) => onObjectTransform(object.id, from, to)}
                    onBoneTransform={(bone, rotation) => onBoneTransform(object.id, bone, rotation)}
                    onActorRigReady={(rig, animations) => onActorRigReady(object.id, rig, animations)}
                    onLoadStateChange={onLoadStateChange}
                />
            ))}
            {/* 导演视角下渲染每台摄影机，选中时显示 TransformControls；CAM 视角隐藏，避免挡住取景。 */}
            {effectiveViewport.camera === "camera" ? null : scene.cameras.map((cam) => (
                <PrevisCameraView
                    key={cam.id}
                    camera={cam}
                    selected={selectedCameraId === cam.id}
                    transformMode={transformMode}
                    onSelect={() => { pointerHitRef.current = true; onSelectCamera?.(cam.id); }}
                    onTransforming={setTransformingState}
                    onTransform={(from, to) => onCameraTransform?.(cam.id, from, to)}
                />
            ))}
            {/* 只有有效 free 回落允许环绕：drei 只在 enabled 时调 controls.update()，CAM/正交下这是
                真正的锁定，不会有 controls 每帧把相机拽回自己 target 的回写竞争。
                camera 显式绑定 freeCamera：即使 state.camera 当前指向别的相机，也绝不会
                被这份环绕状态误伤。CAM 取景失败时 orbit 打开，用已有的自由视角，不改场景。 */}
            <OrbitControls
                ref={orbitRef}
                makeDefault
                camera={freeCamera}
                enabled={!transforming && effectiveViewport.orbit}
                target={PREVIS_FREE_ORBIT_TARGET}
                minDistance={0.6}
                maxDistance={80}
                enableDamping
                dampingFactor={0.08}
                rotateSpeed={0.7}
                panSpeed={0.85}
                zoomSpeed={0.85}
                screenSpacePanning
                mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }}
                touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
            />
        </>
    );
}

function PrevisEnvironmentView({ environment, fallbackColor }: { environment?: PrevisEnvironment; fallbackColor: string }) {
    const { scene } = useThree();
    const textureRef = useRef<Texture | null>(null);
    useEffect(() => {
        scene.background = new Color(fallbackColor);
        const activeEnvironment = environment;
        const url = activeEnvironment?.mode === "panorama" ? activeEnvironment.url : undefined;
        if (!url) return;
        const loader = new TextureLoader();
        let disposed = false;
        loader.load(url, (texture) => {
            if (disposed) { texture.dispose(); return; }
            texture.colorSpace = SRGBColorSpace;
            texture.mapping = EquirectangularReflectionMapping;
            texture.center.set(0.5, 0.5);
            texture.rotation = activeEnvironment?.rotationY || 0;
            textureRef.current = texture;
            scene.background = texture;
        }, undefined, () => {
            if (!disposed) scene.background = new Color(fallbackColor);
        });
        return () => {
            disposed = true;
            if (scene.background === textureRef.current) scene.background = new Color(fallbackColor);
            textureRef.current?.dispose();
            textureRef.current = null;
        };
    }, [environment?.mode, environment?.rotationY, environment?.url, fallbackColor, scene]);
    return null;
}

/** 起点、终点、路径点、方向与当前进度共用一条 Transform 关键帧路径。 */
function PrevisTransformPath({ objectId, keyframes, playhead, color, onSelectObject }: { objectId?: string; keyframes: PrevisObject["keyframes"]; playhead: number; color: string; onSelectObject?: (id: string) => void }) {
    const sorted = useMemo(() => finitePrevisTransformKeyframes(keyframes).toSorted((left, right) => left.time - right.time), [keyframes]);
    const points = useMemo(() => sorted.map((keyframe) => keyframe.transform.position), [sorted]);
    const current = interpolatePrevisTransform(sorted[0].transform, sorted, playhead).position;
    const previous = points[points.length - 2];
    const end = points[points.length - 1];
    const direction = useMemo(() => {
        const vector = new Vector3(...end).sub(new Vector3(...previous));
        if (vector.lengthSq() < 1e-8) return [0, 0, 0, 1] as PrevisQuat;
        return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), vector.normalize()).toArray() as PrevisQuat;
    }, [end, previous]);

    return <group>
        <Line points={points} color={color} lineWidth={2} />
        {points.map((point, index) => <mesh key={`${index}-${point.join("-")}`} position={point} onPointerDown={(event) => { if (!objectId || !onSelectObject) return; event.stopPropagation(); onSelectObject(objectId); }}><sphereGeometry args={[index === 0 || index === points.length - 1 ? 0.11 : 0.075, 10, 8]} /><meshBasicMaterial color={index === 0 ? "#61d2ad" : index === points.length - 1 ? "#f08b6a" : color} /></mesh>)}
        <mesh position={end} quaternion={direction}>
            <coneGeometry args={[0.1, 0.28, 10]} />
            <meshBasicMaterial color={color} />
        </mesh>
        <mesh position={current}>
            <sphereGeometry args={[0.14, 12, 8]} />
            <meshBasicMaterial color="#f0d36a" />
        </mesh>
    </group>;
}

function PrevisDraftPath({ points }: { points: PrevisVec3[] }) {
    return <group>
        <Line points={points} color="#f0d36a" lineWidth={3} dashed dashSize={0.16} gapSize={0.08} />
        <mesh position={points[0]}>
            <sphereGeometry args={[0.13, 12, 8]} />
            <meshBasicMaterial color="#61d2ad" />
        </mesh>
        <mesh position={points[points.length - 1]}>
            <sphereGeometry args={[0.15, 12, 8]} />
            <meshBasicMaterial color="#f0d36a" />
        </mesh>
    </group>;
}

/**
 * CAM 取景：把 shot 摄影机的解算结果写进专属的机位相机对象。
 *
 * 这台相机独立持有，不是共享的视口默认相机：离开 CAM 模式后不需要任何快照/还原——
 * 没有人会在其他模式下碰它，回到 CAM 时上一次写入的状态原样还在，物理上不可能被污染。
 *
 * 只写这台相机对象，绝不触碰 PrevisScene：换一只眼睛看场景不是内容改动，
 * 因此不产生任何 undo/history 记录，也不会触发保存。
 */
function PrevisShotCameraSync({ camera, framing }: { camera: PerspectiveCamera; framing: PrevisViewFraming | null }) {
    const invalidate = useThree((state) => state.invalidate);
    const framingKey = previsViewFramingKey(framing);
    useEffect(() => {
        if (!framing) return;
        // up 必须先写：lookAt 用当前 camera.up 解基向量，顺序颠倒会丢掉荷兰角。
        camera.up.set(...framing.up);
        camera.position.set(...framing.position);
        camera.fov = framing.fov;
        camera.near = framing.near;
        camera.far = framing.far;
        camera.lookAt(...framing.target);
        camera.updateProjectionMatrix();
        invalidate();
        // framing 只通过 framingKey 参与依赖：草稿对象身份变化不触发无谓回写。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [framingKey, invalidate, camera]);
    return null;
}

/**
 * 正交轴向取景：把包围盒解算结果写进专属的正交相机对象，语义与 PrevisShotCameraSync
 * 完全对称——独立持有、无需快照还原、绝不碰 PrevisScene。
 *
 * 水平/竖直跨度由领域层给出；视口只传入运行时 aspect，半范围换算走
 * resolvePrevisOrthographicFrustum，同时装下两条轴，避免宽内容被裁切。
 */
function PrevisOrthoCameraSync({ camera, framing, aspect }: { camera: OrthographicCamera; framing: PrevisOrthographicFraming | null; aspect: number }) {
    const invalidate = useThree((state) => state.invalidate);
    const framingKey = framing ? [...framing.position, ...framing.target, ...framing.up, framing.horizontalSpan, framing.verticalSpan, framing.near, framing.far].map((value) => value.toFixed(4)).join("|") : "";
    useEffect(() => {
        if (!framing) return;
        const frustum = resolvePrevisOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect });
        camera.up.set(...framing.up);
        camera.position.set(...framing.position);
        camera.left = frustum.left;
        camera.right = frustum.right;
        camera.top = frustum.top;
        camera.bottom = frustum.bottom;
        camera.near = framing.near;
        camera.far = framing.far;
        camera.lookAt(...framing.target);
        camera.updateProjectionMatrix();
        invalidate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [framingKey, aspect, invalidate, camera]);
    return null;
}

function PrevisObjectView({ object, selected, selectedBone, transformMode, playhead, onSelect, onSelectBone, onTransforming, onTransform, onBoneTransform, onActorRigReady, onLoadStateChange }: { object: PrevisObject; selected: boolean; selectedBone: string | null; transformMode: PrevisViewportProps["transformMode"]; playhead: number; onSelect: () => void; onSelectBone: (bone: string | null) => void; onTransforming: (value: boolean) => void; onTransform: (from: PrevisTransform, to: PrevisTransform) => void; onBoneTransform: (bone: string, rotation: PrevisQuat) => void; onActorRigReady: (rig: PrevisRig, animations: AnimationClip[]) => void; onLoadStateChange: (id: string, signal: PrevisLoadSignal, retry: () => void) => void }) {
    const [target, setTarget] = useState<Group | null>(null);
    const { camera, gl, invalidate } = useThree();
    const resolved = interpolatePrevisTransform(object.transform, object.keyframes, playhead);
    // 手势进行中冻结声明式 transform，交由触摸拖动更新；终态后再由场景状态接管。
    const [frozen, setFrozen] = useState<PrevisTransform | null>(null);
    const transform = frozen || resolved;
    const groundPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
    const raycaster = useMemo(() => new Raycaster(), []);
    const ndc = useMemo(() => new Vector2(), []);
    const hit = useMemo(() => new Vector3(), []);
    const dragRef = useRef<{ pointerId: number; startGround: Vector3; from: PrevisTransform; to: PrevisTransform; moved: boolean } | null>(null);
    const onTransformRef = useRef(onTransform);
    const onTransformingRef = useRef(onTransforming);
    onTransformRef.current = onTransform;
    onTransformingRef.current = onTransforming;

    const resolveGroundPoint = useCallback((event: PointerEvent) => {
        const bounds = gl.domElement.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return null;
        ndc.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
        return finitePrevisGroundPoint(hit.x, hit.z);
    }, [camera, gl, groundPlane, hit, ndc, raycaster]);

    const releasePointerCapture = useCallback((pointerId: number) => {
        const canvas = gl.domElement;
        if (!canvas.hasPointerCapture(pointerId)) return;
        try { canvas.releasePointerCapture(pointerId); } catch { /* pointer capture may already be gone */ }
    }, [gl]);

    const capturePointer = useCallback((pointerId: number) => {
        try { gl.domElement.setPointerCapture(pointerId); } catch { /* browser may reject a stale pointer */ }
    }, [gl]);

    const finishDirectDrag = useCallback((pointerId: number, cancel = false) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== pointerId) return;
        dragRef.current = null;
        releasePointerCapture(pointerId);
        onTransformingRef.current(false);
        if (!cancel && drag.moved) onTransformRef.current(drag.from, drag.to);
        setFrozen(null);
    }, [releasePointerCapture]);

    // 命中对象后由视口级 Pointer Events 接管整段拖动，指针离开模型仍能持续更新。
    useEffect(() => {
        const onPointerMove = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.preventDefault();
            const point = resolveGroundPoint(event);
            if (!point) return;
            const next: PrevisTransform = {
                ...drag.from,
                position: [drag.from.position[0] + point.x - drag.startGround.x, drag.from.position[1], drag.from.position[2] + point.z - drag.startGround.z],
            };
            drag.to = next;
            drag.moved = drag.moved || Math.hypot(point.x - drag.startGround.x, point.z - drag.startGround.z) > 0.01;
            setFrozen(next);
            invalidate();
        };
        const onPointerUp = (event: PointerEvent) => finishDirectDrag(event.pointerId);
        const onPointerCancel = (event: PointerEvent) => finishDirectDrag(event.pointerId, true);
        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerCancel);
            if (dragRef.current) finishDirectDrag(dragRef.current.pointerId, true);
        };
    }, [finishDirectDrag, invalidate, resolveGroundPoint]);

    return (
        <>
            <group
                ref={setTarget}
                position={transform.position}
                rotation={transform.rotation}
                scale={transform.scale}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelect();
                    // 白膜对象摆位接受主鼠标或触摸指针；点击对象仍然会选中对象。
                    const nativeEvent = event.nativeEvent;
                    if (nativeEvent.isPrimary === false || nativeEvent.button !== 0 || transformMode !== "translate") return;
                    nativeEvent.preventDefault();
                    const startGround = event.ray.intersectPlane(groundPlane, new Vector3());
                    if (!startGround) return;
                    const from = target ? readObject3DTransform(target) : readObject3DTransform(event.object.parent || event.object);
                    dragRef.current = { pointerId: nativeEvent.pointerId, startGround: startGround.clone(), from, to: from, moved: false };
                    capturePointer(nativeEvent.pointerId);
                    setFrozen(from);
                    onTransforming(true);
                }}
            >
                <PrevisObjectVisual object={object} selected={selected} selectedBone={selectedBone} playhead={playhead} onSelectBone={onSelectBone} onBoneTransform={onBoneTransform} onActorRigReady={onActorRigReady} onLoadStateChange={onLoadStateChange} />
            </group>
            {selected && target ? (
                <PrevisObjectGizmo
                    target={target}
                    transformMode={transformMode}
                    onFreeze={setFrozen}
                    onTransforming={onTransforming}
                    onTransform={onTransform}
                />
            ) : null}
        </>
    );
}

const PREVIS_CAMERA_ACCENTS = ["#5eead4", "#78a9ff", "#f6c667", "#ec8db7", "#a98bff", "#ff9b72"] as const;

function resolvePrevisCameraPalette(camera: PrevisCamera) {
    const seed = `${camera.id}:${camera.name}`;
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    const accentHex = PREVIS_CAMERA_ACCENTS[hash % PREVIS_CAMERA_ACCENTS.length];
    const accent = new Color(accentHex);
    return {
        accent,
        accentHex,
        bright: accent.clone().offsetHSL(0, 0.04, 0.14),
        deep: accent.clone().offsetHSL(0, -0.05, -0.24),
        tint: accent.clone().offsetHSL(0, -0.04, 0.25),
    };
}

/**
 * 场景内摄影机标记：导演视角中每台摄影机都保持可见；点击任意机位即可选中并调节位置、旋转或缩放。
 * 视觉上用分层的机身、镜头、取景器和热靴替代普通方盒，但交互仍由同一个 group/gizmo 承担。
 */
function PrevisCameraView({ camera, selected, transformMode, onSelect, onTransforming, onTransform }: {
    camera: PrevisCamera;
    selected: boolean;
    transformMode: PrevisViewportProps["transformMode"];
    onSelect: () => void;
    onTransforming: (active: boolean) => void;
    onTransform: (from: PrevisTransform, to: PrevisTransform) => void;
}) {
    const [target, setTarget] = useState<Group | null>(null);
    const [frozen, setFrozen] = useState<PrevisTransform | null>(null);
    const invalidate = useThree((state) => state.invalidate);

    useEffect(() => {
        // frozen != null 时 TransformControls 正在拖动，不覆盖 group 的实时位置
        if (frozen !== null || !target) return;
        const [x, y, z] = camera.transform.position;
        target.position.set(x, y, z);
        // CAM 取景看向 camera.target，机位模型也必须朝向同一点，否则画面与模型方向不一致。
        const eye = new Vector3(x, y, z);
        const look = new Vector3(...camera.target);
        if (look.distanceToSquared(eye) > 1e-6) target.quaternion.setFromRotationMatrix(new Matrix4().lookAt(eye, look, new Vector3(0, 1, 0)));
        else target.rotation.set(...(camera.transform.rotation as [number, number, number]));
        target.scale.set(1, 1, 1);
        target.updateMatrixWorld(true);
        invalidate();
    }, [camera.target, camera.transform, frozen, invalidate, target]);

    const frustumLines = useMemo(() => {
        const fovRad = (camera.fov * Math.PI) / 180;
        const dist = 2.15;
        const h = Math.tan(fovRad / 2) * dist;
        const w = h * 1.78;
        const origin: [number, number, number] = [0, 0.2, -0.2];
        const corners: [number, number, number][] = [
            [w, 0.2 + h, -0.2 - dist], [-w, 0.2 + h, -0.2 - dist], [-w, 0.2 - h, -0.2 - dist], [w, 0.2 - h, -0.2 - dist],
        ];
        const rays = corners.map((corner) => [origin, corner] as [[number, number, number], [number, number, number]]);
        const farRect = [corners[0], corners[1], corners[1], corners[2], corners[2], corners[3], corners[3], corners[0]] as [number, number, number][];
        return { rays, farRect };
    }, [camera.fov]);

    const palette = useMemo(() => resolvePrevisCameraPalette(camera), [camera.id, camera.name]);
    const label = camera.name.trim() || "摄影机";
    const lineColor = selected ? palette.bright : palette.accent;
    const bodyColor = selected ? "#1f3343" : "#182534";
    const bodyEdgeColor = selected ? palette.bright : "#3d5064";
    const lensColor = selected ? "#111e2b" : "#0f1824";
    const lineOpacity = selected ? 0.94 : 0.38;

    return (
        <>
            <group ref={setTarget} onPointerDown={(event) => { event.stopPropagation(); onSelect(); }}>
                {selected ? (
                    <mesh position={[0, 0.2, 0.02]}>
                        <sphereGeometry args={[0.52, 20, 14]} />
                        <meshBasicMaterial color={palette.accent} transparent opacity={0.08} depthWrite={false} />
                    </mesh>
                ) : null}
                <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[0.68, 0.38, 0.5]} />
                    <meshStandardMaterial color={bodyColor} roughness={0.28} metalness={0.48} />
                </mesh>
                <mesh position={[0, 0.2, -0.256]}>
                    <boxGeometry args={[0.47, 0.25, 0.018]} />
                    <meshStandardMaterial color={palette.deep} roughness={0.3} metalness={0.54} />
                </mesh>
                <mesh position={[-0.3, 0.2, 0.04]}>
                    <boxGeometry args={[0.035, 0.29, 0.3]} />
                    <meshStandardMaterial color={palette.accent} roughness={0.26} metalness={0.5} />
                </mesh>
                <mesh position={[0.31, 0.2, 0.03]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.056, 0.056, 0.03, 20]} />
                    <meshStandardMaterial color={palette.bright} roughness={0.24} metalness={0.68} />
                </mesh>
                <mesh position={[0, 0.2, -0.37]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                    <cylinderGeometry args={[0.16, 0.145, 0.2, 32]} />
                    <meshStandardMaterial color={lensColor} roughness={0.18} metalness={0.72} />
                </mesh>
                <mesh position={[0, 0.2, -0.475]}>
                    <torusGeometry args={[0.145, 0.024, 12, 36]} />
                    <meshStandardMaterial color={bodyEdgeColor} roughness={0.2} metalness={0.76} />
                </mesh>
                <mesh position={[0, 0.2, -0.494]}>
                    <circleGeometry args={[0.109, 32]} />
                    <meshPhysicalMaterial color={palette.tint} roughness={0.12} metalness={0.22} clearcoat={1} clearcoatRoughness={0.08} transparent opacity={0.94} />
                </mesh>
                <mesh position={[0, 0.2, -0.498]}>
                    <ringGeometry args={[0.071, 0.097, 32]} />
                    <meshBasicMaterial color={palette.bright} transparent opacity={selected ? 0.86 : 0.58} />
                </mesh>
                <mesh position={[-0.035, 0.242, -0.501]}>
                    <circleGeometry args={[0.019, 16]} />
                    <meshBasicMaterial color="#ecffff" transparent opacity={selected ? 0.8 : 0.5} />
                </mesh>
                <mesh position={[0, 0.5, 0.02]} castShadow>
                    <boxGeometry args={[0.44, 0.075, 0.16]} />
                    <meshStandardMaterial color={bodyEdgeColor} roughness={0.26} metalness={0.54} />
                </mesh>
                <mesh position={[-0.17, 0.39, 0.02]} castShadow>
                    <boxGeometry args={[0.06, 0.27, 0.12]} />
                    <meshStandardMaterial color={bodyEdgeColor} roughness={0.32} metalness={0.46} />
                </mesh>
                <mesh position={[0.17, 0.39, 0.02]} castShadow>
                    <boxGeometry args={[0.06, 0.27, 0.12]} />
                    <meshStandardMaterial color={bodyEdgeColor} roughness={0.32} metalness={0.46} />
                </mesh>
                <mesh position={[0, 0.536, 0.02]}>
                    <boxGeometry args={[0.28, 0.018, 0.17]} />
                    <meshBasicMaterial color={palette.accent} transparent opacity={selected ? 0.98 : 0.78} />
                </mesh>
                <mesh position={[0.15, 0.405, 0.12]} rotation={[0.12, 0.1, 0]} castShadow>
                    <boxGeometry args={[0.15, 0.13, 0.17]} />
                    <meshStandardMaterial color="#101b28" roughness={0.2} metalness={0.58} />
                </mesh>
                <mesh position={[0, -0.035, 0.04]} castShadow>
                    <cylinderGeometry args={[0.064, 0.08, 0.17, 20]} />
                    <meshStandardMaterial color={bodyEdgeColor} roughness={0.34} metalness={0.5} />
                </mesh>
                <mesh position={[0, -0.14, 0.04]} castShadow>
                    <boxGeometry args={[0.29, 0.06, 0.22]} />
                    <meshStandardMaterial color="#101a27" roughness={0.38} metalness={0.54} />
                </mesh>
                {frustumLines.rays.map((pair, index) => (
                    <Line key={`ray-${index}`} points={pair} color={lineColor} lineWidth={selected ? 2 : 1.2} transparent opacity={lineOpacity} />
                ))}
                <Line points={frustumLines.farRect} color={lineColor} lineWidth={selected ? 2 : 1.2} transparent opacity={lineOpacity} />
                <Line points={[[0, 0.2, 0], [0, 0.7, 0]]} color={lineColor} lineWidth={selected ? 2 : 1.2} transparent opacity={selected ? 0.85 : 0.46} />
                <Html center position={[0, 0.98, 0]} zIndexRange={[12, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
                    <div style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        maxWidth: 160,
                        padding: "4px 8px",
                        border: `1px solid ${palette.accentHex}40`,
                        borderRadius: 6,
                        background: "var(--pd-s1)",
                        boxShadow: "var(--pd-shadow-raised)",
                        color: "var(--pd-t0)",
                        fontFamily: "inherit",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.02em",
                        lineHeight: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        opacity: selected ? 1 : 0.75,
                        transform: selected ? "scale(1)" : "scale(0.95)",
                        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}>
                        <span style={{ width: 4, height: 4, flex: "0 0 auto", borderRadius: "50%", background: palette.accentHex, boxShadow: selected ? `0 0 6px ${palette.accentHex}` : "none" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
                    </div>
                </Html>
            </group>
            {selected && target ? (
                <PrevisObjectGizmo
                    target={target}
                    transformMode={transformMode === "scale" ? "translate" : transformMode}
                    onFreeze={setFrozen}
                    onTransforming={onTransforming}
                    onTransform={onTransform}
                />
            ) : null}
        </>
    );
}

function PrevisObjectGizmo({ target, transformMode, onFreeze, onTransforming, onTransform }: { target: Group; transformMode: PrevisViewportProps["transformMode"]; onFreeze: (transform: PrevisTransform | null) => void; onTransforming: (value: boolean) => void; onTransform: (from: PrevisTransform, to: PrevisTransform) => void }) {
    const transaction = usePrevisGizmoTransaction<PrevisTransform>({
        read: () => readObject3DTransform(target),
        restore: (snapshot) => applyObject3DTransform(target, snapshot),
        commit: onTransform,
        onActive: (active, snapshot) => {
            onFreeze(active ? snapshot : null);
            onTransforming(active);
        },
    });
    return (
        <TransformControls
            object={target}
            mode={transformMode}
            size={0.8}
            onMouseDown={() => transaction.begin()}
            onMouseUp={() => transaction.end("commit")}
        />
    );
}

/**
 * gizmo 事务的统一接线：对象与骨骼共用，避免两套实现产生偏差。
 * 监听在挂载期间常驻安装（不以「当前是否有手势」为安装条件），
 * 非活跃时 end 自身是空操作。
 */
function usePrevisGizmoTransaction<TSnapshot>({ read, restore, commit, onActive }: { read: () => TSnapshot | null; restore: (snapshot: TSnapshot) => void; commit: (from: TSnapshot, to: TSnapshot) => void; onActive: (active: boolean, snapshot: TSnapshot | null) => void }) {
    const hooksRef = useRef({ read, restore, commit, onActive });
    useEffect(() => { hooksRef.current = { read, restore, commit, onActive }; }, [commit, onActive, read, restore]);

    const transaction = useMemo(() => createPrevisTransaction<TSnapshot>({
        read: () => hooksRef.current.read(),
        restore: (snapshot) => hooksRef.current.restore(snapshot),
        commit: (from, to) => hooksRef.current.commit(from, to),
        setActive: (active) => hooksRef.current.onActive(active, active ? hooksRef.current.read() : null),
        // stdlib 在 domElement.ownerDocument 上注册 pointerup，其 pointerUp({button:0})
        // 会 dispatch mouseUp 后清 dragging=false / axis=null。因此用真实事件走它自己的
        // 收尾通道，而不是写它的私有字段（.d.ts 中 dragging/axis 均为 private）。
        terminateDrag: () => document.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true })),
    }), []);

    useEffect(() => installPrevisTerminalListeners(transaction, {
        window,
        document,
        isHidden: () => document.visibilityState === "hidden",
    }), [transaction]);

    // 取消选中、删除对象、切换模型或卸载都必须回到快照并释放 transforming。
    useEffect(() => () => transaction.end("cancel"), [transaction]);

    return transaction;
}

function readObject3DTransform(target: Object3D): PrevisTransform {
    return { position: target.position.toArray() as PrevisVec3, rotation: [target.rotation.x, target.rotation.y, target.rotation.z], scale: target.scale.toArray() as PrevisVec3 };
}

function applyObject3DTransform(target: Object3D, transform: PrevisTransform) {
    target.position.set(...transform.position);
    target.rotation.set(...transform.rotation);
    target.scale.set(...transform.scale);
    target.updateMatrixWorld(true);
}

function PrevisObjectVisual({ object, selected, selectedBone, playhead, onSelectBone, onBoneTransform, onActorRigReady, onLoadStateChange }: { object: PrevisObject; selected: boolean; selectedBone: string | null; playhead: number; onSelectBone: (bone: string | null) => void; onBoneTransform: (bone: string, rotation: PrevisQuat) => void; onActorRigReady: (rig: PrevisRig, animations: AnimationClip[]) => void; onLoadStateChange: (id: string, signal: PrevisLoadSignal, retry: () => void) => void }) {
    const actorColor = resolvePrevisActorColor(object.color);
if (object.kind === "actor" && object.url === PREVIS_DEFAULT_ACTOR_URL && !object.assetId) return <PrevisClayActor archetype={object.archetype || "adult"} actorProfile={object.actorProfile} color={actorColor} pose={object.pose || "stand"} boneOverrides={object.boneOverrides} selected={selected} />;
    if ((object.kind === "model" || object.kind === "actor" || object.primitive === "character") && (object.url || object.primitive === "character")) return <PrevisModel object={object} selected={selected} selectedBone={selectedBone} playhead={playhead} onSelectBone={onSelectBone} onBoneTransform={onBoneTransform} onActorRigReady={onActorRigReady} onLoadStateChange={onLoadStateChange} />;
    if (object.kind === "billboard" && object.url) return <PrevisBillboard object={object} selected={selected} />;
    const material = <meshStandardMaterial color={selected ? "#ffcc00" : object.color} roughness={0.68} metalness={0.05} emissive={selected ? "#ffaa00" : "#000000"} emissiveIntensity={selected ? 0.4 : 0} />;
    return (
        <mesh castShadow={object.castShadow} receiveShadow={object.receiveShadow}>
            {object.primitive === "sphere" ? <sphereGeometry args={[0.6, 32, 24]} /> : object.primitive === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1.2, 32]} /> : object.primitive === "plane" ? <planeGeometry args={[1.6, 1]} /> : <boxGeometry args={[1, 1, 1]} />}
            {material}
        </mesh>
    );
}

function PrevisModel({ object, selected, selectedBone, playhead, onSelectBone, onBoneTransform, onActorRigReady, onLoadStateChange }: { object: PrevisObject; selected: boolean; selectedBone: string | null; playhead: number; onSelectBone: (bone: string | null) => void; onBoneTransform: (bone: string, rotation: PrevisQuat) => void; onActorRigReady: (rig: PrevisRig, animations: AnimationClip[]) => void; onLoadStateChange: (id: string, signal: PrevisLoadSignal, retry: () => void) => void }) {
    const actorColor = resolvePrevisActorColor(object.color);
    const [load, dispatchLoad] = useReducer(reducePrevisLoad, previsLoadInitial);
    const loadRef = useRef(load);
    loadRef.current = load;
    const loadGeneration = load.generation;
    const modelUrl = object.kind === "actor" || object.primitive === "character" ? PREVIS_DEFAULT_ACTOR_URL : object.url;
    // 展示身份 = generation + 解析输入。render 阶段用它屏蔽旧资源，
    // 因此 prop/retry 变化的第一次 render 就已卸下上一代 model，随后 cleanup 才 dispose。
    const identity = previsLoadIdentity({ generation: loadGeneration, url: modelUrl, storageKey: object.storageKey, kind: object.kind });
    type LoadedModel = { model: Object3D; rig: PrevisRig; animations: AnimationClip[]; restRotations: Partial<Record<PrevisHumanoidBone, PrevisQuat>> };
    const [loaded, setLoaded] = useState<{ identity: string; value: LoadedModel } | null>(null);
    const display = resolvePrevisDisplay(loaded, identity);
    const model = display?.model ?? null;
    const rig = display?.rig ?? null;
    const animations = display?.animations ?? emptyAnimations;
    const restRotations = display?.restRotations ?? emptyRestRotations;
    const setLoadPhase = useCallback((phase: "loading" | "ready" | "error") => {
        if (phase === "loading") dispatchLoad({ type: "start" });
        else dispatchLoad({ type: phase === "ready" ? "loaded" : "failed", generation: loadRef.current.generation });
    }, []);
    const mixerRef = useRef<AnimationMixer | null>(null);
    const ownedRef = useRef<{ model: Object3D | null; mixer: AnimationMixer | null }>({ model: null, mixer: null });
    const onActorRigReadyRef = useRef(onActorRigReady);
    const invalidate = useThree((state) => state.invalidate);
    // helper 只跟随「当前 identity 下真正要展示的 model」，不会挂在已卸下的旧 model 上。
    const helper = useMemo(() => model ? new SkeletonHelper(model) : null, [model]);
    useEffect(() => () => disposePrevisHelper(helper), [helper]);

    // 把 loading/error/ready 报到 DOM 层，Canvas 内部无法呈现可操作提示。
    // 依赖必须收敛到稳定原始值：object 每次场景编辑都是新引用，
    // 若挂在 [object] 上会让下面的注销 effect 每次编辑都误报 unmounted，
    // 失败模型的重试入口会随之消失。
    const objectId = object.id;
    const objectKind = previsDiagnosticObjectKind(object);
    const retryLoad = useCallback(() => {
        recordPrevisDiagnostic("PREVIS_MODEL_LOAD_RETRY", { objectId, objectKind, attempt: loadRef.current.generation, userInitiated: true });
        dispatchLoad({ type: "retry" });
    }, [objectId, objectKind]);
    const onLoadStateChangeRef = useRef(onLoadStateChange);
    useEffect(() => { onLoadStateChangeRef.current = onLoadStateChange; }, [onLoadStateChange]);
    useEffect(() => {
        onLoadStateChangeRef.current(object.id, load.phase, retryLoad);
    }, [load.phase, object.id, retryLoad]);

    // 卸载（删除、隐藏分支、换 URL/kind、Canvas 重建）必须注销自己，避免通知残留陈旧条目。
    // 单独 effect 且只依赖 id：phase 变化不会反复注销重登。
    useEffect(() => () => onLoadStateChangeRef.current(object.id, "unmounted", retryLoad), [object.id, retryLoad]);
    const selectedBoneObject = selectedBone && rig?.boneMap[selectedBone as PrevisHumanoidBone] ? model?.getObjectByName(rig.boneMap[selectedBone as PrevisHumanoidBone]!) : null;
    const motion = object.motionClips?.find((item) => item.id === object.activeMotionClipId);
    const activeAnimation = motion ? animations.find((item) => item.name === motion.sourceAnimation) : undefined;
    const handleModelPointerDown = useCallback((event: ThreeEvent<PointerEvent>) => {
        if (!selected || !rig) return;
        let nearestBone: string | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        Object.entries(rig.boneMap).forEach(([bone, name]) => {
            if (!name) return;
            const target = model?.getObjectByName(name);
            if (!target) return;
            const distance = event.ray.distanceSqToPoint(target.getWorldPosition(new Vector3()));
            if (distance <= 0.12 ** 2 && distance < nearestDistance) {
                nearestBone = bone;
                nearestDistance = distance;
            }
        });
        if (!nearestBone) return;
        // 模型表面可能先于关节控制球被射线命中，用最近骨骼保证点击仍可选中。
        event.stopPropagation();
        onSelectBone(nearestBone);
    }, [model, onSelectBone, rig, selected]);

    useEffect(() => { onActorRigReadyRef.current = onActorRigReady; }, [onActorRigReady]);

    useEffect(() => {
        const generation = loadRef.current.generation;
        let active = true;
        // render 阶段已由 identity 屏蔽旧资源；这里再清一次作为防御，不作为安全性依据。
        setLoaded(null);
        setLoadPhase("loading");
        const failLoad = () => {
            if (!active || generation !== loadRef.current.generation) return;
            // 只记录稳定码与安全枚举：URL / storageKey / 原始 error 都不落日志。
            recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectId: object.id, objectKind: previsDiagnosticObjectKind(object), attempt: generation });
            setLoadPhase("error");
        };
        const loader = new GLTFLoader();
        void resolveMediaUrl(object.storageKey, modelUrl)
            .then((url) => {
                // 解析完成时已失效：不再发起无意义的网络加载。
                if (!active || generation !== loadRef.current.generation) return;
                loader.load(
                    url,
                    (gltf) => {
                        const ownership = resolvePrevisLoadOwnership({ active, generation, currentGeneration: loadRef.current.generation });
                        if (!ownership.adopt) {
                            // 未被采纳的晚到 source 必须释放，否则孤儿泄漏。
                            if (ownership.disposeSource) disposePrevisObject3D(gltf.scene);
                            return;
                        }
                        // 采纳流程整体包裹：clone / normalize / rig 推断 / 材质替换 / mixer /
                        // setLoaded / onActorRigReady 任一步抛错都不得逃出，也不得留下半采纳资源。
                        let clone: Object3D | null = null;
                        let mixer: AnimationMixer | null = null;
                        try {
                            // clone 与 source 共享 geometry/material/texture。
                            // 采纳后 source 的 Object3D 层级可被 GC，共享 GPU 资源由 owned clone 持有，
                            // 最终只在 clone 的 cleanup 里释放一次；这里绝不 dispose source。
                            clone = SkeletonUtils.clone(gltf.scene);
                            normalizeModel(clone, object.castShadow, object.receiveShadow);
                            const nextRig = inferPrevisRig(
                                clone,
                                gltf.animations.map((clip) => clip.name),
                            );
                            if (object.kind === "actor" || object.primitive === "character") applyActorReferenceMaterial(clone, actorColor);
                            mixer = new AnimationMixer(clone);
                            mixerRef.current = mixer;
                            ownedRef.current = { model: clone, mixer };
                            // 一次性写入带 identity 的展示记录，避免 model/rig/animations 之间出现中间态。
                            setLoaded({
                                identity,
                                value: { model: clone, rig: nextRig, animations: gltf.animations, restRotations: readRigRestRotations(clone, nextRig) },
                            });
                            setLoadPhase("ready");
                            onActorRigReadyRef.current(nextRig, gltf.animations);
                        } catch {
                            // 只记录稳定错误码：原始 error / URL / 素材正文都不落日志。
                            recordPrevisDiagnostic("PREVIS_MODEL_ADOPT_FAILED", { objectId: object.id, objectKind: previsDiagnosticObjectKind(object) });
                            // 先摘掉 owned 记录，避免 effect cleanup 二次释放同一批资源。
                            ownedRef.current = { model: null, mixer: null };
                            mixerRef.current = null;
                            setLoaded(null);
                            disposePrevisAdoptionFailure({ clone, mixer, source: gltf.scene });
                            // 回到既有 error/retry/占位人偶路径。
                            failLoad();
                        }
                    },
                    undefined,
                    failLoad,
                );
            })
            // 地址解析失败与 GLTFLoader onError 走同一条 error/retry 通道。
            .catch(failLoad);
        return () => {
            active = false;
            // 替换/重试/卸载：释放本 generation 拥有的 clone 与 mixer（共享资源随之恰好释放一次）。
            const owned = ownedRef.current;
            ownedRef.current = { model: null, mixer: null };
            mixerRef.current = null;
            disposePrevisModelResources({ model: owned.model, mixer: owned.mixer });
        };
    }, [identity, modelUrl, object.storageKey]);

    useEffect(() => {
        if (!model) return;
        model.traverse((child) => {
            const mesh = child as Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = object.castShadow;
            mesh.receiveShadow = object.receiveShadow;
        });
        invalidate();
    }, [invalidate, model, object.castShadow, object.receiveShadow]);

    useEffect(() => {
        if (!model || (object.kind !== "actor" && object.primitive !== "character")) return;
        updateActorReferenceColor(model, actorColor);
        invalidate();
    }, [invalidate, model, object.color, object.kind]);

    useEffect(() => {
        if (!model || !mixerRef.current) return;
        const mixer = mixerRef.current;
        mixer.stopAllAction();
        if (!activeAnimation) return;
        mixer.clipAction(activeAnimation).setLoop(motion?.loop ? LoopRepeat : LoopOnce, motion?.loop ? Infinity : 1).play();
        return () => {
            mixer.stopAllAction();
        };
    }, [activeAnimation, model, motion?.loop]);

    useEffect(() => {
        if (!model || !mixerRef.current) return;
        if (activeAnimation && motion) {
            const localTime = Math.max(0, playhead - motion.start) * motion.playbackRate;
            const clipDuration = motion.duration || activeAnimation.duration;
            mixerRef.current.setTime(motion.loop && clipDuration > 0 ? localTime % clipDuration : localTime);
        }
        applyPrevisBoneTracks(model, object, playhead, rig, restRotations, Boolean(activeAnimation && motion));
        helper?.updateMatrixWorld(true);
        invalidate();
    }, [activeAnimation, helper, invalidate, model, motion, object.boneOverrides, object.boneTracks, object.pose, playhead, restRotations, rig]);

    useFrame(() => {
        if (selectedBoneObject && selected) selectedBoneObject.updateMatrixWorld(true);
    });

    if (!model) return <PrevisClayActor archetype={object.archetype || "adult"} actorProfile={object.actorProfile} color={actorColor} pose={object.pose || "stand"} boneOverrides={object.boneOverrides} selected={selected} />;
    return <group onPointerDown={handleModelPointerDown}>
        <primitive object={model} />
        {selected && selectedBone && helper ? <primitive object={helper} /> : null}
        {selected && rig ? Object.entries(rig.boneMap).filter(([, name]) => Boolean(name)).map(([bone, name]) => {
            const fingerGroup = previsFingerGroup(bone);
            const selectedFingerGroup = previsFingerGroup(selectedBone);
            return <BoneController key={bone} bone={model.getObjectByName(name!)} selected={selectedBone === bone} dimmed={Boolean(fingerGroup && selectedFingerGroup && fingerGroup !== selectedFingerGroup)} onSelect={() => onSelectBone(bone)} />;
        }) : null}
        {selected && selectedBoneObject && selectedBone ? <PrevisBoneGizmo bone={selectedBoneObject} onCommit={(rotation) => onBoneTransform(selectedBone, rotation)} /> : null}
    </group>;
}

/** 骨骼 gizmo 与对象 gizmo 共用事务接线，取消时恢复骨骼 quaternion。 */
function PrevisBoneGizmo({ bone, onCommit }: { bone: Object3D; onCommit: (rotation: PrevisQuat) => void }) {
    const transaction = usePrevisGizmoTransaction<PrevisQuat>({
        read: () => bone.quaternion.toArray() as PrevisQuat,
        restore: (snapshot) => {
            bone.quaternion.fromArray(snapshot);
            bone.updateMatrixWorld(true);
        },
        commit: (_from, to) => onCommit(to),
        onActive: () => undefined,
    });
    return <TransformControls object={bone} mode="rotate" size={0.55} onMouseDown={() => transaction.begin()} onMouseUp={() => transaction.end("commit")} />;
}

function archetypeProfile(archetype: PrevisObject["archetype"], custom?: PrevisObject["actorProfile"]) {
    const base = previsActorProfileForArchetype(archetype || "adult");
    const profile = { ...base, ...custom };
    return { height: profile.height, torso: [profile.torsoRatio, profile.torsoRatio, profile.torsoRatio] as [number, number, number], head: profile.headRatio, limb: profile.height, shoulder: profile.shoulderWidth, accessory: profile.accessory, monster: archetype === "monster" || profile.accessory === "horns" };
}

function PrevisClayActor({ archetype, actorProfile, color, pose, boneOverrides, selected }: { archetype: PrevisObject["archetype"]; actorProfile?: PrevisObject["actorProfile"]; color: string; pose: PrevisObject["pose"]; boneOverrides?: PrevisObject["boneOverrides"]; selected: boolean }) {
    const profile = archetypeProfile(archetype || "adult", actorProfile);
    const resolvedColor = selected ? new Color(color).lerp(new Color("#8fb8ff"), 0.16).getStyle() : color;
    const seated = pose === "sit" || pose === "squat";
    const walking = pose === "walk" || pose === "run";
    const armLift = pose === "wave" || pose === "reach" ? 0.72 : pose === "fight" ? 0.42 : 0.1;
    const leftArm = pose === "wave" ? -1.18 : pose === "arms_crossed" ? -0.58 : -armLift;
    const rightArm = pose === "reach" ? 1.0 : pose === "arms_crossed" ? 0.58 : armLift;
    const leftLeg = walking ? -0.28 : seated ? -0.56 : 0.05;
    const rightLeg = walking ? 0.28 : seated ? 0.56 : -0.05;
    const torsoY = seated ? 1.05 * profile.height : 1.28 * profile.height;
    const spine = readClayBoneEuler(boneOverrides, "spine");
    const head = readClayBoneEuler(boneOverrides, "head");
    const leftUpperArm = readClayBoneEuler(boneOverrides, "leftUpperArm");
    const leftLowerArm = readClayBoneEuler(boneOverrides, "leftLowerArm");
    const rightUpperArm = readClayBoneEuler(boneOverrides, "rightUpperArm");
    const rightLowerArm = readClayBoneEuler(boneOverrides, "rightLowerArm");
    const leftUpperLeg = readClayBoneEuler(boneOverrides, "leftUpperLeg");
    const rightUpperLeg = readClayBoneEuler(boneOverrides, "rightUpperLeg");

    return <group userData={{ previsActor: true }} scale={[1, profile.height, 1]}>
        <mesh position={[0, torsoY, 0]} rotation={spine} scale={[0.78 * profile.torso[0] * profile.shoulder, profile.torso[1], 0.68 * profile.torso[2]]} castShadow receiveShadow>
            <capsuleGeometry args={[0.34, 0.64, 8, 18]} />
            <meshStandardMaterial color={resolvedColor} roughness={0.84} metalness={0.02} emissive={selected ? "#ffaa00" : "#000000"} emissiveIntensity={selected ? 0.4 : 0} />
        </mesh>
        <mesh position={[0, seated ? 1.72 : 2.02, 0]} rotation={head} scale={[0.82 * profile.head, 0.86 * profile.head, 0.82 * profile.head]} castShadow receiveShadow>
            <sphereGeometry args={[0.28, 24, 16]} />
            <meshStandardMaterial color={resolvedColor} roughness={0.82} metalness={0.02} />
        </mesh>
        <ClayActorLimb position={[-0.32 * profile.shoulder, seated ? 1.27 : 1.54, 0]} rotation={[leftUpperArm[0] + leftLowerArm[0], leftUpperArm[1] + leftLowerArm[1], leftArm + leftUpperArm[2] + leftLowerArm[2]]} length={0.62} color={resolvedColor} />
        <ClayActorLimb position={[0.32 * profile.shoulder, seated ? 1.27 : 1.54, 0]} rotation={[rightUpperArm[0] + rightLowerArm[0], rightUpperArm[1] + rightLowerArm[1], rightArm + rightUpperArm[2] + rightLowerArm[2]]} length={0.62} color={resolvedColor} />
        <ClayActorLimb position={[-0.18, seated ? 0.78 : 0.72, 0]} rotation={[(seated ? -0.35 : 0) + leftUpperLeg[0], leftUpperLeg[1], leftLeg + leftUpperLeg[2]]} length={0.78} color={resolvedColor} />
        <ClayActorLimb position={[0.18, seated ? 0.78 : 0.72, 0]} rotation={[(seated ? 0.35 : 0) + rightUpperLeg[0], rightUpperLeg[1], rightLeg + rightUpperLeg[2]]} length={0.78} color={resolvedColor} />
        <mesh position={[-0.2, 0.1, seated ? 0.08 : 0]} scale={[0.9, 0.28, 1.2]} castShadow receiveShadow>
            <sphereGeometry args={[0.16, 16, 10]} />
            <meshStandardMaterial color={resolvedColor} roughness={0.86} />
        </mesh>
        {profile.accessory === "horns" ? <>
            <mesh position={[-0.18, 2.38, 0]} rotation={[0, 0, -0.35]} castShadow><coneGeometry args={[0.11, 0.34, 8]} /><meshStandardMaterial color={resolvedColor} roughness={0.8} /></mesh>
            <mesh position={[0.18, 2.38, 0]} rotation={[0, 0, 0.35]} castShadow><coneGeometry args={[0.11, 0.34, 8]} /><meshStandardMaterial color={resolvedColor} roughness={0.8} /></mesh>
        </> : null}
        {profile.accessory === "cane" ? <group position={[0.48, 0.58, 0.08]} rotation={[0, 0, -0.08]}><mesh position={[0, 0.55, 0]} castShadow><cylinderGeometry args={[0.035, 0.035, 1.1, 8]} /><meshStandardMaterial color="#5d4639" roughness={0.9} /></mesh><mesh position={[-0.04, 1.1, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><torusGeometry args={[0.08, 0.025, 6, 12, Math.PI]} /><meshStandardMaterial color="#5d4639" roughness={0.9} /></mesh></group> : null}
    </group>;
}

function readClayBoneEuler(overrides: PrevisObject["boneOverrides"], bone: PrevisHumanoidBone): [number, number, number] {
    const rotation = overrides?.[bone];
    if (!rotation) return [0, 0, 0];
    const euler = new Euler().setFromQuaternion(new Quaternion(...rotation), "XYZ");
    return [euler.x, euler.y, euler.z];
}

function ClayActorLimb({ position, rotation, length, color }: { position: [number, number, number]; rotation: [number, number, number]; length: number; color: string }) {
    return <group position={position} rotation={rotation}>
        <mesh position={[0, -length * 0.5, 0]} castShadow receiveShadow>
            <capsuleGeometry args={[0.1, length, 6, 12]} />
            <meshStandardMaterial color={color} roughness={0.84} metalness={0.02} />
        </mesh>
    </group>;
}


function BoneController({ bone, selected, dimmed, onSelect }: { bone: Object3D | undefined; selected: boolean; dimmed: boolean; onSelect: () => void }) {
    const ref = useRef<Group>(null);
    const visibleRef = useRef<Mesh>(null);
    const hitRef = useRef<Mesh>(null);
    const world = useMemo(() => new Vector3(), []);
    const local = useMemo(() => new Vector3(), []);
    const cameraWorld = useMemo(() => new Vector3(), []);
    const { camera, size } = useThree();
    useFrame(() => {
        if (!bone || !ref.current) return;
        const parent = ref.current.parent;
        if (!parent) return;
        // 控制点与模型根节点是兄弟关系，必须转换到控制点父级坐标，否则点击区域会与骨骼错位。
        bone.getWorldPosition(world);
        camera.getWorldPosition(cameraWorld);
        local.copy(world);
        parent.worldToLocal(local);
        ref.current.position.copy(local);
        const distance = cameraWorld.distanceTo(world);
        const visualPixels = selected ? 5 : dimmed ? 2.5 : 3.5;
        const hitPixels = selected ? 12 : 10;
        visibleRef.current?.scale.setScalar(screenPixelsToWorldRadius(camera, distance, visualPixels, size.height));
        hitRef.current?.scale.setScalar(screenPixelsToWorldRadius(camera, distance, hitPixels, size.height));
    });
    if (!bone) return null;
    const handlePointerDown = (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onSelect(); };
    return <group ref={ref}>
        <mesh ref={visibleRef} onPointerDown={handlePointerDown} frustumCulled={false}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshBasicMaterial color={selected ? "#ffcc00" : "#78a9ff"} depthTest={false} transparent opacity={selected ? 1 : dimmed ? 0.14 : 0.68} />
        </mesh>
        {/* 可视点保持小尺寸，透明球只负责提供稳定的点击面积。 */}
        <mesh ref={hitRef} onPointerDown={handlePointerDown} frustumCulled={false}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshBasicMaterial transparent opacity={0} depthTest={false} />
        </mesh>
    </group>;
}

function PrevisBillboard({ object, selected }: { object: PrevisObject; selected: boolean }) {
    // 展示状态带 url 身份：只有与当前 object.url 匹配才交给 material，
    // 这样换 URL 的第一次 render 就卸下旧纹理，随后 cleanup 才 dispose。
    const [loaded, setLoaded] = useState<{ identity: string; value: Texture } | null>(null);
    const identity = object.url || "";
    const texture = resolvePrevisDisplay(loaded, identity);
    useEffect(() => {
        let active = true;
        let owned: Texture | null = null;
        setLoaded(null);
        const loader = new TextureLoader();
        loader.crossOrigin = "anonymous";
        loader.load(object.url!, (next) => {
            // 晚到的回调：本组件已换 URL 或卸载，直接释放这张纹理。
            if (!active) {
                next.dispose();
                return;
            }
            owned = next;
            setLoaded({ identity, value: next });
        }, undefined, () => active && setLoaded(null));
        return () => {
            active = false;
            owned?.dispose();
            owned = null;
        };
    }, [identity, object.url]);
    return (
        <mesh castShadow={object.castShadow}>
            <planeGeometry args={[1.6, 0.9]} />
            <meshBasicMaterial map={texture || undefined} color={texture ? "#ffffff" : selected ? "#ffcc00" : object.color} toneMapped={false} transparent opacity={texture ? 1 : 0.6} />
        </mesh>
    );
}

function PrevisLightView({ light }: { light: PrevisLight }) {
    const position = light.transform.position;
    if (light.type === "ambient") return <ambientLight color={light.color} intensity={light.intensity} />;
    if (light.type === "point") return <pointLight position={position} color={light.color} intensity={light.intensity} castShadow={light.castShadow} />;
    if (light.type === "spot") return <spotLight position={position} color={light.color} intensity={light.intensity} angle={light.angle} penumbra={light.penumbra} castShadow={light.castShadow} />;
    return <directionalLight position={position} color={light.color} intensity={light.intensity} castShadow={light.castShadow} shadow-mapSize-width={1024} shadow-mapSize-height={1024} />;
}
