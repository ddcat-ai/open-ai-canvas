import { nanoid } from "nanoid";

import type { DirectorCamera, DirectorKeyframe, DirectorLight, DirectorObject, DirectorScene, DirectorTransform, DirectorVec3 } from "@/types/director";

export const directorIdentityTransform = (position: DirectorVec3 = [0, 0, 0]): DirectorTransform => ({ position, rotation: [0, 0, 0], scale: [1, 1, 1] });

export function createDirectorScene(title = "未命名场景"): DirectorScene {
    const now = new Date().toISOString();
    const camera = createDirectorCamera();
    const shotId = nanoid();
    return {
        id: nanoid(),
        version: 1,
        title,
        background: "#d8dde3",
        environmentIntensity: 0.7,
        gridVisible: true,
        objects: [
            createDirectorObject("character", "演员", [0, 0.9, 0], "#9aa6b2"),
            createDirectorObject("box", "前景道具", [1.8, 0.45, 0.8], "#8b7355"),
        ],
        cameras: [camera],
        lights: [createDirectorLight("directional", "主光", [4, 6, 4], 2.4), createDirectorLight("directional", "轮廓光", [-4, 3, -2], 1.1), createDirectorLight("ambient", "环境光", [0, 0, 0], 0.65)],
        shots: [{ id: shotId, name: "镜头 1", cameraId: camera.id, duration: 5, shotSize: "medium", cameraMove: "static", prompt: "" }],
        activeShotId: shotId,
        createdAt: now,
        updatedAt: now,
    };
}

export function createDirectorObject(primitive: DirectorObject["primitive"] = "box", name = "新对象", position: DirectorVec3 = [0, 0.5, 0], color = "#8795a5"): DirectorObject {
    return {
        id: nanoid(),
        name,
        kind: "primitive",
        primitive,
        transform: directorIdentityTransform(position),
        color,
        visible: true,
        castShadow: true,
        receiveShadow: true,
        pose: primitive === "character" ? "stand" : undefined,
        keyframes: [],
    };
}

export function createDirectorModel(input: Pick<DirectorObject, "name" | "storageKey" | "url" | "mimeType" | "assetId">): DirectorObject {
    return { ...createDirectorObject("box", input.name, [0, 0, 0]), ...input, kind: "model", primitive: undefined };
}

export function createDirectorBillboard(name: string, url: string, storageKey?: string, sourceNodeId?: string): DirectorObject {
    return { ...createDirectorObject("plane", name, [0, 1.1, 0], "#ffffff"), kind: "billboard", url, storageKey, sourceNodeId, transform: { position: [0, 1.1, 0], rotation: [0, 0, 0], scale: [1.6, 0.9, 1] } };
}

export function createDirectorCamera(name = "主摄影机"): DirectorCamera {
    return { id: nanoid(), name, transform: directorIdentityTransform([4.8, 2.7, 6.8]), target: [0, 1, 0], focalLength: 35, fov: 50, aperture: 2.8, focusDistance: 5, near: 0.05, far: 500, keyframes: [] };
}

export function createDirectorLight(type: DirectorLight["type"], name: string, position: DirectorVec3, intensity = 1): DirectorLight {
    return { id: nanoid(), name, type, transform: directorIdentityTransform(position), color: "#ffffff", intensity, angle: Math.PI / 4, penumbra: 0.35, castShadow: type !== "ambient" };
}

export function touchDirectorScene(scene: DirectorScene): DirectorScene {
    return { ...scene, updatedAt: new Date().toISOString() };
}

export function upsertDirectorKeyframe(keyframes: DirectorKeyframe[], time: number, transform: DirectorTransform) {
    const current = keyframes.find((item) => Math.abs(item.time - time) < 0.001);
    const next = current ? keyframes.map((item) => (item.id === current.id ? { ...item, transform } : item)) : [...keyframes, { id: nanoid(), time, transform }];
    return next.toSorted((a, b) => a.time - b.time);
}

export function interpolateDirectorTransform(base: DirectorTransform, keyframes: DirectorKeyframe[], time: number): DirectorTransform {
    if (!keyframes.length) return base;
    const previous = [...keyframes].reverse().find((item) => item.time <= time) || keyframes[0];
    const next = keyframes.find((item) => item.time >= time) || keyframes[keyframes.length - 1];
    if (previous.id === next.id) return previous.transform;
    const progress = Math.max(0, Math.min(1, (time - previous.time) / Math.max(next.time - previous.time, 0.001)));
    return {
        position: lerpVec3(previous.transform.position, next.transform.position, progress),
        rotation: lerpVec3(previous.transform.rotation, next.transform.rotation, progress),
        scale: lerpVec3(previous.transform.scale, next.transform.scale, progress),
    };
}

function lerpVec3(from: DirectorVec3, to: DirectorVec3, progress: number): DirectorVec3 {
    return from.map((value, index) => value + (to[index] - value) * progress) as DirectorVec3;
}
