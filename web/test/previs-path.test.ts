import { describe, expect, test } from "bun:test";

import { buildPrevisPathKeyframes, previsPathHeading, simplifyPrevisPath, timePrevisPath } from "@/lib/canvas/previs/previs-path";
import type { PrevisTransform } from "@/types/previs";

const base: PrevisTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

describe("previs path authoring", () => {
    test("removes repeated samples and keeps meaningful corners", () => {
        expect(simplifyPrevisPath([[0, 0, 0], [0, 0, 0], [0.01, 0, 0.01], [1, 0, 0], [1, 0, 0]], 0.03)).toEqual([[0, 0, 0], [1, 0, 0]]);
        expect(simplifyPrevisPath([[0, 0, 0], [1, 0, 0], [1, 0, 1]], 0.03)).toEqual([[0, 0, 0], [1, 0, 0], [1, 0, 1]]);
    });

    test("allocates time by travelled distance", () => {
        const waypoints = timePrevisPath([[0, 0, 0], [1, 0, 0], [3, 0, 0]], 2, 4);
        expect(waypoints.map((item) => item.time)).toEqual([2, 2 + 4 / 3, 6]);
    });

    test("handles degenerate paths without creating invalid data", () => {
        expect(timePrevisPath([[1, 0, 1], [1, 0, 1]], 0, 5)).toEqual([{ time: 0, position: [1, 0, 1] }]);
        expect(buildPrevisPathKeyframes({ base, points: [[1, 0, 1]], duration: 5 })).toHaveLength(1);
    });

    test("derives a stable heading from the path", () => {
        expect(previsPathHeading([[0, 0, 0], [1, 0, 0]], 0)).toBeCloseTo(Math.PI / 2);
        expect(previsPathHeading([[0, 0, 0], [0, 0, 1]], 0)).toBeCloseTo(0);
    });

    test("builds smooth transform keyframes and optionally turns actors along the route", () => {
        const keyframes = buildPrevisPathKeyframes({ base, points: [[0, 0, 0], [1, 0, 0], [1, 0, 1]], duration: 5, orientToPath: true });
        expect(keyframes).toHaveLength(3);
        expect(keyframes[0].easing).toBe("smooth");
        expect(keyframes[0].transform.position).toEqual([0, 0, 0]);
        expect(keyframes[1].transform.rotation[1]).toBeCloseTo(Math.PI / 4);
        expect(keyframes[2].transform.position).toEqual([1, 0, 1]);
    });
});
