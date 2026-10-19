export type LibTVGalleryTag = {
    id: number;
    code: string;
    label: string;
};

export type LibTVGalleryItem = {
    templateUuid: string;
    projectUuid: string;
    title: string;
    description: string;
    coverUrl: string;
    mediaUrl: string;
    mediaType: "image" | "video" | "audio" | "unknown";
    authorName: string;
    authorAvatar: string;
    likeCount: number;
    publishedAt: string;
    tags: LibTVGalleryTag[];
    sourceUrl: string;
};

export type LibTVWorkStep = {
    id: string;
    title: string;
    type: "image" | "video" | "audio" | "text";
    prompt: string;
    text: string;
    model: string;
    mediaUrls: string[];
    aspectRatio: string;
    resolution: string;
    durationSeconds: number;
    referenceNodeIds: string[];
};

export type LibTVGalleryParams = {
    page: number;
    pageSize?: number;
    keyword?: string;
    tagId?: number;
    requestId?: string;
};

export type LibTVGalleryResponse = {
    items: LibTVGalleryItem[];
    page: number;
    pageSize: number;
    hasMore: boolean;
    requestId: string;
};

export type LibTVWorkDetailResponse = {
    work: LibTVGalleryItem;
    steps: LibTVWorkStep[];
    nodeCount: number;
    connectionCount: number;
    canImport: boolean;
    warnings: { id?: string; message: string }[];
};
