import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildPrevisCameraRecipeMoves, createPrevisCameraMove, evaluatePrevisCamera, resolvePrevisSubjectState, samplePrevisCameraPath } from "@/lib/canvas/previs/previs-camera-moves";
import {
    describePrevisCameraMove,
    PREVIS_CAMERA_FOLLOW_SHOT_SIZES,
    PREVIS_CAMERA_FOLLOW_SIDES,
    PREVIS_CAMERA_RECIPES,
    PREVIS_CAMERA_TECHNIQUES,
    resolvePrevisCameraTechnique,
    resolvePrevisShotCameraMove,
} from "@/lib/canvas/previs/previs-camera-techniques";
import { previsAspectValue, previsFramingDistance, previsVerticalFov } from "@/lib/canvas/previs/previs-optics";
import { compilePrevisPrompt } from "@/lib/canvas/previs/previs-prompt-compiler";
import { createPrevisActor, createPrevisCamera, createPrevisScene, previsIdentityTransform } from "@/lib/canvas/previs/previs-scene";
import { applyPrevisActorTravel } from "@/lib/canvas/previs/previs-travel";
import { resolvePrevisViewFraming } from "@/lib/canvas/previs/previs-view-modes";
import type { PrevisCamera, PrevisCameraMoveSegment, PrevisCameraTechnique, PrevisObject, PrevisScene, PrevisVec3 } from "@/types/previs";

/** 摄影机在 (0, 1.5, 6) 看向 (0, 1.5, 0)，35mm，镜头 6 秒。 */
function setup(moves: PrevisCameraMoveSegment[], objects?: PrevisObject[]): { scene: PrevisScene; camera: PrevisCamera } {
    const base = createPrevisScene();
    const camera: PrevisCamera = { ...createPrevisCamera(), transform: previsIdentityTransform([0, 1.5, 6]), target: [0, 1.5, 0], focalLength: 35, moves };
    const scene: PrevisScene = { ...base, objects: objects ?? base.objects, cameras: [camera], shots: [{ ...base.shots[0], cameraId: camera.id, duration: 6 }] };
    return { scene, camera };
}

function move(technique: PrevisCameraTechnique, start: number, duration: number, extra: Partial<PrevisCameraMoveSegment> = {}): PrevisCameraMoveSegment {
    return { id: `${technique}-${start}`, technique, start, duration, easing: "linear", ...extra };
}

function expectVec(actual: PrevisVec3, expected: PrevisVec3, digits = 4) {
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], digits));
}

const distance = (a: PrevisVec3, b: PrevisVec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("运镜手法求值", () => {
    test("推镜头沿视线推近，开始前不动、结束后保持，焦点不变", () => {
        const { scene, camera } = setup([move("push_in", 0, 2, { params: { distance: 2 } })]);
        expectVec(evaluatePrevisCamera(scene, camera, 0).position, [0, 1.5, 6]);
        expectVec(evaluatePrevisCamera(scene, camera, 1).position, [0, 1.5, 5]);
        expectVec(evaluatePrevisCamera(scene, camera, 2).position, [0, 1.5, 4]);
        expectVec(evaluatePrevisCamera(scene, camera, 5).position, [0, 1.5, 4]);
        expectVec(evaluatePrevisCamera(scene, camera, 5).target, [0, 1.5, 0]);
    });

    test("推镜头自动距离取 45%，并且不越过焦点", () => {
        const auto = setup([move("push_in", 0, 1)]);
        expect(evaluatePrevisCamera(auto.scene, auto.camera, 1).position[2]).toBeCloseTo(6 - 6 * 0.45, 5);
        const far = setup([move("push_in", 0, 1, { params: { distance: 100 } })]);
        expect(evaluatePrevisCamera(far.scene, far.camera, 1).position[2]).toBeCloseTo(0.3, 5);
    });

    test("右摇把视线转向摄影机右侧（看向 -Z 时为 +X），机位不动", () => {
        const { scene, camera } = setup([move("pan_right", 0, 1, { params: { angle: 90 } })]);
        const state = evaluatePrevisCamera(scene, camera, 1);
        expectVec(state.position, [0, 1.5, 6]);
        expectVec(state.target, [6, 1.5, 6]);
    });

    test("右环绕绕焦点转 90°：距离不变、机位转到右侧", () => {
        const { scene, camera } = setup([move("orbit_right", 0, 1, { params: { angle: 90 } })]);
        const state = evaluatePrevisCamera(scene, camera, 1);
        expectVec(state.position, [6, 1.5, 0]);
        expect(distance(state.position, state.target)).toBeCloseTo(6, 5);
    });

    test("希区柯克变焦：后退到 2 倍距离，焦段同比变长，主体大小（焦段/距离）全程不变", () => {
        const { scene, camera } = setup([move("dolly_zoom_out", 0, 2)]);
        for (const time of [0, 0.5, 1, 1.5, 2]) {
            const state = evaluatePrevisCamera(scene, camera, time);
            expect(state.focalLength / distance(state.position, state.target)).toBeCloseTo(35 / 6, 6);
        }
        const end = evaluatePrevisCamera(scene, camera, 2);
        expectVec(end.position, [0, 1.5, 12]);
        expect(end.focalLength).toBeCloseTo(70, 5);
    });

    test("变焦推只改焦段（对数插值），机位不动；取景 fov 随之变窄", () => {
        const { scene, camera } = setup([move("zoom_in", 0, 2)]);
        expect(evaluatePrevisCamera(scene, camera, 1).focalLength).toBeCloseTo(35 * Math.SQRT2, 4);
        expectVec(evaluatePrevisCamera(scene, camera, 2).position, [0, 1.5, 6]);
        const aspect = previsAspectValue(scene.shots[0].aspectRatio);
        expect(resolvePrevisViewFraming({ scene, mode: "camera", playhead: 0 })?.fov).toBeCloseTo(previsVerticalFov(35, aspect), 6);
        expect(resolvePrevisViewFraming({ scene, mode: "camera", playhead: 2 })?.fov).toBeCloseTo(previsVerticalFov(70, aspect), 6);
    });

    test("上摇超过 85° 时收住，避免视线竖直导致画面翻转", () => {
        const elevated: PrevisVec3 = [0, 1.5 + Math.sin((20 * Math.PI) / 180) * 6, 6 - Math.cos((20 * Math.PI) / 180) * 6];
        const { scene, camera } = setup([move("tilt_up", 0, 1, { params: { angle: 80 } })]);
        const state = evaluatePrevisCamera(scene, { ...camera, target: elevated }, 1);
        const view = [state.target[0] - state.position[0], state.target[1] - state.position[1], state.target[2] - state.position[2]] as PrevisVec3;
        expect(Math.asin(view[1] / Math.hypot(...view))).toBeCloseTo((85 * Math.PI) / 180, 5);
    });

    test("多段按时间叠加：先推后摇，后一段从前一段结束的机位继续", () => {
        const { scene, camera } = setup([move("push_in", 0, 2, { params: { distance: 2 } }), move("pan_left", 2, 2, { params: { angle: 90 } })]);
        const state = evaluatePrevisCamera(scene, camera, 3);
        expectVec(state.position, [0, 1.5, 4]);
        expect(state.target[0]).toBeLessThan(0);
        expect(distance(state.position, state.target)).toBeCloseTo(4, 5);
    });

    test("旋转（荷兰角）让画面顶部向右倾", () => {
        const { scene } = setup([move("roll", 0, 1, { params: { angle: 20 } })]);
        const up = resolvePrevisViewFraming({ scene, mode: "camera", playhead: 1 })!.up;
        expectVec(up, [Math.sin((20 * Math.PI) / 180), Math.cos((20 * Math.PI) / 180), 0]);
    });

    test("手持晃动可复现、幅度很小，时间窗外完全不动", () => {
        const { scene, camera } = setup([move("handheld", 1, 3)]);
        const first = evaluatePrevisCamera(scene, camera, 2.2);
        const second = evaluatePrevisCamera(scene, camera, 2.2);
        expect(first).toEqual(second);
        expect(distance(first.position, [0, 1.5, 6])).toBeGreaterThan(0);
        expect(distance(first.position, [0, 1.5, 6])).toBeLessThan(0.05);
        expectVec(evaluatePrevisCamera(scene, camera, 0.5).position, [0, 1.5, 6]);
        expectVec(evaluatePrevisCamera(scene, camera, 5).position, [0, 1.5, 6]);
    });

    test("未知手法直接跳过，不产生非法取景", () => {
        const { scene, camera } = setup([{ id: "x", technique: "hyperlapse" as PrevisCameraTechnique, start: 0, duration: 2 }]);
        expectVec(evaluatePrevisCamera(scene, camera, 1).position, [0, 1.5, 6]);
        expect(resolvePrevisViewFraming({ scene, mode: "camera", playhead: 1 })).not.toBeNull();
    });
});

describe("跟拍", () => {
    function swordScene(side: "behind" | "pov" = "behind") {
        const hero = applyPrevisActorTravel(createPrevisActor("主角", [0, 0, 0]), { from: [0, 0, 0], to: [0, 0, 20], start: 0.5, duration: 4, style: "sword_fly" });
        return setup([move("follow", 0, 6, { subjectId: hero.id, params: { side, distance: side === "pov" ? undefined : 5, lag: 0 } })], [hero]);
    }

    test("御剑飞行时机位跟在人物后方一起升空", () => {
        const { scene, camera } = swordScene();
        const hero = scene.objects[0];
        const subject = resolvePrevisSubjectState(hero, 2.5);
        // 段中点：离地 2.5 米，地面位置走到一半。
        expectVec(subject.root, [0, 2.5, 10], 3);
        const state = evaluatePrevisCamera(scene, camera, 2.5);
        expectVec(state.position, [0, 2.5 + subject.height * 1.05, 5], 3);
        expectVec(state.target, [0, 2.5 + subject.height * 0.72, 10], 3);
        // 起飞前机位在地面高度的后方。
        const before = evaluatePrevisCamera(scene, camera, 0);
        expectVec(before.position, [0, subject.height * 1.05, -5], 3);
    });

    test("主观视角在人物眼睛高度看向前进方向", () => {
        const { scene, camera } = swordScene("pov");
        const height = resolvePrevisSubjectState(scene.objects[0], 0).height;
        const state = evaluatePrevisCamera(scene, camera, 0);
        expectVec(state.position, [0, height * 0.93, 0.3], 3);
        expectVec(state.target, [0, height * 0.93, 10], 3);
    });

    test("主体被删除时跟拍不生效，机位保持", () => {
        const { scene, camera } = setup([move("follow", 0, 6, { subjectId: "ghost" })]);
        expectVec(evaluatePrevisCamera(scene, camera, 3).position, [0, 1.5, 6]);
    });

    test("轨迹采样随演员路径变化", () => {
        const { scene, camera } = swordScene();
        const path = samplePrevisCameraPath(scene, camera, 6, 13);
        expect(path).toHaveLength(13);
        expect(path.at(-1)![2]).toBeGreaterThan(path[0][2] + 15);
    });

    /** 主角 6 秒内从原点沿 +Z 走 8 米；人物面朝 +Z，右手在 -X。 */
    function walkScene(moves: (heroId: string) => PrevisCameraMoveSegment[]) {
        const hero = applyPrevisActorTravel(createPrevisActor("主角", [0, 0, 0]), { from: [0, 0, 0], to: [0, 0, 8], start: 0, duration: 6, style: "walk" });
        return setup(moves(hero.id), [hero]);
    }
    const horizontalOffset = (camera: PrevisVec3, root: PrevisVec3) => Math.hypot(camera[0] - root[0], camera[2] - root[2]);

    test("过肩跟随换到正面：用 blend 秒绕着人物右侧过渡，不穿过身体、不跳变", () => {
        const { scene, camera } = walkScene((id) => [move("follow", 0, 3.3, { subjectId: id, params: { side: "shoulder" } }), move("follow", 2.4, 3.6, { subjectId: id, params: { side: "front", shotSize: "close_up", lag: 0, blend: 2.1 } })]);
        const hero = scene.objects[0];
        let previous = evaluatePrevisCamera(scene, camera, 2.3).position;
        for (let time = 2.35; time <= 4.6; time += 0.05) {
            const state = evaluatePrevisCamera(scene, camera, time);
            const root = resolvePrevisSubjectState(hero, time).root;
            expect(horizontalOffset(state.position, root)).toBeGreaterThan(0.5);
            expect(distance(state.position, previous)).toBeLessThan(0.25);
            previous = state.position;
        }
        // 过渡中点在人物右手一侧（-X），结束后在人物正前方。
        const middle = evaluatePrevisCamera(scene, camera, 3.45).position;
        expect(middle[0]).toBeLessThan(-0.3);
        const end = evaluatePrevisCamera(scene, camera, 5);
        const root = resolvePrevisSubjectState(hero, 5).root;
        expect(end.position[2]).toBeGreaterThan(root[2] + 0.3);
        expect(Math.abs(end.position[0] - root[0])).toBeLessThan(1e-6);
    });

    test("正后方换到正前方没有最短方向时固定从右侧绕，整段过渡不翻面", () => {
        const { scene, camera } = walkScene((id) => [move("follow", 0, 6, { subjectId: id, params: { side: "behind", lag: 0 } }), move("follow", 2, 4, { subjectId: id, params: { side: "front", lag: 0, blend: 2 } })]);
        for (const time of [2.3, 2.6, 3, 3.4, 3.7]) expect(evaluatePrevisCamera(scene, camera, time).position[0]).toBeLessThan(0);
        const left = walkScene((id) => [move("follow", 0, 6, { subjectId: id, params: { side: "behind", lag: 0 } }), move("follow", 2, 4, { subjectId: id, params: { side: "left", lag: 0, blend: 2 } })]);
        expect(evaluatePrevisCamera(left.scene, left.camera, 3).position[0]).toBeGreaterThan(0);
    });

    test("跟拍景别按焦段与画幅算距离、注视高度与机位高度", () => {
        const { scene, camera } = walkScene((id) => [move("follow", 0, 6, { subjectId: id, params: { side: "front", shotSize: "close_up", lag: 0 } })]);
        const subject = resolvePrevisSubjectState(scene.objects[0], 3);
        const state = evaluatePrevisCamera(scene, camera, 3);
        const expected = previsFramingDistance(0.3 * subject.height, 35, previsAspectValue(scene.shots[0].aspectRatio));
        expect(horizontalOffset(state.position, subject.root)).toBeCloseTo(expected, 4);
        expect(state.position[1]).toBeCloseTo(subject.height * 0.9, 4);
        expect(state.target[1]).toBeCloseTo(subject.height * 0.88, 4);
        // 焦段翻倍，同一景别的距离也翻倍；给了 distance 时以 distance 为准。
        const tele = evaluatePrevisCamera(scene, { ...camera, focalLength: 70 }, 3);
        expect(horizontalOffset(tele.position, subject.root)).toBeCloseTo(expected * 2, 4);
        const fixed = walkScene((id) => [move("follow", 0, 6, { subjectId: id, params: { side: "front", shotSize: "close_up", distance: 3, lag: 0 } })]);
        expect(horizontalOffset(evaluatePrevisCamera(fixed.scene, fixed.camera, 3).position, subject.root)).toBeCloseTo(3, 4);
    });

    test("提示词写出绕行过渡与跟拍景别", () => {
        const { scene } = walkScene((id) => [move("follow", 0, 3, { subjectId: id, params: { side: "shoulder" } }), move("follow", 2.4, 3.6, { subjectId: id, params: { side: "front", shotSize: "close_up", blend: 2.1 } })]);
        const prompt = compilePrevisPrompt(scene, scene.shots[0]);
        expect(prompt).toContain("过主角肩膀的过肩镜头");
        expect(prompt).toContain("镜头用 2.1 秒绕着主角平滑移到主角前方");
        expect(prompt).toContain("景别为近景（肩部以上）");
    });

    test("提示词写出运镜时间线，并说明机位随御剑升空", () => {
        const { scene } = swordScene();
        const prompt = compilePrevisPrompt(scene, scene.shots[0]);
        expect(prompt).toContain("运镜按下方时间线进行");
        expect(prompt).toContain("运镜：0–6 秒镜头在主角身后 5 米处跟拍");
        expect(prompt).toContain("主角御剑升空时机位一起升空");
    });
});

describe("运镜段编辑", () => {
    test("新建运镜：时长收进镜头、无主体手法丢掉 subjectId、参数按范围截断", () => {
        const late = createPrevisCameraMove({ technique: "push_in", start: 5 }, 6);
        expect(late.start).toBe(5);
        expect(late.duration).toBe(1);
        const pan = createPrevisCameraMove({ technique: "pan_left", start: 0, subjectId: "hero", params: { angle: 999, side: "behind" } }, 6);
        expect(pan.subjectId).toBeUndefined();
        expect(pan.params).toEqual({ angle: 360 });
        expect(createPrevisCameraMove({ technique: "shake", start: 1 }, 6).duration).toBe(0.6);
    });

    test("大师手法只用表里的手法；需要主体的配方没有主体时不生成", () => {
        for (const recipe of PREVIS_CAMERA_RECIPES) {
            const moves = buildPrevisCameraRecipeMoves(recipe, { start: 0, duration: 6, subjectId: "hero", shotDuration: 6 });
            expect(moves.length).toBeGreaterThan(0);
            for (const item of moves) {
                const info = resolvePrevisCameraTechnique(item.technique);
                expect(info).toBeDefined();
                expect(item.start + item.duration).toBeLessThanOrEqual(6 + 1e-9);
                if (info?.subject === "none") expect(item.subjectId).toBeUndefined();
            }
            if (recipe.subject === "required") expect(buildPrevisCameraRecipeMoves(recipe, { start: 0, duration: 6, shotDuration: 6 })).toEqual([]);
        }
        const sword = buildPrevisCameraRecipeMoves(
            PREVIS_CAMERA_RECIPES.find((item) => item.id === "sword_chase")!,
            { start: 0, duration: 6, subjectId: "hero", shotDuration: 6 },
        );
        expect(sword.map((item) => [item.technique, item.subjectId, item.start])).toEqual([
            ["follow", "hero", 0],
            ["orbit_left", "hero", 3],
        ]);
    });

    test("镜头运镜标签取最长的主运镜；只有跟拍时沿用手选标签", () => {
        const { scene } = setup([move("handheld", 0, 6), move("push_in", 0, 2), move("orbit_left", 2, 4)]);
        expect(resolvePrevisShotCameraMove(scene, scene.shots[0])).toBe("orbit_left");
        const follow = setup([move("follow", 0, 6, { subjectId: "a" })]);
        expect(resolvePrevisShotCameraMove(follow.scene, { ...follow.scene.shots[0], cameraMove: "pan_left" })).toBe("pan_left");
        expect(describePrevisCameraMove(move("push_in", 0, 3, { params: { distance: 2 } }))).toBe("0–3s 推镜头 2米");
    });
});

describe("与后端白名单一致", () => {
    const goSource = readFileSync(join(import.meta.dir, "../../backend/internal/app/cloud_agent_previs_camera.go"), "utf8");
    const goTechniques = goSource
        .split("\n")
        .filter((line) => line.trim().startsWith('{ID: "'))
        .map((line) => ({
            id: /ID: "([a-z_]+)"/.exec(line)![1],
            subject: /Subject: "([a-z]+)"/.exec(line)?.[1],
            layer: /Layer: true/.test(line),
            duration: Number(/Duration: ([\d.]+)/.exec(line)?.[1] ?? 0),
            params: [...line.matchAll(/\{Key: "([a-zA-Z]+)"(?:, Min: (-?[\d.]+), Max: (-?[\d.]+))?/g)].map((match) => ({
                key: match[1],
                min: match[2] === undefined ? undefined : Number(match[2]),
                max: match[3] === undefined ? undefined : Number(match[3]),
            })),
        }));

    test("手法 ID、主体要求、叠加层、默认时长、参数键与范围逐项相同", () => {
        expect(goTechniques.map((item) => item.id)).toEqual(PREVIS_CAMERA_TECHNIQUES.map((item) => item.id));
        for (const info of PREVIS_CAMERA_TECHNIQUES) {
            const backend = goTechniques.find((item) => item.id === info.id)!;
            expect(backend.subject).toBe(info.subject);
            expect(backend.layer).toBe(Boolean(info.layer));
            expect(backend.duration).toBe(info.duration ?? 0);
            expect(backend.params).toEqual(info.params.map((spec) => (spec.kind === "number" ? { key: spec.key, min: spec.min, max: spec.max } : { key: spec.key, min: undefined, max: undefined })));
        }
    });

    test("跟拍方位一致", () => {
        const sides = /var cloudAgentPrevisCameraFollowSides = \[\]string\{([^}]*)\}/
            .exec(goSource)?.[1]
            .match(/"([a-z]+)"/g)
            ?.map((item) => item.slice(1, -1));
        expect(sides).toEqual(PREVIS_CAMERA_FOLLOW_SIDES.map((item) => item.value));
    });

    test("跟拍景别一致", () => {
        const sizes = /var cloudAgentPrevisCameraFollowShotSizes = \[\]string\{([^}]*)\}/
            .exec(goSource)?.[1]
            .match(/"([a-z_]+)"/g)
            ?.map((item) => item.slice(1, -1));
        expect(sizes).toEqual(PREVIS_CAMERA_FOLLOW_SHOT_SIZES.map((item) => item.value));
    });

    test("大师手法配方 ID 与顺序一致，展开结果与共用 golden 逐项相同", () => {
        const recipeSource = readFileSync(join(import.meta.dir, "../../backend/internal/app/cloud_agent_previs_camera_recipes.go"), "utf8");
        const backendIds = [...recipeSource.matchAll(/\{Recipe: "([a-z_]+)"/g)].map((match) => match[1]);
        expect(backendIds).toEqual(PREVIS_CAMERA_RECIPES.map((item) => item.id));
        const goldenPath = join(import.meta.dir, "../../backend/internal/app/testdata/previs_camera_recipes.json");
        const expand = (input: { start: number; duration: number; subjectId: string; shotDuration: number }) =>
            Object.fromEntries(
                PREVIS_CAMERA_RECIPES.map((recipe) => [
                    recipe.id,
                    buildPrevisCameraRecipeMoves(recipe, input)
                        .map(({ id: _id, ...rest }) => rest)
                        .toSorted((left, right) => left.start - right.start || left.technique.localeCompare(right.technique)),
                ]),
            );
        // 改配方后：在 web 目录运行 UPDATE_GOLDEN=1 bun test test/previs-camera-moves.test.ts 重新生成，再跑后端测试确认两边一致。
        if (process.env.UPDATE_GOLDEN === "1") {
            const inputs = [
                { start: 0, duration: 6, subjectId: "hero", shotDuration: 6 },
                { start: 1.5, duration: 3, subjectId: "hero", shotDuration: 5 },
            ];
            const comment = "前端 PREVIS_CAMERA_RECIPES 与后端 cloudAgentPrevisCameraRecipes 对同一输入的展开结果；两边测试都按它校验。改配方后在 web 目录运行 UPDATE_GOLDEN=1 bun test test/previs-camera-moves.test.ts 重新生成。";
            writeFileSync(goldenPath, JSON.stringify({ comment, cases: inputs.map((input) => ({ input, recipes: expand(input) })) }, null, 2) + "\n");
        }
        const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as {
            cases: Array<{ input: { start: number; duration: number; subjectId: string; shotDuration: number }; recipes: Record<string, Array<Omit<PrevisCameraMoveSegment, "id">>> }>;
        };
        expect(golden.cases.length).toBeGreaterThan(1);
        for (const item of golden.cases) {
            expect(Object.keys(item.recipes)).toEqual(PREVIS_CAMERA_RECIPES.map((recipe) => recipe.id));
            expect(expand(item.input)).toEqual(item.recipes);
        }
    });
});

describe("过肩跟随转正面特写配方", () => {
    test("起幅在人物肩后，落幅在人物正前方的面部大特写", () => {
        const hero = applyPrevisActorTravel(createPrevisActor("主角", [0, 0, 0]), { from: [0, 0, 0], to: [0, 0, 8], start: 0, duration: 6, style: "walk" });
        const moves = buildPrevisCameraRecipeMoves(
            PREVIS_CAMERA_RECIPES.find((item) => item.id === "ots_to_closeup")!,
            { start: 0, duration: 6, subjectId: hero.id, shotDuration: 6 },
        );
        const { scene, camera } = setup(moves, [hero]);
        const start = evaluatePrevisCamera(scene, camera, 0.5);
        const startRoot = resolvePrevisSubjectState(hero, 0.5).root;
        expect(start.position[2]).toBeLessThan(startRoot[2]);
        const end = evaluatePrevisCamera(scene, camera, 6);
        const subject = resolvePrevisSubjectState(hero, 6);
        expect(end.position[2]).toBeGreaterThan(subject.root[2]);
        const expected = previsFramingDistance(0.16 * subject.height, 35, previsAspectValue(scene.shots[0].aspectRatio));
        // 滞后让人物追近机位，但至少保留 75% 的取景距离。
        const offset = Math.hypot(end.position[0] - subject.root[0], end.position[2] - subject.root[2]);
        expect(offset).toBeGreaterThanOrEqual(expected * 0.75 - 1e-6);
        expect(offset).toBeLessThanOrEqual(expected + 1e-6);
        expect(end.target[1]).toBeGreaterThan(subject.height * 0.85);
    });

    test("倒退跟拍近景时人物跑动也不会撞进镜头", () => {
        const runner = applyPrevisActorTravel(createPrevisActor("主角", [0, 0, 0]), { from: [0, 0, 0], to: [0, 0, 30], start: 0, duration: 5, style: "run" });
        const { scene, camera } = setup([move("follow", 0, 6, { subjectId: runner.id, params: { side: "front", shotSize: "close_up", lag: 0.5 } })], [runner]);
        for (const time of [0.5, 1.5, 2.5, 3.5, 4.5]) {
            const state = evaluatePrevisCamera(scene, camera, time);
            const root = resolvePrevisSubjectState(runner, time).root;
            expect(state.position[2] - root[2]).toBeGreaterThan(0.3);
        }
    });
});
