import { AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignHorizontalSpaceAround, AlignHorizontalSpaceBetween, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalSpaceAround, AlignVerticalSpaceBetween, Film, FolderTree, Grid3X3, LayoutTemplate, LoaderCircle, Workflow } from "lucide-react";

import { registerToolbarTools, type ToolDefinition } from "@/lib/canvas/tool-registry";

export const selectionToolbarTools: ToolDefinition[] = [
    // 对齐组
    { id: "selection-align-left", toolbar: "selection", category: "layout", label: "左对齐", icon: <AlignHorizontalJustifyStart />, defaultVisible: true, defaultOrder: 10, run: (ctx) => ctx.handlers.onAlign("left") },
    { id: "selection-align-center-x", toolbar: "selection", category: "layout", label: "水平居中", icon: <AlignHorizontalJustifyCenter />, defaultVisible: true, defaultOrder: 20, run: (ctx) => ctx.handlers.onAlign("centerX") },
    { id: "selection-align-right", toolbar: "selection", category: "layout", label: "右对齐", icon: <AlignHorizontalJustifyEnd />, defaultVisible: true, defaultOrder: 30, run: (ctx) => ctx.handlers.onAlign("right") },
    { id: "selection-align-top", toolbar: "selection", category: "layout", label: "顶对齐", icon: <AlignVerticalJustifyStart />, defaultVisible: true, defaultOrder: 40, run: (ctx) => ctx.handlers.onAlign("top") },
    { id: "selection-align-center-y", toolbar: "selection", category: "layout", label: "垂直居中", icon: <AlignVerticalJustifyCenter />, defaultVisible: true, defaultOrder: 50, run: (ctx) => ctx.handlers.onAlign("centerY") },
    { id: "selection-align-bottom", toolbar: "selection", category: "layout", label: "底对齐", icon: <AlignVerticalJustifyEnd />, defaultVisible: true, defaultOrder: 60, run: (ctx) => ctx.handlers.onAlign("bottom") },
    { id: "selection-distribute-x", toolbar: "selection", category: "layout", label: "水平等距", icon: <AlignHorizontalSpaceBetween />, defaultVisible: true, defaultOrder: 70, disabled: (ctx) => ctx.selectedCount < 3, run: (ctx) => ctx.handlers.onAlign("distributeX") },
    { id: "selection-distribute-y", toolbar: "selection", category: "layout", label: "垂直等距", icon: <AlignVerticalSpaceBetween />, defaultVisible: true, defaultOrder: 80, disabled: (ctx) => ctx.selectedCount < 3, run: (ctx) => ctx.handlers.onAlign("distributeY") },
    // 排列组
    { id: "selection-arrange-row", toolbar: "selection", category: "arrange", label: "横向排列", icon: <AlignHorizontalSpaceAround />, defaultVisible: true, defaultOrder: 90, run: (ctx) => ctx.handlers.onArrange("row") },
    { id: "selection-arrange-column", toolbar: "selection", category: "arrange", label: "纵向排列", icon: <AlignVerticalSpaceAround />, defaultVisible: true, defaultOrder: 100, run: (ctx) => ctx.handlers.onArrange("column") },
    { id: "selection-arrange-grid", toolbar: "selection", category: "arrange", label: "宫格排列", icon: <Grid3X3 />, defaultVisible: true, defaultOrder: 110, run: (ctx) => ctx.handlers.onArrange("grid") },
    { id: "selection-arrange-flow", toolbar: "selection", category: "arrange", label: "按连线整理", icon: <Workflow />, defaultVisible: true, defaultOrder: 120, run: (ctx) => ctx.handlers.onArrange("flow") },
    // 分组组
    { id: "selection-create-storyboard", toolbar: "selection", category: "selection", label: "创建分镜组", icon: <LayoutTemplate />, defaultVisible: true, defaultOrder: 130, disabled: (ctx) => ctx.selectedCount < 2, run: (ctx) => ctx.handlers.onCreateStoryboard() },
    { id: "selection-create-reference-group", toolbar: "selection", category: "selection", label: "创建引用组", icon: <FolderTree />, defaultVisible: true, defaultOrder: 140, disabled: (ctx) => ctx.selectedCount < 2, run: (ctx) => ctx.handlers.onCreateReferenceGroup() },
    {
        id: "selection-merge-videos",
        toolbar: "selection",
        category: "selection",
        label: (ctx) => `合并选中视频（${ctx.selectedVideoCount}）`,
        icon: (ctx) => ctx.mergingVideos ? <LoaderCircle className="animate-spin" /> : <Film />,
        defaultVisible: true,
        defaultOrder: 150,
        applicable: (ctx) => ctx.selectedVideoCount >= 2,
        disabled: (ctx) => ctx.mergingVideos,
        run: (ctx) => ctx.handlers.onMergeVideos(),
    },
];

registerToolbarTools(selectionToolbarTools);
