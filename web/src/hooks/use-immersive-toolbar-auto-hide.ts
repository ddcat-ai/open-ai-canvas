import { useEffect, useRef, useState, type RefObject } from "react";

import { createImmersiveToolbarAutoHideController } from "@/lib/canvas/immersive-toolbar-auto-hide";

type UseImmersiveToolbarAutoHideOptions = {
    enabled: boolean;
    suspended: boolean;
    surfaceRef: RefObject<HTMLElement | null>;
    onIdle: () => void;
};

export function useImmersiveToolbarAutoHide({ enabled, suspended, surfaceRef, onIdle }: UseImmersiveToolbarAutoHideOptions) {
    const [visible, setVisible] = useState(true);
    const onIdleRef = useRef(onIdle);
    onIdleRef.current = onIdle;

    const controllerRef = useRef<ReturnType<typeof createImmersiveToolbarAutoHideController> | null>(null);
    if (!controllerRef.current) {
        controllerRef.current = createImmersiveToolbarAutoHideController({
            onVisibilityChange: setVisible,
            onIdle: () => onIdleRef.current(),
        });
    }

    useEffect(() => {
        controllerRef.current?.setEnabled(enabled);
    }, [enabled]);

    useEffect(() => {
        controllerRef.current?.setSuspended(suspended);
    }, [suspended]);

    useEffect(() => {
        if (!enabled) return;
        const surface = surfaceRef.current;
        if (!surface) return;
        const reveal = () => controllerRef.current?.reveal();
        const revealFromKeyboard = (event: KeyboardEvent) => {
            if (event.key === "Tab" || event.key === "Escape" || (!event.metaKey && !event.ctrlKey && !event.altKey)) reveal();
        };

        surface.addEventListener("pointermove", reveal, { passive: true });
        surface.addEventListener("pointerdown", reveal, { passive: true });
        window.addEventListener("keydown", revealFromKeyboard, true);
        return () => {
            surface.removeEventListener("pointermove", reveal);
            surface.removeEventListener("pointerdown", reveal);
            window.removeEventListener("keydown", revealFromKeyboard, true);
        };
    }, [enabled, surfaceRef]);

    useEffect(() => () => controllerRef.current?.dispose(), []);

    return visible;
}
