import { describe, expect, test } from "bun:test";

import { resolveDirectorPlacement } from "../src/lib/canvas/director/director-placement";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import { DIRECTOR_TEMPLATES, createDirectorSceneFromTemplate, type DirectorTemplateId } from "../src/lib/canvas/director/director-templates";
import type { DirectorScene } from "../src/types/director";

const ALL_IDS: DirectorTemplateId[] = ["empty", "monologue", "dialogue", "blocking", "product"];

/**
 * 用生产的 resolveDirectorPlacement 当判据：
 * 把某个对象「原地重新摆一次」，若返回值仍是原位置，说明它与其余对象不相交。
 * 这样重叠判据与真实摆放逻辑天然一致，测试里不再复制一份 overlap 数学。
 */
function overlappingNames(scene: DirectorScene): string[] {
    return scene.objects
        .filter((object) => {
            const others = scene.objects.filter((item) => item.id !== object.id);
            const resolved = resolveDirectorPlacement({ object, existing: others });
            return resolved[0] !== object.transform.position[0] || resolved[2] !== object.transform.position[2];
        })
        .map((object) => object.name);
}

describe("模板目录", () => {
    test("恰好提供 5 个模板，顺序固定且空场景在最前", () => {
        expect(DIRECTOR_TEMPLATES.map((item) => item.id)).toEqual(ALL_IDS);
    });

    test("每个模板都有名称、摘要与说明，供选择时判断", () => {
        for (const template of DIRECTOR_TEMPLATES) {
            expect(template.name.length).toBeGreaterThan(0);
            expect(template.summary.length).toBeGreaterThan(0);
            expect(template.description.length).toBeGreaterThan(0);
        }
    });
});

describe("空场景真的没有演员", () => {
    test("empty 模板不含任何对象", () => {
        const scene = createDirectorSceneFromTemplate("empty");
        expect(scene.objects).toEqual([]);
    });

    test("未知模板 id 回落到空场景，绝不偷偷塞回默认演员", () => {
        const scene = createDirectorSceneFromTemplate("nope" as DirectorTemplateId);
        expect(scene.objects).toEqual([]);
    });

    test("对比：兼容用的 createDirectorScene 仍然带默认演员（P0 依赖它，不能改）", () => {
        expect(createDirectorScene("兼容").objects).toHaveLength(1);
    });
});

describe("每个模板都生成可用的 camera / light / shot 布局", () => {
    test("都恰好一台摄影机、一个镜头，且 shot 指向该摄影机", () => {
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            expect(scene.cameras).toHaveLength(1);
            expect(scene.shots).toHaveLength(1);
            expect(scene.shots[0].cameraId).toBe(scene.cameras[0].id);
            expect(scene.activeShotId).toBe(scene.shots[0].id);
        }
    });

    test("都带三点布光，且含一盏环境光", () => {
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            expect(scene.lights).toHaveLength(3);
            expect(scene.lights.some((light) => light.type === "ambient")).toBe(true);
        }
    });

    test("摄影机 focalLength 与 fov 自洽，不会出现焦段与视角矛盾", () => {
        for (const id of ALL_IDS) {
            const camera = createDirectorSceneFromTemplate(id).cameras[0];
            const expected = (2 * Math.atan(36 / (2 * camera.focalLength)) * 180) / Math.PI;
            expect(camera.fov).toBeCloseTo(expected, 6);
        }
    });

    test("演员数量符合模板语义：单人 1、双人 2、走位 3、产品 0", () => {
        const actorCount = (id: DirectorTemplateId) => createDirectorSceneFromTemplate(id).objects.filter((object) => object.kind === "actor").length;
        expect(actorCount("monologue")).toBe(1);
        expect(actorCount("dialogue")).toBe(2);
        expect(actorCount("blocking")).toBe(3);
        expect(actorCount("product")).toBe(0);
    });

    test("产品模板含产品主体与背景板，且没有演员", () => {
        const scene = createDirectorSceneFromTemplate("product");
        expect(scene.objects.map((object) => object.name)).toEqual(["产品主体", "背景板", "侧面道具"]);
        expect(scene.objects.every((object) => object.kind !== "actor")).toBe(true);
    });
});

describe("对象不重叠", () => {
    test("双人、走位、产品模板内部两两不相交", () => {
        for (const id of ["dialogue", "blocking", "product"] as DirectorTemplateId[]) {
            expect(overlappingNames(createDirectorSceneFromTemplate(id))).toEqual([]);
        }
    });

    test("全部模板都满足不相交（含单人与空场景的退化情形）", () => {
        for (const id of ALL_IDS) {
            expect(overlappingNames(createDirectorSceneFromTemplate(id))).toEqual([]);
        }
    });

    test("双人模板两名演员面向彼此", () => {
        const [left, right] = createDirectorSceneFromTemplate("dialogue").objects;
        // 左侧演员在 -X，朝 +X；右侧在 +X，朝 -X。
        expect(left.transform.position[0]).toBeLessThan(0);
        expect(right.transform.position[0]).toBeGreaterThan(0);
        expect(left.transform.rotation[1]).toBeCloseTo(Math.PI / 2, 6);
        expect(right.transform.rotation[1]).toBeCloseTo(-Math.PI / 2, 6);
    });
});

describe("确定性与 id 独立", () => {
    test("同模板两次生成的结构完全一致（忽略 id 与时间戳）", () => {
        const strip = (scene: DirectorScene) => JSON.stringify(scene, (key, value) => (key === "id" || key === "cameraId" || key === "activeShotId" || key === "createdAt" || key === "updatedAt" ? "<volatile>" : value));
        for (const id of ALL_IDS) {
            expect(strip(createDirectorSceneFromTemplate(id))).toBe(strip(createDirectorSceneFromTemplate(id)));
        }
    });

    test("每个实例的 id 都独立：两次生成不共享任何 id", () => {
        for (const id of ALL_IDS) {
            const first = createDirectorSceneFromTemplate(id);
            const second = createDirectorSceneFromTemplate(id);
            const ids = (scene: DirectorScene) => [scene.id, ...scene.objects.map((o) => o.id), ...scene.cameras.map((c) => c.id), ...scene.lights.map((l) => l.id), ...scene.shots.map((s) => s.id)];
            expect(ids(first).some((value) => ids(second).includes(value))).toBe(false);
        }
    });

    test("单个场景内部 id 不自撞", () => {
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            const all = [scene.id, ...scene.objects.map((o) => o.id), ...scene.cameras.map((c) => c.id), ...scene.lights.map((l) => l.id), ...scene.shots.map((s) => s.id)];
            expect(new Set(all).size).toBe(all.length);
        }
    });

    test("title 透传，未给时用默认名", () => {
        expect(createDirectorSceneFromTemplate("empty", "镜头 7").title).toBe("镜头 7");
        expect(createDirectorSceneFromTemplate("empty").title).toBe("未命名场景");
    });
});

describe("不升级 schema", () => {
    test("version 恒为 1，字段集合与兼容 factory 完全一致", () => {
        const legacy = Object.keys(createDirectorScene("legacy")).toSorted();
        for (const id of ALL_IDS) {
            const scene = createDirectorSceneFromTemplate(id);
            expect(scene.version).toBe(1);
            expect(Object.keys(scene).toSorted()).toEqual(legacy);
        }
    });

    test("模板不写入 mode 之类的工作台状态", () => {
        for (const id of ALL_IDS) {
            expect(Object.keys(createDirectorSceneFromTemplate(id))).not.toContain("mode");
        }
    });
});
