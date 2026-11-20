import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("workspace credit gift mark", () => {
    test("workspace balances use the theme mark and the compact canvas entry retains its gift fallback", () => {
        const topBar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-top-bar.tsx"), "utf8");
        const canvas = readFileSync(resolve(import.meta.dir, "../src/pages/canvas/canvas-project-top-bar.tsx"), "utf8");
        const mark = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-credit-gift-mark.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");

        expect(topBar).toContain("useThemePack()?.creditMark ?? Coins");
        expect(topBar.match(/<BalanceMark aria-hidden/g)).toHaveLength(2);
        expect(canvas).toContain('<WorkspaceCreditGiftMark className="is-compact" />');
        expect(canvas).not.toContain("Coins");
        expect(mark).toContain("#FFB34A");
        expect(mark).toContain("#12B8A8");
        expect(css).toContain(".app-workspace-credit-gift");
        expect(css).toContain("rotate(-8deg)");
    });
});
