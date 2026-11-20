import { PrevisLayoutBuilder, previsLayoutStreetSides, type PrevisFrontageBuilding, type PrevisLayoutResult } from "@/lib/canvas/previs/previs-layout-core";
import type { PrevisLayout, PrevisLayoutTemplate } from "@/types/previs";

/**
 * 程序化布景：模板 + 种子 + 尺寸 + 密度 → 确定性的道具实例、地面铺装和路人。
 * Agent 只需要给出这几个参数，几百上千个建筑由这里展开，不会把城市写成几十个盒子。
 */
const CAR_COLORS = ["#c0392b", "#f4f4f2", "#2b2f36", "#2f7de1", "#9aa3ad", "#d9a441", "#3f7f5f"];
const WALL_TONES = ["#ece4d4", "#e6dccb", "#f1ece2", "#ddd3c2"];
const MODERN_TONES = ["#e3ddd3", "#f1f1ee", "#d7d9dc", "#c9bba8", "#e9e1d6"];

const ANCIENT_MAIN: PrevisFrontageBuilding[] = [
    { propId: "ancient_shop", width: 9, depth: 7.6, weight: 3 },
    { propId: "ancient_house", width: 10.5, depth: 8, weight: 1 },
];
const ANCIENT_SIDE: PrevisFrontageBuilding[] = [
    { propId: "ancient_house", width: 10.5, depth: 8, weight: 3 },
    { propId: "ancient_shop", width: 9, depth: 7.6, weight: 1 },
];

function lines(half: number, spacing: number) {
    const count = Math.floor(half / spacing);
    const result: number[] = [];
    for (let index = -count; index <= count; index++) result.push(index * spacing);
    return result;
}

function ancientCity(b: PrevisLayoutBuilder) {
    const H = b.half;
    const block = 58;
    const streets = lines(H - 14, block);
    const edge = H - 12;
    // 铺装：主街 16m、横街 14m、巷道 7m；中心广场。
    for (const s of streets) {
        const main = s === 0;
        b.surface("street", s, 0, main ? 16 : 7, edge * 2);
        b.surface("street", 0, s, edge * 2, main ? 14 : 7);
    }
    b.surface("plaza", 0, 0, 46, 46);
    // 中轴楼阁与城门压在已铺装的街面上，直接放置并占位。
    b.place("tower_hall", 0, -2, 0);
    b.reserve(0, -2, 20, 17);
    for (const [z, rotationY] of [
        [edge + 6, 0],
        [-edge - 6, Math.PI],
    ] as const) {
        b.place("city_gate", 0, z, rotationY);
        b.reserve(0, z, 34, 15);
    }
    for (let s = -edge; s <= edge; s += 20) {
        if (Math.abs(s) > 18) {
            b.placeSolid("ancient_wall", s, edge + 6, 0, 20, 6, { gap: -0.1 });
            b.placeSolid("ancient_wall", s, -edge - 6, Math.PI, 20, 6, { gap: -0.1 });
        }
        b.placeSolid("ancient_wall", edge + 6, s, -Math.PI / 2, 20, 6, { gap: -0.1 });
        b.placeSolid("ancient_wall", -edge - 6, s, Math.PI / 2, 20, 6, { gap: -0.1 });
    }
    // 沿街建筑。
    for (const s of streets) {
        const main = s === 0;
        const buildings = main ? ANCIENT_MAIN : ANCIENT_SIDE;
        const tone = () => b.pick(WALL_TONES);
        previsLayoutStreetSides(b, { axis: "z", s0: -edge, s1: edge, street: s, width: main ? 16 : 7, depth: 8, buildings: buildings.map((item) => ({ ...item, color: item.propId === "ancient_house" ? tone() : undefined })) });
        previsLayoutStreetSides(b, { axis: "x", s0: -edge, s1: edge, street: s, width: main ? 14 : 7, depth: 8, buildings: buildings.map((item) => ({ ...item, color: item.propId === "ancient_house" ? tone() : undefined })) });
    }
    // 街区内部：四合院、宝塔、树。
    for (let i = 0; i < streets.length - 1; i++) {
        for (let j = 0; j < streets.length - 1; j++) {
            const cx = (streets[i] + streets[i + 1]) / 2;
            const cz = (streets[j] + streets[j + 1]) / 2;
            if (b.chance(0.08)) b.placeSolid("pagoda", cx, cz, 0, 9, 9);
            else if (b.chance(0.55 * b.density)) b.placeSolid("ancient_courtyard", cx, cz, b.pick([0, Math.PI]), 22, 22);
            b.scatter(["tree_willow", "tree_broadleaf", "tree_broadleaf", "bamboo"], { x0: cx - 18, z0: cz - 18, x1: cx + 18, z1: cz + 18 }, Math.round(5 * b.density), { footprint: 3 });
        }
    }
    // 主街陈设：灯笼、摊位、牛车、路人。
    for (let s = -edge + 6; s < edge; s += 16) {
        if (Math.abs(s) < 26) continue;
        b.place("lantern_pole", -7, s, Math.PI / 2);
        b.place("lantern_pole", 7, s, -Math.PI / 2);
        b.place("lantern_pole", s, -6.2, 0);
        b.place("lantern_pole", s, 6.2, Math.PI);
        if (b.chance(0.6 * b.density)) b.place("market_stall", b.pick([-4, 4]), s + 5, b.pick([Math.PI / 2, -Math.PI / 2]));
        if (b.chance(0.4 * b.density)) b.place("market_stall", s + 5, b.pick([-3.6, 3.6]), b.pick([0, Math.PI]));
        if (b.chance(0.15)) b.place("ox_cart", b.range(-3, 3), s, b.pick([0, Math.PI]));
    }
    // 主街人流避开中心楼阁。
    b.crowdAlong(0, -edge, 0, -12, 13, 70);
    b.crowdAlong(0, 12, 0, edge, 13, 70);
    b.crowdAlong(-edge, 0, -12, 0, 11, 60);
    b.crowdAlong(12, 0, edge, 0, 11, 60);
    for (const s of streets)
        if (s !== 0) {
            b.crowdAlong(s, -edge, s, edge, 5, 14);
            b.crowdAlong(-edge, s, edge, s, 5, 14);
        }
    // 广场人群：楼阁前方。
    b.crowdAlong(-18, 14, 18, 14, 10, 160);
}

function ancientStreet(b: PrevisLayoutBuilder) {
    const H = b.half;
    const edge = H - 6;
    b.surface("street", 0, 0, 10, edge * 2);
    b.placeSolid("paifang", 0, edge - 1, 0, 12, 1.6, { gap: 0 });
    b.placeSolid("paifang", 0, -edge + 1, Math.PI, 12, 1.6, { gap: 0 });
    previsLayoutStreetSides(b, { axis: "z", s0: -edge + 6, s1: edge - 6, street: 0, width: 10, depth: 8, buildings: ANCIENT_MAIN });
    previsLayoutStreetSides(b, { axis: "z", s0: -edge + 6, s1: edge - 6, street: 0, width: 30, depth: 8, buildings: ANCIENT_SIDE.map((item) => ({ ...item, color: b.pick(WALL_TONES) })) });
    for (let s = -edge + 8; s < edge - 6; s += 12) {
        b.place("lantern_pole", -4.6, s, Math.PI / 2);
        b.place("lantern_pole", 4.6, s, -Math.PI / 2);
        if (b.chance(0.7 * b.density)) b.place("market_stall", b.pick([-2.6, 2.6]), s + 6, b.pick([Math.PI / 2, -Math.PI / 2]));
    }
    if (b.chance(0.7)) b.place("ox_cart", 1.5, b.range(-edge / 2, edge / 2), 0);
    b.place("well", -3.2, b.range(-10, 10), 0);
    b.scatter(["tree_willow", "tree_broadleaf", "bamboo"], { x0: -H + 2, z0: -H + 2, x1: -36, z1: H - 2 }, Math.round(H * 0.25 * b.density), { footprint: 3 });
    b.scatter(["tree_willow", "tree_broadleaf", "bamboo"], { x0: 36, z0: -H + 2, x1: H - 2, z1: H - 2 }, Math.round(H * 0.25 * b.density), { footprint: 3 });
    b.crowdAlong(0, -edge, 0, edge, 8, 130);
}

function modernBlock(b: PrevisLayoutBuilder, cx: number, cz: number, size: number, ring: number) {
    const inner = size / 2 - 4;
    if (ring < 0.32 && b.chance(0.8)) {
        b.placeSolid(b.chance(0.6) ? "skyscraper" : "office_tower", cx, cz, b.pick([0, Math.PI / 2]), 32, 32);
    } else if (ring < 0.65 && b.chance(0.7)) {
        b.placeSolid("office_tower", cx, cz, 0, 30, 30);
    }
    const buildings: PrevisFrontageBuilding[] =
        ring < 0.65
            ? [
                  { propId: "apartment", width: 19, depth: 14.5, weight: 2, color: b.pick(MODERN_TONES) },
                  { propId: "shop_front", width: 10.5, depth: 9, weight: 2 },
              ]
            : [
                  { propId: "modern_house", width: 12, depth: 9.5, weight: 2, color: b.pick(MODERN_TONES) },
                  { propId: "villa", width: 11, depth: 9, weight: 1 },
                  { propId: "apartment", width: 19, depth: 14.5, weight: 1, color: b.pick(MODERN_TONES) },
                  { propId: "shop_front", width: 10.5, depth: 9, weight: 1 },
              ];
    for (const side of [-1, 1]) {
        previsLayoutStreetSides(b, { axis: "x", s0: cx - inner, s1: cx + inner, street: cz + side * (size / 2), width: 2, depth: 14, buildings: buildings.filter(() => true) });
    }
    b.scatter(["tree_broadleaf", "bush", "tree_broadleaf"], { x0: cx - inner, z0: cz - inner, x1: cx + inner, z1: cz + inner }, Math.round(6 * b.density), { footprint: 3 });
}

function modernCity(b: PrevisLayoutBuilder) {
    const H = b.half;
    const block = 96;
    const roads = lines(H - 10, block);
    const edge = H - 6;
    for (const s of roads) {
        b.surface("road", s, 0, 18, edge * 2);
        b.surface("road", 0, s, edge * 2, 18);
        for (const side of [-1, 1]) {
            b.surface("sidewalk", s + side * 10.5, 0, 3, edge * 2, 0, false);
            b.surface("sidewalk", 0, s + side * 10.5, edge * 2, 3, 0, false);
        }
    }
    for (let i = 0; i < roads.length - 1; i++) {
        for (let j = 0; j < roads.length - 1; j++) {
            const cx = (roads[i] + roads[i + 1]) / 2;
            const cz = (roads[j] + roads[j + 1]) / 2;
            modernBlock(b, cx, cz, block - 24, Math.hypot(cx, cz) / H);
        }
    }
    for (const s of roads) {
        for (let t = -edge + 10; t < edge; t += 30) {
            b.place("street_lamp", s - 11.2, t, Math.PI / 2);
            b.place("street_lamp", s + 11.2, t + 15, -Math.PI / 2);
            b.place("tree_broadleaf", s - 11.8, t + 8, 0, { scale: 0.7 });
            b.place("tree_broadleaf", s + 11.8, t + 22, 0, { scale: 0.7 });
            b.place("street_lamp", t, s - 11.2, 0);
            b.place("street_lamp", t + 15, s + 11.2, Math.PI);
        }
        for (let t = -edge + 6; t < edge; t += 22 / b.density) {
            if (b.chance(0.55)) b.place("car", s + b.pick([-6.5, -2.5]), t + b.range(0, 8), Math.PI, { color: b.pick(CAR_COLORS) });
            if (b.chance(0.55)) b.place("car", s + b.pick([2.5, 6.5]), t + b.range(0, 8), 0, { color: b.pick(CAR_COLORS) });
            if (b.chance(0.5)) b.place("car", t + b.range(0, 8), s + b.pick([-6.5, -2.5]), Math.PI / 2, { color: b.pick(CAR_COLORS) });
            if (b.chance(0.08)) b.place("bus", t, s + 4.5, -Math.PI / 2);
        }
        b.crowdAlong(s - 10.5, -edge, s - 10.5, edge, 2.6, 22);
        b.crowdAlong(s + 10.5, -edge, s + 10.5, edge, 2.6, 22);
        b.crowdAlong(-edge, s - 10.5, edge, s - 10.5, 2.6, 22);
    }
    for (const x of roads) for (const z of roads) b.place("traffic_light", x - 9.8, z - 9.8, 0);
}

function modernStreet(b: PrevisLayoutBuilder) {
    const H = b.half;
    const edge = H - 4;
    b.surface("road", 0, 0, 14, edge * 2);
    b.surface("sidewalk", -9, 0, 4, edge * 2);
    b.surface("sidewalk", 9, 0, 4, edge * 2);
    previsLayoutStreetSides(b, {
        axis: "z",
        s0: -edge,
        s1: edge,
        street: 0,
        width: 22,
        depth: 14,
        buildings: [
            { propId: "shop_front", width: 10.5, depth: 9, weight: 3 },
            { propId: "apartment", width: 19, depth: 14.5, weight: 2, color: b.pick(MODERN_TONES) },
            { propId: "modern_house", width: 12, depth: 9.5, weight: 1, color: b.pick(MODERN_TONES) },
        ],
    });
    for (let s = -edge + 6; s < edge; s += 18) {
        b.place("street_lamp", -7.4, s, Math.PI / 2);
        b.place("street_lamp", 7.4, s + 9, -Math.PI / 2);
        b.place("tree_broadleaf", -10, s + 6, 0, { scale: 0.75 });
        b.place("tree_broadleaf", 10, s + 14, 0, { scale: 0.75 });
        if (b.chance(0.3)) b.place(b.pick(["bench", "trash_bin", "bicycle"]), -9.8, s + 2, Math.PI / 2);
        if (b.chance(0.6 * b.density)) b.place("car", b.pick([-4.8, -1.6]), s + b.range(0, 8), Math.PI, { color: b.pick(CAR_COLORS) });
        if (b.chance(0.6 * b.density)) b.place("car", b.pick([1.6, 4.8]), s + b.range(0, 8), 0, { color: b.pick(CAR_COLORS) });
    }
    b.place("bus_stop", 9.6, 0, -Math.PI / 2);
    b.place("traffic_light", -7.4, edge - 2, 0);
    b.place("traffic_light", 7.4, -edge + 2, Math.PI);
    b.crowdAlong(-9, -edge, -9, edge, 3.2, 60);
    b.crowdAlong(9, -edge, 9, edge, 3.2, 60);
}

function village(b: PrevisLayoutBuilder) {
    const H = b.half;
    b.surface("path", 0, 0, 5, H * 2 - 8, 0);
    b.surface("path", 0, b.range(-H / 3, H / 3), H * 2 - 8, 4, 0);
    b.place("well", 6, 6, 0);
    const fields = Math.round(10 * b.density) + 4;
    for (let index = 0; index < fields; index++) {
        const w = b.range(24, 46);
        const d = b.range(16, 32);
        const x = b.range(-H + w / 2, H - w / 2);
        const z = b.range(-H + d / 2, H - d / 2);
        if (b.claim(x, z, w, d, 2)) b.surface("field", x, z, w, d, 0, false);
    }
    const houses = Math.round((H / 6) * b.density) + 6;
    for (let index = 0; index < houses; index++) {
        const near = b.chance(0.7);
        const x = near ? b.pick([-1, 1]) * b.range(9, 24) : b.range(-H + 10, H - 10);
        const z = near ? b.range(-H + 10, H - 10) : b.range(-H + 10, H - 10);
        if (b.placeSolid("ancient_house", x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2, 10.5, 8, { color: b.pick(WALL_TONES), gap: 2 })) {
            if (b.chance(0.5)) b.place("fence", x + (x < 0 ? 6.5 : -6.5), z + 5, Math.PI / 2);
            if (b.chance(0.4)) b.place("tree_broadleaf", x + b.range(-6, 6), z - 7, 0);
        }
    }
    b.scatter(["tree_broadleaf", "tree_broadleaf", "bamboo", "tree_willow", "bush"], { x0: -H, z0: -H, x1: H, z1: H }, Math.round(((H * H) / 500) * b.density), { footprint: 3 });
    b.scatter(["grass", "flowers", "rock"], { x0: -H, z0: -H, x1: H, z1: H }, Math.round(((H * H) / 300) * b.density), { footprint: 0.8 });
    if (b.chance(0.8)) b.place("ox_cart", 1.2, b.range(-H / 2, H / 2), 0);
    b.crowdAlong(0, -H + 6, 0, H - 6, 4, 10);
}

function garden(b: PrevisLayoutBuilder) {
    const H = b.half;
    const pondW = H * 0.9;
    const pondD = H * 0.55;
    b.surface("water", 0, -H * 0.1, pondW, pondD);
    b.place("stone_bridge", 0, -H * 0.1, Math.PI / 2, { scale: Math.max(1, pondD / 12) });
    b.placeSolid("pavilion", pondW * 0.36, -H * 0.1 - pondD * 0.7, 0, 5, 5);
    b.placeSolid("pavilion", -pondW * 0.4, H * 0.45, 0, 5, 5);
    b.surface("path", 0, H * 0.35, H * 1.6, 3, 0);
    b.surface("path", -pondW * 0.62, 0, 3, H * 1.4, 0);
    for (let index = 0; index < 8; index++) b.place("lotus_pond", b.range(-pondW * 0.35, pondW * 0.35), -H * 0.1 + b.range(-pondD * 0.3, pondD * 0.3), b.rand() * 6, { scale: 0.5 });
    for (let index = 0; index < 14; index++) {
        const angle = (index / 14) * Math.PI * 2;
        b.place(b.chance(0.6) ? "tree_willow" : "rock", Math.cos(angle) * (pondW / 2 + 3), -H * 0.1 + Math.sin(angle) * (pondD / 2 + 3), b.rand() * 6);
    }
    b.scatter(["flower_bed", "flowers", "flowers"], { x0: -H, z0: H * 0.15, x1: H, z1: H }, Math.round(18 * b.density), { footprint: 3.2 });
    b.scatter(["tree_cherry", "bamboo", "bush", "boulder", "tree_pine"], { x0: -H, z0: -H, x1: H, z1: H }, Math.round(30 * b.density), { footprint: 3 });
    b.scatter(["grass", "flowers", "rock"], { x0: -H, z0: -H, x1: H, z1: H }, Math.round(60 * b.density), { footprint: 0.8 });
    b.crowdAlong(-H * 0.8, H * 0.35, H * 0.8, H * 0.35, 2, 20);
}

function forest(b: PrevisLayoutBuilder) {
    const H = b.half;
    b.surface("path", 0, 0, 3, H * 2, 0.25);
    const trees = Math.min(4200, Math.round(((H * H) / 36) * b.density));
    b.scatter(["tree_pine", "tree_pine", "tree_broadleaf", "tree_pine", "tree_broadleaf"], { x0: -H, z0: -H, x1: H, z1: H }, trees, { footprint: 3.2, minScale: 0.75, maxScale: 1.35 });
    b.scatter(["bush", "grass", "rock", "log", "boulder", "flowers"], { x0: -H, z0: -H, x1: H, z1: H }, Math.round(trees * 0.45), { footprint: 1.2 });
}

const TEMPLATES: Record<PrevisLayoutTemplate, (builder: PrevisLayoutBuilder) => void> = {
    ancient_city: ancientCity,
    ancient_street: ancientStreet,
    modern_city: modernCity,
    modern_street: modernStreet,
    village,
    garden,
    forest,
};

const cache = new Map<string, PrevisLayoutResult>();

export function previsLayoutCacheKey(layout: PrevisLayout) {
    return `${layout.template}|${layout.seed}|${Math.round(layout.size)}|${layout.density.toFixed(2)}|${layout.crowd ? 1 : 0}`;
}

/** 确定性展开；同参数命中缓存，切换参数时旧结果保留在缓存里以便撤销时秒回。 */
export function generatePrevisLayout(layout: PrevisLayout): PrevisLayoutResult {
    const key = previsLayoutCacheKey(layout);
    const cached = cache.get(key);
    if (cached) return cached;
    const builder = new PrevisLayoutBuilder(layout);
    (TEMPLATES[layout.template] ?? TEMPLATES.village)(builder);
    const result = builder.result();
    if (cache.size > 24) cache.delete(cache.keys().next().value as string);
    cache.set(key, result);
    return result;
}
