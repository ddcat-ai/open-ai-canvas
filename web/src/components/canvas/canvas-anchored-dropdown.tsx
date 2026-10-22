import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Dropdown, type DropdownProps } from "antd";
import { useDismissPopupOnAnchorMove } from "@/hooks/use-dismiss-popup-on-anchor-move";

/** 保留 AntD 菜单与键盘行为；父块移动时关闭一次性操作菜单。 */
export const CanvasAnchoredDropdown = forwardRef<HTMLElement, DropdownProps & { onAnchorMove?: () => void }>(function CanvasAnchoredDropdown({ open, onOpenChange, onAnchorMove, ...props }, ref) {
    const anchorRef = useRef<HTMLElement>(null);
    const [internalOpen, setInternalOpen] = useState(false);
    const actualOpen = open ?? internalOpen;
    useImperativeHandle(ref, () => anchorRef.current!);
    const change: NonNullable<DropdownProps["onOpenChange"]> = (next, info) => {
        setInternalOpen(next);
        onOpenChange?.(next, info);
    };
    useDismissPopupOnAnchorMove(actualOpen, anchorRef, () => {
        if (onAnchorMove) onAnchorMove();
        else change(false, { source: "trigger" });
    });
    return <Dropdown {...props} ref={anchorRef} open={actualOpen} onOpenChange={change} />;
});
