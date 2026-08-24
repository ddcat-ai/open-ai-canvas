import { Blocks, CircleDollarSign, Clapperboard, Images, LibraryBig, ListTodo, PanelsTopLeft, Settings, WandSparkles } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        labelKey: "domain:create",
        icon: WandSparkles,
        sectionKey: "domain:creation-space",
    },
    {
        slug: "projects",
        labelKey: "domain:short-drama-creation",
        icon: Clapperboard,
        sectionKey: "domain:creation-space",
    },
    {
        slug: "canvas",
        labelKey: "domain:canvas",
        icon: PanelsTopLeft,
        sectionKey: "domain:creation-space",
    },
    {
        slug: "tasks",
        labelKey: "domain:task-center",
        icon: ListTodo,
        sectionKey: "domain:creation-space",
    },
    {
        slug: "assets",
        labelKey: "domain:assets-2",
        icon: Images,
        sectionKey: "domain:creation-space",
    },
    {
        slug: "skills",
        labelKey: "domain:skill-library-2",
        icon: LibraryBig,
        sectionKey: "domain:workspace-management",
    },
    {
        slug: "plugins",
        labelKey: "domain:plugins-center",
        icon: Blocks,
        sectionKey: "domain:workspace-management",
    },
    {
        slug: "wallet",
        labelKey: "domain:credits-center",
        icon: CircleDollarSign,
        sectionKey: "domain:workspace-management",
    },
    {
        slug: "settings",
        labelKey: "domain:settings",
        icon: Settings,
        sectionKey: "domain:workspace-management",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
