import { translate } from "@/i18n";

/** Stored values remain stable; density controls card size, not a fixed column count. */
export const assetGridDensityOptions = [
    {
        get label() {
            return translate("library.assets.density.comfortable");
        },
        value: 6,
    },
    {
        get label() {
            return translate("library.assets.density.standard");
        },
        value: 8,
    },
    {
        get label() {
            return translate("library.assets.density.compact");
        },
        value: 10,
    },
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
