import { describe, expect, test } from "bun:test";

import { ApiError, request } from "../src/services/api/request";

describe("backend API request error semantics", () => {
    test("unwraps a successful backend envelope", async () => {
        await expect(request(Promise.resolve({ data: { code: 0, data: { id: "task-1" }, msg: "ok" }, status: 200 }))).resolves.toEqual({ id: "task-1" });
    });

    test("preserves business code from a non-zero envelope", async () => {
        const thrown = await request(Promise.resolve({ data: { code: 40901, data: null, msg: "任务状态已变化" }, status: 200 })).catch((error) => error);

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown).toMatchObject({ name: "ApiError", status: 200, code: 40901, message: "任务状态已变化", retryable: false });
    });

    test("preserves HTTP status, backend code and retryability", async () => {
        const axiosError = {
            isAxiosError: true,
            message: "Request failed with status code 429",
            response: {
                status: 429,
                data: { code: 42901, data: null, msg: "请求过于频繁，请稍后重试" },
            },
        };
        const thrown = await request(Promise.reject(axiosError)).catch((error) => error);

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown).toMatchObject({ status: 429, code: 42901, message: "请求过于频繁，请稍后重试", retryable: true });
        expect(thrown.cause).toBe(axiosError);
    });

    test("converts Axios cancellation to AbortError", async () => {
        const thrown = await request(Promise.reject({ __CANCEL__: true, code: "ERR_CANCELED" })).catch((error) => error);

        expect(thrown).toMatchObject({ name: "AbortError", message: "请求已取消" });
    });
});
