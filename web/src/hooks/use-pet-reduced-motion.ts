import { useSyncExternalStore } from "react";
const query = "(prefers-reduced-motion: reduce)";
const subscribe = (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
};
export function usePetReducedMotion() {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(query).matches,
        () => true,
    );
}
