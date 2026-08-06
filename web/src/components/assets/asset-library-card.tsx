import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 资产库卡片的共同外壳；页面只负责业务动作和卡片内的信息层级。 */
export function AssetLibraryCard({ children, className, selected = false }: { children: ReactNode; className?: string; selected?: boolean }) {
    return <article className={cn("library-card library-card-surface asset-library-card group", selected && "is-selected", className)}>{children}</article>;
}

export function AssetLibraryCardMedia({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn("library-card-media", className)}>{children}</div>;
}
