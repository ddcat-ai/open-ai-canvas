import { useCallback, useRef, useState, type ReactNode } from "react";

// 根据视口宽度动态计算面板宽度约束，避免小屏幕上面板挤压画布
export function getPanelWidthBounds(): { min: number; max: number } {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    if (vw < 768) return { min: 260, max: 360 };
    if (vw < 1024) return { min: 280, max: 440 };
    if (vw < 1440) return { min: 320, max: 560 };
    return { min: 360, max: 760 };
}

// 智能体面板列包裹器：承载面板宽度管理、resize 拖拽和顶部停靠偏移。
// 面板始终作为 flex 子元素避让画布；topInset 用于避让绝对定位的顶部栏（沉浸专注时顶部栏隐藏，传 0）。
// closing 期间保持宽度和渲染，让面板播放滑出动画；动画结束后由父组件卸载列。
export function AssistantPanelColumn({
    width,
    closing,
    topInset,
    onWidthChange,
    children,
}: {
    width: number;
    closing: boolean;
    topInset: string;
    onWidthChange: (width: number) => void;
    children: (resizing: boolean) => ReactNode;
}) {
    const columnRef = useRef<HTMLDivElement>(null);
    const [resizing, setResizing] = useState(false);

    // 拖拽时列右边缘固定（flex 末位），左边缘随鼠标移动。
    const startResize = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
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
            className="relative flex shrink-0 overflow-hidden"
            style={{
                width,
                paddingTop: topInset,
                transition: resizing ? "none" : "width var(--motion-dur-base-calc) var(--motion-ease-out), padding-top var(--motion-dur-base-calc) var(--motion-ease-out)",
            }}
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
