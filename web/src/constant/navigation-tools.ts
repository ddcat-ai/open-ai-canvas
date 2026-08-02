import { BookOpenCheck, Coins, FolderKanban, Images, ListChecks, Maximize2, MessageSquarePlus, Settings2 } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: "创作",
        icon: MessageSquarePlus,
        section: "创作空间",
    },
    {
        slug: "projects",
        label: "短剧创作",
        icon: FolderKanban,
        section: "创作空间",
    },
    {
        slug: "canvas",
        label: "画布",
        icon: Maximize2,
        section: "创作空间",
    },
    {
        slug: "tasks",
        label: "任务",
        icon: ListChecks,
        section: "创作空间",
    },
    {
        slug: "assets",
        label: "素材",
        icon: Images,
        section: "创作空间",
    },
    {
        slug: "skills",
        label: "技能库",
        icon: BookOpenCheck,
        section: "工作台管理",
    },
    {
        slug: "wallet",
        label: "积分中心",
        icon: Coins,
        section: "工作台管理",
    },
    {
        slug: "settings",
        label: "设置",
        icon: Settings2,
        section: "工作台管理",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
