/** Stored values remain stable; density controls card size, not a fixed column count. */
export const assetGridDensityOptions = [
    { label: "舒适", value: 6 },
    { label: "标准", value: 8 },
    { label: "紧凑", value: 10 },
];

export type AssetGridDensity = 6 | 8 | 10;

export const assetGridCardMinWidth: Record<AssetGridDensity, number> = {
    6: 272,
    8: 208,
    10: 160,
};

export function parseAssetGridDensity(value: unknown): AssetGridDensity {
    const number = Number(value);
    return number === 6 || number === 10 ? number : 8;
}
