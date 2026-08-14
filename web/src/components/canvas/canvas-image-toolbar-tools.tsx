import type { ReactNode } from "react";
import { Brush, Camera, Copy, FileText, Grid2x2, Lock, LockOpen, Maximize2, PencilLine, Scissors, SlidersHorizontal, Smile, Sparkles, Upload, ZoomIn } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";

type ImageNodeActionToolId = "copyPrompt" | "reversePrompt" | "replace" | "resize" | "annotation" | "maskEdit" | "emotion" | "portraitTexture" | "crop" | "split" | "upscale" | "superResolve" | "angle" | "view";

type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onAnnotate: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
};

type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    label: string | ((node: CanvasNodeData) => string);
    icon: (node: CanvasNodeData) => ReactNode;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers) => void;
};

const imageToolDefinitions: ImageToolDefinition[] = [
    {
        id: "copyPrompt",
        label: "复制提示词",
        icon: () => <Copy className="size-3.5" />,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        label: "反推提示词",
        icon: () => <FileText className="size-3.5" />,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "replace",
        label: "替换图片",
        icon: () => <Upload className="size-3.5" />,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "resize",
        label: (node) => (node.metadata?.freeResize ? "自由比例" : "锁比例"),
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />),
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
    {
        id: "annotation",
        label: "标注",
        icon: () => <PencilLine className="size-3.5" />,
        run: (node, handlers) => handlers.onAnnotate(node),
    },
    {
        id: "maskEdit",
        label: "局部编辑",
        icon: () => <Brush className="size-3.5" />,
        run: (node, handlers) => handlers.onMaskEdit(node),
    },
    {
        id: "emotion",
        label: "情绪",
        icon: () => <Smile className="size-3.5" />,
        run: (node, handlers) => handlers.onEmotion(node),
    },
    {
        id: "portraitTexture",
        label: "人物质感",
        icon: () => <SlidersHorizontal className="size-3.5" />,
        run: (node, handlers) => handlers.onPortraitTexture(node),
    },
    {
        id: "crop",
        label: "剪裁",
        icon: () => <Scissors className="size-3.5" />,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "split",
        label: "切图",
        icon: () => <Grid2x2 className="size-3.5" />,
        run: (node, handlers) => handlers.onSplit(node),
    },
    {
        id: "upscale",
        label: "放大",
        icon: () => <ZoomIn className="size-3.5" />,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "superResolve",
        label: "超分",
        icon: () => <Sparkles className="size-3.5" />,
        run: (node, handlers) => handlers.onSuperResolve(node),
    },
    {
        id: "angle",
        label: "多视角",
        icon: () => <Camera className="size-3.5" />,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "view",
        label: "查看大图",
        icon: () => <Maximize2 className="size-3.5" />,
        run: (node, handlers) => handlers.onViewImage(node),
    },
];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers) {
    return imageToolDefinitions.map((tool) => ({
        id: tool.id,
        label: resolveToolText(tool.label, node),
        icon: tool.icon(node),
        onClick: () => tool.run(node, handlers),
    }));
}

function resolveToolText(value: string | ((node: CanvasNodeData) => string), node: CanvasNodeData) {
    return typeof value === "function" ? value(node) : value;
}
