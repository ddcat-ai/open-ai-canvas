import { scopedLocalStorage } from "@/lib/user-scope";

import type { ToolbarId, ToolbarPrefs } from "./tool-definition";

const STORAGE_VERSION = "v1";
const storageKey = (toolbar: ToolbarId) => `canvas-toolbar-prefs-${toolbar}-${STORAGE_VERSION}`;

/**
 * 读取工具栏偏好。缺失或解析失败时返回 null（由调用方决定是否用默认值）
 */
export function readToolbarPrefs(toolbar: ToolbarId): ToolbarPrefs | null {
    try {
        const stored = scopedLocalStorage.getItem(storageKey(toolbar));
        if (!stored) return null;
        const parsed = JSON.parse(stored) as unknown;
        if (!isPrefsShape(parsed)) return null;
        return { order: Array.isArray(parsed.order) ? parsed.order.filter((id) => typeof id === "string") : [], hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((id) => typeof id === "string") : [] };
    } catch {
        return null;
    }
}

export function persistToolbarPrefs(toolbar: ToolbarId, prefs: ToolbarPrefs) {
    try {
        scopedLocalStorage.setItem(storageKey(toolbar), JSON.stringify(prefs));
    } catch {
        // 浏览器禁用本地存储时保留当前会话内的选择
    }
}

export function clearToolbarPrefs(toolbar: ToolbarId) {
    try {
        scopedLocalStorage.removeItem(storageKey(toolbar));
    } catch {
        // 忽略
    }
}

function isPrefsShape(value: unknown): value is Partial<ToolbarPrefs> {
    return typeof value === "object" && value !== null;
}
