/**
 * 画布移动吸附与对齐参考线。坐标均为画布世界坐标（未缩放）。
 * 拖动时与其他元素的左/中/右、上/中/下对齐，或与相邻图片保持默认 28px 间距；
 * 阈值按屏幕像素换算成世界坐标，缩放后手感一致。
 */
export type SnapBox = { x: number; y: number; width: number; height: number };
export type SnapGuide = { kind: "line"; axis: "x" | "y"; position: number; start: number; end: number } | { kind: "gap"; axis: "x" | "y"; start: number; end: number; cross: number };
export type SnapScene = { moving: SnapBox | null; targets: SnapBox[] };

/** 吸附阈值（屏幕像素）。 */
export const COMMERCE_SNAP_THRESHOLD = 6;
/** 与默认套版一致的图片间距。 */
export const COMMERCE_SNAP_GAP = 28;
/** 判定“已对齐”的容差，吸收 DOM 测量的亚像素误差。 */
const EPSILON = 0.5;

type Candidate = { diff: number; gap: boolean };
const lines = (start: number, size: number) => [start, start + size / 2, start + size];
const overlaps = (start: number, size: number, otherStart: number, otherSize: number) => start < otherStart + otherSize && start + size > otherStart;

function closer(current: Candidate | null, next: Candidate, threshold: number) {
    if (Math.abs(next.diff) > threshold) return current;
    if (!current) return next;
    const delta = Math.abs(next.diff) - Math.abs(current.diff);
    // 距离相同时优先边缘/中线对齐，其次才是间距。
    return delta < -0.01 || (delta <= 0.01 && current.gap && !next.gap) ? next : current;
}

export function unionSnapBox(boxes: SnapBox[]): SnapBox | null {
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 在 (dx, dy) 附近寻找最近的吸附位置；横纵方向分别吸附，返回修正后的位移与要显示的参考线。 */
export function snapCommerceMove(moving: SnapBox, dx: number, dy: number, targets: SnapBox[], threshold: number, gap = COMMERCE_SNAP_GAP) {
    const box = { ...moving, x: moving.x + dx, y: moving.y + dy };
    let snapX: Candidate | null = null;
    let snapY: Candidate | null = null;
    const ownX = lines(box.x, box.width);
    const ownY = lines(box.y, box.height);
    for (const target of targets) {
        for (const line of lines(target.x, target.width)) for (const own of ownX) snapX = closer(snapX, { diff: line - own, gap: false }, threshold);
        for (const line of lines(target.y, target.height)) for (const own of ownY) snapY = closer(snapY, { diff: line - own, gap: false }, threshold);
        if (overlaps(box.y, box.height, target.y, target.height)) {
            snapX = closer(snapX, { diff: target.x + target.width + gap - box.x, gap: true }, threshold);
            snapX = closer(snapX, { diff: target.x - gap - box.x - box.width, gap: true }, threshold);
        }
        if (overlaps(box.x, box.width, target.x, target.width)) {
            snapY = closer(snapY, { diff: target.y + target.height + gap - box.y, gap: true }, threshold);
            snapY = closer(snapY, { diff: target.y - gap - box.y - box.height, gap: true }, threshold);
        }
    }
    const nextDx = dx + (snapX?.diff ?? 0);
    const nextDy = dy + (snapY?.diff ?? 0);
    return { dx: nextDx, dy: nextDy, guides: commerceSnapGuides({ ...moving, x: moving.x + nextDx, y: moving.y + nextDy }, targets, gap) };
}

/** 计算当前位置下的参考线：对齐线贯穿所有对齐的元素；间距标注只画与默认间距一致的相邻元素。 */
export function commerceSnapGuides(box: SnapBox, targets: SnapBox[], gap = COMMERCE_SNAP_GAP): SnapGuide[] {
    const vertical = new Map<number, { start: number; end: number }>();
    const horizontal = new Map<number, { start: number; end: number }>();
    const gaps = new Map<string, SnapGuide>();
    const extend = (map: Map<number, { start: number; end: number }>, position: number, start: number, end: number) => {
        const key = Math.round(position * 2) / 2;
        const current = map.get(key);
        map.set(key, current ? { start: Math.min(current.start, start), end: Math.max(current.end, end) } : { start, end });
    };
    for (const target of targets) {
        for (const line of lines(target.x, target.width)) for (const own of lines(box.x, box.width)) if (Math.abs(line - own) < EPSILON) extend(vertical, own, Math.min(box.y, target.y), Math.max(box.y + box.height, target.y + target.height));
        for (const line of lines(target.y, target.height)) for (const own of lines(box.y, box.height)) if (Math.abs(line - own) < EPSILON) extend(horizontal, own, Math.min(box.x, target.x), Math.max(box.x + box.width, target.x + target.width));
        if (overlaps(box.y, box.height, target.y, target.height)) {
            const cross = (Math.max(box.y, target.y) + Math.min(box.y + box.height, target.y + target.height)) / 2;
            if (Math.abs(box.x - target.x - target.width - gap) < EPSILON) gaps.set("left", { kind: "gap", axis: "x", start: target.x + target.width, end: box.x, cross });
            if (Math.abs(target.x - box.x - box.width - gap) < EPSILON) gaps.set("right", { kind: "gap", axis: "x", start: box.x + box.width, end: target.x, cross });
        }
        if (overlaps(box.x, box.width, target.x, target.width)) {
            const cross = (Math.max(box.x, target.x) + Math.min(box.x + box.width, target.x + target.width)) / 2;
            if (Math.abs(box.y - target.y - target.height - gap) < EPSILON) gaps.set("top", { kind: "gap", axis: "y", start: target.y + target.height, end: box.y, cross });
            if (Math.abs(target.y - box.y - box.height - gap) < EPSILON) gaps.set("bottom", { kind: "gap", axis: "y", start: box.y + box.height, end: target.y, cross });
        }
    }
    return [...Array.from(vertical, ([position, span]): SnapGuide => ({ kind: "line", axis: "x", position, ...span })), ...Array.from(horizontal, ([position, span]): SnapGuide => ({ kind: "line", axis: "y", position, ...span })), ...gaps.values()];
}

/** 读取世界层内所有画布元素（生成图、上传图、文字）的世界坐标框；moving 为正在拖动的元素。 */
export function measureCommerceSnapScene(world: HTMLElement, moving: Element[], scale: number): SnapScene {
    const origin = world.getBoundingClientRect();
    const safeScale = scale > 0 ? scale : 1;
    const box = (element: Element): SnapBox => {
        const rect = element.getBoundingClientRect();
        return { x: (rect.left - origin.left) / safeScale, y: (rect.top - origin.top) / safeScale, width: rect.width / safeScale, height: rect.height / safeScale };
    };
    const own = new Set<Element>(moving);
    return {
        moving: unionSnapBox(moving.map(box)),
        targets: Array.from(world.querySelectorAll("[data-node-id]"))
            .filter((element) => !own.has(element))
            .map(box)
            .filter((item) => item.width > 0 && item.height > 0),
    };
}

/** 把参考线画到世界坐标层；线宽和字号按缩放反算，屏幕上始终保持 1px 细线。 */
export function paintCommerceSnapGuides(layer: HTMLElement | null | undefined, guides: SnapGuide[], scale: number) {
    if (!layer) return;
    layer.style.setProperty("--commerce-snap-inverse", String(1 / Math.max(scale, 0.05)));
    guides.forEach((guide, index) => {
        const element = (layer.children[index] as HTMLElement | undefined) ?? layer.appendChild(document.createElement("i"));
        element.className = `commerce-snap-${guide.kind} is-${guide.axis}`;
        const style =
            guide.kind === "line"
                ? guide.axis === "x"
                    ? { left: guide.position, top: guide.start, width: null, height: guide.end - guide.start }
                    : { left: guide.start, top: guide.position, width: guide.end - guide.start, height: null }
                : guide.axis === "x"
                  ? { left: guide.start, top: guide.cross, width: guide.end - guide.start, height: null }
                  : { left: guide.cross, top: guide.start, width: null, height: guide.end - guide.start };
        element.style.left = `${style.left}px`;
        element.style.top = `${style.top}px`;
        element.style.width = style.width === null ? "" : `${style.width}px`;
        element.style.height = style.height === null ? "" : `${style.height}px`;
        if (guide.kind === "gap") element.dataset.label = String(Math.round(guide.end - guide.start));
        else delete element.dataset.label;
    });
    while (layer.children.length > guides.length) layer.lastElementChild?.remove();
}
