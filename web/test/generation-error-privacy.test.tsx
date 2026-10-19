import { describe, expect, test } from "bun:test";
import { generationErrorMessage, sanitizeUserVisibleError } from "../src/lib/generation-error";

describe("user error privacy retains actionable reasons", () => {
    for (const [name, raw, hint] of [
        ["quota", `模型服务拒绝请求；上游：{"error":{"code":"insufficient_quota","message":"request id req-private task_secret123 https://private.example/v1"}}`, "额度"],
        ["model", `模型服务拒绝请求；上游：model_not_found request id req-private task_secret123 https://private.example/v1`, "更换模型"],
        ["image limit", `模型服务拒绝请求；上游：image file too large 25MB task_secret123 https://private.example/v1`, "压缩图片"],
        ["parameter", `生成失败；上游：请将 aspect_ratio 调整为 16:9，task_secret123 https://private.example/v1`, "16:9"],
        ["content", `生成失败；上游：生成图片违反内容防护限制，请修改提示词。 task_secret123 https://private.example/v1`, "修改提示词"],
    ]) {
        test(name!, () => {
            const message = generationErrorMessage(new Error(raw!));
            expect(message).toContain(hint!);
            for (const value of ["private.example", "task_secret123", "req-private", '"error"']) expect(message).not.toContain(value);
        });
    }

    test("keeps local diagnostic references and the original error cause chain", () => {
        expect(generationErrorMessage("请修改参数；诊断号 run-1 可反馈管理员")).toContain("run-1");
        const error = new Error("provider_request_failed", { cause: new Error("视频时长超过支持范围，请调整为 10 秒") });
        expect(generationErrorMessage(error)).toContain("10 秒");
        expect(generationErrorMessage("生成失败；上游：https://private.example request id req-private")).toBe("生成失败");
    });

    test("quoted JSON credentials and request identifiers never reach visible diagnostics", () => {
        for (const key of ["api_key", "token", "Authorization", "request_id"]) {
            const note = `退款原因：{"${key}":"${key === "Authorization" ? "Bearer " : ""}mock-secret-value"}`;
            expect(sanitizeUserVisibleError(note)).not.toContain("mock-secret-value");
        }
        const note = '活动积分调整：{"reason":"春节活动","amount":100}';
        expect(sanitizeUserVisibleError(note)).toBe(note);
    });
});
