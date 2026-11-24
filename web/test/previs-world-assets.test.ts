import { describe, expect, test } from "bun:test";

import { generatePrevisLayout } from "@/lib/canvas/previs/previs-layout";
import { PREVIS_LAYOUT_MAX_INSTANCES } from "@/lib/canvas/previs/previs-layout-core";
import { PREVIS_LAYOUT_TEMPLATES, PREVIS_PROP_CATALOG } from "@/lib/canvas/previs/previs-prop-catalog";
import { buildPrevisPropParts, hasPrevisPropBuilder, previsPropPartsBounds } from "@/lib/canvas/previs/previs-prop-geometry";
import { normalizePrevisWorld, resolvePrevisWorldLighting } from "@/lib/canvas/previs/previs-world";

const HALF_BURIED = new Set(["rock", "boulder", "bush", "hill"]);

describe("previs prop catalog", () => {
    test("every catalog prop has a builder that yields finite, grounded geometry", () => {
        for (const prop of PREVIS_PROP_CATALOG) {
            expect(hasPrevisPropBuilder(prop.id)).toBe(true);
            for (const variant of [0, 1, 3]) {
                const parts = buildPrevisPropParts(prop.id, variant);
                expect(parts.length).toBeGreaterThan(0);
                for (const part of parts) {
                    const position = part.geometry.getAttribute("position").array as Float32Array;
                    expect(position.every(Number.isFinite)).toBe(true);
                }
                const bounds = previsPropPartsBounds(parts);
                // 原点在底面中心：底面不明显低于地面（岩石、灌木、山丘故意半埋），且尺寸与目录同一量级。
                if (!HALF_BURIED.has(prop.id)) expect(bounds.min.y).toBeGreaterThan(-0.05);
                const height = bounds.max.y - Math.max(0, bounds.min.y);
                expect(height).toBeGreaterThan(prop.size[1] * 0.4);
                expect(height).toBeLessThan(prop.size[1] * 1.8);
            }
        }
    });

    test("variants are deterministic", () => {
        const first = buildPrevisPropParts("tree_broadleaf", 2)[0].geometry.getAttribute("position").array;
        expect(buildPrevisPropParts("tree_broadleaf", 2)[0].geometry.getAttribute("position").array).toBe(first);
    });
});

describe("previs layouts", () => {
    test("every template expands deterministically within limits", () => {
        for (const template of PREVIS_LAYOUT_TEMPLATES) {
            const layout = { template: template.id, seed: 42, size: template.defaultSize, density: 0.8, crowd: true };
            const plan = generatePrevisLayout(layout);
            expect(plan.instances.length).toBeGreaterThan(10);
            expect(plan.instances.length).toBeLessThanOrEqual(PREVIS_LAYOUT_MAX_INSTANCES);
            const half = template.defaultSize / 2 + 1;
            for (const instance of plan.instances) {
                expect(Number.isFinite(instance.x) && Number.isFinite(instance.z)).toBe(true);
                expect(Math.abs(instance.x)).toBeLessThanOrEqual(half + 20);
                expect(Math.abs(instance.z)).toBeLessThanOrEqual(half + 20);
                expect(hasPrevisPropBuilder(instance.propId)).toBe(true);
            }
            const again = generatePrevisLayout({ ...layout });
            expect(again.instances.length).toBe(plan.instances.length);
        }
    });

    test("ancient city is dense enough to read as a city", () => {
        const plan = generatePrevisLayout({ template: "ancient_city", seed: 7, size: 420, density: 0.8, crowd: true });
        const buildings = plan.instances.filter((item) => item.propId.startsWith("ancient_") || item.propId === "tower_hall");
        expect(buildings.length).toBeGreaterThan(150);
        expect(plan.people.length).toBeGreaterThan(200);
        expect(plan.instances.some((item) => item.propId === "city_gate")).toBe(true);
    });
});

describe("previs world", () => {
    test("normalizes invalid input and resolves lighting for every hour", () => {
        expect(normalizePrevisWorld({ timeOfDay: 99, weather: "acid", ground: "lava", groundSize: 5 })).toEqual({ timeOfDay: 24, weather: "clear", ground: "grass", groundSize: 1000, horizon: true });
        for (let hour = 0; hour <= 24; hour += 1.5) {
            const lighting = resolvePrevisWorldLighting({ timeOfDay: hour, weather: "snow", ground: "snow", groundSize: 2000, horizon: true });
            expect(Number.isFinite(lighting.sunIntensity) && lighting.sunIntensity > 0).toBe(true);
            expect(lighting.sunDirection.y).toBeGreaterThan(0);
        }
    });
});

describe("previs parametric components and arrays", () => {
    test("building height follows floors and stays grounded", async () => {
        const { buildPrevisPropParts: build, previsPropPartsBounds: bounds } = await import("@/lib/canvas/previs/previs-prop-geometry");
        const { resolvePrevisPropSize } = await import("@/lib/canvas/previs/previs-prop-catalog");
        for (const style of ["modern", "glass", "brick", "concrete", "ancient"]) {
            const low = bounds(build("building", 0, { floors: 3, style }));
            const high = bounds(build("building", 0, { floors: 20, style }));
            expect(low.min.y).toBeGreaterThan(-0.05);
            expect(high.max.y).toBeGreaterThan(low.max.y * 2.5);
            const size = resolvePrevisPropSize("building", { floors: 20, style })!;
            expect(Math.abs(high.max.y - size[1]) / size[1]).toBeLessThan(0.35);
        }
    });

    test("every parametric prop builds at its min and max values", async () => {
        const { PREVIS_PROP_CATALOG: catalog } = await import("@/lib/canvas/previs/previs-prop-catalog");
        const { buildPrevisPropParts: build } = await import("@/lib/canvas/previs/previs-prop-geometry");
        for (const prop of catalog.filter((item) => item.params)) {
            for (const edge of ["min", "max"] as const) {
                const params = Object.fromEntries(prop.params!.map((def) => [def.key, def.type === "number" ? def[edge] : def.options[edge === "min" ? 0 : def.options.length - 1].value]));
                const parts = build(prop.id, 0, params);
                expect(parts.length).toBeGreaterThan(0);
                for (const part of parts) expect((part.geometry.getAttribute("position").array as Float32Array).every(Number.isFinite)).toBe(true);
            }
        }
    });

    test("array expands into independent, evenly spaced objects with varied floors", async () => {
        const { expandPrevisArray } = await import("@/lib/canvas/previs/previs-array");
        const { createPrevisCatalogProp } = await import("@/lib/canvas/previs/previs-scene");
        const base = createPrevisCatalogProp({ propId: "building", name: "楼房", color: "#eeebe5", params: { floors: 12, style: "glass" } });
        const line = expandPrevisArray(base, { pattern: "line", count: 3, facing: "same", vary: 0, seed: 1 }, [0, 0, 0]);
        expect(line.map((item) => item.transform.position[0])).toEqual([-16, 0, 16]);
        expect(new Set(line.map((item) => item.id)).size).toBe(3);
        const varied = expandPrevisArray(base, { pattern: "grid", count: 5, facing: "same", vary: 1, seed: 7 }, [10, 0, 10]);
        expect(varied).toHaveLength(5);
        expect(new Set(varied.map((item) => item.params?.floors)).size).toBeGreaterThan(1);
        for (const item of varied) expect(item.params?.style).toBe("glass");
    });

    test("layout instances can be extracted to world transforms", async () => {
        const { resolvePrevisLayoutInstanceWorld } = await import("@/components/canvas/previs/previs-prop-view");
        const { createPrevisLayoutObject } = await import("@/lib/canvas/previs/previs-scene");
        const object = createPrevisLayoutObject({ name: "古街", layout: { template: "ancient_street", seed: 3, size: 180, density: 0.8, crowd: false } });
        const moved = { ...object, transform: { ...object.transform, position: [100, 0, -50] as [number, number, number], rotation: [0, Math.PI / 2, 0] as [number, number, number] } };
        const plain = resolvePrevisLayoutInstanceWorld(object, 0)!;
        const world = resolvePrevisLayoutInstanceWorld(moved, 0)!;
        // 绕 Y 转 90°：局部 (x, z) → 世界 (z, -x)，再平移。
        expect(world.position[0]).toBeCloseTo(100 + plain.position[2], 5);
        expect(world.position[2]).toBeCloseTo(-50 - plain.position[0], 5);
        expect(world.rotation[1]).toBeCloseTo(Math.PI / 2 + plain.rotation[1], 5);
    });
});

describe("previs actor travel and markers", () => {
    test("sword flight from A to B lifts off, cruises, and lands grounded at B", async () => {
        const { applyPrevisActorTravel, evaluatePrevisTravel, previsActorPositionAt } = await import("@/lib/canvas/previs/previs-travel");
        const { evaluatePrevisActorPose } = await import("@/lib/canvas/previs/previs-motion");
        const { createPrevisActor } = await import("@/lib/canvas/previs/previs-scene");
        const actor = applyPrevisActorTravel(createPrevisActor("主角", [0, 0, 0]), { from: [-5, 0, 2], to: [7, 0, -4], start: 1, duration: 3, style: "sword_fly" });
        expect(actor.keyframes.map((keyframe) => keyframe.time)).toEqual([1, 4]);
        expect(previsActorPositionAt(actor, 4)).toEqual([7, 0, -4]);
        expect(evaluatePrevisTravel(actor, 0.5)).toBeNull();
        const cruise = evaluatePrevisTravel(actor, 2.5)!;
        expect(cruise.style).toBe("sword_fly");
        expect(cruise.lift).toBeCloseTo(2.5, 1);
        expect(evaluatePrevisTravel(actor, 4)!.lift).toBeLessThan(0.05);
        // 飞行中不迈步：步态被抑制，离地高度（米）进入人偶姿态。
        const pose = evaluatePrevisActorPose(actor, 2.5);
        expect(pose.worldLift).toBeCloseTo(2.5, 1);
        expect(pose.locomotion).toBe("still");
    });

    test("teleport holds at A then appears at B; run forces a running gait", async () => {
        const { applyPrevisActorTravel, previsActorPositionAt } = await import("@/lib/canvas/previs/previs-travel");
        const { evaluatePrevisActorPose } = await import("@/lib/canvas/previs/previs-motion");
        const { createPrevisActor } = await import("@/lib/canvas/previs/previs-scene");
        const flash = applyPrevisActorTravel(createPrevisActor("甲", [0, 0, 0]), { from: [0, 0, 0], to: [10, 0, 0], start: 0, duration: 2, style: "teleport" });
        expect(previsActorPositionAt(flash, 1.99)[0]).toBe(0);
        expect(previsActorPositionAt(flash, 2)[0]).toBe(10);
        // 30 秒走 6 米按速度判是走路，但 travel=run 强制跑步步态。
        const jog = applyPrevisActorTravel(createPrevisActor("乙", [0, 0, 0]), { from: [0, 0, 0], to: [0, 0, 6], start: 0, duration: 5, style: "run" });
        expect(evaluatePrevisActorPose(jog, 2.5).locomotion).toBe("run");
    });

    test("a new travel replaces overlapping segments and keyframes in its window", async () => {
        const { applyPrevisActorTravel, removePrevisActorTravel } = await import("@/lib/canvas/previs/previs-travel");
        const { createPrevisActor } = await import("@/lib/canvas/previs/previs-scene");
        let actor = applyPrevisActorTravel(createPrevisActor("丙", [0, 0, 0]), { to: [5, 0, 0], start: 0, duration: 3, style: "walk" });
        actor = applyPrevisActorTravel(actor, { to: [5, 0, 8], start: 1, duration: 2, style: "fly" });
        expect(actor.travels?.map((travel) => travel.style)).toEqual(["fly"]);
        expect(actor.keyframes.every((keyframe) => keyframe.time < 1 - 1e-3 || keyframe.time > 3 + 1e-3 || keyframe.time === 1 || keyframe.time === 3)).toBe(true);
        const removed = removePrevisActorTravel(actor, actor.travels![0].id);
        expect(removed.travels).toHaveLength(0);
    });

    test("marker labels advance A, B … and skip used ones", async () => {
        const { nextPrevisMarkerLabel } = await import("@/components/canvas/previs/previs-point-menu");
        expect(nextPrevisMarkerLabel([])).toBe("A");
        expect(
            nextPrevisMarkerLabel([
                { id: "1", label: "A", position: [0, 0, 0] },
                { id: "2", label: "C", position: [0, 0, 0] },
            ]),
        ).toBe("B");
    });

    test("fog thins when the camera rises so a zoomed-out city does not wash out", async () => {
        const { previsFogAltitudeFactor } = await import("@/components/canvas/previs/previs-world-view");
        expect(previsFogAltitudeFactor(2)).toBe(1);
        expect(previsFogAltitudeFactor(400)).toBeLessThan(0.25);
        expect(previsFogAltitudeFactor(10000)).toBe(0.15);
    });
});
