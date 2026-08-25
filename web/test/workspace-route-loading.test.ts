import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("workspace route loading", () => {
    test("keeps lazy workspace routes inside the workspace stage", () => {
        const router = source("../src/router.tsx");
        const deferred = router.slice(router.indexOf("function deferred"), router.indexOf("function fullScreenDeferred"));

        expect(deferred).toContain("<WorkspaceRouteLoader />");
        expect(deferred).not.toContain("FullScreenLoader");
        expect(router).toContain("fullScreenDeferred(<LoginPage />)");
        expect(router).toContain("fullScreenDeferred(<SharedCanvasPage />)");
    });

    test("preloads the reported workspace routes before navigation", () => {
        const modules = source("../src/lib/workspace-route-modules.ts");
        const navigation = source("../src/components/layout/workspace-sidebar-nav.tsx");

        for (const route of ["projects", "canvas", "assets", "wallet", "create"]) {
            expect(modules).toContain(`${route}: () => import`);
        }
        expect(navigation).toContain("onPointerEnter={() => preloadWorkspaceRoute(linkTo)}");
        expect(navigation).toContain("onPointerDown={() => preloadWorkspaceRoute(linkTo)}");
        expect(navigation).toContain("onFocus={() => preloadWorkspaceRoute(linkTo)}");
    });

    test("uses a quiet workspace skeleton for initial hydration", () => {
        const loader = source("../src/components/ui/aceternity/full-screen-loader.tsx");
        const css = source("../src/styles/globals.css");

        expect(loader).toContain("full-screen-loader-topbar");
        expect(loader).toContain("full-screen-loader-rail");
        expect(loader).toContain("LoadingSignal");
        expect(loader).not.toContain("YINGCE STUDIO");
        expect(loader).not.toContain("loading-cue");
        expect(css).toContain("@keyframes loading-signal-spin");
        expect(css).toContain("@media (prefers-reduced-motion: reduce)");
        expect(css).not.toContain("@keyframes loading-cue-pulse");
    });
});

describe("wallet balance summary", () => {
    test("uses the workspace surface instead of an inverted primary button surface", () => {
        const css = source("../src/styles/globals.css");
        const rule = css.match(/\.credit-balance-card \{[^}]+}/)?.[0] || "";

        expect(rule).toContain("background: var(--library-surface)");
        expect(rule).toContain("color: var(--foreground)");
        expect(rule).not.toContain("--btn-solid-bg");
        expect(css.match(/\.wallet-balance-inner \{/g)).toHaveLength(3);
        expect(css).not.toContain(".wallet-library-page .wallet-balance-inner { padding-left: 0; }");
    });
});
