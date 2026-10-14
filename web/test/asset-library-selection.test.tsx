import { describe, expect, mock, test } from "bun:test";
import type { MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetCard, AssetCover } from "@/pages/assets/asset-library-cards";
import { AssetsBatchBar } from "@/pages/assets/asset-library-panels";
import { selectAssetIds } from "@/pages/assets/asset-library-selection";
import type { Asset } from "@/stores/use-asset-store";

const asset: Asset = { id: "remote-page-2", kind: "text", title: "第二页素材", coverUrl: "", tags: [], createdAt: "2026-10-01", updatedAt: "2026-10-01", data: { content: "正文" } };
const click = (keys: Partial<MouseEvent<HTMLButtonElement>> = {}) => ({ shiftKey: false, ctrlKey: false, metaKey: false, ...keys }) as MouseEvent<HTMLButtonElement>;

function card(selected: boolean, selectionMode: boolean) {
    const onSelect = mock(() => {});
    const onOpen = mock(() => {});
    const element = AssetCard({ asset, selected, selectionMode, onSelect, onOpen, onEdit: () => {}, onCopy: () => {}, onDownload: () => {}, onDelete: () => {}, folderOptions: [], onMoveToFolder: () => {} });
    const [cover, body] = element.props.children;
    return { onSelect, onOpen, cover: AssetCover(cover.props).props.children[0], body };
}

describe("素材库分页多选", () => {
    test("跨页选择合并去重，取消只影响指定素材", () => {
        let ids = selectAssetIds([], ["page-1"], "page-1", true);
        ids = selectAssetIds(ids, ["page-2-a", "page-2-b"], "page-2-a", true);
        ids = selectAssetIds(ids, ["page-2-a", "page-2-b"], "page-2-a", true);
        expect(ids).toEqual(["page-1", "page-2-a"]);
        expect(selectAssetIds(ids, ["page-2-a"], "page-2-a", false)).toEqual(["page-1"]);
    });

    test("Shift 正向反向连选和连取消，保留其他页的选择", () => {
        const visible = ["a", "b", "c", "d"];
        expect(selectAssetIds(["other-page", "a"], visible, "d", true, "a")).toEqual(["other-page", "a", "b", "c", "d"]);
        expect(selectAssetIds(["other-page"], visible, "a", true, "d")).toEqual(["other-page", "a", "b", "c", "d"]);
        expect(selectAssetIds(["other-page", ...visible], visible, "d", false, "b")).toEqual(["other-page", "a"]);
    });

    test("翻页后锚点不在当前页时仅切换目标", () => {
        expect(selectAssetIds(["previous"], ["a", "b"], "b", true, "previous")).toEqual(["previous", "b"]);
    });

    test("普通模式点击封面和文字仍打开预览", () => {
        const entry = card(false, false);
        entry.cover.props.onClick(click());
        entry.body.props.onClick(click());
        expect(entry.onOpen).toHaveBeenCalledTimes(2);
        expect(entry.onSelect).not.toHaveBeenCalled();
    });

    test.each([false, true])("多选模式封面和文字直接切换选择（原选中：%s）", (selected) => {
        const entry = card(selected, true);
        entry.cover.props.onClick(click());
        entry.body.props.onClick(click());
        expect(entry.onSelect.mock.calls).toEqual([
            [!selected, false],
            [!selected, false],
        ]);
        expect(entry.onOpen).not.toHaveBeenCalled();
    });

    test("Shift 或 Ctrl 点击卡片可直接开始多选", () => {
        const entry = card(false, false);
        entry.cover.props.onClick(click({ shiftKey: true }));
        entry.body.props.onClick(click({ ctrlKey: true }));
        entry.body.props.onClick(click({ metaKey: true }));
        expect(entry.onSelect.mock.calls).toEqual([
            [true, true],
            [true, false],
            [true, false],
        ]);
        expect(entry.onOpen).not.toHaveBeenCalled();
    });

    test("选择为空或操作中时禁用写按钮，并明确全选范围", () => {
        const props = { isTrash: false, allSelected: false, onSelectAll: () => {}, onClear: () => {}, onExport: () => {}, onDelete: () => {} };
        const empty = renderToStaticMarkup(<AssetsBatchBar {...props} count={0} />);
        expect(empty).toContain("全选本页");
        expect(empty.match(/disabled=""/g)).toHaveLength(3);
        const busy = renderToStaticMarkup(<AssetsBatchBar {...props} count={3} busy />);
        expect(busy.match(/disabled=""/g)).toHaveLength(5);
    });
});
