import { nanoid } from "nanoid";

import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

export type CanvasTemplateCategory = "image" | "video" | "storyboard" | "commerce";

export type CanvasTemplateGraph = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export type CanvasTemplateDocument = {
    schema: "yingce.canvas-template";
    schemaVersion: 1 | 2;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    media?: CanvasTemplateMedia[];
};

export type CanvasTemplateMedia = {
    id: string;
    nodeId?: string;
    kind: "image" | "video";
    role?: "node" | "cover";
    path?: string;
    mimeType?: string;
    bytes?: number;
};

export type CanvasTemplate = {
    id: string;
    title: string;
    description: string;
    category: CanvasTemplateCategory;
    tags: string[];
    output: string;
    source?: "builtin" | "user" | "published";
    remoteId?: string;
    version?: number;
    document?: CanvasTemplateDocument;
    createGraph: (center: Position) => CanvasTemplateGraph;
};

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `template-connection-${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId };
}

function createTextNode(center: Position, offset: Position, title: string, content: string) {
    const node = createCanvasNode(CanvasNodeType.Text, { x: center.x + offset.x, y: center.y + offset.y }, { content, prompt: content, status: "success", fontSize: 14 });
    return { ...node, title };
}

function createImageNode(center: Position, offset: Position, title: string, metadata: Parameters<typeof createCanvasNode>[2] = {}) {
    const node = createCanvasNode(CanvasNodeType.Image, { x: center.x + offset.x, y: center.y + offset.y }, { status: "idle", ...metadata });
    return { ...node, title };
}

function createVideoNode(center: Position, offset: Position, title: string, prompt: string) {
    const node = createCanvasNode(
        CanvasNodeType.Video,
        { x: center.x + offset.x, y: center.y + offset.y },
        {
            prompt,
            composerContent: prompt,
            generationMode: "video",
            videoEditOperation: "image_to_video",
            status: "idle",
        },
    );
    return { ...node, title };
}

const CHARACTER_SHEET_PROMPT = "生成角色设定图：保持同一角色身份、五官、发型、服装和体态一致，包含正面、侧面、背面和关键表情参考，背景简洁，便于后续镜头复用。";
const PRODUCT_IMAGE_PROMPT = "保留商品真实外观、材质、颜色和比例，生成干净、清晰、适合电商主图的商品画面，主体完整，背景简洁，突出商品细节。";

export const CANVAS_BUILTIN_TEMPLATES: CanvasTemplate[] = [
    {
        id: "character-sheet",
        title: "角色设定图",
        description: "从角色描述生成一套可复用的角色视觉参考。",
        category: "image",
        tags: ["角色", "一致性", "生图"],
        output: "角色设定图",
        createGraph: (center) => {
            const prompt = createTextNode(center, { x: -560, y: 0 }, "角色描述", "描述角色的身份、年龄、外观、服装、性格和辨识特征");
            const image = createImageNode(center, { x: 420, y: 0 }, "角色设定图", { prompt: CHARACTER_SHEET_PROMPT, composerContent: CHARACTER_SHEET_PROMPT, generationMode: "image" });
            return { nodes: [prompt, image], connections: [connection(prompt.id, image.id)] };
        },
    },
    {
        id: "image-to-video",
        title: "图生视频",
        description: "放入参考图片，快速搭建图生视频工作流。",
        category: "video",
        tags: ["参考图", "视频", "运镜"],
        output: "视频片段",
        createGraph: (center) => {
            const source = createImageNode(center, { x: -560, y: 0 }, "参考图片");
            const video = createVideoNode(center, { x: 420, y: 0 }, "视频结果", "主体保持一致，进行自然、连贯的动作和镜头运动，保持画面风格与光线连续。");
            return { nodes: [source, video], connections: [connection(source.id, video.id)] };
        },
    },
    {
        id: "storyboard-video",
        title: "连续镜头",
        description: "从剧情描述开始，串起首帧画面与视频镜头。",
        category: "storyboard",
        tags: ["剧情", "分镜", "视频"],
        output: "首帧图片 + 视频",
        createGraph: (center) => {
            const story = createTextNode(center, { x: -860, y: 0 }, "镜头描述", "描述本镜剧情、人物动作、景别、机位、光线和镜头运动");
            const frame = createImageNode(center, { x: 0, y: 0 }, "首帧画面", { prompt: "根据上游镜头描述生成连续镜头首帧，保持人物、场景、服装和道具一致。", generationMode: "image" });
            const video = createVideoNode(center, { x: 860, y: 0 }, "镜头视频", "根据首帧画面生成连续镜头，明确主体动作、镜头运动和结尾状态，保持身份与场景连续。");
            return { nodes: [story, frame, video], connections: [connection(story.id, frame.id), connection(frame.id, video.id)] };
        },
    },
    {
        id: "product-main-image",
        title: "商品主图优化",
        description: "基于商品参考图生成干净、可用于电商展示的主图。",
        category: "commerce",
        tags: ["电商", "商品", "主图"],
        output: "商品主图",
        createGraph: (center) => {
            const source = createImageNode(center, { x: -560, y: 0 }, "商品参考图", { workflowKind: "reference_set" });
            const output = createImageNode(center, { x: 420, y: 0 }, "商品主图", { prompt: PRODUCT_IMAGE_PROMPT, composerContent: PRODUCT_IMAGE_PROMPT, generationMode: "image" });
            return { nodes: [source, output], connections: [connection(source.id, output.id)] };
        },
    },
];

export function canvasTemplateCategoryLabel(category: CanvasTemplateCategory) {
    return category === "image" ? "图片" : category === "video" ? "视频" : category === "storyboard" ? "分镜" : "电商";
}

export function canvasTemplateDocumentFromSelection(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasTemplateDocument {
    const selectedIds = new Set(nodes.map((node) => node.id));
    const nextNodes = nodes.map((node) => {
        const copy = JSON.parse(JSON.stringify(node)) as CanvasNodeData;
        delete copy.createdAt;
        delete copy.updatedAt;
        if (copy.parentId && !selectedIds.has(copy.parentId)) delete copy.parentId;
        if (copy.metadata) {
            const metadata = copy.metadata as Record<string, unknown>;
            [
                "storageKey",
                "assetId",
                "taskId",
                "previewContent",
                "templateMediaURL",
                "templateMediaKind",
                "videoPreview",
                "fileUpload",
                "fileUploadProgress",
                "errorDetails",
                "generationErrorCode",
                "resourceReloadAvailable",
                "failedPromptFingerprint",
                "lastGenerationRequestFingerprint",
                "naturalWidth",
                "naturalHeight",
                "bytes",
                "durationMs",
                "importSource",
                "drawingId",
            ].forEach((key) => delete metadata[key]);
            if (copy.type !== CanvasNodeType.Text && copy.type !== CanvasNodeType.Markdown && copy.type !== CanvasNodeType.Svg && copy.type !== CanvasNodeType.Html) delete metadata.content;
            if (metadata.status === "loading" || metadata.status === "error") metadata.status = "idle";
        }
        return copy;
    });
    return {
        schema: "yingce.canvas-template",
        schemaVersion: 1,
        nodes: nextNodes,
        connections: connections.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)),
    };
}

export function canvasTemplateFromDocument(input: { id: string; title: string; description: string; category: string; tags: string[]; document: CanvasTemplateDocument; source: "user" | "published"; version: number; mediaURL?: (mediaId: string) => string }): CanvasTemplate {
    const category = ["image", "video", "storyboard", "commerce"].includes(input.category) ? (input.category as CanvasTemplateCategory) : "image";
    return {
        id: `remote:${input.id}`,
        remoteId: input.id,
        title: input.title,
        description: input.description,
        category,
        tags: input.tags,
        output: `${input.document.nodes.length} 个节点工作流`,
        source: input.source,
        version: input.version,
        document: input.document,
        createGraph: (center) => normalizeTemplateGraph(input.document, center, input.mediaURL),
    };
}

export function canvasTemplateDocumentForExport(template: CanvasTemplate): CanvasTemplateDocument {
    if (template.document) return template.document;
    const graph = template.createGraph({ x: 0, y: 0 });
    return canvasTemplateDocumentFromSelection(graph.nodes, graph.connections);
}

function normalizeTemplateGraph(document: CanvasTemplateDocument, center: Position, mediaURL?: (mediaId: string) => string): CanvasTemplateGraph {
    const nodes = document.nodes;
    if (!nodes.length) return { nodes: [], connections: [...document.connections] };
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.position.y + node.height));
    const offsetX = center.x - (minX + maxX) / 2;
    const offsetY = center.y - (minY + maxY) / 2;
    const mediaById = new Map((document.media || []).map((media) => [media.id, media]));
    return {
        nodes: nodes.map((node) => {
            const mediaIds = node.metadata?.templateMediaIds || [];
            const media = mediaIds.map((mediaId) => mediaById.get(mediaId)).find((item) => item && mediaURL?.(item.id));
            const metadata = media && mediaURL ? { ...node.metadata, templateMediaURL: mediaURL(media.id), templateMediaKind: media.kind } : node.metadata;
            return { ...node, metadata, position: { x: node.position.x + offsetX, y: node.position.y + offsetY } };
        }),
        connections: [...document.connections],
    };
}

export function instantiateCanvasTemplate(template: CanvasTemplate, center: Position): CanvasTemplateGraph {
    const graph = template.createGraph(center);
    const idMap = new Map<string, string>();
    const nodes = graph.nodes.map((node) => {
        const id = `${node.type}-template-${nanoid(8)}`;
        idMap.set(node.id, id);
        return { ...node, id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    });
    const connections = graph.connections.flatMap((item) => {
        const fromNodeId = idMap.get(item.fromNodeId);
        const toNodeId = idMap.get(item.toNodeId);
        if (!fromNodeId || !toNodeId) return [];
        return [{ ...item, id: `connection-template-${nanoid(8)}`, fromNodeId, toNodeId }];
    });
    return { nodes, connections };
}
