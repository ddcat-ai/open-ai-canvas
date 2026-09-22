import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeName } from "@/stores/use-theme-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useLayoutEffect } from "react";
import { DEFAULT_CANVAS_COLOR_THEME } from "@/lib/canvas-theme";

type CanvasThemeStore = { theme: ThemeName; active: boolean; setTheme: (theme: ThemeName) => void };

/** 画布外观是编辑器状态，不能写入用户工作台的全局主题。 */
export const useCanvasThemeStore = create<CanvasThemeStore>()(
    persist(
        (set) => ({ theme: DEFAULT_CANVAS_COLOR_THEME, active: false, setTheme: (theme) => { if (theme === "light" || theme === "dark") set({ theme }); } }),
        {
            name: "infinite-canvas:canvas-theme",
            partialize: ({ theme }) => ({ theme }),
            merge: (persisted, current) => {
                const theme = (persisted as Partial<CanvasThemeStore> | null)?.theme;
                return { ...current, theme: theme === "light" || theme === "dark" ? theme : DEFAULT_CANVAS_COLOR_THEME };
            },
        },
    ),
);

/** 编辑器卸载后自动恢复工作台的主题偏好；包括 body 上的 AntD 浮层。 */
export function useCanvasThemeScope() {
    useLayoutEffect(() => {
        useCanvasThemeStore.setState({ active: true });
        return () => { useCanvasThemeStore.setState({ active: false }); };
    }, []);
}

export function useActiveTheme() {
    const workspaceTheme = useThemeStore((state) => state.theme);
    const canvasTheme = useCanvasThemeStore((state) => state.theme);
    const active = useCanvasThemeStore((state) => state.active);
    return active ? canvasTheme : workspaceTheme;
}
