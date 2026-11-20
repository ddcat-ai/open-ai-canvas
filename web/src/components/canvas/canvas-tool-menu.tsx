import type { ReactNode } from "react";
import { Check } from "lucide-react";

import "./canvas-tool-menu.css";

export function CanvasToolMenuOption({ icon, label, featured, checked, endIcon }: { icon: ReactNode; label: string; featured?: boolean; checked?: boolean; endIcon?: ReactNode }) {
    return (
        <span className="canvas-tool-menu-option">
            <span aria-hidden className={`canvas-tool-menu-icon${featured ? " is-featured" : ""}`}>
                {icon}
            </span>
            <span>{label}</span>
            {checked ? <Check aria-hidden className="canvas-tool-menu-check" /> : endIcon}
        </span>
    );
}

export function CanvasToolMenuSurface({ children, columns = 3, spreadGroup, className = "", description, detailEnd }: { children: ReactNode; columns?: number; spreadGroup?: boolean; className?: string; description: string; detailEnd?: ReactNode }) {
    return (
        <div className={`canvas-tool-menu ${className}`} data-columns={columns} data-spread-group={spreadGroup || undefined}>
            {children}
            <div className="canvas-tool-menu-detail" aria-hidden="true">
                <span>{description}</span>
                {detailEnd}
            </div>
        </div>
    );
}
