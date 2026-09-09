import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("canvas resource mention editor", () => {
    test("refreshes async reference previews even when prompt text has not changed", () => {
        const component = source("../src/components/canvas/canvas-resource-mention-textarea.tsx");
        const unchangedTextBranch = component.match(/if \(currentValue === value && lastRenderedValueRef.current === value\) \{([^}]+)\}/)?.[1] || "";
        expect(unchangedTextBranch).toContain("syncInlineMentionPreviews(editor, activeReferences)");
        const sync = component.slice(component.indexOf("function syncInlineMentionPreviews("), component.indexOf("function MentionMenu("));
        expect(sync).toContain('byId.get(chip.dataset.mentionReferenceId || "")');
        expect(sync).toContain('preview.getAttribute("src") !== src');
        expect(sync).toContain("preview.replaceWith(createInlinePreview(reference))");
        expect(sync).not.toContain("replaceChildren");
        expect(sync).not.toContain("onChange(");
    });

    test("uses stable component classes for inline media references", () => {
        const component = source("../src/components/canvas/canvas-resource-mention-textarea.tsx");

        expect(component).toContain('chip.className = "canvas-resource-inline-mention"');
        expect(component).toContain("canvas-resource-inline-preview is-${reference.kind}");
        expect(component).not.toContain("size-[1.18em]");
    });

    test("clamps native media dimensions so video previews cannot cover prompt text", () => {
        const css = source("../src/styles/globals.css");
        const previewRule = css.match(/\.canvas-resource-inline-preview \{[^}]+}/)?.[0] || "";

        expect(previewRule).toContain("width: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("min-width: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("max-width: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("height: var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("flex: 0 0 var(--canvas-mention-chip-preview-size)");
        expect(previewRule).toContain("object-fit: cover");
    });

    test("exposes inline image references as replacement drop targets", () => {
        const component = source("../src/components/canvas/canvas-resource-mention-textarea.tsx");
        const css = source("../src/styles/globals.css");

        expect(component).toContain("activeDropReferenceId?: string | null");
        expect(component).toContain("onReferenceFilesDrop?:");
        expect(component).toContain("chip.dataset.mentionReferenceId = reference.id");
        expect(component).toContain('chip.classList.toggle("is-replace-target"');
        expect(component).toContain("onReferenceFilesDrop(reference, files)");
        expect(css).toContain(".canvas-resource-inline-mention.is-replace-target");
        expect(css).toContain('content: "替换"');
    });

    test("resolves storage-backed previews and renders a visible loading spinner", () => {
        const editor = source("../src/components/canvas/canvas-resource-mention-textarea.tsx");
        const panel = source("../src/components/canvas/canvas-node-prompt-panel.tsx");
        const configComposer = source("../src/components/canvas/canvas-config-composer.tsx");
        const project = source("../src/pages/canvas/project.tsx");

        expect(editor).toContain("useResolvedCanvasResourceReferences");
        expect(panel).toContain("<LoaderCircle className=");
        expect(panel).toContain("animate-spin motion-reduce:animate-none");
        expect(panel).not.toContain("isRunning ? theme.accent.danger");
        expect(configComposer).toContain("wrapper.dataset.referenceToken");
        expect(configComposer).not.toContain("result += `@[node:");
        expect(project).not.toContain("removeCanvasResourceMention");
    });

    test("keeps editable mention prompts separate from normalized generation prompts", () => {
        const imageExecutor = source("../src/pages/canvas/canvas-image-generation-executor.ts");
        const mediaExecutors = source("../src/pages/canvas/canvas-media-generation-executors.ts");
        const textExecutor = source("../src/pages/canvas/canvas-text-generation-executor.ts");
        const generationExecutor = source("../src/pages/canvas/use-canvas-generation-executor.ts");

        expect(imageExecutor.match(/canvasGenerationPromptMetadata\(prompt, effectivePrompt\)/g)?.length).toBeGreaterThanOrEqual(3);
        expect(imageExecutor).toContain("imageBatchExpanded: count > 1 ? true : undefined");
        expect(imageExecutor).toContain("imageGenerationReferenceConnections");
        expect(imageExecutor).toContain("retireImageBatchChildren");
        expect(mediaExecutors.match(/canvasGenerationPromptMetadata\(prompt, effectivePrompt\)/g)?.length).toBe(2);
        expect(textExecutor.match(/canvasGenerationPromptMetadata\(prompt, effectivePrompt\)/g)?.length).toBe(2);
        expect(generationExecutor).toContain("composerContent: prompt");
        expect(generationExecutor).toContain("canvasGenerationPromptMetadata(prompt, statusPrompt)");
    });

    test("anchors the mention menu to the caret instead of the textarea edge", () => {
        const component = source("../src/components/canvas/canvas-resource-mention-textarea.tsx");

        expect(component).toContain("cursorOffset={mention.end}");
        expect(component).toContain("mentionCaretRect(anchor, cursorOffset)");
        expect(component).toContain("textareaCaretRect(anchor, cursorOffset)");
        expect(component).toContain('transform: position.showAbove ? "translateY(-100%)" : undefined');
        expect(component).toContain('window.addEventListener("scroll", updatePosition, true)');
    });

    test("renders skill references as descriptive workflow rows", () => {
        const component = source("../src/components/canvas/canvas-resource-mention-textarea.tsx");
        const css = source("../src/styles/globals.css");

        expect(component).toContain('reference.kind === "skill" ? "is-skill" : ""');
        expect(component).toContain("reference.skill?.description");
        expect(component).toContain("reference.skill?.file_count");
        expect(component).toContain("<Workflow aria-hidden />");
        expect(css).toContain(".canvas-resource-mention-item.is-skill");
        expect(css).toContain(".canvas-resource-mention-meta");
    });

    test("agent composer attachments stay large, previewable, and mentionable", () => {
        const component = source("../src/components/canvas/canvas-agent-chat-ui.tsx");
        expect(component).toContain("w-20 shrink-0");
        expect(component).toContain("insertAttachmentMention");
        expect(component).toContain("@[attachment:");
        expect(component).toContain("AgentImagePreview");
        expect(component).toContain("composerReferences");
        expect(component).toContain("点击放大预览");
    });
});
