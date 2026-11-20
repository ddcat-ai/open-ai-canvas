import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Euler, ExtrudeGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, Quaternion, Shape, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { PrevisPropParams } from "@/types/previs";

/**
 * 程序化道具的造型工具：盒体、柱体、多面体树冠、中式曲面屋顶、多边形攒尖顶、坡屋顶、拱形挤出。
 * 所有零件按材质键合并成一个 BufferGeometry，单个道具只有几次 draw call，布景里可以直接做实例化。
 * 坐标约定：米制，y 向上，原点在道具底面中心，正面朝 +Z。
 */
export type PrevisPropMaterialKey =
    | "wall"
    | "plaster"
    | "wood"
    | "wood_dark"
    | "roof"
    | "stone"
    | "stone_light"
    | "brick"
    | "foliage"
    | "foliage_light"
    | "foliage_dark"
    | "trunk"
    | "bloom"
    | "bloom2"
    | "bloom3"
    | "grass"
    | "soil"
    | "water"
    | "glass"
    | "concrete"
    | "concrete_dark"
    | "metal"
    | "accent"
    | "rubber"
    | "lamp"
    | "lantern"
    | "signal_green"
    | "gold"
    | "red"
    | "fabric"
    | "white"
    | "asphalt"
    | "sand"
    | "road_line"
    | "brick_red";

export type PrevisPropPart = { key: PrevisPropMaterialKey; geometry: BufferGeometry };

export type Vec3 = [number, number, number];
export type { PrevisPropParams };
type Vec2 = [number, number];

const Y_AXIS = new Vector3(0, 1, 0);

/** 确定性伪随机：同一种子永远得到同一造型。 */
export function previsRandom(seed: number) {
    let state = seed >>> 0 || 0x9e3779b9;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function previsHashString(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return hash >>> 0;
}

export class PrevisPropKit {
    private readonly parts = new Map<PrevisPropMaterialKey, BufferGeometry[]>();
    private readonly stack: Matrix4[] = [new Matrix4()];

    constructor(
        readonly rand: () => number,
        readonly params: PrevisPropParams = {},
    ) {}

    /** 读数值参数，越界或缺失时回落默认值并夹到 [min, max]。 */
    num(key: string, fallback: number, min = -Infinity, max = Infinity) {
        const value = Number(this.params[key]);
        return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
    }

    /** 读枚举参数，不在 allowed 里时回落默认值。 */
    str<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
        const value = this.params[key];
        return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
    }

    /** [min, max) 均匀分布。 */
    range(min: number, max: number) {
        return min + (max - min) * this.rand();
    }

    pick<T>(items: readonly T[]): T {
        return items[Math.min(items.length - 1, Math.floor(this.rand() * items.length))];
    }

    /** 进入子装配：后续零件都相对这个位置和偏航摆放。 */
    push(position: Vec3 = [0, 0, 0], rotationY = 0, scale = 1) {
        const local = new Matrix4().compose(new Vector3(...position), new Quaternion().setFromAxisAngle(Y_AXIS, rotationY), new Vector3(scale, scale, scale));
        this.stack.push(this.stack[this.stack.length - 1].clone().multiply(local));
    }

    pop() {
        if (this.stack.length > 1) this.stack.pop();
    }

    add(key: PrevisPropMaterialKey, geometry: BufferGeometry, position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) {
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        if (flat !== geometry) geometry.dispose();
        flat.clearGroups();
        const local = new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(...rotation)), new Vector3(...scale));
        flat.applyMatrix4(this.stack[this.stack.length - 1].clone().multiply(local));
        if (!flat.getAttribute("uv")) flat.setAttribute("uv", new Float32BufferAttribute(new Float32Array(flat.getAttribute("position").count * 2), 2));
        const list = this.parts.get(key);
        if (list) list.push(flat);
        else this.parts.set(key, [flat]);
    }

    /** 盒体，y 为底面高度。 */
    box(key: PrevisPropMaterialKey, w: number, h: number, d: number, x = 0, y = 0, z = 0, rotationY = 0) {
        this.add(key, new BoxGeometry(w, h, d), [x, y + h / 2, z], [0, rotationY, 0]);
    }

    /** 任意朝向的盒体，position 为中心。 */
    beam(key: PrevisPropMaterialKey, w: number, h: number, d: number, center: Vec3, rotation: Vec3) {
        this.add(key, new BoxGeometry(w, h, d), center, rotation);
    }

    /** 竖直柱体，y 为底面高度。 */
    cyl(key: PrevisPropMaterialKey, radiusTop: number, radiusBottom: number, h: number, x = 0, y = 0, z = 0, segments = 10) {
        this.add(key, new CylinderGeometry(radiusTop, radiusBottom, h, segments), [x, y + h / 2, z]);
    }

    /** 任意朝向的柱体，position 为中心。 */
    rod(key: PrevisPropMaterialKey, radius: number, length: number, center: Vec3, rotation: Vec3, segments = 8) {
        this.add(key, new CylinderGeometry(radius, radius, length, segments), center, rotation);
    }

    cone(key: PrevisPropMaterialKey, radius: number, h: number, x = 0, y = 0, z = 0, segments = 8, rotation: Vec3 = [0, 0, 0]) {
        this.add(key, new ConeGeometry(radius, h, segments), [x, y + h / 2, z], rotation);
    }

    sphere(key: PrevisPropMaterialKey, radius: number, center: Vec3, scale: Vec3 = [1, 1, 1], widthSegments = 12, heightSegments = 8) {
        this.add(key, new SphereGeometry(radius, widthSegments, heightSegments), center, [0, 0, 0], scale);
    }

    torus(key: PrevisPropMaterialKey, radius: number, tube: number, center: Vec3, rotation: Vec3, radialSegments = 6, tubularSegments = 16) {
        this.add(key, new TorusGeometry(radius, tube, radialSegments, tubularSegments), center, rotation);
    }

    /** 低多边形团块（树冠、灌木、岩石）：二十面体按位置做确定性扰动，平面着色。 */
    blob(key: PrevisPropMaterialKey, radius: number, center: Vec3, scale: Vec3 = [1, 1, 1], roughness = 0.22, detail = 1) {
        const geometry = new IcosahedronGeometry(radius, detail);
        const salt = this.rand() * 1000;
        const position = geometry.getAttribute("position");
        const point = new Vector3();
        for (let index = 0; index < position.count; index++) {
            point.fromBufferAttribute(position, index);
            // 只依赖原始坐标：非索引几何里重复的顶点得到同一扰动，不会裂缝。
            const noise = Math.sin(point.x * 12.9898 + point.y * 78.233 + point.z * 37.719 + salt) * 43758.5453;
            const jitter = (noise - Math.floor(noise) - 0.5) * 2 * roughness;
            point.multiplyScalar(1 + jitter);
            position.setXYZ(index, point.x, point.y, point.z);
        }
        geometry.computeVertexNormals();
        this.add(key, geometry, center, [0, this.rand() * Math.PI * 2, 0], scale);
    }

    /** 中式庑殿/歇山式曲面屋顶：檐口平缓、近脊陡峭，四角起翘。y 为檐口高度。 */
    hipRoof(key: PrevisPropMaterialKey, w: number, d: number, h: number, y: number, options: { lift?: number; curve?: number; thickness?: number; x?: number; z?: number; ridge?: boolean } = {}) {
        const W = w / 2;
        const D = d / 2;
        const rx = Math.max(0, (w - d) / 2);
        const rz = Math.max(0, (d - w) / 2);
        const faces: Array<[Vec2, Vec2, Vec2, Vec2]> = [
            [
                [-W, D],
                [W, D],
                [-rx, rz],
                [rx, rz],
            ],
            [
                [W, D],
                [W, -D],
                [rx, rz],
                [rx, -rz],
            ],
            [
                [W, -D],
                [-W, -D],
                [rx, -rz],
                [-rx, -rz],
            ],
            [
                [-W, -D],
                [-W, D],
                [-rx, -rz],
                [-rx, rz],
            ],
        ];
        const lift = options.lift ?? Math.min(0.6, h * 0.22);
        this.add(key, curvedRoofGeometry(faces, h, lift, options.curve ?? 1.75, options.thickness ?? 0.16), [options.x ?? 0, y, options.z ?? 0]);
        if (options.ridge !== false) {
            const length = Math.max(rx, rz) * 2 + 0.4;
            const along = rx >= rz ? 0 : Math.PI / 2;
            this.add(key, new BoxGeometry(length, Math.max(0.22, h * 0.14), 0.32), [options.x ?? 0, y + h + Math.max(0.1, h * 0.06), options.z ?? 0], [0, along, 0]);
            // 正脊两端的鸱吻：上翘的小锥体。
            for (const side of [-1, 1]) {
                const end: Vec3 = rx >= rz ? [(options.x ?? 0) + side * (length / 2), y + h + 0.2, options.z ?? 0] : [options.x ?? 0, y + h + 0.2, (options.z ?? 0) + side * (length / 2)];
                this.add(key, new ConeGeometry(0.16, Math.max(0.45, h * 0.3), 5), end, rx >= rz ? [0, 0, -side * 0.5] : [side * 0.5, 0, 0]);
            }
        }
    }

    /** 攒尖顶（凉亭、宝塔）：n 边形，四角起翘。y 为檐口高度。 */
    polygonRoof(key: PrevisPropMaterialKey, sides: number, radius: number, h: number, y: number, options: { lift?: number; curve?: number; thickness?: number; finial?: PrevisPropMaterialKey } = {}) {
        const offset = Math.PI / sides;
        const vertex = (index: number): Vec2 => {
            const angle = (index / sides) * Math.PI * 2 + offset;
            return [Math.cos(angle) * radius, Math.sin(angle) * radius];
        };
        const faces: Array<[Vec2, Vec2, Vec2, Vec2]> = [];
        for (let index = 0; index < sides; index++) faces.push([vertex(index + 1), vertex(index), [0, 0], [0, 0]]);
        this.add(key, curvedRoofGeometry(faces, h, options.lift ?? Math.min(0.55, radius * 0.16), options.curve ?? 1.6, options.thickness ?? 0.14), [0, y, 0]);
        if (options.finial) {
            this.cyl(options.finial, 0.08, 0.12, 0.5, 0, y + h - 0.05, 0, 8);
            this.sphere(options.finial, 0.18, [0, y + h + 0.55, 0], [1, 1.2, 1], 10, 8);
        }
    }

    /** 两坡屋顶，屋脊沿 Z。y 为檐口高度。 */
    gableRoof(key: PrevisPropMaterialKey, w: number, length: number, h: number, y: number, x = 0, z = 0, rotationY = 0) {
        const shape = new Shape();
        shape.moveTo(-w / 2, 0);
        shape.lineTo(w / 2, 0);
        shape.lineTo(0, h);
        shape.lineTo(-w / 2, 0);
        const geometry = new ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
        geometry.translate(0, 0, -length / 2);
        this.add(key, geometry, [x, y, z], [0, rotationY, 0]);
    }

    /** 底部开拱洞的墙体（城门、拱桥）。shape 在 XY 平面，沿 Z 挤出 depth，居中。 */
    archWall(key: PrevisPropMaterialKey, outline: Vec2[], depth: number, position: Vec3 = [0, 0, 0], rotationY = 0) {
        const shape = new Shape();
        outline.forEach(([px, py], index) => (index === 0 ? shape.moveTo(px, py) : shape.lineTo(px, py)));
        const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
        geometry.translate(0, 0, -depth / 2);
        this.add(key, geometry, position, [0, rotationY, 0]);
    }

    build(): PrevisPropPart[] {
        const result: PrevisPropPart[] = [];
        this.parts.forEach((geometries, key) => {
            const merged = mergeGeometries(geometries, false);
            geometries.forEach((geometry) => geometry.dispose());
            if (!merged) return;
            merged.computeBoundingBox();
            merged.computeBoundingSphere();
            result.push({ key, geometry: merged });
        });
        return result;
    }
}

/** 拱门轮廓：宽 width、外框高 height，底部居中开一个 archWidth 宽、肩高 archSpring 的半圆拱。 */
export function previsArchOutline(width: number, height: number, archWidth: number, archSpring: number, segments = 10): Vec2[] {
    const half = width / 2;
    const radius = archWidth / 2;
    const points: Vec2[] = [
        [-half, 0],
        [-radius, 0],
        [-radius, archSpring],
    ];
    for (let index = 1; index < segments; index++) {
        const angle = Math.PI - (index / segments) * Math.PI;
        points.push([Math.cos(angle) * radius, archSpring + Math.sin(angle) * radius]);
    }
    points.push([radius, archSpring], [radius, 0], [half, 0], [half, height], [-half, height]);
    return points;
}

/**
 * 曲面屋顶：每个坡面是从檐口线 eA→eB 到脊线 rA→rB 的网格。
 * 高度 y = h·t^curve（t=0 檐口、t=1 屋脊）呈下凹曲线；角部按 |2u-1|³·(1-t)² 起翘。
 * 相邻坡面在角线处参数一致，所以拼接无缝。附带等厚底面和檐口封边，平视时不会穿帮。
 */
function curvedRoofGeometry(faces: Array<[Vec2, Vec2, Vec2, Vec2]>, h: number, lift: number, curve: number, thickness: number) {
    const segU = 8;
    const segT = 6;
    const out: number[] = [];
    const point = (face: [Vec2, Vec2, Vec2, Vec2], u: number, t: number, drop: number): Vec3 => {
        const [eA, eB, rA, rB] = face;
        const ex = eA[0] + (eB[0] - eA[0]) * u;
        const ez = eA[1] + (eB[1] - eA[1]) * u;
        const rx = rA[0] + (rB[0] - rA[0]) * u;
        const rz = rA[1] + (rB[1] - rA[1]) * u;
        const y = h * Math.pow(t, curve) + lift * Math.pow(Math.abs(2 * u - 1), 3) * (1 - t) * (1 - t) - drop;
        return [ex + (rx - ex) * t, y, ez + (rz - ez) * t];
    };
    const triangle = (a: Vec3, b: Vec3, c: Vec3, upward: boolean) => {
        const nY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        if (nY >= 0 === upward) out.push(...a, ...b, ...c);
        else out.push(...a, ...c, ...b);
    };
    for (const face of faces) {
        for (let i = 0; i < segU; i++) {
            for (let j = 0; j < segT; j++) {
                const u0 = i / segU;
                const u1 = (i + 1) / segU;
                const t0 = j / segT;
                const t1 = (j + 1) / segT;
                for (const [drop, upward] of [
                    [0, true],
                    [thickness, false],
                ] as const) {
                    const a = point(face, u0, t0, drop);
                    const b = point(face, u1, t0, drop);
                    const c = point(face, u1, t1, drop);
                    const d = point(face, u0, t1, drop);
                    triangle(a, b, c, upward);
                    triangle(a, c, d, upward);
                }
            }
            // 檐口封边：顶面与底面之间的竖向窄条，法线朝外。
            const a = point(face, i / segU, 0, 0);
            const b = point(face, (i + 1) / segU, 0, 0);
            const c = point(face, (i + 1) / segU, 0, thickness);
            const d = point(face, i / segU, 0, thickness);
            // (b-a)×(c-a) ∝ (ez, 0, -ex)；与檐口中点同向即朝外。
            const outward = (b[2] - a[2]) * (a[0] + b[0]) - (b[0] - a[0]) * (a[2] + b[2]);
            if (outward > 0) out.push(...a, ...b, ...c, ...a, ...c, ...d);
            else out.push(...a, ...c, ...b, ...a, ...d, ...c);
        }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(out, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array((out.length / 3) * 2), 2));
    geometry.computeVertexNormals();
    return geometry;
}
