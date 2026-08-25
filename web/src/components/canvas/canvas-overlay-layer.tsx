import { createContext, useCallback, useContext, useMemo, useState, type MouseEventHandler, type PointerEventHandler, type ReactNode, type WheelEventHandler } from "react";

type CanvasOverlayLayerContextValue = {
    activeOverlayId: string | null;
    bringToFront: (overlayId: string) => void;
};

const CanvasOverlayLayerContext = createContext<CanvasOverlayLayerContextValue | null>(null);

export function CanvasOverlayLayerProvider({ children }: { children: ReactNode }) {
    const [activeOverlayId, setActiveOverlayId] = useState<string | null>(null);
    const bringToFront = useCallback((overlayId: string) => {
        setActiveOverlayId((current) => (current === overlayId ? current : overlayId));
    }, []);
    const value = useMemo(() => ({ activeOverlayId, bringToFront }), [activeOverlayId, bringToFront]);

    return <CanvasOverlayLayerContext.Provider value={value}>{children}</CanvasOverlayLayerContext.Provider>;
}

export function useCanvasOverlayLayer(overlayId: string, fallbackZIndex: string) {
    const context = useContext(CanvasOverlayLayerContext);
    const bringToFrontFromContext = context?.bringToFront;
    const bringToFront = useCallback(() => bringToFrontFromContext?.(overlayId), [bringToFrontFromContext, overlayId]);
    const zIndex = context?.activeOverlayId === overlayId ? "var(--z-canvas-overlay-active)" : fallbackZIndex;

    return { bringToFront, zIndex };
}

export function CanvasOverlayLayerContainer({
    overlayId,
    fallbackZIndex,
    className,
    children,
    onMouseDown,
    onPointerDown,
    onWheel,
}: {
    overlayId: string;
    fallbackZIndex: string;
    className?: string;
    children: ReactNode;
    onMouseDown?: MouseEventHandler<HTMLDivElement>;
    onPointerDown?: PointerEventHandler<HTMLDivElement>;
    onWheel?: WheelEventHandler<HTMLDivElement>;
}) {
    const { bringToFront, zIndex } = useCanvasOverlayLayer(overlayId, fallbackZIndex);

    return (
        <div data-canvas-no-zoom className={className} style={{ zIndex }} onPointerDownCapture={bringToFront} onFocusCapture={bringToFront} onMouseDown={onMouseDown} onPointerDown={onPointerDown} onWheel={onWheel}>
            {children}
        </div>
    );
}
