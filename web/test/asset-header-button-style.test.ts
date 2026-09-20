import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getWorkspaceAntThemeConfig } from "../src/lib/app-theme";

describe("asset library header buttons", () => {
    test("user pages share control geometry without a light-only outline override", () => {
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const theme = getWorkspaceAntThemeConfig();
        expect(theme.token?.controlHeight).toBe(38);
        expect(theme.components?.Button?.borderRadius).toBe(theme.token?.borderRadius);
        expect(theme.components?.Button?.defaultBorderColor).toBe("transparent");
        expect(css).not.toContain("html:not(.dark) .library-page .app-page-header .ant-btn");
        expect(css).not.toContain("html .assets-library-page .app-page-header .assets-header-action-buttons .ant-btn");
    });
});
