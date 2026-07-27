export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    source?: {
        kind: "drawing";
        drawingId: string;
        revision: number;
        shapeCount: number;
    };
};
