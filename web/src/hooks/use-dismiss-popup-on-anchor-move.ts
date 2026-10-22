import { useLayoutEffect, useRef, type RefObject } from "react";
import { observeMovablePopupAnchor } from "@/lib/movable-popup-anchor";

type PopupAnchor = HTMLElement | { nativeElement: HTMLElement };

/** Dropdown / Select 没有公开 forceAlign；移动锚点时通过原生 open 状态收起菜单。 */
export function useDismissPopupOnAnchorMove(open: boolean, anchorRef: RefObject<PopupAnchor | null>, onDismiss: () => void) {
    const dismissRef = useRef(onDismiss);
    useLayoutEffect(() => {
        dismissRef.current = onDismiss;
    });
    useLayoutEffect(() => {
        if (!open) return;
        const value = anchorRef.current;
        const anchor = value instanceof HTMLElement ? value : value?.nativeElement;
        if (!anchor) return;
        let dismissed = false;
        return observeMovablePopupAnchor(anchor, () => {
            if (dismissed) return;
            dismissed = true;
            dismissRef.current();
        });
    }, [open, anchorRef]);
}
