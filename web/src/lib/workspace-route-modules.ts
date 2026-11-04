import { preloadableLazy, preloadWhenIdle } from "@/lib/preloadable-lazy";

// 用户端页面统一在这里声明：路由渲染和悬停/空闲预取用同一个组件实例，
// 预取完成后切换页面同步渲染，不再闪出加载提示。
export const workspaceRoutePages = {
    assets: preloadableLazy(() => import("@/pages/assets")),
    canvas: preloadableLazy(() => import("@/pages/canvas")),
    canvasProject: preloadableLazy(() => import("@/pages/canvas/project")),
    create: preloadableLazy(() => import("@/pages/create")),
    ecommerce: preloadableLazy(() => import("@/pages/ecommerce")),
    imageWorkbench: preloadableLazy(() => import("@/pages/workbench/image-workbench-route")),
    videoWorkbench: preloadableLazy(() => import("@/pages/workbench/video-workbench-page")),
    projects: preloadableLazy(() => import("@/pages/projects")),
    projectDetail: preloadableLazy(() => import("@/pages/projects/detail")),
    projectCreate: preloadableLazy(() => import("@/pages/projects/create")),
    skills: preloadableLazy(() => import("@/pages/skills")),
    skillWorkbench: preloadableLazy(() => import("@/pages/skills/workbench")),
    plugins: preloadableLazy(() => import("@/pages/plugins")),
    eagleLibrary: preloadableLazy(() => import("@/pages/plugins/eagle")),
    tasks: preloadableLazy(() => import("@/pages/tasks")),
    settings: preloadableLazy(() => import("@/pages/settings")),
    referral: preloadableLazy(() => import("@/pages/referral")),
};

export const loadCanvasProjectPage = workspaceRoutePages.canvasProject.preload;

// 侧栏一级入口对应的页面；画布编辑器、作品详情等二级页面仍在悬停或进入列表时预取。
const workspaceNavigationPages = [
    workspaceRoutePages.create,
    workspaceRoutePages.canvas,
    workspaceRoutePages.assets,
    workspaceRoutePages.projects,
    workspaceRoutePages.tasks,
    workspaceRoutePages.skills,
    workspaceRoutePages.imageWorkbench,
    workspaceRoutePages.videoWorkbench,
    workspaceRoutePages.plugins,
    workspaceRoutePages.settings,
];

let navigationPreloadStarted = false;

/** 进入工作区后空闲预取侧栏页面，首次点击侧栏也直接渲染。 */
export function preloadWorkspaceNavigationPages() {
    if (navigationPreloadStarted) return;
    navigationPreloadStarted = true;
    preloadWhenIdle(workspaceNavigationPages.map((page) => page.preload));
}

const workspaceRouteSlugs: Record<string, keyof typeof workspaceRoutePages> = {
    create: "create",
    canvas: "canvas",
    assets: "assets",
    projects: "projects",
    tasks: "tasks",
    skills: "skills",
    plugins: "plugins",
    settings: "settings",
    referral: "referral",
    ecommerce: "ecommerce",
};

function warm(key: keyof typeof workspaceRoutePages) {
    // 预取失败不打断交互；真正打开页面时会重新拉取并交给路由错误页。
    void workspaceRoutePages[key].preload().catch(() => undefined);
}

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    // 根路径就是创作页，预加载时仍映射到其内部模块名。
    const segments = pathnameOrSlug.replace(/^\//, "").split("/").filter(Boolean);
    const slug = segments[0] || "create";
    // 具体画布项目由 /canvas/:id 自己加载；不要在认证恢复阶段额外预加载画布列表。
    if (slug === "canvas" && segments.length > 1) return;
    if (slug === "projects" && segments.length > 1) {
        warm(segments[1] === "new" ? "projectCreate" : "projectDetail");
        return;
    }
    if (slug === "skills" && segments[2] === "edit") {
        warm("skillWorkbench");
        return;
    }
    if (slug === "plugins" && segments[1] === "eagle") {
        warm("eagleLibrary");
        return;
    }
    if (slug === "toolbox") {
        if (segments[1] === "image") warm("imageWorkbench");
        if (segments[1] === "video") warm("videoWorkbench");
        return;
    }
    const key = workspaceRouteSlugs[slug];
    if (key) warm(key);
}
