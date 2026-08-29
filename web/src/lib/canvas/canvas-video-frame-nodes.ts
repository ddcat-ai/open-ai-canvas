import { nanoid } from "nanoid";

import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { formatVideoFrameTime } from "@/lib/canvas/canvas-video-frame";
import type { UploadedImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type UploadedVideoFrame = {
    timeMs: number;
    image: UploadedImage;
};

const FRAME_NODE_GAP = 24;
const FRAME_NODE_OFFSET = 96;
const FRAME_GRID_MAX_COLUMNS = 3;

export function buildVideoFrameNodes(source: CanvasNodeData, frames: UploadedVideoFrame[]): CanvasNodeData[] {
    if (!frames.length) return [];
    const sizes = frames.map(({ image }) => fitNodeSize(image.width, image.height, source.width, source.height));
    const cellWidth = Math.max(...sizes.map((size) => size.width));
    const cellHeight = Math.max(...sizes.map((size) => size.height));
    const columns = Math.min(FRAME_GRID_MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(frames.length))));
    const startX = source.position.x + source.width + FRAME_NODE_OFFSET;

    return frames.map(({ timeMs, image }, index) => {
        const size = sizes[index];
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            id: nanoid(),
            type: CanvasNodeType.Image,
            title: `画面 ${formatVideoFrameTime(timeMs)} · ${source.title || "视频"}`,
            position: {
                x: startX + column * (cellWidth + FRAME_NODE_GAP) + (cellWidth - size.width) / 2,
                y: source.position.y + row * (cellHeight + FRAME_NODE_GAP) + (cellHeight - size.height) / 2,
            },
            width: size.width,
            height: size.height,
            metadata: {
                ...imageMetadata(image),
                prompt: source.metadata?.prompt,
                workflowKind: source.metadata?.workflowKind,
                workflowTitle: source.metadata?.workflowTitle,
                shotIndex: source.metadata?.shotIndex,
                videoFrameSourceNodeId: source.id,
                videoFrameTimeMs: timeMs,
            },
        } satisfies CanvasNodeData;
    });
}
