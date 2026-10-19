import type { CanvasAppearance } from "./agent-appearance";
import type { PetAppearance, PetPreference } from "@/services/api/appearance";

export const DEFAULT_PET_PREFERENCE: PetPreference = { modelId: "system", scale: 100, locked: false, hidden: false, revision: 0 };
export function effectivePet(canvas: CanvasAppearance, catalog: PetAppearance[], modelId: string): CanvasAppearance {
    const pet = catalog.find((p) => p.published && p.id === modelId);
    return pet ? { ...canvas, ...pet } : canvas;
}
/** Fit every model in the same square stage without stretching wide or tall sprites. */
export function petAvatarSize(pet: Pick<CanvasAppearance, "avatarType" | "sprite">, size: number) {
    // A filled disc carries more visual weight than a character silhouette.
    if (pet.avatarType === "orb") return { width: size * 0.6, height: size * 0.6 };
    const ratio = pet.avatarType === "sprite" && pet.sprite ? pet.sprite.frameWidth / pet.sprite.frameHeight : pet.avatarType === "live2d" ? 0.75 : 1;
    return { width: Math.min(size, size * ratio), height: Math.min(size, size / ratio) };
}
/** Keep the status dot outside the rendered silhouette at every personal scale. */
export function petStatusPosition(pet: Pick<CanvasAppearance, "avatarType" | "sprite">, stage: number) {
    const fitted = petAvatarSize(pet, stage),
        size = 8,
        gap = 3;
    if (pet.avatarType === "orb") {
        const offset = (fitted.height / 2 + gap + size / 2) / Math.SQRT2;
        return { top: stage / 2 - offset - size / 2, right: stage / 2 - offset - size / 2, width: size, height: size };
    }
    return { top: (stage - fitted.height) / 2 + 6, right: (stage - fitted.width) / 2 - gap - size, width: size, height: size };
}
export function petMenuPosition(rect: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }) {
    const width = Math.min(416, viewport.width - 24),
        height = Math.min(352, viewport.height - 24);
    const right = rect.left + rect.width / 2 > viewport.width / 2;
    const bottom = rect.top + rect.height / 2 > viewport.height / 2;
    return {
        left: Math.max(12, Math.min(viewport.width - width - 12, rect.left + rect.width / 2 - width / 2)),
        top: Math.max(12, Math.min(viewport.height - height - 12, rect.top + rect.height / 2 - 208)),
        width,
        height,
        right,
        bottom,
    };
}
export function petRingSector(index: number, thumbnail = false, geometry = { center: 256, inner: 116, rotation: 0 }) {
    const center = geometry.center,
        inner = thumbnail ? geometry.inner + 72 : geometry.inner,
        outer = inner + (thumbnail ? 56 : 64);
    const middle = (thumbnail ? -126 + index * 24 : -129 + index * 26) + geometry.rotation;
    const start = middle - (thumbnail ? 10 : 12),
        end = middle + (thumbnail ? 10 : 12);
    const point = (radius: number, angle: number) => ({ x: center + radius * Math.cos((angle * Math.PI) / 180), y: center + radius * Math.sin((angle * Math.PI) / 180) });
    const a = point(outer, start),
        b = point(outer, end),
        c = point(inner, end),
        d = point(inner, start);
    const points = [a, b, c, d];
    for (let quadrant = Math.ceil(start / 90); quadrant * 90 <= end; quadrant++) points.push(point(outer, quadrant * 90), point(inner, quadrant * 90));
    const left = Math.min(...points.map((p) => p.x)),
        top = Math.min(...points.map((p) => p.y));
    const width = Math.max(...points.map((p) => p.x)) - left,
        height = Math.max(...points.map((p) => p.y)) - top;
    const p = (value: { x: number; y: number }) => `${(value.x - left).toFixed(3)} ${(value.y - top).toFixed(3)}`;
    const corner = 10,
        eo = ((corner / outer) * 180) / Math.PI,
        ei = ((corner / inner) * 180) / Math.PI;
    const path = `M ${p(point(outer, start + eo))} A ${outer} ${outer} 0 0 1 ${p(point(outer, end - eo))} Q ${p(b)} ${p(point(outer - corner, end))} L ${p(point(inner + corner, end))} Q ${p(c)} ${p(point(inner, end - ei))} A ${inner} ${inner} 0 0 0 ${p(point(inner, start + ei))} Q ${p(d)} ${p(point(inner + corner, start))} L ${p(point(outer - corner, start))} Q ${p(a)} ${p(point(outer, start + eo))} Z`;
    const label = point((inner + outer) / 2, middle);
    return { left, top, width, height, path, label: { x: label.x - left, y: label.y - top } };
}
export function petArcLayout(rect: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }) {
    const cx = rect.left + rect.width / 2,
        cy = rect.top + rect.height / 2,
        half = Math.max(rect.width, rect.height) / 2;
    const inner = Math.max(88, half + 12),
        center = inner + 136,
        preferred = (Math.atan2(viewport.height / 2 - cy, viewport.width / 2 - cx) * 180) / Math.PI + 90;
    const distance = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    let rotation = preferred,
        best = Infinity;
    for (let angle = 0; angle < 360; angle += 3) {
        let overflow = 0;
        for (const [radius, start, end] of [
            [inner + 64, -141, -39],
            [inner + 128, -136, -44],
        ])
            for (let degrees = start; degrees <= end; degrees += 2) {
                const x = cx + radius * Math.cos(((degrees + angle) * Math.PI) / 180),
                    y = cy + radius * Math.sin(((degrees + angle) * Math.PI) / 180);
                overflow += Math.max(0, 12 - x, x - viewport.width + 12) + Math.max(0, 12 - y, y - viewport.height + 12);
            }
        const score = overflow * 100 + distance(angle, preferred);
        if (score < best) {
            best = score;
            rotation = angle;
        }
    }
    let close = { x: cx, y: cy },
        closeScore = Infinity;
    for (let r = half + 24; r <= half + 88; r += 4)
        for (let angle = 0; angle < 360; angle += 5) {
            const x = cx + r * Math.cos((angle * Math.PI) / 180),
                y = cy + r * Math.sin((angle * Math.PI) / 180);
            if (x < 30 || y < 30 || x > viewport.width - 30 || y > viewport.height - 30) continue;
            if (x + 24 > rect.left && x - 24 < rect.left + rect.width && y + 24 > rect.top && y - 24 < rect.top + rect.height) continue;
            if (distance(angle, rotation - 90) < 70 && r >= inner - 20 && r <= inner + 84) continue;
            const score = r + distance(angle, preferred - 90) * 0.1;
            if (score < closeScore) {
                closeScore = score;
                close = { x, y };
            }
        }
    return { left: cx - center, top: cy - center, width: center * 2, height: center * 2, center, inner, rotation, close: { left: close.x - cx + center - 18, top: close.y - cy + center - 18 } };
}
export function sanitizePetPreference(value: Partial<PetPreference>): PetPreference {
    return {
        modelId: typeof value.modelId === "string" && value.modelId.length <= 64 ? value.modelId : "system",
        scale: Math.max(50, Math.min(150, Math.round((Number(value.scale) || 100) / 5) * 5)),
        locked: !!value.locked,
        hidden: !!value.hidden,
        revision: Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 ? Number(value.revision) : 0,
    };
}
