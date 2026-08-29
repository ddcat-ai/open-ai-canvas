export const WORKSPACE_SIDEBAR_STORAGE_KEY = "infinite-canvas:workspace-sidebar-collapsed";

type WorkspaceSidebarStorage = Pick<Storage, "getItem" | "setItem">;

function workspaceSidebarStorage(storage?: WorkspaceSidebarStorage) {
    if (storage) return storage;
    if (typeof window === "undefined") return undefined;
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

export function readWorkspaceSidebarCollapsed(storage?: WorkspaceSidebarStorage) {
    try {
        return workspaceSidebarStorage(storage)?.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeWorkspaceSidebarCollapsed(collapsed: boolean, storage?: WorkspaceSidebarStorage) {
    try {
        workspaceSidebarStorage(storage)?.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
        // localStorage 不可用时保留当前内存状态，不能阻断侧栏交互。
    }
}
