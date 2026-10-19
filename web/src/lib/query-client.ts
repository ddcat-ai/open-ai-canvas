import { QueryClient } from "@tanstack/react-query";

export const appQueryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

let assetCatalogInvalidationScheduled = false;

// Batch image writes share one catalog refresh after their server save completes.
export function invalidateAssetCatalogQueries() {
    if (assetCatalogInvalidationScheduled) return;
    assetCatalogInvalidationScheduled = true;
    setTimeout(() => {
        assetCatalogInvalidationScheduled = false;
        void appQueryClient.invalidateQueries({ queryKey: ["asset-picker"] });
        void appQueryClient.invalidateQueries({ queryKey: ["asset-library"] });
        void appQueryClient.invalidateQueries({ queryKey: ["asset-folders"] });
    }, 150);
}
