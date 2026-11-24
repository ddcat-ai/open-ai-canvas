import type { PrevisAspectRatio, PrevisCamera, PrevisShot } from "@/types/previs";

/**
 * 世界引擎镜头光学的唯一真源。
 *
 * 约定：传感器按 Super35 / 全画幅 36mm 宽度计算水平视角，three PerspectiveCamera 需要的是
 * 竖直 fov，因此按镜头画幅比例把水平视角换算成竖直视角。这样同一焦段在 9:16 竖屏与
 * 2.39:1 宽银幕下保持一致的「水平取景宽度」语义，和摄影师的焦段直觉一致。
 */
export const PREVIS_SENSOR_WIDTH_MM = 36;

/** 未设置画幅的镜头按短剧竖屏处理。 */
export const PREVIS_DEFAULT_ASPECT_RATIO: PrevisAspectRatio = "9:16";
/** 自适应画幅拿不到有效视口尺寸时的回落比例。 */
export const PREVIS_AUTO_ASPECT_FALLBACK = 16 / 9;

/** 画幅选项按从宽到窄排列；auto 没有固定比例，由调用方传入视口宽高比。 */
export const PREVIS_ASPECT_RATIOS: Array<{ value: PrevisAspectRatio; label: string; hint: string; ratio?: number }> = [
    { value: "auto", label: "自适应", hint: "跟随视口" },
    { value: "2.39:1", label: "2.39:1", hint: "宽银幕", ratio: 2.39 },
    { value: "21:9", label: "21:9", hint: "超宽屏", ratio: 21 / 9 },
    { value: "16:9", label: "16:9", hint: "横屏", ratio: 16 / 9 },
    { value: "4:3", label: "4:3", hint: "经典", ratio: 4 / 3 },
    { value: "1:1", label: "1:1", hint: "方形", ratio: 1 },
    { value: "3:4", label: "3:4", hint: "竖版", ratio: 3 / 4 },
    { value: "9:16", label: "9:16", hint: "竖屏", ratio: 9 / 16 },
];

export function previsAspectOption(value?: PrevisAspectRatio) {
    return PREVIS_ASPECT_RATIOS.find((item) => item.value === (value ?? PREVIS_DEFAULT_ASPECT_RATIO)) ?? PREVIS_ASPECT_RATIOS.find((item) => item.value === PREVIS_DEFAULT_ASPECT_RATIO)!;
}

/**
 * 画幅宽高比。auto 使用 viewportAspect（视口宽/高），视口尺寸无效时回落 16:9；
 * 未设置或未知值按默认竖屏。
 */
export function previsAspectValue(value?: PrevisAspectRatio, viewportAspect?: number): number {
    const option = previsAspectOption(value);
    if (option.ratio) return option.ratio;
    return viewportAspect !== undefined && Number.isFinite(viewportAspect) && viewportAspect > 0 ? viewportAspect : PREVIS_AUTO_ASPECT_FALLBACK;
}

/** 水平视角（度）。 */
export function previsHorizontalFov(focalLength: number): number {
    const focal = Number.isFinite(focalLength) ? Math.max(1, focalLength) : 35;
    return (2 * Math.atan(PREVIS_SENSOR_WIDTH_MM / (2 * focal)) * 180) / Math.PI;
}

/** 按画幅比例把焦段换算成 three 使用的竖直 fov（度）。 */
export function previsVerticalFov(focalLength: number, aspect: number): number {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 9 / 16;
    const halfHorizontal = (previsHorizontalFov(focalLength) * Math.PI) / 360;
    return (2 * Math.atan(Math.tan(halfHorizontal) / safeAspect) * 180) / Math.PI;
}

/**
 * 景别取景距离：画面短边（横屏是高、竖屏是宽）恰好框住 extent 米时，机位到主体的距离。
 * 用于跟拍景别；同一景别换焦段或画幅仍框住同样的范围。下限 0.35 米，避免机位钻进人物。
 */
export function previsFramingDistance(extent: number, focalLength: number, aspect: number): number {
    const halfHorizontal = (previsHorizontalFov(focalLength) * Math.PI) / 360;
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const halfShort = safeAspect >= 1 ? Math.tan(halfHorizontal) / safeAspect : Math.tan(halfHorizontal);
    return Math.max(0.35, (Number.isFinite(extent) && extent > 0 ? extent : 1) / (2 * halfShort));
}

/** CAM 取景与离线渲染共用：镜头摄影机在给定镜头画幅下的竖直 fov。viewportAspect 只对自适应画幅生效。 */
export function resolvePrevisShotFov(camera: Pick<PrevisCamera, "focalLength" | "fov">, shot?: Pick<PrevisShot, "aspectRatio"> | null, viewportAspect?: number): number {
    if (!Number.isFinite(camera.focalLength) || camera.focalLength <= 0) return camera.fov;
    return previsVerticalFov(camera.focalLength, previsAspectValue(shot?.aspectRatio, viewportAspect));
}

/**
 * 在容器内按目标画幅求最大内接安全框（像素，居中）。
 * 视口仍按容器满铺渲染，安全框外用遮幅压暗，让「所见即成片」可读。
 */
export function resolvePrevisSafeFrame(container: { width: number; height: number }, aspect: number) {
    const width = Math.max(1, container.width);
    const height = Math.max(1, container.height);
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 9 / 16;
    const fitWidth = Math.min(width, height * safeAspect);
    const fitHeight = fitWidth / safeAspect;
    return { width: fitWidth, height: fitHeight, left: (width - fitWidth) / 2, top: (height - fitHeight) / 2 };
}

/**
 * 输出分辨率：长边固定，短边按画幅换算并取偶数（H.264 yuv420p 要求宽高为偶数）。
 */
export function resolvePrevisOutputSize(aspect: number, longEdge = 1280) {
    if (!Number.isFinite(longEdge) || longEdge < 2 || longEdge > 8192) throw new Error("输出长边必须在 2–8192 像素之间");
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 9 / 16;
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
    if (safeAspect >= 1) return { width: even(longEdge), height: even(longEdge / safeAspect) };
    return { width: even(longEdge * safeAspect), height: even(longEdge) };
}

/**
 * 深度导出的固定米制范围：按镜头首尾机位到可见对象的距离估算一次。
 * 整段镜头共用同一范围，深度视频不会逐帧闪烁；近端留余量、远端封顶避免精度被稀释。
 */
export function resolvePrevisDepthRange(input: { cameraPositions: Array<[number, number, number]>; objectPositions: Array<[number, number, number]>; maxFar?: number }) {
    const distances: number[] = [];
    for (const camera of input.cameraPositions) {
        for (const object of input.objectPositions) {
            const distance = Math.hypot(object[0] - camera[0], object[1] - camera[1], object[2] - camera[2]);
            if (Number.isFinite(distance)) distances.push(distance);
        }
    }
    const maxFar = input.maxFar ?? 80;
    if (!Number.isFinite(maxFar) || maxFar < 2) throw new Error("深度范围上限必须至少为 2 米");
    if (!distances.length) return { near: 0, far: Math.min(30, maxFar) };
    const nearest = Math.min(...distances);
    const farthest = Math.max(...distances);
    const near = Math.min(maxFar - 2, Math.max(0, nearest - 1.5));
    const far = Math.min(maxFar, Math.max(near + 2, farthest + 3));
    return { near: Number(near.toFixed(2)), far: Number(far.toFixed(2)) };
}
