import { beforeEach, describe, expect, test } from "bun:test";

import { recordPrevisDiagnostic, resetPrevisDiagnosticDedupe } from "../src/lib/canvas/previs/previs-diagnostics-recorder";
import { getClientDiagnosticEvents } from "../src/services/diagnostics/client-diagnostics";

/** 只看预演台自己的稳定码事件，避免与其它测试写入的诊断流互相干扰。 */
function previsEvents() {
    return getClientDiagnosticEvents().filter((event) => (event.code || "").startsWith("PREVIS_"));
}

function newestPrevisEvent() {
    return previsEvents().at(-1);
}

const LEAK_PROBES = [
    "https://cdn.example.com/actor.glb?token=abc123#frag",
    "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    "cookie=session=deadbeef; Path=/",
    "api_key=sk-live-0000",
    "Error: boom\n    at PrevisModel (previs-viewport.tsx:571:29)",
    "演员 1 的镜头意图正文",
];

beforeEach(() => {
    resetPrevisDiagnosticDedupe();
});

describe("记录进统一诊断缓冲区", () => {
    test("写入的事件带稳定码、固定文案与 runtime 分类", () => {
        const before = previsEvents().length;
        expect(recordPrevisDiagnostic("PREVIS_VIEWPORT_RENDER_FAILED")).toBe(true);

        expect(previsEvents().length).toBe(before + 1);
        const event = newestPrevisEvent();
        expect(event?.code).toBe("PREVIS_VIEWPORT_RENDER_FAILED");
        expect(event?.level).toBe("error");
        expect(event?.category).toBe("runtime");
        expect(event?.message).toBe("预演台 3D 视口渲染失败");
        // 绝不落 stack。
        expect(event?.stack || "").toBe("");
    });

    test("安全字段以枚举后缀进入 code，便于检索", () => {
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectId: "obj-1", objectKind: "model", attempt: 2 })).toBe(true);
        const event = newestPrevisEvent();
        expect(event?.code).toBe("PREVIS_MODEL_LOAD_FAILED object=obj-1 kind=model attempt=2");
    });

    test("sceneId 只进 code 后缀，不冒充 canvasId", () => {
        expect(recordPrevisDiagnostic("PREVIS_SAVE_FLUSH_FAILED", { sceneId: "repro-scene-1", revision: 3 })).toBe(true);
        const event = newestPrevisEvent();
        // PrevisScene.id 不是 canvas id，绝不写入既有后端契约字段。
        expect(event?.canvasId).toBeUndefined();
        expect(event?.code).toBe("PREVIS_SAVE_FLUSH_FAILED scene=repro-scene-1 revision=3");
    });

    test("三个保存相关码都能写入且级别正确", () => {
        recordPrevisDiagnostic("PREVIS_SAVE_RETRY_RECOVERED", { revision: 1 });
        expect(newestPrevisEvent()?.level).toBe("info");
        recordPrevisDiagnostic("PREVIS_SAVE_DRAFT_UNAVAILABLE", { revision: 1 });
        expect(newestPrevisEvent()?.level).toBe("error");
        recordPrevisDiagnostic("PREVIS_CLOSE_BLOCKED", { saveOutcome: "stay" });
        expect(newestPrevisEvent()?.level).toBe("warning");
    });
});

describe("去重与噪声控制", () => {
    test("同一 code+字段在窗口内只记一次", () => {
        const before = previsEvents().length;
        expect(recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_LOST")).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_LOST")).toBe(false);
        expect(recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_LOST")).toBe(false);
        expect(previsEvents().length).toBe(before + 1);
    });

    test("字段不同视为不同事件，不会被误去重", () => {
        const before = previsEvents().length;
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectKind: "model", attempt: 1 })).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectKind: "model", attempt: 2 })).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectKind: "actor", attempt: 1 })).toBe(true);
        expect(previsEvents().length).toBe(before + 3);
    });

    test("不同 objectId 在窗口内不互相吞掉", () => {
        const before = previsEvents().length;
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectId: "obj-1", objectKind: "model" })).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectId: "obj-2", objectKind: "model" })).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectId: "obj-3", objectKind: "model" })).toBe(true);
        // 同一 objectId 重复仍要被去重。
        expect(recordPrevisDiagnostic("PREVIS_MODEL_LOAD_FAILED", { objectId: "obj-1", objectKind: "model" })).toBe(false);
        expect(previsEvents().length).toBe(before + 3);
    });

    test("不同 sceneId 在窗口内不互相吞掉", () => {
        const before = previsEvents().length;
        expect(recordPrevisDiagnostic("PREVIS_SAVE_FLUSH_FAILED", { sceneId: "scene-1", revision: 1 })).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_SAVE_FLUSH_FAILED", { sceneId: "scene-2", revision: 1 })).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_SAVE_FLUSH_FAILED", { sceneId: "scene-1", revision: 1 })).toBe(false);
        expect(previsEvents().length).toBe(before + 2);
    });

    test("所有写入的 code 都以稳定 PREVIS_ 前缀开头", () => {
        resetPrevisDiagnosticDedupe();
        recordPrevisDiagnostic("PREVIS_CLOSE_BLOCKED", { sceneId: "scene-1", saveOutcome: "stay" });
        for (const event of previsEvents()) {
            expect((event.code || "").startsWith("PREVIS_")).toBe(true);
        }
    });

    test("重置去重状态后可再次记录同一事件", () => {
        expect(recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_RESTORED")).toBe(true);
        expect(recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_RESTORED")).toBe(false);
        resetPrevisDiagnosticDedupe();
        expect(recordPrevisDiagnostic("PREVIS_VIEWPORT_CONTEXT_RESTORED")).toBe(true);
    });
});

describe("不泄漏敏感内容", () => {
    test("伪造的敏感字段不会进入缓冲区任何字段", () => {
        for (const probe of LEAK_PROBES) {
            resetPrevisDiagnosticDedupe();
            recordPrevisDiagnostic("PREVIS_MODEL_ADOPT_FAILED", {
                objectId: probe,
                sceneId: probe,
                // @ts-expect-error 故意传入非法枚举，验证运行时白名单而非仅靠类型。
                objectKind: probe,
                // @ts-expect-error 故意传入非法数值类型。
                attempt: probe,
            });

            const event = newestPrevisEvent();
            const serialized = JSON.stringify(event);
            expect(serialized).not.toContain("cdn.example.com");
            expect(serialized).not.toContain("token=abc123");
            expect(serialized).not.toContain("sk-live-0000");
            expect(serialized).not.toContain("deadbeef");
            expect(serialized).not.toContain("Bearer");
            expect(serialized).not.toContain("演员");
            expect(serialized).not.toContain("previs-viewport.tsx");
            expect(event?.canvasId).toBeUndefined();
            expect(event?.code).toBe("PREVIS_MODEL_ADOPT_FAILED");
        }
    });

    test("未知 code 既不写入也不抛错", () => {
        const before = previsEvents().length;
        // @ts-expect-error 故意传入白名单外的 code。
        expect(recordPrevisDiagnostic("PREVIS_NOT_A_REAL_CODE", { objectId: "obj-1" })).toBe(false);
        expect(previsEvents().length).toBe(before);
    });
});
