import { nanoid } from "nanoid";
import { isolateCopiedNodeMetadata, nextCopiedNodeTitle } from "./canvas-node-copy";
import { findAvailableGenerationGroupPosition } from "./canvas-generation-layout";
import { canRotateCanvasImage } from "./canvas-image-rotation";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

/** A durable edit starts from the visible resource and has no generation/task ownership. */
export function createCanvasImageEditCopy(source: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (!canRotateCanvasImage(source)) return undefined;
    const id = `image-${nanoid()}`;
    const metadata = isolateCopiedNodeMetadata(source, new Map([[source.id, id]]));
    delete metadata.imageRotation;
    delete metadata.locked;
    metadata.imageEditSourceNodeId = source.id;
    const side = Math.max(source.width, source.height);
    const area = findAvailableGenerationGroupPosition(nodes, { x: source.position.x + source.width + 96, y: source.position.y }, { width: side, height: side });
    const node: CanvasNodeData = {
        ...source,
        id,
        metadata,
        title: nextCopiedNodeTitle(
            source.title,
            nodes.map((node) => node.title),
        ),
        position: { x: area.x + (side - source.width) / 2, y: area.y + (side - source.height) / 2 },
    };
    const connection: CanvasConnection = { id: nanoid(), fromNodeId: source.id, toNodeId: id };
    return { node, connection };
}
