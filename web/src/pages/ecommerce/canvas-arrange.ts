/** 画布多选排布。输入、输出都使用画布世界坐标：x/y 为图片框左上角。 */
export type CommerceArrangeBox = { id: string; x: number; y: number; width: number; height: number };
export type CommerceArrangePoint = { id: string; x: number; y: number };
export type CommerceArrangeKind = "align-left" | "align-center" | "align-right" | "align-top" | "align-middle" | "align-bottom" | "distribute-horizontal" | "distribute-vertical" | "grid" | "masonry" | "row" | "column";

/** 与默认套版的图片间距保持一致。 */
export const COMMERCE_ARRANGE_GAP = 28;

/** 等距分布至少需要 3 张，其他排布至少 2 张。 */
export function commerceArrangeMinimum(kind: CommerceArrangeKind) {
    return kind === "distribute-horizontal" || kind === "distribute-vertical" ? 3 : 2;
}

function selectionBounds(boxes: CommerceArrangeBox[]) {
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** 阅读顺序：顶边落在当前行最矮图片上半段内的视为同一行，行内从左到右。 */
function readingOrder(boxes: CommerceArrangeBox[]) {
    const rows: CommerceArrangeBox[][] = [];
    for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
        const row = rows.at(-1);
        if (row && box.y < row[0].y + Math.min(...row.map((item) => item.height)) / 2) row.push(box);
        else rows.push([box]);
    }
    return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.y - b.y));
}

function stack(ordered: CommerceArrangeBox[], axis: "x" | "y", start: number, cross: number, gap: number) {
    let cursor = start;
    return ordered.map((box) => {
        const point = axis === "x" ? { id: box.id, x: cursor, y: cross } : { id: box.id, x: cross, y: cursor };
        cursor += (axis === "x" ? box.width : box.height) + gap;
        return point;
    });
}

function distribute(boxes: CommerceArrangeBox[], axis: "x" | "y", start: number, span: number) {
    const size = (box: CommerceArrangeBox) => (axis === "x" ? box.width : box.height);
    const ordered = [...boxes].sort((a, b) => a[axis] + size(a) / 2 - (b[axis] + size(b) / 2) || a.id.localeCompare(b.id));
    const space = (span - ordered.reduce((sum, box) => sum + size(box), 0)) / (ordered.length - 1);
    let cursor = start;
    return ordered.map((box) => {
        const point = axis === "x" ? { id: box.id, x: cursor, y: box.y } : { id: box.id, x: box.x, y: cursor };
        cursor += size(box) + space;
        return point;
    });
}

/**
 * 返回每张图片的新左上角。对齐与分布以选区外框为基准（与常见设计工具一致）；
 * 网格、瀑布流、横排、竖排从选区左上角开始，按阅读顺序或当前先后顺序排布。
 * 数量不足时原样返回。结果取整，避免亚像素模糊。
 */
export function arrangeCommerceBoxes(boxes: CommerceArrangeBox[], kind: CommerceArrangeKind, gap = COMMERCE_ARRANGE_GAP): CommerceArrangePoint[] {
    if (boxes.length < commerceArrangeMinimum(kind)) return boxes.map(({ id, x, y }) => ({ id, x, y }));
    const bounds = selectionBounds(boxes);
    const columns = Math.ceil(Math.sqrt(boxes.length));
    const placed = (() => {
        switch (kind) {
            case "align-left":
                return boxes.map((box) => ({ id: box.id, x: bounds.left, y: box.y }));
            case "align-center":
                return boxes.map((box) => ({ id: box.id, x: bounds.left + (bounds.width - box.width) / 2, y: box.y }));
            case "align-right":
                return boxes.map((box) => ({ id: box.id, x: bounds.right - box.width, y: box.y }));
            case "align-top":
                return boxes.map((box) => ({ id: box.id, x: box.x, y: bounds.top }));
            case "align-middle":
                return boxes.map((box) => ({ id: box.id, x: box.x, y: bounds.top + (bounds.height - box.height) / 2 }));
            case "align-bottom":
                return boxes.map((box) => ({ id: box.id, x: box.x, y: bounds.bottom - box.height }));
            case "distribute-horizontal":
                return distribute(boxes, "x", bounds.left, bounds.width);
            case "distribute-vertical":
                return distribute(boxes, "y", bounds.top, bounds.height);
            case "row":
                return stack(
                    [...boxes].sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2) || a.y - b.y),
                    "x",
                    bounds.left,
                    bounds.top,
                    gap,
                );
            case "column":
                return stack(
                    [...boxes].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x),
                    "y",
                    bounds.top,
                    bounds.left,
                    gap,
                );
            case "grid": {
                const ordered = readingOrder(boxes);
                const cell = Math.max(...ordered.map((box) => box.width));
                const points: CommerceArrangePoint[] = [];
                let top = bounds.top;
                for (let index = 0; index < ordered.length; index += columns) {
                    const row = ordered.slice(index, index + columns);
                    row.forEach((box, column) => points.push({ id: box.id, x: bounds.left + column * (cell + gap), y: top }));
                    top += Math.max(...row.map((box) => box.height)) + gap;
                }
                return points;
            }
            case "masonry": {
                const cell = Math.max(...boxes.map((box) => box.width));
                const heights = Array.from({ length: columns }, () => bounds.top);
                return readingOrder(boxes).map((box) => {
                    const column = heights.indexOf(Math.min(...heights));
                    const point = { id: box.id, x: bounds.left + column * (cell + gap), y: heights[column] };
                    heights[column] += box.height + gap;
                    return point;
                });
            }
        }
    })();
    return placed.map((point) => ({ id: point.id, x: Math.round(point.x), y: Math.round(point.y) }));
}
