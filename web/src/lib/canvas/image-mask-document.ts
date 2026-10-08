export type MaskPoint = readonly [number, number];
export type MaskStroke = { diameter: number; erase: boolean; points: MaskPoint[] };

/** A stroke document is the source of truth; previews and exported masks are separate renders. */
export function paintMaskStrokes(canvas: HTMLCanvasElement, strokes: readonly MaskStroke[], color: string): CanvasRenderingContext2D {
    const brush = canvas.getContext("2d", { willReadFrequently: true });
    if (!brush) throw new Error("无法创建遮罩画布");
    brush.clearRect(0, 0, canvas.width, canvas.height);
    brush.lineCap = "round";
    brush.lineJoin = "round";
    brush.fillStyle = brush.strokeStyle = color;
    for (const stroke of strokes) {
        const first = stroke.points[0];
        if (!first) continue;
        brush.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
        brush.lineWidth = stroke.diameter;
        const path = new Path2D();
        if (stroke.points.length === 1) {
            path.arc(first[0], first[1], stroke.diameter / 2, 0, Math.PI * 2);
            brush.fill(path);
        } else {
            path.moveTo(first[0], first[1]);
            for (const [x, y] of stroke.points.slice(1)) path.lineTo(x, y);
            brush.stroke(path);
        }
    }
    brush.globalCompositeOperation = "source-over";
    return brush;
}

export function invertSelectionAlpha(selection: Uint8ClampedArray): Uint8ClampedArray {
    if (selection.length % 4 !== 0) throw new RangeError("遮罩像素数据无效");
    let selected = false;
    const result = new Uint8ClampedArray(selection.length).fill(255);
    for (let pixel = 0; pixel < selection.length / 4; pixel++) {
        if (selection[pixel * 4 + 3] === 0) continue;
        selected = true;
        result[pixel * 4 + 3] = 0;
    }
    if (!selected) throw new Error("请先涂抹需要修改的区域");
    return result;
}

export function exportEditMask(width: number, height: number, strokes: readonly MaskStroke[]): string {
    const surface = document.createElement("canvas");
    Object.assign(surface, { width, height });
    const brush = paintMaskStrokes(surface, strokes, "black");
    const pixels = brush.getImageData(0, 0, width, height);
    pixels.data.set(invertSelectionAlpha(pixels.data));
    brush.putImageData(pixels, 0, 0);
    const png = surface.toDataURL("image/png");
    if (!png.startsWith("data:image/png")) throw new Error("遮罩导出失败");
    return png;
}
