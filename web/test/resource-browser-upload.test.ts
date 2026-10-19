import { afterEach, expect, test } from "bun:test";
import { ApiError, apiClient } from "../src/services/api/request";
import { clearResourceAccessCache, getResourceBlob, uploadResourceFile } from "../src/services/api/resources";

const originalAdapter = apiClient.defaults.adapter;
const originalXHR = globalThis.XMLHttpRequest;
const originalFetch = globalThis.fetch;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    globalThis.XMLHttpRequest = originalXHR;
    globalThis.fetch = originalFetch;
    clearResourceAccessCache();
});

test("浏览器 PUT 之后仍须等待后端核验，媒体字节不进业务上传请求", async () => {
    const steps: string[] = [];
    globalThis.XMLHttpRequest = class {
        status = 200;
        withCredentials = false;
        upload = {};
        onload?: () => void;
        open(method: string, url: string) {
            expect(method).toBe("PUT");
            expect(url).toBe("https://storage.example/signed");
        }
        setRequestHeader(name: string, value: string) {
            if (name === "If-None-Match") expect(value).toBe("*");
        }
        send(body: Blob) {
            expect(body.size).toBe(3);
            steps.push("put");
            queueMicrotask(() => this.onload?.());
        }
    } as unknown as typeof XMLHttpRequest;
    apiClient.defaults.adapter = async (config) => {
        const data =
            config.url === "/resources/uploads/direct"
                ? (steps.push("begin"), { upload: { id: "direct-1", method: "PUT", url: "https://storage.example/signed", headers: { "Content-Type": "image/png", "If-None-Match": "*" } } })
                : (steps.push("complete"), { resource: { id: "direct-1", status: "ready" } });
        expect(config.data instanceof Blob).toBe(false);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
    };
    const resource = await uploadResourceFile(new Blob(["png"], { type: "image/png" }), "image");
    expect(resource.status).toBe("ready");
    expect(steps).toEqual(["begin", "put", "complete"]);
});

test("受管资源 CORS 失败使用带明确原因的鉴权后端路径", async () => {
    apiClient.defaults.adapter = async (config) => ({
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: {
            code: 0,
            data: {
                items: [
                    {
                        resourceId: "cors-1",
                        access: {
                            resourceId: "cors-1",
                            url: "https://storage.example/cors",
                            delivery: "origin",
                            requestedVariant: "original",
                            actualVariant: "original",
                            issuedAt: new Date().toISOString(),
                            refreshAt: new Date(Date.now() + 60_000).toISOString(),
                            revision: "1",
                        },
                    },
                ],
            },
        },
    });
    const requests: Array<{ url: string; credentials?: RequestCredentials }> = [];
    globalThis.fetch = (async (url, options) => {
        requests.push({ url: String(url), credentials: options?.credentials });
        if (String(url).startsWith("https://storage.example")) throw new TypeError("Failed to fetch");
        return new Response("real-bytes", { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;
    const blob = await getResourceBlob("resource:cors-1");
    expect(await blob?.text()).toBe("real-bytes");
    expect(requests[0].credentials).toBe("omit");
    expect(requests[1].url).toContain("/resources/cors-1/browser-file?reason=cors_or_network");
    expect(requests[1].credentials).toBe("include");
});

test.each([false, true])("已直传的文件遇到确认失败，只重试确认，不删除或重新上传（持续失败=%s）", async (persistent) => {
    let puts = 0;
    let completions = 0;
    const calls: string[] = [];
    globalThis.XMLHttpRequest = class {
        status = 200;
        upload = {};
        onload?: () => void;
        open() {}
        setRequestHeader() {}
        send() {
            puts++;
            queueMicrotask(() => this.onload?.());
        }
    } as unknown as typeof XMLHttpRequest;
    apiClient.defaults.adapter = async (config) => {
        calls.push(`${config.method} ${config.url}`);
        let data: unknown;
        if (config.url === "/resources/uploads/direct") data = { upload: { id: "confirm-retry", method: "PUT", url: "https://storage.example/signed", headers: {} } };
        else if (config.url?.endsWith("/complete")) {
            completions++;
            if (persistent || completions === 1) throw new ApiError("确认服务暂时不可用", { status: 503 });
            data = { resource: { id: "confirm-retry", status: "ready" } };
        } else throw new Error("不应删除对象或重复上传字节");
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
    };
    const upload = uploadResourceFile(new Blob(["png"], { type: "image/png" }), "image");
    if (persistent) await expect(upload).rejects.toThrow("确认服务暂时不可用");
    else await expect(upload).resolves.toMatchObject({ id: "confirm-retry", status: "ready" });
    expect(puts).toBe(1);
    expect(completions).toBe(persistent ? 3 : 2);
    expect(calls.every((call) => call.startsWith("post /resources/uploads/direct"))).toBe(true);
});
