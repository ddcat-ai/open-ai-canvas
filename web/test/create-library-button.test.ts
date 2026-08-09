import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("creation library button", () => {
    test("places a library control beside the generation mode picker", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
        const modePickerIndex = source.indexOf("<ModePicker mode={props.mode} onModeChange={props.onModeChange} />");
        const libraryButtonIndex = source.indexOf('className="creation-chat-control" onClick={props.onOpenLibrary} disabled={props.busy || !referencesSupported} aria-label="打开素材库选择参考内容"');

        expect(modePickerIndex).toBeGreaterThanOrEqual(0);
        expect(libraryButtonIndex).toBeGreaterThan(modePickerIndex);
        expect(source.slice(libraryButtonIndex, libraryButtonIndex + 180)).toContain("<FolderOpen />");
        expect(source.slice(libraryButtonIndex, libraryButtonIndex + 180)).toContain("<span>素材库</span>");
    });

    test("uploads from the library without adding a reference before confirmation", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
        const uploadStart = source.indexOf("const uploadLibraryAssets = async");
        const uploadEnd = source.indexOf("const handleFileChange", uploadStart);

        expect(uploadStart).toBeGreaterThanOrEqual(0);
        expect(uploadEnd).toBeGreaterThan(uploadStart);
        expect(source.slice(uploadStart, uploadEnd)).not.toContain("setAttachments");
        expect(source).toContain("onUpload={uploadLibraryAssets}");
        expect(source).not.toContain("onUpload={() => fileInputRef.current?.click()}");
        expect(source).toContain("上传后保存到素材库");
        expect(source).toContain("正在保存到素材库，完成后会自动选中");
        expect(source).toContain("个素材已上传到素材库并自动选中");
    });

    test("previews prompt reference images without removing them", () => {
        const createSource = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
        const canvasSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-prompt-panel.tsx"), "utf8");

        expect(createSource).toContain('className="creation-chat-attachment-preview"');
        expect(createSource).toContain("<CreationMediaPreviewModal url={previewUrl} type={previewType}");
        expect(canvasSource).toContain("canPreview ? setImagePreview(reference) : onInsert(reference)");
        expect(canvasSource).toContain("<AntImage");
        expect(canvasSource).toContain("onClick={() => onInsert(reference)}");
    });
});
