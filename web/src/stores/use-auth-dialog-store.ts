import { create } from "zustand";

import type { AuthView } from "@/lib/auth-entry";

type AuthDialogStore = {
    open: boolean;
    view: AuthView;
    /** 登录成功后要进入的站内地址；为空表示留在当前页面。 */
    next: string | null;
    openDialog: (view?: AuthView, next?: string | null) => void;
    setView: (view: AuthView) => void;
    closeDialog: () => void;
};

/** 全局登录弹窗：任意页面都可以打开，由 AuthDialogHost 统一渲染。 */
export const useAuthDialogStore = create<AuthDialogStore>((set) => ({
    open: false,
    view: "login",
    next: null,
    openDialog: (view = "login", next = null) => set({ open: true, view, next }),
    setView: (view) => set({ view }),
    closeDialog: () => set({ open: false }),
}));
