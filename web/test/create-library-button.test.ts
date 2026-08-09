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
    });
});
