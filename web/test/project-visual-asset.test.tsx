import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { projectVisualImageRequest, projectVisualTaskAssetId } from "../src/pages/projects/detail/project-visual-asset";
import { assetKindLabel, assetSummary } from "../src/pages/assets/asset-library-format";
import { ProjectVisualAssetCard } from "../src/pages/projects/detail/project-visual-asset-card";
import { defaultConfig } from "../src/stores/use-config-store";
import type { ProjectAsset } from "../src/services/api/projects";

const asset: ProjectAsset = {
    id: "scene",
    title: "藏书阁",
    category: "environment",
    mediaType: "entity",
    status: "confirmed",
    position: 0,
    primaryVersionId: "version-1",
    versionCount: 1,
    usages: [],
    updatedAt: "",
    visual: { status: "missing", definition: { description: "木质书架", prompt: "古风藏书阁全景" } },
};

describe("场景与道具参考图片", () => {
    test("生图提交资产与版本身份、设定和项目画风，限制为一张图片", () => {
        const input = projectVisualImageRequest({ projectId: "project", asset, config: { ...defaultConfig, imageModel: "test-image" }, projectStyle: { id: "style", title: "水墨", prompt: "水墨画风，低饱和" } });
        expect(input.mode).toBe("image");
        expect(input.prompt).toContain("古风藏书阁全景");
        expect(input.prompt).toContain("水墨画风，低饱和");
        expect(input.prompt).toContain("不出现人物");
        expect(input.config.count).toBe("1");
        expect(input.config.model).toBe("test-image");
        expect(input.metadata).toMatchObject({ operation: "project_asset_image", projectAssetId: "scene", projectAssetVersionId: "version-1" });
    });
    test("道具使用独立主体设定，不继承场景全景指令", () => {
        const input = projectVisualImageRequest({ projectId: "project", asset: { ...asset, category: "prop" }, config: defaultConfig });
        expect(input.prompt).toContain("道具");
        expect(input.prompt).toContain("完整展示");
        expect(input.prompt).not.toContain("场景全景");
    });
    test("缺少项目、版本、设定或分类不符时拒绝收费请求", () => {
        const build =
            (patch: Partial<ProjectAsset>, projectId = "project") =>
            () =>
                projectVisualImageRequest({ projectId, asset: { ...asset, ...patch }, config: defaultConfig });
        expect(build({}, "")).toThrow("项目");
        expect(build({ primaryVersionId: "" })).toThrow("版本");
        expect(build({ visual: undefined })).toThrow("设定");
        expect(build({ visual: { status: "missing", definition: { description: "描述" } } })).toThrow("提示词");
        expect(build({ category: "character" })).toThrow("场景或道具");
    });
    test("未出图卡显示待生成图片，并提供生成与绑定入口", () => {
        const html = renderToStaticMarkup(<ProjectVisualAssetCard asset={asset} generating={false} busy={false} folderItems={[]} onOpen={() => {}} onGenerate={() => {}} onBind={() => {}} onMove={() => {}} onRemove={() => {}} />);
        expect(html).toContain("待生成图片");
        expect(html).toContain("生成图片");
        expect(html).toContain("绑定图片");
        expect(html).toContain("木质书架");
        expect(html).not.toContain(">文本<");
    });
    test("从任务列表恢复出图中的资产，刷新后防止重复提交", () => {
        expect(projectVisualTaskAssetId({ clientContext: { nodeId: "project-asset-image:scene" } })).toBe("scene");
        expect(projectVisualTaskAssetId({ clientContext: { nodeId: "character-turnaround:role" } })).toBe("");
        expect(projectVisualTaskAssetId({})).toBe("");
    });
    test("个人素材库不会把场景设定显示成角色卡", () => {
        expect(assetKindLabel("entity", "environment")).toBe("场景设定");
        expect(assetKindLabel("entity", "character")).toBe("角色");
        expect(assetSummary({ id: "scene", kind: "entity", category: "environment", title: "阁楼", tags: [], coverUrl: "", createdAt: "", updatedAt: "", data: { definition: { description: "木质书架" } } })).toBe("木质书架");
    });
});
