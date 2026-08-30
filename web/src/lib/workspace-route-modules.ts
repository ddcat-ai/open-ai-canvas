const workspaceRouteLoaders = {
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    create: () => import("@/pages/create"),
    novels: () => import("@/pages/novels"),
    projects: () => import("@/pages/projects"),
    wallet: () => import("@/pages/wallet"),
};

export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadNovelsPage = workspaceRouteLoaders.novels;
export const loadProjectsPage = workspaceRouteLoaders.projects;
export const loadWalletPage = workspaceRouteLoaders.wallet;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    const slug = pathnameOrSlug.replace(/^\//, "").split("/", 1)[0] as keyof typeof workspaceRouteLoaders;
    const load = workspaceRouteLoaders[slug];
    if (load) void load();
}
