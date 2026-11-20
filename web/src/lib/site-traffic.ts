export const siteTrafficPageLabels = {
    inspirations: "灵感",
    create: "创作",
    canvas_list: "画布列表",
    canvas: "画布编辑器",
    assets: "素材",
    history: "历史记录",
    ecommerce: "电商 Agent",
    ecommerce_pipeline: "电商流水线",
    drama: "短剧",
    skills: "技能",
    referral: "推广中心",
    tools_image: "图片生成",
    tools_video: "视频生成",
} satisfies Record<string, string>;

export const siteTrafficActionLabels = {
    open_create: "进入创作",
    new_canvas: "新建画布",
    open_ecommerce: "进入电商",
    creation_submit_text: "提交文本创作",
    creation_submit_image: "提交图片创作",
    creation_submit_video: "提交视频创作",
    creation_submit_agent: "提交 Agent 创作",
} satisfies Record<string, string>;

export type SiteTrafficPage = keyof typeof siteTrafficPageLabels;
export type SiteTrafficAction = keyof typeof siteTrafficActionLabels;

/** 只返回固定页面键；原始路径、动态 ID 和分享 token 绝不作为统计维度。 */
export function resolveSiteTrafficPage(pathname: string): SiteTrafficPage | null {
    const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase() || "/";
    if (/^\/(admin|dev|__[^/]*)(\/|$)/.test(path) || path === "/test-voice-recording" || path === "/wallet" || path === "/ark-portrait/result") return null;
    if (/^\/projects\/[^/]+\/(?!e\/[^/]+$).+/.test(path)) return null;
    // 灵感嵌于创作页；保留登记键，但不把上游不存在的独立路由当作页面展示。
    if (path === "/" || path === "/create") return "create";
    if (path === "/canvas") return "canvas_list";
    if (/^\/canvas\/[^/]+$/.test(path)) return "canvas";
    if (path === "/assets") return "assets";
    if (path === "/tasks") return "history";
    if (path === "/ecommerce") return "ecommerce";
    if (/^\/projects(?:\/[^/]+(?:\/e\/[^/]+)?)?$/.test(path)) return "drama";
    if (/^\/skills(?:\/[^/]+\/edit)?$/.test(path)) return "skills";
    if (path === "/referral") return "referral";
    if (path === "/toolbox/image") return "tools_image";
    if (path === "/toolbox/video") return "tools_video";
    return null;
}
