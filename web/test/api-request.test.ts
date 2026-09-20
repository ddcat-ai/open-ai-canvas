import { describe, expect, test } from "bun:test";

import { ApiError, apiClient, compactApiParams, http, request, serializeApiParams } from "../src/services/api/request";

describe("backend API request error semantics", () => {
    test("unwraps a successful backend envelope", async () => {
        await expect(request(Promise.resolve({ data: { code: 0, data: { id: "task-1" }, msg: "ok" }, status: 200 }))).resolves.toEqual({ id: "task-1" });
    });

    test("preserves business code and reason from a non-zero envelope", async () => {
        const thrown = await request(Promise.resolve({ data: { code: 40901, data: null, msg: "任务状态已变化", reason: "conflict" }, status: 200 })).catch((error) => error);

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown).toMatchObject({ name: "ApiError", status: 200, code: 40901, reason: "conflict", message: "任务状态已变化", retryable: false });
    });

    test("preserves HTTP status, backend code and retryability", async () => {
        const axiosError = {
            isAxiosError: true,
            message: "Request failed with status code 429",
            response: {
                status: 429,
                data: { code: 42901, data: null, msg: "请求过于频繁，请稍后重试", reason: "rate_limited" },
                headers: { "retry-after": "60" },
            },
        };
        const thrown = await request(Promise.reject(axiosError)).catch((error) => error);

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown).toMatchObject({ status: 429, code: 42901, reason: "rate_limited", message: "请求过于频繁，请稍后重试", retryable: true, retryAfterMs: 60_000 });
        expect(thrown.cause).toBe(axiosError);
    });

    test("replaces a bare proxy 502 with a user-facing retry message", async () => {
        const axiosError = {
            isAxiosError: true,
            message: "Request failed with status code 502",
            response: { status: 502, data: "Bad Gateway", headers: {} },
        };
        const thrown = await request(Promise.reject(axiosError)).catch((error) => error);

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown).toMatchObject({ status: 502, message: "后端服务暂时不可用，请稍后重试", retryable: true });
    });

    test("http.get unwraps the same backend envelope", async () => {
        const original = apiClient.request;
        apiClient.request = (async () => ({
            data: { code: 0, data: { id: "via-http" }, msg: "ok" },
            status: 200,
            headers: {},
        })) as typeof apiClient.request;
        try {
            await expect(http.get<{ id: string }>("/probe")).resolves.toEqual({ id: "via-http" });
        } finally {
            apiClient.request = original;
        }
    });

    test("http.get preserves a non-zero envelope as ApiError", async () => {
        const original = apiClient.request;
        apiClient.request = (async () => ({
            data: { code: 40901, data: null, msg: "任务状态已变化" },
            status: 200,
            headers: {},
        })) as typeof apiClient.request;
        try {
            const thrown = await http.get("/probe").catch((error) => error);
            expect(thrown).toBeInstanceOf(ApiError);
            expect(thrown).toMatchObject({ status: 200, code: 40901, message: "任务状态已变化" });
        } finally {
            apiClient.request = original;
        }
    });

    test("quota exceeded is not retryable", async () => {
        const thrown = await request(Promise.resolve({
            data: { code: 40301, data: null, msg: "账号素材数量已达到 100 个上限", reason: "quota_exceeded" },
            status: 403,
        })).catch((error) => error);

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown).toMatchObject({ status: 403, code: 40301, reason: "quota_exceeded", retryable: false });
    });

    test("converts Axios cancellation to AbortError", async () => {
        const thrown = await request(Promise.reject({ __CANCEL__: true, code: "ERR_CANCELED" })).catch((error) => error);

        expect(thrown).toMatchObject({ name: "AbortError", message: "请求已取消" });
    });
});

describe("backend API list query params", () => {
    test("serializes pagination filters as camelCase pageSize keys", () => {
        const query = serializeApiParams(compactApiParams({
            page: 2,
            pageSize: 40,
            projectId: "project-1",
            folderId: "folder-1",
            mediaType: "image",
            unitId: "unit-1",
            q: "夜戏",
        }));

        expect(query.get("page")).toBe("2");
        expect(query.get("pageSize")).toBe("40");
        expect(query.get("projectId")).toBe("project-1");
        expect(query.get("folderId")).toBe("folder-1");
        expect(query.get("mediaType")).toBe("image");
        expect(query.get("unitId")).toBe("unit-1");
        expect(query.get("q")).toBe("夜戏");
        expect(query.has("page_size")).toBe(false);
        expect(query.has("project_id")).toBe(false);
        expect(query.has("folder_id")).toBe(false);
        expect(query.has("limit")).toBe(false);
    });
});
