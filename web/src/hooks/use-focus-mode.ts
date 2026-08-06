import { useCallback, useEffect, useState } from "react";

const FOCUS_MODE_KEY = "canvas-focus-mode-v2";
const SMALL_SCREEN_BREAKPOINT = 1024;

// 默认策略：小屏自动沉浸（不可在顶栏手动切换），宽屏由用户偏好决定。
// 用户手动切换后以持久化偏好为准，窗口缩放不再覆盖用户选择。
function readInitialPreference(): boolean {
    const stored = window.localStorage.getItem(FOCUS_MODE_KEY);
    if (stored !== null) return stored === "true";
    return window.innerWidth < SMALL_SCREEN_BREAKPOINT;
}

export function useFocusMode() {
    const [userPreference, setUserPreference] = useState<boolean>(readInitialPreference);
    const [smallScreen, setSmallScreen] = useState<boolean>(() => window.innerWidth < SMALL_SCREEN_BREAKPOINT);

    const focusMode = smallScreen || userPreference;

    useEffect(() => {
        const handleResize = () => setSmallScreen(window.innerWidth < SMALL_SCREEN_BREAKPOINT);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const persist = useCallback((next: boolean) => {
        setUserPreference(next);
        try {
            window.localStorage.setItem(FOCUS_MODE_KEY, String(next));
        } catch {
            // 忽略 localStorage 不可用场景，专注模式仍可在本次会话生效。
        }
    }, []);

    const enterFocusMode = useCallback(() => persist(true), [persist]);
    const exitFocusMode = useCallback(() => persist(false), [persist]);
    const toggleFocusMode = useCallback(() => persist(!(smallScreen || userPreference)), [persist, smallScreen, userPreference]);

    return {
        focusMode,
        enterFocusMode,
        exitFocusMode,
        toggleFocusMode,
    };
}
