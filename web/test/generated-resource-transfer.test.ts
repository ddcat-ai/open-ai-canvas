import { afterEach, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { clearResourceAccessCache, getResourceAccess } from "../src/services/api/resources";
import { persistGeneratedResourceInBrowser } from "../src/services/generated-resource-transfer";

const originalAdapter = apiClient.defaults.adapter;
const originalXHR = globalThis.XMLHttpRequest;
const originalFetch = globalThis.fetch;
const originalBitmap = globalThis.createImageBitmap;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    globalThis.XMLHttpRequest = originalXHR;
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalBitmap;
    clearResourceAccessCache();
});

test("URL结果可直接取得，不等待图片下载或OSS保存", async () => {
    let downloads = 0;
    globalThis.fetch = (() => {
        downloads++;
        throw new Error("not needed for display");
    }) as typeof fetch;
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
                        resourceId: "pending-image",
                        access: {
                            resourceId: "pending-image",
                            url: "https://upstream.example/image",
                            delivery: "upstream",
                            requestedVariant: "original",
                            actualVariant: "original",
                            issuedAt: new Date().toISOString(),
                            refreshAt: new Date(Date.now() + 5_000).toISOString(),
                            revision: "upstream:pending-image",
                        },
                    },
                ],
            },
        },
    });
    const access = await getResourceAccess("resource:pending-image");
    expect(access.url).toBe("https://upstream.example/image");
    expect(access.delivery).toBe("upstream");
    expect(downloads).toBe(0);
});

test.each([false, true])("浏览器保存上游图片，PUT响应不可见时先确认（CORS=%s）", async (cors) => {
    const steps: string[] = [];
    globalThis.fetch = (async (url, options) => {
        expect(String(url)).toBe("https://upstream.example/image");
        expect(options?.credentials).toBe("omit");
        steps.push("fetch-upstream");
        return new Response("png", { headers: { "Content-Type": "image/png" } });
    }) as typeof fetch;
    globalThis.createImageBitmap = (async () => ({ width: 2, height: 3, close() {} })) as typeof createImageBitmap;
    globalThis.XMLHttpRequest = class {
        status = 200;
        upload = {};
        onload?: () => void;
        onerror?: () => void;
        open(method: string, url: string) {
            expect(method).toBe("PUT");
            expect(url).toBe("https://oss.example/signed");
        }
        setRequestHeader() {}
        send(body: Blob) {
            expect(body.size).toBe(3);
            steps.push("put-oss");
            queueMicrotask(() => (cors ? this.onerror?.() : this.onload?.()));
        }
    } as unknown as typeof XMLHttpRequest;
    apiClient.defaults.adapter = async (config) => {
        expect(config.data instanceof Blob).toBe(false);
        if (config.url?.endsWith("/generated-upload")) {
            steps.push("begin");
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { upload: { id: "upload-1", method: "PUT", url: "https://oss.example/signed", headers: {} } } } };
        }
        expect(config.url).toBe("/resources/pending-image/generated-upload/upload-1/complete");
        steps.push("complete");
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { resource: { id: "pending-image", status: "ready", browserDirect: true } } } };
    };
    const result = await persistGeneratedResourceInBrowser("pending-image", "https://upstream.example/image");
    expect(result?.id).toBe("pending-image");
    expect(result?.browserDirect).toBe(true);
    expect(steps).toEqual(["fetch-upstream", "begin", "put-oss", "complete"]);
});

test("浏览器无法读取上游时只请求后台补存，不回传字节或重新生成", async () => {
    globalThis.fetch = (async () => {
        throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const calls: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        calls.push(`${config.method} ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: {} } };
    };
    await expect(persistGeneratedResourceInBrowser("pending-image", "https://upstream.example/image")).rejects.toThrow("Failed to fetch");
    expect(calls).toEqual(["post /resources/pending-image/generated-upload/none/fallback"]);
});
