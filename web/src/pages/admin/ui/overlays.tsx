import { Drawer, Modal, type DrawerProps, type ModalProps } from "antd";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type AdminDrawerProps = DrawerProps & {
    flush?: boolean;
};

export type AdminModalProps = ModalProps & {
    flush?: boolean;
};

const MODAL_FLUSH_STYLES = {
    container: { padding: 0, overflow: "hidden" as const },
    body: { padding: 0 },
};

function mergeFlushStyles(resolved: unknown, flush: boolean, kind: "drawer" | "modal") {
    const base = resolved && typeof resolved === "object" ? (resolved as Record<string, unknown>) : {};
    if (!flush) return base;
    const body = base.body && typeof base.body === "object" ? (base.body as CSSProperties) : {};
    if (kind === "drawer") return { ...base, body: { ...body, padding: 0 } };
    const container = base.container && typeof base.container === "object" ? (base.container as CSSProperties) : {};
    return {
        ...base,
        container: { ...container, ...MODAL_FLUSH_STYLES.container },
        body: { ...body, ...MODAL_FLUSH_STYLES.body },
    };
}

export function AdminDrawer({ flush = false, destroyOnHidden = true, styles, className, rootClassName, ...props }: AdminDrawerProps) {
    const mergedStyles =
        typeof styles === "function"
            ? (info: { props: DrawerProps }) => mergeFlushStyles(styles(info), flush, "drawer")
            : mergeFlushStyles(styles, flush, "drawer");

    return <Drawer destroyOnHidden={destroyOnHidden} className={cn("admin-drawer-panel", className)} rootClassName={cn("admin-drawer", rootClassName)} {...props} styles={mergedStyles as DrawerProps["styles"]} />;
}

export function AdminModal({ flush = false, destroyOnHidden = true, styles, className, rootClassName, ...props }: AdminModalProps) {
    const mergedStyles =
        typeof styles === "function"
            ? (info: { props: ModalProps }) => mergeFlushStyles(styles(info), flush, "modal")
            : mergeFlushStyles(styles, flush, "modal");

    return <Modal destroyOnHidden={destroyOnHidden} className={cn("admin-modal-panel", className)} rootClassName={cn("admin-modal-root", rootClassName)} {...props} styles={mergedStyles as ModalProps["styles"]} />;
}
