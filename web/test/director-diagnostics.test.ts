import { describe, expect, test } from "bun:test";

import { DIRECTOR_DIAGNOSTIC_CODES, directorDiagnosticObjectKind, formatDirectorDiagnosticCode, isDirectorDiagnosticCode, projectDirectorDiagnostic } from "../src/lib/canvas/director/director-diagnostics";

/** 任何一个都不允许出现在投影输出里。 */
const LEAK_PROBES = [
    "https://cdn.example.com/actor.glb?token=abc123",
    "http://localhost:3000/api/tasks?authorization=Bearer%20xyz",
    "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "authorization: Bearer secret-token",
    "cookie=session=deadbeef; Path=/",
    "api_key=sk-live-0000",
    "Error: adopt failed\n    at DirectorModel (director-viewport.tsx:571:29)",
    "演员 1 的镜头意图正文",
    "/Users/someone/secret/path/scene.glb",
];

function serialize(value: unknown) {
    return JSON.stringify(value ?? {});
}

describe("code 白名单", () => {
    test("白名单内的 code 全部被接受且有稳定文案与级别", () => {
        for (const code of DIRECTOR_DIAGNOSTIC_CODES) {
            expect(isDirectorDiagnosticCode(code)).toBe(true);
            const event = projectDirectorDiagnostic(code, {});
            expect(event).not.toBeNull();
            expect(event?.code).toBe(code);
            expect(event?.message.length).toBeGreaterThan(0);
            expect(["info", "warning", "error"]).toContain(event?.level ?? "");
        }
    });

    test("未知 code 一律拒绝，不透传", () => {
        const rejected = ["", "director_viewport_render_failed", "DIRECTOR_UNKNOWN", "SOME_OTHER_CODE", "DIRECTOR_VIEWPORT_RENDER_FAILED ", null, undefined, 42, {}, []];
        for (const code of rejected) {
            expect(isDirectorDiagnosticCode(code)).toBe(false);
            expect(projectDirectorDiagnostic(code, {})).toBeNull();
        }
    });
});

describe("字段白名单", () => {
    test("未知字段不会出现在输出中", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", {
            objectId: "obj-1",
            sceneName: "演员 1 场景",
            url: "https://cdn.example.com/a.glb",
            stack: "Error: boom\n at x",
            prompt: "镜头意图正文",
            storageKey: "assets/secret.glb",
            token: "sk-live-0000",
        });

        expect(event?.fields).toEqual({ objectId: "obj-1" });
        expect(serialize(event)).not.toContain("cdn.example.com");
        expect(serialize(event)).not.toContain("镜头意图正文");
        expect(serialize(event)).not.toContain("sk-live-0000");
    });

    test("伪造的敏感输入无法通过任一字段进入输出", () => {
        for (const probe of LEAK_PROBES) {
            const event = projectDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", {
                objectId: probe,
                sceneId: probe,
                objectKind: probe,
                saveOutcome: probe,
                attempt: probe,
                revision: probe,
                draftStored: probe,
                userInitiated: probe,
            });

            expect(event).not.toBeNull();
            // 所有字段都应被拒绝：probe 既不是 safe-id，也不在枚举内，也不是数值/布尔。
            expect(event?.fields).toEqual({});
            const text = serialize(event);
            expect(text).not.toContain("http");
            expect(text).not.toContain("token");
            expect(text).not.toContain("cookie");
            expect(text).not.toContain("Bearer");
            expect(text).not.toContain("演员");
        }
    });

    test("safe-id 只接受受限字符集", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-1_a.b:c" })?.fields.objectId).toBe("obj-1_a.b:c");
        for (const bad of ["obj 1", "obj/1", "obj?1", "obj#1", "a".repeat(97), "", "  ", "obj\n1", "obj%201"]) {
            expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: bad })?.fields.objectId).toBeUndefined();
        }
    });

    test("枚举字段只接受白名单值", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectKind: "actor" })?.fields.objectKind).toBe("actor");
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectKind: "spaceship" })?.fields.objectKind).toBeUndefined();
        expect(projectDirectorDiagnostic("DIRECTOR_CLOSE_BLOCKED", { saveOutcome: "stay" })?.fields.saveOutcome).toBe("stay");
        expect(projectDirectorDiagnostic("DIRECTOR_CLOSE_BLOCKED", { saveOutcome: "explode" })?.fields.saveOutcome).toBeUndefined();
    });

    test("数值字段有界且拒绝非有限值", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_RETRY", { attempt: 3 })?.fields.attempt).toBe(3);
        expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_RETRY", { attempt: 2.6 })?.fields.attempt).toBe(3);
        for (const bad of [-1, 1000, Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
            expect(projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_RETRY", { attempt: bad })?.fields.attempt).toBeUndefined();
        }
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { revision: 0 })?.fields.revision).toBe(0);
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_FLUSH_FAILED", { revision: -1 })?.fields.revision).toBeUndefined();
    });

    test("布尔字段只接受真布尔", () => {
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { draftStored: false })?.fields.draftStored).toBe(false);
        expect(projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { draftStored: true })?.fields.draftStored).toBe(true);
        for (const bad of ["true", 1, 0, null, {}]) {
            expect(projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { draftStored: bad })?.fields.draftStored).toBeUndefined();
        }
    });

    test("非对象 fields 不抛错且产出空字段", () => {
        for (const fields of [null, undefined, 42, "objectId=1", [1, 2, 3]]) {
            const event = projectDirectorDiagnostic("DIRECTOR_VIEWPORT_CONTEXT_LOST", fields);
            expect(event?.fields).toEqual({});
        }
    });
});

describe("稳定码格式化", () => {
    test("只拼接安全枚举与数值", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_SAVE_RETRY_FAILED", { sceneId: "scene-1", revision: 4, draftStored: true, userInitiated: true });
        expect(event).not.toBeNull();
        if (!event) return;
        const formatted = formatDirectorDiagnosticCode(event);
        expect(formatted).toBe("DIRECTOR_SAVE_RETRY_FAILED scene=scene-1 revision=4 draft=1 user=1");
        // scene/object 后缀只可能是 safe-id 投影后的值。
        expect(formatted.startsWith("DIRECTOR_")).toBe(true);
    });

    test("scene 与 object 后缀都进入 code，顺序确定", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { sceneId: "scene-1", objectId: "obj-9", objectKind: "model", attempt: 2 });
        expect(event).not.toBeNull();
        if (!event) return;
        expect(formatDirectorDiagnosticCode(event)).toBe("DIRECTOR_MODEL_LOAD_FAILED scene=scene-1 object=obj-9 kind=model attempt=2");
    });

    test("不同 objectId / sceneId 产出不同签名", () => {
        const a = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-1" });
        const b = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: "obj-2" });
        const c = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { sceneId: "scene-1" });
        const d = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { sceneId: "scene-2" });
        expect(a && b && c && d).toBeTruthy();
        if (!a || !b || !c || !d) return;
        const signatures = [a, b, c, d].map(formatDirectorDiagnosticCode);
        expect(new Set(signatures).size).toBe(4);
    });

    test("非法 id 不进入 code 后缀", () => {
        for (const bad of ["https://cdn.example.com/a.glb?token=abc", "obj 1", "obj/1", "a".repeat(97)]) {
            const event = projectDirectorDiagnostic("DIRECTOR_MODEL_LOAD_FAILED", { objectId: bad, sceneId: bad });
            expect(event).not.toBeNull();
            if (!event) continue;
            const formatted = formatDirectorDiagnosticCode(event);
            expect(formatted).toBe("DIRECTOR_MODEL_LOAD_FAILED");
            expect(formatted).not.toContain("scene=");
            expect(formatted).not.toContain("object=");
            expect(formatted).not.toContain("cdn.example.com");
        }
    });

    test("无字段时只有 code 本身", () => {
        const event = projectDirectorDiagnostic("DIRECTOR_VIEWPORT_RENDER_FAILED", {});
        expect(event).not.toBeNull();
        if (!event) return;
        expect(formatDirectorDiagnosticCode(event)).toBe("DIRECTOR_VIEWPORT_RENDER_FAILED");
    });
});

describe("对象种类推导", () => {
    test("按形态映射，不读取名称或地址", () => {
        expect(directorDiagnosticObjectKind({ kind: "actor" })).toBe("actor");
        expect(directorDiagnosticObjectKind({ kind: "model" })).toBe("model");
        expect(directorDiagnosticObjectKind({ kind: "billboard" })).toBe("billboard");
        expect(directorDiagnosticObjectKind({ primitive: "box" })).toBe("primitive");
        expect(directorDiagnosticObjectKind({})).toBe("unknown");
        expect(directorDiagnosticObjectKind(null)).toBe("unknown");
        expect(directorDiagnosticObjectKind(undefined)).toBe("unknown");
    });
});
