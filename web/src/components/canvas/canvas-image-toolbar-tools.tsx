import type { ReactNode } from "react";
import { Brush, Camera, Copy, FileText, Grid2x2, Lock, LockOpen, Maximize2, PencilLine, Scissors, SlidersHorizontal, Smile, Sparkles, Upload, ZoomIn } from "lucide-react";

import type { CanvasNodeData } from "@/types/canvas";
import { t } from "@/i18n";

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
        label: t("canvas:copy-prompt"),
        icon: () => <Copy className="size-3.5" />,
        run: (node, handlers) => handlers.onCopyPrompt(node),
    },
    {
        id: "reversePrompt",
        label: t("canvas:reverse-prompt"),
        icon: () => <FileText className="size-3.5" />,
        run: (node, handlers) => handlers.onReversePrompt(node),
    },
    {
        id: "replace",
        label: t("canvas:replace-image"),
        icon: () => <Upload className="size-3.5" />,
        run: (node, handlers) => handlers.onUpload(node),
    },
    {
        id: "resize",
        label: (node) => (node.metadata?.freeResize ? t("domain:free-ratio") : t("domain:lock-ratio")),
        icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />),
        run: (node, handlers) => handlers.onToggleFreeResize(node),
    },
    {
        id: "annotation",
        label: t("domain:annotate-2"),
        icon: () => <PencilLine className="size-3.5" />,
        run: (node, handlers) => handlers.onAnnotate(node),
    },
    {
        id: "maskEdit",
        label: t("domain:inpaint-edit"),
        icon: () => <Brush className="size-3.5" />,
        run: (node, handlers) => handlers.onMaskEdit(node),
    },
    {
        id: "emotion",
        label: t("canvas:emotion"),
        icon: () => <Smile className="size-3.5" />,
        run: (node, handlers) => handlers.onEmotion(node),
    },
    {
        id: "portraitTexture",
        label: t("domain:skin-texture"),
        icon: () => <SlidersHorizontal className="size-3.5" />,
        run: (node, handlers) => handlers.onPortraitTexture(node),
    },
    {
        id: "crop",
        label: t("domain:crop"),
        icon: () => <Scissors className="size-3.5" />,
        run: (node, handlers) => handlers.onCrop(node),
    },
    {
        id: "split",
        label: t("domain:slice"),
        icon: () => <Grid2x2 className="size-3.5" />,
        run: (node, handlers) => handlers.onSplit(node),
    },
    {
        id: "upscale",
        label: t("domain:zoom-in"),
        icon: () => <ZoomIn className="size-3.5" />,
        run: (node, handlers) => handlers.onUpscale(node),
    },
    {
        id: "superResolve",
        label: t("domain:upscale"),
        icon: () => <Sparkles className="size-3.5" />,
        run: (node, handlers) => handlers.onSuperResolve(node),
    },
    {
        id: "angle",
        label: t("canvas:multi-perspective"),
        icon: () => <Camera className="size-3.5" />,
        run: (node, handlers) => handlers.onAngle(node),
    },
    {
        id: "view",
        label: t("domain:view-full-size"),
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
