const workspaceRouteLoaders = {
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    create: () => import("@/pages/create"),
    projects: () => import("@/pages/projects"),
    projectDetail: () => import("@/pages/projects/detail"),
    projectCreate: () => import("@/pages/projects/create"),
    skillWorkbench: () => import("@/pages/skills/workbench"),
    toolboxImage: () => import("@/pages/workbench/image-workbench-route"),
    toolboxVideo: () => import("@/pages/workbench/video-workbench-page"),
};

export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadProjectDetailPage = workspaceRouteLoaders.projectDetail;
export const loadProjectsPage = workspaceRouteLoaders.projects;
export const loadProjectCreatePage = workspaceRouteLoaders.projectCreate;
export const loadSkillWorkbenchPage = workspaceRouteLoaders.skillWorkbench;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    // 根路径就是创作页，预加载时仍映射到其内部模块名。
    const segments = pathnameOrSlug.replace(/^\//, "").split("/").filter(Boolean);
    const slug = segments[0] || "create";
    // 具体画布项目由 /canvas/:id 自己加载；不要在认证恢复阶段额外预加载画布列表。
    if (slug === "canvas" && segments.length > 1) return;
    if (slug === "projects" && segments.length > 1) {
        void (segments[1] === "new" ? workspaceRouteLoaders.projectCreate() : workspaceRouteLoaders.projectDetail());
        return;
    }
    if (slug === "skills" && segments[2] === "edit") {
        void workspaceRouteLoaders.skillWorkbench();
        return;
    }
    // 创作影棚是图片 / 视频工作台的统一入口：按目标工作台预加载对应模块。
    if (slug === "toolbox" && segments.length > 1) {
        void (segments[1] === "video" ? workspaceRouteLoaders.toolboxVideo() : workspaceRouteLoaders.toolboxImage());
        return;
    }
    const load = workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (load) void load();
}
