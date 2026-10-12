import { expect, test } from "bun:test";

// 创作页「添加参考」复用远端分页素材库；若不接受远端条目，生成出来的图片会被
// 误判为“此素材不适用于当前操作”而全部置灰。这里锁定创作页必须声明 acceptRemoteItems，
// 并能在确认回调里用 pickedItems 兜底解析远端素材。
test("创作页参考素材弹窗接受远端素材并可解析远端条目", async () => {
    const [createPage, picker] = await Promise.all([
        Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/components/assets/asset-library-picker-modal.tsx", import.meta.url)).text(),
    ]);

    expect(createPage).toContain("acceptRemoteItems");
    expect(createPage).toContain("remoteItemDisabledReason={(item) => creationLibraryDisabledReason(mode, item.asset?.kind, videoReferenceLimits)}");
    expect(createPage).toContain("const handleLibrarySelect = (selectedIds: string[], pickedItems?: AssetLibraryPickerItem[]) =>");
    expect(createPage).toContain("pickedById.get(id)?.asset");

    // 弹窗必须为远端条目在校验通过后清空禁用原因，否则仍会全部置灰。
    expect(picker).toContain("remoteItemDisabledReason?: (item: AssetLibraryPickerItem) => string | undefined");
    expect(picker).toContain("if (acceptRemoteItems) return { ...remoteItem, disabledReason: remoteItemDisabledReason?.(remoteItem) };");
});
