import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("creation composer auto compact", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

    test("keeps explicit expanded and compact states on the thread composer", () => {
        expect(source).toContain('useState<"expanded" | "compact">("expanded")');
        expect(source).toContain("data-composer-state={displayState}");
        expect(source).toContain("is-composer-${displayState}");
        expect(source).toContain("browsingContainerRef: threadScrollRef");
    });

    test("compacts while browsing and expands for direct composer interaction", () => {
        expect(source).toContain('addEventListener("scroll", handleBrowseScroll');
        expect(source).toContain('addEventListener("wheel", handleBrowseWheel');
        expect(source).toContain('addEventListener("pointermove", handleBrowsePointerMove');
        expect(source).toContain("else scheduleComposerCompact()");
        expect(source).toContain("CREATION_COMPOSER_PROXIMITY_PX = 28");
        expect(source).toContain("CREATION_COMPOSER_COMPACT_DELAY_MS = 160");
        expect(source).toContain("CREATION_COMPOSER_INITIAL_COMPACT_DELAY_MS = 420");
        expect(source).toContain("onPointerEnter={() =>");
        expect(source).toContain("onPointerDownCapture={expandComposer}");
        expect(source).toContain("onFocusCapture={expandComposer}");
        expect(source).toContain("onKeyDownCapture={expandComposer}");
        expect(source).toContain("props.variant !== \"thread\"");
    });

    test("animates height without removing composer controls", () => {
        expect(styles).toContain(".creation-chat-composer.is-thread.is-composer-compact .creation-chat-writing-surface");
        expect(styles).toContain("transition: min-height 120ms");
        expect(styles).toContain("max-height: 54px");
        expect(source).toContain("<VoiceRecordingButton");
        expect(source).toContain("<ModePicker");
        expect(source).toContain("<ModelPicker");
        expect(source).toContain("<GenerationSettingsMenu");
        expect(source).toContain("canvas-node-composer-submit");
        expect(source).toContain("creation-reference-add-button");
    });
});
