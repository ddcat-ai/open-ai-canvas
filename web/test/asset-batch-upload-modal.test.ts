import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/assets/asset-batch-upload-modal.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");

function section(startMarker: string, endMarker: string) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

test("批量上传把真实上传进度传给列表，进度条不挤掉文件名", () => {
    const upload = section("const uploadBatch = async", "const close = ");
    expect(upload).toMatch(/uploadImage\(item\.file, \(loaded, total\) =>/);
    expect(upload).toContain("percent }");
    expect(source).not.toMatch(/<Progress[^>]*className="w-20"/);
    expect(source).toContain('<div className="w-20 shrink-0"><Progress');
});

test("上传成功后不再回读远端地址获取尺寸", () => {
    expect(source).not.toContain("readImageMeta(");
    expect(section("const uploadBatch = async", "const close = ")).toContain("width: uploaded.width, height: uploaded.height");
});

test("同步收尾抛错时仍释放上传状态", () => {
    const upload = section("const uploadBatch = async", "const close = ");
    expect(upload).toMatch(/finally \{ setUploading\(false\); \}/);
    expect(upload).toContain("flushAssetStorePersistence().catch(");
    expect(upload).not.toMatch(/await flushAssetStorePersistence\(\);/);
});

test("部分失败时不自动关闭弹窗，关闭时再刷新列表", () => {
    const upload = section("const uploadBatch = async", "const close = ");
    expect(upload).toContain("if (!failed) await onComplete();");
    expect(upload).not.toMatch(/setUploading\(false\); await onComplete\(\);/);
    const close = section("const close = ", "return <Modal");
    expect(close).toContain('items.some((item) => item.status === "done")');
    expect(close).toContain("if (hasUploaded) void onComplete();");
});
