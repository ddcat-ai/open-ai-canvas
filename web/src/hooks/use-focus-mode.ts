import { useCallback, useEffect, useState } from "react";

const FOCUS_MODE_KEY = "canvas-focus-mode-v2";
const SMALL_SCREEN_BREAKPOINT = 1024;

// 未设置偏好时随窗口大小选择默认模式；明确选择后，缩放和刷新都保留该选择。
function readInitialPreference(): boolean | null {
    try {
        const stored = window.localStorage.getItem(FOCUS_MODE_KEY);
        return stored === "true" ? true : stored === "false" ? false : null;
    } catch {
        return null;
    }
}

export function useFocusMode() {
    const [userPreference, setUserPreference] = useState<boolean | null>(readInitialPreference);
    const [smallScreen, setSmallScreen] = useState<boolean>(() => window.innerWidth < SMALL_SCREEN_BREAKPOINT);

    const focusMode = userPreference ?? smallScreen;

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
    const toggleFocusMode = useCallback(() => persist(!focusMode), [persist, focusMode]);

    return {
        focusMode,
        enterFocusMode,
        exitFocusMode,
        toggleFocusMode,
    };
}
