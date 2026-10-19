import { expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { clearResourceAccessCache } from "../src/services/api/resources";
import { readZip } from "../src/lib/zip";
import { createCreationImagesZip, creationImageDownloadBaseName, creationImageDownloadName, creationImagesZipName, readCreationDownloadImage } from "../src/pages/create/creation-media-download";

test("ZIP 使用主任务 ID，单图与普通批次使用真实任务 ID", () => {
    expect(creationImagesZipName({ id: "task-batch-run-123-image", agentRunId: "run-123", taskIds: ["child-1"] })).toBe("run-123.zip");
    expect(creationImagesZipName({ id: "message-1", taskIds: ["TASK_123"] })).toBe("TASK_123.zip");
    expect(creationImagesZipName({ id: "message-1" })).toBe("message-1.zip");
});

test("场景简称、序号和多输出子序号不会互相覆盖", () => {
    expect(creationImageDownloadBaseName("白底商品主图", 1)).toBe("01_主图");
    expect(creationImageDownloadBaseName("成分与配方说明图", 2)).toBe("02_成分");
    expect(creationImageDownloadBaseName("核心场景展示图", 4, 2)).toBe("04_场景_2");
    expect(creationImageDownloadBaseName("规格与使用步骤图", 7)).toBe("07_规格步骤");
    expect(creationImageDownloadBaseName("自由/创作:画面?", 10)).not.toMatch(/[\\/:*?"<>|]/);
    expect(creationImageDownloadName({ name: "02_成分", url: "https://example.test/a.png?token=x" }, new Blob(["bytes"], { type: "image/jpeg" }))).toBe("02_成分.jpg");
});

test("真实 ZIP 解压后图片按传入顺序命名并保留原始内容和格式", async () => {
    const images = [
        { name: "01_主图", url: "data:image/png;base64,cG5nLWJ5dGVz" },
        { name: "03_场景", url: "data:image/webp;base64,d2VicC1ieXRlcw==" },
    ];
    const zip = await createCreationImagesZip(images);
    expect(zip.type).toBe("application/zip");
    const entries = await readZip(zip);
    expect([...entries.keys()]).toEqual(["01_主图.png", "03_场景.webp"]);
    expect(await entries.get("01_主图.png")!.text()).toBe("png-bytes");
    expect(await entries.get("03_场景.webp")!.text()).toBe("webp-bytes");
});

test("批量下载不会把缺失、空白或错误页面打包成图片", async () => {
    await expect(createCreationImagesZip([])).rejects.toThrow("没有可下载的图片");
    await expect(readCreationDownloadImage({ name: "01_主图", url: "data:text/html,%3Chtml%3Eerror%3C/html%3E" })).rejects.toThrow("有效图片");
    await expect(readCreationDownloadImage({ name: "01_主图", url: "data:image/png;base64," })).rejects.toThrow("内容为空");
    await expect(
        createCreationImagesZip([
            { name: "01_主图", url: "data:image/png;base64,cGl4ZWxz" },
            { name: "02_场景", url: "data:text/plain,error" },
        ]),
    ).rejects.toThrow("有效图片");
});

test("浏览器从新签发的原图地址下载并打包，过期展示链接不影响顺序与格式", async () => {
    const previous = apiClient.defaults.adapter;
    const previousFetch = globalThis.fetch;
    clearResourceAccessCache();
    let calls = 0;
    const downloads: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        calls += 1;
        expect(config.url).toBe("/resources/access");
        const requested = JSON.parse(config.data);
        expect(requested).toEqual(["resource-2", "resource-3"].map((resourceId) => ({ resourceId, purpose: "browser-process", variant: "original" })));
        const items = requested.map(({ resourceId }: { resourceId: string }) => ({
            resourceId,
            access: { resourceId, url: `https://storage.example/${resourceId}`, delivery: "origin", requestedVariant: "original", actualVariant: "original", refreshAt: new Date(Date.now() + 60_000).toISOString() },
        }));
        return { data: { code: 0, data: { items } }, status: 200, statusText: "OK", headers: {}, config };
    };
    globalThis.fetch = (async (url, options) => {
        downloads.push(String(url));
        expect(options?.credentials).toBe("omit");
        const second = String(url).endsWith("resource-2");
        return new Response(second ? "png-original" : "webp-original", { headers: { "Content-Type": second ? "image/png" : "image/webp" } });
    }) as typeof fetch;
    try {
        const result = await createCreationImagesZip([
            { url: "https://expired.test/second.png", storageKey: "resource:resource-2", name: "02_细节" },
            { url: "https://expired.test/third.jpg", storageKey: "resource:resource-3", name: "03_成分" },
        ]);
        const entries = await readZip(result);
        expect([...entries.keys()]).toEqual(["02_细节.png", "03_成分.webp"]);
        expect(await entries.get("02_细节.png")!.text()).toBe("png-original");
        expect(await entries.get("03_成分.webp")!.text()).toBe("webp-original");
        expect(downloads).toEqual(["https://storage.example/resource-2", "https://storage.example/resource-3"]);
        expect(calls).toBe(1);
    } finally {
        apiClient.defaults.adapter = previous;
        globalThis.fetch = previousFetch;
        clearResourceAccessCache();
    }
});

test("批量图片下载限制并发且保持输入顺序", async () => {
    let active = 0;
    let maximum = 0;
    const images = Array.from({ length: 9 }, (_, index) => ({ name: `${index}`, url: `${index}` }));
    const result = await createCreationImagesZip(images, async (image) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Bun.sleep(1);
        active -= 1;
        return new Blob([image.name], { type: "image/png" });
    });
    expect(maximum).toBe(4);
    expect([...(await readZip(result)).keys()]).toEqual(images.map((image) => `${image.name}.png`));
});

test("HTTP 和 CORS 失败不会以 URL 文本冒充成功下载", async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = (async () => new Response("denied", { status: 403 })) as typeof fetch;
        await expect(readCreationDownloadImage({ name: "image", url: "https://media.example/image" })).rejects.toThrow("403");
        globalThis.fetch = (async () => {
            throw new TypeError("Failed to fetch");
        }) as typeof fetch;
        await expect(createCreationImagesZip([{ name: "image", url: "https://media.example/image" }])).rejects.toThrow("CORS");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
