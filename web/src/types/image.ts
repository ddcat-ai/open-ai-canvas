export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    source?: {
        kind: "drawing";
        drawingId: string;
        revision: number;
        shapeCount: number;
    };
};
