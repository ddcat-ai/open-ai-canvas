import { saveAs } from "file-saver";

import { getResourceBlob, resourceStorageKey } from "@/services/api/resources";

import type { TryOnPrintMode } from "./tryon-kinds";

/** 印花提取的导出：在浏览器里把模型输出的图案稿做成 PNG（单独图案去底为透明），不额外调用模型、不产生费用。 */

async function loadCanvas(resourceId: string) {
    const blob = await getResourceBlob(resourceStorageKey(resourceId), "browser-process");
    if (!blob) throw new Error("读取印花图片失败，请稍后重试");
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器无法处理这张图片");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { canvas, context };
}

/**
 * 去掉与画面四边连通的纯色底（单独图案模式要求模型输出纯白底）：从四边向内泛洪，
 * 只扩散到与底色接近的像素，图案内部的白色不受影响；过渡带按色差给出半透明并去白边。
 */
export function cutoutBackground(image: ImageData, hard = 24, soft = 52) {
    const { width, height, data } = image;
    const border: number[] = [];
    for (let x = 0; x < width; x += 4) border.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y += 4) border.push(y * width, y * width + width - 1);
    const channel = (offset: number) => {
        const values = border.map((index) => data[index * 4 + offset]).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)] ?? 255;
    };
    const bg = [channel(0), channel(1), channel(2)];
    const distance = (index: number) => {
        const offset = index * 4;
        const dr = data[offset] - bg[0];
        const dg = data[offset + 1] - bg[1];
        const db = data[offset + 2] - bg[2];
        return Math.sqrt(dr * dr + dg * dg + db * db);
    };
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    const push = (index: number) => {
        if (visited[index] || distance(index) >= soft) return;
        visited[index] = 1;
        queue[tail++] = index;
    };
    for (let x = 0; x < width; x++) {
        push(x);
        push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        push(y * width);
        push(y * width + width - 1);
    }
    while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        if (x > 0) push(index - 1);
        if (x < width - 1) push(index + 1);
        if (index >= width) push(index - width);
        if (index < width * (height - 1)) push(index + width);
    }
    let removed = 0;
    for (let index = 0; index < width * height; index++) {
        if (!visited[index]) continue;
        const d = distance(index);
        const offset = index * 4;
        if (d < hard) {
            data[offset + 3] = 0;
            removed++;
            continue;
        }
        const alpha = Math.min(1, (d - hard) / (soft - hard));
        for (let c = 0; c < 3; c++) data[offset + c] = Math.max(0, Math.min(255, Math.round((data[offset + c] - (1 - alpha) * bg[c]) / Math.max(alpha, 0.05))));
        data[offset + 3] = Math.round(alpha * 255);
    }
    return removed / (width * height);
}

function toBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 导出失败"))), "image/png"));
}

async function patternCanvas(resourceId: string, mode: TryOnPrintMode) {
    const { canvas, context } = await loadCanvas(resourceId);
    if (mode !== "motif") return { original: canvas, pattern: canvas, transparent: false };
    const pattern = document.createElement("canvas");
    pattern.width = canvas.width;
    pattern.height = canvas.height;
    const target = pattern.getContext("2d");
    if (!target) throw new Error("浏览器无法处理这张图片");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const ratio = cutoutBackground(image);
    target.putImageData(image, 0, 0);
    // 底色几乎没被识别（模型没按纯白底输出）时保留原图，避免把图案本身抠掉。
    return { original: canvas, pattern: ratio > 0.02 ? pattern : canvas, transparent: ratio > 0.02 };
}

const safeName = (value: string) => value.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 60) || "印花";

export async function downloadPrintPng(resourceId: string, mode: TryOnPrintMode, name: string) {
    const { pattern, transparent } = await patternCanvas(resourceId, mode);
    saveAs(await toBlob(pattern), `${safeName(name)}${transparent ? "-透明底" : ""}.png`);
    return transparent;
}
