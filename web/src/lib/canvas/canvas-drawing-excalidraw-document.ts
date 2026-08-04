import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";

import { createClientId } from "@/lib/client-id";

const INITIAL_DRAWING_SHAPE_MAX_DIMENSION = 1200;

type DrawingImageSource = {
    dataUrl: string;
    width: number;
    height: number;
    mimeType: string;
    name: string;
};

export function createExcalidrawDrawingFromImage(source: DrawingImageSource) {
    const now = Date.now();
    const fileId = createClientId() as FileId;
    const scale = Math.min(1, INITIAL_DRAWING_SHAPE_MAX_DIMENSION / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const elements = convertToExcalidrawElements([{
        type: "image",
        x: -width / 2,
        y: -height / 2,
        width,
        height,
        fileId,
        status: "saved",
        scale: [1, 1],
        crop: null,
    }]);
    const files: BinaryFiles = {
        [fileId]: {
            id: fileId,
            dataURL: source.dataUrl as DataURL,
            mimeType: source.mimeType as BinaryFileData["mimeType"],
            created: now,
            lastRetrieved: now,
        },
    };
    const snapshot = {
        elements,
        appState: { viewBackgroundColor: "#ffffff" },
        files,
    };
    return { snapshot, pageId: "excalidraw-page" };
}
