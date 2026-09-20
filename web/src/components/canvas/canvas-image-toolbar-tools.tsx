import { isValidElement, type ReactNode } from "react";
import { Brush, Camera, Clapperboard, Contrast, Copy, FastForward, FileText, Globe2, Grid2x2, Grid3x3, Layers3, Lock, LockOpen, Maximize2, Package, PencilLine, PersonStanding, Crop, Rewind, ScanFace, SlidersHorizontal, Smile, Sun, Upload, Scaling, WandSparkles } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import type { NodeToolbarGroup } from "@/lib/canvas/tool-registry";

type ImageNodeActionToolId = "copyPrompt" | "reversePrompt" | "replace" | "resize" | "annotation" | "annotationEdit" | "textEdit" | "maskEdit" | "removeBackground" | "layerDecomposition" | "emotion" | "portraitTexture" | "crop" | "split" | "upscale" | "superResolve" | "angle" | "lighting" | "panorama" | "view" | "multi_camera_nine_grid" | "story_pitch_four_grid" | "character_face_three_view" | "product_three_view" | "storyboard_25_grid" | "character_three_view_generation" | "cinematic_light_correction" | "image_projection_after_3s" | "image_projection_before_5s";

type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onAnnotate: (node: CanvasNodeData) => void;
    onAnnotationEdit: (node: CanvasNodeData) => void;
    onTextEdit: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onRemoveBackground: (node: CanvasNodeData) => void;
    onLayerDecomposition: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onLighting: (node: CanvasNodeData) => void;
    onPanorama: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onNineGrid: (node: CanvasNodeData, toolId: number, label: string, icon: string) => void;
};

type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    label: string | ((node: CanvasNodeData) => string);
    icon: (node: CanvasNodeData) => ReactNode;
    group: NodeToolbarGroup;
    order: number;
    section?: string;
    description?: string;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers, tool: ImageToolDefinition) => void;
    /** 仅 group === "nine_grid" 时使用，对应后端工具 ID */
    toolId?: number;
};

/** lucide 组件把 PascalCase 图标名写入 displayName，从 icon 渲染结果反查图标名，未命中时回退 Grid3x3。 */
function resolveToolIconName(tool: ImageToolDefinition, node: CanvasNodeData) {
    const element = tool.icon(node);
    const icon_type = isValidElement(element) ? element.type : null;
    const name = icon_type && typeof icon_type !== "string" ? (icon_type as { displayName?: string }).displayName : undefined;
    return name || "Grid3x3";
}

/** 九宫格工具共用行为：run 收到自身定义后直接取 toolId/label，图标名从 icon 反查。 */
function nineGridRun(node: CanvasNodeData, handlers: ImageToolHandlers, tool: ImageToolDefinition) {
    if (tool.toolId == null) return;
    handlers.onNineGrid(node, tool.toolId, resolveToolText(tool.label, node), resolveToolIconName(tool, node));
}

const imageToolDefinitions: ImageToolDefinition[] = [
    {
        id: "copyPrompt",
        section: "生成信息",
        label: "复制提示词",
        icon: () => <Copy className="size-3.5" />,
        group: "more",
        order: 50,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        section: "生成信息",
        label: "反推提示词",
        icon: () => <FileText className="size-3.5" />,
        group: "more",
        order: 60,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "replace",
        label: "替换图片",
        icon: () => <Upload className="size-3.5" />,
        group: "more",
        section: "素材",
        order: 45,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "resize",
        label: "锁定宽高比",
        section: "节点管理",
        active: (node) => !node.metadata?.freeResize,
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />),
        group: "more",
        order: 70,
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
    {
        id: "annotation",
        section: "拆分与标记",
        description: "添加标记，另存为新图片",
        label: "标注",
        icon: () => <PencilLine className="size-3.5" />,
        group: "process",
        order: 40,
        run: (node, handlers) => handlers.onAnnotate(node),
    },
    {
        id: "annotationEdit",
        section: "拆分与标记",
        description: "用画笔标记区域并让模型按标记修改",
        label: "标注编辑",
        icon: () => <Brush className="size-3.5" />,
        group: "process",
        order: 45,
        run: (node, handlers) => handlers.onAnnotationEdit(node),
    },
    {
        id: "maskEdit",
        label: "局部重绘",
        description: "涂抹要修改的区域，生成新图片",
        icon: () => <Brush className="size-3.5" />,
        group: "primary",
        order: 10,
        run: (node, handlers) => handlers.onMaskEdit(node),
    },
    {
        id: "textEdit",
        label: "文字编辑",
        description: "识别图片中的文字并逐行修改",
        icon: () => <FileText className="size-3.5" />,
        group: "primary",
        order: 15,
        run: (node, handlers) => handlers.onTextEdit(node),
    },
    {
        id: "removeBackground",
        label: "去除背景",
        description: "保留主体并生成透明背景图片",
        icon: () => <WandSparkles className="size-3.5" />,
        group: "process",
        order: 50,
        run: (node, handlers) => handlers.onRemoveBackground(node),
    },
    {
        id: "layerDecomposition",
        label: "AI 图层拆分",
        description: "识别并拆分为多个可独立编辑的图片图层",
        icon: () => <Layers3 className="size-3.5" />,
        group: "process",
        order: 55,
        run: (node, handlers) => handlers.onLayerDecomposition(node),
    },
    {
        id: "emotion",
        label: "表情调整",
        section: "人像调整",
        description: "调整人物表情，生成新图片",
        icon: () => <Smile className="size-3.5" />,
        group: "portrait",
        order: 50,
        run: (node, handlers) => handlers.onEmotion(node),
    },
    {
        id: "portraitTexture",
        label: "质感调整",
        section: "人像调整",
        description: "设置肤质、光影与融合，再执行生成",
        icon: () => <SlidersHorizontal className="size-3.5" />,
        group: "portrait",
        order: 60,
        run: (node, handlers) => handlers.onPortraitTexture(node),
    },
    {
        id: "crop",
        label: "裁剪",
        section: "构图与尺寸",
        description: "保留所选区域，生成新图片",
        icon: () => <Crop className="size-3.5" />,
        group: "process",
        order: 10,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "split",
        label: "宫格切分",
        section: "拆分与标记",
        description: "按行列拆成多个图片节点",
        icon: () => <Grid2x2 className="size-3.5" />,
        group: "process",
        order: 45,
        run: () => undefined,
    },
    {
        id: "upscale",
        label: "调整尺寸",
        section: "构图与尺寸",
        description: "插值放大像素尺寸，不是 AI 超分",
        icon: () => <Scaling className="size-3.5" />,
        group: "process",
        order: 20,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "angle",
        label: "多角度",
        section: "视角",
        description: "调整摄影机角度，生成新视角",
        icon: () => <Camera className="size-3.5" />,
        group: "viewpoint",
        order: 20,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "lighting",
        label: "打光",
        section: "视角",
        description: "调整光线方向、亮度与光效，生成新图片",
        icon: () => <Sun className="size-3.5" />,
        group: "lighting",
        order: 30,
        run: (node, handlers) => handlers.onLighting(node),
    },
    {
        id: "view",
        label: "预览",
        icon: () => <Maximize2 className="size-3.5" />,
        group: "utility",
        order: 10,
        run: (node, handlers) => handlers.onViewImage(node),
    },
    {
        id: "panorama",
        label: "全景图",
        section: "视角",
        description: "基于该图片创建 360° 全景查看节点",
        icon: () => <Globe2 className="size-3.5" />,
        group: "panorama",
        order: 80,
        run: (node, handlers) => handlers.onPanorama(node),
    },
    // 九宫格工具组——对应后端 nine_grid 种子数据
    {
        id: "multi_camera_nine_grid",
        label: "多机位九宫格",
        section: "宫格生成",
        description: "生成 3x3 多机位联系表",
        icon: () => <Grid3x3 className="size-3.5" />,
        group: "nine_grid",
        order: 10,
        toolId: 79,
        run: nineGridRun,
    },
    {
        id: "story_pitch_four_grid",
        label: "剧情推演四宫格",
        section: "宫格生成",
        description: "生成 2x2 剧情推演联系表",
        icon: () => <Grid2x2 className="size-3.5" />,
        group: "nine_grid",
        order: 20,
        toolId: 80,
        run: nineGridRun,
    },
    {
        id: "character_face_three_view",
        label: "角色脸部三视图",
        section: "设定图",
        description: "生成 3x2 角色脸部联系表",
        icon: () => <ScanFace className="size-3.5" />,
        group: "nine_grid",
        order: 30,
        toolId: 81,
        run: nineGridRun,
    },
    {
        id: "product_three_view",
        label: "产品三视图",
        section: "设定图",
        description: "生成 3x2 产品联系表",
        icon: () => <Package className="size-3.5" />,
        group: "nine_grid",
        order: 40,
        toolId: 82,
        run: nineGridRun,
    },
    {
        id: "storyboard_25_grid",
        label: "25宫格连贯分镜",
        section: "宫格生成",
        description: "生成 5x5 连贯分镜联系表",
        icon: () => <Clapperboard className="size-3.5" />,
        group: "nine_grid",
        order: 50,
        toolId: 83,
        run: nineGridRun,
    },
    {
        id: "character_three_view_generation",
        label: "角色三视图",
        section: "设定图",
        description: "生成 16:9 角色三视图联系表",
        icon: () => <PersonStanding className="size-3.5" />,
        group: "nine_grid",
        order: 60,
        toolId: 85,
        run: nineGridRun,
    },
    {
        id: "cinematic_light_correction",
        label: "电影级光影校正",
        section: "光影",
        description: "修正电影灯光，使场景更真实",
        icon: () => <Contrast className="size-3.5" />,
        group: "nine_grid",
        order: 70,
        toolId: 84,
        run: nineGridRun,
    },
    {
        id: "image_projection_after_3s",
        label: "画面推演-3秒后",
        section: "画面推演",
        description: "生成 3 秒后的画面帧",
        icon: () => <FastForward className="size-3.5" />,
        group: "nine_grid",
        order: 80,
        toolId: 86,
        run: nineGridRun,
    },
    {
        id: "image_projection_before_5s",
        label: "画面推演-5秒前",
        section: "画面推演",
        description: "生成 5 秒前的画面帧",
        icon: () => <Rewind className="size-3.5" />,
        group: "nine_grid",
        order: 90,
        toolId: 87,
        run: nineGridRun,
    },
];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers) {
    return imageToolDefinitions.map((tool) => ({
        id: tool.id,
        label: resolveToolText(tool.label, node),
        icon: tool.icon(node),
        group: tool.group,
        order: tool.order,
        section: tool.section,
        description: tool.description,
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers, tool),
    }));
}

function resolveToolText(value: string | ((node: CanvasNodeData) => string), node: CanvasNodeData) {
    return typeof value === "function" ? value(node) : value;
}

export type NineGridMenuItem = {
    id: string;
    label: string;
    section: string;
    description: string;
    toolId: number;
    toolIconName: string;
};

/** 从 imageToolDefinitions 中筛选 nine_grid 组，返回九宫格菜单项数据 */
export function getNineGridMenuItems(): NineGridMenuItem[] {
    return imageToolDefinitions
        .filter((tool) => tool.group === "nine_grid" && tool.toolId != null)
        .sort((a, b) => a.order - b.order)
        .map((tool) => ({
            id: tool.id,
            label: typeof tool.label === "function" ? tool.label({} as CanvasNodeData) : tool.label,
            section: tool.section || "常用操作",
            description: tool.description || "",
            toolId: tool.toolId!,
            toolIconName: resolveToolIconName(tool, {} as CanvasNodeData),
        }));
}
