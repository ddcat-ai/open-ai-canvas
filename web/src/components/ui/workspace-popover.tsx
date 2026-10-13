import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    content: ReactNode;
    children: ReactElement<{ "aria-expanded"?: boolean }>;
    placement?: "bottom" | "bottomLeft" | "bottomRight";
    rootClassName?: string;
    classNames?: { root?: string; container?: string; content?: string };
};

type Position = { left: number; top: number };

type Rect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

export function workspacePopoverPosition(anchor: Rect, popup: Rect, viewport: { width: number; height: number }, placement: Props["placement"] = "bottom"): Position {
    const left = placement === "bottomRight" ? anchor.right - popup.width : placement === "bottomLeft" ? anchor.left : anchor.left + (anchor.width - popup.width) / 2;
    const below = anchor.bottom + 6;
    const top = below + popup.height <= viewport.height - 8 ? below : anchor.top - popup.height - 6;
    return {
        left: Math.max(8, Math.min(left, viewport.width - popup.width - 8)),
        top: Math.max(8, Math.min(top, viewport.height - Math.min(popup.height, viewport.height - 16) - 8)),
    };
}

/** Menus share one body portal and one outside-click boundary, independent of AntD trigger state. */
export function WorkspacePopover({ open, onOpenChange, content, children, placement = "bottom", rootClassName, classNames }: Props) {
    const anchorRef = useRef<HTMLSpanElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<Position | null>(null);
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;

    useLayoutEffect(() => {
        if (!open) {
            setPosition(null);
            return;
        }
        const update = () => {
            const anchor = anchorRef.current?.getBoundingClientRect();
            const popup = popupRef.current?.getBoundingClientRect();
            if (!anchor || !popup) return;
            setPosition(workspacePopoverPosition(anchor, popup, { width: window.innerWidth, height: window.innerHeight }, placement));
        };
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && (anchorRef.current?.contains(event.target) || popupRef.current?.contains(event.target))) return;
            onOpenChangeRef.current(false);
        };
        const keyboard = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            onOpenChangeRef.current(false);
            anchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        };
        update();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        if (popupRef.current) observer?.observe(popupRef.current);
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", keyboard);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", keyboard);
        };
    }, [open, placement]);

    useLayoutEffect(() => {
        if (!open || !position) return;
        const bounds = popupRef.current?.getBoundingClientRect();
        if (bounds && (bounds.width === 0 || bounds.height === 0 || bounds.left >= window.innerWidth || bounds.top >= window.innerHeight)) {
            recordDiagnosticEvent({ category: "action", level: "warning", code: "workspace.popover_out_of_view", message: "工作台菜单未进入可视区域" });
        }
    }, [open, position]);

    return (
        <>
            <span ref={anchorRef} style={{ display: "inline-flex", minWidth: 0 }}>
                {cloneElement(children, { "aria-expanded": open })}
            </span>
            {open
                ? createPortal(
                      <div
                          ref={popupRef}
                          className={[rootClassName, classNames?.root].filter(Boolean).join(" ")}
                          data-workspace-popover
                          style={{
                              position: "fixed",
                              left: position?.left ?? 0,
                              top: position?.top ?? 0,
                              visibility: position ? "visible" : "hidden",
                              zIndex: "var(--z-popover, 200)",
                              maxWidth: "calc(100vw - 16px)",
                              maxHeight: "calc(100dvh - 16px)",
                              overflow: "auto",
                              background: "var(--user-surface-raised, var(--popover))",
                              color: "var(--user-ink, var(--popover-foreground))",
                              borderRadius: "var(--user-radius-card, 16px)",
                              boxShadow: "var(--elevation-overlay)",
                              padding: rootClassName === "workspace-account-popover" ? "var(--space-2)" : undefined,
                          }}
                      >
                          <div className={classNames?.container}>
                              <div className={classNames?.content}>{content}</div>
                          </div>
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}
