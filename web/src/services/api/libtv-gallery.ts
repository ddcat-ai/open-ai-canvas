import { http } from "@/services/api/request";
import type { LibTVGalleryParams, LibTVGalleryResponse, LibTVWorkDetailResponse } from "@/types/libtv-gallery";

export const LIBTV_GALLERY_PAGE_SIZE = 20;

export function buildLibTVGalleryQuery(params: LibTVGalleryParams) {
    const { page, pageSize = LIBTV_GALLERY_PAGE_SIZE, keyword, tagId, requestId } = params;
    const query = new URLSearchParams({ page: String(Math.max(1, Math.floor(page))), pageSize: String(Math.min(40, Math.max(1, Math.floor(pageSize)))) });
    const trimmedKeyword = keyword?.trim().slice(0, 100);
    if (trimmedKeyword) query.set("keyword", trimmedKeyword);
    if (tagId !== undefined && Number.isInteger(tagId) && tagId > 0) query.set("tagId", String(tagId));
    if (requestId) query.set("requestId", requestId);
    return query.toString();
}

export function getLibTVGallery(params: LibTVGalleryParams) {
    return http.get<LibTVGalleryResponse>(`/libtv/gallery?${buildLibTVGalleryQuery(params)}`);
}

export function getLibTVWorkDetail(templateUuid: string) {
    return http.get<LibTVWorkDetailResponse>(`/libtv/works/${encodeURIComponent(templateUuid)}`);
}
