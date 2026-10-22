import { useLayoutEffect, useRef, type ComponentRef } from "react";
import type { Popover } from "antd";
import { observeMovablePopupAnchor } from "@/lib/movable-popup-anchor";

/** 通知 AntD 对齐移动容器中的锚点；坐标计算与边缘避让仍由 Popover 负责。 */
export function usePopoverAnchorAlign(open: boolean) {
    const popoverRef = useRef<ComponentRef<typeof Popover>>(null);

    useLayoutEffect(() => {
        if (!open) return;
        const anchor = popoverRef.current?.nativeElement;
        if (!anchor) return;

        // 拖拽、缩放预览和尺寸动画会直接更新容器 style，不一定触发 React 渲染。
        // 节点自身、世界层和嵌套浮层都可能移动。仅观察祖先本身，避免
        // Portal 内的定位样式反过来触发重复对齐。
        return observeMovablePopupAnchor(anchor, () => popoverRef.current?.forceAlign());
    }, [open]);

    return popoverRef;
}
