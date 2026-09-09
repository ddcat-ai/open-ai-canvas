import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createImageUploadPlaceholder, createFileUploadPlaceholder, interruptFileUpload, readUploadImageSize, uploadNodeType, uploadPercent, uploadVeilOpacity } from "../src/lib/canvas/canvas-file-upload";
import { CanvasNodeType } from "../src/types/canvas";
import { isCanvasImageSourceNode } from "../src/lib/canvas/canvas-image-source";
import { CanvasFileUploadContent } from "../src/components/canvas/canvas-file-upload-content";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { canvasThemes } from "../src/lib/canvas-theme";

const file = { name: "photo.png", size: 1234, type: "image/png" };
const placeholder = () => createImageUploadPlaceholder("upload", file, { x: 100, y: 200 }, { width: 1920, height: 1080 });
const read = (path: string) => readFileSync(resolve(import.meta.dir, "../src", path), "utf8");

describe("图片上传占位", () => {
    for (const [width, height] of [[1920, 1080], [900, 1600], [800, 800], [4000, 500]]) {
        test(`按真实尺寸保持比例并围绕落点居中 ${width}x${height}`, () => {
            const node = createImageUploadPlaceholder("upload", file, { x: 100, y: 200 }, { width, height });
            expect(node.width / node.height).toBeCloseTo(width / height);
            expect(node.position.x + node.width / 2).toBe(100);
            expect(node.position.y + node.height / 2).toBe(200);
            expect(node.metadata?.naturalWidth).toBe(width);
            expect(node.metadata?.naturalHeight).toBe(height);
            expect(node.metadata?.fileUpload).toBe("uploading");
            expect(node.metadata?.content).toBeUndefined();
            expect(node.metadata?.status).toBeUndefined();
            expect(isCanvasImageSourceNode(node)).toBe(true);
        });
    }

    test("重新打开画布将中断上传转为可重试错误，不修改其他节点", () => {
        const node = placeholder();
        const interrupted = interruptFileUpload(node);
        expect(interrupted.metadata?.fileUpload).toBe("error");
        expect(interrupted.metadata?.errorDetails).toContain("中断");
        expect(interrupted.position).toEqual(node.position);
        expect(node.metadata?.fileUpload).toBe("uploading");
        expect(interruptFileUpload(interrupted)).toBe(interrupted);
        const ready = { ...node, metadata: { content: "image" } };
        expect(interruptFileUpload(ready)).toBe(ready);
    });

    test("图片解码成功和失败均释放临时 URL，不伪造尺寸", async () => {
        const originalImage = globalThis.Image;
        const create = URL.createObjectURL;
        const revoke = URL.revokeObjectURL;
        const revoked: string[] = [];
        let fail = false;
        try {
            URL.createObjectURL = () => "blob:upload-test";
            URL.revokeObjectURL = (url) => { revoked.push(url); };
            globalThis.Image = class {
                src = "";
                naturalWidth = 1200;
                naturalHeight = 800;
                async decode() { if (fail) throw new Error("decode failed"); }
            } as unknown as typeof Image;
            const input = new File(["test"], "test.png", { type: "image/png" });
            expect(await readUploadImageSize(input)).toEqual({ width: 1200, height: 800 });
            fail = true;
            await expect(readUploadImageSize(input)).rejects.toThrow("decode failed");
            expect(revoked).toEqual(["blob:upload-test", "blob:upload-test"]);
        } finally {
            globalThis.Image = originalImage;
            URL.createObjectURL = create;
            URL.revokeObjectURL = revoke;
        }
    });

    for (const mode of ["light", "dark"] as const) {
        test(`${mode}主题包含可访问的上传状态、减弱动效和失败重试`, () => {
            const html = renderToStaticMarkup(<CanvasFileUploadContent node={placeholder()} theme={canvasThemes[mode]} reduceMotion />);
            expect(html).toContain("正在上传图片");
            expect(html).toContain('aria-busy="true"');
            expect(html).toContain('data-static="true"');
            expect(html).toContain(canvasThemes[mode].node.fill);
            const error = renderToStaticMarkup(<CanvasNodeActionContext.Provider value={{ upload: () => {} }}><CanvasFileUploadContent node={interruptFileUpload(placeholder())} theme={canvasThemes[mode]} /></CanvasNodeActionContext.Provider>);
            expect(error).toContain("重新选择文件");
            expect(error).toContain('aria-busy="false"');
            expect(error).toContain('data-static="true"');
        });
    }

    test("上传先占位再传输，完成替换同一节点，弹窗不等待传输完成", () => {
        const hook = read("pages/canvas/use-canvas-upload.ts");
        const create = hook.slice(hook.indexOf("const createFileNode"), hook.indexOf("const createImageAssetNode"));
        expect(create.indexOf("createFileUploadPlaceholder")).toBeLessThan(create.indexOf("await uploadImage(file,"));
        expect(create).toContain("if (!currentNode)");
        expect(create).toContain("fileUpload: undefined");
        const replace = hook.slice(hook.indexOf('const replaceNodeMedia'), hook.indexOf("const pasteSystemClipboard"));
        expect(replace).toContain("await createFileNode(file, currentNode.position, nodeId)");
        expect(create).toContain("original?.metadata?.content");
        expect(read("components/canvas/canvas-upload-modal.tsx")).toContain("onClose();\n            await pendingUpload;");
        expect(read("styles/globals.css")).toContain("prefers-reduced-motion: reduce");
    });
});

test("真实进度与遮罩浓度反向关联，不生成未知进度", () => {
    expect(uploadPercent(20, 100)).toBe(20);
    expect(uploadPercent(150, 100)).toBe(100);
    expect(uploadPercent(0, 0)).toBeUndefined();
    expect(uploadPercent(NaN, 100)).toBeUndefined();
    expect(uploadVeilOpacity(0)).toBe(1);
    expect(uploadVeilOpacity(50)).toBeCloseTo(0.55);
    expect(uploadVeilOpacity(100)).toBeCloseTo(0.1);
});

test("统一识别图片、视频、音频、纯文本文件，不误收 PDF 或 Word", () => {
    for (const [name, type, expected] of [
        ["image.png", "image/png", CanvasNodeType.Image], ["video.mp4", "video/mp4", CanvasNodeType.Video],
        ["sound.ogg", "audio/ogg", CanvasNodeType.Audio], ["sound.wav", "", CanvasNodeType.Audio],
        ["note.md", "", CanvasNodeType.Text], ["note.txt", "text/plain", CanvasNodeType.Text],
        ["document.pdf", "application/pdf", null], ["document.docx", "", null],
    ] as const) expect(uploadNodeType({ name, type })).toBe(expected);
});

test("音频与文本在传输前就有独立占位，可重试且不带模型生成状态", async () => {
    for (const [name, type, expected] of [["voice.mp3", "audio/mpeg", CanvasNodeType.Audio], ["note.md", "text/markdown", CanvasNodeType.Text]] as const) {
        const node = await createFileUploadPlaceholder("file", new File(["content"], name, { type }), { x: 0, y: 0 });
        expect(node.type).toBe(expected);
        expect(node.metadata?.fileUpload).toBe("uploading");
        expect(node.metadata?.content).toBeUndefined();
        expect(node.metadata?.status).toBeUndefined();
        expect(interruptFileUpload(node).metadata?.fileUpload).toBe("error");
    }
});

test("所有资源渲染真实百分比，100% 仍等待保存，磨砂渐淡但文案不淡出", () => {
    for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text]) {
        const node = { ...placeholder(), type, metadata: { fileUpload: "uploading" as const, fileUploadProgress: 50 } };
        const html = renderToStaticMarkup(<CanvasFileUploadContent node={node} theme={canvasThemes.light} />);
        expect(html).toContain("已上传 50%");
        expect(html).toContain('opacity:0.55');
        expect(html).toContain('aria-valuenow="50"');
        const complete = renderToStaticMarkup(<CanvasFileUploadContent node={{ ...node, metadata: { ...node.metadata, fileUploadProgress: 100 } }} theme={canvasThemes.dark} />);
        expect(complete).toContain("文件已传输，正在保存与处理");
        expect(complete).toContain('aria-busy="true"');
    }
});
