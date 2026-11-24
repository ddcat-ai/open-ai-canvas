import { simplifyPrevisPath } from "@/lib/canvas/previs/previs-path";
import type { PrevisKeyframe, PrevisMotionPath, PrevisPathEasing, PrevisSketchPath, PrevisTransform, PrevisVec3 } from "@/types/previs";

/**
 * 路径动画：途经点（带离地高度）+ 速率 + 每段速度倍率 + 停留 + 运动规律 + 折线 / 平滑曲线，
 * 展开成 transform 关键帧。关键帧是渲染、录制、Agent 读取的唯一时间真源。
 *
 * 后端 cloud_agent_previs_path.go 用完全相同的规则展开 Agent 写入的路径，两边改动需同步；
 * web/test/previs-motion-path.test.ts 与 cloud_agent_previs_path_test.go 用同一组数值互相校对。
 *
 * 规则：
 * - 几何：折线直接用途经点；平滑曲线用均匀 Catmull-Rom，每段细分 S = clamp(floor(200 / 段数), 1, 8)。
 * - 速度：每条边用时 = 边长（三维）/（基准速度 × 该段倍率）；给了 duration 时整体缩放到该用时。
 * - 停留：到达第 i 个途经点后原地停 holds[i] 秒（首点为出发前等待，末点忽略）。
 * - 镜头放不下（startDelay + 移动 + 停留 > 镜头时长）时整体等比压缩。
 * - 运动规律按「两次停留之间的一段」生效：匀速在每个顶点写帧；加速 / 减速 / 缓入缓出按时间均匀采样（每秒 10 帧，全程最多约 200 帧）。
 * - startDelay > 0 时在 0 秒写一帧原地等待（id 后缀 hold）。
 * - 演员：位置 Y 锁 0，高度写进关键帧 lift；其他对象高度直接写进位置 Y。
 */

export const PREVIS_PATH_MAX_POINTS = 64;
const MAX_SAMPLES = 200;
const SAMPLE_RATE = 10;

export const PREVIS_PATH_EASINGS: Array<{ value: PrevisPathEasing; label: string; hint: string }> = [
    { value: "linear", label: "匀速", hint: "全程速度不变" },
    { value: "ease_in", label: "加速", hint: "从静止逐渐加快" },
    { value: "ease_out", label: "减速", hint: "逐渐慢下来停住" },
    { value: "smooth", label: "缓入缓出", hint: "起步加速、到点减速" },
];

export const PREVIS_PATH_SPEED_PRESETS: Array<{ value: number; label: string }> = [
    { value: 0.7, label: "慢走" },
    { value: 1.4, label: "步行" },
    { value: 3.5, label: "跑步" },
    { value: 6.5, label: "冲刺" },
    { value: 12, label: "车速" },
    { value: 25, label: "飞掠" },
];

const PRESET_SPEED: Record<PrevisMotionPath["speed"], number> = { slow: 0.7, walk: 1.4, run: 3.5 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const distance = (a: PrevisVec3, b: PrevisVec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

export function previsPathEase(easing: PrevisPathEasing | undefined, value: number) {
    const w = clamp(value, 0, 1);
    if (easing === "ease_in") return w * w;
    if (easing === "ease_out") return 1 - (1 - w) * (1 - w);
    if (easing === "smooth") return w * w * (3 - 2 * w);
    return w;
}

/** 基准速度（米/秒）：自定义速度优先，其次速度档。 */
export function resolvePrevisPathSpeed(path: Pick<PrevisMotionPath, "speed" | "metersPerSecond">) {
    const custom = path.metersPerSecond;
    if (typeof custom === "number" && Number.isFinite(custom) && custom > 0) return clamp(custom, 0.05, 100);
    return PRESET_SPEED[path.speed] ?? PRESET_SPEED.walk;
}

/** 与米/秒最接近的速度档，写给只认档位的旧客户端与后端校验。 */
export function previsPathSpeedPreset(metersPerSecond: number): PrevisMotionPath["speed"] {
    if (metersPerSecond < 1.05) return "slow";
    return metersPerSecond < 2.45 ? "walk" : "run";
}

export type PrevisPathGeometry = {
    vertices: PrevisVec3[];
    /** 每个途经点在 vertices 里的下标。 */
    waypointVertex: number[];
    /** 每条边（vertices[j] → vertices[j+1]）属于第几段。 */
    edgeSegment: number[];
};

/** 折线或均匀 Catmull-Rom 平滑曲线；曲线经过每个途经点。 */
export function previsPathGeometry(points: readonly PrevisVec3[], curve: boolean): PrevisPathGeometry {
    const count = points.length;
    if (!curve || count < 3) return { vertices: points.map((point) => [...point] as PrevisVec3), waypointVertex: points.map((_, index) => index), edgeSegment: points.slice(1).map((_, index) => index) };
    const subdivisions = clamp(Math.floor(MAX_SAMPLES / (count - 1)), 1, 8);
    const vertices: PrevisVec3[] = [];
    const waypointVertex: number[] = [];
    const edgeSegment: number[] = [];
    for (let segment = 0; segment < count - 1; segment += 1) {
        const p0 = points[Math.max(0, segment - 1)];
        const p1 = points[segment];
        const p2 = points[segment + 1];
        const p3 = points[Math.min(count - 1, segment + 2)];
        waypointVertex.push(vertices.length);
        for (let step = 0; step < subdivisions; step += 1) {
            const t = step / subdivisions;
            const t2 = t * t;
            const t3 = t2 * t;
            const axis = (index: 0 | 1 | 2) => 0.5 * (2 * p1[index] + (-p0[index] + p2[index]) * t + (2 * p0[index] - 5 * p1[index] + 4 * p2[index] - p3[index]) * t2 + (-p0[index] + 3 * p1[index] - 3 * p2[index] + p3[index]) * t3);
            vertices.push(step === 0 ? ([...p1] as PrevisVec3) : [axis(0), axis(1), axis(2)]);
            edgeSegment.push(segment);
        }
    }
    waypointVertex.push(vertices.length);
    vertices.push([...points[count - 1]] as PrevisVec3);
    return { vertices, waypointVertex, edgeSegment };
}

export type PrevisMotionPathPlan = {
    geometry: PrevisPathGeometry;
    /** 每条边的用时（已含 duration 缩放与镜头压缩）。 */
    edgeTimes: number[];
    /** 每个途经点的停留（已压缩）。 */
    holds: number[];
    start: number;
    /** 路径三维长度（米）。 */
    length: number;
    /** 移动用时（不含停留）。 */
    travel: number;
    /** 结束时间（含停留）。 */
    end: number;
    /** 镜头放不下时被等比压缩。 */
    compressed: boolean;
    /** 镜头结束时才出发：画面内不移动。 */
    stationary: boolean;
};

/** 路径时间规划；路径无效（点数、坐标、长度）时抛出中文错误。 */
export function planPrevisMotionPath(path: PrevisMotionPath, shotDuration: number): PrevisMotionPathPlan {
    const points = path.points;
    if (points.length < 2 || points.length > PREVIS_PATH_MAX_POINTS) throw new Error(`路径需要 2 到 ${PREVIS_PATH_MAX_POINTS} 个途经点`);
    if (!points.every((point) => point.length === 3 && point.every(Number.isFinite))) throw new Error("路径点坐标无效");
    const geometry = previsPathGeometry(points, Boolean(path.curve));
    const speed = resolvePrevisPathSpeed(path);
    const segmentSpeed = (segment: number) => {
        const value = path.speeds?.[segment];
        return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0.1, 10) : 1;
    };
    const lengths = geometry.edgeSegment.map((_, index) => distance(geometry.vertices[index], geometry.vertices[index + 1]));
    const length = lengths.reduce((sum, value) => sum + value, 0);
    if (length < 0.01) throw new Error("路径起终点过近，无法形成移动");
    let edgeTimes = lengths.map((value, index) => value / (speed * segmentSpeed(geometry.edgeSegment[index])));
    let travel = edgeTimes.reduce((sum, value) => sum + value, 0);
    if (typeof path.duration === "number" && Number.isFinite(path.duration) && path.duration > 0) {
        const factor = clamp(path.duration, 0.1, 60) / travel;
        edgeTimes = edgeTimes.map((value) => value * factor);
        travel *= factor;
    }
    let holds = points.map((_, index) => {
        const value = path.holds?.[index];
        return index < points.length - 1 && typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 60) : 0;
    });
    const total = Number.isFinite(shotDuration) && shotDuration > 0 ? shotDuration : 5;
    const start = clamp(Number.isFinite(path.startDelay) ? path.startDelay : 0, 0, total);
    const available = total - start;
    const holdTotal = holds.reduce((sum, value) => sum + value, 0);
    if (available <= 0.05) return { geometry, edgeTimes, holds, start, length, travel, end: start, compressed: false, stationary: true };
    let compressed = false;
    if (travel + holdTotal > available) {
        const factor = available / (travel + holdTotal);
        edgeTimes = edgeTimes.map((value) => value * factor);
        holds = holds.map((value) => value * factor);
        travel *= factor;
        compressed = true;
    }
    return { geometry, edgeTimes, holds, start, length, travel, end: start + travel + holds.reduce((sum, value) => sum + value, 0), compressed, stationary: false };
}

/** 把路径展开成关键帧。id 用于生成稳定关键帧 id（`<id>-path-<n>` / `<id>-path-hold`）。 */
export function buildPrevisMotionPathKeyframes(input: { id: string; base: PrevisTransform; path: PrevisMotionPath; shotDuration: number; locked: boolean }): PrevisKeyframe[] {
    const { id, base, path, locked } = input;
    const plan = planPrevisMotionPath(path, input.shotDuration);
    const { vertices, waypointVertex } = plan.geometry;
    const orient = Boolean(path.orientToPath);
    let lastYaw = base.rotation[1];
    const heading = (from: PrevisVec3, to: PrevisVec3) => {
        if (!orient) return base.rotation[1];
        const dx = to[0] - from[0];
        const dz = to[2] - from[2];
        if (Math.hypot(dx, dz) > 1e-5) lastYaw = Math.atan2(dx, dz);
        return lastYaw;
    };
    const vertexYaw = (index: number) => heading(vertices[Math.max(0, index - 1)], vertices[Math.min(vertices.length - 1, index + 1)]);
    const frames: PrevisKeyframe[] = [];
    let counter = 0;
    const push = (time: number, point: PrevisVec3, yaw: number, suffix?: string) => {
        const rounded = round3(time);
        const previous = frames[frames.length - 1];
        if (previous && rounded <= previous.time + 1e-4) return;
        const height = round4(Math.max(locked ? 0 : -1e9, point[1]));
        const frame: PrevisKeyframe = {
            id: `${id}-path-${suffix ?? ++counter}`,
            time: rounded,
            easing: "linear",
            transform: { position: [round4(point[0]), locked ? 0 : height, round4(point[2])], rotation: [base.rotation[0], yaw, base.rotation[2]], scale: base.scale },
        };
        if (locked && height > 1e-4) frame.lift = height;
        frames.push(frame);
    };
    if (plan.stationary) {
        push(plan.start, vertices[0], vertexYaw(0), "hold");
        return frames;
    }
    if (plan.start > 0) push(0, vertices[0], vertexYaw(0), "hold");
    let time = plan.start;
    push(time, vertices[0], vertexYaw(0));
    if (plan.holds[0] > 0) {
        time += plan.holds[0];
        push(time, vertices[0], vertexYaw(0));
    }
    // 两次停留之间是一段，运动规律在段内生效。
    const legs: Array<[number, number, number]> = [];
    let legStart = 0;
    for (let waypoint = 1; waypoint < waypointVertex.length; waypoint += 1) {
        const last = waypoint === waypointVertex.length - 1;
        if (last || plan.holds[waypoint] > 0) {
            legs.push([waypointVertex[legStart], waypointVertex[waypoint], waypoint]);
            legStart = waypoint;
        }
    }
    const easing = path.easing ?? "linear";
    const rate = plan.travel * SAMPLE_RATE > MAX_SAMPLES ? MAX_SAMPLES / plan.travel : SAMPLE_RATE;
    for (const [from, to, waypoint] of legs) {
        const cumulative = [0];
        for (let edge = from; edge < to; edge += 1) cumulative.push(cumulative[cumulative.length - 1] + plan.edgeTimes[edge]);
        const legTime = cumulative[cumulative.length - 1];
        if (easing === "linear") {
            for (let vertex = from + 1; vertex <= to; vertex += 1) push(time + cumulative[vertex - from], vertices[vertex], vertexYaw(vertex));
        } else {
            const samples = Math.max(2, Math.ceil(legTime * rate));
            let edge = 0;
            for (let step = 1; step <= samples; step += 1) {
                const w = step / samples;
                const target = previsPathEase(easing, w) * legTime;
                while (edge < to - from - 1 && cumulative[edge + 1] < target) edge += 1;
                const span = cumulative[edge + 1] - cumulative[edge];
                const k = span > 1e-9 ? clamp((target - cumulative[edge]) / span, 0, 1) : 1;
                const a = vertices[from + edge];
                const b = vertices[from + edge + 1];
                const point: PrevisVec3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
                push(time + w * legTime, point, step === samples ? vertexYaw(from + edge + 1) : heading(a, b));
            }
        }
        time += legTime;
        const hold = plan.holds[waypoint] ?? 0;
        if (hold > 0) {
            time += hold;
            push(time, vertices[to], vertexYaw(to));
        }
    }
    return frames;
}

/** 关键帧是否由路径展开（时间轴把它们收成一段，不逐帧显示）。 */
export function isPrevisPathKeyframe(keyframe: Pick<PrevisKeyframe, "id">, ownerId: string) {
    return keyframe.id.startsWith(`${ownerId}-path-`);
}

/** 写入路径：生成关键帧并替换对象的全部 transform 关键帧（与画走位一致）。失败抛错，调用方提示。 */
export function applyPrevisMotionPath<T extends { id: string; transform: PrevisTransform; keyframes: PrevisKeyframe[]; motionPath?: PrevisMotionPath }>(item: T, path: PrevisMotionPath, shotDuration: number, locked: boolean): T {
    const normalized = normalizePrevisMotionPath(path, locked);
    const keyframes = buildPrevisMotionPathKeyframes({ id: item.id, base: item.transform, path: normalized, shotDuration, locked });
    return { ...item, keyframes, motionPath: normalized };
}

/** 清掉多余的数组项、截断数值；演员与道具高度不低于地面。 */
export function normalizePrevisMotionPath(path: PrevisMotionPath, locked: boolean): PrevisMotionPath {
    const points = path.points.slice(0, PREVIS_PATH_MAX_POINTS).map((point) => [point[0], locked ? Math.max(0, point[1]) : point[1], point[2]] as PrevisVec3);
    const next: PrevisMotionPath = { points, speed: path.speed ?? "walk", startDelay: Math.max(0, Number.isFinite(path.startDelay) ? path.startDelay : 0), orientToPath: Boolean(path.orientToPath) };
    if (typeof path.metersPerSecond === "number" && Number.isFinite(path.metersPerSecond) && path.metersPerSecond > 0) {
        next.metersPerSecond = clamp(path.metersPerSecond, 0.05, 100);
        next.speed = previsPathSpeedPreset(next.metersPerSecond);
    }
    if (typeof path.duration === "number" && Number.isFinite(path.duration) && path.duration > 0) next.duration = clamp(path.duration, 0.1, 60);
    if (path.easing && path.easing !== "linear") next.easing = path.easing;
    if (path.curve) next.curve = true;
    const speeds = points.slice(1).map((_, index) => clamp(path.speeds?.[index] ?? 1, 0.1, 10));
    if (speeds.some((value) => value !== 1)) next.speeds = speeds;
    const holds = points.map((_, index) => (index < points.length - 1 ? clamp(path.holds?.[index] ?? 0, 0, 60) : 0));
    if (holds.some((value) => value > 0)) next.holds = holds;
    return next;
}

/** 在第 index 个点之后插入途经点（取与下一点的中点；末点之后沿方向延长 1 米），保持速度倍率与停留对齐。 */
export function insertPrevisPathPoint(path: PrevisMotionPath, index: number, point?: PrevisVec3): PrevisMotionPath {
    if (path.points.length >= PREVIS_PATH_MAX_POINTS) return path;
    const at = clamp(Math.round(index), 0, path.points.length - 1);
    const current = path.points[at];
    const next = path.points[at + 1];
    const previous = path.points[at - 1] ?? current;
    const inserted: PrevisVec3 = point ?? (next ? [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2, (current[2] + next[2]) / 2] : extend(previous, current));
    const points = [...path.points.slice(0, at + 1), inserted, ...path.points.slice(at + 1)];
    const speeds = path.speeds ? [...path.speeds.slice(0, at + 1), path.speeds[at] ?? 1, ...path.speeds.slice(at + 1)] : undefined;
    const holds = path.holds ? [...path.holds.slice(0, at + 1), 0, ...path.holds.slice(at + 1)] : undefined;
    return { ...path, points, speeds, holds };
}

function extend(previous: PrevisVec3, current: PrevisVec3): PrevisVec3 {
    const dx = current[0] - previous[0];
    const dz = current[2] - previous[2];
    const size = Math.hypot(dx, dz);
    return size > 1e-5 ? [current[0] + dx / size, current[1], current[2] + dz / size] : [current[0] + 1, current[1], current[2]];
}

export function removePrevisPathPoint(path: PrevisMotionPath, index: number): PrevisMotionPath {
    if (path.points.length <= 2 || index < 0 || index >= path.points.length) return path;
    const points = path.points.filter((_, itemIndex) => itemIndex !== index);
    const segment = Math.min(index, path.points.length - 2);
    const speeds = path.speeds ? path.speeds.filter((_, itemIndex) => itemIndex !== segment) : undefined;
    const holds = path.holds ? path.holds.filter((_, itemIndex) => itemIndex !== index) : undefined;
    return { ...path, points, speeds, holds };
}

export function updatePrevisPathPoint(path: PrevisMotionPath, index: number, point: Partial<{ x: number; y: number; z: number }>): PrevisMotionPath {
    if (index < 0 || index >= path.points.length) return path;
    const points = path.points.map((item, itemIndex) => (itemIndex === index ? ([point.x ?? item[0], point.y ?? item[1], point.z ?? item[2]] as PrevisVec3) : item));
    return { ...path, points };
}

/**
 * 画笔笔迹 → 途经点：去抖并保留拐角，点数控制在 24 个以内（每个点都能在检查器里编辑）。
 */
export function previsPathPointsFromStroke(points: readonly PrevisVec3[], maxPoints = 24): PrevisVec3[] {
    // 笔迹会用平滑曲线连接，途经点只需描出拐弯；0.2 米以内的抖动不保留。
    let tolerance = 0.2;
    let simplified = simplifyPrevisPath(points, tolerance);
    while (simplified.length > maxPoints && tolerance < 50) {
        tolerance *= 1.6;
        simplified = simplifyPrevisPath(points, tolerance);
    }
    return simplified;
}

/** 路径显示用的几何（曲线已细分），点的 Y 为离地高度。 */
export function previsMotionPathDisplayPoints(path: Pick<PrevisMotionPath, "points" | "curve">): PrevisVec3[] {
    return previsPathGeometry(path.points, Boolean(path.curve)).vertices;
}

export function nextPrevisSketchPathLabel(paths: readonly PrevisSketchPath[] = []) {
    const used = new Set(paths.map((item) => item.label));
    let index = 1;
    while (used.has(`路径${index}`)) index += 1;
    return `路径${index}`;
}

/** 一句话说明，用于检查器与提示词：「12.4 米 · 1.0–7.2s · 缓入缓出 · 最高离地 3 米」。 */
export function describePrevisMotionPath(path: PrevisMotionPath, plan: PrevisMotionPathPlan | null) {
    const parts: string[] = [];
    if (plan) parts.push(`${plan.length.toFixed(1)} 米`, `${plan.start.toFixed(1)}–${plan.end.toFixed(1)}s`);
    parts.push(PREVIS_PATH_EASINGS.find((item) => item.value === (path.easing ?? "linear"))?.label ?? "匀速");
    const top = Math.max(...path.points.map((point) => point[1]));
    if (top > 0.05) parts.push(`最高离地 ${top.toFixed(1)} 米`);
    if (path.curve) parts.push("平滑曲线");
    return parts.join(" · ");
}
