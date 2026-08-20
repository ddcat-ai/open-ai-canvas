import type { CanvasFolderTheme } from "@/types/canvas";

export const CANVAS_FOLDER_THEME_OPTIONS: ReadonlyArray<{
    key: CanvasFolderTheme;
    label: string;
    cover: string;
}> = [
    { key: "aurora", label: "赤蓝流光", cover: "/images/canvas/folder-default-cover.png" },
    { key: "obsidian", label: "曜石银蓝", cover: "/images/canvas/folder-theme-obsidian.png" },
    { key: "ember", label: "熔金赤焰", cover: "/images/canvas/folder-theme-ember.png" },
    { key: "pearl", label: "珍珠薄雾", cover: "/images/canvas/folder-theme-pearl.png" },
];

export function resolveCanvasFolderTheme(value?: string): CanvasFolderTheme {
    return CANVAS_FOLDER_THEME_OPTIONS.some((theme) => theme.key === value) ? (value as CanvasFolderTheme) : "aurora";
}

export function resolveCanvasFolderThemeCover(theme?: string, customCover?: string) {
    const custom = customCover?.trim();
    if (custom) return custom;
    const resolved = resolveCanvasFolderTheme(theme);
    return CANVAS_FOLDER_THEME_OPTIONS.find((item) => item.key === resolved)!.cover;
}
