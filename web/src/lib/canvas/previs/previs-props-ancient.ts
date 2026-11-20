import type { PrevisPropKit } from "@/lib/canvas/previs/previs-prop-kit";
import type { PrevisPropBuilder } from "@/lib/canvas/previs/previs-props-nature";

/** 台基 + 墙身 + 檐柱 + 门窗 + 曲面屋顶：所有古建共用的一进房屋。y 为台基底面。 */
export function previsAncientHall(kit: PrevisPropKit, w: number, d: number, wallH: number, roofH: number, y = 0, options: { door?: boolean; base?: number; wall?: "accent" | "wall" | "wood" } = {}) {
    const base = options.base ?? 0.45;
    if (base > 0) {
        kit.box("stone_light", w + 1, base, d + 1, 0, y, 0);
        kit.box("stone_light", 2, base * 0.5, 0.8, 0, y, d / 2 + 0.9);
    }
    const top = y + base;
    kit.box(options.wall ?? "accent", w, wallH, d, 0, top, 0);
    // 檐柱略出墙面，正面按开间布置。
    const bays = Math.max(2, Math.round(w / 2.6));
    for (let index = 0; index <= bays; index++) {
        const x = -w / 2 + (index / bays) * w;
        kit.cyl("red", 0.16, 0.18, wallH, x, top, d / 2 + 0.25, 8);
        kit.cyl("red", 0.16, 0.18, wallH, x, top, -d / 2 - 0.25, 8);
    }
    kit.box("wood_dark", w + 0.6, 0.35, 0.3, 0, top + wallH - 0.35, d / 2 + 0.25);
    kit.box("wood_dark", w + 0.6, 0.35, 0.3, 0, top + wallH - 0.35, -d / 2 - 0.25);
    if (options.door !== false) kit.box("wood", 1.6, Math.min(2.4, wallH - 0.4), 0.1, 0, top, d / 2 + 0.03);
    // 两侧格子窗。
    for (const side of [-1, 1]) {
        if (w < 5) continue;
        const x = side * w * 0.3;
        kit.box("wood_dark", 1.4, 1.1, 0.08, x, top + wallH * 0.38, d / 2 + 0.03);
        for (let bar = 0; bar < 4; bar++) kit.box("wood", 0.05, 1.1, 0.1, x - 0.5 + bar * 0.33, top + wallH * 0.38, d / 2 + 0.05);
    }
    kit.hipRoof("roof", w + 1.8, d + 1.8, roofH, top + wallH);
    return top + wallH;
}

function ancientHouse(kit: PrevisPropKit) {
    previsAncientHall(kit, kit.range(8, 10.5), kit.range(6.2, 7.6), kit.range(2.8, 3.2), kit.range(1.9, 2.4));
}

function ancientShop(kit: PrevisPropKit) {
    const w = kit.range(7, 9);
    const d = kit.range(6, 7.4);
    const base = 0.3;
    kit.box("stone_light", w + 0.6, base, d + 0.6);
    // 一层：开敞铺面，木板门一排。
    kit.box("wall", w, 3.2, d, 0, base, -0.2);
    for (let index = 0; index < 6; index++) kit.box("wood", w / 6 - 0.06, 2.6, 0.08, -w / 2 + (index + 0.5) * (w / 6), base, d / 2 - 0.15);
    kit.box("wood_dark", w + 0.4, 0.3, 0.3, 0, base + 3.0, d / 2);
    // 腰檐。
    kit.hipRoof("roof", w + 1.6, d + 1.6, 0.9, base + 3.2, { ridge: false, lift: 0.3, thickness: 0.12 });
    // 二层：内收，带栏杆。
    kit.box("wall", w - 0.8, 2.6, d - 1, 0, base + 3.6, -0.2);
    for (let index = 0; index < 10; index++) kit.box("wood_dark", 0.06, 0.7, 0.06, -w / 2 + 0.5 + index * ((w - 1) / 9), base + 3.6, d / 2 - 0.55);
    kit.box("wood_dark", w - 0.6, 0.06, 0.08, 0, base + 4.28, d / 2 - 0.55);
    kit.hipRoof("roof", w + 1.4, d + 1.2, 1.7, base + 6.2);
    // 招幌与灯笼。
    kit.cyl("wood_dark", 0.04, 0.04, 2.6, w / 2 + 0.2, base + 3.4, d / 2 + 0.6, 6);
    kit.box("accent", 0.6, 1.8, 0.04, w / 2 + 0.55, base + 3.9, d / 2 + 0.6);
    for (const x of [-w / 3, w / 3]) kit.sphere("lantern", 0.24, [x, base + 2.7, d / 2 + 0.5], [1, 1.3, 1], 10, 8);
}

function courtyard(kit: PrevisPropKit) {
    // 院墙。
    kit.box("wall", 22, 2.6, 0.5, 0, 0, -10.75);
    kit.box("wall", 0.5, 2.6, 22, -10.75, 0, 0);
    kit.box("wall", 0.5, 2.6, 22, 10.75, 0, 0);
    kit.box("wall", 8.5, 2.6, 0.5, -6.75, 0, 10.75);
    kit.box("wall", 8.5, 2.6, 0.5, 6.75, 0, 10.75);
    for (const [x, z, w, d] of [
        [0, -10.75, 22.4, 0.9],
        [-10.75, 0, 0.9, 22.4],
        [10.75, 0, 0.9, 22.4],
        [-6.75, 10.75, 8.9, 0.9],
        [6.75, 10.75, 8.9, 0.9],
    ])
        kit.box("roof", w, 0.25, d, x, 2.6, z);
    // 门楼。
    kit.push([0, 0, 10.75]);
    kit.box("wood", 2, 2.4, 0.2, 0, 0, 0.1);
    kit.hipRoof("roof", 5, 2.4, 1.1, 2.8, { lift: 0.25 });
    kit.pop();
    // 正房坐北朝南，东西厢房相对。
    kit.push([0, 0, -6]);
    previsAncientHall(kit, 12, 6.5, 3.2, 2.3);
    kit.pop();
    kit.push([-6.8, 0, 2.5], Math.PI / 2);
    previsAncientHall(kit, 8, 5.2, 2.8, 1.8, 0, { base: 0.3 });
    kit.pop();
    kit.push([6.8, 0, 2.5], -Math.PI / 2);
    previsAncientHall(kit, 8, 5.2, 2.8, 1.8, 0, { base: 0.3 });
    kit.pop();
    kit.box("stone_light", 6, 0.06, 9, 0, 0, 3);
    kit.cyl("trunk", 0.18, 0.26, 3, -3, 0, 6, 7);
    kit.blob("foliage", 1.7, [-3, 4.2, 6], [1, 0.85, 1], 0.2);
}

function towerHall(kit: PrevisPropKit) {
    const tiers = kit.rand() > 0.5 ? 3 : 4;
    kit.box("stone_light", 18, 1.2, 15);
    kit.box("stone_light", 15.5, 0.8, 12.5, 0, 1.2, 0);
    kit.box("stone_light", 4, 1, 3, 0, 0, 8.4);
    let y = 2;
    let w = 12.5;
    let d = 9.5;
    for (let tier = 0; tier < tiers; tier++) {
        const wallH = tier === 0 ? 4 : 3.2;
        kit.box("wall", w, wallH, d, 0, y, 0);
        const bays = Math.round(w / 2.4);
        for (let index = 0; index <= bays; index++) {
            const x = -w / 2 + (index / bays) * w;
            kit.cyl("red", 0.2, 0.22, wallH, x, y, d / 2 + 0.3, 8);
            kit.cyl("red", 0.2, 0.22, wallH, x, y, -d / 2 - 0.3, 8);
        }
        if (tier > 0) {
            // 平座栏杆。
            kit.box("wood_dark", w + 1.6, 0.12, d + 1.6, 0, y, 0);
            kit.box("red", w + 1.6, 0.6, 0.08, 0, y + 0.12, d / 2 + 0.8);
            kit.box("red", w + 1.6, 0.6, 0.08, 0, y + 0.12, -d / 2 - 0.8);
        }
        const last = tier === tiers - 1;
        kit.hipRoof("roof", w + 3, d + 3, last ? 2.8 : 1.4, y + wallH, { lift: last ? 0.8 : 0.6, ridge: last });
        y += wallH + (last ? 0 : 1.2);
        w *= 0.8;
        d *= 0.8;
    }
}

function pagoda(kit: PrevisPropKit) {
    const tiers = 5 + Math.floor(kit.rand() * 3);
    kit.cyl("stone_light", 4.6, 4.8, 1.2, 0, 0, 0, 8);
    let y = 1.2;
    let radius = 3.3;
    for (let tier = 0; tier < tiers; tier++) {
        const height = tier === 0 ? 3.6 : 2.6;
        kit.cyl("wall", radius, radius, height, 0, y, 0, 8);
        kit.box("wood_dark", 1, 1.6, 0.1, 0, y + 0.3, radius * 0.93);
        kit.polygonRoof("roof", 8, radius + 1.4, 0.9, y + height, { lift: 0.45, thickness: 0.2 });
        y += height + 0.55;
        radius *= 0.86;
    }
    kit.cyl("roof", 0.8, radius + 0.6, 1.4, 0, y - 0.6, 0, 8);
    kit.cyl("gold", 0.08, 0.12, 4, 0, y + 0.8, 0, 8);
    for (let index = 0; index < 5; index++) kit.torus("gold", 0.35 - index * 0.04, 0.06, [0, y + 1.4 + index * 0.5, 0], [Math.PI / 2, 0, 0], 4, 12);
    kit.sphere("gold", 0.25, [0, y + 4.9, 0]);
}

function pavilion(kit: PrevisPropKit) {
    kit.cyl("stone_light", 2.7, 2.8, 0.5, 0, 0, 0, 6);
    for (let index = 0; index < 6; index++) {
        const angle = (index / 6) * Math.PI * 2 + Math.PI / 6;
        kit.cyl("red", 0.12, 0.14, 2.9, Math.cos(angle) * 2.2, 0.5, Math.sin(angle) * 2.2, 8);
        // 美人靠。
        const next = angle + Math.PI / 3;
        if (index === 1) continue;
        const mx = (Math.cos(angle) + Math.cos(next)) * 1.1;
        const mz = (Math.sin(angle) + Math.sin(next)) * 1.1;
        kit.box("wood", 2.1, 0.08, 0.4, mx, 0.95, mz, -(angle + next) / 2 + Math.PI / 2);
    }
    kit.polygonRoof("roof", 6, 3.4, 2, 3.4, { lift: 0.55, finial: "gold" });
}

export const PREVIS_ANCIENT_PROP_BUILDERS: Record<string, PrevisPropBuilder> = {
    ancient_house: ancientHouse,
    ancient_shop: ancientShop,
    ancient_courtyard: courtyard,
    tower_hall: towerHall,
    pagoda,
    pavilion,
};
