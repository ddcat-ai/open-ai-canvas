import { CachedResourceImage } from "@/components/cached-resource-image";
import { projectDraft, type EcommerceDraft, type EcommercePlan, type EcommerceProject } from "@/services/api/ecommerce";
import { resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import { modelOptionName } from "@/stores/use-config-store";
import { imageSizeLabel, labelOf, languages, platforms } from "./catalog";
import { writeCommerceImageTransfer } from "./image-transfer";

export function restoreSubmittedCommerceRequest(project: EcommerceProject | null, plan: EcommercePlan | null, cached?: EcommerceDraft | null): EcommerceDraft | null {
    if (cached !== undefined) return cached ? structuredClone(cached) : null;
    if (!project) return null;
    const saved = projectDraft(project);
    if (plan?.images.some((image) => image.taskId)) return saved;
    const previous = plan?.previousImages?.findLast((image) => image.sourceDraft)?.sourceDraft;
    if (previous) return structuredClone(previous);
    return saved.planningTaskId || saved.directionsTaskId ? saved : null;
}

/** A sent message reads its accepted snapshot, never the next composer draft. */
export function CommerceSubmittedRequest({ draft }: { draft: EcommerceDraft | null }) {
    if (!draft || (!draft.instruction && !draft.references.length)) return null;
    const references = draft.references.filter((ref) => ref.role !== "model");
    const count = draft.imageType === "sku" ? draft.skus.reduce((sum, sku) => sum + sku.count, 0) : draft.count;
    return (
        <div className="commerce-request-message" aria-label="已发送的商品需求">
            <small>
                特惠通道 · {labelOf(languages, draft.language)} · {labelOf(platforms, draft.platform)} · {modelOptionName(draft.imageModel)} · {draft.resolution.toUpperCase()} · {imageSizeLabel(draft.ratio)} · {count} 张
            </small>
            {draft.instruction ? <div className="commerce-request-bubble">{draft.instruction}</div> : null}
            {references.length ? (
                <div className="commerce-request-references">
                    {references.map((ref, index) => (
                        <CachedResourceImage
                            key={`${ref.resourceId}-${index}`}
                            storageKey={resourceStorageKey(ref.resourceId)}
                            alt={`第 ${index + 1} 张商品参考图`}
                            loading="lazy"
                            decoding="async"
                            draggable
                            onDragStart={(event) => writeCommerceImageTransfer(event.dataTransfer, { resourceId: ref.resourceId, name: ref.name || `商品参考图 ${index + 1}`, url: resourceFileUrl(ref.resourceId) })}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
