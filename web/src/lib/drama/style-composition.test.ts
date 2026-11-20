import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    composeDramaStyleId,
    DEFAULT_DRAMA_STYLE_ID,
    DRAMA_STYLE_FORMS,
    DRAMA_STYLE_THEMES,
    DRAMA_STYLES,
    findDramaStyle,
    getDramaStyleComposition,
    parseDramaStyleId,
    updateDramaStyleComposition,
    type DramaStyleFormId,
    type DramaStyleThemeId,
} from "./drama-styles";

describe("independent drama style composition", () => {
    test("stable ids encode both axes and survive serialization", () => {
        assert.equal(composeDramaStyleId("3d", "urban"), "composition:v1:3d:urban");
        assert.equal(DEFAULT_DRAMA_STYLE_ID, "composition:v1:realistic:urban");
        const stored = JSON.parse(JSON.stringify({ styleId: composeDramaStyleId("semi-realistic", "apocalypse") }));
        assert.deepEqual(parseDramaStyleId(stored.styleId), { formId: "semi-realistic", themeId: "apocalypse" });
        assert.equal(findDramaStyle(stored.styleId)?.name, "半写实 · 末日");
    });

    test("all forms combine with every theme within backend field limits and without an aspect ratio", () => {
        const ids = new Set<string>();
        for (const form of DRAMA_STYLE_FORMS) {
            for (const theme of DRAMA_STYLE_THEMES) {
                const id = composeDramaStyleId(form.id, theme.id);
                const style = findDramaStyle(id)!;
                ids.add(id);
                assert.deepEqual(parseDramaStyleId(id), { formId: form.id, themeId: theme.id });
                assert.equal(style.name, `${form.name} · ${theme.name}`);
                assert.deepEqual(style.detail, { medium: form.medium, world: theme.world, look: theme.look, wardrobe: theme.wardrobe, forbid: form.forbid });
                // 后端按 Unicode 码点数限制字段；作品风格提示词的 1200 字约束更严格。
                assert.ok([...style.id].length <= 64, `${id}: style id`);
                assert.ok([...style.name].length <= 120, `${id}: style name`);
                assert.ok([...style.prompt].length <= 4000, `${id}: cast style prompt`);
                assert.ok([...style.prompt].length <= 1200, `${id}: project style prompt`);
                assert.doesNotMatch(style.prompt, /竖屏|横屏|画幅|\d+\s*[:：]\s*\d+/);
                assert.equal(
                    DRAMA_STYLES.some((preset) => preset.id === id),
                    false,
                );
            }
        }
        assert.equal(ids.size, DRAMA_STYLE_FORMS.length * DRAMA_STYLE_THEMES.length);
    });

    test("switching one axis preserves the other and removes the previous world", () => {
        const fantasy = composeDramaStyleId("3d", "xuanhuan");
        const urban = updateDramaStyleComposition(fantasy, { themeId: "urban" });
        assert.deepEqual(parseDramaStyleId(urban), { formId: "3d", themeId: "urban" });
        assert.doesNotMatch(findDramaStyle(urban)!.prompt, /玄幻|仙山|宗门|法术|法器|古风|长袍/);
        const anime = updateDramaStyleComposition(urban, { formId: "2d" });
        assert.deepEqual(parseDramaStyleId(anime), { formId: "2d", themeId: "urban" });
        assert.equal(findDramaStyle(anime)?.detail.world, findDramaStyle(urban)?.detail.world);
    });

    test("themes never impose a rendering medium and forms never impose a world", () => {
        for (const theme of DRAMA_STYLE_THEMES) assert.doesNotMatch([theme.world, theme.look, theme.wardrobe].join("。"), /真人|写实|3D|2D|赛璐璐|卡通|笔触|平涂|建模/);
        for (const form of DRAMA_STYLE_FORMS) assert.doesNotMatch(form.medium, /玄幻|都市|末日|仙山|宗门|法术|宫廷|校园|古装/);
        const anime = findDramaStyle(composeDramaStyleId("2d", "urban"))!;
        const realistic = findDramaStyle(updateDramaStyleComposition(anime.id, { formId: "realistic" }))!;
        assert.doesNotMatch(anime.prompt.split("。禁止：")[0], /真人|皮肤纹理|3D/);
        assert.doesNotMatch(realistic.prompt.split("。禁止：")[0], /2D|3D|赛璐璐|二维|线稿/);
        assert.doesNotMatch(realistic.detail.forbid, /真人/);
    });

    test("existing presets remain resolvable and become a clean composition when edited", () => {
        assert.equal(findDramaStyle("3d-guoman")?.name, "3D 国漫仙侠");
        assert.deepEqual(getDramaStyleComposition("3d-guoman"), { formId: "3d", themeId: "xuanhuan" });
        assert.equal(updateDramaStyleComposition("3d-guoman", { themeId: "urban" }), composeDramaStyleId("3d", "urban"));
        assert.equal(updateDramaStyleComposition("live-ceo", { formId: "2d" }), composeDramaStyleId("2d", "urban"));
        assert.doesNotMatch(findDramaStyle("live-ceo")!.prompt, /竖屏/);
    });

    test("unknown or malformed ids never resolve to an unrelated style", () => {
        for (const id of ["", "unknown", "composition:v1:3d:missing", "composition:v2:3d:urban", "composition:v1:3d:urban:extra", " composition:v1:3d:urban"]) {
            assert.equal(parseDramaStyleId(id), undefined);
            assert.equal(getDramaStyleComposition(id), undefined);
            assert.equal(findDramaStyle(id), undefined);
        }
        assert.throws(() => composeDramaStyleId("missing" as DramaStyleFormId, "urban"));
        assert.throws(() => composeDramaStyleId("3d", "missing" as DramaStyleThemeId));
    });
});
