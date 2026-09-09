import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

// 根据视口宽度动态计算面板宽度约束，避免小屏幕上面板挤压画布
export function getPanelWidthBounds(): { min: number; max: number } {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    return panelWidthBoundsForViewport(vw);
}

export function panelWidthBoundsForViewport(vw: number): { min: number; max: number } {
    if (vw < 768) return { min: 260, max: 360 };
    if (vw < 1024) return { min: 280, max: 440 };
    if (vw < 1440) return { min: 320, max: 560 };
    return { min: 360, max: 760 };
}

// 悬浮面板承载宽度拖拽；窄屏改为带键盘焦点约束的抽屉。
export function AssistantPanelColumn({
    width,
    closing,
    topInset,
    onWidthChange,
    hidden = false,
    floating = false,
    children,
}: {
    width: number;
    closing: boolean;
    topInset: string;
    onWidthChange: (width: number) => void;
    hidden?: boolean;
    floating?: boolean;
    children: (resizing: boolean) => ReactNode;
}) {
    const columnRef = useRef<HTMLDivElement>(null);
    const [resizing, setResizing] = useState(false);
    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const panel = columnRef.current;
        const narrow = window.matchMedia("(max-width: 1023px)");
        const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [contenteditable="true"], [tabindex="0"]') || []).filter((element) => element.getClientRects().length > 0);
        if (narrow.matches) focusable()[0]?.focus();
        const trapFocus = (event: KeyboardEvent) => {
            if (!narrow.matches || event.key !== "Tab") return;
            const elements = focusable();
            const first = elements[0];
            const last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        panel?.addEventListener("keydown", trapFocus);
        return () => {
            panel?.removeEventListener("keydown", trapFocus);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);

    // 拖拽时列右边缘固定（flex 末位），左边缘随鼠标移动。
    const startResize = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        if (window.innerWidth < 1024) return;
        const rightEdge = columnRef.current?.getBoundingClientRect().right ?? 0;
        const { min, max } = getPanelWidthBounds();
        const move = (e: MouseEvent) => {
            onWidthChange(Math.min(max, Math.max(min, rightEdge - e.clientX)));
        };
        const stop = () => {
            setResizing(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", stop);
        };
        setResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", stop);
    }, [onWidthChange]);

    return (
        <div
            ref={columnRef}
            className="canvas-assistant-panel-column flex overflow-hidden"
            data-floating={floating || undefined}
            aria-hidden={hidden || undefined}
            style={{
                width,
                "--canvas-agent-width": `${width}px`,
                paddingTop: topInset,
                transition: resizing ? "none" : "width var(--motion-dur-base-calc) var(--motion-ease-out), padding-top var(--motion-dur-base-calc) var(--motion-ease-out)",
            } as CSSProperties}
        >
            <div className="h-full w-full">
                {!closing ? (
                    <button
                        type="button"
                        className="absolute inset-y-0 left-0 z-[var(--node-z-overlay)] w-4 -translate-x-1/2 cursor-col-resize"
                        onMouseDown={startResize}
                        aria-label="调整右侧面板宽度"
                    />
                ) : null}
                {children(resizing)}
            </div>
        </div>
    );
}
