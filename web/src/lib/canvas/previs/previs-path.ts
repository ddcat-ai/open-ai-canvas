import { nanoid } from "nanoid";

import type { PrevisKeyframe, PrevisTransform, PrevisVec3 } from "@/types/previs";

export type PrevisPathWaypoint = {
    time: number;
    position: PrevisVec3;
};

const POINT_EPSILON = 1e-5;

function finitePoint(point: readonly number[]): point is PrevisVec3 {
    return point.length === 3 && point.every(Number.isFinite);
}

function pointDistance(a: PrevisVec3, b: PrevisVec3) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function segmentDistance(point: PrevisVec3, start: PrevisVec3, end: PrevisVec3) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    if (lengthSquared <= POINT_EPSILON) return pointDistance(point, start);
    const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy + (point[2] - start[2]) * dz) / lengthSquared));
    return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t), point[2] - (start[2] + dz * t));
}

/** Removes invalid/repeated samples and preserves meaningful corners in 3D. */
export function simplifyPrevisPath(points: readonly PrevisVec3[], tolerance = 0.025): PrevisVec3[] {
    if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error("轨迹精度无效");
    const clean: PrevisVec3[] = [];
    for (const point of points) {
        if (!finitePoint(point)) continue;
        const next = [...point] as PrevisVec3;
        if (!clean.length || pointDistance(clean[clean.length - 1], next) > POINT_EPSILON) clean.push(next);
    }
    if (clean.length < 3) return clean;
    const keep = new Set<number>([0, clean.length - 1]);
    const stack: Array<[number, number]> = [[0, clean.length - 1]];
    while (stack.length) {
        const [start, end] = stack.pop()!;
        let farthestIndex = -1;
        let farthestDistance = tolerance;
        for (let index = start + 1; index < end; index += 1) {
            const distance = segmentDistance(clean[index], clean[start], clean[end]);
            if (distance > farthestDistance) {
                farthestDistance = distance;
                farthestIndex = index;
            }
        }
        if (farthestIndex >= 0) {
            keep.add(farthestIndex);
            stack.push([start, farthestIndex], [farthestIndex, end]);
        }
    }
    return [...keep].sort((a, b) => a - b).map((index) => clean[index]);
}

/** Maps points to time by travelled distance, independent of pointer speed/event count. */
export function timePrevisPath(points: readonly PrevisVec3[], start: number, duration: number): PrevisPathWaypoint[] {
    if (!Number.isFinite(start) || start < 0) throw new Error("轨迹起始时间无效");
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("轨迹时长无效");
    const clean: PrevisVec3[] = [];
    for (const point of points) {
        if (!finitePoint(point)) continue;
        const next = [...point] as PrevisVec3;
        if (!clean.length || pointDistance(clean[clean.length - 1], next) > POINT_EPSILON) clean.push(next);
    }
    if (!clean.length) return [];
    if (clean.length === 1) return [{ time: start, position: clean[0] }];
    const lengths = clean.map((point, index) => index === 0 ? 0 : pointDistance(clean[index - 1], point));
    const total = lengths.reduce((sum, value) => sum + value, 0);
    if (total <= POINT_EPSILON) return [{ time: start, position: clean[0] }];
    let travelled = 0;
    return clean.map((position, index) => {
        travelled += lengths[index];
        return { time: index === clean.length - 1 ? start + duration : start + (travelled / total) * duration, position };
    });
}

export function previsPathHeading(points: readonly PrevisVec3[], index: number, fallback = 0) {
    if (points.length < 2) return fallback;
    const current = points[Math.max(0, Math.min(index, points.length - 1))];
    const next = points[Math.min(points.length - 1, Math.max(0, index + 1))];
    const previous = points[Math.max(0, index - 1)];
    const forward = pointDistance(current, next) > POINT_EPSILON ? next : current;
    const backward = pointDistance(previous, current) > POINT_EPSILON ? previous : current;
    const dx = forward[0] - backward[0];
    const dz = forward[2] - backward[2];
    return Math.hypot(dx, dz) > POINT_EPSILON ? Math.atan2(dx, dz) : fallback;
}

export function buildPrevisPathKeyframes(input: {
    base: PrevisTransform;
    points: readonly PrevisVec3[];
    start?: number;
    duration: number;
    orientToPath?: boolean;
}): PrevisKeyframe[] {
    const start = input.start ?? 0;
    const simplified = simplifyPrevisPath(input.points, 0.025);
    const waypoints = timePrevisPath(simplified, start, input.duration);
    return waypoints.map((waypoint, index) => ({
        id: nanoid(),
        time: waypoint.time,
        easing: "smooth",
        transform: {
            position: waypoint.position,
            rotation: input.orientToPath ? [input.base.rotation[0], previsPathHeading(waypoints.map((item) => item.position), index, input.base.rotation[1]), input.base.rotation[2]] : input.base.rotation,
            scale: input.base.scale,
        },
    }));
}
