import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
    drawingDocuments?: CanvasDrawingExport[];
};

export type CanvasDrawingExport = {
    drawingId: string;
    previewPath?: string;
    snapshot: unknown;
    revision: number;
    updatedAt: string;
    shapeCount: number;
    pageCount: number;
    generationRender?: {
        path: string;
        pageId: string;
        width: number;
        height: number;
        mimeType: string;
        background: "white";
    };
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
