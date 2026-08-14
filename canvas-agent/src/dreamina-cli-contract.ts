import { z } from "zod";

export const dreaminaGenerationOperations = [
    "text2image",
    "image2image",
    "image_upscale",
    "text2video",
    "image2video",
    "frames2video",
    "multiframe2video",
    "multimodal2video",
] as const;

const safeId = z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/);
export const dreaminaSubmitIdSchema = safeId;
const prompt = z.string().min(1).max(20_000);
const referencePath = z.string().min(1).max(2_048);
const imageReferences = z.array(referencePath);
const imageRatio = z.enum(["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"]);
const videoRatio = z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const imageResolution = z.enum(["1k", "2k", "4k"]);
const videoResolution = z.enum(["480p", "720p", "1080p", "4k"]);
export const dreaminaImageModelSchema = z.enum(["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"]);
const imageEditModel = z.enum(["4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"]);
const seedanceModel = z.enum(["seedance2.0", "seedance2.0fast", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini", "seedance2.5"]);
const imageVideoModel = z.enum(["seedance1.0fast", "seedance1.5pro", "seedance2.0", "seedance2.0fast", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini", "seedance2.5"]);

type DreaminaVideoModel = z.infer<typeof seedanceModel> | z.infer<typeof imageVideoModel>;
type DreaminaVideoModelCapability = {
    videoResolutions: readonly z.infer<typeof videoResolution>[];
    minDuration: number;
    maxDuration: number;
};

const defaultVideoModelCapability: DreaminaVideoModelCapability = {
    videoResolutions: ["720p"],
    minDuration: 4,
    maxDuration: 15,
};

export const dreaminaVideoModelCapabilityOverrides = {
    "seedance1.0fast": { videoResolutions: ["720p"], minDuration: 5, maxDuration: 10 },
    "seedance1.5pro": { videoResolutions: ["720p"], minDuration: 5, maxDuration: 12 },
    "seedance2.0_vip": { videoResolutions: ["720p", "1080p", "4k"], minDuration: 4, maxDuration: 15 },
    "seedance2.5": { videoResolutions: ["480p", "720p"], minDuration: 4, maxDuration: 30 },
} as const satisfies Partial<Record<DreaminaVideoModel, DreaminaVideoModelCapability>>;

export const dreaminaGenerationCapabilityMetadata = {
    image2image: { maxReferenceImages: 10 },
    image2video: { maxReferenceImages: 1 },
    frames2video: { maxReferenceImages: 2 },
    multiframe2video: { minReferenceImages: 2, maxReferenceImages: 20, minDuration: 1, maxDuration: 8 },
    multimodal2video: {
        default: { maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxReferences: 12, requiresVisualReference: true },
        "seedance2.5": { maxReferenceImages: 30, maxReferenceVideos: 10, maxReferenceAudios: 10, maxReferences: 50, requiresVisualReference: false },
    },
} as const;

const videoDuration = z.number().int().min(defaultVideoModelCapability.minDuration).max(
    dreaminaVideoModelCapabilityOverrides["seedance2.5"].maxDuration,
);

export function dreaminaVideoModelCapability(model: string): DreaminaVideoModelCapability {
    return dreaminaVideoModelCapabilityOverrides[model as keyof typeof dreaminaVideoModelCapabilityOverrides]
        ?? defaultVideoModelCapability;
}

export function dreaminaMaxReferenceImages(operation: string, model: string) {
    switch (operation) {
        case "image2image": return dreaminaGenerationCapabilityMetadata.image2image.maxReferenceImages;
        case "image2video": return dreaminaGenerationCapabilityMetadata.image2video.maxReferenceImages;
        case "frames2video": return dreaminaGenerationCapabilityMetadata.frames2video.maxReferenceImages;
        case "multimodal2video": return dreaminaMultimodalCapability(model).maxReferenceImages;
        default: return 0;
    }
}

export const dreaminaGenerationSchemas = [
    z.object({ operation: z.literal("text2image"), idempotencyKey: safeId, prompt, modelVersion: dreaminaImageModelSchema.optional(), ratio: imageRatio.optional(), resolutionType: imageResolution.optional(), generateNum: z.number().int().min(1).max(10).optional() }).strict(),
    z.object({ operation: z.literal("image2image"), idempotencyKey: safeId, prompt, modelVersion: imageEditModel.optional(), ratio: imageRatio.optional(), resolutionType: imageResolution.optional(), generateNum: z.number().int().min(1).max(10).optional(), referenceImages: imageReferences.min(1).max(10) }).strict(),
    z.object({ operation: z.literal("image_upscale"), idempotencyKey: safeId, resolutionType: z.enum(["2k", "4k", "8k"]), referenceImages: imageReferences.length(1) }).strict(),
    z.object({ operation: z.literal("text2video"), idempotencyKey: safeId, prompt, modelVersion: seedanceModel.optional(), ratio: videoRatio.optional(), videoResolution, duration: videoDuration.optional() }).strict(),
    z.object({ operation: z.literal("image2video"), idempotencyKey: safeId, prompt, modelVersion: imageVideoModel.optional(), videoResolution, duration: videoDuration.optional(), referenceImages: imageReferences.length(1) }).strict(),
    z.object({ operation: z.literal("frames2video"), idempotencyKey: safeId, prompt, modelVersion: z.enum(["seedance1.5pro", "seedance2.0", "seedance2.0fast", "seedance2.0_vip", "seedance2.0fast_vip", "seedance2.0mini", "seedance2.5"]).optional(), videoResolution, duration: videoDuration.optional(), referenceImages: imageReferences.length(2) }).strict(),
    z.object({ operation: z.literal("multiframe2video"), idempotencyKey: safeId, videoResolution: z.enum(["720p", "1080p"]), referenceImages: imageReferences.min(2).max(20), prompt: prompt.optional(), duration: z.number().min(1).max(8).optional(), transitionPrompts: z.array(prompt).min(1).max(19).optional(), transitionDurations: z.array(z.number().min(1).max(8)).min(1).max(19).optional() }).strict(),
    z.object({ operation: z.literal("multimodal2video"), idempotencyKey: safeId, prompt: prompt.optional(), modelVersion: seedanceModel.optional(), ratio: videoRatio.optional(), videoResolution, duration: videoDuration.optional(), referenceImages: imageReferences.max(30).optional(), referenceVideos: z.array(referencePath).max(10).optional(), referenceAudios: z.array(referencePath).max(10).optional() }).strict(),
] as const;

const generationDiscriminatedSchema = z.discriminatedUnion("operation", dreaminaGenerationSchemas);
const schemas = [
    ...dreaminaGenerationSchemas,
    z.object({ operation: z.literal("query_result"), submitId: safeId }).strict(),
] as const;

const discriminatedSchema = z.discriminatedUnion("operation", schemas);
export type DreaminaCliInput = z.infer<typeof discriminatedSchema>;
export type DreaminaGenerationInput = z.infer<typeof generationDiscriminatedSchema>;
export const dreaminaGenerationInputSchema = generationDiscriminatedSchema.superRefine(validateOperationCombination);
export const dreaminaCliInputSchema = discriminatedSchema.superRefine(validateOperationCombination);

// Public MCP exposes generation only; the internal Runtime schema retains query_result for scheduler use.
export const dreaminaMcpToolShape = z.object({
    operation: z.enum(dreaminaGenerationOperations),
    idempotencyKey: safeId,
    prompt: prompt.optional(),
    modelVersion: z.union([dreaminaImageModelSchema, imageVideoModel]).optional(),
    ratio: imageRatio.optional(),
    resolutionType: z.enum(["1k", "2k", "4k", "8k"]).optional().describe("For automatic image resolution, omit resolutionType. image_upscale requires an explicit tier."),
    videoResolution: videoResolution.optional(),
    duration: z.number().min(1).max(30).optional(),
    generateNum: z.number().int().min(1).max(10).optional(),
    referenceImages: imageReferences.max(30).optional(),
    referenceVideos: z.array(referencePath).max(10).optional(),
    referenceAudios: z.array(referencePath).max(10).optional(),
    transitionPrompts: z.array(prompt).max(19).optional(),
    transitionDurations: z.array(z.number().min(1).max(8)).max(19).optional(),
}).strict();

function validateOperationCombination(value: DreaminaCliInput, context: z.RefinementCtx) {
    if (value.operation === "text2image" || value.operation === "image2image") {
        const model = value.modelVersion ?? "5.0";
        if (["3.0", "3.1"].includes(model) && value.resolutionType === "4k") invalid(context, "resolutionType");
        if (model !== "5.0Pro" && !["3.0", "3.1"].includes(model) && value.resolutionType === "1k") invalid(context, "resolutionType");
        return;
    }
    if (value.operation === "multiframe2video") {
        const transitions = value.referenceImages.length - 1;
        if (value.referenceImages.length === 2) {
            if (!value.prompt || value.transitionPrompts || value.transitionDurations) invalid(context, "prompt");
        } else if (value.prompt || value.duration !== undefined || value.transitionPrompts?.length !== transitions || (value.transitionDurations && value.transitionDurations.length !== transitions)) {
            invalid(context, "transitionPrompts");
        }
        return;
    }
    if (value.operation === "multimodal2video") {
        const images = value.referenceImages?.length ?? 0;
        const videos = value.referenceVideos?.length ?? 0;
        const audios = value.referenceAudios?.length ?? 0;
        const model = value.modelVersion ?? "seedance2.0_vip";
        if (images + videos + audios === 0 || (model !== "seedance2.5" && images + videos === 0)) invalid(context, "referenceImages");
        if (model === "seedance2.5" ? images + videos + audios > 50 : images > 9 || videos > 3 || audios > 3 || images + videos + audios > 12) invalid(context, "referenceImages");
        validateVideoCombination(model, value.videoResolution, value.duration, context);
        return;
    }
    if (value.operation === "text2video" || value.operation === "image2video" || value.operation === "frames2video") {
        const fallback = value.operation === "text2video" ? "seedance2.0fast" : "seedance2.0_vip";
        validateVideoCombination(value.modelVersion ?? fallback, value.videoResolution, value.duration, context);
    }
}

function validateVideoCombination(model: string, resolution: string, duration: number | undefined, context: z.RefinementCtx) {
    const seconds = duration ?? 5;
    const capability = dreaminaVideoModelCapability(model);
    if (!capability.videoResolutions.includes(resolution as z.infer<typeof videoResolution>) || seconds < capability.minDuration || seconds > capability.maxDuration) invalid(context, "videoResolution");
}

function dreaminaMultimodalCapability(model: string) {
    return model === "seedance2.5"
        ? dreaminaGenerationCapabilityMetadata.multimodal2video["seedance2.5"]
        : dreaminaGenerationCapabilityMetadata.multimodal2video.default;
}

function invalid(context: z.RefinementCtx, field: string) {
    context.addIssue({ code: "custom", path: [field], message: "unsupported Dreamina operation combination" });
}
