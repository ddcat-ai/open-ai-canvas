import type { PrevisAspectRatio, PrevisCamera, PrevisShot } from "@/types/previs";

/**
 * 世界引擎镜头光学的唯一真源。
 *
 * 约定：传感器按 Super35 / 全画幅 36mm 宽度计算水平视角，three PerspectiveCamera 需要的是
 * 竖直 fov，因此按镜头画幅比例把水平视角换算成竖直视角。这样同一焦段在 9:16 竖屏与
 * 2.39:1 宽银幕下保持一致的「水平取景宽度」语义，和摄影师的焦段直觉一致。
 */
export const PREVIS_SENSOR_WIDTH_MM = 36;

export const PREVIS_ASPECT_RATIOS: Array<{ value: PrevisAspectRatio; label: string; ratio: number }> = [
    { value: "9:16", label: "9:16 竖屏", ratio: 9 / 16 },
    { value: "16:9", label: "16:9 横屏", ratio: 16 / 9 },
    { value: "2.39:1", label: "2.39:1 宽银幕", ratio: 2.39 },
];

export function previsAspectValue(value?: PrevisAspectRatio): number {
    return PREVIS_ASPECT_RATIOS.find((item) => item.value === value)?.ratio ?? 9 / 16;
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

/** CAM 取景与离线渲染共用：镜头摄影机在给定镜头画幅下的竖直 fov。 */
export function resolvePrevisShotFov(camera: Pick<PrevisCamera, "focalLength" | "fov">, shot?: Pick<PrevisShot, "aspectRatio"> | null): number {
    if (!Number.isFinite(camera.focalLength) || camera.focalLength <= 0) return camera.fov;
    return previsVerticalFov(camera.focalLength, previsAspectValue(shot?.aspectRatio));
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
