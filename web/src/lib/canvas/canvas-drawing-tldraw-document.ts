import { AssetRecordType, createShapeId, createTLStore, type TLImageShape } from "tldraw";

const INITIAL_DRAWING_SHAPE_MAX_DIMENSION = 1200;

type DrawingImageSource = {
    dataUrl: string;
    width: number;
    height: number;
    mimeType: string;
    name: string;
};

export async function createTldrawDrawingFromImage(source: DrawingImageSource) {
    const sourceBlob = await fetch(source.dataUrl).then((response) => response.blob());
    const store = createTLStore();
    const page = store.allRecords().find((record) => record.typeName === "page");
    if (!page) throw new Error("无法初始化 tldraw 绘图页面");

    const assetId = AssetRecordType.createId();
    const scale = Math.min(1, INITIAL_DRAWING_SHAPE_MAX_DIMENSION / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const asset = AssetRecordType.create({
        id: assetId,
        type: "image",
        props: {
            w: source.width,
            h: source.height,
            name: source.name,
            isAnimated: false,
            mimeType: source.mimeType,
            src: source.dataUrl,
            ...(sourceBlob.size > 0 ? { fileSize: sourceBlob.size } : {}),
        },
    });
    const shape: TLImageShape = {
        id: createShapeId(), typeName: "shape", type: "image", parentId: page.id,
        index: "a1" as TLImageShape["index"], x: -width / 2, y: -height / 2, rotation: 0,
        isLocked: false, opacity: 1,
        props: { w: width, h: height, playing: false, url: "", assetId, crop: null, flipX: false, flipY: false, altText: source.name },
        meta: {},
    };
    store.put([asset, shape]);
    return { snapshot: store.getStoreSnapshot(), pageId: page.id };
}
