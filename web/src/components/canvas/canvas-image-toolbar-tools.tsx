import { isValidElement, type ReactNode } from "react";
import {
    Brush,
    Camera,
    Clapperboard,
    Contrast,
    Copy,
    FastForward,
    FileText,
    Globe2,
    Grid2x2,
    Grid3x3,
    Layers3,
    Lock,
    LockOpen,
    Maximize2,
    Package,
    PencilLine,
    PersonStanding,
    Crop,
    Rewind,
    Route,
    ScanFace,
    SlidersHorizontal,
    Smile,
    SquareDashed,
    Sun,
    Upload,
    Scaling,
    Eraser,
} from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import type { NodeToolbarGroup } from "@/lib/canvas/tool-registry";
import { translate } from "@/i18n";

type ImageNodeActionToolId =
    | "copyPrompt"
    | "reversePrompt"
    | "replace"
    | "resize"
    | "annotation"
    | "annotationEdit"
    | "textEdit"
    | "regionEdit"
    | "removeBackground"
    | "layerDecomposition"
    | "emotion"
    | "portraitTexture"
    | "crop"
    | "split"
    | "upscale"
    | "superResolve"
    | "angle"
    | "lighting"
    | "panorama"
    | "view"
    | "previs"
    | "multi_camera_nine_grid"
    | "story_pitch_four_grid"
    | "short_storyboard"
    | "blocking_storyboard"
    | "character_face_three_view"
    | "product_three_view"
    | "storyboard_25_grid"
    | "character_three_view_generation"
    | "cinematic_light_correction"
    | "image_projection_after_3s"
    | "image_projection_before_5s";

type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onAnnotate: (node: CanvasNodeData) => void;
    onAnnotationEdit: (node: CanvasNodeData) => void;
    onTextEdit: (node: CanvasNodeData) => void;
    onRegionEdit: (node: CanvasNodeData) => void;
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
    onPrevis: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onNineGrid: (node: CanvasNodeData, toolId: number, label: string, icon: string) => void;
};

type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    /** 文案字段（label/section/description/placeholder）保存 i18n 键，读取时翻译。 */
    label: string | ((node: CanvasNodeData) => string);
    icon: (node: CanvasNodeData) => ReactNode;
    group: NodeToolbarGroup;
    order: number;
    section?: string;
    description?: string;
    placeholder?: string;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers, tool: ImageToolDefinition) => void;
    /** 后端 nine_grid 类型提示词工具 ID；工具条分组按用途决定，与后端类型无关。 */
    toolId?: number;
};

/** lucide 组件把 PascalCase 图标名写入 displayName，从 icon 渲染结果反查图标名，未命中时回退 Grid3x3。 */
function resolveToolIconName(tool: ImageToolDefinition, node: CanvasNodeData) {
    const element = tool.icon(node);
    const icon_type = isValidElement(element) ? element.type : null;
    const name = icon_type && typeof icon_type !== "string" ? (icon_type as { displayName?: string }).displayName : undefined;
    return name || "Grid3x3";
}

/** 后端 nine_grid 提示词工具共用行为：run 收到自身定义后直接取 toolId/label，图标名从 icon 反查。 */
function nineGridRun(node: CanvasNodeData, handlers: ImageToolHandlers, tool: ImageToolDefinition) {
    if (tool.toolId == null) return;
    handlers.onNineGrid(node, tool.toolId, resolveToolText(tool.label, node), resolveToolIconName(tool, node));
}

const imageToolDefinitions: ImageToolDefinition[] = [
    // 平铺：直接改当前图片的高频编辑
    {
        id: "regionEdit",
        label: "canvasB.imageTools.regionEditLabel",
        description: "canvasB.imageTools.regionEditDesc",
        icon: () => <SquareDashed className="size-3.5" />,
        group: "primary",
        order: 10,
        run: (node, handlers) => handlers.onRegionEdit(node),
    },
    {
        id: "textEdit",
        label: "canvasB.imageTools.textEditLabel",
        description: "canvasB.imageTools.textEditDesc",
        icon: () => <FileText className="size-3.5" />,
        group: "primary",
        order: 15,
        run: (node, handlers) => handlers.onTextEdit(node),
    },
    // 画面调整：保持镜头不变，用模型改人像、光影或主体
    {
        id: "emotion",
        label: "canvasB.imageTools.emotionLabel",
        section: "canvasB.imageTools.sectionPortrait",
        description: "canvasB.imageTools.emotionDesc",
        icon: () => <Smile className="size-3.5" />,
        group: "adjust",
        order: 10,
        run: (node, handlers) => handlers.onEmotion(node),
    },
    {
        id: "portraitTexture",
        label: "canvasB.imageTools.portraitTextureLabel",
        section: "canvasB.imageTools.sectionPortrait",
        description: "canvasB.imageTools.portraitTextureDesc",
        icon: () => <SlidersHorizontal className="size-3.5" />,
        group: "adjust",
        order: 20,
        run: (node, handlers) => handlers.onPortraitTexture(node),
    },
    {
        id: "lighting",
        label: "canvasB.imageTools.lightingLabel",
        section: "canvasB.imageTools.sectionLighting",
        description: "canvasB.imageTools.lightingDesc",
        icon: () => <Sun className="size-3.5" />,
        group: "adjust",
        order: 30,
        run: (node, handlers) => handlers.onLighting(node),
    },
    {
        id: "cinematic_light_correction",
        label: "canvasB.imageTools.cinematicLightLabel",
        section: "canvasB.imageTools.sectionLighting",
        description: "canvasB.imageTools.cinematicLightDesc",
        icon: () => <Contrast className="size-3.5" />,
        group: "adjust",
        order: 40,
        toolId: 84,
        run: nineGridRun,
    },
    {
        id: "removeBackground",
        label: "canvasB.imageTools.removeBackgroundLabel",
        section: "canvasB.imageTools.sectionSubject",
        description: "canvasB.imageTools.removeBackgroundDesc",
        icon: () => <Eraser className="size-3.5" />,
        group: "adjust",
        order: 50,
        run: (node, handlers) => handlers.onRemoveBackground(node),
    },
    {
        id: "layerDecomposition",
        label: "canvasB.imageTools.layerDecompositionLabel",
        section: "canvasB.imageTools.sectionSubject",
        description: "canvasB.imageTools.layerDecompositionDesc",
        icon: () => <Layers3 className="size-3.5" />,
        group: "adjust",
        order: 60,
        run: (node, handlers) => handlers.onLayerDecomposition(node),
    },
    // 镜头：换角度、换时间点或进入 3D 空间
    {
        id: "angle",
        label: "canvasB.imageTools.angleLabel",
        section: "canvasB.imageTools.sectionView",
        description: "canvasB.imageTools.angleDesc",
        icon: () => <Camera className="size-3.5" />,
        group: "camera",
        order: 10,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "panorama",
        label: "canvasB.imageTools.panoramaLabel",
        section: "canvasB.imageTools.sectionView",
        description: "canvasB.imageTools.panoramaDesc",
        icon: () => <Globe2 className="size-3.5" />,
        group: "camera",
        order: 20,
        run: (node, handlers) => handlers.onPanorama(node),
    },
    {
        id: "image_projection_before_5s",
        label: "canvasB.imageTools.projectionBeforeLabel",
        section: "canvasB.imageTools.sectionProjection",
        description: "canvasB.imageTools.projectionBeforeDesc",
        icon: () => <Rewind className="size-3.5" />,
        group: "camera",
        order: 30,
        toolId: 87,
        run: nineGridRun,
    },
    {
        id: "image_projection_after_3s",
        label: "canvasB.imageTools.projectionAfterLabel",
        section: "canvasB.imageTools.sectionProjection",
        description: "canvasB.imageTools.projectionAfterDesc",
        icon: () => <FastForward className="size-3.5" />,
        group: "camera",
        order: 40,
        toolId: 86,
        run: nineGridRun,
    },
    {
        id: "previs",
        label: "canvasB.imageTools.previsLabel",
        section: "canvasB.imageTools.sectionPrevis",
        description: "canvasB.imageTools.previsDesc",
        icon: () => <Layers3 className="size-3.5" />,
        group: "camera",
        order: 50,
        run: (node, handlers) => handlers.onPrevis(node),
    },
    // 宫格与设定图：输出多格联系表
    {
        id: "short_storyboard",
        label: "canvasB.imageTools.storyboardLabel",
        section: "canvasB.imageTools.sectionStoryboard",
        description: "canvasB.imageTools.storyboardDesc",
        placeholder: "canvasB.imageTools.storyboardPlaceholder",
        icon: () => <Clapperboard className="size-3.5" />,
        group: "sheet",
        order: 1,
        toolId: 1000090,
        run: nineGridRun,
    },
    {
        id: "blocking_storyboard",
        label: "canvasB.imageTools.blockingStoryboardLabel",
        section: "canvasB.imageTools.sectionStoryboard",
        description: "canvasB.imageTools.blockingStoryboardDesc",
        placeholder: "canvasB.imageTools.blockingStoryboardPlaceholder",
        icon: () => <Route className="size-3.5" />,
        group: "sheet",
        order: 2,
        toolId: 1000091,
        run: nineGridRun,
    },
    {
        id: "multi_camera_nine_grid",
        label: "canvasB.imageTools.multiCameraLabel",
        section: "canvasB.imageTools.sectionStoryboard",
        description: "canvasB.imageTools.multiCameraDesc",
        icon: () => <Grid3x3 className="size-3.5" />,
        group: "sheet",
        order: 10,
        toolId: 79,
        run: nineGridRun,
    },
    {
        id: "story_pitch_four_grid",
        label: "canvasB.imageTools.storyPitchLabel",
        section: "canvasB.imageTools.sectionStoryboard",
        description: "canvasB.imageTools.storyPitchDesc",
        icon: () => <Grid2x2 className="size-3.5" />,
        group: "sheet",
        order: 20,
        toolId: 80,
        run: nineGridRun,
    },
    {
        id: "storyboard_25_grid",
        label: "canvasB.imageTools.storyboard25Label",
        section: "canvasB.imageTools.sectionStoryboard",
        description: "canvasB.imageTools.storyboard25Desc",
        icon: () => <Clapperboard className="size-3.5" />,
        group: "sheet",
        order: 30,
        toolId: 83,
        run: nineGridRun,
    },
    {
        id: "character_three_view_generation",
        label: "canvasB.imageTools.characterThreeViewLabel",
        section: "canvasB.imageTools.sectionSheets",
        description: "canvasB.imageTools.characterThreeViewDesc",
        icon: () => <PersonStanding className="size-3.5" />,
        group: "sheet",
        order: 40,
        toolId: 85,
        run: nineGridRun,
    },
    {
        id: "character_face_three_view",
        label: "canvasB.imageTools.characterFaceLabel",
        section: "canvasB.imageTools.sectionSheets",
        description: "canvasB.imageTools.characterFaceDesc",
        icon: () => <ScanFace className="size-3.5" />,
        group: "sheet",
        order: 50,
        toolId: 81,
        run: nineGridRun,
    },
    {
        id: "product_three_view",
        label: "canvasB.imageTools.productThreeViewLabel",
        section: "canvasB.imageTools.sectionSheets",
        description: "canvasB.imageTools.productThreeViewDesc",
        icon: () => <Package className="size-3.5" />,
        group: "sheet",
        order: 60,
        toolId: 82,
        run: nineGridRun,
    },
    // 图片工具：不调用模型的裁剪、尺寸和标记
    {
        id: "crop",
        label: "canvasB.imageTools.cropLabel",
        section: "canvasB.imageTools.sectionComposition",
        description: "canvasB.imageTools.cropDesc",
        icon: () => <Crop className="size-3.5" />,
        group: "process",
        order: 10,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "upscale",
        label: "canvasB.imageTools.upscaleLabel",
        section: "canvasB.imageTools.sectionComposition",
        description: "canvasB.imageTools.upscaleDesc",
        icon: () => <Scaling className="size-3.5" />,
        group: "process",
        order: 20,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "annotation",
        section: "canvasB.imageTools.sectionSplitMark",
        description: "canvasB.imageTools.annotationDesc",
        label: "canvasB.imageTools.annotationLabel",
        icon: () => <PencilLine className="size-3.5" />,
        group: "process",
        order: 40,
        run: (node, handlers) => handlers.onAnnotate(node),
    },
    {
        id: "annotationEdit",
        section: "canvasB.imageTools.sectionSplitMark",
        description: "canvasB.imageTools.annotationEditDesc",
        label: "canvasB.imageTools.annotationEditLabel",
        icon: () => <Brush className="size-3.5" />,
        group: "process",
        order: 45,
        run: (node, handlers) => handlers.onAnnotationEdit(node),
    },
    {
        id: "split",
        label: "canvasB.imageTools.splitLabel",
        section: "canvasB.imageTools.sectionSplitMark",
        description: "canvasB.imageTools.splitDesc",
        icon: () => <Grid2x2 className="size-3.5" />,
        group: "process",
        order: 46,
        run: () => undefined,
    },
    {
        id: "view",
        label: "canvasB.imageTools.viewLabel",
        icon: () => <Maximize2 className="size-3.5" />,
        group: "utility",
        order: 10,
        run: (node, handlers) => handlers.onViewImage(node),
    },
    {
        id: "replace",
        label: "canvasB.imageTools.replaceLabel",
        icon: () => <Upload className="size-3.5" />,
        group: "more",
        section: "canvasB.imageTools.sectionAssets",
        order: 45,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "copyPrompt",
        section: "canvasB.imageTools.sectionGenerationInfo",
        label: "canvasB.imageTools.copyPromptLabel",
        icon: () => <Copy className="size-3.5" />,
        group: "more",
        order: 50,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        section: "canvasB.imageTools.sectionGenerationInfo",
        label: "canvasB.imageTools.reversePromptLabel",
        icon: () => <FileText className="size-3.5" />,
        group: "more",
        order: 60,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "resize",
        label: "canvasB.imageTools.resizeLabel",
        section: "canvasB.imageTools.sectionNodeManagement",
        active: (node) => !node.metadata?.freeResize,
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />),
        group: "more",
        order: 70,
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers) {
    return imageToolDefinitions.map((tool) => ({
        id: tool.id,
        label: resolveToolText(tool.label, node),
        icon: tool.icon(node),
        group: tool.group,
        order: tool.order,
        section: tool.section ? translate(tool.section) : undefined,
        description: tool.description ? translate(tool.description) : undefined,
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers, tool),
    }));
}

function resolveToolText(value: string | ((node: CanvasNodeData) => string), node: CanvasNodeData) {
    return typeof value === "function" ? value(node) : translate(value);
}

export type NineGridMenuItem = {
    id: string;
    label: string;
    section: string;
    description: string;
    placeholder?: string;
    toolId: number;
    toolIconName: string;
};

/** 提示词面板「预设」菜单：列出全部后端 nine_grid 提示词工具，宫格与设定在前，其余按定义顺序。 */
export function getNineGridMenuItems(): NineGridMenuItem[] {
    const groupRank = (group: NodeToolbarGroup) => (group === "sheet" ? 0 : 1);
    return imageToolDefinitions
        .filter((tool) => tool.toolId != null)
        .map((tool, index) => ({ tool, index }))
        .sort((a, b) => groupRank(a.tool.group) - groupRank(b.tool.group) || a.index - b.index)
        .map(({ tool }) => ({
            id: tool.id,
            label: resolveToolText(tool.label, {} as CanvasNodeData),
            section: translate(tool.section || "canvasB.imageTools.sectionCommon"),
            description: tool.description ? translate(tool.description) : "",
            placeholder: tool.placeholder ? translate(tool.placeholder) : undefined,
            toolId: tool.toolId!,
            toolIconName: resolveToolIconName(tool, {} as CanvasNodeData),
        }));
}
