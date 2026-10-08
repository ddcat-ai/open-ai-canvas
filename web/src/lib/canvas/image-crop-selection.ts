import type { ImageCropRect } from "./image-operation-plan";
export type CropGrip = readonly [-1 | 0 | 1, -1 | 0 | 1];
const limit = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const minimum = 0.06;

export function translateSelection(box: ImageCropRect, dx: number, dy: number): ImageCropRect {
    return { width: box.width, height: box.height, x: limit(box.x + dx, 0, 1 - box.width), y: limit(box.y + dy, 0, 1 - box.height) };
}

export function resizeSelection(box: ImageCropRect, grip: CropGrip, dx: number, dy: number, fixedAspect: boolean): ImageCropRect {
    const [horizontal, vertical] = grip;
    if (!horizontal && !vertical) return box;
    if (!fixedAspect) {
        const minWidth = Math.min(minimum, box.width);
        const minHeight = Math.min(minimum, box.height);
        const left = horizontal < 0 ? limit(box.x + dx, 0, box.x + box.width - minWidth) : box.x;
        const right = horizontal > 0 ? limit(box.x + box.width + dx, box.x + minWidth, 1) : box.x + box.width;
        const top = vertical < 0 ? limit(box.y + dy, 0, box.y + box.height - minHeight) : box.y;
        const bottom = vertical > 0 ? limit(box.y + box.height + dy, box.y + minHeight, 1) : box.y + box.height;
        return { x: left, y: top, width: right - left, height: bottom - top };
    }
    // Project the gesture onto the original rectangle's scale vector around its opposite anchor.
    const fx = (1 - horizontal) / 2;
    const fy = (1 - vertical) / 2;
    const ax = box.x + box.width * fx;
    const ay = box.y + box.height * fy;
    const vx = horizontal * box.width;
    const vy = vertical * box.height;
    const proposed = 1 + (dx * vx + dy * vy) / (vx * vx + vy * vy);
    const capacity = (anchor: number, fraction: number) => Math.min(fraction ? anchor / fraction : Infinity, fraction < 1 ? (1 - anchor) / (1 - fraction) : Infinity);
    const ceiling = Math.min(capacity(ax, fx) / box.width, capacity(ay, fy) / box.height);
    const floor = Math.min(ceiling, Math.max(minimum / box.width, minimum / box.height));
    const factor = limit(proposed, floor, ceiling);
    const width = box.width * factor;
    const height = box.height * factor;
    return { x: ax - width * fx, y: ay - height * fy, width, height };
}

export function selectAspect(box: ImageCropRect, normalizedRatio: number): ImageCropRect {
    if (!Number.isFinite(normalizedRatio) || normalizedRatio <= 0) throw new RangeError("裁剪比例无效");
    const height = Math.min(1, 1 / normalizedRatio, Math.sqrt((box.width * box.height) / normalizedRatio));
    const width = height * normalizedRatio;
    return { width, height, x: limit(box.x + (box.width - width) / 2, 0, 1 - width), y: limit(box.y + (box.height - height) / 2, 0, 1 - height) };
}
