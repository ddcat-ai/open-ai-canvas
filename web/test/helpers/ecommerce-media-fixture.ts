import { spyOn } from "bun:test";
import * as resources from "../../src/services/api/resources";
import * as imageLoader from "../../src/services/canvas-image-loader";

// Keep ownership-aware delivery and image decoding outside the page lifecycle
// fixture; resource transport and image fallback have their own focused tests.
export function mockEcommerceImageDelivery() {
    spyOn(resources, "getResourceAccess").mockImplementation(async (storageKey, _purpose, variant = "original") => {
        const resourceId = resources.resourceIdFromStorageKey(storageKey);
        if (!resourceId) throw new Error("Expected a remote resource in the ecommerce fixture");
        return {
            resourceId,
            requestedVariant: variant,
            actualVariant: variant,
            url: `/api/resources/${encodeURIComponent(resourceId)}/file?variant=${variant}`,
            delivery: "platform-local",
            issuedAt: "2026-01-01T00:00:00Z",
            refreshAt: "2027-01-01T00:00:00Z",
            revision: "fixture",
        };
    });
    spyOn(imageLoader, "prepareCanvasImage").mockImplementation(async () => document.createElement("img"));
}
