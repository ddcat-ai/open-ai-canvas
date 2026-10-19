import { expect, test } from "bun:test";
import { effectivePet, petAvatarSize, petStatusPosition, petMenuPosition, petRingSector, petArcLayout, sanitizePetPreference } from "../src/lib/canvas/pet-menu";
import { DEFAULT_CANVAS_APPEARANCE } from "../src/lib/canvas/agent-appearance";
import type { PetAppearance } from "../src/services/api/appearance";

test("published personal choice preserves assistant identity and falls back after unpublish", () => {
    const base = { ...DEFAULT_CANVAS_APPEARANCE, agentName: "阿Q" };
    const pet: PetAppearance = { id: "custom", name: "仅展示名称", published: true, avatarType: "orb", avatarHeight: 300, live2dResourceId: "", live2dEntry: "" };
    expect(effectivePet(base, [pet], pet.id).agentName).toBe("阿Q");
    expect(effectivePet(base, [pet], pet.id).avatarHeight).toBe(300);
    expect(effectivePet(base, [{ ...pet, published: false }], pet.id)).toBe(base);
    expect(effectivePet(base, [pet], "system")).toBe(base);
});
test("menu stays inside every viewport corner independently of pet dimensions", () => {
    for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
        { width: 320, height: 400 },
    ])
        for (const x of [0, viewport.width - 200])
            for (const y of [0, viewport.height - 200]) {
                const p = petMenuPosition({ left: x, top: y, width: 200, height: 200 }, viewport);
                expect(p.left).toBeGreaterThanOrEqual(12);
                expect(p.top).toBeGreaterThanOrEqual(12);
                expect(p.left + p.width).toBeLessThanOrEqual(viewport.width - 12);
                expect(p.top + p.height).toBeLessThanOrEqual(viewport.height - 12);
            }
});
test("corrupt cached settings cannot create oversized or non-finite pets", () => {
    expect(sanitizePetPreference({ scale: Infinity }).scale).toBe(150);
    expect(sanitizePetPreference({ scale: 55 }).scale).toBe(55);
    expect(sanitizePetPreference({ scale: 1 }).scale).toBe(50);
    expect(sanitizePetPreference({ scale: NaN }).scale).toBe(100);
});
test("different silhouettes share a bounded stage while retaining their proportions", () => {
    const orb = { avatarType: "orb" } as const;
    const live = { avatarType: "live2d" } as const;
    expect(petAvatarSize(orb, 208).height).toBeCloseTo(124.8);
    expect(petAvatarSize(orb, 104).height).toBeCloseTo(62.4);
    expect(petAvatarSize(live, 208)).toEqual({ width: 156, height: 208 });
    for (const [w, h] of [
        [192, 208],
        [500, 100],
        [100, 500],
    ]) {
        const result = petAvatarSize({ avatarType: "sprite", sprite: { frameWidth: w, frameHeight: h } as PetAppearance["sprite"] }, 88);
        expect(result.width).toBeLessThanOrEqual(88);
        expect(result.height).toBeLessThanOrEqual(88);
        expect(Math.max(result.width, result.height)).toBe(88);
        expect(result.width / result.height).toBeCloseTo(w / h, 4);
    }
});
test("status dot clears the circle at every scale and stays outside rectangular silhouettes", () => {
    for (const stage of [24, 64, 104, 156, 208, 312, 360]) {
        const orb = { avatarType: "orb" } as const;
        const dot = petStatusPosition(orb, stage);
        const cx = stage - dot.right - dot.width / 2,
            cy = dot.top + dot.height / 2;
        expect(Math.hypot(cx - stage / 2, cy - stage / 2) - dot.width / 2 - petAvatarSize(orb, stage).height / 2).toBeCloseTo(3, 5);
        expect(dot.width).toBe(8);
        for (const pet of [
            { avatarType: "live2d" } as const,
            ...[
                [192, 208],
                [500, 100],
                [100, 500],
            ].map(([w, h]) => ({ avatarType: "sprite" as const, sprite: { frameWidth: w, frameHeight: h } as PetAppearance["sprite"] })),
        ]) {
            const bounds = petAvatarSize(pet, stage),
                marker = petStatusPosition(pet, stage);
            expect(stage - marker.right - marker.width - (stage + bounds.width) / 2).toBeCloseTo(3, 5);
            expect(marker.right).toBeGreaterThanOrEqual(-11);
        }
    }
});

test("arc items use fixed steps and leave unused space instead of filling a circle", () => {
    const angles = [];
    for (let i = 0; i < 4; i++) {
        const sector = petRingSector(i);
        const x = sector.left + sector.label.x - 256,
            y = sector.top + sector.label.y - 256;
        expect(Math.hypot(x, y)).toBeCloseTo(148, 5);
        angles.push((Math.atan2(y, x) * 180) / Math.PI);
        expect(sector.path).toContain("A 180 180");
        expect(sector.path).toContain(" Q ");
    }
    expect(angles[3] - angles[0]).toBeCloseTo(78, 5);
    const outer = [0, 1, 2].map((i) => petRingSector(i, true));
    for (const sector of outer) expect(Math.hypot(sector.left + sector.label.x - 256, sector.top + sector.label.y - 256)).toBeCloseTo(216, 5);
});
test("the arc follows the actual pet at every corner without resizing or moving its center", () => {
    for (const size of [60, 114, 208, 312])
        for (const left of [20, 1440 - size - 20])
            for (const top of [20, 1000 - size - 20]) {
                const rect = { left, top, width: size, height: size },
                    layout = petArcLayout(rect, { width: 1440, height: 1000 });
                expect(layout.left + layout.center).toBeCloseTo(left + size / 2, 4);
                expect(layout.top + layout.center).toBeCloseTo(top + size / 2, 4);
                for (const thumbnail of [false, true])
                    for (let i = 0; i < 4; i++) {
                        const sector = petRingSector(i, thumbnail, layout);
                        expect(layout.left + sector.left).toBeGreaterThanOrEqual(0);
                        expect(layout.top + sector.top).toBeGreaterThanOrEqual(0);
                        expect(layout.left + sector.left + sector.width).toBeLessThanOrEqual(1440);
                        expect(layout.top + sector.top + sector.height).toBeLessThanOrEqual(1000);
                    }
            }
});
