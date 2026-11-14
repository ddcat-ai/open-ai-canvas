import type { ImagePricing } from "@/services/api/wallet";

export type ImagePricingForm = {
    inputPrice: number | null;
    freeInputImages: number;
    outputTiers: Array<{ maxPixels: number | null; unitPrice: number | null }>;
};

export function imagePricingToForm(pricing?: ImagePricing | null): ImagePricingForm | undefined {
    if (!pricing) return undefined;
    return { inputPrice: pricing.inputPriceMicrocredits / 1_000_000, freeInputImages: pricing.freeInputImages, outputTiers: pricing.outputTiers.map((tier) => ({ maxPixels: tier.maxPixels, unitPrice: tier.unitPriceMicrocredits / 1_000_000 })) };
}

export function validImagePricingForm(value?: ImagePricingForm): boolean {
    const price = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000;
    if (!value || !price(value.inputPrice) || !Number.isInteger(value.freeInputImages) || value.freeInputImages < 0 || value.freeInputImages > 128 || !value.outputTiers?.length || value.outputTiers.length > 16) return false;
    let previous = 0;
    return value.outputTiers.every((tier, index) => {
        if (!price(tier.unitPrice) || !Number.isInteger(tier.maxPixels) || tier.maxPixels === null || tier.maxPixels < 0 || tier.maxPixels > 100_000_000) return false;
        if (tier.maxPixels === 0) return index === value.outputTiers.length - 1;
        if (tier.maxPixels <= previous) return false;
        previous = tier.maxPixels;
        return true;
    });
}

export function imagePricingPayload(value?: ImagePricingForm): ImagePricing {
    if (!validImagePricingForm(value)) throw new Error("请填写完整的图片输入价和递增的输出像素档位");
    return {
        inputPriceMicrocredits: Math.round(value!.inputPrice! * 1_000_000),
        freeInputImages: value!.freeInputImages,
        outputTiers: value!.outputTiers.map((tier) => ({ maxPixels: tier.maxPixels!, unitPriceMicrocredits: Math.round(tier.unitPrice! * 1_000_000) })),
    };
}

/** Official Ark pay-as-you-go CNY prices, not platform credit prices. */
export function seedream55OfficialPricing(): ImagePricingForm {
    return {
        inputPrice: 0.05,
        freeInputImages: 0,
        outputTiers: [
            { maxPixels: 2_610_000, unitPrice: 0.13 },
            { maxPixels: 4_630_000, unitPrice: 0.23 },
        ],
    };
}
