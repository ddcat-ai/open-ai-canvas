import { describe, expect, test } from "bun:test";

import { projectDirectorWebgl, readDirectorReproRuntime, releaseProbeContext, safeReproText } from "../src/lib/canvas/director/director-repro-runtime";
import { DIRECTOR_REPRO_LOCAL_MODEL_URL, DIRECTOR_REPRO_MATRIX, DIRECTOR_REPRO_MISSING_MODEL_URL, createDirectorReproScene, directorReproSceneIsOffline, injectDirectorReproModel } from "../src/lib/canvas/director/director-repro-fixture";
import { DIRECTOR_PLACEMENT_MARGIN, directorObjectFootprint } from "../src/lib/canvas/director/director-placement";
import type { DirectorObject } from "../src/types/director";

const LEAK_PROBES = [
    "https://cdn.example.com/actor.glb?token=abc123#frag",
    "http://localhost:3000/api/tasks?authorization=Bearer%20xyz",
    "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "cookie=session=deadbeef; Path=/",
    "api_key=sk-live-0000",
    "secret_key: hunter2",
    "password=letmein",
];

/** XZ 占位是否相交（含 margin）；Y 完全不参与，与放置模块同一判据。 */
function overlapsInjectedXZ(a: DirectorObject, b: DirectorObject) {
    const fa = directorObjectFootprint(a);
    const fb = directorObjectFootprint(b);
    const dx = Math.abs(a.transform.position[0] - b.transform.position[0]);
    const dz = Math.abs(a.transform.position[2] - b.transform.position[2]);
    return dx < (fa.width + fb.width) / 2 + DIRECTOR_PLACEMENT_MARGIN && dz < (fa.depth + fb.depth) / 2 + DIRECTOR_PLACEMENT_MARGIN;
}

/** 构造一个可控的 WebGL 双替身：参数常量用小整数便于断言。 */
function makeGl(overrides: Partial<Record<string, unknown>> = {}) {
    const values: Record<number, unknown> = {
        1: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
        2: "Google Inc. (Apple)",
        3: "ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)",
        4: 16384,
        5: 16384,
        6: [32767, 32767],
    };
    return {
        VERSION: 1,
        VENDOR: 2,
        RENDERER: 3,
        MAX_TEXTURE_SIZE: 4,
        MAX_RENDERBUFFER_SIZE: 5,
        MAX_VIEWPORT_DIMS: 6,
        getParameter: (name: number) => values[name],
        getExtension: () => null,
        ...overrides,
    };
}

describe("safeReproText", () => {
    test("整段 URL 被替换为固定 [URL]，不保留域名与路径", () => {
        expect(safeReproText("https://cdn.example.com/a.glb?token=abc#frag")).toBe("[URL]");
        expect(safeReproText("http://driver.example.com/x?k=v")).toBe("[URL]");
        expect(safeReproText("ANGLE renderer https://driver.example.com/x?k=v build")).toBe("ANGLE renderer [URL] build");
        for (const probe of ["https://cdn.example.com/a.glb?token=abc123#frag", "http://driver.example.com/x?k=v"]) {
            const safe = safeReproText(probe);
            expect(safe).not.toContain("cdn.example.com");
            expect(safe).not.toContain("driver.example.com");
            expect(safe).not.toContain("abc123");
            expect(safe).not.toContain("token");
        }
    });

    test("Bearer token 整体被遮蔽，密钥值不残留", () => {
        const safe = safeReproText("Authorization: Bearer abc123");
        expect(safe).toContain("[REDACTED]");
        expect(safe).not.toContain("abc123");

        const jwt = safeReproText("authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
        expect(jwt).not.toContain("payload.sig");
        expect(jwt).not.toContain("eyJhbGciOiJIUzI1NiJ9");

        expect(safeReproText("bearer SECRETVALUE")).toBe("Bearer [REDACTED]");
    });

    test("key[:=]value 形态凭证不残留值", () => {
        for (const [input, secret] of [
            ["api_key=sk-live-0000", "sk-live-0000"],
            ["cookie=session=deadbeef; Path=/", "deadbeef"],
            ["secret_key: hunter2", "hunter2"],
            ["password=letmein", "letmein"],
            ["token=abc123", "abc123"],
        ]) {
            const safe = safeReproText(input);
            expect(safe).toContain("[REDACTED]");
            expect(safe).not.toContain(secret);
        }
    });

    test("裸 query/hash 片段同样不保留", () => {
        expect(safeReproText("renderer?token=abc")).toBe("renderer");
        expect(safeReproText("renderer#secret")).toBe("renderer");
    });

    test("限长并压缩空白", () => {
        expect(safeReproText("a".repeat(500)).length).toBe(160);
        expect(safeReproText("a".repeat(500), 32).length).toBe(32);
        expect(safeReproText("  a   b \n c  ")).toBe("a b c");
    });

    test("非字符串与空值稳定返回空串", () => {
        for (const bad of [null, undefined, 42, {}, []]) expect(safeReproText(bad)).toBe("");
    });
});

describe("runtime 投影", () => {
    test("字段齐全且 DPR 有界", () => {
        const runtime = readDirectorReproRuntime();
        expect(typeof runtime.appVersion).toBe("string");
        expect(typeof runtime.buildCommit).toBe("string");
        expect(typeof runtime.browser).toBe("string");
        expect(typeof runtime.os).toBe("string");
        expect(typeof runtime.timezone).toBe("string");
        expect(runtime.devicePixelRatio).toBeGreaterThanOrEqual(0.1);
        expect(runtime.devicePixelRatio).toBeLessThanOrEqual(8);
    });

    test("所有字符串都已限长", () => {
        const runtime = readDirectorReproRuntime();
        expect(runtime.appVersion.length).toBeLessThanOrEqual(48);
        expect(runtime.buildCommit.length).toBeLessThanOrEqual(48);
        expect(runtime.browser.length).toBeLessThanOrEqual(160);
        expect(runtime.os.length).toBeLessThanOrEqual(48);
        expect(runtime.timezone.length).toBeLessThanOrEqual(64);
    });
});

describe("WebGL 投影", () => {
    test("可用上下文产出安全能力数值", () => {
        const webgl = projectDirectorWebgl(makeGl());
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.version).toContain("WebGL 2.0");
        expect(webgl.vendor).toContain("Google");
        expect(webgl.maxTextureSize).toBe(16384);
        expect(webgl.maxRenderbufferSize).toBe(16384);
        expect(webgl.maxViewportWidth).toBe(32767);
        expect(webgl.maxViewportHeight).toBe(32767);
    });

    test("缺失上下文稳定降级为 unsupported", () => {
        for (const bad of [null, undefined, 42, "webgl", {}]) {
            expect(projectDirectorWebgl(bad)).toEqual({ available: false, reason: "unsupported" });
        }
    });

    test("getParameter 抛错降级为 context-failed 而不外泄异常", () => {
        const gl = makeGl({
            getParameter: () => {
                throw new Error("context lost");
            },
        });
        expect(() => projectDirectorWebgl(gl)).not.toThrow();
        expect(projectDirectorWebgl(gl)).toEqual({ available: false, reason: "context-failed" });
    });

    test("getExtension 抛错不影响整体可用性", () => {
        const gl = makeGl({
            getExtension: () => {
                throw new Error("no extension");
            },
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.vendor).toContain("Google");
    });

    test("UNMASKED 值优先但仍经过安全文本处理", () => {
        const values: Record<number, unknown> = { 7: "Apple?token=abc", 8: "Apple M2 Pro https://driver.example.com/x?k=v" };
        const gl = makeGl({
            getExtension: () => ({ UNMASKED_VENDOR_WEBGL: 7, UNMASKED_RENDERER_WEBGL: 8 }),
            getParameter: (name: number) => (name in values ? values[name] : makeGl().getParameter(name)),
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.vendor).toBe("Apple");
        expect(webgl.renderer).not.toContain("?k=v");
        expect(webgl.renderer).not.toContain("token");
    });

    test("非有限能力数值收敛为 0（未知），绝不产出 NaN/Infinity", () => {
        const gl = makeGl({
            getParameter: (name: number) => (name === 4 ? Number.NaN : name === 5 ? Number.POSITIVE_INFINITY : name === 6 ? "not-an-array" : makeGl().getParameter(name)),
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        // 非有限一律当「未知」记 0，而不是编造一个驱动从未声明的能力上限。
        expect(Number.isFinite(webgl.maxTextureSize)).toBe(true);
        expect(Number.isFinite(webgl.maxRenderbufferSize)).toBe(true);
        expect(webgl.maxTextureSize).toBe(0);
        expect(webgl.maxRenderbufferSize).toBe(0);
        expect(webgl.maxViewportWidth).toBe(0);
        expect(webgl.maxViewportHeight).toBe(0);
    });

    test("超大但有限的能力数值被夹到上界", () => {
        const gl = makeGl({
            getParameter: (name: number) => (name === 4 ? 9_999_999 : name === 6 ? [9_999_999, -5] : makeGl().getParameter(name)),
        });
        const webgl = projectDirectorWebgl(gl);
        expect(webgl.available).toBe(true);
        if (!webgl.available) return;
        expect(webgl.maxTextureSize).toBe(1_048_576);
        expect(webgl.maxViewportWidth).toBe(1_048_576);
        // 负值夹到下界 0。
        expect(webgl.maxViewportHeight).toBe(0);
    });

    test("伪造的敏感 vendor/renderer 不会原样进入输出", () => {
        for (const probe of LEAK_PROBES) {
            const gl = makeGl({ getParameter: (name: number) => (name === 2 || name === 3 ? probe : makeGl().getParameter(name)) });
            const webgl = projectDirectorWebgl(gl);
            expect(webgl.available).toBe(true);
            if (!webgl.available) continue;
            const text = webgl.vendor + " " + webgl.renderer;
            for (const secret of ["abc123", "payload.sig", "cdn.example.com", "driver.example.com", "token=abc", "sk-live-0000", "deadbeef", "hunter2", "letmein", "#frag", "eyJhbGciOiJIUzI1NiJ9"]) {
                expect(text).not.toContain(secret);
            }
        }
    });

    test("探测后归还上下文：支持扩展时调用 loseContext", () => {
        let losed = 0;
        releaseProbeContext({
            getExtension: (name: string) =>
                name === "WEBGL_lose_context"
                    ? {
                          loseContext: () => {
                              losed += 1;
                          },
                      }
                    : null,
        });
        expect(losed).toBe(1);
    });

    test("扩展不可用或抛错时归还是无操作，不外泄异常", () => {
        expect(() => releaseProbeContext({ getExtension: () => null })).not.toThrow();
        expect(() => releaseProbeContext({ getExtension: () => ({}) })).not.toThrow();
        expect(() =>
            releaseProbeContext({
                getExtension: () => {
                    throw new Error("no extension");
                },
            }),
        ).not.toThrow();
        expect(() =>
            releaseProbeContext({
                getExtension: () => ({
                    loseContext: () => {
                        throw new Error("lose failed");
                    },
                }),
            }),
        ).not.toThrow();
        for (const bad of [null, undefined, 42, {}, "gl"]) {
            expect(() => releaseProbeContext(bad)).not.toThrow();
        }
    });
});

describe("fixture 确定性与离线性", () => {
    test("两次构造结构完全一致", () => {
        expect(createDirectorReproScene()).toEqual(createDirectorReproScene());
    });

    test("返回全新对象，改写不影响后续构造", () => {
        const first = createDirectorReproScene();
        first.objects[0].transform.position[0] = 99;
        first.title = "被改写";
        const second = createDirectorReproScene();
        expect(second.objects[0].transform.position[0]).toBe(0);
        expect(second.title).toBe("P0 复现场景");
    });

    test("不含任何远端资产：无 url / storageKey / assetId", () => {
        const scene = createDirectorReproScene();
        expect(directorReproSceneIsOffline(scene)).toBe(true);
        const serialized = JSON.stringify(scene);
        expect(serialized).not.toContain("http");
        expect(serialized).not.toContain(".glb");
        expect(serialized).not.toContain("cdn");
    });

    test("场景结构可操作：有对象、摄影机、灯光、镜头且 activeShotId 自洽", () => {
        const scene = createDirectorReproScene();
        expect(scene.objects.length).toBeGreaterThanOrEqual(3);
        expect(scene.cameras.length).toBeGreaterThanOrEqual(1);
        expect(scene.lights.length).toBeGreaterThanOrEqual(1);
        expect(scene.shots.length).toBeGreaterThanOrEqual(1);
        expect(scene.shots.some((shot) => shot.id === scene.activeShotId)).toBe(true);
        expect(scene.shots.every((shot) => scene.cameras.some((camera) => camera.id === shot.cameraId))).toBe(true);
        expect(scene.objects.every((object) => object.transform.position.every((value) => Number.isFinite(value)))).toBe(true);
    });

    test("对象初始不重叠，便于复现连续新增语义", () => {
        const scene = createDirectorReproScene();
        const xs = scene.objects.map((object) => object.transform.position[0]);
        expect(new Set(xs).size).toBe(xs.length);
    });

    test("复现矩阵覆盖全部 P0 场景且 id 唯一", () => {
        const ids = DIRECTOR_REPRO_MATRIX.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const required of [
            "empty-click",
            "right-click",
            "switch-object",
            "release-outside",
            "blur",
            "escape",
            "playing",
            "non-zero-time",
            "autokey-on",
            "autokey-off",
            "add-move-delete-undo",
            "delete-while-loading",
            "model-load-failed",
            "save-failed",
            "close-recovery",
        ]) {
            expect(ids).toContain(required);
        }
        for (const item of DIRECTOR_REPRO_MATRIX) {
            expect(item.title.length).toBeGreaterThan(0);
            expect(item.steps.length).toBeGreaterThan(0);
            expect(item.expected.length).toBeGreaterThan(0);
        }
    });
    test("矩阵模型两行是可执行步骤，不再是待办", () => {
        const rows = DIRECTOR_REPRO_MATRIX.filter((item) => item.id === "delete-while-loading" || item.id === "model-load-failed");
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.steps).not.toContain("需注入");
            expect(row.steps).not.toContain("Stage D");
        }
        expect(DIRECTOR_REPRO_MATRIX.find((item) => item.id === "delete-while-loading")?.steps).toContain("注入本地模型");
        expect(DIRECTOR_REPRO_MATRIX.find((item) => item.id === "model-load-failed")?.steps).toContain("注入缺失模型");
    });
});

describe("模型注入", () => {
    test("local 变体使用本地 public 资产地址", () => {
        const scene = injectDirectorReproModel(createDirectorReproScene(), "local");
        const model = scene.objects.find((object) => object.id === "repro-model-local");
        expect(model?.url).toBe(DIRECTOR_REPRO_LOCAL_MODEL_URL);
        expect(model?.url).toBe("/canvas/models/director-repro-triangle.gltf");
        expect(model?.mimeType).toBe("model/gltf+json");
        expect(model?.name).toBe("本地模型 repro triangle");
        // 无压缩扩展/无纹理，因此不需要 KTX2Loader 或 DRACOLoader。
        expect(model?.url).not.toContain(".glb");
    });

    test("missing 变体使用同源不可达地址", () => {
        const scene = injectDirectorReproModel(createDirectorReproScene(), "missing");
        const model = scene.objects.find((object) => object.id === "repro-model-missing");
        expect(model?.url).toBe(DIRECTOR_REPRO_MISSING_MODEL_URL);
        expect(model?.url).toBe("/__director-repro-missing.glb");
        // 同源相对路径，不依赖外网可达性。
        expect(model?.url?.startsWith("/")).toBe(true);
    });

    test("两个变体都是 model kind 且 id 稳定", () => {
        for (const [variant, id] of [
            ["local", "repro-model-local"],
            ["missing", "repro-model-missing"],
        ] as const) {
            const scene = injectDirectorReproModel(createDirectorReproScene(), variant);
            const model = scene.objects.find((object) => object.id === id);
            expect(model).toBeDefined();
            expect(model?.kind).toBe("model");
            expect(model?.primitive).toBeUndefined();
        }
    });

    test("模型 Y 保持 0（贴地），只改 XZ", () => {
        for (const variant of ["local", "missing"] as const) {
            const scene = injectDirectorReproModel(createDirectorReproScene(), variant);
            const model = scene.objects.find((object) => object.kind === "model");
            expect(model?.transform.position[1]).toBe(0);
            expect(model?.transform.position.every((value) => Number.isFinite(value))).toBe(true);
        }
    });

    test("纯函数：不改写入参 scene", () => {
        const original = createDirectorReproScene();
        const before = JSON.stringify(original);
        injectDirectorReproModel(original, "local");
        injectDirectorReproModel(original, "missing");
        expect(JSON.stringify(original)).toBe(before);
        expect(original.objects.some((object) => object.kind === "model")).toBe(false);
    });

    test("重复注入同一变体只保留一个对象", () => {
        let scene = injectDirectorReproModel(createDirectorReproScene(), "local");
        const afterFirst = scene.objects.length;
        scene = injectDirectorReproModel(scene, "local");
        scene = injectDirectorReproModel(scene, "local");
        expect(scene.objects.filter((object) => object.id === "repro-model-local")).toHaveLength(1);
        expect(scene.objects.length).toBe(afterFirst);
    });

    test("先 local 再 missing：两个都在且位置不相交", () => {
        const scene = injectDirectorReproModel(injectDirectorReproModel(createDirectorReproScene(), "local"), "missing");
        const local = scene.objects.find((object) => object.id === "repro-model-local");
        const missing = scene.objects.find((object) => object.id === "repro-model-missing");
        expect(local).toBeDefined();
        expect(missing).toBeDefined();
        if (!local || !missing) return;

        const others = scene.objects.filter((object) => object.id !== missing.id);
        for (const other of others) {
            expect(overlapsInjectedXZ(missing, other)).toBe(false);
        }
        expect(overlapsInjectedXZ(local, missing)).toBe(false);
    });

    test("注入不与初始 primitive 重叠", () => {
        const scene = injectDirectorReproModel(createDirectorReproScene(), "local");
        const model = scene.objects.find((object) => object.id === "repro-model-local");
        expect(model).toBeDefined();
        if (!model) return;
        for (const other of scene.objects.filter((object) => object.id !== model.id)) {
            expect(overlapsInjectedXZ(model, other)).toBe(false);
        }
    });

    test("初始 fixture 离线，注入后不再声称离线", () => {
        const base = createDirectorReproScene();
        expect(directorReproSceneIsOffline(base)).toBe(true);
        expect(directorReproSceneIsOffline(injectDirectorReproModel(base, "local"))).toBe(false);
        expect(directorReproSceneIsOffline(injectDirectorReproModel(base, "missing"))).toBe(false);
    });

    test("注入会推进 updatedAt，使保存链路视为真实变化", () => {
        const base = createDirectorReproScene();
        const injected = injectDirectorReproModel(base, "local");
        expect(injected.updatedAt >= base.updatedAt).toBe(true);
        expect(injected.id).toBe(base.id);
    });

    test("矩阵条数不因注入功能变化", () => {
        expect(DIRECTOR_REPRO_MATRIX).toHaveLength(15);
    });
});
