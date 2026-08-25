import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-prompt-optimizer-drawer.tsx"), "utf8");

describe("prompt optimizer drawer instance isolation", () => {
    test("resolves the popover from the current drawer content instead of the first global match", () => {
        expect(source).toContain("const contentRef = useRef<HTMLDivElement | null>(null);");
        expect(source).toContain('contentRef.current?.closest<HTMLElement>(".canvas-prompt-optimizer-popover")');
        expect(source).toContain('<div ref={contentRef} className={`canvas-prompt-optimizer-panel');
        expect(source).not.toContain('document.querySelector<HTMLElement>(".canvas-prompt-optimizer-popover")');
    });
});
