import { useState, type ReactNode } from "react";
import { Popover, type PopoverProps } from "antd";
import { usePopoverAnchorAlign } from "@/hooks/use-popover-anchor-align";

/** 搜索、筛选和预览卡片持续跟随锚点，定位与边缘避让由 AntD 完成。 */
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
            align={{ offset: [0, 0], overflow: { shiftX: true, shiftY: true } }}
            styles={{ container: { padding: 0, background: "transparent", boxShadow: "none" } }}
            content={
                <div
                    role="dialog"
                    aria-label={label}
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
