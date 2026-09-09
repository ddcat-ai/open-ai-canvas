import { Clock3, FolderOpen, PanelsTopLeft, Plus, Scissors } from "lucide-react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasProductionRailProps = {
    onAddNode: () => void;
    onOpenAssets: () => void;
    onUpload: () => void;
    onOpenTools: () => void;
};

export function CanvasProductionRail({ onAddNode, onOpenAssets, onUpload, onOpenTools }: CanvasProductionRailProps) {
    const navigate = useNavigate();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const items = [
        { label: "添加节点", icon: Plus, onClick: onAddNode, primary: true },
        { label: "素材库", icon: FolderOpen, onClick: onOpenAssets },
        { label: "导入媒体", icon: PanelsTopLeft, onClick: onUpload },
        { label: "生成任务", icon: Clock3, onClick: () => navigate("/tasks") },
        { label: "更多工具", icon: Scissors, onClick: onOpenTools },
    ];
    return (
        <nav className="canvas-production-rail" data-canvas-no-zoom style={{ background: theme.surface.panel, borderColor: theme.surface.border, color: theme.node.text, "--canvas-rail-primary": theme.accent.status, "--canvas-rail-primary-text": theme.accent.onPrimary } as CSSProperties} aria-label="画布快捷工具">
            {items.map(({ label, icon: Icon, onClick, primary }) => <button key={label} type="button" className={primary ? "is-primary" : undefined} onClick={onClick} aria-label={label} title={label}><Icon aria-hidden="true" /></button>)}
        </nav>
    );
}
