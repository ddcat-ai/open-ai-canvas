import { FolderKanban, Images, ListChecks, Maximize2 } from "lucide-react";

export const navigationTools = [
    {
        slug: "projects",
        label: "短剧创作",
        icon: FolderKanban,
    },
    {
        slug: "canvas",
        label: "画布",
        icon: Maximize2,
    },
    {
        slug: "tasks",
        label: "任务",
        icon: ListChecks,
    },
    {
        slug: "assets",
        label: "素材",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
