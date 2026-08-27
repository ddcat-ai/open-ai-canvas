import { Euler, Vector3 } from "three";

import { interpolateDirectorTransform } from "@/lib/canvas/director/director-scene";
import type { DirectorCamera, DirectorScene, DirectorShot, DirectorTransform, DirectorVec3 } from "@/types/director";

/**
 * 视口取景模式（3D / CAM / 五个正交轴向：俯视、正视、背视、左视、右视）。
 *
 * 与一级模式（director-modes.ts 的摆场/姿态/动画/摄影机）是两个正交的量：
 * 一级模式决定「能改什么」，取景模式只决定「从哪只眼睛看」。
 *
 * viewMode 是纯视口状态，绝不写入 DirectorScene，也绝不产生 undo/history 记录 ——
 * 换一只眼睛看场景不是对内容的修改。本模块只做纯函数，不持有任何 three 对象。
 *
 * 五个正交轴向和 CAM 一样锁环绕，但取景来自场景内容的包围盒而不是某台摄影机：
 * resolveDirectorOrthographicFraming 解出带 margin 的投影跨度，
 * resolveDirectorOrthographicFrustum 再按视口宽高比收成安全的正交半范围。
 */

export type DirectorViewMode = "free" | "camera" | "top" | "front" | "back" | "left" | "right";

export type DirectorViewModeCapabilities = {
    /** 是否允许 OrbitControls 自由环绕。只有 free 允许；CAM 与五个正交轴向都要锁定构图，拖拽会破坏取景。 */
    orbit: boolean;
    /** 是否由 shot 的摄影机接管取景（视口相机 == 当前镜头）。只有 CAM。 */
    framed: boolean;
    /** 投影方式。free/camera 是透视；五个正交轴向必须是正交投影，否则物体比例会随远近畸变。 */
    projection: "perspective" | "orthographic";
};

const CAPABILITIES: Record<DirectorViewMode, DirectorViewModeCapabilities> = {
    // 3D：编辑用的自由视角，可环绕、可缩放，摄影机只被关键帧驱动时才回写。
    free: { orbit: true, framed: false, projection: "perspective" },
    // CAM：所见即成片取景，视口 == 当前 shot 的摄影机，禁止环绕。
    camera: { orbit: false, framed: true, projection: "perspective" },
    // 五个正交轴向：取景来自场景包围盒而非某台摄影机，同样锁环绕，投影必须正交。
    top: { orbit: false, framed: false, projection: "orthographic" },
    front: { orbit: false, framed: false, projection: "orthographic" },
    back: { orbit: false, framed: false, projection: "orthographic" },
    left: { orbit: false, framed: false, projection: "orthographic" },
    right: { orbit: false, framed: false, projection: "orthographic" },
};

export const DIRECTOR_VIEW_MODES: Array<{ mode: DirectorViewMode; label: string; hint: string }> = [
    { mode: "free", label: "3D", hint: "自由视角：拖拽环绕、滚轮缩放" },
    { mode: "camera", label: "CAM", hint: "机位视图：按当前镜头的摄影机取景，环绕已锁定" },
    { mode: "top", label: "TOP", hint: "俯视：从正上方向下看，正交投影，环绕已锁定" },
    { mode: "front", label: "FRONT", hint: "正视：沿 -Z 方向看向场景，正交投影，环绕已锁定" },
    { mode: "back", label: "BACK", hint: "背视：沿 +Z 方向看向场景，正交投影，环绕已锁定" },
    { mode: "left", label: "LEFT", hint: "左视：沿 +X 方向看向场景，正交投影，环绕已锁定" },
    { mode: "right", label: "RIGHT", hint: "右视：沿 -X 方向看向场景，正交投影，环绕已锁定" },
];

export const DIRECTOR_DEFAULT_VIEW_MODE: DirectorViewMode = "free";

/** 未知模式回落默认能力，绝不返回 undefined —— 调用方直接读 .orbit / .framed。 */
export function directorViewModeCapabilities(mode: DirectorViewMode): DirectorViewModeCapabilities {
    return CAPABILITIES[mode] ?? CAPABILITIES[DIRECTOR_DEFAULT_VIEW_MODE];
}

/**
 * 当前 shot / 摄影机的唯一解析入口。
 *
 * activeShotId 指向不存在的 shot 时回落到第一个 shot；shot 的 cameraId 指向不存在的
 * 摄影机时回落到第一台。空场景返回 null 而不是抛异常 —— 视口在任何场景下都必须能渲染。
 */
export function resolveDirectorActiveShot(scene: DirectorScene): DirectorShot | null {
    return scene.shots.find((item) => item.id === scene.activeShotId) || scene.shots[0] || null;
}

export function resolveDirectorActiveCamera(scene: DirectorScene): DirectorCamera | null {
    const shot = resolveDirectorActiveShot(scene);
    return scene.cameras.find((item) => item.id === shot?.cameraId) || scene.cameras[0] || null;
}

/** 取景数据：CAM 模式下视口相机需要被写入的完整状态。 */
export type DirectorViewFraming = {
    cameraId: string;
    position: DirectorVec3;
    target: DirectorVec3;
    /** 世界系 up。保留 roll，且保证与视线不共线。 */
    up: DirectorVec3;
    fov: number;
    near: number;
    far: number;
};

// 叉积长度低于此值即视为共线：lookAt 会解出非法基向量（NaN 矩阵），视口直接黑屏。
const DIRECTOR_VIEW_COLLINEAR_EPSILON = 1e-6;

// 退化时的备选 up：世界 up 优先，其次两个水平轴 —— 正俯视/正仰视镜头落在这里。
const DIRECTOR_VIEW_UP_FALLBACKS: DirectorVec3[] = [
    [0, 1, 0],
    [0, 0, -1],
    [1, 0, 0],
];

/**
 * 解出带 roll 的 up 向量。
 *
 * 摄影机 rotation 的 z 分量就是荷兰角。裸 lookAt 会丢掉它 —— three 用固定的 camera.up
 * 重算基向量，画面永远水平。这里把世界 up 按摄影机自身欧拉角旋转，roll 才留得住。
 *
 * 再处理退化：正俯视/正仰视时旋转后的 up 与视线共线，叉积为 0，lookAt 解出 NaN 矩阵。
 * 此时按 世界up -> -Z -> +X 取第一个不共线的备选，绝不返回让相机失效的值。
 */
export function resolveDirectorViewUp(rotation: DirectorVec3, viewDirection: DirectorVec3): DirectorVec3 {
    const view = new Vector3(...viewDirection);
    if (view.lengthSq() <= DIRECTOR_VIEW_COLLINEAR_EPSILON) return [0, 1, 0];
    const rolled = new Vector3(0, 1, 0).applyEuler(new Euler(...rotation));
    const candidates = rolled.lengthSq() > DIRECTOR_VIEW_COLLINEAR_EPSILON ? [rolled.toArray() as DirectorVec3, ...DIRECTOR_VIEW_UP_FALLBACKS] : DIRECTOR_VIEW_UP_FALLBACKS;
    return candidates.find((candidate) => new Vector3(...candidate).cross(view).length() > DIRECTOR_VIEW_COLLINEAR_EPSILON) ?? [0, 1, 0];
}

/**
 * Three 透视投影是否可写进 PerspectiveCamera。
 *
 * 只检查有限还不够：fov=0 / 180、near<=0、far<=near 都能通过 isFinite，
 * 但 makePerspective 会得到 Inf/NaN 矩阵，视口黑屏。fov 必须落在 (0, 180)。
 */
export function directorUsablePerspectiveProjection(input: { fov: number; near: number; far: number }): boolean {
    const { fov, near, far } = input;
    if (![fov, near, far].every(Number.isFinite)) return false;
    if (fov <= 0 || fov >= 180) return false;
    if (near <= 0) return false;
    return far > near;
}

export type DirectorEffectiveViewport = {
    /** 视口应激活的专用相机。CAM 取景失败时必须是 free，不能停在从未写入的 camCamera。 */
    camera: "free" | "camera" | "orthographic";
    /** 是否允许环绕 free 相机。与 camera 同步：只有 free 为 true。 */
    orbit: boolean;
};

/**
 * 视口活动相机与交互的唯一决策。
 *
 * CAM 取景为 null（空场景、非法光学参数）时回落到已有的 free 相机和自由环绕，
 * 绝不改 DirectorScene。取景重新合法后确定性回到 CAM（orbit 锁死）。
 * 正交轴向不走这条回落：它们始终有安全默认包围盒。
 */
export function resolveDirectorEffectiveViewport(input: { mode: DirectorViewMode; framing: DirectorViewFraming | null }): DirectorEffectiveViewport {
    if (directorViewModeCapabilities(input.mode).projection === "orthographic") return { camera: "orthographic", orbit: false };
    if (input.mode === "camera" && input.framing) return { camera: "camera", orbit: false };
    return { camera: "free", orbit: true };
}

/**
 * 解出 CAM 模式下视口相机应有的取景。
 *
 * 返回 null 的情形都必须走 free 回落：3D 模式、空场景、位置/旋转非法、
 * 透视投影不可用（fov/near/far）。绝不把非法值写进 three 相机。
 *
 * position 取 playhead 上插值后的值，所以 CAM 模式下拖时间轴就是在预览成片运镜。
 */
export function resolveDirectorViewFraming(input: { scene: DirectorScene; mode: DirectorViewMode; playhead: number }): DirectorViewFraming | null {
    if (!directorViewModeCapabilities(input.mode).framed) return null;
    const camera = resolveDirectorActiveCamera(input.scene);
    if (!camera) return null;
    const time = Number.isFinite(input.playhead) ? input.playhead : 0;
    const transform: DirectorTransform = interpolateDirectorTransform(camera.transform, camera.keyframes, time);
    if (![...transform.position, ...transform.rotation, ...camera.target].every(Number.isFinite)) return null;
    if (!directorUsablePerspectiveProjection({ fov: camera.fov, near: camera.near, far: camera.far })) return null;
    const position = transform.position;
    const raw = new Vector3(camera.target[0] - position[0], camera.target[1] - position[1], camera.target[2] - position[2]);
    const degenerate = raw.lengthSq() <= DIRECTOR_VIEW_COLLINEAR_EPSILON;
    // 位置与焦点重合时视线为零向量，lookAt 无解：沿摄影机自身 -Z 造一个 1m 外的焦点。
    const view = degenerate ? new Vector3(0, 0, -1).applyEuler(new Euler(...transform.rotation)) : raw;
    const target: DirectorVec3 = degenerate ? [position[0] + view.x, position[1] + view.y, position[2] + view.z] : camera.target;
    return { cameraId: camera.id, position, target, up: resolveDirectorViewUp(transform.rotation, view.toArray() as DirectorVec3), fov: camera.fov, near: camera.near, far: camera.far };
}

/**
 * 取景同步键。
 *
 * 相机回写的 effect 只依赖这个字符串：草稿对象每次 render 都是新身份，但取景数值没变
 * 就不该重写相机。数值截到 4 位小数，避免浮点噪声引起无意义的重同步。
 */
export function directorViewFramingKey(framing: DirectorViewFraming | null): string {
    if (!framing) return "";
    return [...framing.position, ...framing.target, ...framing.up, framing.fov, framing.near, framing.far].map((value) => value.toFixed(4)).join("|") + `|${framing.cameraId}`;
}

/**
 * 五个正交轴向的视线方向与 up。这五个轴上视线与 up 恒定正交（都是不同的主轴向量），
 * 不会出现 CAM 取景那种「roll 导致 up 与视线共线」的退化情形，因此不需要
 * resolveDirectorViewUp 那套回落链。
 *
 * 方向约定（世界系，Y-up）：
 * - top：看向 -Y（从上往下看），up 取 -Z。
 * - front：看向 -Z，up 取 +Y。
 * - back：看向 +Z，up 取 +Y —— front 的正对面。
 * - left：看向 +X（从场景左侧看向右侧），up 取 +Y。
 * - right：看向 -X，up 取 +Y —— left 的正对面。
 */
type DirectorOrthographicAxis = "top" | "front" | "back" | "left" | "right";

/**
 * 正交画面上的世界轴。horizontal/vertical 是投影后的屏幕轴，不是视线轴：
 * - top：水平 X / 竖直 Z
 * - front / back：水平 X / 竖直 Y
 * - left / right：水平 Z / 竖直 Y
 */
const DIRECTOR_ORTHOGRAPHIC_AXES: Record<DirectorOrthographicAxis, { view: DirectorVec3; up: DirectorVec3; horizontal: 0 | 1 | 2; vertical: 0 | 1 | 2 }> = {
    top: { view: [0, -1, 0], up: [0, 0, -1], horizontal: 0, vertical: 2 },
    front: { view: [0, 0, -1], up: [0, 1, 0], horizontal: 0, vertical: 1 },
    back: { view: [0, 0, 1], up: [0, 1, 0], horizontal: 0, vertical: 1 },
    left: { view: [1, 0, 0], up: [0, 1, 0], horizontal: 2, vertical: 1 },
    right: { view: [-1, 0, 0], up: [0, 1, 0], horizontal: 2, vertical: 1 },
};

/** 穷举类型守卫：合法的正交轴向集合在类型层面就是穷举的，调用方无需再查能力表判断。 */
function isDirectorOrthographicAxis(mode: DirectorViewMode): mode is DirectorOrthographicAxis {
    return mode === "top" || mode === "front" || mode === "back" || mode === "left" || mode === "right";
}

function directorFinitePoint(point: DirectorVec3): boolean {
    return point.every(Number.isFinite);
}

/**
 * 取景点云：可见对象的旋转后缩放包围盒角点 + 全部摄影机/灯光的位置。
 *
 * 只收对象中心会把大比例背景板、长道具等裁掉。资源尚未加载时无法读取真实 geometry，
 * transform.scale 是当前场景合同里稳定可用的保守代理；旋转后的八个角点还能覆盖斜放对象。
 */
function collectDirectorFramingPoints(scene: DirectorScene): DirectorVec3[] {
    const points: DirectorVec3[] = [];
    for (const object of scene.objects) {
        const { position, rotation, scale } = object.transform;
        if (!object.visible || !directorFinitePoint(position)) continue;
        points.push(position);
        if (![...rotation, ...scale].every(Number.isFinite)) continue;
        const half = scale.map((value) => Math.abs(value) / 2) as DirectorVec3;
        const euler = new Euler(...rotation);
        for (const x of [-half[0], half[0]]) {
            for (const y of [-half[1], half[1]]) {
                for (const z of [-half[2], half[2]]) {
                    const corner = new Vector3(x, y, z).applyEuler(euler).add(new Vector3(...position));
                    points.push(corner.toArray() as DirectorVec3);
                }
            }
        }
    }
    for (const camera of scene.cameras) if (directorFinitePoint(camera.transform.position)) points.push(camera.transform.position);
    for (const light of scene.lights) if (directorFinitePoint(light.transform.position)) points.push(light.transform.position);
    return points;
}

type DirectorFramingBounds = { center: DirectorVec3; extent: DirectorVec3 };

// 空场景 / 全部点位非法时的安全默认包围盒，贴近场景模板的默认布景尺度（见 director-templates.ts 三点布光半径）。
const DIRECTOR_ORTHOGRAPHIC_DEFAULT_BOUNDS: DirectorFramingBounds = { center: [0, 0, 0], extent: [6, 6, 6] };
// 单轴范围下限：单点或共面内容不能把该轴压成 0，否则正交相机等于无限缩放。
const DIRECTOR_ORTHOGRAPHIC_MIN_EXTENT = 2;
// 构图留白：内容贴着画面边缘看不清楚，按包围盒放大这个比例再取景。
const DIRECTOR_ORTHOGRAPHIC_MARGIN = 1.2;
// 相机与目标的距离相对包围盒半径的倍数：太近会让正交相机的机位穿进内容内部。
const DIRECTOR_ORTHOGRAPHIC_DISTANCE_FACTOR = 2;
const DIRECTOR_ORTHOGRAPHIC_NEAR = 0.1;
// far 相对距离额外预留的深度倍数，保证视线方向上的内容不被裁切。
const DIRECTOR_ORTHOGRAPHIC_FAR_MARGIN = 4;
// 视锥换算的跨度下限：0 / 负 / 非有限值都不能当除数或半范围。
const DIRECTOR_ORTHOGRAPHIC_MIN_SPAN = 1e-3;
// 非法宽高比（0 / 负 / NaN / Infinity）回落正方形，避免半范围变成 NaN 或 Infinity。
const DIRECTOR_ORTHOGRAPHIC_DEFAULT_ASPECT = 1;

/** 点云的轴对齐包围盒中心与三轴范围。点云为空时回落安全默认值，每轴范围不低于最小下限。 */
function resolveDirectorFramingBounds(points: DirectorVec3[]): DirectorFramingBounds {
    if (points.length === 0) return DIRECTOR_ORTHOGRAPHIC_DEFAULT_BOUNDS;
    const min: DirectorVec3 = [Infinity, Infinity, Infinity];
    const max: DirectorVec3 = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
        for (let axis = 0; axis < 3; axis += 1) {
            if (point[axis] < min[axis]) min[axis] = point[axis];
            if (point[axis] > max[axis]) max[axis] = point[axis];
        }
    }
    const center = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2) as DirectorVec3;
    const extent = [0, 1, 2].map((axis) => Math.max(max[axis] - min[axis], DIRECTOR_ORTHOGRAPHIC_MIN_EXTENT)) as DirectorVec3;
    return { center, extent };
}

/** 正交轴向取景数据：视口相机需要被写入的完整状态。 */
export type DirectorOrthographicFraming = {
    position: DirectorVec3;
    target: DirectorVec3;
    /** 世界系 up，恒定为主轴向量，绝不与视线共线。 */
    up: DirectorVec3;
    /** 投影后的水平跨度（已含构图留白）。不得单独按高度×宽高比展开，否则宽内容会被裁切。 */
    horizontalSpan: number;
    /** 投影后的竖直跨度（已含构图留白）。 */
    verticalSpan: number;
    near: number;
    far: number;
};

/** 正交相机的左右上下半范围。始终对称，且 width/height 等于安全后的宽高比。 */
export type DirectorOrthographicFrustum = {
    halfWidth: number;
    halfHeight: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
};

function directorSafePositive(value: number, fallback: number): number {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 把投影跨度与视口宽高比收成正交半范围。
 *
 * 必须同时装下水平与竖直跨度：只按高度×aspect 算宽度时，宽于画面的内容会被裁掉。
 * aspect 为 0 / 负 / NaN / ±Infinity 时回落 1；跨度非法时回落最小正跨度。
 * 这是纯函数，不读 scene，也不写 three 相机。
 */
export function resolveDirectorOrthographicFrustum(input: { horizontalSpan: number; verticalSpan: number; aspect: number }): DirectorOrthographicFrustum {
    const horizontalSpan = directorSafePositive(input.horizontalSpan, DIRECTOR_ORTHOGRAPHIC_MIN_SPAN);
    const verticalSpan = directorSafePositive(input.verticalSpan, DIRECTOR_ORTHOGRAPHIC_MIN_SPAN);
    const aspect = directorSafePositive(input.aspect, DIRECTOR_ORTHOGRAPHIC_DEFAULT_ASPECT);
    const neededHalfWidth = horizontalSpan / 2;
    const neededHalfHeight = verticalSpan / 2;
    const halfWidth = Math.max(neededHalfWidth, neededHalfHeight * aspect);
    const halfHeight = Math.max(neededHalfHeight, neededHalfWidth / aspect);
    return {
        halfWidth,
        halfHeight,
        left: -halfWidth,
        right: halfWidth,
        top: halfHeight,
        bottom: -halfHeight,
    };
}

/**
 * 解出五个正交轴向的取景。free/camera 不是正交轴向，返回 null。
 *
 * target 与两条投影跨度来自可见对象的变换包围盒 + 全部摄影机/灯光的位置包围盒；空场景或全部
 * 位置非法（NaN/Infinity）时回落安全默认值，绝不返回会让正交相机退化成无限缩放的 0 值。
 * position 由 target 沿该轴向的视线方向反推，因此永远落在包围盒之外，不会穿模。
 */
export function resolveDirectorOrthographicFraming(input: { scene: DirectorScene; mode: DirectorViewMode }): DirectorOrthographicFraming | null {
    if (!isDirectorOrthographicAxis(input.mode)) return null;
    const axis = DIRECTOR_ORTHOGRAPHIC_AXES[input.mode];
    const bounds = resolveDirectorFramingBounds(collectDirectorFramingPoints(input.scene));
    const radius = Math.max(...bounds.extent) / 2;
    const distance = Math.max(radius * DIRECTOR_ORTHOGRAPHIC_DISTANCE_FACTOR, DIRECTOR_ORTHOGRAPHIC_MIN_EXTENT);
    const target = bounds.center;
    const position: DirectorVec3 = [target[0] - axis.view[0] * distance, target[1] - axis.view[1] * distance, target[2] - axis.view[2] * distance];
    return {
        position,
        target,
        up: axis.up,
        horizontalSpan: bounds.extent[axis.horizontal] * DIRECTOR_ORTHOGRAPHIC_MARGIN,
        verticalSpan: bounds.extent[axis.vertical] * DIRECTOR_ORTHOGRAPHIC_MARGIN,
        near: DIRECTOR_ORTHOGRAPHIC_NEAR,
        far: distance + radius * DIRECTOR_ORTHOGRAPHIC_FAR_MARGIN,
    };
}
