import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function compactSource(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

describe("creation library button", () => {
    test("places a library control beside the generation mode picker", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
        const dockStart = source.indexOf('<footer className="creation-chat-dock">');
        const dockEnd = source.indexOf("</footer>", dockStart);

        expect(dockStart).toBeGreaterThanOrEqual(0);
        expect(dockEnd).toBeGreaterThan(dockStart);
        const dockSource = compactSource(source.slice(dockStart, dockEnd));
        const modePickerIndex = dockSource.indexOf("<ModePicker mode={props.mode}");
        const attachmentIndex = dockSource.indexOf('aria-label="从本机上传附件"');
        const libraryIndex = dockSource.indexOf('aria-label="打开素材库选择参考内容"');

        expect(modePickerIndex).toBeGreaterThanOrEqual(0);
        expect(attachmentIndex).toBeGreaterThan(modePickerIndex);
        expect(libraryIndex).toBeGreaterThan(attachmentIndex);
        expect(dockSource).toContain("onClick={props.onOpenLibrary}");
        expect(dockSource).toContain("disabled={props.busy || !referencesSupported}");
    });

    test("uploads from the library without adding a reference before confirmation", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
        const pickerSource = readFileSync(resolve(import.meta.dir, "../src/components/assets/asset-library-picker-modal.tsx"), "utf8");
        const uploadStart = source.indexOf("const uploadLibraryAssets = async");
        const uploadEnd = source.indexOf("const handleFileChange", uploadStart);

        expect(uploadStart).toBeGreaterThanOrEqual(0);
        expect(uploadEnd).toBeGreaterThan(uploadStart);
        expect(source.slice(uploadStart, uploadEnd)).not.toContain("setAttachments");
        expect(source).toContain("onUpload: uploadLibraryAssets");
        expect(source).not.toContain("onUpload={() => fileInputRef.current?.click()}");
        expect(source).toContain("上传后保存到素材库");
        expect(pickerSource).toContain("保存完成后会自动选中");
        expect(source).toContain("个素材已上传到素材库并自动选中");
    });

    test("previews prompt reference images without removing them", () => {
        const createSource = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
        const canvasSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-prompt-panel.tsx"), "utf8");

        expect(createSource).toContain('className="creation-user-message-attachments"');
        expect(createSource).toContain('setPreviewType(kind === "video" ? "video" : "image")');
        expect(createSource).toContain("<CreationMediaPreviewModal url={previewUrl} type={previewType}");
        expect(canvasSource).toContain("canPreview ? setImagePreview(reference) : onInsert(reference)");
        expect(canvasSource).toContain("<AntImage");
        expect(canvasSource).toContain("onClick={() => onInsert(reference)}");
    });

    test("参考内容层叠轨道支持折叠、展开和 Reorder 排序", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
        const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        expect(source).toContain('import { Reorder } from "motion/react"');
        expect(source).toContain("<Reorder.Group");
        expect(source).toContain('axis="x"');
        expect(source).toContain("values={props.attachments}");
        expect(source).toContain("onReorder={props.onReorderAttachments}");
        expect(source).toContain("<Reorder.Item");
        expect(source).toContain('layout="position"');
        expect(source).toContain("isExpanded");
        expect(source).toContain("handleTrackMouseEnter");
        expect(source).toContain("handleTrackMouseLeave");
        expect(source).toContain("handleTrackFocus");
        expect(source).toContain("handleTrackBlur");
        expect(source).toContain("creation-reference-track-wrapper");
        expect(source).toContain("creation-reference-stack-card");
        expect(source).toContain("creation-reference-add-button");
        expect(source).toContain("creation-reference-track-button");
        expect(source).toContain("CanvasPromptOptimizerDrawer");
        expect(source).toContain("promptOptimizerOpen");
        expect(source).toContain("provider={props.promptOptimizerProvider}");
        expect(styles).toContain(".creation-reference-track");
        expect(styles).toContain(".creation-reference-stack-card");
        expect(styles).toContain("--stack-rotate: -7deg");
        expect(styles).toContain(".creation-reference-track.is-expanded");
        expect(styles).toContain("@media (hover: none)");
    });
});
