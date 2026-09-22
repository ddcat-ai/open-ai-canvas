import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { removeCreationAttachment } from "../src/pages/create/creation-assets";

function compactSource(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

function readCreateSource() {
    return readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
}

function readCreateWorkspaceSource() {
    return readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-workspace.tsx"), "utf8");
}

describe("creation library button", () => {
    test("keeps library selection in the reference area instead of the bottom dock", () => {
        const source = readCreateWorkspaceSource();
        const dockStart = source.indexOf('<footer className="creation-chat-dock">');
        const dockEnd = source.indexOf("</footer>", dockStart);

        expect(dockStart).toBeGreaterThanOrEqual(0);
        expect(dockEnd).toBeGreaterThan(dockStart);
        const dockSource = compactSource(source.slice(dockStart, dockEnd));
        const modePickerIndex = dockSource.indexOf("<ModePicker mode={props.mode}");

        expect(modePickerIndex).toBeGreaterThanOrEqual(0);
        expect(source).not.toContain("creation-composer-mode-row");
        expect(dockSource).not.toContain('aria-label="打开素材库选择参考内容"');
        expect(dockSource).not.toContain('aria-label="从本机上传附件"');
        expect(source).toContain("onClick={props.onOpenLibrary}");
        expect(source).toContain("creation-reference-add-button");
        expect(source).toContain('showSelectedPrice={false} showOptionPrices variant="creation"');
        expect(source).toContain("creation-submit-cost");
    });

    test("uploads from the library without adding a reference before confirmation", () => {
        const source = readCreateSource();
        const pickerSource = readFileSync(resolve(import.meta.dir, "../src/components/assets/asset-library-picker-modal.tsx"), "utf8");
        const uploadStart = source.indexOf("const uploadLibraryAssets = async");
        const uploadEnd = source.indexOf("const handleLibrarySelect", uploadStart);

        expect(uploadStart).toBeGreaterThanOrEqual(0);
        expect(uploadEnd).toBeGreaterThan(uploadStart);
        expect(source.slice(uploadStart, uploadEnd)).not.toContain("setAttachments");
        expect(source).toContain("onUpload: uploadLibraryAssets");
        expect(source).not.toContain("onUpload={() => fileInputRef.current?.click()}");
        expect(source).toContain("上传后保存到素材库");
        expect(pickerSource).toContain("保存完成后会自动选中");
        expect(source).toContain("个素材已上传到素材库并自动选中");
    });

    test("视频创作使用同名模型组的全部参考能力开放素材入口", () => {
        const source = readCreateSource();
        const workspace = readCreateWorkspaceSource();

        expect(source).toContain('modelGroupReferenceLimits(config, preferredModel || selectedModel, "video")');
        expect(source).toContain("reconcileCreationAttachmentLimits(attachments, mentionReferences, videoReferenceLimits)");
        expect(workspace).toContain('props.mode !== "video" || props.maxReferences > 0');
        expect(workspace).not.toContain('props.videoProfile.operations.includes("image_to_video")');
    });

    test("previews prompt reference images without removing them", () => {
        const createSource = readCreateWorkspaceSource();
        const canvasSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-prompt-panel.tsx"), "utf8");

        expect(createSource).toContain('className="creation-user-message-attachments"');
        expect(createSource).toContain('setPreviewType(kind === "video" ? "video" : "image")');
        expect(createSource).toContain("<CreationMediaPreviewModal url={previewUrl} type={previewType}");
        expect(canvasSource).toContain("canPreview ? setImagePreview(reference) : onInsert(reference)");
        expect(canvasSource).toContain("<AntImage");
        expect(canvasSource).toContain("onClick={() => onInsert(reference)}");
    });

    test("参考内容层叠轨道支持折叠、展开和 Reorder 排序", () => {
        const source = readCreateWorkspaceSource();
        const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        expect(source).toContain('import { Reorder, LayoutGroup, motion, useReducedMotion } from "motion/react"');
        expect(source).toContain("<Reorder.Group");
        expect(source).toContain('axis="x"');
        expect(source).toContain("values={visibleAttachments}");
        expect(source).toContain("onReorder={reorderVisibleAttachments}");
        expect(source).toContain('className="creation-reference-card-remove"');
        expect(source).toContain("onPointerDownCapture");
        expect(source).toContain("event.stopPropagation()");
        expect(source).toContain("<Reorder.Item");
        expect(source).toContain('layout="position"');
        expect(source).toContain("isExpanded");
        expect(source).toContain("setReferencePanelExpanded");
        expect(source).toContain("aria-label={`查看全部 ${props.attachments.length} 个参考内容`}");
        expect(source).toContain('aria-label="收起素材面板"');
        expect(source).toContain("清空全部素材");
        expect(source).toContain('role="group"');
        expect(source).toContain("aria-pressed={referenceFilter === filter.id}");
        expect(source).toContain('{ id: "file", label: "文件", count: referenceCounts.file }');
        expect(source).toContain("canDragReferences");
        expect(source).toContain("creation-reference-track-wrapper");
        expect(source).toContain("creation-reference-stack-card");
        expect(source).toContain("creation-reference-add-button");
        expect(source).toContain("addReferenceLabel");
        expect(source).toContain("aria-busy={interactionBusy}");
        expect(source).toContain("disabled={interactionBusy || !canAddMoreReferences}");
        expect(source).toContain("creation-reference-track-button");
        expect(source).toContain("imageReferenceAtPoint");
        expect(source).toContain("setDropTargetReferenceId");
        expect(source).toContain("props.onReplaceAttachment(target.attachmentId, item)");
        expect(source).toContain("onReferenceFilesDrop=");
        expect(source).toContain("CanvasPromptOptimizerDrawer");
        expect(source).toContain("promptOptimizerOpen");
        expect(source).toContain("provider={props.promptOptimizerProvider}");
        expect(styles).toContain(".creation-reference-track");
        expect(styles).toContain(".creation-reference-stack-card");
        expect(styles).toContain("--stack-rotate: -7deg");
        expect(styles).toContain(".creation-reference-track.is-expanded");
        expect(styles).toContain(".creation-reference-stack-card:is(:hover, :focus-within) .creation-reference-card-content");
        expect(styles).toContain("@media (hover: none)");
        expect(styles).toContain(".creation-reference-card-remove { opacity: 1; }");
        expect(styles).not.toContain(".creation-reference-track:not(.is-expanded) .creation-reference-stack-card:nth-child(n+5) { display: block; }");
        expect(source).toContain("isExpanded: true");
        expect(source).toContain("else if (!hadAttachments) setReferencePanelExpanded(true)");
        expect(styles).toContain("creation-reference-filter-tabs button.is-active::after");
    });

    test("resolves remote asset images from their stable resource key", () => {
        const assets = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-assets.ts"), "utf8");
        const createSource = readCreateWorkspaceSource();

        expect(assets).toContain("resolveResourceUrl(asset.data.storageKey");
        expect(createSource).toContain("<CachedResourceImage storageKey={item.storageKey}");
        expect(createSource).toContain("resolveResourceUrl(item.storageKey, item.previewUrl)");
    });

    test("首个、中间和末尾参考内容都按稳定 id 独立删除并保留顺序", () => {
        const attachments = [
            { id: "first", name: "首个" },
            { id: "middle", name: "中间" },
            { id: "last", name: "末尾" },
        ];

        expect(removeCreationAttachment(attachments, "first").map((item) => item.id)).toEqual(["middle", "last"]);
        expect(removeCreationAttachment(attachments, "middle").map((item) => item.id)).toEqual(["first", "last"]);
        expect(removeCreationAttachment(attachments, "last").map((item) => item.id)).toEqual(["first", "middle"]);
    });

    test("删除按钮在指针按下阶段隔离拖拽，素材库入口职责独立", () => {
        const source = compactSource(readCreateWorkspaceSource());

        expect(source).toContain("onPointerDownCapture={(event) => event.stopPropagation()}");
        expect(source).toContain("onRemove(item.id)");
        expect(source).toContain("onClick={props.onOpenLibrary}");
        expect(source).not.toContain("onClick={() => props.fileInputRef.current?.click()}");
    });
});

describe("creation homepage default mode", () => {
    test("opens the empty homepage on image generation instead of video", () => {
        const source = readCreateSource();
        expect(source).toContain("import { defaultCreationMode, modeLabels,");
        expect(source).toContain("initialComposerPreferences.mode || defaultCreationMode");
        expect(source).toContain("saved.mode || defaultCreationMode");
        expect(source).not.toContain('mode || "video"');
    });
});

describe("creation thread chrome", () => {
    test("docks the conversation toolbar into the workspace top bar and keeps a compact thread composer", () => {
        const workspace = readCreateWorkspaceSource();
        const topBar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-top-bar.tsx"), "utf8");
        const product = readFileSync(resolve(import.meta.dir, "../src/styles/workspace-product.css"), "utf8");

        expect(workspace).toContain("useWorkspaceTopBarMount");
        expect(workspace).toContain("createPortal(toolbar, mount)");
        expect(topBar).toContain("WorkspaceTopBarExtensionSlot");
        expect(product).toContain(".creation-chat-dock .creation-mode-tabs");
        expect(product).not.toContain("creation-composer-mode-row");
    });

    test("parameter popovers use the user surface without a hairline stroke", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-product.css"), "utf8");

        expect(css).toContain(".creation-control-popover .ant-popover-inner");
        expect(css).toContain("background: var(--user-surface-raised) !important");
        expect(css).toContain("border: 0 !important");
        expect(css).toContain("--border: transparent");
        expect(css).toContain(".creation-choice-grid button.is-selected");
        expect(css).toContain("background: var(--user-control-pressed) !important");
    });
});
