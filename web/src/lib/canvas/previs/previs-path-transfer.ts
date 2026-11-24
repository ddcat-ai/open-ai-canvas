import { createPrevisCameraMove } from "@/lib/canvas/previs/previs-camera-moves";
import { applyPrevisMotionPath, isPrevisPathKeyframe, planPrevisMotionPath } from "@/lib/canvas/previs/previs-motion-path";
import type { PrevisMotionPath, PrevisScene, PrevisVec3 } from "@/types/previs";

/**
 * 「人物沿这条轨迹走，镜头跟着」：把摄影机路径、对象路径或参考轨迹交给一个演员，并按选择调整镜头。
 *
 * 镜头方式：
 * - trail：镜头沿同一条轨迹、晚 lag 秒出发，跟在人物后面，同时始终盯住人物（推荐，对应「镜头跟随运镜」）。
 * - follow：去掉镜头自己的路径，改为跟拍人物（后方）。
 * - keep：镜头保留原来的路径，只是始终盯住人物。
 * - none：镜头不动。
 *
 * 人物默认贴地行走（轨迹高度清零）；keepHeight 时按轨迹高度悬空飞行。
 * 人物与轨迹来源用同一套速率、运动规律、停留，所以人物的移动节奏就是画运镜时的节奏。
 */
export type PrevisPathCameraMode = "trail" | "follow" | "keep" | "none";

export const PREVIS_PATH_CAMERA_MODES: Array<{ value: PrevisPathCameraMode; label: string; hint: string }> = [
    { value: "trail", label: "镜头沿同一轨迹跟在后面", hint: "镜头晚一点出发、走同一条轨迹，始终对着人物" },
    { value: "follow", label: "镜头改为跟拍人物", hint: "去掉镜头原轨迹，在人物后方跟着走" },
    { value: "keep", label: "镜头走原轨迹并盯住人物", hint: "镜头路径不变，只是一直看向人物" },
    { value: "none", label: "镜头不变", hint: "只让人物走这条轨迹" },
];

export type PrevisPathSource = { kind: "camera" | "object" | "sketch"; id: string };

export function resolvePrevisPathSource(scene: PrevisScene, source: PrevisPathSource): PrevisMotionPath | null {
    if (source.kind === "camera") return scene.cameras.find((item) => item.id === source.id)?.motionPath ?? null;
    if (source.kind === "object") return scene.objects.find((item) => item.id === source.id)?.motionPath ?? null;
    const sketch = scene.paths?.find((item) => item.id === source.id);
    if (!sketch || sketch.points.length < 2) return null;
    return { points: sketch.points.map((point) => [...point] as PrevisVec3), speed: "walk", metersPerSecond: 1.4, startDelay: 0, orientToPath: true, curve: false };
}

/** 跟随镜头用的人眼高度（米）：参考轨迹贴地时把镜头抬到人物头部稍上方。 */
const TRAIL_EYE_HEIGHT = 1.8;

export function transferPrevisPathToActor(
    scene: PrevisScene,
    input: { source: PrevisPathSource; actorId: string; keepHeight: boolean; cameraId?: string; cameraMode: PrevisPathCameraMode; lag?: number; shotDuration: number; startDelay?: number },
): PrevisScene {
    const sourcePath = resolvePrevisPathSource(scene, input.source);
    if (!sourcePath) throw new Error("没有找到这条轨迹");
    const actor = scene.objects.find((item) => item.id === input.actorId);
    if (!actor) throw new Error("没有找到这个人物");
    const startDelay = input.startDelay ?? sourcePath.startDelay;
    const actorPath: PrevisMotionPath = { ...sourcePath, startDelay, orientToPath: true, points: sourcePath.points.map(([x, y, z]) => [x, input.keepHeight ? Math.max(0, y) : 0, z] as PrevisVec3) };
    const movedActor = applyPrevisMotionPath(actor, actorPath, input.shotDuration, true);
    const plan = planPrevisMotionPath(movedActor.motionPath!, input.shotDuration);
    let next: PrevisScene = { ...scene, objects: scene.objects.map((item) => (item.id === actor.id ? { ...item, keyframes: movedActor.keyframes, motionPath: movedActor.motionPath, travels: undefined } : item)) };
    const camera = input.cameraMode === "none" ? undefined : next.cameras.find((item) => item.id === input.cameraId);
    if (!camera) return next;

    // 先去掉会和新镜头方式打架的旧跟拍 / 跟摇。
    let moves = (camera.moves ?? []).filter((move) => move.technique !== "follow" && move.technique !== "look_at");
    let cameraPatch: Partial<typeof camera> = {};
    const lookStart = plan.start;
    if (input.cameraMode === "trail") {
        const lag = Math.max(0, input.lag ?? 0.8);
        const fromCamera = input.source.kind === "camera" && input.source.id === camera.id;
        const trailPath: PrevisMotionPath = {
            ...sourcePath,
            orientToPath: false,
            startDelay: Math.min(input.shotDuration, startDelay + lag),
            points: sourcePath.points.map(([x, y, z]) => [x, fromCamera ? y : Math.max(y, 0) + TRAIL_EYE_HEIGHT, z] as PrevisVec3),
        };
        const trailed = applyPrevisMotionPath(camera, trailPath, input.shotDuration, false);
        cameraPatch = { keyframes: trailed.keyframes, motionPath: trailed.motionPath };
    } else if (input.cameraMode === "follow") {
        cameraPatch = { keyframes: camera.motionPath ? camera.keyframes.filter((key) => !isPrevisPathKeyframe(key, camera.id)) : camera.keyframes, motionPath: undefined };
        moves = [...moves, createPrevisCameraMove({ technique: "follow", start: lookStart, subjectId: actor.id, params: { side: "behind", lag: 0.3 } }, input.shotDuration)];
    }
    if (input.cameraMode === "trail" || input.cameraMode === "keep") moves = [...moves, createPrevisCameraMove({ technique: "look_at", start: 0, subjectId: actor.id }, input.shotDuration)];
    next = { ...next, cameras: next.cameras.map((item) => (item.id === camera.id ? { ...item, ...cameraPatch, moves: moves.length ? moves.toSorted((left, right) => left.start - right.start) : undefined } : item)) };
    return next;
}
