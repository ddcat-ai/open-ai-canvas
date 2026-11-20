import type { ReactNode } from "react";
import { Brush, Camera, Copy, Crop, Eraser, FileText, Globe2, Grid2x2, Layers3, Lock, LockOpen, Maximize2, PencilLine, Scaling, SlidersHorizontal, Smile, SquareDashed, Sun, Upload } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import { CANVAS_IMAGE_PRESETS } from "@/lib/canvas/canvas-image-presets";
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
    | "previs";

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
};

type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    label: string;
    icon: (node: CanvasNodeData) => ReactNode;
    group: NodeToolbarGroup;
    order: number;
    section?: string;
    description?: string;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers) => void;
};

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
        id: "previs",
        label: "canvasB.imageTools.previsLabel",
        section: "canvasB.imageTools.sectionPrevis",
        description: "canvasB.imageTools.previsDesc",
        icon: () => <Layers3 className="size-3.5" />,
        group: "camera",
        order: 50,
        run: (node, handlers) => handlers.onPrevis(node),
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
        description: "canvasB.imageTools.viewDesc",
        icon: () => <Maximize2 className="size-3.5" />,
        group: "utility",
        order: 10,
        run: (node, handlers) => handlers.onViewImage(node),
    },
    {
        id: "replace",
        label: "canvasB.imageTools.replaceLabel",
        description: "canvasB.imageTools.replaceDesc",
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
        description: "canvasB.imageTools.copyPromptDesc",
        icon: () => <Copy className="size-3.5" />,
        group: "more",
        order: 50,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        section: "canvasB.imageTools.sectionGenerationInfo",
        label: "canvasB.imageTools.reversePromptLabel",
        description: "canvasB.imageTools.reversePromptDesc",
        icon: () => <FileText className="size-3.5" />,
        group: "more",
        order: 60,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "resize",
        label: "canvasB.imageTools.resizeLabel",
        description: "canvasB.imageTools.resizeDesc",
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
        label: translate(tool.label),
        icon: tool.icon(node),
        group: tool.group,
        order: tool.order,
        section: tool.section ? translate(tool.section) : undefined,
        description: tool.description ? translate(tool.description) : undefined,
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers),
    }));
}

export type NineGridMenuItem = {
    id: string;
    label: string;
    section: string;
    sectionKey: string;
    description: string;
    placeholder?: string;
    toolId: number;
    toolIconName: string;
    ratio: string;
};

export function getNineGridMenuItems(): NineGridMenuItem[] {
    return CANVAS_IMAGE_PRESETS.map((preset) => ({
        id: preset.key,
        label: translate(`canvasB.imageTools.${preset.text}Label`),
        section: translate(`canvasB.imageTools.${preset.section}`),
        sectionKey: preset.section,
        description: translate(`canvasB.imageTools.${preset.text}Desc`),
        placeholder: preset.hasPlaceholder ? translate(`canvasB.imageTools.${preset.text}Placeholder`) : undefined,
        toolId: preset.id,
        toolIconName: preset.icon,
        ratio: preset.ratio,
    }));
}
