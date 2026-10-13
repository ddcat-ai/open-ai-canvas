import { expect, test } from "bun:test";

test("素材选择弹窗在本地素材源下加载并展示用户自定义分类，并传递 folderId 过滤", async () => {
    const pickerModal = await Bun.file(new URL("../src/components/assets/asset-library-picker-modal.tsx", import.meta.url)).text();

    expect(pickerModal).toContain('import { listAssetFolders } from "@/services/api/user-data"');
    expect(pickerModal).toContain('queryKey: ["asset-folders", userId]');
    expect(pickerModal).toContain("if (userFolders.length) return userFolders;");
    expect(pickerModal).toContain('source === "local" ? "我的分类" : "文件夹"');
    expect(pickerModal).toContain('folderId: folderId !== "all" && folderId !== "uncategorized" ? folderId : undefined');
    expect(pickerModal).toContain('uncategorized: folderId === "uncategorized"');
    expect(pickerModal).toContain("folderId: asset.folderId");
});
