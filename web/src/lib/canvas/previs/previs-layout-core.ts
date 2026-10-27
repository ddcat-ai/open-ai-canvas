import { previsRandom } from "@/lib/canvas/previs/previs-prop-kit";
import { PREVIS_LAYOUT_VARIANTS } from "@/lib/canvas/previs/previs-prop-geometry";
import type { PrevisLayout } from "@/types/previs";

/** 布景展开结果：都在布景局部坐标（原点为布景中心，y=0 为地面）。 */
export type PrevisLayoutInstance = { propId: string; variant: number; x: number; z: number; rotationY: number; scale: number; color?: string };
export type PrevisLayoutSurfaceKind = "road" | "street" | "plaza" | "path" | "water" | "field" | "lawn" | "sidewalk";
export type PrevisLayoutSurface = { kind: PrevisLayoutSurfaceKind; x: number; z: number; w: number; d: number; rotationY: number };
/** walk=true 的路人沿 rotationY 方向来回走动（按镜头时间求值），其余原地站立。 */
export type PrevisLayoutPerson = { x: number; z: number; rotationY: number; scale: number; tone: number; walk: boolean; phase: number };

export type PrevisLayoutResult = {
    instances: PrevisLayoutInstance[];
    surfaces: PrevisLayoutSurface[];
    people: PrevisLayoutPerson[];
};

/** 单片布景的实例上限：超过后按密度裁剪，保证 4km 地面上也能流畅旋转。 */
export const PREVIS_LAYOUT_MAX_INSTANCES = 6000;
export const PREVIS_LAYOUT_MAX_PEOPLE = 2400;

type Rect = { x0: number; z0: number; x1: number; z1: number };

export class PrevisLayoutBuilder {
    readonly rand: () => number;
    readonly instances: PrevisLayoutInstance[] = [];
    readonly surfaces: PrevisLayoutSurface[] = [];
    readonly people: PrevisLayoutPerson[] = [];
    /** 已占用的轴对齐矩形，避免建筑互相穿插。 */
    private readonly occupied: Rect[] = [];

    constructor(readonly layout: PrevisLayout) {
        this.rand = previsRandom((layout.seed >>> 0) ^ 0x51ed270b);
    }

    get half() {
        return this.layout.size / 2;
    }

    get density() {
        return Math.min(1, Math.max(0.2, this.layout.density));
    }

    range(min: number, max: number) {
        return min + (max - min) * this.rand();
    }

    chance(probability: number) {
        return this.rand() < probability;
    }

    pick<T>(items: readonly T[]): T {
        return items[Math.min(items.length - 1, Math.floor(this.rand() * items.length))];
    }

    variant() {
        return Math.floor(this.rand() * PREVIS_LAYOUT_VARIANTS);
    }

    inside(x: number, z: number, margin = 0) {
        return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin;
    }

    /** 尝试占位：footprint 为宽×深（已按朝向换算成轴对齐），与已有占位重叠则放弃。 */
    claim(x: number, z: number, w: number, d: number, gap = 0.6) {
        const rect = { x0: x - w / 2 - gap, z0: z - d / 2 - gap, x1: x + w / 2 + gap, z1: z + d / 2 + gap };
        if (this.occupied.some((item) => rect.x0 < item.x1 && rect.x1 > item.x0 && rect.z0 < item.z1 && rect.z1 > item.z0)) return false;
        this.occupied.push(rect);
        return true;
    }

    /** 记为占用但不放道具（道路、水面）。 */
    reserve(x: number, z: number, w: number, d: number) {
        this.occupied.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
    }

    place(propId: string, x: number, z: number, rotationY = 0, options: { scale?: number; variant?: number; color?: string } = {}) {
        if (this.instances.length >= PREVIS_LAYOUT_MAX_INSTANCES) return;
        this.instances.push({ propId, variant: options.variant ?? this.variant(), x, z, rotationY, scale: options.scale ?? 1, color: options.color });
    }

    /** 占位成功才放置，footprint 按 0/90° 朝向换算。 */
    placeSolid(propId: string, x: number, z: number, rotationY: number, w: number, d: number, options: { scale?: number; variant?: number; color?: string; gap?: number } = {}) {
        const quarter = Math.round(rotationY / (Math.PI / 2)) % 2 !== 0;
        const scale = options.scale ?? 1;
        if (!this.claim(x, z, (quarter ? d : w) * scale, (quarter ? w : d) * scale, options.gap ?? 0.6)) return false;
        this.place(propId, x, z, rotationY, options);
        return true;
    }

    surface(kind: PrevisLayoutSurfaceKind, x: number, z: number, w: number, d: number, rotationY = 0, reserve = true) {
        this.surfaces.push({ kind, x, z, w, d, rotationY });
        if (reserve) this.reserve(x, z, rotationY ? d : w, rotationY ? w : d);
    }

    person(x: number, z: number, heading?: number) {
        if (this.people.length >= PREVIS_LAYOUT_MAX_PEOPLE || !this.layout.crowd) return;
        const walk = heading !== undefined && this.chance(0.6);
        const rotationY = walk ? heading + (this.chance(0.5) ? 0 : Math.PI) : this.rand() * Math.PI * 2;
        this.people.push({ x, z, rotationY, scale: this.range(0.9, 1.08), tone: Math.floor(this.rand() * 6), walk, phase: this.rand() });
    }

    /** 沿一条线段散布路人（街道中央两侧各留一点距离）。 */
    crowdAlong(x0: number, z0: number, x1: number, z1: number, width: number, perHundredMeters: number) {
        if (!this.layout.crowd) return;
        const length = Math.hypot(x1 - x0, z1 - z0);
        const count = Math.round((length / 100) * perHundredMeters * this.density);
        const nx = -(z1 - z0) / Math.max(length, 0.001);
        const nz = (x1 - x0) / Math.max(length, 0.001);
        for (let index = 0; index < count; index++) {
            const t = this.rand();
            const offset = (this.rand() - 0.5) * width;
            const groupSize = this.chance(0.3) ? 2 + Math.floor(this.rand() * 3) : 1;
            const heading = Math.atan2(x1 - x0, z1 - z0);
            for (let member = 0; member < groupSize; member++) {
                this.person(x0 + (x1 - x0) * t + nx * offset + this.range(-0.8, 0.8), z0 + (z1 - z0) * t + nz * offset + this.range(-0.8, 0.8), heading);
            }
        }
    }

    /** 在矩形区域内撒植物，自动避开已占位区域。 */
    scatter(propIds: readonly string[], area: Rect, count: number, options: { minScale?: number; maxScale?: number; footprint?: number; color?: string } = {}) {
        let attempts = 0;
        let placed = 0;
        while (placed < count && attempts < count * 4) {
            attempts++;
            const x = this.range(area.x0, area.x1);
            const z = this.range(area.z0, area.z1);
            const footprint = options.footprint ?? 1.2;
            if (!this.claim(x, z, footprint, footprint, 0.2)) continue;
            this.place(this.pick(propIds), x, z, this.rand() * Math.PI * 2, { scale: this.range(options.minScale ?? 0.85, options.maxScale ?? 1.2), color: options.color });
            placed++;
        }
    }

    result(): PrevisLayoutResult {
        return { instances: this.instances, surfaces: this.surfaces, people: this.people };
    }
}

export type PrevisFrontageBuilding = { propId: string; width: number; depth: number; weight: number; color?: string };

/**
 * 一排沿街建筑：沿 axis 从 s0 到 s1，另一轴固定为 c（建筑中心线），正面朝 facing（弧度，道具正面为 +Z）。
 * 建筑宽度沿街排布，密度决定空地比例。
 */
export function previsLayoutFrontage(builder: PrevisLayoutBuilder, input: { axis: "x" | "z"; s0: number; s1: number; c: number; facing: number; buildings: PrevisFrontageBuilding[]; gap?: number; extras?: (x: number, z: number) => void }) {
    const total = input.buildings.reduce((sum, item) => sum + item.weight, 0);
    let s = input.s0;
    while (s < input.s1) {
        let roll = builder.rand() * total;
        const choice = input.buildings.find((item) => (roll -= item.weight) < 0) ?? input.buildings[0];
        if (s + choice.width > input.s1) break;
        const center = s + choice.width / 2;
        const x = input.axis === "x" ? center : input.c;
        const z = input.axis === "x" ? input.c : center;
        const placed = builder.chance(0.35 + builder.density * 0.6) && builder.placeSolid(choice.propId, x, z, input.facing, choice.width, choice.depth, { color: choice.color, gap: 0.2 });
        if (placed) input.extras?.(x, z);
        s += choice.width + (input.gap ?? 1) + builder.range(0, 1.5);
    }
}

/** 街道两侧的建筑排：street 是街道中心线，沿 axis 方向，宽 width；depth 为建筑进深。 */
export function previsLayoutStreetSides(builder: PrevisLayoutBuilder, input: { axis: "x" | "z"; s0: number; s1: number; street: number; width: number; depth: number; buildings: PrevisFrontageBuilding[]; extras?: (x: number, z: number) => void }) {
    const offset = input.width / 2 + input.depth / 2 + 0.8;
    for (const side of [-1, 1]) {
        // 道具正面朝 +Z；朝向街道中心线。
        const facing = input.axis === "x" ? (side < 0 ? 0 : Math.PI) : side < 0 ? Math.PI / 2 : -Math.PI / 2;
        previsLayoutFrontage(builder, { axis: input.axis, s0: input.s0, s1: input.s1, c: input.street + side * offset, facing, buildings: input.buildings, extras: input.extras });
    }
}
