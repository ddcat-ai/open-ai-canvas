export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    role?: "reference" | "first_frame" | "last_frame";
    slotKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    role?: "reference" | "first_frame" | "last_frame";
    slotKey?: string;
    bytes?: number;
    durationMs?: number;
};
