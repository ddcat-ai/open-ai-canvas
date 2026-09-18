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

        for (const route of ["projects", "canvas", "assets", "create"]) {
            expect(modules).toContain(`${route}: () => import`);
        }
        expect(modules).toContain('projectDetail: () => import("@/pages/projects/detail")');
        expect(modules).toContain('slug === "projects" && segments.length > 1');
        expect(navigation).toContain("onPointerEnter={() => preloadWorkspaceRoute(linkTo)}");
        expect(navigation).toContain("onPointerDown={() => preloadWorkspaceRoute(linkTo)}");
        expect(navigation).toContain("onFocus={() => preloadWorkspaceRoute(linkTo)}");
    });

    test("keeps the creation page at root and preserves the create compatibility route", () => {
        const router = source("../src/router.tsx");
        const navigation = source("../src/components/layout/workspace-sidebar-nav.tsx");

        expect(router).toContain('{ path: "/", element: <RequireAuth>{deferred(<CreatePage />)}</RequireAuth> }');
        expect(router).toContain('{ path: "/create", element: <RequireAuth>{deferred(<CreatePage />)}</RequireAuth> }');
        expect(router).not.toContain('path: "/home"');
        expect(router).not.toContain("HomePage");
        expect(navigation).toContain('{ ...toolItem("create", "/"), id: "home", title: "创作" }');
        expect(navigation).not.toContain('to: "/create"');
        expect(navigation).not.toContain('to: "/home"');
    });

    test("preloads canvas detail and paints opening feedback before navigation", () => {
        const modules = source("../src/lib/workspace-route-modules.ts");
        const router = source("../src/router.tsx");
        const canvasLibrary = source("../src/pages/canvas/index.tsx");
        const canvasCard = source("../src/components/canvas/canvas-folder-card.tsx");

        expect(modules).toContain('loadCanvasProjectPage = () => import("@/pages/canvas/project")');
        expect(router).toContain("lazy(loadCanvasProjectPage)");
        expect(canvasLibrary).toContain("setOpeningProjectId(id)");
        expect(canvasLibrary).toContain("window.requestAnimationFrame(() => navigate(");
        expect(canvasCard).toContain("onPointerEnter={onPrefetch}");
        expect(canvasCard).toContain("正在打开");
    });

    test("loads only the active project detail view and keeps canvas-only state out of the global layout", () => {
        const detail = source("../src/pages/projects/detail.tsx");
        const layout = source("../src/layouts/user-layout.tsx");
        const canvas = source("../src/pages/canvas/index.tsx");

        for (const view of ["assets", "canvases", "chapters", "overview", "settings", "workflow", "editor"]) {
            expect(detail).toContain(`lazy(() => import("./detail/${view}"))`);
        }
        expect(layout).not.toContain("useCanvasUiStore");
        expect(layout).not.toContain("CanvasDeleteProjectsDialog");
        expect(canvas).toContain("deleteDialogOpen ? <Suspense");
        expect(detail).toContain("project-workspace-header");
        expect(detail).not.toContain("useWorkspaceTopBarExtension");
        expect(detail).toContain("新建画布");
    });


    test("keeps project asset refresh scoped to the latest user and project", () => {
        const editor = source("../src/pages/projects/detail/editor.tsx");

        expect(editor).toContain("const assetOwnerKey = JSON.stringify([scope, projectId])");
        expect(editor).toContain("activeAssetOwnerKeyRef.current !== requestedOwnerKey");
        expect(editor).toContain("assetRefreshSequenceRef.current !== requestSequence");
        expect(editor).toContain("assetRefreshSequenceRef.current += 1");
        expect(editor).toContain("syncedAssetOwnerKeyRef.current = assetOwnerKey");
        expect(editor.match(/listProjectAssets\(projectId\)/g)).toHaveLength(1);
    });

    test("does not poll wallet balance from permanent workspace chrome", () => {
        const wallet = source("../src/hooks/use-wallet-balance.ts");
        expect(wallet).not.toContain("refetchInterval:");
        expect(wallet).toContain("wallet:updated");
        expect(wallet).toContain("WALLET_STALE_TIME_MS");
    });

    test("defers modal-only markdown and canvas creation runtimes until interaction", () => {
        const changelogButton = source("../src/components/layout/app-changelog-modal.tsx");
        const announcements = source("../src/components/layout/system-announcement-center.tsx");
        const projectDetail = source("../src/pages/projects/detail.tsx");
        const workflow = source("../src/pages/projects/detail/workflow-production-workbench.tsx");

        expect(changelogButton).toContain('lazy(() => import("@/components/layout/app-changelog-dialog")');
        expect(changelogButton).not.toContain('from "react-markdown"');
        expect(announcements).toContain('lazy(() => import("@/components/ui/aceternity/announcement-timeline-modal")');
        expect(projectDetail).toContain('import("@/services/user-data-sync")');
        expect(projectDetail).not.toContain('import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync"');
        expect(workflow).not.toContain('from "@/lib/video-poster"');
        expect(workflow).toContain('if (playing) return <video');
    });

    test("uses a quiet workspace skeleton for initial hydration", () => {
        const loader = source("../src/components/ui/aceternity/full-screen-loader.tsx");
        const css = source("../src/styles/globals.css");

        expect(loader).toContain("full-screen-loader-scene");
        expect(loader).toContain("full-screen-loader-guide");
        expect(loader).toContain("LoadingSignal");
        expect(loader).not.toContain("YINGCE STUDIO");
        expect(loader).not.toContain("loading-cue");
        expect(css).toContain("@keyframes loading-signal-spin");
        expect(css).toContain("@media (prefers-reduced-motion: reduce)");
        expect(css).not.toContain("@keyframes loading-cue-pulse");
    });
});

describe("workspace wallet entry", () => {
    test("opens the credits modal instead of a dedicated wallet page", () => {
        const router = source("../src/router.tsx");
        const modules = source("../src/lib/workspace-route-modules.ts");
        const host = source("../src/components/layout/workspace-wallet-modal.tsx");
        const palette = source("../src/components/layout/workspace-command-palette.tsx");
        const canvasTopBar = source("../src/pages/canvas/canvas-project-top-bar.tsx");
        const topBar = source("../src/components/layout/workspace-top-bar.tsx");
        const css = source("../src/styles/globals.css");

        expect(router).toContain('path: "/wallet"');
        expect(router).toContain("element: <RequireAuth>{null}</RequireAuth>");
        expect(router).not.toContain("WalletPage");
        expect(router).not.toContain("loadWalletPage");
        expect(modules).not.toContain("pages/wallet");
        expect(host).toContain("pathname !== \"/wallet\"");
        expect(host).toContain("openWorkspaceWallet");
        expect(palette).toContain('run: () => openWorkspaceWallet()');
        expect(palette).not.toContain('"/wallet"');
        expect(canvasTopBar).toContain("openWorkspaceWallet()");
        expect(canvasTopBar).not.toContain('to="/wallet"');
        expect(topBar).toContain("openWorkspaceWallet()");
        expect(css).not.toContain(".wallet-library-page");
        expect(css).not.toContain(".wallet-market-page");
    });
});
