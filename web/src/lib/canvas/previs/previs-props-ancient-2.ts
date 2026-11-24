import { previsArchOutline, type PrevisPropKit, type PrevisPropMaterialKey } from "@/lib/canvas/previs/previs-prop-kit";
import { previsAncientHall } from "@/lib/canvas/previs/previs-props-ancient";
import type { PrevisPropBuilder } from "@/lib/canvas/previs/previs-props-nature";

/** 城墙顶的垛口：沿 X 方向一排。 */
function battlements(kit: PrevisPropKit, length: number, y: number, z: number) {
    const count = Math.max(2, Math.floor(length / 1.6));
    for (let index = 0; index < count; index++) kit.box("brick", 0.9, 0.9, 0.5, -length / 2 + 0.45 + index * ((length - 0.9) / (count - 1)), y, z);
}

function cityGate(kit: PrevisPropKit) {
    kit.archWall("brick", previsArchOutline(32, 11, 6, 4.2), 14, [0, 0, 0]);
    kit.box("stone", 32.6, 0.5, 14.6, 0, 11, 0);
    battlements(kit, 32, 11.5, 6.9);
    battlements(kit, 32, 11.5, -6.9);
    kit.box("wood_dark", 5.6, 4, 0.2, 0, 0, 6.9);
    kit.push([0, 11.5, 0]);
    previsAncientHall(kit, 18, 8, 3.6, 2.6, 0, { door: true, base: 0.6, wall: "wall" });
    kit.pop();
}

function ancientWall(kit: PrevisPropKit) {
    kit.box("brick", 20, 7, 6);
    kit.box("stone", 20, 0.4, 6.4, 0, 7, 0);
    battlements(kit, 20, 7.4, 2.95);
    kit.box("brick", 20, 1, 0.4, 0, 7.4, -2.95);
    // 马面：外凸墩台，打破长墙的单调。
    kit.box("brick", 4, 7, 2.5, 0, 0, 4.1);
    kit.box("stone", 4.4, 0.4, 2.9, 0, 7, 4.1);
}

function paifang(kit: PrevisPropKit) {
    const columns = [-5, -1.8, 1.8, 5];
    for (const x of columns) {
        kit.box("stone_light", 1, 0.9, 1.4, x, 0, 0);
        kit.box("stone", 0.6, 7.2, 0.6, x, 0, 0);
    }
    kit.box("accent", 11, 0.6, 0.5, 0, 5.4, 0);
    kit.box("accent", 4, 1.2, 0.5, 0, 6.2, 0);
    kit.box("gold", 2.2, 0.8, 0.56, 0, 6.4, 0);
    kit.box("accent", 3.4, 0.5, 0.5, -3.4, 4.6, 0);
    kit.box("accent", 3.4, 0.5, 0.5, 3.4, 4.6, 0);
    kit.hipRoof("roof", 5.2, 2, 1.2, 7.4, { lift: 0.4 });
    kit.hipRoof("roof", 3.6, 1.6, 0.9, 6, { x: -3.4, lift: 0.35 });
    kit.hipRoof("roof", 3.6, 1.6, 0.9, 6, { x: 3.4, lift: 0.35 });
}

function stoneBridge(kit: PrevisPropKit) {
    const length = 14;
    const outline: Array<[number, number]> = [];
    const steps = 14;
    for (let index = 0; index <= steps; index++) {
        const s = -length / 2 + (index / steps) * length;
        outline.push([s, 1 + 2.2 * Math.cos((Math.PI * s) / length)]);
    }
    // 底边自右向左，中间开半圆拱。
    outline.push([length / 2, 0], [2.4, 0]);
    for (let index = 1; index < 10; index++) {
        const angle = (index / 10) * Math.PI;
        outline.push([Math.cos(angle) * 2.4, Math.sin(angle) * 2.4]);
    }
    outline.push([-2.4, 0], [-length / 2, 0]);
    kit.archWall("stone", outline, 4, [0, 0, 0], Math.PI / 2);
    // 栏板随桥面起伏。
    for (let index = 0; index < steps; index++) {
        const s0 = -length / 2 + (index / steps) * length;
        const s1 = -length / 2 + ((index + 1) / steps) * length;
        const y0 = 1 + 2.2 * Math.cos((Math.PI * s0) / length);
        const y1 = 1 + 2.2 * Math.cos((Math.PI * s1) / length);
        const angle = Math.atan2(y1 - y0, s1 - s0);
        const segment = Math.hypot(s1 - s0, y1 - y0);
        for (const x of [-1.85, 1.85]) {
            kit.beam("stone_light", 0.16, 0.7, segment, [x, (y0 + y1) / 2 + 0.35, (s0 + s1) / 2], [-angle, 0, 0]);
            kit.box("stone_light", 0.24, 0.95, 0.24, x, y0, s0);
        }
    }
}

function well(kit: PrevisPropKit) {
    kit.cyl("stone", 0.95, 1, 0.8, 0, 0, 0, 12);
    kit.cyl("water", 0.72, 0.72, 0.02, 0, 0.78, 0, 12);
    kit.box("wood_dark", 0.14, 2.2, 0.14, -1, 0, 0);
    kit.box("wood_dark", 0.14, 2.2, 0.14, 1, 0, 0);
    kit.rod("wood", 0.08, 2.1, [0, 1.75, 0], [0, 0, Math.PI / 2], 8);
    kit.beam("roof", 2.6, 0.08, 1.1, [0, 2.45, 0.4], [0.55, 0, 0]);
    kit.beam("roof", 2.6, 0.08, 1.1, [0, 2.45, -0.4], [-0.55, 0, 0]);
    kit.cyl("wood", 0.18, 0.15, 0.3, 0.3, 1.1, 0, 8);
}

function marketStall(kit: PrevisPropKit) {
    kit.box("wood", 2.6, 0.08, 1.4, 0, 0.82, 0);
    kit.box("wood_dark", 2.5, 0.82, 0.06, 0, 0, 0.66);
    for (const sx of [-1, 1]) {
        kit.box("wood_dark", 0.08, 2.5, 0.08, sx * 1.4, 0, 0.9);
        kit.box("wood_dark", 0.08, 2.2, 0.08, sx * 1.4, 0, -0.9);
    }
    kit.beam("accent", 3, 0.05, 2.2, [0, 2.4, 0], [-0.14, 0, 0]);
    const goods: PrevisPropMaterialKey[] = ["bloom", "bloom3", "foliage_light", "fabric", "white"];
    for (let index = 0; index < 9; index++) {
        const x = -1.05 + (index % 5) * 0.52;
        const z = index < 5 ? 0.25 : -0.3;
        if (kit.rand() > 0.5) kit.sphere(kit.pick(goods), 0.14, [x, 1.0, z], [1, 0.8, 1], 8, 6);
        else kit.box(kit.pick(goods), 0.36, 0.22, 0.3, x, 0.9, z);
    }
}

function lanternPole(kit: PrevisPropKit) {
    kit.box("stone", 0.5, 0.3, 0.5);
    kit.cyl("wood_dark", 0.07, 0.09, 3.8, 0, 0.3, 0, 8);
    kit.box("wood_dark", 0.08, 0.08, 0.9, 0, 3.8, 0.35);
    kit.cyl("wood_dark", 0.015, 0.015, 0.3, 0, 3.5, 0.75, 4);
    kit.sphere("lantern", 0.26, [0, 3.2, 0.75], [1, 1.3, 1], 12, 8);
    kit.cyl("gold", 0.14, 0.14, 0.08, 0, 3.52, 0.75, 10);
    kit.cyl("gold", 0.14, 0.14, 0.08, 0, 2.8, 0.75, 10);
}

export const PREVIS_ANCIENT_EXTRA_PROP_BUILDERS: Record<string, PrevisPropBuilder> = {
    city_gate: cityGate,
    ancient_wall: ancientWall,
    paifang,
    stone_bridge: stoneBridge,
    well,
    market_stall: marketStall,
    lantern_pole: lanternPole,
};
