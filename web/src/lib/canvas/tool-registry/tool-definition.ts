import type { ReactNode } from "react";
import type { MouseEvent } from "react";

import type { CanvasAlignmentMode } from "@/lib/canvas/canvas-layout";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeType, CanvasToolMode, CanvasWorkspaceMode } from "@/types/canvas";

/** 工具栏标识——每个工具栏有独立的注册表与偏好 */
export type ToolbarId = "main" | "selection" | "node-hover" | "add-node-menu";

/** 工具分类——用于分组渲染、危险隔离与 separator 自动插入 */
export type ToolCategory =
    | "navigation"
    | "history"
    | "create"
    | "appearance"
    | "selection"
    | "layout"
    | "arrange"
    | "danger"
    | "node-state"
    | "resource";

/** 所有工具栏回调的聚合类型。工具定义通过 ctx.handlers.onXxx 访问 */
export type ToolbarHandlers = {
    // 主工具栏——画布操作
    onToolChange: (tool: CanvasToolMode) => void;
    onDeselect: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onClear: () => void;
    // 主工具栏——创建节点
    onAddText: () => void;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddScript: () => void;
    onAddFrame: () => void;
    onAddDrawing: () => void;
    onChooseStyle: () => void;
    onOpenDirector: () => void;
    // 主工具栏——资源
    onUpload: () => void;
    onOpenMyAssets: () => void;
    onOpenProjectCharacters: () => void;
    // 主工具栏——外观
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    // 主工具栏——面板开关（组件内部状态，由组件实现）
    onToggleAddPanel: (event: MouseEvent<HTMLElement>) => void;
    onToggleAppearancePanel: (event: MouseEvent<HTMLElement>) => void;
    onToggleSettingsPanel: () => void;
    // 主工具栏——删除选中
    onDeleteSelected: () => void;
    // 多选工具栏
    onAlign: (mode: CanvasAlignmentMode) => void;
    onArrange: (mode: "row" | "column" | "grid" | "flow") => void;
    onCreateStoryboard: () => void;
    onCreateReferenceGroup: () => void;
    onMergeVideos: () => void;
    // 节点悬停工具栏——节点操作（均接收当前节点）
    onNodeInfo: (node: CanvasNodeData) => void;
    onNodeDelete: (node: CanvasNodeData) => void;
    onNodeRetry: (node: CanvasNodeData) => void;
    onNodeEditText: (node: CanvasNodeData) => void;
    onNodeDecreaseFont: (node: CanvasNodeData) => void;
    onNodeIncreaseFont: (node: CanvasNodeData) => void;
    onNodeToggleDialog: (node: CanvasNodeData) => void;
    onNodeAnnotate: (node: CanvasNodeData) => void;
    onNodeGenerateImage: (node: CanvasNodeData) => void;
    onNodeUpload: (node: CanvasNodeData) => void;
    onNodeDownload: (node: CanvasNodeData) => void;
    onNodeSaveAsset: (node: CanvasNodeData) => void;
    onNodeMaskEdit: (node: CanvasNodeData) => void;
    onNodeEmotion: (node: CanvasNodeData) => void;
    onNodePortraitTexture: (node: CanvasNodeData) => void;
    onNodeCrop: (node: CanvasNodeData) => void;
    onNodeSplit: (node: CanvasNodeData) => void;
    onNodeUpscale: (node: CanvasNodeData) => void;
    onNodeSuperResolve: (node: CanvasNodeData) => void;
    onNodeAngle: (node: CanvasNodeData) => void;
    onNodeViewImage: (node: CanvasNodeData) => void;
    onNodeExtractVideoLastFrame: (node: CanvasNodeData) => void;
    onNodeReversePrompt: (node: CanvasNodeData) => void;
    onNodeToggleFreeResize: (node: CanvasNodeData) => void;
    onNodeToggleLocked: (node: CanvasNodeData) => void;
    onNodeCopyPrompt: (node: CanvasNodeData) => void;
};

/** 工具运行时可见的上下文。工具定义通过纯函数读取状态 */
export type ToolContext = {
    selectedCount: number;
    selectedNodeTypes: Set<CanvasNodeType>;
    selectedVideoCount: number;
    canvasTool: CanvasToolMode;
    workspaceMode: CanvasWorkspaceMode;
    isProjectLinked: boolean;
    canUndo: boolean;
    canRedo: boolean;
    /** 节点悬停工具栏专用——当前悬停/选中的节点 */
    node?: CanvasNodeData;
    /** 便捷访问 node.metadata（node 为空时为 undefined） */
    nodeMetadata?: CanvasNodeMetadata;
    /** 视频尾帧提取中（节点悬停工具栏用） */
    extractingVideoFrame: boolean;
    /** 合并视频中（多选工具栏用） */
    mergingVideos: boolean;
    /** 主工具栏面板开关状态（仅主工具栏使用） */
    addPanelOpen: boolean;
    appearancePanelOpen: boolean;
    settingsPanelOpen: boolean;
    handlers: ToolbarHandlers;
};

/** 添加节点菜单只依赖创建动作，避免右键菜单为工具栏状态补无意义字段。 */
export type AddNodeMenuContext = {
    workspaceMode: CanvasWorkspaceMode;
    isProjectLinked: boolean;
    handlers: Pick<ToolbarHandlers,
        | "onAddText"
        | "onAddImage"
        | "onAddVideo"
        | "onAddAudio"
        | "onAddScript"
        | "onAddFrame"
        | "onAddDrawing"
        | "onChooseStyle"
        | "onOpenDirector"
        | "onUpload"
        | "onOpenMyAssets"
        | "onOpenProjectCharacters"
    >;
};

/** 工具定义——注册表的基本单元 */
export type ToolDefinition = {
    id: string;
    toolbar: ToolbarId;
    category: ToolCategory;
    label: string | ((ctx: ToolContext) => string);
    /** Dock 标签模式下的短文案，缺省用 label */
    displayLabel?: string | ((ctx: ToolContext) => string);
    icon: ReactNode | ((ctx: ToolContext) => ReactNode);
    /** 用户默认可见（可被 prefs 覆盖） */
    defaultVisible: boolean;
    /** 默认排序权重，升序 */
    defaultOrder: number;
    active?: (ctx: ToolContext) => boolean;
    disabled?: (ctx: ToolContext) => boolean;
    /** 危险操作——渲染时隔离到独立分组 */
    danger?: boolean;
    /** 面板展开型工具——使用 aria-expanded 而非 aria-pressed */
    expands?: boolean;
    /** 上下文可见性谓词——返回 false 时工具不渲染（不受 prefs 控制） */
    applicable?: (ctx: ToolContext) => boolean;
    /** 执行动作。event 来自 Dock 按钮点击 */
    run: (ctx: ToolContext, event?: MouseEvent<HTMLElement>) => void;
};

/** 添加节点菜单命令：项目级动作与真正的节点创建分开呈现。 */
export type AddNodeMenuCommand = {
    id: string;
    label: string;
    icon: ReactNode;
    badge?: string;
    section: "node" | "project" | "resource";
    defaultOrder: number;
    applicable?: (ctx: AddNodeMenuContext) => boolean;
    run: (ctx: AddNodeMenuContext) => void;
};

/** 用户偏好——排序与显隐 */
export type ToolbarPrefs = {
    /** 工具 id 按显示顺序排列 */
    order: string[];
    /** 用户隐藏的工具 id */
    hidden: string[];
};
