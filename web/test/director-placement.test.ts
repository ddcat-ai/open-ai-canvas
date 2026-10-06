import { describe, expect, test } from "bun:test";

import {
    PREVIS_PLACEMENT_MARGIN,
    previsObjectFootprint,
    emptyPrevisPlacementIntent,
    finitePrevisGroundPoint,
    resolvePrevisPlacement,
    resolvePrevisPlacementAnchor,
    type PrevisGroundPoint,
} from "../src/lib/canvas/previs/previs-placement";
import { createPrevisActor, createPrevisBillboard, createPrevisModel, createPrevisObject } from "../src/lib/canvas/previs/previs-scene";
import type { PrevisObject, PrevisVec3 } from "../src/types/previs";

function place(object: PrevisObject, existing: PrevisObject[]) {
    const position = resolvePrevisPlacement({ object, existing });
    return { ...object, transform: { ...object.transform, position } };
}

/** XZ 占位是否相交（含 margin）；Y 完全不参与。 */
function overlapsXZ(a: PrevisObject, b: PrevisObject) {
    const fa = previsObjectFootprint(a);
    const fb = previsObjectFootprint(b);
    const dx = Math.abs(a.transform.position[0] - b.transform.position[0]);
    const dz = Math.abs(a.transform.position[2] - b.transform.position[2]);
    return dx < (fa.width + fb.width) / 2 + PREVIS_PLACEMENT_MARGIN && dz < (fa.depth + fb.depth) / 2 + PREVIS_PLACEMENT_MARGIN;
}

function scaled(object: PrevisObject, scale: PrevisVec3) {
    return { ...object, transform: { ...object.transform, scale } };
}

describe("连续新增不重叠（B 回归）", () => {
    test("默认场景演员之外连续加 6 个立方体，两两不相交", () => {
        const placed: PrevisObject[] = [createPrevisActor("演员 1", [0, 0, 0])];
        for (let index = 0; index < 6; index += 1) placed.push(place(createPrevisObject("box", `立方体 ${index}`), placed));
        placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => expect(overlapsXZ(a, b)).toBe(false)));
    });

    test("混合 kind 连续新增：actor / model / billboard / primitive 互不相交", () => {
        const placed: PrevisObject[] = [];
        placed.push(place(createPrevisActor("演员 1", [0, 0, 0]), placed));
        placed.push(place(createPrevisModel({ name: "模型", storageKey: undefined, url: "u", mimeType: undefined, assetId: undefined }), placed));
        placed.push(place(createPrevisBillboard("立牌", "u"), placed));
        placed.push(place(createPrevisObject("sphere", "球体"), placed));
        placed.push(place(createPrevisActor("演员 2", [0, 0, 0]), placed));
        placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => expect(overlapsXZ(a, b)).toBe(false)));
    });

    test("默认 actor 与默认 model 都在原点时不再重叠", () => {
        const actor = createPrevisActor("演员 1", [0, 0, 0]);
        const model = place(createPrevisModel({ name: "模型", storageKey: undefined, url: "u", mimeType: undefined, assetId: undefined }), [actor]);
        expect(overlapsXZ(actor, model)).toBe(false);
    });

    test("隐藏对象同样占位", () => {
        const hidden = { ...createPrevisObject("box", "隐藏"), visible: false };
        const next = place(createPrevisObject("box", "新的"), [hidden]);
        expect(overlapsXZ(hidden, next)).toBe(false);
    });
});

describe("占位尺寸与缩放", () => {
    test("footprint 随 scale.x/z 放大，且不使用 scale.y", () => {
        const base = previsObjectFootprint(createPrevisObject("box", "b"));
        const wide = previsObjectFootprint(scaled(createPrevisObject("box", "b"), [3, 9, 2]));
        expect(wide.width).toBeCloseTo(base.width * 3, 6);
        expect(wide.depth).toBeCloseTo(base.depth * 2, 6);
    });

    test("负缩放按绝对值占位，不产生负尺寸", () => {
        const mirrored = previsObjectFootprint(scaled(createPrevisObject("box", "b"), [-3, 1, -2]));
        expect(mirrored.width).toBeCloseTo(3, 6);
        expect(mirrored.depth).toBeCloseTo(2, 6);
    });

    test("大缩放对象周围留出更大空隙", () => {
        const big = scaled(createPrevisObject("box", "大"), [6, 1, 6]);
        const next = place(createPrevisObject("box", "小"), [big]);
        expect(overlapsXZ(big, next)).toBe(false);
        expect(Math.hypot(next.transform.position[0], next.transform.position[2])).toBeGreaterThan(3);
    });

    test("billboard 用宽而浅的占位", () => {
        const footprint = previsObjectFootprint(createPrevisBillboard("立牌", "u"));
        expect(footprint.width).toBeGreaterThan(footprint.depth);
    });
});

describe("只改 XZ、确定性与拥挤回退", () => {
    test("保留调用方给定的 Y", () => {
        expect(place(createPrevisObject("box", "b"), [createPrevisObject("box", "a")]).transform.position[1]).toBeCloseTo(0.5, 6);
        expect(place(createPrevisActor("演员", [0, 0, 0]), [createPrevisActor("已有", [0, 0, 0])]).transform.position[1]).toBeCloseTo(0, 6);
        expect(place(createPrevisBillboard("立牌", "u"), [createPrevisBillboard("已有", "u")]).transform.position[1]).toBeCloseTo(1.1, 6);
    });

    test("同样输入得到同样输出（确定性）", () => {
        const existing = [createPrevisObject("box", "a"), createPrevisActor("演员", [2, 0, 0])];
        const first = resolvePrevisPlacement({ object: createPrevisObject("box", "新"), existing });
        const second = resolvePrevisPlacement({ object: createPrevisObject("box", "新"), existing });
        expect(first).toEqual(second);
    });

    test("空场景保留原始期望位置", () => {
        expect(resolvePrevisPlacement({ object: createPrevisObject("box", "b"), existing: [] })).toEqual([0, 0.5, 0]);
    });

    test("极端拥挤时回退位置必须与所有对象都不相交", () => {
        const crowd: PrevisObject[] = [];
        for (let x = -20; x <= 20; x += 1) {
            for (let z = -20; z <= 20; z += 1) {
                crowd.push({ ...createPrevisObject("box", `c-${x}-${z}`), transform: { position: [x, 0.5, z], rotation: [0, 0, 0], scale: [1, 1, 1] } });
            }
        }
        const placed = place(createPrevisObject("box", "新"), crowd);
        placed.transform.position.forEach((value) => expect(Number.isFinite(value)).toBe(true));
        expect(placed.transform.position[1]).toBeCloseTo(0.5, 6);
        // 核心性质：兜底不是「随便给一点」，必须真的不与任何既有占位相交。
        crowd.forEach((item) => expect(overlapsXZ(placed, item)).toBe(false));
    });

    test("超大 scale 超出 ring 搜索半径时兜底仍不相交", () => {
        // ring 最大半径 24*0.75 = 18；用远大于它的占位强制走兜底分支。
        const huge = scaled(createPrevisObject("box", "巨大"), [80, 1, 80]);
        const placed = place(createPrevisObject("box", "新"), [huge]);
        expect(overlapsXZ(placed, huge)).toBe(false);
        expect(placed.transform.position[1]).toBeCloseTo(0.5, 6);
    });

    test("多个超大占位混合时兜底位于全部占位之外", () => {
        const first = { ...scaled(createPrevisObject("box", "大 1"), [60, 1, 60]), transform: { position: [0, 0.5, 0] as PrevisVec3, rotation: [0, 0, 0] as PrevisVec3, scale: [60, 1, 60] as PrevisVec3 } };
        const second = { ...scaled(createPrevisObject("box", "大 2"), [40, 1, 40]), transform: { position: [70, 0.5, 10] as PrevisVec3, rotation: [0, 0, 0] as PrevisVec3, scale: [40, 1, 40] as PrevisVec3 } };
        const placed = place(createPrevisObject("box", "新"), [first, second]);
        [first, second].forEach((item) => expect(overlapsXZ(placed, item)).toBe(false));
    });

    test("非法输入不产生 NaN", () => {
        const broken = { ...createPrevisObject("box", "坏"), transform: { position: [Number.NaN, Number.NaN, Number.NaN] as PrevisVec3, rotation: [0, 0, 0] as PrevisVec3, scale: [Number.NaN, 1, 1] as PrevisVec3 } };
        resolvePrevisPlacement({ object: broken, existing: [createPrevisObject("box", "a")] }).forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });
});

describe("地面锚点归一化", () => {
    test("有限数值成为合法地面点", () => {
        expect(finitePrevisGroundPoint(1.5, -2.25)).toEqual({ x: 1.5, z: -2.25 });
        expect(finitePrevisGroundPoint(0, 0)).toEqual({ x: 0, z: 0 });
    });

    test("NaN / ±Infinity / 非数值一律不可用", () => {
        expect(finitePrevisGroundPoint(Number.NaN, 0)).toBeNull();
        expect(finitePrevisGroundPoint(0, Number.NaN)).toBeNull();
        expect(finitePrevisGroundPoint(Number.POSITIVE_INFINITY, 0)).toBeNull();
        expect(finitePrevisGroundPoint(0, Number.NEGATIVE_INFINITY)).toBeNull();
        expect(finitePrevisGroundPoint(undefined, 0)).toBeNull();
        expect(finitePrevisGroundPoint("3", 0)).toBeNull();
        expect(finitePrevisGroundPoint(null, null)).toBeNull();
    });
});

describe("放置来源优先级", () => {
    test("pointer 存在时优先于 orbit target", () => {
        const anchor = resolvePrevisPlacementAnchor({
            intent: { pointer: { x: 3, z: -4 }, orbitTarget: { x: 9, z: 9 } },
            fallback: [0, 0.5, 0],
        });
        expect(anchor).toEqual([3, 0.5, -4]);
    });

    test("pointer 缺失时回退 orbit target", () => {
        const anchor = resolvePrevisPlacementAnchor({
            intent: { pointer: null, orbitTarget: { x: -2.5, z: 6 } },
            fallback: [0, 0.5, 0],
        });
        expect(anchor).toEqual([-2.5, 0.5, 6]);
    });

    test("两者都不可用时保留对象原始 XZ", () => {
        expect(resolvePrevisPlacementAnchor({ intent: emptyPrevisPlacementIntent, fallback: [7, 0.5, -8] })).toEqual([7, 0.5, -8]);
        expect(resolvePrevisPlacementAnchor({ intent: null, fallback: [7, 0.5, -8] })).toEqual([7, 0.5, -8]);
    });

    test("上下文不可用返回 null intent 时不抛异常且退回默认原点", () => {
        expect(resolvePrevisPlacementAnchor({ intent: null, fallback: [0, 0, 0] })).toEqual([0, 0, 0]);
    });

    test("fallback 自身 XZ 非有限时归零，Y 仍保留", () => {
        expect(resolvePrevisPlacementAnchor({ intent: null, fallback: [Number.NaN, 1.1, Number.NaN] })).toEqual([0, 1.1, 0]);
    });
    test("非法 pointer 不得遮蔽合法 orbit target", () => {
        const cases: PrevisGroundPoint[] = [
            { x: Number.NaN, z: 0 },
            { x: 0, z: Number.NaN },
            { x: Number.POSITIVE_INFINITY, z: 0 },
            { x: 0, z: Number.NEGATIVE_INFINITY },
            { x: Number.NaN, z: Number.NaN },
        ];
        for (const pointer of cases) {
            expect(
                resolvePrevisPlacementAnchor({
                    intent: { pointer, orbitTarget: { x: -2.5, z: 6 } },
                    fallback: [0, 0.5, 0],
                }),
            ).toEqual([-2.5, 0.5, 6]);
        }
    });

    test("非法 pointer + 非法 orbit 时回退到合法 fallback XZ", () => {
        expect(
            resolvePrevisPlacementAnchor({
                intent: { pointer: { x: Number.NaN, z: Number.NaN }, orbitTarget: { x: Number.POSITIVE_INFINITY, z: 3 } },
                fallback: [7, 0.5, -8],
            }),
        ).toEqual([7, 0.5, -8]);
    });

    test("三个来源全非法时归零且仍保留构造器 Y", () => {
        expect(
            resolvePrevisPlacementAnchor({
                intent: { pointer: { x: Number.NaN, z: 0 }, orbitTarget: { x: Number.NaN, z: 0 } },
                fallback: [Number.NaN, 1.1, Number.POSITIVE_INFINITY],
            }),
        ).toEqual([0, 1.1, 0]);
    });

    test("合法 pointer 含 0 不被误判为缺失", () => {
        expect(
            resolvePrevisPlacementAnchor({
                intent: { pointer: { x: 0, z: 0 }, orbitTarget: { x: 9, z: 9 } },
                fallback: [7, 0.5, -8],
            }),
        ).toEqual([0, 0.5, 0]);
    });

    test("非法 orbit 不影响合法 pointer", () => {
        expect(
            resolvePrevisPlacementAnchor({
                intent: { pointer: { x: 3, z: -4 }, orbitTarget: { x: Number.NaN, z: Number.NaN } },
                fallback: [0, 0.5, 0],
            }),
        ).toEqual([3, 0.5, -4]);
    });

    test("非有限 fallback Y 归零，XZ 来源仍生效", () => {
        expect(
            resolvePrevisPlacementAnchor({
                intent: { pointer: { x: 2, z: 2 }, orbitTarget: null },
                fallback: [0, Number.NaN, 0],
            }),
        ).toEqual([2, 0, 2]);
    });
});

describe("锚点不改变构造器 Y", () => {
    const pointer = { pointer: { x: 4, z: 5 }, orbitTarget: null };

    test("primitive 保持 0.5", () => {
        const box = createPrevisObject("box", "立方体");
        expect(box.transform.position[1]).toBe(0.5);
        expect(resolvePrevisPlacementAnchor({ intent: pointer, fallback: box.transform.position })[1]).toBe(0.5);
    });

    test("actor 保持 0", () => {
        const actor = createPrevisActor("演员");
        expect(resolvePrevisPlacementAnchor({ intent: pointer, fallback: actor.transform.position })[1]).toBe(0);
    });

    test("model 保持 0", () => {
        const model = createPrevisModel({ name: "模型", assetId: "a", storageKey: "k", url: "u", mimeType: "model/gltf-binary" });
        expect(resolvePrevisPlacementAnchor({ intent: pointer, fallback: model.transform.position })[1]).toBe(0);
    });

    test("billboard 保持 1.1", () => {
        const billboard = createPrevisBillboard("立牌", "https://example.invalid/a.png");
        expect(billboard.transform.position[1]).toBe(1.1);
        expect(resolvePrevisPlacementAnchor({ intent: pointer, fallback: billboard.transform.position })[1]).toBe(1.1);
    });

    test("四种 kind 的锚点 XZ 都来自 pointer", () => {
        const objects = [
            createPrevisObject("box", "立方体"),
            createPrevisActor("演员"),
            createPrevisModel({ name: "模型", assetId: "a", storageKey: "k", url: "u", mimeType: "model/gltf-binary" }),
            createPrevisBillboard("立牌", "https://example.invalid/a.png"),
        ];
        for (const object of objects) {
            const anchor = resolvePrevisPlacementAnchor({ intent: pointer, fallback: object.transform.position });
            expect([anchor[0], anchor[2]]).toEqual([4, 5]);
        }
    });
});

describe("锚点与碰撞避让组合", () => {
    test("锚点空闲时精确落在锚点 XZ", () => {
        const box = createPrevisObject("box", "立方体");
        const anchored = { ...box, transform: { ...box.transform, position: resolvePrevisPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        expect(resolvePrevisPlacement({ object: anchored, existing: [] })).toEqual([6, 0.5, -6]);
    });

    test("锚点被占用时从锚点向外避让，且仍保持 Y", () => {
        const occupant = createPrevisObject("box", "占位", [6, 0.5, -6]);
        const box = createPrevisObject("box", "立方体");
        const anchored = { ...box, transform: { ...box.transform, position: resolvePrevisPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        const placed = resolvePrevisPlacement({ object: anchored, existing: [occupant] });

        expect(placed[1]).toBe(0.5);
        expect(placed).not.toEqual([6, 0.5, -6]);
        expect(overlapsXZ({ ...anchored, transform: { ...anchored.transform, position: placed } }, occupant)).toBe(false);
        // 避让必须发生在锚点附近，而不是被拉回世界原点。
        expect(Math.hypot(placed[0] - 6, placed[2] + 6)).toBeLessThan(3);
    });

    test("避让结果对同一输入确定", () => {
        const occupant = createPrevisObject("box", "占位", [6, 0.5, -6]);
        const box = createPrevisObject("box", "立方体");
        const anchored = { ...box, transform: { ...box.transform, position: resolvePrevisPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        const first = resolvePrevisPlacement({ object: anchored, existing: [occupant] });
        const second = resolvePrevisPlacement({ object: anchored, existing: [occupant] });
        expect(first).toEqual(second);
    });

    test("锚点周围极端拥挤时兜底仍不相交且不改 Y", () => {
        const crowd: PrevisObject[] = [];
        for (let x = -10; x <= 10; x += 1) {
            for (let z = -10; z <= 10; z += 1) {
                crowd.push(createPrevisObject("box", `占位 ${x}:${z}`, [6 + x, 0.5, -6 + z]));
            }
        }
        const box = createPrevisObject("box", "立方体");
        const anchored = { ...box, transform: { ...box.transform, position: resolvePrevisPlacementAnchor({ intent: { pointer: { x: 6, z: -6 }, orbitTarget: null }, fallback: box.transform.position }) } };
        const placed = resolvePrevisPlacement({ object: anchored, existing: crowd });
        const settled = { ...anchored, transform: { ...anchored.transform, position: placed } };

        expect(placed[1]).toBe(0.5);
        expect(crowd.some((item) => overlapsXZ(settled, item))).toBe(false);
    });

    test("orbit 回退来源同样参与避让", () => {
        const occupant = createPrevisObject("box", "占位", [-3, 0.5, 2]);
        const box = createPrevisObject("box", "立方体");
        const anchored = { ...box, transform: { ...box.transform, position: resolvePrevisPlacementAnchor({ intent: { pointer: null, orbitTarget: { x: -3, z: 2 } }, fallback: box.transform.position }) } };
        const placed = resolvePrevisPlacement({ object: anchored, existing: [occupant] });

        expect(placed[1]).toBe(0.5);
        expect(overlapsXZ({ ...anchored, transform: { ...anchored.transform, position: placed } }, occupant)).toBe(false);
        expect(Math.hypot(placed[0] + 3, placed[2] - 2)).toBeLessThan(3);
    });
});
