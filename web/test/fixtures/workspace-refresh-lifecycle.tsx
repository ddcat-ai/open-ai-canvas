// Run through Vite with an existing login session; no account or session is mocked.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import "antd/dist/reset.css";
import "../../src/styles/globals.css";
import { AppProviders } from "../../src/components/layout/app-providers";
import { RequireAuth } from "../../src/components/auth/require-auth";
import UserLayout from "../../src/layouts/user-layout";
import { useUserStore } from "../../src/stores/use-user-store";

const container = document.getElementById("root")!;
const result = document.getElementById("result")!;
const selector = ".app-workspace-sidebar";
let insertions = 0;
let removals = 0;
let framesAfterFirstPaint = 0;
let invisibleFramesAfterFirstPaint = 0;
let firstSidebar: Element | null = null;
let firstPaintAt = 0;
let hydratedAt = 0;
const startedAt = performance.now();

function countSidebars(nodes: NodeList) {
    return Array.from(nodes).reduce((count, node) => {
        if (!(node instanceof Element)) return count;
        return count + Number(node.matches(selector)) + node.querySelectorAll(selector).length;
    }, 0);
}

const observer = new MutationObserver((records) => {
    for (const record of records) {
        insertions += countSidebars(record.addedNodes);
        removals += countSidebars(record.removedNodes);
    }
});
observer.observe(container, { childList: true, subtree: true });

function sample(now: number) {
    const sidebar = container.querySelector<HTMLElement>(selector);
    const visible = Boolean(sidebar?.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && sidebar.getBoundingClientRect().width > 0);
    if (visible && !firstPaintAt) {
        firstPaintAt = now;
        firstSidebar = sidebar;
    }
    if (firstPaintAt) {
        framesAfterFirstPaint++;
        if (!visible) invisibleFramesAfterFirstPaint++;
    }
    const { hydrated, user } = useUserStore.getState();
    if (hydrated && !hydratedAt) hydratedAt = now;
    if ((hydratedAt && now - hydratedAt >= 1500) || now - startedAt >= 15000) {
        observer.disconnect();
        const unchangedSidebar = Boolean(firstSidebar && firstSidebar === sidebar);
        const pass = Boolean(user && hydrated && visible && unchangedSidebar && insertions === 1 && removals === 0 && invisibleFramesAfterFirstPaint === 0 && framesAfterFirstPaint > 0);
        result.textContent = JSON.stringify({
            status: !user ? "BLOCKED: requires an existing login session" : pass ? "PASS" : "FAIL",
            sessionHydrated: hydrated,
            insertions,
            removals,
            framesAfterFirstPaint,
            invisibleFramesAfterFirstPaint,
            unchangedSidebar,
        }, null, 2);
        return;
    }
    requestAnimationFrame(sample);
}

const router = createMemoryRouter([
    { path: "/", element: <UserLayout><RequireAuth><p>会话恢复完成，工作区保持挂载。</p></RequireAuth></UserLayout> },
    { path: "/login", element: <p>请先在本地应用登录，再刷新此回归页面。</p> },
]);

requestAnimationFrame(sample);
createRoot(container).render(<StrictMode><AppProviders><RouterProvider router={router} /></AppProviders></StrictMode>);
