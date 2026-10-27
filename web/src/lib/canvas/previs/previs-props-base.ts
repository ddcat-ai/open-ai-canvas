import type { PrevisPropKit, PrevisPropMaterialKey } from "@/lib/canvas/previs/previs-prop-kit";
import type { PrevisPropBuilder } from "@/lib/canvas/previs/previs-props-nature";

/**
 * 参数化基础组件：楼房、塔楼、古建殿堂、道路、墙、地面、台阶、围栏、房间、平台、柱子。
 * 尺寸、层数、材质都来自对象参数（kit.num / kit.str），Agent 和用户可以精确指定「三栋 12 层玻璃楼」。
 * 参数定义（范围、默认值、标签）在 previs-prop-catalog.ts，两边的键必须一致。
 */

const MATERIAL: Record<string, PrevisPropMaterialKey> = { plaster: "wall", brick: "brick_red", stone: "stone", concrete: "concrete", wood: "wood", glass: "glass", metal: "metal" };

function windowBands(kit: PrevisPropKit, w: number, d: number, floors: number, floorH: number, y0: number) {
    for (let floor = 0; floor < floors; floor++) {
        const y = y0 + floor * floorH + floorH * 0.3;
        const h = floorH * 0.5;
        kit.box("glass", w * 0.86, h, 0.06, 0, y, d / 2 + 0.02);
        kit.box("glass", w * 0.86, h, 0.06, 0, y, -d / 2 - 0.02);
        kit.box("glass", 0.06, h, d * 0.86, w / 2 + 0.02, y, 0);
        kit.box("glass", 0.06, h, d * 0.86, -w / 2 - 0.02, y, 0);
    }
}

function roofTop(kit: PrevisPropKit, roof: string, w: number, d: number, y: number) {
    if (roof === "gable") {
        const alongX = w >= d;
        kit.gableRoof("roof", (alongX ? d : w) + 1, (alongX ? w : d) + 0.8, Math.min(4, Math.min(w, d) * 0.32), y, 0, 0, alongX ? Math.PI / 2 : 0);
    } else if (roof === "chinese") {
        kit.hipRoof("roof", w + 2, d + 2, Math.min(4, Math.min(w, d) * 0.3), y);
    } else {
        kit.box("concrete_dark", w + 0.2, 1, 0.25, 0, y, d / 2 - 0.02);
        kit.box("concrete_dark", w + 0.2, 1, 0.25, 0, y, -d / 2 + 0.02);
        kit.box("concrete_dark", 0.25, 1, d, w / 2 - 0.02, y, 0);
        kit.box("concrete_dark", 0.25, 1, d, -w / 2 + 0.02, y, 0);
        kit.box("concrete", Math.min(4, w * 0.3), 2.6, Math.min(4, d * 0.3), w * 0.2, y, -d * 0.15);
    }
}

/** 楼房：层数、宽深、层高、外立面风格、屋顶、阳台都可调。 */
function building(kit: PrevisPropKit) {
    const floors = Math.round(kit.num("floors", 6, 1, 80));
    const w = kit.num("width", 14, 4, 80);
    const d = kit.num("depth", 12, 4, 60);
    const floorH = kit.num("floorHeight", 3.2, 2.6, 6);
    const style = kit.str("style", "modern", ["modern", "glass", "brick", "concrete", "ancient"] as const);
    const roof = kit.str("roof", "flat", ["flat", "gable", "chinese"] as const);
    const balcony = kit.str("balcony", "none", ["none", "front"] as const);
    const H = floors * floorH;
    if (style === "ancient") {
        chineseTiers(kit, w, d, floors, Math.max(3, floorH));
        return;
    }
    const body: PrevisPropMaterialKey = style === "glass" ? "glass" : style === "brick" ? "brick_red" : style === "concrete" ? "concrete" : "accent";
    kit.box(body, w, H, d);
    if (style === "glass") {
        for (let floor = 1; floor <= floors; floor++) kit.box("concrete", w + 0.12, 0.22, d + 0.12, 0, floor * floorH - 0.22, 0);
        const ribs = Math.max(2, Math.round(w / 3.2));
        for (let index = 0; index <= ribs; index++) {
            const x = -w / 2 + (index / ribs) * w;
            kit.box("metal", 0.18, H, 0.3, x, 0, d / 2);
            kit.box("metal", 0.18, H, 0.3, x, 0, -d / 2);
        }
    } else {
        windowBands(kit, w, d, floors, floorH, 0);
    }
    // 底层入口。
    kit.box("glass", Math.min(4, w * 0.4), Math.min(2.8, floorH * 0.85), 0.1, 0, 0, d / 2 + 0.06);
    kit.box("concrete_dark", Math.min(5, w * 0.5), 0.2, 1.6, 0, Math.min(2.9, floorH * 0.9), d / 2 + 0.8);
    if (balcony === "front") {
        for (let floor = 1; floor < floors; floor++) {
            kit.box("concrete", w * 0.8, 0.16, 1.2, 0, floor * floorH, d / 2 + 0.6);
            kit.box("glass", w * 0.8, 0.95, 0.05, 0, floor * floorH + 0.16, d / 2 + 1.18);
        }
    }
    roofTop(kit, roof, w, d, H);
}

/** 中式多层楼阁：每层内收，层间腰檐，顶层曲面屋顶。 */
function chineseTiers(kit: PrevisPropKit, w: number, d: number, tiers: number, floorH: number) {
    kit.box("stone_light", w + 1.6, 0.8, d + 1.6);
    let y = 0.8;
    let tw = w;
    let td = d;
    for (let tier = 0; tier < tiers; tier++) {
        kit.box("accent", tw, floorH, td, 0, y, 0);
        const bays = Math.max(2, Math.round(tw / 3));
        for (let index = 0; index <= bays; index++) {
            const x = -tw / 2 + (index / bays) * tw;
            kit.cyl("red", 0.16, 0.18, floorH, x, y, td / 2 + 0.25, 8);
            kit.cyl("red", 0.16, 0.18, floorH, x, y, -td / 2 - 0.25, 8);
        }
        kit.box("wood", Math.min(2, tw * 0.25), Math.min(2.4, floorH * 0.75), 0.1, 0, y, td / 2 + 0.03);
        const last = tier === tiers - 1;
        kit.hipRoof("roof", tw + 2.4, td + 2.4, last ? Math.min(3.2, td * 0.32) : 1.1, y + floorH, { lift: last ? 0.7 : 0.45, ridge: last, thickness: 0.16 });
        y += floorH + (last ? 0 : 1);
        tw *= 0.86;
        td *= 0.86;
    }
}

/** 古建殿堂：开间数、进深、层数可调。 */
function chineseHall(kit: PrevisPropKit) {
    const bays = Math.round(kit.num("bays", 5, 3, 11));
    const d = kit.num("depth", 9, 5, 20);
    const tiers = Math.round(kit.num("tiers", 1, 1, 5));
    chineseTiers(kit, bays * 3.4, d, tiers, 4);
}

/** 塔楼：层数、宽度、退台次数、顶部造型可调。 */
function tower(kit: PrevisPropKit) {
    const floors = Math.round(kit.num("floors", 40, 10, 150));
    const w = kit.num("width", 28, 12, 70);
    const setbacks = Math.round(kit.num("setbacks", 2, 0, 3));
    const crown = kit.str("crown", "spire", ["flat", "spire", "crown"] as const);
    const total = floors * 3.6;
    let y = 0;
    let width = w;
    const sections = setbacks + 1;
    for (let section = 0; section < sections; section++) {
        const h = section === sections - 1 ? total - y : total * (section === 0 ? 0.5 : 0.25);
        kit.box("glass", width, h, width, 0, y, 0);
        for (let index = 0; index <= 5; index++) {
            const offset = -width / 2 + (index / 5) * width;
            kit.box("metal", 0.35, h, 0.5, offset, y, width / 2);
            kit.box("metal", 0.35, h, 0.5, offset, y, -width / 2);
            kit.box("metal", 0.5, h, 0.35, width / 2, y, offset);
            kit.box("metal", 0.5, h, 0.35, -width / 2, y, offset);
        }
        kit.box("concrete", width + 0.8, 1, width + 0.8, 0, y + h - 1, 0);
        y += h;
        width *= 0.76;
    }
    if (crown === "spire") {
        kit.cyl("metal", 0.6, 1.2, total * 0.04, 0, y, 0, 8);
        kit.cyl("metal", 0.12, 0.3, total * 0.08, 0, y + total * 0.04, 0, 6);
    } else if (crown === "crown") {
        for (let index = 0; index < 4; index++) kit.box("metal", width * 1.02, total * 0.05, 0.4, 0, y, 0, (index * Math.PI) / 4);
    } else {
        kit.box("concrete_dark", width * 0.6, 3, width * 0.6, 0, y, 0);
    }
}

/** 道路：沿 Z 方向，长度、宽度、铺装、车道线、人行道可调。 */
function road(kit: PrevisPropKit) {
    const length = kit.num("length", 40, 2, 600);
    const width = kit.num("width", 10, 2, 60);
    const surface = kit.str("surface", "asphalt", ["asphalt", "stone", "dirt"] as const);
    const lanes = Math.round(kit.num("lanes", 2, 0, 8));
    const sidewalk = kit.num("sidewalk", 2.5, 0, 10);
    kit.box(surface === "asphalt" ? "asphalt" : surface === "stone" ? "stone_light" : "sand", width, 0.05, length);
    if (surface === "asphalt" && lanes >= 2) {
        for (let lane = 1; lane < lanes; lane++) {
            const x = -width / 2 + (lane / lanes) * width;
            const center = lane === lanes / 2;
            for (let z = -length / 2 + 1.5; z < length / 2 - 1.5; z += center ? 6 : 9) {
                kit.box(center ? "bloom" : "road_line", 0.15, 0.012, center ? 6 : 3, x, 0.05, z + (center ? 3 : 1.5));
            }
        }
    }
    if (sidewalk > 0) {
        for (const side of [-1, 1]) {
            kit.box("concrete", sidewalk, 0.16, length, side * (width / 2 + sidewalk / 2), 0, 0);
            kit.box("stone", 0.2, 0.18, length, side * (width / 2 + 0.1), 0, 0);
        }
    }
}

/** 墙体：沿 X 方向，长、高、厚、材质、墙头可调。 */
function wall(kit: PrevisPropKit) {
    const length = kit.num("length", 8, 0.5, 200);
    const height = kit.num("height", 3, 0.3, 20);
    const thickness = kit.num("thickness", 0.3, 0.08, 8);
    const material = MATERIAL[kit.str("material", "plaster", ["plaster", "brick", "stone", "concrete", "wood"] as const)];
    const top = kit.str("top", "none", ["none", "tiles", "battlement"] as const);
    kit.box(material, length, height, thickness);
    if (top === "tiles") kit.gableRoof("roof", thickness + 0.7, length + 0.3, 0.45, height, 0, 0, Math.PI / 2);
    if (top === "battlement") {
        const count = Math.max(2, Math.floor(length / 1.6));
        for (let index = 0; index < count; index++) kit.box(material, 0.8, 0.8, thickness, -length / 2 + 0.4 + index * ((length - 0.8) / (count - 1)), height, 0);
    }
}

function groundPatch(kit: PrevisPropKit) {
    const width = kit.num("width", 20, 0.5, 800);
    const depth = kit.num("depth", 20, 0.5, 800);
    const surface = kit.str("surface", "grass", ["grass", "plaza", "stone", "sand", "water", "soil", "snow"] as const);
    const key: PrevisPropMaterialKey = surface === "grass" ? "grass" : surface === "plaza" ? "stone_light" : surface === "stone" ? "stone" : surface === "sand" ? "sand" : surface === "water" ? "water" : surface === "soil" ? "soil" : "white";
    kit.box(key, width, 0.05, depth);
}

/** 台阶：底部在 +Z 一侧，向 -Z 升高。 */
function stairs(kit: PrevisPropKit) {
    const width = kit.num("width", 3, 0.6, 40);
    const steps = Math.round(kit.num("steps", 8, 1, 60));
    const stepHeight = kit.num("stepHeight", 0.17, 0.08, 0.5);
    const stepDepth = kit.num("stepDepth", 0.3, 0.15, 1);
    const material = MATERIAL[kit.str("material", "stone", ["stone", "concrete", "wood"] as const)];
    for (let index = 0; index < steps; index++) kit.box(material, width, (index + 1) * stepHeight, stepDepth, 0, 0, (steps / 2 - index - 0.5) * stepDepth);
}

/** 围栏：沿 X 方向。 */
function fenceLine(kit: PrevisPropKit) {
    const length = kit.num("length", 8, 1, 200);
    const height = kit.num("height", 1.1, 0.4, 4);
    const style = kit.str("style", "wood", ["wood", "metal", "stone"] as const);
    const key: PrevisPropMaterialKey = style === "wood" ? "wood" : style === "metal" ? "metal" : "stone_light";
    const spacing = style === "metal" ? 0.25 : style === "stone" ? 2 : 1.5;
    const count = Math.max(1, Math.round(length / spacing));
    const post = style === "metal" ? 0.04 : style === "stone" ? 0.3 : 0.1;
    for (let index = 0; index <= count; index++) kit.box(key, post, height, post, -length / 2 + (index / count) * length, 0, 0);
    kit.box(key, length + post, style === "stone" ? 0.18 : 0.08, style === "stone" ? 0.26 : 0.06, 0, height - 0.1, 0);
    if (style !== "metal") kit.box(key, length, 0.08, 0.06, 0, height * 0.4, 0);
}

/** 室内房间：地板 + 三面墙（正面留给机位），门窗数量可调。 */
function room(kit: PrevisPropKit) {
    const width = kit.num("width", 6, 2, 40);
    const depth = kit.num("depth", 5, 2, 40);
    const height = kit.num("height", 3, 2.2, 8);
    const windows = Math.round(kit.num("windows", 2, 0, 6));
    const door = kit.str("door", "right", ["none", "left", "right", "back"] as const);
    const front = kit.str("front", "open", ["open", "closed"] as const);
    const t = 0.14;
    kit.box("wood", width, 0.08, depth);
    kit.box("accent", width, height, t, 0, 0, -depth / 2);
    kit.box("accent", t, height, depth, -width / 2, 0, 0);
    kit.box("accent", t, height, depth, width / 2, 0, 0);
    if (front === "closed") kit.box("accent", width, height, t, 0, 0, depth / 2);
    // 踢脚线。
    kit.box("wood_dark", width, 0.1, 0.03, 0, 0.08, -depth / 2 + t / 2 + 0.015);
    for (let index = 0; index < windows; index++) {
        const x = -width / 2 + ((index + 0.5) / windows) * width;
        kit.box("glass", Math.min(1.6, (width / windows) * 0.6), Math.min(1.5, height * 0.45), 0.04, x, height * 0.32, -depth / 2 + t / 2 + 0.03);
        kit.box("white", Math.min(1.7, (width / windows) * 0.64), 0.06, 0.12, x, height * 0.32 - 0.06, -depth / 2 + t / 2 + 0.06);
    }
    if (door === "left") kit.box("wood_dark", 0.06, 2.1, 0.95, -width / 2 + t / 2 + 0.03, 0, depth * 0.2);
    if (door === "right") kit.box("wood_dark", 0.06, 2.1, 0.95, width / 2 - t / 2 - 0.03, 0, depth * 0.2);
    if (door === "back") kit.box("wood_dark", 0.95, 2.1, 0.06, width * 0.3, 0, -depth / 2 + t / 2 + 0.03);
}

function platform(kit: PrevisPropKit) {
    const width = kit.num("width", 8, 0.5, 200);
    const depth = kit.num("depth", 8, 0.5, 200);
    const height = kit.num("height", 0.6, 0.05, 10);
    const material = MATERIAL[kit.str("material", "stone", ["stone", "concrete", "wood", "plaster"] as const)];
    kit.box(material, width, height, depth);
    kit.box("stone_light", width + 0.12, 0.08, depth + 0.12, 0, height - 0.08, 0);
}

function column(kit: PrevisPropKit) {
    const height = kit.num("height", 3, 0.5, 30);
    const radius = kit.num("radius", 0.25, 0.05, 3);
    const style = kit.str("style", "round", ["round", "square", "chinese"] as const);
    if (style === "square") {
        kit.box("concrete", radius * 2, height, radius * 2);
    } else if (style === "chinese") {
        kit.cyl("stone_light", radius * 1.6, radius * 1.8, 0.3, 0, 0, 0, 8);
        kit.cyl("red", radius, radius * 1.05, height - 0.3, 0, 0.3, 0, 12);
    } else {
        kit.cyl("concrete", radius * 1.3, radius * 1.4, 0.2, 0, 0, 0, 16);
        kit.cyl("concrete", radius, radius, height - 0.4, 0, 0.2, 0, 16);
        kit.cyl("concrete", radius * 1.3, radius * 1.3, 0.2, 0, height - 0.2, 0, 16);
    }
}

export const PREVIS_BASE_PROP_BUILDERS: Record<string, PrevisPropBuilder> = {
    building,
    tower,
    chinese_hall: chineseHall,
    road,
    wall,
    ground_patch: groundPatch,
    stairs,
    fence_line: fenceLine,
    room,
    platform,
    column,
};
