import { useCallback, useEffect, useState } from "react";

const FOCUS_MODE_KEY = "canvas-focus-mode-v1";
const FORCED_FOCUS_BREAKPOINT = 1024;

function readInitialPreference(): boolean {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(FOCUS_MODE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return true;
}

export function useFocusMode() {
    const [userPreference, setUserPreference] = useState<boolean>(readInitialPreference);
    const [viewportWidth, setViewportWidth] = useState<number>(() => (typeof window !== "undefined" ? window.innerWidth : 1024));

    useEffect(() => {
        if (typeof window === "undefined") return;
        const handleResize = () => setViewportWidth(window.innerWidth);
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const forcedOn = viewportWidth < FORCED_FOCUS_BREAKPOINT;
    const focusMode = forcedOn || userPreference;

    const toggleFocusMode = useCallback(() => {
        setUserPreference((prev) => {
            const next = !prev;
            if (typeof window !== "undefined") {
                window.localStorage.setItem(FOCUS_MODE_KEY, next ? "1" : "0");
            }
            return next;
        });
    }, []);

    return {
        focusMode,
        userPreference,
        forcedOn,
        toggleFocusMode,
    };
}
