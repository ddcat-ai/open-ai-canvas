import { BookOpenCheck, FolderKanban, Images, ListChecks, Maximize2 } from "lucide-react";

export const navigationTools = [
    {
        slug: "projects",
        label: "项目",
        icon: FolderKanban,
    },
    {
        slug: "canvas",
        label: "游离画布",
        icon: Maximize2,
    },
    {
        slug: "tasks",
        label: "任务中心",
        icon: ListChecks,
    },
    {
        slug: "assets",
        label: "我的素材",
        icon: Images,
    },
    {
        slug: "skills",
        label: "技能库大厅",
        icon: BookOpenCheck,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
