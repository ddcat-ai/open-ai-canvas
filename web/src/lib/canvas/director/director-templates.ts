import { nanoid } from "nanoid";

import { createDirectorActor, createDirectorCamera, createDirectorLight, createDirectorObject, directorFocalLengthToFov, DIRECTOR_ACTOR_COLORS } from "@/lib/canvas/director/director-scene";
import type { DirectorCamera, DirectorLight, DirectorObject, DirectorScene, DirectorShot } from "@/types/director";

/**
 * 新建场景模板。
 *
 * 为什么存在：createDirectorScene 无条件塞一个默认演员，产品/空场景根本不需要它，
 * 而双人、走位这类常见开局每次都要手工摆一遍。模板把「开局布局」变成显式选择。
 *
 * 硬约束：
 * - 纯函数 + 确定性布局。同一模板每次生成的结构完全一致，只有 id 与时间戳不同。
 * - 每次调用都产生独立 id（工厂内部 nanoid），两个实例不会共享对象身份。
 * - 不改 DirectorScene schema/version：模板只是预填内容，不引入新字段。
 * - 对象之间 XZ 占位不重叠，判据与 resolveDirectorPlacement 完全一致。
 */

export type DirectorTemplateId = "empty" | "monologue" | "dialogue" | "blocking" | "product";

export type DirectorTemplate = {
    id: DirectorTemplateId;
    name: string;
    description: string;
    /** 列表里给用户的预期提示，不参与生成。 */
    summary: string;
};

/** 展示顺序即用户看到的顺序：空场景在最前，其余按上手复杂度递增。 */
export const DIRECTOR_TEMPLATES: DirectorTemplate[] = [
    { id: "empty", name: "空场景", description: "只有摄影机和三点布光，没有任何演员或道具。", summary: "摄影机 + 布光" },
    { id: "monologue", name: "单人对白", description: "一名演员居中，中近景机位，适合独白与特写。", summary: "1 演员 · 中近景" },
    { id: "dialogue", name: "双人对话", description: "两名演员面对面分立左右，过肩机位起手。", summary: "2 演员 · 对话机位" },
    { id: "blocking", name: "人物走位", description: "三名演员分散站位，广角机位便于安排走动路线。", summary: "3 演员 · 广角" },
    { id: "product", name: "产品/道具镜头", description: "产品置于中心，背景板与侧面道具就位，长焦特写。", summary: "产品 + 背景板 · 长焦" },
];

type TemplateBlueprint = {
    objects: DirectorObject[];
    camera: DirectorCamera;
    shot: Omit<DirectorShot, "id" | "cameraId">;
};

/**
 * 三点布光：主光、轮廓光、环境光。
 * 五个模板共用同一套光位，避免模板之间打光风格漂移。
 */
function threePointRig(): DirectorLight[] {
    return [createDirectorLight("directional", "主光", [4, 6, 4], 2.4), createDirectorLight("directional", "轮廓光", [-4, 3, -2], 1.1), createDirectorLight("ambient", "环境光", [0, 0, 0], 0.65)];
}

/** 按模板意图摆机位。focalLength 与 fov 一起写，保证两者自洽。 */
function templateCamera(input: { name: string; position: DirectorCamera["transform"]["position"]; target: DirectorCamera["target"]; focalLength: number; focusDistance: number; aperture: number }): DirectorCamera {
    const base = createDirectorCamera(input.name);
    return {
        ...base,
        transform: { ...base.transform, position: input.position },
        target: input.target,
        focalLength: input.focalLength,
        fov: directorFocalLengthToFov(input.focalLength),
        aperture: input.aperture,
        focusDistance: input.focusDistance,
    };
}

/** 演员朝向：绕 Y 轴。左侧演员朝右为 +PI/2，右侧演员朝左为 -PI/2。 */
function facing(actor: DirectorObject, yaw: number): DirectorObject {
    return { ...actor, transform: { ...actor.transform, rotation: [0, yaw, 0] } };
}

function buildBlueprint(id: DirectorTemplateId): TemplateBlueprint {
    if (id === "monologue") {
        return {
            objects: [createDirectorActor("演员 1", [0, 0, 0], DIRECTOR_ACTOR_COLORS[0])],
            camera: templateCamera({ name: "主摄影机", position: [1.5, 1.65, 3.1], target: [0, 1.15, 0], focalLength: 50, focusDistance: 3.4, aperture: 2.2 }),
            shot: { name: "镜头 1", duration: 5, fps: 24, shotSize: "medium", cameraMove: "static", prompt: "" },
        };
    }

    if (id === "dialogue") {
        // dx = 1.6 >= (0.8 + 0.8) / 2 + 0.25 = 1.05，两名演员必然不重叠。
        return {
            objects: [facing(createDirectorActor("演员 1", [-0.8, 0, 0.3], DIRECTOR_ACTOR_COLORS[0]), Math.PI / 2), facing(createDirectorActor("演员 2", [0.8, 0, -0.3], DIRECTOR_ACTOR_COLORS[2]), -Math.PI / 2)],
            camera: templateCamera({ name: "主摄影机", position: [2.9, 1.7, 3.4], target: [0, 1.1, 0], focalLength: 40, focusDistance: 4.2, aperture: 2.8 }),
            shot: { name: "镜头 1", duration: 6, fps: 24, shotSize: "medium", cameraMove: "static", prompt: "" },
        };
    }

    if (id === "blocking") {
        // 三名演员两两 dx >= 1.8，全部大于 1.05 阈值。
        return {
            objects: [createDirectorActor("演员 1", [-1.8, 0, 0.6], DIRECTOR_ACTOR_COLORS[0]), createDirectorActor("演员 2", [0, 0, -0.4], DIRECTOR_ACTOR_COLORS[2]), createDirectorActor("演员 3", [1.8, 0, 0.8], DIRECTOR_ACTOR_COLORS[3])],
            camera: templateCamera({ name: "主摄影机", position: [0.6, 3.1, 7.4], target: [0, 1, 0], focalLength: 28, focusDistance: 7.6, aperture: 4 }),
            shot: { name: "镜头 1", duration: 8, fps: 24, shotSize: "wide", cameraMove: "static", prompt: "" },
        };
    }

    if (id === "product") {
        // 产品镜头没有演员。背景板靠 dz=1.35 拉开，侧面道具靠 dx=1.15 拉开。
        const product = createDirectorObject("box", "产品主体", [0, 0.5, 0], "#b8c0ca");
        const backdrop = createDirectorObject("plane", "背景板", [0, 1.4, -1.35], "#e8ebef");
        const prop = createDirectorObject("cylinder", "侧面道具", [1.15, 0.4, 0.5], "#8795a5");
        return {
            objects: [
                { ...product, transform: { ...product.transform, scale: [0.9, 0.9, 0.9] } },
                { ...backdrop, transform: { ...backdrop.transform, scale: [3.2, 2, 1] } },
                { ...prop, transform: { ...prop.transform, scale: [0.5, 0.8, 0.5] } },
            ],
            camera: templateCamera({ name: "主摄影机", position: [1.1, 1.05, 2.35], target: [0, 0.55, 0], focalLength: 85, focusDistance: 2.6, aperture: 2.8 }),
            shot: { name: "镜头 1", duration: 4, fps: 24, shotSize: "close_up", cameraMove: "push_in", prompt: "" },
        };
    }

    return {
        objects: [],
        camera: templateCamera({ name: "主摄影机", position: [4.8, 2.7, 6.8], target: [0, 1, 0], focalLength: 35, focusDistance: 5, aperture: 2.8 }),
        shot: { name: "镜头 1", duration: 5, fps: 24, shotSize: "medium", cameraMove: "static", prompt: "" },
    };
}

/**
 * 按模板生成全新场景。
 * 未知 id 回落到空场景 —— 宁可少给内容，也不要偷偷塞回默认演员。
 */
export function createDirectorSceneFromTemplate(templateId: DirectorTemplateId, title = "未命名场景"): DirectorScene {
    const blueprint = buildBlueprint(templateId);
    const now = new Date().toISOString();
    const shotId = nanoid();
    return {
        id: nanoid(),
        version: 1,
        title,
        background: "#d8dde3",
        environmentIntensity: 0.7,
        gridVisible: true,
        objects: blueprint.objects,
        cameras: [blueprint.camera],
        lights: threePointRig(),
        shots: [{ ...blueprint.shot, id: shotId, cameraId: blueprint.camera.id }],
        activeShotId: shotId,
        createdAt: now,
        updatedAt: now,
    };
}
