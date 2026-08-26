import crypto from "node:crypto";

import sharp from "sharp";

import type { PortraitImageQuality } from "./contracts.js";

export type DecodedPortraitImage = {
    width: number;
    height: number;
    channels: 3;
    rgb: Uint8Array;
    gray: Float32Array;
    byteHash: string;
    phash: string;
    quality: PortraitImageQuality;
};

export type GrayImage = { width: number; height: number; values: ArrayLike<number> };

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>) {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < a.length; index += 1) {
        const left = Number(a[index]);
        const right = Number(b[index]);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
        dot += left * right;
        normA += left * left;
        normB += right * right;
    }
    const denominator = Math.sqrt(normA * normB);
    return denominator > 0 ? dot / denominator : 0;
}

export function imageQuality(width: number, height: number, gray: ArrayLike<number>): PortraitImageQuality {
    if (gray.length !== width * height || width < 1 || height < 1) throw new Error("portrait_gray_buffer_invalid");
    let sum = 0;
    for (let index = 0; index < gray.length; index += 1) sum += Number(gray[index]);
    const brightness = sum / gray.length;
    let variance = 0;
    for (let index = 0; index < gray.length; index += 1) {
        const delta = Number(gray[index]) - brightness;
        variance += delta * delta;
    }
    const contrast = Math.sqrt(variance / gray.length);
    const sharpness = laplacianVariance(width, height, gray);
    const grade = sharpness >= 120 && brightness >= 55 && brightness <= 205 && contrast >= 35
        ? "good"
        : sharpness >= 50 && brightness >= 35 && brightness <= 225 && contrast >= 20
            ? "usable"
            : "poor";
    return {
        width,
        height,
        sharpness: round(sharpness),
        brightness: round(brightness),
        contrast: round(contrast),
        grade,
    };
}

export function laplacianVariance(width: number, height: number, gray: ArrayLike<number>) {
    if (width < 3 || height < 3) return 0;
    const responses: number[] = [];
    for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
            const center = Number(gray[y * width + x]);
            const response = 4 * center
                - Number(gray[(y - 1) * width + x])
                - Number(gray[(y + 1) * width + x])
                - Number(gray[y * width + x - 1])
                - Number(gray[y * width + x + 1]);
            responses.push(response);
        }
    }
    return varianceOf(responses);
}

export function structuralSimilarity(a: GrayImage, b: GrayImage) {
    const side = 64;
    const left = resizeGray(a, side, side);
    const right = resizeGray(b, side, side);
    const meanA = meanOf(left);
    const meanB = meanOf(right);
    const varianceA = varianceOf(left, meanA);
    const varianceB = varianceOf(right, meanB);
    let covariance = 0;
    for (let index = 0; index < left.length; index += 1) covariance += (left[index]! - meanA) * (right[index]! - meanB);
    covariance /= left.length;
    const c1 = 6.5025;
    const c2 = 58.5225;
    const value = ((2 * meanA * meanB + c1) * (2 * covariance + c2))
        / ((meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2));
    return clamp(round(value, 4), -1, 1);
}

export function colorHistogramCorrelation(a: Uint8Array, b: Uint8Array) {
    if (a.length % 3 !== 0 || b.length % 3 !== 0 || a.length === 0 || b.length === 0) return 0;
    const left = new Float64Array(64);
    const right = new Float64Array(64);
    for (let index = 0; index < a.length; index += 3) {
        left[colorBin(a[index]!, a[index + 1]!, a[index + 2]!) ] += 1;
        right[colorBin(b[index]!, b[index + 1]!, b[index + 2]!) ] += 1;
    }
    return clamp(round(pearson(left, right), 4), -1, 1);
}

export function computePHash(gray: GrayImage) {
    const size = 32;
    const source = resizeGray(gray, size, size);
    const coefficients = new Array<number>(64);
    for (let v = 0; v < 8; v += 1) {
        for (let u = 0; u < 8; u += 1) coefficients[v * 8 + u] = dctCoefficient(source, size, u, v);
    }
    const median = medianOf(coefficients.slice(1));
    let bits = "";
    for (const coefficient of coefficients) bits += coefficient > median ? "1" : "0";
    return bits;
}

export function hammingDistance(left: string, right: string) {
    if (left.length !== right.length) return Number.POSITIVE_INFINITY;
    let distance = 0;
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
    return distance;
}

export function sha256Hex(value: Uint8Array | Buffer) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

export async function decodePortraitImage(input: Uint8Array | Buffer): Promise<DecodedPortraitImage> {
    const source = Buffer.from(input);
    const decoded = await sharp(source, { failOn: "error" })
        .rotate()
        .flatten({ background: { r: 0, g: 0, b: 0 } })
        .toColorspace("srgb")
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const rgb = new Uint8Array(decoded.data);
    const gray = rgbToGray(rgb);
    const width = decoded.info.width;
    const height = decoded.info.height;
    return {
        width,
        height,
        channels: 3,
        rgb,
        gray,
        byteHash: sha256Hex(source),
        phash: computePHash({ width, height, values: gray }),
        quality: imageQuality(width, height, gray),
    };
}

export async function cropPortraitSearchImage(input: Uint8Array | Buffer, image: DecodedPortraitImage, bbox?: readonly [number, number, number, number]) {
    if (!bbox) return Buffer.from(input);
    const [left, top, right, bottom] = bbox;
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const paddingX = width * 0.35;
    const paddingY = height * 0.35;
    const cropLeft = clamp(Math.floor(left - paddingX), 0, image.width - 1);
    const cropTop = clamp(Math.floor(top - paddingY), 0, image.height - 1);
    const cropRight = clamp(Math.ceil(right + paddingX), cropLeft + 1, image.width);
    const cropBottom = clamp(Math.ceil(bottom + paddingY), cropTop + 1, image.height);
    return sharp(Buffer.from(image.rgb), { raw: { width: image.width, height: image.height, channels: 3 } })
        .extract({ left: cropLeft, top: cropTop, width: cropRight - cropLeft, height: cropBottom - cropTop })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
}

function rgbToGray(rgb: Uint8Array) {
    const gray = new Float32Array(rgb.length / 3);
    for (let index = 0, pixel = 0; index < rgb.length; index += 3, pixel += 1) {
        gray[pixel] = 0.114 * rgb[index + 2]! + 0.587 * rgb[index + 1]! + 0.299 * rgb[index]!;
    }
    return gray;
}

function resizeGray(image: GrayImage, width: number, height: number) {
    const result = new Float64Array(width * height);
    for (let y = 0; y < height; y += 1) {
        const sourceY = ((y + 0.5) * image.height / height) - 0.5;
        const y0 = clamp(Math.floor(sourceY), 0, image.height - 1);
        const y1 = clamp(y0 + 1, 0, image.height - 1);
        const fy = clamp(sourceY - Math.floor(sourceY), 0, 1);
        for (let x = 0; x < width; x += 1) {
            const sourceX = ((x + 0.5) * image.width / width) - 0.5;
            const x0 = clamp(Math.floor(sourceX), 0, image.width - 1);
            const x1 = clamp(x0 + 1, 0, image.width - 1);
            const fx = clamp(sourceX - Math.floor(sourceX), 0, 1);
            const top = Number(image.values[y0 * image.width + x0]) * (1 - fx) + Number(image.values[y0 * image.width + x1]) * fx;
            const bottom = Number(image.values[y1 * image.width + x0]) * (1 - fx) + Number(image.values[y1 * image.width + x1]) * fx;
            result[y * width + x] = top * (1 - fy) + bottom * fy;
        }
    }
    return result;
}

function dctCoefficient(values: ArrayLike<number>, size: number, u: number, v: number) {
    let total = 0;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) total += Number(values[y * size + x]) * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)) * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
    }
    const scale = (u === 0 ? 1 / Math.sqrt(2) : 1) * (v === 0 ? 1 / Math.sqrt(2) : 1);
    return (2 / size) * scale * total;
}

function colorBin(r: number, g: number, b: number) {
    return ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
}

function meanOf(values: ArrayLike<number>) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += Number(values[index]);
    return total / values.length;
}

function varianceOf(values: ArrayLike<number>, mean = meanOf(values)) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
        const delta = Number(values[index]) - mean;
        total += delta * delta;
    }
    return total / values.length;
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>) {
    const meanA = meanOf(a);
    const meanB = meanOf(b);
    let numerator = 0;
    let denominatorA = 0;
    let denominatorB = 0;
    for (let index = 0; index < a.length; index += 1) {
        const left = Number(a[index]) - meanA;
        const right = Number(b[index]) - meanB;
        numerator += left * right;
        denominatorA += left * left;
        denominatorB += right * right;
    }
    const denominator = Math.sqrt(denominatorA * denominatorB);
    return denominator ? numerator / denominator : isConstant(a) && isConstant(b) ? 1 : 0;
}

function isConstant(values: ArrayLike<number>) {
    if (!values.length) return false;
    const first = Number(values[0]);
    for (let index = 1; index < values.length; index += 1) if (Number(values[index]) !== first) return false;
    return true;
}

function medianOf(values: readonly number[]) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function round(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
