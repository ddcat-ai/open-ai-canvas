import type { ImageResolutionOption } from "./image-resolution-tiers";

/** Official Seedream 5.5 API reference sizes. */
export function seedream55ImagePresets(): ImageResolutionOption[] {
    const rows = [
        ["1:1", "1024x1024", "1536x1536", "2048x2048"],
        ["4:3", "1152x864", "1792x1344", "2368x1776"],
        ["3:4", "864x1152", "1344x1792", "1776x2368"],
        ["16:9", "1424x800", "2048x1152", "2816x1584"],
        ["9:16", "800x1424", "1152x2048", "1584x2816"],
        ["3:2", "1248x832", "1872x1248", "2496x1664"],
        ["2:3", "832x1248", "1248x1872", "1664x2496"],
        ["21:9", "1568x672", "2352x1008", "3136x1344"],
    ];
    return rows.flatMap(([ratio, ...sizes]) =>
        sizes.map((size, index) => {
            const [width, height] = size.split("x").map(Number);
            return { ratio, tier: ["1k", "1.5k", "2k"][index], size, width, height };
        }),
    );
}
