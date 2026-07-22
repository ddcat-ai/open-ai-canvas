import { BookOpenCheck, Images, ListChecks, Maximize2 } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
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
