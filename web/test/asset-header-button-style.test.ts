import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("asset library header buttons", () => {
    test("only forces white header buttons in light mode", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const headerButtonRule = css.match(/html:not\(\.dark\) \.library-page \.app-page-header \.ant-btn,[\s\S]*?transition: all 180ms ease-out !important;\s*}/)?.[0] || "";
        const headerButtonHoverRule = css.match(/html:not\(\.dark\) \.library-page \.app-page-header \.ant-btn:hover,[\s\S]*?transform: translateY\(-1px\);\s*}/)?.[0] || "";

        expect(headerButtonRule).toContain("background: #ffffff !important;");
        expect(headerButtonRule).toContain("color: #171717 !important;");
        expect(headerButtonHoverRule).toContain("background: #ffffff !important;");
        expect(headerButtonHoverRule).toContain("color: #171717 !important;");
        expect(css).not.toContain("\n    .library-page .app-page-header .ant-btn,\n");
    });
});
