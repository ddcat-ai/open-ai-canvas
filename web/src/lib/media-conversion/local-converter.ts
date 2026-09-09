import type { MediaConversionOperation } from "./contracts";

export type LocalImageConversionResult = {
    blob: Blob;
    width: number;
    height: number;
};

export class LocalImageConversionError extends Error {
    constructor(readonly code: "model_missing" | "source_unreadable" | "browser_unsupported" | "aborted", message: string) {
        super(message);
        this.name = "LocalImageConversionError";
    }
}

export async function convertImageLocally(sourceUrl: string, operation: MediaConversionOperation, options: { signal?: AbortSignal; maxDimension?: number } = {}): Promise<LocalImageConversionResult> {
    throwIfAborted(options.signal);
    if (operation !== "grayscale" && operation !== "edge-canny") {
        throw new LocalImageConversionError("model_missing", "该转换需要先安装并验证本地模型");
    }

    const image = await loadImage(sourceUrl, options.signal);
    throwIfAborted(options.signal);
    const maxDimension = Math.max(256, options.maxDimension || 1024);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new LocalImageConversionError("browser_unsupported", "当前浏览器无法创建图片处理画布");
    context.drawImage(image, 0, 0, width, height);
    const input = context.getImageData(0, 0, width, height);
    const output = transformPixels(input.data, width, height, operation, options.signal);
    const outputImage = new ImageData(output, width, height);
    context.putImageData(outputImage, 0, 0);
    const blob = await canvasToBlob(canvas, options.signal);
    throwIfAborted(options.signal);
    return { blob, width, height };
}

/** Pure pixel transform used by the browser executor and unit tests. */
export function transformPixels(source: Uint8ClampedArray, width: number, height: number, operation: "grayscale" | "edge-canny", signal?: AbortSignal) {
    if (source.length !== width * height * 4) throw new Error("图片像素尺寸不匹配");
    if (operation === "grayscale") return grayscalePixels(source, width, height, signal);
    return cannyPixels(source, width, height, signal);
}

function grayscalePixels(source: Uint8ClampedArray, width: number, height: number, signal?: AbortSignal) {
    const output = new Uint8ClampedArray(source);
    for (let y = 0; y < height; y += 1) {
        throwIfAborted(signal);
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const value = Math.round(source[index] * 0.299 + source[index + 1] * 0.587 + source[index + 2] * 0.114);
            output[index] = value;
            output[index + 1] = value;
            output[index + 2] = value;
        }
    }
    return output;
}

function cannyPixels(source: Uint8ClampedArray, width: number, height: number, signal?: AbortSignal) {
    const gray = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        throwIfAborted(signal);
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            gray[y * width + x] = source[index] * 0.299 + source[index + 1] * 0.587 + source[index + 2] * 0.114;
        }
    }

    const blurred = gaussianBlur(gray, width, height, signal);
    const magnitude = new Float32Array(width * height);
    const direction = new Float32Array(width * height);
    let maximum = 0;
    for (let y = 1; y < height - 1; y += 1) {
        throwIfAborted(signal);
        for (let x = 1; x < width - 1; x += 1) {
            const index = y * width + x;
            const horizontal = blurred[index + 1] - blurred[index - 1];
            const vertical = blurred[index + width] - blurred[index - width];
            const value = Math.hypot(horizontal, vertical);
            magnitude[index] = value;
            direction[index] = Math.atan2(vertical, horizontal);
            maximum = Math.max(maximum, value);
        }
    }

    const thinned = nonMaximumSuppression(magnitude, direction, width, height, signal);
    const high = maximum * 0.28;
    const low = high * 0.45;
    const edges = new Uint8Array(width * height);
    const stack: number[] = [];
    for (let index = 0; index < thinned.length; index += 1) {
        if (thinned[index] >= high && high > 0) {
            edges[index] = 2;
            stack.push(index);
        } else if (thinned[index] >= low && low > 0) {
            edges[index] = 1;
        }
    }
    while (stack.length) {
        throwIfAborted(signal);
        const index = stack.pop()!;
        const x = index % width;
        const y = Math.floor(index / width);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                if (!offsetX && !offsetY) continue;
                const nextX = x + offsetX;
                const nextY = y + offsetY;
                if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
                const next = nextY * width + nextX;
                if (edges[next] !== 1) continue;
                edges[next] = 2;
                stack.push(next);
            }
        }
    }

    const output = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y += 1) {
        throwIfAborted(signal);
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const outputIndex = index * 4;
            const value = edges[index] === 2 ? 0 : 255;
            output[outputIndex] = value;
            output[outputIndex + 1] = value;
            output[outputIndex + 2] = value;
            output[outputIndex + 3] = source[outputIndex + 3];
        }
    }
    return output;
}

function gaussianBlur(source: Float32Array, width: number, height: number, signal?: AbortSignal) {
    const output = new Float32Array(source.length);
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    for (let y = 0; y < height; y += 1) {
        throwIfAborted(signal);
        for (let x = 0; x < width; x += 1) {
            let value = 0;
            let weight = 0;
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
                for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                    const nextX = Math.min(width - 1, Math.max(0, x + offsetX));
                    const nextY = Math.min(height - 1, Math.max(0, y + offsetY));
                    const kernelWeight = kernel[(offsetY + 1) * 3 + offsetX + 1];
                    value += source[nextY * width + nextX] * kernelWeight;
                    weight += kernelWeight;
                }
            }
            output[y * width + x] = value / weight;
        }
    }
    return output;
}

function nonMaximumSuppression(magnitude: Float32Array, direction: Float32Array, width: number, height: number, signal?: AbortSignal) {
    const output = new Float32Array(magnitude.length);
    for (let y = 1; y < height - 1; y += 1) {
        throwIfAborted(signal);
        for (let x = 1; x < width - 1; x += 1) {
            const index = y * width + x;
            let angle = (direction[index] * 180) / Math.PI;
            if (angle < 0) angle += 180;
            const value = magnitude[index];
            let before = 0;
            let after = 0;
            if (angle < 22.5 || angle >= 157.5) {
                before = magnitude[index - 1];
                after = magnitude[index + 1];
            } else if (angle < 67.5) {
                before = magnitude[index - width + 1];
                after = magnitude[index + width - 1];
            } else if (angle < 112.5) {
                before = magnitude[index - width];
                after = magnitude[index + width];
            } else {
                before = magnitude[index - width - 1];
                after = magnitude[index + width + 1];
            }
            output[index] = value >= before && value >= after ? value : 0;
        }
    }
    return output;
}

async function loadImage(sourceUrl: string, signal?: AbortSignal) {
    if (!sourceUrl) throw new LocalImageConversionError("source_unreadable", "没有可读取的图片输入");
    const image = new Image();
    image.crossOrigin = "anonymous";
    return await new Promise<HTMLImageElement>((resolve, reject) => {
        const abort = () => {
            image.src = "";
            reject(new LocalImageConversionError("aborted", "转换已取消"));
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => {
            signal?.removeEventListener("abort", abort);
            resolve(image);
        };
        image.onerror = () => {
            signal?.removeEventListener("abort", abort);
            reject(new LocalImageConversionError("source_unreadable", "图片无法读取，可能是跨域资源或已失效"));
        };
        image.src = sourceUrl;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, signal?: AbortSignal) {
    throwIfAborted(signal);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new LocalImageConversionError("browser_unsupported", "当前浏览器无法导出图片结果"));
        }, "image/png");
    });
}

function throwIfAborted(signal?: AbortSignal): asserts signal is AbortSignal | undefined {
    if (signal?.aborted) throw new LocalImageConversionError("aborted", "转换已取消");
}
