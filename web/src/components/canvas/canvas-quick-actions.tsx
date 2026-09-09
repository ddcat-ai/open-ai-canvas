import { Compass, Focus, HelpCircle, LayoutTemplate, Minus, Plus } from "lucide-react";
import type { CSSProperties } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasQuickActionsProps = {
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    onFitContent: () => void;
    onOpenShortcuts: () => void;
    onAutoArrange: () => void;
    scale: number;
    onScaleChange: (scale: number) => void;
};

/**
 * 画布左下角的视图快捷入口。它与底部主控制条分离，避免把低频视图动作
 * 混进缩放和历史操作，同时让小地图打开后仍能在同一块区域找到相关控制。
 */
export function CanvasQuickActions({ isMiniMapOpen, onToggleMiniMap, onFitContent, onOpenShortcuts, onAutoArrange, scale, onScaleChange }: CanvasQuickActionsProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const commitScale = (nextScale: number) => onScaleChange(Math.min(2, Math.max(0.05, nextScale)));

    return (
        <nav
            className={`canvas-quick-actions${isMiniMapOpen ? " is-map-open" : ""}`}
            data-canvas-no-zoom
            aria-label="画布视图快捷操作"
            style={{
                background: theme.surface.panel,
                borderColor: theme.surface.border,
                color: theme.node.text,
                "--canvas-quick-action-hover": theme.toolbar.itemHover,
                "--canvas-quick-action-active": theme.toolbar.activeBg,
                "--canvas-quick-action-active-text": theme.toolbar.activeText,
            } as CSSProperties}
        >
            <button type="button" className={isMiniMapOpen ? "is-active" : undefined} aria-label={isMiniMapOpen ? "关闭小地图" : "打开小地图"} aria-pressed={isMiniMapOpen} title={isMiniMapOpen ? "关闭小地图" : "打开小地图"} onClick={onToggleMiniMap}><Compass aria-hidden="true" /></button>
            <button type="button" aria-label="适应画布" title="适应画布" onClick={onFitContent}><Focus aria-hidden="true" /></button>
            <button type="button" aria-label="自动整理节点" title="自动整理节点" onClick={onAutoArrange}><LayoutTemplate aria-hidden="true" /></button>
            <button type="button" aria-label="缩小画布" title="缩小画布" onClick={() => commitScale(scale - 0.1)}><Minus aria-hidden="true" /></button>
            <button type="button" className="canvas-quick-actions-scale" aria-label={`当前缩放 ${Math.round(scale * 100)}%，点击恢复 100%`} title="恢复 100%" onClick={() => commitScale(1)}>{Math.round(scale * 100)}%</button>
            <button type="button" aria-label="放大画布" title="放大画布" onClick={() => commitScale(scale + 0.1)}><Plus aria-hidden="true" /></button>
            <button type="button" aria-label="画布快捷键" title="画布快捷键" onClick={onOpenShortcuts}><HelpCircle aria-hidden="true" /></button>
        </nav>
    );
}
