import type { ComponentType } from "react";
import { Blocks, CircleDollarSign, Clapperboard, Home, Images, LibraryBig, ListTodo, PanelsTopLeft } from "lucide-react";

import type { PluginWorkbenchContribution } from "@/lib/plugins/plugin-types";
import { scopedLocalStorage } from "@/lib/user-scope";
import type { FeatureAvailability } from "@/stores/use-user-store";

export type WorkspaceSidebarGroupId = "primary" | "management";
export type WorkspaceSidebarDropPlacement = "before" | "after";
export type WorkspaceSidebarIcon = ComponentType<{ className?: string; strokeWidth?: number }>;
export type WorkspaceSidebarFeature = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "pluginCenterEnabled";

export type WorkspaceSidebarItem = {
    id: string;
    label: string;
    description: string;
    icon: WorkspaceSidebarIcon;
    iconName: string;
    route: string;
    group: WorkspaceSidebarGroupId;
    requiredFeature?: WorkspaceSidebarFeature;
};

export type WorkspaceSidebarLayout = {
    version: 1;
    order: string[];
    hidden: string[];
};

export const WORKSPACE_SIDEBAR_LAYOUT_STORAGE_KEY = "infinite-canvas:workspace-sidebar-layout";
export const WORKSPACE_SIDEBAR_LAYOUT_CHANGED_EVENT = "workspace:sidebar-layout-changed";

export const WORKSPACE_SIDEBAR_GROUPS: readonly { id: WorkspaceSidebarGroupId; label: string }[] = [
    { id: "primary", label: "主导航" },
    { id: "management", label: "工作台管理" },
];

/**
 * 工作台插件提供的是侧边栏入口。宿主只渲染受控的内部路由，
 * 不允许插件把任意页面脚本注入到工作区壳层。
 */
export const WORKSPACE_SIDEBAR_ITEMS: readonly WorkspaceSidebarItem[] = [
    { id: "home", label: "首页", description: "返回默认创作首页。", icon: Home, iconName: "home", route: "/", group: "primary" },
    { id: "projects", label: "短剧创作", description: "拆解故事、章节与分镜，推进完整制作流程。", icon: Clapperboard, iconName: "clapperboard", route: "/projects", group: "primary", requiredFeature: "shortDramaEnabled" },
    { id: "canvas", label: "画布", description: "把灵感、素材和生成结果放在同一块无限画布。", icon: PanelsTopLeft, iconName: "panels-top-left", route: "/canvas", group: "primary" },
    { id: "tasks", label: "任务", description: "查看生成进度、重试失败任务与下载结果。", icon: ListTodo, iconName: "list-todo", route: "/tasks", group: "primary", requiredFeature: "taskCenterEnabled" },
    { id: "assets", label: "素材", description: "集中管理图片、视频、音频和项目素材。", icon: Images, iconName: "images", route: "/assets", group: "primary" },
    { id: "skills", label: "技能库", description: "调用可复用的提示词、工作流与创作技能。", icon: LibraryBig, iconName: "library", route: "/skills", group: "management" },
    { id: "plugins", label: "插件中心", description: "启用外部连接器与可复用的工作台能力。", icon: Blocks, iconName: "blocks", route: "/plugins", group: "management", requiredFeature: "pluginCenterEnabled" },
    { id: "wallet", label: "积分中心", description: "查看余额、充值记录与消耗明细。", icon: CircleDollarSign, iconName: "circle-dollar-sign", route: "/wallet", group: "management", requiredFeature: "creditsEnabled" },
];

export function defaultWorkspaceSidebarLayout(items: readonly WorkspaceSidebarItem[] = WORKSPACE_SIDEBAR_ITEMS): WorkspaceSidebarLayout {
    return {
        version: 1,
        order: items.map((item) => item.id),
        hidden: [],
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeWorkspaceSidebarLayout(value: unknown, items: readonly WorkspaceSidebarItem[] = WORKSPACE_SIDEBAR_ITEMS): WorkspaceSidebarLayout {
    const fallback = defaultWorkspaceSidebarLayout(items);
    if (!isRecord(value)) return fallback;

    const itemIds = new Set(items.map((item) => item.id));
    const requestedOrder = stringArray(value.order).filter((id) => itemIds.has(id));
    const order = [...new Set([...requestedOrder, ...fallback.order])];
    const hidden = [...new Set(stringArray(value.hidden).filter((id) => itemIds.has(id)))];
    return { version: 1, order, hidden };
}

export function loadWorkspaceSidebarLayout() {
    if (typeof window === "undefined") return defaultWorkspaceSidebarLayout();
    try {
        const raw = scopedLocalStorage.getItem(WORKSPACE_SIDEBAR_LAYOUT_STORAGE_KEY);
        return raw ? normalizeWorkspaceSidebarLayout(JSON.parse(raw)) : defaultWorkspaceSidebarLayout();
    } catch {
        return defaultWorkspaceSidebarLayout();
    }
}

export function saveWorkspaceSidebarLayout(layout: WorkspaceSidebarLayout) {
    const normalized = normalizeWorkspaceSidebarLayout(layout);
    try {
        scopedLocalStorage.setItem(WORKSPACE_SIDEBAR_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        // 侧边栏布局是可恢复的界面偏好，存储不可用时仍保留当前会话状态。
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKSPACE_SIDEBAR_LAYOUT_CHANGED_EVENT));
}

export function resetWorkspaceSidebarLayout() {
    scopedLocalStorage.removeItem(WORKSPACE_SIDEBAR_LAYOUT_STORAGE_KEY);
    const layout = defaultWorkspaceSidebarLayout();
    if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKSPACE_SIDEBAR_LAYOUT_CHANGED_EVENT));
    return layout;
}

export function reorderWorkspaceSidebarLayout(
    layout: WorkspaceSidebarLayout,
    sourceId: string,
    targetId: string,
    placement: WorkspaceSidebarDropPlacement = "before",
): WorkspaceSidebarLayout {
    if (sourceId === targetId) return layout;
    const order = [...layout.order];
    const sourceIndex = order.indexOf(sourceId);
    const targetIndex = order.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return layout;
    order.splice(sourceIndex, 1);
    const insertionIndex = order.indexOf(targetId) + (placement === "after" ? 1 : 0);
    order.splice(insertionIndex, 0, sourceId);
    return { ...layout, order };
}

export function orderWorkspaceSidebarItems(items: readonly WorkspaceSidebarItem[], layout: WorkspaceSidebarLayout) {
    const order = new Map(layout.order.map((id, index) => [id, index]));
    return [...items].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

export function getAvailableWorkspaceSidebarItems(features: FeatureAvailability, isAdmin = false) {
    return WORKSPACE_SIDEBAR_ITEMS.filter((item) => (item.id === "plugins" && isAdmin) || !item.requiredFeature || features[item.requiredFeature]);
}

export function workbenchContributionFor(item: WorkspaceSidebarItem): PluginWorkbenchContribution {
    return {
        id: item.id,
        label: item.label,
        description: item.description,
        icon: item.iconName,
        route: item.route,
        kind: "entry",
        group: item.group,
    };
}

export const WORKBENCH_CONTRIBUTIONS = WORKSPACE_SIDEBAR_ITEMS.map(workbenchContributionFor);
