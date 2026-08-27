import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Euler, Vector3 } from "three";

import {
    DIRECTOR_DEFAULT_VIEW_MODE,
    DIRECTOR_VIEW_MODES,
    directorUsablePerspectiveProjection,
    directorViewFramingKey,
    directorViewModeCapabilities,
    resolveDirectorActiveCamera,
    resolveDirectorActiveShot,
    resolveDirectorEffectiveViewport,
    resolveDirectorOrthographicFraming,
    resolveDirectorOrthographicFrustum,
    resolveDirectorViewFraming,
    resolveDirectorViewUp,
    type DirectorOrthographicFrustum,
    type DirectorViewMode,
} from "../src/lib/canvas/director/director-view-modes";
import { createDirectorCamera, createDirectorLight, createDirectorObject, createDirectorScene } from "../src/lib/canvas/director/director-scene";
import type { DirectorObject, DirectorScene, DirectorVec3 } from "../src/types/director";

// 只读取工具栏源码做契约断言（见文末 describe）；视口接线不在这次任务范围内 —— 那是集成方要做的事，
// 不该让这份测试的通过与否依赖另一条 pane 正在改动的文件。
const toolbar = readFileSync(resolve(import.meta.dir, "../src/components/canvas/director/director-view-toolbar.tsx"), "utf8");

const AXIS_MODES = ["top", "front", "back", "left", "right"] as const;

function objectAt(position: DirectorVec3): DirectorObject {
    const object = createDirectorObject("box", "点云对象", position);
    return { ...object, transform: { ...object.transform, scale: [0, 0, 0] } };
}

/** 只用可控的对象点位构图，摄影机/灯光清空，避免默认场景里的固定坐标干扰包围盒断言。 */
function sceneWithObjects(objects: DirectorObject[]): DirectorScene {
    return { ...createDirectorScene(), cameras: [], lights: [], objects };
}

describe("取景模式骨架", () => {
    test("恰好七个取景模式，顺序为 3D/CAM/TOP/FRONT/BACK/LEFT/RIGHT，模式与标签一一对应", () => {
        expect(DIRECTOR_VIEW_MODES.map((item) => item.mode)).toEqual(["free", "camera", "top", "front", "back", "left", "right"]);
        expect(DIRECTOR_VIEW_MODES.map((item) => item.label)).toEqual(["3D", "CAM", "TOP", "FRONT", "BACK", "LEFT", "RIGHT"]);
    });

    test("默认是自由视角：接线前后行为一致", () => {
        expect(DIRECTOR_DEFAULT_VIEW_MODE).toBe("free");
    });

    test("每个模式都有可读提示，保证可发现", () => {
        DIRECTOR_VIEW_MODES.forEach((item) => {
            expect(item.hint.length).toBeGreaterThan(0);
            expect(item.label.length).toBeGreaterThan(0);
        });
    });
});

describe("能力矩阵", () => {
    test("3D 允许环绕、透视投影，且不接管取景", () => {
        expect(directorViewModeCapabilities("free")).toEqual({ orbit: true, framed: false, projection: "perspective" });
    });

    test("CAM 锁死环绕、透视投影，并接管取景", () => {
        expect(directorViewModeCapabilities("camera")).toEqual({ orbit: false, framed: true, projection: "perspective" });
    });

    test("五个正交轴向：锁环绕、不接管取景、必须是正交投影", () => {
        AXIS_MODES.forEach((mode) => {
            expect(directorViewModeCapabilities(mode)).toEqual({ orbit: false, framed: false, projection: "orthographic" });
        });
    });

    test("未知模式回落默认能力，不返回 undefined", () => {
        expect(directorViewModeCapabilities("nope" as DirectorViewMode)).toEqual(directorViewModeCapabilities("free"));
    });
});

describe("shot/camera 解析回落", () => {
    test("activeShotId 命中时取该 shot 与它的摄影机", () => {
        const scene = createDirectorScene();
        expect(resolveDirectorActiveShot(scene)?.id).toBe(scene.activeShotId);
        expect(resolveDirectorActiveCamera(scene)?.id).toBe(scene.cameras[0].id);
    });

    test("activeShotId 指向不存在的 shot 时回落第一个 shot", () => {
        const scene: DirectorScene = { ...createDirectorScene(), activeShotId: "missing" };
        expect(resolveDirectorActiveShot(scene)?.id).toBe(scene.shots[0].id);
    });

    test("shot 的 cameraId 失效时回落第一台摄影机，而不是返回 null", () => {
        const base = createDirectorScene();
        const scene: DirectorScene = { ...base, shots: [{ ...base.shots[0], cameraId: "missing" }] };
        expect(resolveDirectorActiveCamera(scene)?.id).toBe(base.cameras[0].id);
    });

    test("空场景返回 null 而不是抛异常", () => {
        const scene: DirectorScene = { ...createDirectorScene(), shots: [], cameras: [] };
        expect(resolveDirectorActiveShot(scene)).toBeNull();
        expect(resolveDirectorActiveCamera(scene)).toBeNull();
    });
});

describe("CAM 取景解算", () => {
    test("3D 模式不产生取景：自由视角完全不被写入", () => {
        expect(resolveDirectorViewFraming({ scene: createDirectorScene(), mode: "free", playhead: 0 })).toBeNull();
    });

    test("五个正交轴向同样不触发 CAM 取景：framed 只属于 camera", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            expect(resolveDirectorViewFraming({ scene, mode, playhead: 0 })).toBeNull();
        });
    });

    test("CAM 模式取当前 shot 摄影机的位置、焦点与光学参数", () => {
        const scene = createDirectorScene();
        const camera = scene.cameras[0];
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(framing?.cameraId).toBe(camera.id);
        expect(framing?.position).toEqual(camera.transform.position);
        expect(framing?.target).toEqual(camera.target);
        expect(framing?.fov).toBe(camera.fov);
        expect(framing?.near).toBe(camera.near);
        expect(framing?.far).toBe(camera.far);
    });

    test("CAM 模式下位置按 playhead 插值：拖时间轴即预览运镜", () => {
        const base = createDirectorScene();
        const camera = {
            ...base.cameras[0],
            keyframes: [
                { id: "k0", time: 0, transform: { position: [0, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
                { id: "k1", time: 2, transform: { position: [10, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
            ],
        };
        const scene: DirectorScene = { ...base, cameras: [camera] };
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 1 })?.position[0]).toBeCloseTo(5, 5);
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })?.position[0]).toBeCloseTo(0, 5);
    });

    test("空场景在 CAM 模式下返回 null，视口保持自由视角而不是黑屏", () => {
        const scene: DirectorScene = { ...createDirectorScene(), shots: [], cameras: [] };
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })).toBeNull();
    });

    test("非法数值（NaN/Infinity）不产生取景：绝不把坏值写进相机", () => {
        const base = createDirectorScene();
        const broken = { ...createDirectorCamera(), transform: { position: [Number.NaN, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } };
        const brokenTarget = { ...createDirectorCamera(), target: [0, Number.POSITIVE_INFINITY, 0] as DirectorVec3 };
        const brokenFov = { ...createDirectorCamera(), fov: Number.NaN };
        [broken, brokenTarget, brokenFov].forEach((camera) => {
            const scene: DirectorScene = { ...base, cameras: [camera], shots: [{ ...base.shots[0], cameraId: camera.id }] };
            expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("playhead 非有限时按 0 解算，而不是产出 NaN 取景", () => {
        const scene = createDirectorScene();
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: Number.NaN });
        expect(framing).not.toBeNull();
        expect(framing?.position.every(Number.isFinite)).toBe(true);
    });

    test("位置与焦点重合时沿摄影机 -Z 造焦点，视线不为零向量", () => {
        const base = createDirectorScene();
        const camera = { ...createDirectorCamera(), transform: { position: [1, 1, 1] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 }, target: [1, 1, 1] as DirectorVec3 };
        const scene: DirectorScene = { ...base, cameras: [camera], shots: [{ ...base.shots[0], cameraId: camera.id }] };
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(framing).not.toBeNull();
        expect(framing?.target).toEqual([1, 1, 0]);
    });
});

function sceneWithOptics(optics: { fov?: number; near?: number; far?: number }): DirectorScene {
    const base = createDirectorScene();
    const camera = { ...base.cameras[0], ...optics };
    return { ...base, cameras: [camera], shots: [{ ...base.shots[0], cameraId: camera.id }] };
}

describe("透视投影可用性：拒绝写进 Three 的非法 fov/near/far", () => {
    test("默认摄影机光学参数可用", () => {
        const scene = createDirectorScene();
        const camera = scene.cameras[0];
        expect(directorUsablePerspectiveProjection({ fov: camera.fov, near: camera.near, far: camera.far })).toBe(true);
        expect(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 })).not.toBeNull();
    });

    test("非法 fov（0 / 180 / 超出开区间 / 负 / 非有限）不产生取景", () => {
        [0, 180, 181, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].forEach((fov) => {
            expect(directorUsablePerspectiveProjection({ fov, near: 0.05, far: 500 })).toBe(false);
            expect(resolveDirectorViewFraming({ scene: sceneWithOptics({ fov }), mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("非法 near（0 / 负 / 非有限）不产生取景", () => {
        [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].forEach((near) => {
            expect(directorUsablePerspectiveProjection({ fov: 50, near, far: 500 })).toBe(false);
            expect(resolveDirectorViewFraming({ scene: sceneWithOptics({ near }), mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("far 不大于 near 时不产生取景", () => {
        [
            { near: 1, far: 1 },
            { near: 2, far: 1 },
            { near: 0.05, far: 0 },
            { near: 0.05, far: Number.NaN },
        ].forEach((optics) => {
            expect(directorUsablePerspectiveProjection({ fov: 50, ...optics })).toBe(false);
            expect(resolveDirectorViewFraming({ scene: sceneWithOptics(optics), mode: "camera", playhead: 0 })).toBeNull();
        });
    });

    test("边界合法：开区间内的小 fov、接近 180 的 fov、极小正 near 且 far 更大", () => {
        [
            { fov: 0.1, near: 0.05, far: 500 },
            { fov: 179.9, near: 0.05, far: 500 },
            { fov: 50, near: 1e-6, far: 1e-5 },
            { fov: 50, near: 0.05, far: 0.0500001 },
        ].forEach((optics) => {
            expect(directorUsablePerspectiveProjection(optics)).toBe(true);
            const framing = resolveDirectorViewFraming({ scene: sceneWithOptics(optics), mode: "camera", playhead: 0 });
            expect(framing).not.toBeNull();
            expect(framing?.fov).toBe(optics.fov);
            expect(framing?.near).toBe(optics.near);
            expect(framing?.far).toBe(optics.far);
        });
    });
});

describe("有效视口回落：CAM 无取景时用 free，恢复后回到 CAM", () => {
    test("空 CAM 场景：取景为 null，活动相机与环绕都回落 free，不改 scene", () => {
        const scene: DirectorScene = { ...createDirectorScene(), shots: [], cameras: [] };
        const snapshot = JSON.parse(JSON.stringify(scene));
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        expect(framing).toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing })).toEqual({ camera: "free", orbit: true });
        expect(scene).toEqual(snapshot);
    });

    test("合法 → 非法 → 合法：同一决策函数确定性回到 CAM", () => {
        const validScene = createDirectorScene();
        const valid = resolveDirectorViewFraming({ scene: validScene, mode: "camera", playhead: 0 });
        expect(valid).not.toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing: valid })).toEqual({ camera: "camera", orbit: false });

        const invalid = resolveDirectorViewFraming({ scene: sceneWithOptics({ fov: 0 }), mode: "camera", playhead: 0 });
        expect(invalid).toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing: invalid })).toEqual({ camera: "free", orbit: true });

        const recovered = resolveDirectorViewFraming({ scene: validScene, mode: "camera", playhead: 0 });
        expect(recovered).not.toBeNull();
        expect(resolveDirectorEffectiveViewport({ mode: "camera", framing: recovered })).toEqual({ camera: "camera", orbit: false });
        expect(directorViewFramingKey(recovered)).toBe(directorViewFramingKey(valid));
    });

    test("非法 fov/near/far 与空场景走同一条 free 回落", () => {
        const empty = resolveDirectorViewFraming({ scene: { ...createDirectorScene(), shots: [], cameras: [] }, mode: "camera", playhead: 0 });
        const badFov = resolveDirectorViewFraming({ scene: sceneWithOptics({ fov: 180 }), mode: "camera", playhead: 0 });
        const badNear = resolveDirectorViewFraming({ scene: sceneWithOptics({ near: 0 }), mode: "camera", playhead: 0 });
        const badFar = resolveDirectorViewFraming({ scene: sceneWithOptics({ near: 10, far: 1 }), mode: "camera", playhead: 0 });
        [empty, badFov, badNear, badFar].forEach((framing) => {
            expect(framing).toBeNull();
            expect(resolveDirectorEffectiveViewport({ mode: "camera", framing })).toEqual({ camera: "free", orbit: true });
        });
    });

    test("3D 模式始终是 free，即使误传入 CAM 取景也不切换相机", () => {
        const framing = resolveDirectorViewFraming({ scene: createDirectorScene(), mode: "camera", playhead: 0 });
        expect(resolveDirectorEffectiveViewport({ mode: "free", framing })).toEqual({ camera: "free", orbit: true });
        expect(resolveDirectorEffectiveViewport({ mode: "free", framing: null })).toEqual({ camera: "free", orbit: true });
    });

    test("五个正交轴向不走 CAM 回落：始终正交且锁环绕", () => {
        AXIS_MODES.forEach((mode) => {
            expect(resolveDirectorEffectiveViewport({ mode, framing: null })).toEqual({ camera: "orthographic", orbit: false });
        });
    });

    test("回落决策是纯函数，不写 scene / 不产生 history 输入", () => {
        const scene = createDirectorScene();
        const objectsRef = scene.objects;
        const camerasRef = scene.cameras;
        const snapshot = JSON.parse(JSON.stringify(scene));
        const framing = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        resolveDirectorEffectiveViewport({ mode: "camera", framing });
        resolveDirectorEffectiveViewport({ mode: "camera", framing: null });
        expect(scene).toEqual(snapshot);
        expect(scene.objects).toBe(objectsRef);
        expect(scene.cameras).toBe(camerasRef);
    });
});

describe("up 向量：保住荷兰角，且绝不与视线共线", () => {
    test("无 roll 时就是世界 up", () => {
        expect(resolveDirectorViewUp([0, 0, 0], [0, 0, -1])).toEqual([0, 1, 0]);
    });

    test("有 roll 时 up 随之旋转：裸 lookAt 会丢掉的荷兰角在这里留住", () => {
        const up = resolveDirectorViewUp([0, 0, Math.PI / 2], [0, 0, -1]);
        expect(up[0]).toBeCloseTo(-1, 5);
        expect(up[1]).toBeCloseTo(0, 5);
        expect(Math.abs(up[1] - 1)).toBeGreaterThan(0.5);
    });

    test("正俯视退化时换备选 up，叉积非零（否则 lookAt 解出 NaN 矩阵）", () => {
        const view: DirectorVec3 = [0, -1, 0];
        const up = resolveDirectorViewUp([0, 0, 0], view);
        expect(up).toEqual([0, 0, -1]);
        expect(new Vector3(...up).cross(new Vector3(...view)).length()).toBeGreaterThan(1e-6);
    });

    test("正仰视同样不共线", () => {
        const view: DirectorVec3 = [0, 1, 0];
        const up = resolveDirectorViewUp([0, 0, 0], view);
        expect(new Vector3(...up).cross(new Vector3(...view)).length()).toBeGreaterThan(1e-6);
    });

    test("视线为零向量时返回世界 up，不返回非法值", () => {
        expect(resolveDirectorViewUp([0, 0, 0], [0, 0, 0])).toEqual([0, 1, 0]);
    });

    test("任意朝向下 up 与视线都不共线：抽样覆盖球面", () => {
        const angles = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI];
        angles.forEach((pitch) =>
            angles.forEach((roll) => {
                const rotation: DirectorVec3 = [pitch, 0, roll];
                const view = new Vector3(0, 0, -1).applyEuler(new Euler(...rotation)).toArray() as DirectorVec3;
                const up = resolveDirectorViewUp(rotation, view);
                expect(up.every(Number.isFinite)).toBe(true);
                expect(new Vector3(...up).cross(new Vector3(...view)).length()).toBeGreaterThan(1e-6);
            }),
        );
    });
});

describe("取景同步键", () => {
    test("无取景时为空串：3D 模式不触发相机回写", () => {
        expect(directorViewFramingKey(null)).toBe("");
    });

    test("同一取景值稳定：对象换身份不引起重同步", () => {
        const scene = createDirectorScene();
        const first = resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 });
        const second = resolveDirectorViewFraming({ scene: { ...scene, cameras: [{ ...scene.cameras[0] }] }, mode: "camera", playhead: 0 });
        expect(directorViewFramingKey(first)).toBe(directorViewFramingKey(second));
    });

    test("playhead 推进导致取景变化时键随之变化", () => {
        const base = createDirectorScene();
        const camera = {
            ...base.cameras[0],
            keyframes: [
                { id: "k0", time: 0, transform: { position: [0, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
                { id: "k1", time: 2, transform: { position: [10, 0, 0] as DirectorVec3, rotation: [0, 0, 0] as DirectorVec3, scale: [1, 1, 1] as DirectorVec3 } },
            ],
        };
        const scene: DirectorScene = { ...base, cameras: [camera] };
        const at0 = directorViewFramingKey(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 }));
        const at1 = directorViewFramingKey(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 1 }));
        expect(at0).not.toBe(at1);
    });

    test("换摄影机时键变化：切 shot 必须重新取景", () => {
        const base = createDirectorScene();
        const other = createDirectorCamera("副摄影机");
        const scene: DirectorScene = { ...base, cameras: [other], shots: [{ ...base.shots[0], cameraId: other.id }] };
        const first = directorViewFramingKey(resolveDirectorViewFraming({ scene: base, mode: "camera", playhead: 0 }));
        const second = directorViewFramingKey(resolveDirectorViewFraming({ scene, mode: "camera", playhead: 0 }));
        expect(first).not.toBe(second);
    });
});

describe("正交轴向取景：可用性与基本形状", () => {
    test("free/camera 不是正交轴向，返回 null", () => {
        const scene = createDirectorScene();
        expect(resolveDirectorOrthographicFraming({ scene, mode: "free" })).toBeNull();
        expect(resolveDirectorOrthographicFraming({ scene, mode: "camera" })).toBeNull();
    });

    test("五个正交轴向都返回非空取景，且数值字段全部有限", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode });
            expect(framing).not.toBeNull();
            expect([...framing!.position, ...framing!.target, ...framing!.up, framing!.horizontalSpan, framing!.verticalSpan, framing!.near, framing!.far].every(Number.isFinite)).toBe(true);
        });
    });

    test("near 恒小于 far，且都是有限正数", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expect(framing.near).toBeGreaterThan(0);
            expect(framing.far).toBeGreaterThan(framing.near);
        });
    });

    test("horizontalSpan 与 verticalSpan 恒为正数，绝不退化成 0（否则正交相机变成无限缩放）", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expect(framing.horizontalSpan).toBeGreaterThan(0);
            expect(framing.verticalSpan).toBeGreaterThan(0);
        });
    });

    test("同一输入调用两次结果完全一致：纯函数，值稳定可重复", () => {
        const scene = createDirectorScene();
        AXIS_MODES.forEach((mode) => {
            expect(resolveDirectorOrthographicFraming({ scene, mode })).toEqual(resolveDirectorOrthographicFraming({ scene, mode }));
        });
    });
});

describe("正交轴向取景：五个方向与 up 严格自洽", () => {
    const asymmetric = () => sceneWithObjects([objectAt([-1, -1, -1]), objectAt([3, 3, 3])]);

    test("top：看向 -Y，位置在目标正上方，up 为 -Z", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "top" })!;
        expect(framing.up).toEqual([0, 0, -1]);
        expect(framing.position[1]).toBeGreaterThan(framing.target[1]);
        expect(framing.position[0]).toBeCloseTo(framing.target[0], 5);
        expect(framing.position[2]).toBeCloseTo(framing.target[2], 5);
    });

    test("front：看向 -Z，位置在目标 +Z 一侧，up 为 +Y", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "front" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[2]).toBeGreaterThan(framing.target[2]);
        expect(framing.position[0]).toBeCloseTo(framing.target[0], 5);
    });

    test("back：看向 +Z，位置在目标 -Z 一侧，up 为 +Y，与 front 正对面", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "back" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[2]).toBeLessThan(framing.target[2]);
    });

    test("left：看向 +X，位置在目标 -X 一侧，up 为 +Y", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "left" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[0]).toBeLessThan(framing.target[0]);
    });

    test("right：看向 -X，位置在目标 +X 一侧，up 为 +Y，与 left 正对面", () => {
        const framing = resolveDirectorOrthographicFraming({ scene: asymmetric(), mode: "right" })!;
        expect(framing.up).toEqual([0, 1, 0]);
        expect(framing.position[0]).toBeGreaterThan(framing.target[0]);
    });

    test("up 与视线方向恒定正交，绝不共线", () => {
        const scene = asymmetric();
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            const view = framing.target.map((value, index) => value - framing.position[index]);
            const dot = view.reduce((sum, value, index) => sum + value * framing.up[index], 0);
            expect(Math.abs(dot)).toBeLessThan(1e-9);
        });
    });
});

describe("正交轴向取景：包围盒驱动的 target 与 verticalSpan", () => {
    test("target 是可见内容的包围盒中心", () => {
        const scene = sceneWithObjects([objectAt([-3, 1, -2]), objectAt([5, 4, 6])]);
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(framing.target).toEqual([1, 2.5, 2]);
    });

    test("投影跨度取决于屏幕轴：top=X/Z，front/back=X/Y，left/right=Z/Y", () => {
        // x 范围 10，y 范围 4，z 范围 6 —— 三轴都不同，能分辨每一种模式读了哪两根轴。
        const scene = sceneWithObjects([objectAt([0, 0, 0]), objectAt([10, 4, 6])]);
        const top = resolveDirectorOrthographicFraming({ scene, mode: "top" })!;
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        const back = resolveDirectorOrthographicFraming({ scene, mode: "back" })!;
        const left = resolveDirectorOrthographicFraming({ scene, mode: "left" })!;
        const right = resolveDirectorOrthographicFraming({ scene, mode: "right" })!;
        expect(top.horizontalSpan / front.horizontalSpan).toBeCloseTo(1, 5);
        expect(top.verticalSpan / front.verticalSpan).toBeCloseTo(6 / 4, 5);
        expect(front.horizontalSpan).toBeCloseTo(back.horizontalSpan, 9);
        expect(front.verticalSpan).toBeCloseTo(back.verticalSpan, 9);
        expect(left.horizontalSpan).toBeCloseTo(right.horizontalSpan, 9);
        expect(left.verticalSpan).toBeCloseTo(right.verticalSpan, 9);
        expect(front.verticalSpan).toBeCloseTo(left.verticalSpan, 9);
        expect(left.horizontalSpan / front.horizontalSpan).toBeCloseTo(6 / 10, 5);
        expect(top.horizontalSpan / left.horizontalSpan).toBeCloseTo(10 / 6, 5);
    });

    test("verticalSpan 随包围盒线性缩放：内容放大 2 倍，取景高度也放大 2 倍", () => {
        const small = sceneWithObjects([objectAt([-1, -1, -1]), objectAt([1, 1, 1])]);
        const large = sceneWithObjects([objectAt([-2, -2, -2]), objectAt([2, 2, 2])]);
        const smallSpan = resolveDirectorOrthographicFraming({ scene: small, mode: "front" })!.verticalSpan;
        const largeSpan = resolveDirectorOrthographicFraming({ scene: large, mode: "front" })!.verticalSpan;
        expect(largeSpan / smallSpan).toBeCloseTo(2, 5);
    });

    test("对称立方体包围盒下，五个轴向的 verticalSpan 完全相等", () => {
        const scene = sceneWithObjects([objectAt([-2, -2, -2]), objectAt([2, 2, 2])]);
        const spans = AXIS_MODES.map((mode) => resolveDirectorOrthographicFraming({ scene, mode })!.verticalSpan);
        spans.forEach((span) => expect(span).toBeCloseTo(spans[0], 9));
    });

    test("大比例和旋转后的对象按角点构图，不再只看中心导致裁切", () => {
        const wide = createDirectorObject("plane", "背景板", [0, 1, 0]);
        wide.transform = { position: [0, 1, 0], rotation: [0, Math.PI / 4, 0], scale: [10, 4, 2] };
        const scene = sceneWithObjects([wide]);
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        const top = resolveDirectorOrthographicFraming({ scene, mode: "top" })!;

        expect(front.horizontalSpan).toBeGreaterThan(8);
        expect(front.verticalSpan).toBeCloseTo(4 * 1.2, 6);
        expect(top.horizontalSpan).toBeGreaterThan(8);
        expect(top.verticalSpan).toBeGreaterThan(8);
    });
});

describe("正交轴向取景：空场景与非法数据回落", () => {
    test("空场景（无对象/摄影机/灯光）回落安全默认包围盒，target 在原点", () => {
        const scene = sceneWithObjects([]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expect(framing).not.toBeNull();
            expect(framing.target).toEqual([0, 0, 0]);
            expect(framing.horizontalSpan).toBeGreaterThan(0);
            expect(framing.verticalSpan).toBeGreaterThan(0);
        });
    });

    test("全部点位非法（NaN/Infinity）时回落安全默认包围盒，而不是产出非 finite 值", () => {
        const base = createDirectorScene();
        const scene: DirectorScene = {
            ...base,
            objects: [objectAt([Number.NaN, 0, 0]), objectAt([0, Number.POSITIVE_INFINITY, 0])],
            cameras: [{ ...createDirectorCamera(), transform: { position: [Number.NaN, Number.NaN, Number.NaN], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
            lights: [{ ...createDirectorLight("point", "坏灯光", [0, 0, 0]), transform: { position: [Number.NEGATIVE_INFINITY, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
        };
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(framing.target).toEqual([0, 0, 0]);
        expect([...framing.position, framing.horizontalSpan, framing.verticalSpan, framing.near, framing.far].every(Number.isFinite)).toBe(true);
    });

    test("部分点位非法时只用合法点计算包围盒，不被坏值污染", () => {
        const scene = sceneWithObjects([objectAt([0, 0, 0]), objectAt([Number.NaN, 5, 0]), objectAt([4, 4, 0])]);
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        // 合法点只有 (0,0,0) 与 (4,4,0)：中心 (2,2,0)。
        expect(framing.target).toEqual([2, 2, 0]);
    });

    test("隐藏对象不计入包围盒，只有可见内容参与构图", () => {
        const visible = objectAt([0, 0, 0]);
        const hidden: DirectorObject = { ...objectAt([100, 100, 100]), visible: false };
        const scene = sceneWithObjects([visible, hidden]);
        const framing = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(framing.target).toEqual([0, 0, 0]);
    });
});

function expectFrustumFits(frustum: DirectorOrthographicFrustum, horizontalSpan: number, verticalSpan: number, aspect: number) {
    const width = frustum.right - frustum.left;
    const height = frustum.top - frustum.bottom;
    expect(frustum.halfWidth).toBeGreaterThan(0);
    expect(frustum.halfHeight).toBeGreaterThan(0);
    expect([frustum.halfWidth, frustum.halfHeight, frustum.left, frustum.right, frustum.top, frustum.bottom].every(Number.isFinite)).toBe(true);
    expect(width).toBeGreaterThanOrEqual(horizontalSpan - 1e-9);
    expect(height).toBeGreaterThanOrEqual(verticalSpan - 1e-9);
    expect(width / height).toBeCloseTo(aspect, 9);
    expect(frustum.left).toBeCloseTo(-frustum.halfWidth, 9);
    expect(frustum.right).toBeCloseTo(frustum.halfWidth, 9);
    expect(frustum.top).toBeCloseTo(frustum.halfHeight, 9);
    expect(frustum.bottom).toBeCloseTo(-frustum.halfHeight, 9);
}

describe("正交视锥：同时装下水平与竖直跨度", () => {
    test("极宽内容：正方形视口下半宽度等于水平跨度的一半，而不是高度×aspect", () => {
        const scene = sceneWithObjects([objectAt([-40, 0, 0]), objectAt([40, 2, 0])]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 1 }), framing.horizontalSpan, framing.verticalSpan, 1);
        });
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(front.horizontalSpan).toBeCloseTo(80 * 1.2, 9);
        const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: front.horizontalSpan, verticalSpan: front.verticalSpan, aspect: 1 });
        expect(frustum.halfWidth).toBeCloseTo(front.horizontalSpan / 2, 9);
        expect(frustum.halfWidth).toBeGreaterThan(front.verticalSpan / 2);
    });

    test("极高内容：正方形视口下半高度等于竖直跨度的一半，水平方向按 aspect 补齐", () => {
        const scene = sceneWithObjects([objectAt([0, -40, 0]), objectAt([2, 40, 0])]);
        const front = resolveDirectorOrthographicFraming({ scene, mode: "front" })!;
        expect(front.verticalSpan).toBeCloseTo(80 * 1.2, 9);
        const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: front.horizontalSpan, verticalSpan: front.verticalSpan, aspect: 1 });
        expectFrustumFits(frustum, front.horizontalSpan, front.verticalSpan, 1);
        expect(frustum.halfHeight).toBeCloseTo(front.verticalSpan / 2, 9);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 1 }), framing.horizontalSpan, framing.verticalSpan, 1);
        });
    });

    test("窄视口（aspect=0.5）仍同时装下两条跨度，且宽高比保持 0.5", () => {
        const scene = sceneWithObjects([objectAt([-5, 0, 0]), objectAt([5, 4, 0])]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 0.5 }), framing.horizontalSpan, framing.verticalSpan, 0.5);
        });
    });

    test("宽视口（aspect=2）仍同时装下两条跨度，且宽高比保持 2", () => {
        const scene = sceneWithObjects([objectAt([0, 0, 0]), objectAt([4, 4, 4])]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 2 }), framing.horizontalSpan, framing.verticalSpan, 2);
        });
    });

    test("空场景回落默认包围盒后，视锥仍有限、为正，并能装下两条跨度", () => {
        const scene = sceneWithObjects([]);
        AXIS_MODES.forEach((mode) => {
            const framing = resolveDirectorOrthographicFraming({ scene, mode })!;
            const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: framing.horizontalSpan, verticalSpan: framing.verticalSpan, aspect: 16 / 9 });
            expectFrustumFits(frustum, framing.horizontalSpan, framing.verticalSpan, 16 / 9);
        });
    });

    test("aspect 为 0 / 负 / NaN / ±Infinity 时回落正方形，半范围仍有限且为正", () => {
        [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].forEach((aspect) => {
            const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan: 10, verticalSpan: 10, aspect });
            expectFrustumFits(frustum, 10, 10, 1);
            expect(frustum.halfWidth).toBeCloseTo(frustum.halfHeight, 9);
        });
    });

    test("跨度为 0 / 负 / NaN / ±Infinity 时仍给出有限正半范围", () => {
        const invalid = [0, -4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
        invalid.forEach((horizontalSpan) =>
            invalid.forEach((verticalSpan) => {
                const frustum = resolveDirectorOrthographicFrustum({ horizontalSpan, verticalSpan, aspect: 1 });
                expect(frustum.halfWidth).toBeGreaterThan(0);
                expect(frustum.halfHeight).toBeGreaterThan(0);
                expect([frustum.halfWidth, frustum.halfHeight, frustum.left, frustum.right, frustum.top, frustum.bottom].every(Number.isFinite)).toBe(true);
                expect(frustum.halfWidth).toBeCloseTo(frustum.halfHeight, 9);
            }),
        );
    });

    test("left/right 的极宽内容沿 Z 装入水平跨度，top 的极宽内容沿 X 装入水平跨度", () => {
        const alongZ = sceneWithObjects([objectAt([0, 0, -40]), objectAt([0, 2, 40])]);
        const left = resolveDirectorOrthographicFraming({ scene: alongZ, mode: "left" })!;
        const right = resolveDirectorOrthographicFraming({ scene: alongZ, mode: "right" })!;
        expect(left.horizontalSpan).toBeCloseTo(80 * 1.2, 9);
        expect(right.horizontalSpan).toBeCloseTo(left.horizontalSpan, 9);
        expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: left.horizontalSpan, verticalSpan: left.verticalSpan, aspect: 1 }), left.horizontalSpan, left.verticalSpan, 1);

        const alongX = sceneWithObjects([objectAt([-40, 0, 0]), objectAt([40, 0, 2])]);
        const top = resolveDirectorOrthographicFraming({ scene: alongX, mode: "top" })!;
        expect(top.horizontalSpan).toBeCloseTo(80 * 1.2, 9);
        expectFrustumFits(resolveDirectorOrthographicFrustum({ horizontalSpan: top.horizontalSpan, verticalSpan: top.verticalSpan, aspect: 1 }), top.horizontalSpan, top.verticalSpan, 1);
    });
});

describe("正交轴向取景：绝不写场景", () => {
    test("调用后传入的 scene 与其 objects/cameras/lights 数组身份都不变", () => {
        const scene = createDirectorScene();
        const snapshot = JSON.parse(JSON.stringify(scene));
        const objectsRef = scene.objects;
        const camerasRef = scene.cameras;
        const lightsRef = scene.lights;
        (["free", "camera", ...AXIS_MODES] as const).forEach((mode) => {
            resolveDirectorOrthographicFraming({ scene, mode });
        });
        expect(scene).toEqual(snapshot);
        expect(scene.objects).toBe(objectsRef);
        expect(scene.cameras).toBe(camerasRef);
        expect(scene.lights).toBe(lightsRef);
    });
});

describe("切换器可发现、可键盘、无新增全局样式", () => {
    test("用原生 button 并以 aria-pressed 表达持久取景状态", () => {
        expect(toolbar).toContain('type="button"');
        expect(toolbar).toContain("aria-pressed={active}");
        expect(toolbar).toContain('role="group"');
        expect(toolbar).toContain('aria-label="导演台取景模式"');
    });

    test("每个按钮都有 aria-label 与 title，图标化文字也能被读出", () => {
        expect(toolbar).toContain("aria-label={`${item.label} ${item.hint}`}");
        expect(toolbar).toContain("title={item.hint}");
    });

    test("保留键盘焦点环，并尊重 reduced-motion", () => {
        expect(toolbar).toContain("focus-visible:outline");
        expect(toolbar).toContain("motion-reduce:transition-none");
    });

    test("点完释放焦点，否则 W/E/R 变换快捷键会被守卫吃掉", () => {
        expect(toolbar).toContain("releaseDirectorFocusAfterPointer(event)");
    });

    test("只用既有 token，不写颜色字面值", () => {
        expect(toolbar).toContain("var(--director-dock-surface)");
        expect(toolbar).toContain("var(--director-dock-active-surface)");
        expect(toolbar).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(toolbar).not.toMatch(/\brgba?\(/);
    });

    test("不复用写死正方形尺寸的 dock 按钮类：CAM 是文字标签", () => {
        const classNames = [...toolbar.matchAll(/className="([^"]*)"/g)].map((match) => match[1]).join(" ");
        expect(classNames.length).toBeGreaterThan(0);
        expect(classNames).not.toContain("director-viewport-dock");
    });

    test("对 DIRECTOR_VIEW_MODES 做整体 map，不写死具体模式或数量：新增/删减模式无需改这个文件", () => {
        expect(toolbar).toContain("DIRECTOR_VIEW_MODES.map((item) => {");
        expect(toolbar).not.toMatch(/item\.mode\s*===\s*"/);
        expect(toolbar).not.toMatch(/DIRECTOR_VIEW_MODES\[\d/);
    });

    test("七个模式全部渲染：DIRECTOR_VIEW_MODES 有几项，toolbar 就自动出几个按钮", () => {
        expect(DIRECTOR_VIEW_MODES).toHaveLength(7);
    });
});
