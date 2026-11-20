import type { PrevisPropKit } from "@/lib/canvas/previs/previs-prop-kit";
import type { PrevisPropBuilder } from "@/lib/canvas/previs/previs-props-nature";

/** 四个立面的横向窗带，略突出墙面，远看就是楼层线。 */
function windowBands(kit: PrevisPropKit, w: number, d: number, floors: number, floorH: number, y0: number, inset = 0.4) {
    for (let floor = 0; floor < floors; floor++) {
        const y = y0 + floor * floorH + floorH * 0.32;
        const h = floorH * 0.48;
        kit.box("glass", w - inset * 2, h, 0.06, 0, y, d / 2 + 0.02);
        kit.box("glass", w - inset * 2, h, 0.06, 0, y, -d / 2 - 0.02);
        kit.box("glass", 0.06, h, d - inset * 2, w / 2 + 0.02, y, 0);
        kit.box("glass", 0.06, h, d - inset * 2, -w / 2 - 0.02, y, 0);
    }
}

function modernHouse(kit: PrevisPropKit) {
    const w = kit.range(9, 12);
    const d = kit.range(7.5, 9.5);
    kit.box("accent", w, 3.3, d);
    kit.box("concrete_dark", w + 0.5, 0.25, d + 0.5, 0, 3.3, 0);
    const upperW = w * kit.range(0.55, 0.75);
    const shift = ((w - upperW) / 2) * (kit.rand() > 0.5 ? 1 : -1);
    kit.box("accent", upperW, 3, d * 0.85, shift, 3.55, -d * 0.05);
    kit.box("concrete_dark", upperW + 0.6, 0.25, d * 0.85 + 0.6, shift, 6.55, -d * 0.05);
    kit.box("glass", w * 0.55, 2.4, 0.08, -shift * 0.4, 0.4, d / 2 + 0.02);
    kit.box("glass", upperW * 0.7, 2, 0.08, shift, 4, d * 0.375 + 0.02);
    kit.box("wood_dark", 1.1, 2.3, 0.1, w / 2 - 1.4, 0, d / 2 + 0.03);
    kit.box("concrete", w * 0.5, 0.15, 2, -shift * 0.4, 0, d / 2 + 1);
}

function villa(kit: PrevisPropKit) {
    const w = kit.range(9, 11);
    const d = kit.range(7, 8.5);
    kit.box("wall", w, 5.4, d);
    kit.gableRoof("accent", d + 1.2, w + 1, 2.8, 5.4, 0, 0, Math.PI / 2);
    kit.box("brick", 0.8, 2.6, 0.8, w * 0.28, 6, -d * 0.18);
    for (const row of [0.9, 3.6]) {
        for (const x of [-w * 0.32, 0, w * 0.32]) {
            if (row < 1 && x === 0) continue;
            kit.box("glass", 1.3, 1.4, 0.08, x, row, d / 2 + 0.02);
            kit.box("white", 1.5, 0.1, 0.16, x, row - 0.1, d / 2 + 0.05);
        }
    }
    kit.box("wood_dark", 1.2, 2.4, 0.1, 0, 0, d / 2 + 0.03);
    kit.beam("accent", 2.6, 0.1, 1.6, [0, 2.9, d / 2 + 0.7], [0.25, 0, 0]);
    kit.box("white", 0.12, 2.7, 0.12, -1.1, 0, d / 2 + 1.35);
    kit.box("white", 0.12, 2.7, 0.12, 1.1, 0, d / 2 + 1.35);
}

function apartment(kit: PrevisPropKit) {
    const floors = 8 + Math.floor(kit.rand() * 7);
    const w = kit.range(16, 20);
    const d = kit.range(12, 15);
    const floorH = 3;
    kit.box("accent", w, floors * floorH, d);
    windowBands(kit, w, d, floors, floorH, 0, 0.8);
    for (let floor = 1; floor < floors; floor++) {
        kit.box("concrete", w * 0.8, 0.18, 1.2, 0, floor * floorH, d / 2 + 0.6);
        kit.box("concrete", w * 0.8, 0.9, 0.08, 0, floor * floorH + 0.18, d / 2 + 1.18);
    }
    kit.box("concrete_dark", w + 0.3, 1, d + 0.3, 0, floors * floorH, 0);
    kit.box("concrete", 3, 2.4, 3, w * 0.25, floors * floorH + 1, -d * 0.2);
}

function officeTower(kit: PrevisPropKit) {
    const floors = 14 + Math.floor(kit.rand() * 8);
    const floorH = 3.6;
    const round = kit.rand() > 0.6;
    kit.box("concrete", 30, 6, 30);
    kit.box("glass", 30.2, 4.2, 30.2, 0, 0.6, 0);
    if (round) {
        kit.cyl("glass", 11, 11, floors * floorH, 0, 6, 0, 24);
        for (let floor = 0; floor <= floors; floor += 2) kit.cyl("concrete", 11.15, 11.15, 0.35, 0, 6 + floor * floorH, 0, 24);
    } else {
        kit.box("glass", 22, floors * floorH, 22, 0, 6, 0);
        for (let floor = 0; floor <= floors; floor++) kit.box("concrete", 22.2, 0.3, 22.2, 0, 6 + floor * floorH, 0);
        for (const x of [-11, 11]) for (const z of [-11, 11]) kit.box("concrete", 0.9, floors * floorH, 0.9, x, 6, z);
    }
    kit.box("concrete_dark", 10, 3, 10, 0, 6 + floors * floorH, 0);
}

function skyscraper(kit: PrevisPropKit) {
    const total = kit.range(130, 200);
    const sections = [
        { w: 30, h: total * 0.45 },
        { w: 23, h: total * 0.32 },
        { w: 15, h: total * 0.18 },
    ];
    let y = 0;
    for (const section of sections) {
        kit.box("glass", section.w, section.h, section.w, 0, y, 0);
        // 竖向幕墙肋，每面 6 根。
        for (let index = 0; index <= 5; index++) {
            const offset = -section.w / 2 + (index / 5) * section.w;
            kit.box("metal", 0.35, section.h, 0.5, offset, y, section.w / 2);
            kit.box("metal", 0.35, section.h, 0.5, offset, y, -section.w / 2);
            kit.box("metal", 0.5, section.h, 0.35, section.w / 2, y, offset);
            kit.box("metal", 0.5, section.h, 0.35, -section.w / 2, y, offset);
        }
        kit.box("concrete", section.w + 1, 1.2, section.w + 1, 0, y + section.h - 1.2, 0);
        y += section.h;
    }
    kit.cyl("metal", 0.6, 1.2, total * 0.05, 0, y, 0, 8);
    kit.cyl("metal", 0.12, 0.3, total * 0.08, 0, y + total * 0.05, 0, 6);
}

function shopFront(kit: PrevisPropKit) {
    const w = kit.range(8, 11);
    kit.box("concrete", w, 4.6, 9);
    kit.box("glass", w - 1, 2.8, 0.1, 0, 0.2, 4.52);
    kit.box("concrete_dark", 0.4, 3, 0.2, -w / 2 + 0.5, 0, 4.55);
    kit.box("concrete_dark", 0.4, 3, 0.2, w / 2 - 0.5, 0, 4.55);
    kit.beam("accent", w - 0.4, 0.08, 1.8, [0, 3.25, 5.3], [0.3, 0, 0]);
    kit.box("white", w * 0.6, 0.8, 0.15, 0, 3.6, 4.6);
    kit.box("concrete_dark", w + 0.2, 0.4, 9.2, 0, 4.6, 0);
}

function streetLamp(kit: PrevisPropKit) {
    kit.cyl("metal", 0.08, 0.12, 6.2, 0, 0, 0, 8);
    kit.beam("metal", 0.08, 0.08, 1.4, [0, 6.1, 0.6], [0, 0, 0]);
    kit.box("metal", 0.36, 0.14, 0.6, 0, 5.98, 1.25);
    kit.box("lamp", 0.28, 0.04, 0.5, 0, 5.94, 1.25);
}

function trafficLight(kit: PrevisPropKit) {
    kit.cyl("metal", 0.1, 0.13, 5.6, 0, 0, 0, 8);
    kit.beam("metal", 3.2, 0.12, 0.12, [1.6, 5.4, 0], [0, 0, 0]);
    kit.box("rubber", 0.4, 1.1, 0.35, 2.9, 4.2, 0);
    kit.sphere("lantern", 0.12, [2.9, 5.05, 0.18]);
    kit.sphere("bloom", 0.12, [2.9, 4.75, 0.18]);
    kit.sphere("signal_green", 0.12, [2.9, 4.45, 0.18]);
}

function bench(kit: PrevisPropKit) {
    for (const z of [-0.1, 0.08, 0.26]) kit.box("accent", 1.8, 0.05, 0.14, 0, 0.45, z);
    for (const y of [0.62, 0.8]) kit.beam("accent", 1.8, 0.12, 0.05, [0, y, -0.28], [-0.15, 0, 0]);
    for (const x of [-0.75, 0.75]) {
        kit.box("metal", 0.06, 0.45, 0.5, x, 0, 0.08);
        kit.beam("metal", 0.06, 0.5, 0.06, [x, 0.7, -0.27], [-0.15, 0, 0]);
    }
}

function busStop(kit: PrevisPropKit) {
    for (const x of [-2.3, 2.3]) kit.box("metal", 0.1, 2.6, 0.1, x, 0, -0.7);
    kit.box("accent", 5, 0.15, 1.8, 0, 2.6, 0);
    kit.box("glass", 4.6, 1.9, 0.05, 0, 0.5, -0.75);
    kit.box("wood", 3, 0.06, 0.4, 0, 0.45, -0.45);
    kit.box("white", 0.9, 1.6, 0.08, 2.3, 0.6, 0.1);
}

function fence(kit: PrevisPropKit) {
    for (let index = 0; index <= 4; index++) kit.box("wood", 0.1, 1.1, 0.1, -2 + index, 0, 0);
    kit.box("wood", 4.05, 0.08, 0.06, 0, 0.35, 0.04);
    kit.box("wood", 4.05, 0.08, 0.06, 0, 0.85, 0.04);
}

function trashBin(kit: PrevisPropKit) {
    kit.cyl("accent", 0.28, 0.24, 0.9, 0, 0, 0, 12);
    kit.cyl("metal", 0.3, 0.3, 0.08, 0, 0.9, 0, 12);
}

function wheels(kit: PrevisPropKit, radius: number, width: number, x: number, zs: number[], y = radius) {
    for (const z of zs) for (const side of [-1, 1]) kit.rod("rubber", radius, width, [side * x, y, z], [0, 0, Math.PI / 2], 12);
}

function car(kit: PrevisPropKit) {
    const suv = kit.rand() > 0.65;
    const bodyH = suv ? 0.95 : 0.7;
    kit.box("accent", 1.82, bodyH, 4.5, 0, 0.3, 0);
    kit.box("glass", 1.6, suv ? 0.75 : 0.6, suv ? 2.8 : 2.2, 0, 0.3 + bodyH, suv ? -0.35 : -0.25);
    kit.box("accent", 1.64, 0.07, suv ? 2.6 : 1.9, 0, 0.3 + bodyH + (suv ? 0.75 : 0.6), suv ? -0.4 : -0.3);
    wheels(kit, 0.34, 0.24, 0.84, [-1.45, 1.45]);
    kit.box("lamp", 0.4, 0.12, 0.04, -0.6, 0.65, 2.26);
    kit.box("lamp", 0.4, 0.12, 0.04, 0.6, 0.65, 2.26);
    kit.box("lantern", 0.4, 0.12, 0.04, -0.6, 0.7, -2.26);
    kit.box("lantern", 0.4, 0.12, 0.04, 0.6, 0.7, -2.26);
}

function bus(kit: PrevisPropKit) {
    kit.box("accent", 2.55, 2.7, 11, 0, 0.35, 0);
    kit.box("glass", 2.6, 1.1, 9.4, 0, 1.6, -0.5);
    kit.box("glass", 2.3, 1.6, 0.06, 0, 1.2, 5.51);
    kit.box("white", 2.56, 0.2, 11, 0, 3.05, 0);
    wheels(kit, 0.5, 0.3, 1.15, [-3.6, 3.4]);
}

function oxCart(kit: PrevisPropKit) {
    kit.box("wood", 1.8, 0.12, 2.6, 0, 0.9, -1.2);
    kit.box("wood", 1.8, 0.5, 0.08, 0, 1.02, -2.46);
    kit.box("wood", 0.08, 0.5, 2.6, -0.88, 1.02, -1.2);
    kit.box("wood", 0.08, 0.5, 2.6, 0.88, 1.02, -1.2);
    for (const side of [-1, 1]) {
        kit.torus("wood_dark", 0.62, 0.07, [side * 1.05, 0.68, -1.2], [0, Math.PI / 2, 0], 5, 16);
        for (let spoke = 0; spoke < 4; spoke++) kit.beam("wood_dark", 0.05, 1.2, 0.05, [side * 1.05, 0.68, -1.2], [spoke * (Math.PI / 4), 0, 0]);
        kit.beam("wood_dark", 0.08, 0.08, 2.6, [side * 0.5, 0.95, 1.1], [0.1, 0, 0]);
    }
    // 牛：躯干、头、四条腿、角。
    kit.blob("fabric", 0.6, [0, 1.15, 1.9], [0.9, 0.85, 1.6], 0.12, 1);
    kit.box("fabric", 0.42, 0.42, 0.55, 0, 1.15, 2.95);
    kit.cone("white", 0.05, 0.3, -0.2, 1.55, 2.95, 5, [0, 0, 0.6]);
    kit.cone("white", 0.05, 0.3, 0.2, 1.55, 2.95, 5, [0, 0, -0.6]);
    for (const x of [-0.3, 0.3]) for (const z of [1.3, 2.4]) kit.cyl("fabric", 0.09, 0.08, 0.85, x, 0, z, 6);
}

function bicycle(kit: PrevisPropKit) {
    for (const z of [-0.55, 0.55]) kit.torus("rubber", 0.33, 0.025, [0, 0.35, z], [0, Math.PI / 2, 0], 4, 18);
    kit.rod("accent", 0.022, 0.9, [0, 0.6, 0], [Math.PI / 2 - 0.25, 0, 0]);
    kit.rod("accent", 0.022, 0.6, [0, 0.55, -0.3], [0.6, 0, 0]);
    kit.rod("accent", 0.022, 0.6, [0, 0.55, 0.42], [-0.3, 0, 0]);
    kit.box("rubber", 0.14, 0.05, 0.24, 0, 0.92, -0.35);
    kit.rod("metal", 0.018, 0.5, [0, 0.98, 0.5], [0, 0, Math.PI / 2]);
}

export const PREVIS_MODERN_PROP_BUILDERS: Record<string, PrevisPropBuilder> = {
    modern_house: modernHouse,
    villa,
    apartment,
    office_tower: officeTower,
    skyscraper,
    shop_front: shopFront,
    street_lamp: streetLamp,
    traffic_light: trafficLight,
    bench,
    bus_stop: busStop,
    fence,
    trash_bin: trashBin,
    car,
    bus,
    ox_cart: oxCart,
    bicycle,
};
