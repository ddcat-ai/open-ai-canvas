import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { apiClient } from "@/services/api/request";
import { setActiveUserScope } from "@/lib/user-scope";
import { COMMERCE_IMAGE_RESOURCE_DND_TYPE, importCommerceImageTransfer, normalizeCommerceImageFile, readCommerceImageTransfer, writeCommerceImageTransfer } from "@/pages/ecommerce/image-transfer";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
const adapter = apiClient.defaults.adapter;
beforeAll(() => {
    for (const [key, value] of Object.entries({ DOMParser: dom.DOMParser, location: dom.location, window: dom })) {
        globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
});
afterEach(() => {
    apiClient.defaults.adapter = adapter;
    setActiveUserScope(null);
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function transfer(input: { files?: File[]; itemFiles?: File[]; data?: Record<string, string> } = {}) {
    const data = input.data || {};
    return {
        files: input.files || [],
        items: (input.itemFiles || []).map((file) => ({ kind: "file", getAsFile: () => file })),
        types: Object.keys(data),
        getData: (type: string) => data[type] || "",
        setData: (type: string, value: string) => {
            data[type] = value;
        },
    } as unknown as DataTransfer;
}
const resource = (id = "res-1", overrides = {}) => ({ id, kind: "image", status: "ready", mimeType: "image/png", size: 100, ...overrides });

test("WeChat and Windows files with missing or generic MIME retain a real file and correct type", () => {
    for (const type of ["", "application/octet-stream"]) {
        const file = new File(["bytes"], "微信图片.JPG", { type });
        const parsed = readCommerceImageTransfer(transfer({ files: [file], itemFiles: [file] }));
        expect(parsed.files).toHaveLength(1);
        expect(normalizeCommerceImageFile(parsed.files[0]).type).toBe("image/jpeg");
        expect(normalizeCommerceImageFile(parsed.files[0]).size).toBe(5);
    }
});

test("clipboard-only image item works and non-image/empty/oversized files are rejected", () => {
    const pasted = new File(["bytes"], "paste.webp", { type: "image/webp" });
    expect(readCommerceImageTransfer(transfer({ itemFiles: [pasted] })).files).toEqual([pasted]);
    expect(() => normalizeCommerceImageFile(new File(["html"], "fake.png", { type: "text/html" }))).toThrow("不是支持");
    expect(() => normalizeCommerceImageFile(new File([], "empty.png"))).toThrow("非空");
    expect(() => normalizeCommerceImageFile(new File([new Uint8Array(30 * 1024 * 1024 + 1)], "large.png"))).toThrow("30 MB");
});

test("browser HTML selects the image rather than its linking webpage and ignores URI comments", () => {
    const source = readCommerceImageTransfer(
        transfer({ data: { "text/html": '<a href="https://shop.example.com/product"><img src="https://cdn.example.com/item.png?width=600&amp;quality=90"></a>', "text/uri-list": "# Link\nhttps://shop.example.com/product" } }),
    );
    expect(source.url).toBe("https://cdn.example.com/item.png?width=600&quality=90");
    expect(readCommerceImageTransfer(transfer({ data: { "text/uri-list": "# Comment\nhttps://cdn.example.com/image.jpg" } })).url).toContain("image.jpg");
});

test("unsafe URLs, cross-origin blob URLs and ordinary pasted text are not submitted", () => {
    for (const url of ["file:///C:/photo.png", "javascript:alert(1)", "https://user:secret@external.example.com/image.png", "blob:https://external.example.com/image", "商品文案", "data:text/html;base64,PHNjcmlwdD4="]) {
        expect(readCommerceImageTransfer(transfer({ data: { "text/plain": url } })).url).toBeUndefined();
    }
    expect(readCommerceImageTransfer(transfer()).url).toBeUndefined();
    expect(readCommerceImageTransfer(transfer({ data: { "text/plain": "data:image/png;base64,aGVsbG8=" } })).url).toContain("data:image/png");
});

test("generated-image drag roundtrips a resource identity with a usable URL fallback", () => {
    const drag = transfer();
    writeCommerceImageTransfer(drag, { resourceId: "generated-resource", name: "第 2 张生成结果", url: "https://cdn.example.com/temporary.png" });
    expect(drag.effectAllowed).toBe("copy");
    expect(drag.getData("text/uri-list")).toBe("https://commerce.example.com/api/resources/generated-resource/file");
    expect(readCommerceImageTransfer(drag)).toEqual({ files: [], resourceId: "generated-resource", name: "第 2 张生成结果" });
});

test("malformed typed payload falls back to ordinary image URL", () => {
    expect(readCommerceImageTransfer(transfer({ data: { [COMMERCE_IMAGE_RESOURCE_DND_TYPE]: '{"resourceId":"../other"}', "text/uri-list": "https://cdn.example.com/a.jpg" } })).url).toBe("https://cdn.example.com/a.jpg");
});

test("internal images are rechecked for ownership and rejected failures are propagated", async () => {
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url || "");
        return { data: { code: 0, data: { resource: resource("owned") } }, status: 200, statusText: "OK", headers: {}, config };
    };
    expect((await importCommerceImageTransfer({ files: [], resourceId: "owned" }, "style")).references).toEqual([{ resourceId: "owned", role: "style", name: "生成结果参考图" }]);
    expect(requests).toEqual(["/resources/owned"]);
    apiClient.defaults.adapter = async (config) => ({ data: { code: 403, msg: "无权访问" }, status: 403, statusText: "Forbidden", headers: {}, config });
    await expect(importCommerceImageTransfer({ files: [], resourceId: "foreign" })).rejects.toThrow("无权访问");
});

test("typed original resource wins over native thumbnail files and remains ownership checked", async () => {
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url || "");
        return { data: { code: 0, data: { resource: resource("owned-original") } }, status: 200, statusText: "OK", headers: {}, config };
    };
    const source = { files: [new File(["thumbnail"], "preview.png", { type: "image/png" })], resourceId: "owned-original", url: "blob:https://commerce.example.com/expired" };
    expect((await importCommerceImageTransfer(source)).references[0].resourceId).toBe("owned-original");
    expect(requests).toEqual(["/resources/owned-original"]);
    apiClient.defaults.adapter = async (config) => ({ data: { code: 403, msg: "无权访问" }, status: 403, statusText: "Forbidden", headers: {}, config });
    await expect(importCommerceImageTransfer({ ...source, resourceId: "foreign-original" })).rejects.toThrow("无权访问");
});

test("same-app resource URL reuses the ownership-checked resource; external URL uses import API", async () => {
    const requests: Array<{ url?: string; data: unknown }> = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push({ url: config.url, data: config.data });
        return { data: { code: 0, data: { resource: resource() } }, status: 200, statusText: "OK", headers: {}, config };
    };
    await importCommerceImageTransfer({ files: [], url: "https://commerce.example.com/api/resources/res-1/file" });
    await importCommerceImageTransfer({ files: [], url: "https://cdn.example.com/item.png" });
    expect(requests[0].url).toBe("/resources/res-1");
    expect(requests[1].url).toBe("/resources/import");
    expect(JSON.parse(requests[1].data as string)).toEqual({ url: "https://cdn.example.com/item.png", kind: "image" });
});

test("successful files survive a later failure and the remaining capacity stops further uploads", async () => {
    let calls = 0;
    apiClient.defaults.adapter = async (config) => {
        calls++;
        return { data: { code: 0, data: { resource: resource(`res-${calls}`) } }, status: 200, statusText: "OK", headers: {}, config };
    };
    const result = await importCommerceImageTransfer({ files: [new File(["image"], "one.png"), new File(["text"], "note.txt"), new File(["image"], "two.png"), new File(["image"], "three.png")] }, "detail", { maxReferences: 2 });
    expect(result.references.map((entry) => entry.resourceId)).toEqual(["res-1", "res-2"]);
    expect(result.errors).toHaveLength(2);
    expect(calls).toBe(2);
});

test("non-image server response cannot become a reference and duplicate IDs need no upload", async () => {
    let calls = 0;
    apiClient.defaults.adapter = async (config) => {
        calls++;
        return { data: { code: 0, data: { resource: resource("fake", { kind: "file", mimeType: "text/html" }) } }, status: 200, statusText: "OK", headers: {}, config };
    };
    await expect(importCommerceImageTransfer({ files: [], url: "https://cdn.example.com/login" })).rejects.toThrow("不是可用的图片");
    const result = await importCommerceImageTransfer({ files: [], resourceId: "existing" }, "primary", { existingResourceIds: ["existing"], maxReferences: 0 });
    expect(result.references).toEqual([]);
    expect(calls).toBe(1);
});

test("account switch during upload discards the result and stops the batch", async () => {
    setActiveUserScope("before");
    let calls = 0;
    apiClient.defaults.adapter = async (config) => {
        calls++;
        setActiveUserScope("after");
        return { data: { code: 0, data: { resource: resource() } }, status: 200, statusText: "OK", headers: {}, config };
    };
    await expect(importCommerceImageTransfer({ files: [new File(["image"], "one.png"), new File(["image"], "two.png")] })).rejects.toThrow("账号切换");
    expect(calls).toBe(1);
});
