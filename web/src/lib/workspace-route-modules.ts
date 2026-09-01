const workspaceRouteLoaders = {
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    create: () => import("@/pages/create"),
    projects: () => import("@/pages/projects"),
    wallet: () => import("@/pages/wallet"),
};

export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadProjectsPage = workspaceRouteLoaders.projects;
export const loadWalletPage = workspaceRouteLoaders.wallet;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    // 根路径就是创作页，预加载时仍映射到其内部模块名。
    const slug = pathnameOrSlug.replace(/^\//, "").split("/", 1)[0] || "create";
    const load = workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (load) void load();
}
