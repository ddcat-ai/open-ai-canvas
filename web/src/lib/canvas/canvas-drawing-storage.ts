import localforage from "localforage";
import { AssetRecordType, createShapeId, createTLStore, type TLImageShape } from "tldraw";

import { readImageMeta } from "@/lib/image-utils";
import { getActiveUserScope } from "@/lib/user-scope";
import { imageToDataUrl } from "@/services/image-storage";

export type CanvasDrawingSnapshot = {
    version: 1;
    snapshot: unknown;
    revision: number;
    updatedAt: string;
    shapeCount: number;
    pageCount: number;
};

export type CanvasDrawingRenderDraft = {
    blob: Blob;
    pageId: string;
    width: number;
    height: number;
    mimeType: string;
    background: "white";
    storageKey?: string;
    url?: string;
};

export type CanvasDrawingRender = CanvasDrawingRenderDraft & {
    version: 1;
    revision: number;
    updatedAt: string;
};

const drawingStore = localforage.createInstance({ name: "infinite-canvas", storeName: "drawing_documents" });
const drawingPreviewStore = localforage.createInstance({ name: "infinite-canvas", storeName: "drawing_previews" });
const drawingRenderStore = localforage.createInstance({ name: "infinite-canvas", storeName: "drawing_generation_renders" });
const INITIAL_DRAWING_RENDER_MAX_DIMENSION = 2048;
const INITIAL_DRAWING_RENDER_PADDING = 24;
const INITIAL_DRAWING_SHAPE_MAX_DIMENSION = 1200;

function drawingKey(projectId: string, drawingId: string) {
    return `${getActiveUserScope()}:${projectId}:${drawingId}`;
}

export async function loadCanvasDrawing(projectId: string, drawingId: string) {
    if (!projectId || !drawingId) return null;
    return drawingStore.getItem<CanvasDrawingSnapshot>(drawingKey(projectId, drawingId));
}

export async function saveCanvasDrawing(
    projectId: string,
    drawingId: string,
    snapshot: unknown,
    previous?: CanvasDrawingSnapshot | null,
    preview?: Blob | null,
    render?: CanvasDrawingRenderDraft | null,
) {
    const summary = summarizeCanvasDrawing(snapshot);
    const revision = (previous?.revision || 0) + 1;
    const updatedAt = new Date().toISOString();
    const next: CanvasDrawingSnapshot = {
        version: 1,
        snapshot,
        revision,
        updatedAt,
        shapeCount: summary.shapeCount,
        pageCount: Math.min(summary.pageCount, 1),
    };
    await drawingStore.setItem(drawingKey(projectId, drawingId), next);
    if (preview) await drawingPreviewStore.setItem(drawingKey(projectId, drawingId), preview);
    else if (preview === null) await drawingPreviewStore.removeItem(drawingKey(projectId, drawingId));
    if (render) {
        await drawingRenderStore.setItem<CanvasDrawingRender>(drawingKey(projectId, drawingId), {
            ...render,
            version: 1,
            revision,
            updatedAt,
        });
    } else if (render === null) await drawingRenderStore.removeItem(drawingKey(projectId, drawingId));
    return next;
}

export async function createCanvasDrawingFromImage(
    projectId: string,
    drawingId: string,
    image: { url: string; storageKey?: string; name: string; mimeType?: string },
) {
    const dataUrl = await imageToDataUrl({ url: image.url, storageKey: image.storageKey, name: image.name, mimeType: image.mimeType });
    if (!dataUrl?.startsWith("data:image/")) throw new Error("无法读取来源图片");

    const [{ width, height, mimeType }, sourceBlob] = await Promise.all([
        readImageMeta(dataUrl),
        fetch(dataUrl).then((response) => response.blob()),
    ]);
    const store = createTLStore();
    const page = store.allRecords().find((record) => record.typeName === "page");
    if (!page) throw new Error("无法初始化绘图页面");

    const assetId = AssetRecordType.createId();
    const shapeScale = Math.min(1, INITIAL_DRAWING_SHAPE_MAX_DIMENSION / Math.max(width, height));
    const shapeWidth = Math.max(1, Math.round(width * shapeScale));
    const shapeHeight = Math.max(1, Math.round(height * shapeScale));
    const asset = AssetRecordType.create({
        id: assetId,
        type: "image",
        props: {
            w: width,
            h: height,
            name: image.name || "来源图片",
            isAnimated: false,
            mimeType: mimeType || sourceBlob.type || image.mimeType || "image/png",
            src: dataUrl,
            ...(sourceBlob.size > 0 ? { fileSize: sourceBlob.size } : {}),
        },
    });
    const shape: TLImageShape = {
        id: createShapeId(),
        typeName: "shape",
        type: "image",
        parentId: page.id,
        index: "a1" as TLImageShape["index"],
        x: -shapeWidth / 2,
        y: -shapeHeight / 2,
        rotation: 0,
        isLocked: false,
        opacity: 1,
        props: {
            w: shapeWidth,
            h: shapeHeight,
            playing: false,
            url: "",
            assetId,
            crop: null,
            flipX: false,
            flipY: false,
            altText: image.name || "来源图片",
        },
        meta: {},
    };
    store.put([asset, shape]);

    // 来源图必须进入绘图快照本身，不能继续依赖可能被替换或清理的原节点 URL。
    try {
        const render = await createInitialDrawingRender(dataUrl, width, height, page.id);
        return await saveCanvasDrawing(projectId, drawingId, store.getStoreSnapshot(), null, render.blob, render);
    } catch (error) {
        await removeCanvasDrawing(projectId, drawingId).catch((cleanupError) => console.warn("清理失败的绘图初始化数据失败", cleanupError));
        throw error;
    }
}

export async function loadCanvasDrawingPreview(projectId: string, drawingId: string) {
    if (!projectId || !drawingId) return null;
    return drawingPreviewStore.getItem<Blob>(drawingKey(projectId, drawingId));
}

export async function loadCanvasDrawingRender(projectId: string, drawingId: string) {
    if (!projectId || !drawingId) return null;
    return drawingRenderStore.getItem<CanvasDrawingRender>(drawingKey(projectId, drawingId));
}

export async function saveCanvasDrawingRenderPublication(projectId: string, drawingId: string, revision: number, publication: Pick<CanvasDrawingRenderDraft, "storageKey" | "url">) {
    const key = drawingKey(projectId, drawingId);
    const render = await drawingRenderStore.getItem<CanvasDrawingRender>(key);
    if (!render || render.revision !== revision) return false;
    await drawingRenderStore.setItem(key, { ...render, ...publication });
    return true;
}

export async function removeCanvasDrawing(projectId: string, drawingId: string) {
    if (!projectId || !drawingId) return;
    await Promise.all([
        drawingStore.removeItem(drawingKey(projectId, drawingId)),
        drawingPreviewStore.removeItem(drawingKey(projectId, drawingId)),
        drawingRenderStore.removeItem(drawingKey(projectId, drawingId)),
    ]);
}

export async function cloneCanvasDrawing(projectId: string, sourceDrawingId: string, targetDrawingId: string) {
    const [source, preview, render] = await Promise.all([
        loadCanvasDrawing(projectId, sourceDrawingId),
        loadCanvasDrawingPreview(projectId, sourceDrawingId),
        loadCanvasDrawingRender(projectId, sourceDrawingId),
    ]);
    if (!source) return null;
    const renderDraft = render
        ? {
              blob: render.blob,
              pageId: render.pageId,
              width: render.width,
              height: render.height,
              mimeType: render.mimeType,
              background: render.background,
              storageKey: render.storageKey,
              url: render.url,
          } satisfies CanvasDrawingRenderDraft
        : undefined;
    return saveCanvasDrawing(projectId, targetDrawingId, source.snapshot, null, preview || undefined, renderDraft);
}

export function summarizeCanvasDrawing(snapshot: unknown) {
    const root = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
    const document = root.document && typeof root.document === "object" ? root.document as Record<string, unknown> : root;
    const pages = pagesFromSnapshot(document);
    const store = document.store;
    const shapeCount = countRecords(document.shapes, "shape:") || countRecords(store, "shape:");
    const pageCount = pages || countRecords(store, "page:");
    return { shapeCount, pageCount: Math.max(pageCount, 1) };
}

function pagesFromSnapshot(document: Record<string, unknown>) {
    const pages = document.pages;
    return pages && typeof pages === "object" && !Array.isArray(pages) ? Object.keys(pages).length : 0;
}

function countRecords(value: unknown, prefix: string) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    return Object.keys(value).filter((key) => key.startsWith(prefix)).length;
}

async function createInitialDrawingRender(dataUrl: string, width: number, height: number, pageId: string): Promise<CanvasDrawingRenderDraft> {
    const source = await loadDrawingImage(dataUrl);
    const paddedWidth = width + INITIAL_DRAWING_RENDER_PADDING * 2;
    const paddedHeight = height + INITIAL_DRAWING_RENDER_PADDING * 2;
    const scale = Math.min(1, INITIAL_DRAWING_RENDER_MAX_DIMENSION / Math.max(paddedWidth, paddedHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(paddedWidth * scale));
    canvas.height = Math.max(1, Math.round(paddedHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建绘图预览");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
        source,
        Math.round(INITIAL_DRAWING_RENDER_PADDING * scale),
        Math.round(INITIAL_DRAWING_RENDER_PADDING * scale),
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale)),
    );
    const blob = await canvasToPngBlob(canvas);
    return {
        blob,
        pageId,
        width: canvas.width,
        height: canvas.height,
        mimeType: "image/png",
        background: "white",
    };
}

function loadDrawingImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("来源图片无法载入绘图"));
        image.src = dataUrl;
    });
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成绘图预览")), "image/png");
    });
}
