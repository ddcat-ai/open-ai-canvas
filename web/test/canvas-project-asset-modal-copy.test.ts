import { describe, expect, it } from "bun:test";
import { projectAssetModalCopy } from "@/components/canvas/canvas-project-asset-modal";

describe("canvas project asset modal copy", () => {
    it("names the dialog after the linked project library", () => {
        expect(projectAssetModalCopy(true)).toEqual({ title: "项目资产", note: "角色引用会在生成时解析当前角色版本" });
    });

    it("tells standalone canvases that the list is the personal library", () => {
        expect(projectAssetModalCopy(false)).toEqual({ title: "我的素材", note: "当前画布未关联项目，以下为你的全部素材" });
    });
});
