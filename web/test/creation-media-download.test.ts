import { expect, test } from "bun:test";
import axios from "axios";
import { apiClient } from "../src/services/api/request";
import { downloadImageResourceArchive } from "../src/services/api/resources";
import { createZip, readZip } from "../src/lib/zip";
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
    const images = [{ name: "01_主图", url: "data:image/png;base64,cG5nLWJ5dGVz" }, { name: "03_场景", url: "data:image/webp;base64,d2VicC1ieXRlcw==" }];
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
    await expect(readCreationDownloadImage({ name: "01_主图", url: "data:image/png;base64," })).rejects.toThrow("有效图片");
    await expect(createCreationImagesZip([{ name: "01_主图", url: "data:image/png;base64,cGl4ZWxz" }, { name: "02_场景", url: "data:text/plain,error" }])).rejects.toThrow("有效图片");
});

test("云端图片只请求一次 ZIP 导出，过期展示链接不影响文件顺序与格式", async () => {
    const previous = apiClient.defaults.adapter;
    const archive = await createZip([{ name: "02_细节.png", data: "png-original" }, { name: "03_成分.webp", data: "webp-original" }]);
    let calls = 0;
    apiClient.defaults.adapter = async (config) => {
        calls += 1;
        expect(config.url).toBe("/resources/image-archive");
        expect(JSON.parse(config.data)).toEqual([{ resourceId: "resource-2", name: "02_细节" }, { resourceId: "resource-3", name: "03_成分" }]);
        return { data: archive, status: 200, statusText: "OK", headers: {}, config };
    };
    try {
        const result = await createCreationImagesZip([{ url: "https://expired.test/second.png", storageKey: "resource:resource-2", name: "02_细节" }, { url: "https://expired.test/third.jpg", storageKey: "resource:resource-3", name: "03_成分" }]);
        expect(result).toBe(archive);
        expect([...(await readZip(result)).keys()]).toEqual(["02_细节.png", "03_成分.webp"]);
        expect(calls).toBe(1);
    } finally {
        apiClient.defaults.adapter = previous;
    }
});

test("单张云端图片通过临时导出取原件，沿用原始格式且无需访问跨域展示链接", async () => {
    const previous = apiClient.defaults.adapter;
    const archive = await createZip([{ name: "01_场景.webp", data: "webp-original" }]);
    apiClient.defaults.adapter = async (config) => ({ data: archive, status: 200, statusText: "OK", headers: {}, config });
    try {
        const image = { url: "https://unreadable.test/old.png", storageKey: "resource:resource-1", name: "01_场景" };
        const blob = await readCreationDownloadImage(image);
        expect(blob.type).toBe("image/webp");
        expect(await blob.text()).toBe("webp-original");
        expect(creationImageDownloadName(image, blob)).toBe("01_场景.webp");
    } finally {
        apiClient.defaults.adapter = previous;
    }
});

test("ZIP 导出失败保留服务端可读错误，而不是把错误 JSON 保存成压缩包", async () => {
    const previous = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
        throw new axios.AxiosError("Request failed with status code 400", "ERR_BAD_REQUEST", config, undefined, { data: new Blob([JSON.stringify({ code: 400, msg: "图片下载不完整，请重试" })], { type: "application/json" }), status: 400, statusText: "Bad Request", headers: {}, config });
    };
    try {
        await expect(downloadImageResourceArchive([{ resourceId: "resource-1", name: "01_场景" }])).rejects.toThrow("图片下载不完整，请重试");
    } finally {
        apiClient.defaults.adapter = previous;
    }
});
