import { t } from "@/i18n";
export type ImageResolutionTier = "1k" | "2k" | "4k";

export type ImageResolutionOption = {
    size: string;
    tier: ImageResolutionTier;
    ratio: string;
    width: number;
    height: number;
};

export type ImageResolutionChoice = "auto" | ImageResolutionTier;

const tierOrder: ImageResolutionTier[] = ["1k", "2k", "4k"];
const ratioOrder = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "2:1", "1:2", "21:9"];

export function supportsImageResolutionPresets(size: { parameter: string; values: string[]; allowCustom?: boolean }) {
    return size.parameter === "size" && size.values.some((value) => /^\d+x\d+$/i.test(value.trim()));
}

export function buildImageResolutionOptions(values: string[]) {
    return values
        .map(parseImageResolutionOption)
        .filter((item): item is ImageResolutionOption => Boolean(item))
        .sort((left, right) => {
            const tierDifference = tierOrder.indexOf(left.tier) - tierOrder.indexOf(right.tier);
            if (tierDifference) return tierDifference;
            return ratioOrder.indexOf(left.ratio) - ratioOrder.indexOf(right.ratio);
        });
}

export function imageResolutionChoices(values: string[]): ImageResolutionChoice[] {
    const choices: ImageResolutionChoice[] = values.some((value) => value.trim().toLowerCase() === "auto") ? ["auto"] : [];
    for (const option of buildImageResolutionOptions(values)) {
        if (!choices.includes(option.tier)) choices.push(option.tier);
    }
    return choices;
}

export function imageResolutionOption(options: ImageResolutionOption[], size: string) {
    return options.find((item) => item.size.toLowerCase() === size.trim().toLowerCase());
}

export function imageSizeForResolution(options: ImageResolutionOption[], tier: ImageResolutionTier, ratio: string) {
    return options.find((item) => item.tier === tier && item.ratio === ratio)?.size;
}

export function imageRatioForSize(size: string) {
    return parseImageResolutionOption(size)?.ratio || "";
}

export function formatImageResolutionSize(size: string, options: ImageResolutionOption[]) {
    if (size.trim().toLowerCase() === "auto") return t("lib:auto");
    const option = imageResolutionOption(options, size);
    return option ? `${option.ratio} · ${option.tier.toUpperCase()}` : size;
}

function parseImageResolutionOption(value: string): ImageResolutionOption | null {
    const match = value
        .trim()
        .toLowerCase()
        .match(/^(\d+)x(\d+)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const pixels = width * height;
    const tier: ImageResolutionTier | null = pixels <= 2_000_000 ? "1k" : pixels <= 4_300_000 ? "2k" : pixels <= 8_294_400 ? "4k" : null;
    if (!tier) return null;
    const ratio = closestRatio(width / height);
    if (!ratio) return null;
    return { size: `${width}x${height}`, tier, ratio, width, height };
}

function closestRatio(value: number) {
    let result = "";
    let bestDifference = Number.POSITIVE_INFINITY;
    for (const label of ratioOrder) {
        const [width, height] = label.split(":").map(Number);
        const expected = width / height;
        const difference = Math.abs(value - expected) / expected;
        if (difference < bestDifference) {
            result = label;
            bestDifference = difference;
        }
    }
    return bestDifference <= 0.025 ? result : "";
}
