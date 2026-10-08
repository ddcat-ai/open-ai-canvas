import { loadRasterImage } from "@/lib/image-raster";
import { planImageTiles, resolveCropPixels, resolveUpscaleSize, type ImageCropRect, type ImageSplitParams, type ImageSplitPiece, type ImageUpscaleAlgorithm, type ImageUpscaleParams, type PixelSize } from "./image-operation-plan";

export { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize } from "./image-operation-plan";
export type { ImageCropRect, ImageSplitParams, ImageSplitPiece, ImageUpscaleAlgorithm, ImageUpscaleParams } from "./image-operation-plan";

type RasterCommand = {
    region: ImageCropRect;
    output: PixelSize;
    sampling: ImageUpscaleAlgorithm;
};

/** One raster pass shared by crop, grid extraction and resize. Failures never return the original as success. */
function renderPng(source: HTMLImageElement, command: RasterCommand): string {
    const output = document.createElement("canvas");
    Object.assign(output, command.output);
    const painter = output.getContext("2d");
    if (painter === null) throw new Error("浏览器无法创建图片处理画布");
    const { region, sampling } = command;
    painter.imageSmoothingEnabled = sampling !== "nearest";
    painter.imageSmoothingQuality = sampling === "high" ? "high" : "low";
    painter.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, output.width, output.height);
    const result = output.toDataURL("image/png");
    if (!result.startsWith("data:image/png")) throw new Error("图片导出失败");
    return result;
}

const dimensions = (image: HTMLImageElement): PixelSize => ({ width: image.naturalWidth, height: image.naturalHeight });

export async function cropDataUrl(source: string, selection?: ImageCropRect): Promise<string> {
    const picture = await loadRasterImage(source);
    const region = resolveCropPixels(dimensions(picture), selection);
    return renderPng(picture, { region, output: { width: region.width, height: region.height }, sampling: "nearest" });
}

export async function splitDataUrl(source: string, grid: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const picture = await loadRasterImage(source);
    return planImageTiles(dimensions(picture), grid).map((region) => ({
        row: region.row,
        column: region.column,
        dataUrl: renderPng(picture, { region, output: { width: region.width, height: region.height }, sampling: "nearest" }),
    }));
}

export async function upscaleDataUrl(source: string, options: ImageUpscaleParams): Promise<string> {
    if (!["nearest", "bilinear", "high"].includes(options.algorithm)) throw new RangeError("不支持的图片插值方式");
    const picture = await loadRasterImage(source);
    const size = dimensions(picture);
    return renderPng(picture, {
        region: { ...size, x: 0, y: 0 },
        output: resolveUpscaleSize(size.width, size.height, options.targetLongEdge),
        sampling: options.algorithm,
    });
}
