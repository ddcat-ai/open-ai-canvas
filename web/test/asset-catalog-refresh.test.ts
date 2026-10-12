import { expect, test } from "bun:test";

// 生成/上传后素材库必须立即反映新素材，不能依赖整页刷新。
// 这里锁定三处：选择器每次打开都拉最新、写入素材后失效相关查询、提供统一失效入口。
test("素材库在生成后无需刷新即可显示新素材", async () => {
    const [picker, store, queryClient] = await Promise.all([
        Bun.file(new URL("../src/components/assets/asset-library-picker-modal.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/stores/use-asset-store.ts", import.meta.url)).text(),
        Bun.file(new URL("../src/lib/query-client.ts", import.meta.url)).text(),
    ]);

    // 1. 选择器查询不再命中 30s 旧缓存。
    expect(picker).toContain("staleTime: 0");
    expect(picker).toContain('refetchOnMount: "always"');

    // 2. 写入素材的两个入口都会失效素材目录查询。
    expect(store).toContain('import { invalidateAssetCatalogQueries } from "@/lib/query-client"');
    expect(store).toContain(".finally(() => invalidateAssetCatalogQueries())");
    const invalidations = store.match(/invalidateAssetCatalogQueries\(\)/g) || [];
    expect(invalidations.length).toBeGreaterThanOrEqual(2);

    // 3. 统一失效入口覆盖选择器与素材库页面查询键。
    expect(queryClient).toContain("export function invalidateAssetCatalogQueries()");
    expect(queryClient).toContain('queryKey: ["asset-picker"]');
    expect(queryClient).toContain('queryKey: ["asset-library"]');
    expect(queryClient).toContain('queryKey: ["asset-folders"]');
});
