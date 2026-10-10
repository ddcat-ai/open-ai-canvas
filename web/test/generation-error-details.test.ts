import { describe, expect, test } from "bun:test";
import { CONTENT_MODERATION_MESSAGE, generationErrorMessage, generationFailureMetadata } from "../src/lib/generation-error";

describe("safe upstream error details", () => {
    const detail = "非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。请重试或修改提示语。";
    test("keeps the specific image rejection on the card", () => {
        const message = `模型服务拒绝了请求，请检查模型和参数；上游：${detail}`;
        expect(generationErrorMessage(new Error(message))).toBe(message);
    });
    test("does not replace a safe upstream message with a generic HTTP hint", () => {
        const message = `模型服务暂时不可用（HTTP 500）；上游：${detail}`;
        expect(generationErrorMessage(message)).toBe(message);
        expect(generationErrorMessage("模型服务暂时不可用（HTTP 500）")).toBe("网络异常。");
    });
    test("keeps details when moderation metadata is stored", () => {
        const message = `内容审核未通过；上游：${detail}`;
        const metadata = generationFailureMetadata(message, "test prompt");
        expect(metadata.errorDetails).toBe(`${CONTENT_MODERATION_MESSAGE}；上游：${detail}`);
        expect(metadata.generationErrorCode).toBe("sensitive_words_detected");
    });
    test("upstream marker does not bypass URL hiding", () => {
        expect(generationErrorMessage("模型服务请求失败；上游：https://private.test")).toBe("网络异常。");
    });
});

describe("status-derived reasons", () => {
    const withReason = (message: string, reason: string) => Object.assign(new Error(message), { reason });
    test("keeps the readable backend message", () => {
        const cases: Array<[string, string]> = [
            ["conflict", "执行控制权已过期，请在当前页面重新接管"],
            ["failed_precondition", "任务中断，请恢复任务后继续。"],
            ["forbidden", "该插件已停用，请联系管理员。"],
            ["quota_exceeded", "账号素材数量已达到 100 个上限"],
        ];
        for (const [reason, message] of cases) expect(generationErrorMessage(withReason(message, reason))).toBe(message);
    });
    test("falls back to the generic copy for empty or technical messages", () => {
        expect(generationErrorMessage(withReason("", "conflict"))).toBe("请求状态已发生变化，请刷新后再试。");
        expect(generationErrorMessage(withReason("internal_server_error", "internal"))).toBe("系统暂时无法完成生成，请稍后再试。");
        expect(generationErrorMessage(withReason("错误 https://private.test", "forbidden"))).toBe("当前账号没有执行此操作的权限。");
        expect(generationErrorMessage(withReason("模型服务暂时不可用（HTTP 500）", "internal"))).toBe("系统暂时无法完成生成，请稍后再试。");
    });
});
