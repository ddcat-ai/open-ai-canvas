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

/**
 * 新的素材写入后调用：素材库分页、素材选择器和分类计数都基于带 staleTime 的查询缓存，
 * 不主动失效会让“刚生成的图片”在刷新整页之前一直缺席。批量写入会合并成一次失效。
 */
let assetCatalogInvalidationScheduled = false;
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
