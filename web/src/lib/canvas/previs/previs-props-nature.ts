import type { PrevisPropKit, PrevisPropMaterialKey } from "@/lib/canvas/previs/previs-prop-kit";

export type PrevisPropBuilder = (kit: PrevisPropKit) => void;

const FOLIAGE: PrevisPropMaterialKey[] = ["foliage", "foliage_light", "foliage_dark"];
const BLOOMS: PrevisPropMaterialKey[] = ["accent", "bloom", "bloom2", "bloom3"];

function broadleaf(kit: PrevisPropKit) {
    const height = kit.range(2.2, 3.2);
    kit.cyl("trunk", 0.16, 0.26, height + 0.8, 0, 0, 0, 7);
    // 两根斜枝，让树冠不像插在棍子上的球。
    kit.rod("trunk", 0.09, 1.6, [0.45, height + 0.2, 0.1], [0, 0, -0.7], 6);
    kit.rod("trunk", 0.08, 1.4, [-0.35, height + 0.35, -0.2], [0.3, 0, 0.75], 6);
    const blobs = 4 + Math.floor(kit.rand() * 3);
    for (let index = 0; index < blobs; index++) {
        const angle = (index / blobs) * Math.PI * 2 + kit.rand();
        const spread = index === 0 ? 0 : kit.range(0.9, 1.5);
        const radius = index === 0 ? kit.range(1.9, 2.3) : kit.range(1.2, 1.7);
        kit.blob(kit.pick(FOLIAGE.slice(0, 2)), radius, [Math.cos(angle) * spread, height + 2 + kit.range(-0.4, 0.8), Math.sin(angle) * spread], [1, 0.85, 1], 0.2);
    }
}

function pine(kit: PrevisPropKit) {
    const tiers = 4 + Math.floor(kit.rand() * 2);
    const scale = kit.range(0.85, 1.15);
    kit.cyl("trunk", 0.14, 0.22, 2 * scale, 0, 0, 0, 7);
    for (let index = 0; index < tiers; index++) {
        const t = index / tiers;
        const radius = (1.9 - t * 1.4) * scale;
        kit.cone("foliage_dark", radius, 2.4 * scale, 0, (1.2 + index * 1.35) * scale, 0, 9, [0, kit.rand(), 0]);
    }
}

function willow(kit: PrevisPropKit) {
    const height = kit.range(2.6, 3.2);
    kit.cyl("trunk", 0.2, 0.32, height + 0.6, 0, 0, 0, 7);
    kit.blob("foliage_light", 2.2, [0, height + 1.4, 0], [1.15, 0.6, 1.15], 0.15);
    // 下垂的柳条：细长倒锥一圈。
    const strands = 16;
    for (let index = 0; index < strands; index++) {
        const angle = (index / strands) * Math.PI * 2 + kit.rand() * 0.3;
        const radius = kit.range(1.6, 2.4);
        const length = kit.range(2.4, 3.6);
        kit.cone("foliage_light", 0.28, length, Math.cos(angle) * radius, height + 1.4 - length, Math.sin(angle) * radius, 5, [Math.PI, 0, 0]);
    }
}

function cherry(kit: PrevisPropKit) {
    const height = kit.range(1.8, 2.3);
    kit.cyl("trunk", 0.13, 0.22, height + 0.6, 0, 0, 0, 7);
    kit.rod("trunk", 0.08, 1.5, [0.5, height + 0.3, 0], [0, 0, -0.9], 6);
    kit.rod("trunk", 0.08, 1.4, [-0.45, height + 0.3, 0.2], [0.3, 0, 0.9], 6);
    for (let index = 0; index < 6; index++) {
        const angle = (index / 6) * Math.PI * 2 + kit.rand();
        const spread = index === 0 ? 0 : kit.range(0.8, 1.4);
        kit.blob(index % 4 === 3 ? "foliage_light" : "accent", index === 0 ? 1.6 : kit.range(0.9, 1.3), [Math.cos(angle) * spread, height + 1.5 + kit.range(-0.3, 0.6), Math.sin(angle) * spread], [1, 0.8, 1], 0.22);
    }
}

function palm(kit: PrevisPropKit) {
    const segments = 7;
    const bend = kit.range(0.04, 0.09);
    let x = 0;
    let y = 0;
    for (let index = 0; index < segments; index++) {
        const tilt = bend * index;
        const length = 0.95;
        kit.rod("trunk", 0.19 - index * 0.012, length, [x + Math.sin(tilt) * length * 0.5, y + Math.cos(tilt) * length * 0.5, 0], [0, 0, -tilt], 7);
        x += Math.sin(tilt) * length;
        y += Math.cos(tilt) * length;
    }
    for (let index = 0; index < 8; index++) {
        const angle = (index / 8) * Math.PI * 2;
        kit.push([x, y, 0], angle);
        kit.beam("foliage", 0.5, 0.06, 2.6, [0, -0.35, 1.2], [0.45, 0, 0]);
        kit.pop();
    }
    for (let index = 0; index < 3; index++) kit.sphere("trunk", 0.16, [x + Math.cos(index * 2.1) * 0.25, y - 0.2, Math.sin(index * 2.1) * 0.25], [1, 1, 1], 8, 6);
}

function bamboo(kit: PrevisPropKit) {
    const count = 8 + Math.floor(kit.rand() * 6);
    for (let index = 0; index < count; index++) {
        const angle = kit.rand() * Math.PI * 2;
        const radius = kit.range(0, 0.9);
        const height = kit.range(4.2, 6.4);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const tiltX = kit.range(-0.08, 0.08);
        const tiltZ = kit.range(-0.08, 0.08);
        kit.rod("foliage_light", 0.05, height, [x + tiltZ * height * -0.5, height / 2, z + tiltX * height * 0.5], [tiltX, 0, tiltZ], 6);
        for (let leaf = 0; leaf < 3; leaf++) {
            kit.blob("foliage", kit.range(0.35, 0.55), [x + tiltZ * -height * (0.75 + leaf * 0.1), height * (0.68 + leaf * 0.12), z + tiltX * height * (0.75 + leaf * 0.1)], [1.6, 0.5, 1], 0.3, 0);
        }
    }
}

function bush(kit: PrevisPropKit) {
    const count = 3 + Math.floor(kit.rand() * 2);
    for (let index = 0; index < count; index++) {
        const angle = (index / count) * Math.PI * 2 + kit.rand();
        kit.blob(kit.pick(FOLIAGE), kit.range(0.45, 0.7), [Math.cos(angle) * 0.35, kit.range(0.45, 0.65), Math.sin(angle) * 0.35], [1, 0.85, 1], 0.25);
    }
}

function hedge(kit: PrevisPropKit) {
    kit.box("foliage_dark", 4, 0.85, 0.8);
    for (let index = 0; index < 6; index++) kit.blob("foliage_dark", 0.42, [-1.75 + index * 0.7, 0.85, 0], [1, 0.55, 0.9], 0.25, 0);
}

function grass(kit: PrevisPropKit) {
    const blades = 10 + Math.floor(kit.rand() * 6);
    for (let index = 0; index < blades; index++) {
        const angle = kit.rand() * Math.PI * 2;
        const radius = kit.range(0, 0.35);
        const height = kit.range(0.28, 0.5);
        kit.cone("grass", 0.045, height, Math.cos(angle) * radius, 0, Math.sin(angle) * radius, 3, [kit.range(-0.35, 0.35), 0, kit.range(-0.35, 0.35)]);
    }
}

function flowerCluster(kit: PrevisPropKit, count: number, width: number, depth: number, baseY: number, mixed: boolean) {
    for (let index = 0; index < count; index++) {
        const x = kit.range(-width / 2, width / 2);
        const z = kit.range(-depth / 2, depth / 2);
        const height = kit.range(0.22, 0.42);
        kit.cyl("grass", 0.012, 0.012, height, x, baseY, z, 4);
        kit.blob(mixed ? kit.pick(BLOOMS) : "accent", kit.range(0.06, 0.09), [x, baseY + height + 0.03, z], [1.2, 0.7, 1.2], 0.1, 0);
    }
}

function flowers(kit: PrevisPropKit) {
    for (let index = 0; index < 4; index++) kit.blob("foliage_light", 0.22, [kit.range(-0.35, 0.35), 0.1, kit.range(-0.35, 0.35)], [1.3, 0.55, 1.3], 0.3, 0);
    flowerCluster(kit, 16, 1, 1, 0, kit.rand() > 0.4);
}

function flowerBed(kit: PrevisPropKit) {
    kit.box("stone_light", 3, 0.35, 0.16, 0, 0, 0.72);
    kit.box("stone_light", 3, 0.35, 0.16, 0, 0, -0.72);
    kit.box("stone_light", 0.16, 0.35, 1.6, 1.42, 0, 0);
    kit.box("stone_light", 0.16, 0.35, 1.6, -1.42, 0, 0);
    kit.box("soil", 2.7, 0.3, 1.3);
    for (let index = 0; index < 8; index++) kit.blob("foliage", 0.26, [kit.range(-1.15, 1.15), 0.38, kit.range(-0.45, 0.45)], [1.3, 0.6, 1.3], 0.3, 0);
    flowerCluster(kit, 34, 2.5, 1.1, 0.3, kit.rand() > 0.5);
}

function pottedPlant(kit: PrevisPropKit) {
    kit.cyl("accent", 0.3, 0.22, 0.45, 0, 0, 0, 12);
    kit.cyl("soil", 0.27, 0.27, 0.04, 0, 0.42, 0, 12);
    if (kit.rand() > 0.5) {
        for (let index = 0; index < 7; index++) {
            const angle = (index / 7) * Math.PI * 2;
            kit.push([0, 0.45, 0], angle);
            kit.beam("foliage", 0.12, 0.03, 0.7, [0, 0.3, 0.2], [-0.9, 0, 0]);
            kit.pop();
        }
        kit.blob("foliage_dark", 0.2, [0, 0.7, 0], [1, 1.2, 1], 0.2, 0);
    } else {
        kit.blob("foliage", 0.36, [0, 0.82, 0], [1, 1.1, 1], 0.22);
        kit.blob("foliage_light", 0.24, [0.15, 1.05, 0.05], [1, 1, 1], 0.22);
    }
}

function lotusPond(kit: PrevisPropKit) {
    const segments = 18;
    for (let index = 0; index < segments; index++) {
        const angle = (index / segments) * Math.PI * 2;
        const x = Math.cos(angle) * 3;
        const z = Math.sin(angle) * 2;
        kit.box("stone_light", 1.15, 0.4, 0.45, x, 0, z, -angle + Math.PI / 2);
    }
    kit.cyl("water", 2.8, 2.8, 0.22, 0, 0, 0, 24);
    for (let index = 0; index < 10; index++) {
        const angle = kit.rand() * Math.PI * 2;
        const radius = kit.range(0.3, 2);
        const x = Math.cos(angle) * radius * 1.3;
        const z = Math.sin(angle) * radius * 0.8;
        kit.cyl("foliage", 0.32, 0.32, 0.03, x, 0.22, z, 10);
        if (index % 3 === 0) kit.cone("accent", 0.14, 0.25, x, 0.25, z, 6);
    }
}

function rock(kit: PrevisPropKit) {
    kit.blob("stone", 0.62, [0, 0.32, 0], [kit.range(1, 1.3), kit.range(0.6, 0.8), kit.range(0.9, 1.1)], 0.3, 0);
    if (kit.rand() > 0.5) kit.blob("stone", 0.32, [0.55, 0.15, 0.3], [1, 0.7, 1], 0.3, 0);
}

function boulder(kit: PrevisPropKit) {
    kit.blob("stone", 1.7, [0, 1.1, 0], [1.1, 0.85, 1], 0.28, 1);
    kit.blob("stone", 1, [1.3, 0.55, 0.6], [1, 0.8, 1], 0.3, 0);
    kit.blob("stone", 0.7, [-1.2, 0.35, -0.5], [1, 0.8, 1], 0.3, 0);
}

function hill(kit: PrevisPropKit) {
    kit.blob("grass", 20, [0, -3, 0], [1, 0.82, 0.85], 0.12, 2);
    kit.blob("foliage_light", 9, [kit.range(-8, 8), 4, kit.range(-6, 6)], [1, 0.6, 1], 0.18, 1);
    for (let index = 0; index < 5; index++) kit.blob("stone", kit.range(1.2, 2.4), [kit.range(-14, 14), kit.range(1, 5), kit.range(-10, 10)], [1, 0.7, 1], 0.3, 0);
}

function log(kit: PrevisPropKit) {
    const length = kit.range(3.2, 4.4);
    kit.rod("trunk", 0.3, length, [0, 0.3, 0], [Math.PI / 2, 0, 0], 9);
    kit.rod("wood", 0.26, 0.02, [0, 0.3, length / 2 + 0.01], [Math.PI / 2, 0, 0], 9);
    kit.rod("trunk", 0.08, 0.7, [0.25, 0.45, 0.4], [0, 0, -1], 6);
}

function sofa(kit: PrevisPropKit) {
    kit.box("wood_dark", 2.2, 0.12, 0.9);
    kit.box("accent", 2.2, 0.32, 0.9, 0, 0.12, 0);
    kit.box("accent", 2.2, 0.5, 0.22, 0, 0.35, -0.34);
    kit.box("accent", 0.2, 0.3, 0.9, -1, 0.44, 0);
    kit.box("accent", 0.2, 0.3, 0.9, 1, 0.44, 0);
    for (const x of [-0.6, 0, 0.6]) kit.box("white", 0.55, 0.12, 0.62, x, 0.44, 0.06);
}

function table(kit: PrevisPropKit, w: number, d: number) {
    kit.box("wood", w, 0.05, d, 0, 0.71, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box("wood_dark", 0.06, 0.71, 0.06, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08));
}

function chair(kit: PrevisPropKit) {
    kit.box("accent", 0.46, 0.05, 0.46, 0, 0.45, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box("wood_dark", 0.04, 0.45, 0.04, sx * 0.2, 0, sz * 0.2);
    kit.box("wood_dark", 0.04, 0.5, 0.04, -0.2, 0.45, -0.21);
    kit.box("wood_dark", 0.04, 0.5, 0.04, 0.2, 0.45, -0.21);
    kit.box("accent", 0.46, 0.18, 0.03, 0, 0.75, -0.21);
}

function bed(kit: PrevisPropKit) {
    kit.box("wood", 1.8, 0.3, 2.1);
    kit.box("white", 1.7, 0.22, 2, 0, 0.3, 0);
    kit.box("accent", 1.72, 0.06, 1.4, 0, 0.52, 0.32);
    kit.box("wood_dark", 1.86, 1.1, 0.08, 0, 0, -1.05);
    for (const x of [-0.42, 0.42]) kit.box("white", 0.62, 0.14, 0.38, x, 0.52, -0.75);
}

function bookshelf(kit: PrevisPropKit) {
    kit.box("wood", 1.2, 2, 0.04, 0, 0, -0.16);
    kit.box("wood", 0.04, 2, 0.35, -0.58, 0, 0);
    kit.box("wood", 0.04, 2, 0.35, 0.58, 0, 0);
    const books: PrevisPropMaterialKey[] = ["red", "bloom", "glass", "foliage", "white", "fabric"];
    for (let shelf = 0; shelf < 5; shelf++) {
        const y = shelf * 0.48;
        kit.box("wood", 1.16, 0.03, 0.33, 0, y, 0);
        if (shelf === 4) continue;
        let x = -0.52;
        while (x < 0.48) {
            const width = kit.range(0.04, 0.08);
            const height = kit.range(0.26, 0.38);
            kit.box(kit.pick(books), width, height, 0.24, x + width / 2, y + 0.03, 0.02);
            x += width + 0.005;
        }
    }
}

function desk(kit: PrevisPropKit) {
    table(kit, 1.4, 0.7);
    kit.box("wood_dark", 0.4, 0.55, 0.6, 0.45, 0.12, 0);
    kit.box("rubber", 0.5, 0.32, 0.03, -0.1, 0.76, -0.2);
    kit.box("metal", 0.08, 0.06, 0.08, -0.1, 0.76, -0.2);
}

export const PREVIS_NATURE_PROP_BUILDERS: Record<string, PrevisPropBuilder> = {
    tree_broadleaf: broadleaf,
    tree_pine: pine,
    tree_willow: willow,
    tree_cherry: cherry,
    tree_palm: palm,
    bamboo,
    bush,
    hedge,
    grass,
    flowers,
    flower_bed: flowerBed,
    potted_plant: pottedPlant,
    lotus_pond: lotusPond,
    rock,
    boulder,
    hill,
    log,
    sofa,
    dining_table: (kit) => table(kit, 1.6, 0.9),
    chair,
    bed,
    bookshelf,
    desk,
};
