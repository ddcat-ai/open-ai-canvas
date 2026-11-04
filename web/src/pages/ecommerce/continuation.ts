import type { EcommerceDraft, EcommercePlan, EcommercePlanImage } from "@/services/api/ecommerce";
import { createClientUUID } from "@/lib/client-id";

export function commerceCanvasImages(plan: EcommercePlan | null): EcommercePlanImage[] {
    return plan ? [...(plan.previousImages || []), ...plan.images] : [];
}

/** Archive admitted tasks only. Pending sketches never become historical results. */
export function archiveCommercePlan(plan: EcommercePlan | null, source?: EcommerceDraft): EcommercePlan | null {
    if (!plan) return null;
    const previousImages = [
        ...new Map(
            commerceCanvasImages(plan)
                .filter((image) => image.taskId)
                .map((image) => [image.id, image.sourceDraft || !source ? image : { ...image, sourceDraft: source }]),
        ).values(),
    ];
    return previousImages.length ? { ...plan, images: [], previousImages } : null;
}

export function continueCommercePlan(next: EcommercePlan, previous: EcommercePlan | null, source?: EcommerceDraft): EcommercePlan {
    const previousImages = commerceCanvasImages(archiveCommercePlan(previous, source));
    const ids = new Set(previousImages.map((image) => image.id));
    const images = next.images.map((image) => {
        const id = ids.has(image.id) ? createClientUUID() : image.id;
        ids.add(id);
        return id === image.id ? image : { ...image, id };
    });
    return { ...next, images, previousImages };
}

export function updateCommerceCanvasImage(plan: EcommercePlan, id: string, update: (image: EcommercePlanImage) => EcommercePlanImage): EcommercePlan {
    const apply = (image: EcommercePlanImage) => (image.id === id ? update(image) : image);
    return { ...plan, images: plan.images.map(apply), previousImages: plan.previousImages?.map(apply) };
}
