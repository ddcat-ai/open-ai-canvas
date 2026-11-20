const PAGE_TITLE_KEYS: Record<string, string> = {
    create: "nav.pageTitles.home",
    projects: "nav.pageTitles.projects",
    canvas: "nav.pageTitles.canvas",
    tasks: "nav.pageTitles.tasks",
    assets: "nav.pageTitles.assets",
    skills: "nav.pageTitles.skills",
    plugins: "nav.pageTitles.plugins",
    settings: "nav.pageTitles.settings",
    ecommerce: "nav.sidebar.ecommerce",
    referral: "shell.account.referral",
};
const TOOLBOX_TITLE_KEYS: Record<string, string> = {
    image: "nav.pageTitles.toolboxImage",
    video: "nav.pageTitles.toolboxVideo",
};

/** 工作台路由对应的页面名称文案键：顶栏面包屑和浏览器标签页标题共用。未知路由返回 undefined。 */
export function workspacePageTitleKey(pathname: string) {
    const [slug, subSlug] = pathname.split("/").filter(Boolean);
    if (!slug) return "nav.pageTitles.home";
    // /toolbox/image 和 /toolbox/video 共用 toolbox 首段，标题按第二段区分。
    return slug === "toolbox" ? TOOLBOX_TITLE_KEYS[subSlug ?? ""] : PAGE_TITLE_KEYS[slug];
}
