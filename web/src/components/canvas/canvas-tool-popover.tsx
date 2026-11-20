import { useState, type ReactNode } from "react";
import { Popover, type PopoverProps } from "antd";
import { usePopoverAnchorAlign } from "@/hooks/use-popover-anchor-align";

/** 浮层与视口边缘的最小间距；AntD 的 shift 只会贴边，因此用外层透明内边距留出。 */
const TOOL_POPOVER_VIEWPORT_GAP = 12;

/** 搜索、筛选和预览卡片持续跟随锚点，定位、翻转与边缘避让由 AntD 完成。 */
export function CanvasToolPopover({ open, onOpenChange, content, label, ...props }: Pick<PopoverProps, "children" | "open" | "onOpenChange" | "trigger" | "autoAdjustOverflow"> & { content: ReactNode; label: string }) {
    const [internalOpen, setInternalOpen] = useState(false);
    const actualOpen = open ?? internalOpen;
    const popoverRef = usePopoverAnchorAlign(actualOpen);
    const change = (next: boolean) => {
        setInternalOpen(next);
        onOpenChange?.(next);
    };
    return (
        <Popover
            placement="bottomLeft"
            trigger="click"
            {...props}
            ref={popoverRef}
            open={actualOpen}
            onOpenChange={change}
            arrow={false}
            getPopupContainer={() => document.body}
            // align.overflow 会整体替换内置档位，必须同时写 adjust（空间不足时翻转）与 shift（贴边平移）。
            align={{ offset: [0, 0], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
            // 外层内边距不接收指针，点击它等同点击浮层外部。
            styles={{ root: { padding: TOOL_POPOVER_VIEWPORT_GAP, pointerEvents: "none" }, container: { padding: 0, background: "transparent", boxShadow: "none", pointerEvents: "auto" } }}
            content={
                <div
                    role="dialog"
                    aria-label={label}
                    className="thin-scrollbar overflow-auto overscroll-contain"
                    data-canvas-wheel-scroll
                    style={{ maxWidth: `calc(100vw - ${TOOL_POPOVER_VIEWPORT_GAP * 2}px)`, maxHeight: "calc(100dvh - 32px)" }}
                    onKeyDownCapture={(event) => {
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        change(false);
                        popoverRef.current?.nativeElement?.focus();
                    }}
                >
                    {content}
                </div>
            }
        />
    );
}
