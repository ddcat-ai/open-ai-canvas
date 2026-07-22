import type { RefObject } from "react";
import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignHorizontalSpaceAround, AlignHorizontalSpaceBetween, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalSpaceAround, AlignVerticalSpaceBetween, Film, FolderTree, Grid3X3, LayoutTemplate, LoaderCircle, Workflow } from "lucide-react";

import { CanvasSelectionToolbar } from "@/components/canvas/canvas-workspace-overlays";
import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasAlignmentMode } from "@/lib/canvas/canvas-layout";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasProjectSelectionToolbarProps = {
    anchorRef: RefObject<HTMLDivElement | null>;
    containerRef: RefObject<HTMLDivElement | null>;
    count: number;
    selectedVideoCount: number;
    mergingVideos: boolean;
    onAlign: (mode: CanvasAlignmentMode) => void;
    onArrange: (mode: "row" | "column" | "grid" | "flow") => void;
    onCreateStoryboard: () => void;
    onCreateReferenceGroup: () => void;
    onMergeVideos: () => void;
};

export function CanvasProjectSelectionToolbar({ anchorRef, containerRef, count, selectedVideoCount, mergingVideos, onAlign, onArrange, onCreateStoryboard, onCreateReferenceGroup, onMergeVideos }: CanvasProjectSelectionToolbarProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const items: FloatingDockEntry[] = [
        { id: "selection-align-left", label: "左对齐", icon: <AlignHorizontalJustifyStart />, onClick: () => onAlign("left") },
        { id: "selection-align-center-x", label: "水平居中", icon: <AlignHorizontalJustifyCenter />, onClick: () => onAlign("centerX") },
        { id: "selection-align-right", label: "右对齐", icon: <AlignHorizontalJustifyEnd />, onClick: () => onAlign("right") },
        { id: "selection-align-top", label: "顶对齐", icon: <AlignVerticalJustifyStart />, onClick: () => onAlign("top") },
        { id: "selection-align-center-y", label: "垂直居中", icon: <AlignVerticalJustifyCenter />, onClick: () => onAlign("centerY") },
        { id: "selection-align-bottom", label: "底对齐", icon: <AlignVerticalJustifyEnd />, onClick: () => onAlign("bottom") },
        { id: "selection-distribute-x", label: "水平等距", icon: <AlignHorizontalSpaceBetween />, disabled: count < 3, onClick: () => onAlign("distributeX") },
        { id: "selection-distribute-y", label: "垂直等距", icon: <AlignVerticalSpaceBetween />, disabled: count < 3, onClick: () => onAlign("distributeY") },
        { kind: "separator", id: "selection-arrange-separator" },
        { id: "selection-arrange-row", label: "横向排列", icon: <AlignHorizontalSpaceAround />, onClick: () => onArrange("row") },
        { id: "selection-arrange-column", label: "纵向排列", icon: <AlignVerticalSpaceAround />, onClick: () => onArrange("column") },
        { id: "selection-arrange-grid", label: "宫格排列", icon: <Grid3X3 />, onClick: () => onArrange("grid") },
        { id: "selection-arrange-flow", label: "按连线整理", icon: <Workflow />, onClick: () => onArrange("flow") },
        { kind: "separator", id: "selection-group-separator" },
        { id: "selection-create-storyboard", label: "创建分镜组", icon: <LayoutTemplate />, disabled: count < 2, onClick: onCreateStoryboard },
        { id: "selection-create-reference-group", label: "创建引用组", icon: <FolderTree />, disabled: count < 2, onClick: onCreateReferenceGroup },
        ...(selectedVideoCount >= 2 ? [{ id: "selection-merge-videos", label: `合并选中视频（${selectedVideoCount}）`, icon: mergingVideos ? <LoaderCircle className="animate-spin" /> : <Film />, disabled: mergingVideos, onClick: onMergeVideos }] : []),
    ];

    return (
        <CanvasSelectionToolbar anchorRef={anchorRef} containerRef={containerRef} count={count}>
            <FloatingDock items={items} size="compact" className="canvas-floating-dock" style={canvasDockStyle(theme)} ariaLabel="多选节点布局工具" />
        </CanvasSelectionToolbar>
    );
}
