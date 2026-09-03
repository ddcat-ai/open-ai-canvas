import { describe, expect, it } from "bun:test";

import { classifyLightweightTask, decideAgentExecutionMode } from "@/lib/canvas/agent-fallback";

describe("classifyLightweightTask", () => {
    it("把文案/总结/问答/创意识别为简单任务", () => {
        expect(classifyLightweightTask("帮我写一段产品文案").simple).toBe(true);
        expect(classifyLightweightTask("总结一下这段对话").kind).toBe("summary");
        expect(classifyLightweightTask("什么是景别？").kind).toBe("qa");
        expect(classifyLightweightTask("给我一些短视频选题灵感").kind).toBe("ideation");
        expect(classifyLightweightTask("你好").simple).toBe(true);
    });

    it("把分镜拆解/媒体生成/画布批量操作识别为复杂任务", () => {
        const complex = [
            "把当前剧本拆成8个分镜并放到画布上",
            "根据这些提示词生成四张图片",
            "帮我批量创建节点并连接成工作流",
            "在画布上自动排布这些镜头",
            "一步步执行整个生成流程",
        ];
        for (const text of complex) {
            const result = classifyLightweightTask(text);
            expect(result.simple, text).toBe(false);
            expect(result.kind, text).toBe("complex");
        }
    });

    it("空文本不判为简单任务", () => {
        expect(classifyLightweightTask("   ").simple).toBe(false);
    });
});

describe("decideAgentExecutionMode", () => {
    it("本地已连接时永远优先本地，即使是简单任务", () => {
        const result = decideAgentExecutionMode({ localConnected: true, cloudModelReady: true, prompt: "写个标题" });
        expect(result.mode).toBe("local");
        expect(result.reason).toBe("local-available");
    });

    it("本地断开、云端就绪、简单任务时降级轻量模式", () => {
        const result = decideAgentExecutionMode({ localConnected: false, cloudModelReady: true, prompt: "帮我润色这句话" });
        expect(result.mode).toBe("lightweight");
        expect(result.reason).toBe("simple-task-fallback");
    });

    it("本地断开但云端模型未就绪时不降级", () => {
        const result = decideAgentExecutionMode({ localConnected: false, cloudModelReady: false, prompt: "写个标题" });
        expect(result.mode).toBe("local");
        expect(result.reason).toBe("cloud-model-unready");
    });

    it("本地断开但任务复杂时不降级，提示需要本地", () => {
        const result = decideAgentExecutionMode({ localConnected: false, cloudModelReady: true, prompt: "拆成8个分镜放到画布" });
        expect(result.mode).toBe("local");
        expect(result.reason).toBe("complex-task-requires-local");
    });

    it("用户关闭自动降级时即使本地断开也不降级", () => {
        const result = decideAgentExecutionMode({ localConnected: false, cloudModelReady: true, prompt: "写个标题", autoFallbackEnabled: false });
        expect(result.mode).toBe("local");
        expect(result.reason).toBe("fallback-disabled");
    });
});
