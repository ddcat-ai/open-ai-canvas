// label 是中文源文案（用于搜索与兜底），界面显示用 labelKey 经 i18n 翻译。
import { Blocks, CircleDollarSign, Clapperboard, Images, LibraryBig, ListTodo, PanelsTopLeft, Settings, PenTool } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: "创作",
        labelKey: "nav.tools.create",
        icon: PenTool,
        section: "创作空间",
    },
    {
        slug: "projects",
        label: "短剧创作",
        labelKey: "nav.tools.projects",
        icon: Clapperboard,
        section: "创作空间",
    },
    {
        slug: "canvas",
        label: "画布",
        labelKey: "nav.tools.canvas",
        icon: PanelsTopLeft,
        section: "创作空间",
    },
    {
        slug: "tasks",
        label: "任务",
        labelKey: "nav.tools.tasks",
        icon: ListTodo,
        section: "创作空间",
    },
    {
        slug: "assets",
        label: "素材",
        labelKey: "nav.tools.assets",
        icon: Images,
        section: "创作空间",
    },
    {
        slug: "skills",
        label: "技能库",
        labelKey: "nav.tools.skills",
        icon: LibraryBig,
        section: "工作台管理",
    },
    {
        slug: "plugins",
        label: "插件中心",
        labelKey: "nav.tools.plugins",
        icon: Blocks,
        section: "工作台管理",
    },
    {
        slug: "wallet",
        label: "积分中心",
        labelKey: "nav.tools.wallet",
        icon: CircleDollarSign,
        section: "工作台管理",
    },
    {
        slug: "settings",
        label: "设置",
        labelKey: "nav.tools.settings",
        icon: Settings,
        section: "工作台管理",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
