import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/assets/asset-batch-upload-modal.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

function dropzone() {
    const start = source.indexOf('<button type="button" className={dragging');
    expect(start).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf("</button>", start));
}

test("拖放区真正接收拖入的图片，与点击选择走同一过滤", () => {
    const zone = dropzone();
    expect(zone).toContain("onDragOver={(event) => { event.preventDefault();");
    expect(zone).toContain("onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploading) chooseFiles(Array.from(event.dataTransfer.files)); }}");
    expect(zone).toContain("支持拖拽或多选上传，标题默认取文件名");
    expect(source).not.toContain("支持拖拽思路的多选上传");
});

test("拖入时高亮拖放区", () => {
    expect(dropzone()).toContain('className={dragging ? "batch-upload-dropzone is-dragging" : "batch-upload-dropzone"}');
    expect(css).toContain(".batch-upload-dropzone:hover, .batch-upload-dropzone.is-dragging {");
});

test("失败行直接显示后端返回的原因（截断，悬停看全文）", () => {
    expect(source).toContain('{item.status === "error" && item.error ? <span className="block truncate text-[11px] text-red-500" title={item.error}>{item.error}</span> : null}');
});
