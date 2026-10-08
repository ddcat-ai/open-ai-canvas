import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";

import { PREVIS_MIN_ORBIT_DISTANCE, resolvePrevisFrameBounds, resolvePrevisObjectBox, resolvePrevisZoomMinDistance } from "@/lib/canvas/previs/previs-frame-bounds";
import { createPrevisActor, createPrevisObject } from "@/lib/canvas/previs/previs-scene";

describe("previs frame bounds", () => {
    test("treats actors as body volumes instead of origin points", () => {
        const box = resolvePrevisObjectBox(createPrevisActor("A", [0, 0, 0]));
        expect(box.max.y).toBeGreaterThan(1.5);
        expect(box.max.x - box.min.x).toBeGreaterThan(0.5);
    });

    test("keeps the orbit camera outside an actor that contains the target", () => {
        const actor = createPrevisActor("A", [0, 0, 0]);
        const target = new Vector3(0, 1, 0);
        const minDistance = resolvePrevisZoomMinDistance([actor], target);
        const box = resolvePrevisObjectBox(actor);
        // Any camera position at minDistance from the target lies outside the actor volume.
        const corner = new Vector3(Math.max(-box.min.x, box.max.x), Math.max(target.y - box.min.y, box.max.y - target.y), Math.max(-box.min.z, box.max.z));
        expect(minDistance).toBeGreaterThan(corner.length());
    });

    test("does not restrict zoom when the target is away from every object", () => {
        const actor = createPrevisActor("A", [0, 0, 0]);
        expect(resolvePrevisZoomMinDistance([actor], new Vector3(10, 1, 10))).toBe(PREVIS_MIN_ORBIT_DISTANCE);
    });

    test("ignores hidden objects and ground planes", () => {
        const hidden = { ...createPrevisActor("A", [0, 0, 0]), visible: false };
        const plane = createPrevisObject("plane", "floor", [0, 1, 0]);
        expect(resolvePrevisZoomMinDistance([hidden, plane], new Vector3(0, 1, 0))).toBe(PREVIS_MIN_ORBIT_DISTANCE);
        expect(resolvePrevisFrameBounds([hidden])).toBeNull();
    });

    test("fits every visible actor and needs more distance in portrait viewports", () => {
        const actors = [createPrevisActor("A", [0, 0, 0]), createPrevisActor("B", [1.8, 0, -0.8])];
        const wide = resolvePrevisFrameBounds(actors, undefined, 16 / 9, 50);
        const tall = resolvePrevisFrameBounds(actors, undefined, 9 / 16, 50);
        expect(wide).not.toBeNull();
        expect(tall).not.toBeNull();
        expect(wide!.min.x).toBeLessThan(0);
        expect(wide!.max.x).toBeGreaterThan(1.8);
        expect(tall!.fitDistance).toBeGreaterThan(wide!.fitDistance);
    });
});
