import { CanvasNodeAnnotationDialog } from "@/components/canvas/canvas-node-annotation-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import type { CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasProjectMediaDialogsProps = {
    cropNode: CanvasNodeData | null;
    annotationNode: CanvasNodeData | null;
    maskEditNode: CanvasNodeData | null;
    splitNode: CanvasNodeData | null;
    upscaleNode: CanvasNodeData | null;
    onCloseCrop: () => void;
    onCloseAnnotation: () => void;
    onCloseMaskEdit: () => void;
    onCloseSplit: () => void;
    onCloseUpscale: () => void;
    onCrop: (node: CanvasNodeData, crop: CanvasImageCropRect) => void;
    onAnnotate: (node: CanvasNodeData, dataUrl: string) => void;
    onMaskEdit: (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => void;
    onSplit: (node: CanvasNodeData, params: CanvasImageSplitParams) => void;
    onUpscale: (node: CanvasNodeData, params: CanvasImageUpscaleParams) => void;
    config: AiConfig;
};

export function CanvasProjectMediaDialogs({
    cropNode,
    annotationNode,
    maskEditNode,
    splitNode,
    upscaleNode,
    onCloseCrop,
    onCloseAnnotation,
    onCloseMaskEdit,
    onCloseSplit,
    onCloseUpscale,
    onCrop,
    onAnnotate,
    onMaskEdit,
    onSplit,
    onUpscale,
    config,
}: CanvasProjectMediaDialogsProps) {
    return (
        <>
            {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open onClose={onCloseCrop} onConfirm={(crop) => onCrop(cropNode, crop)} /> : null}
            {annotationNode?.metadata?.content ? <CanvasNodeAnnotationDialog image={{ url: annotationNode.metadata.content, storageKey: annotationNode.metadata.storageKey }} open onClose={onCloseAnnotation} onConfirm={(dataUrl) => onAnnotate(annotationNode, dataUrl)} /> : null}
            {maskEditNode?.metadata?.content ? <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} config={{ ...config, model: maskEditNode.metadata.model || config.model, imageModel: maskEditNode.metadata.model || config.imageModel, size: maskEditNode.metadata.size || config.size, quality: maskEditNode.metadata.quality || config.quality, count: String(maskEditNode.metadata.count || config.count) }} open onClose={onCloseMaskEdit} onConfirm={(payload) => onMaskEdit(maskEditNode, payload)} /> : null}
            {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open onClose={onCloseSplit} onConfirm={(params) => onSplit(splitNode, params)} /> : null}
            {upscaleNode?.metadata?.content ? <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open onClose={onCloseUpscale} onConfirm={(params) => onUpscale(upscaleNode, params)} /> : null}
        </>
    );
}
