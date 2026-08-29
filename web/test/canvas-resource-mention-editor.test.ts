import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("canvas resource mention editor", () => {
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
});
