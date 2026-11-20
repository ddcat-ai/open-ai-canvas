import { describe, expect, test } from "bun:test";
import { emptyEcommerceDraft, type EcommercePlan, type EcommercePlanImage } from "../src/services/api/ecommerce";
import { platforms } from "../src/pages/ecommerce/catalog";
import { commerceNarrativeDirection, commerceShotDirection } from "../src/pages/ecommerce/art-direction";
import { commerceAllowsText } from "../src/pages/ecommerce/creative-controls";
import { commerceSmartModelInstruction } from "../src/pages/ecommerce/model-context";
import { parsePlannerOutput, plannerPrompt } from "../src/pages/ecommerce/planner";
import { commercePlatformFamily, commercePlatformImageRule, commercePlatformListingMain, commercePlatformStrategy } from "../src/pages/ecommerce/platform-style";
import { commerceImagePrompt, commercePhotoQualityStandard, commerceRegenerationVariation } from "../src/pages/ecommerce/workflow";

const draft = {
    ...emptyEcommerceDraft(),
    productName: "陶瓷杯",
    imageType: "detail",
    count: 9,
    imageModel: "selected-image-model",
    agentModel: "selected-vision-model",
    ratio: "3:4",
    resolution: "2k",
    references: [{ resourceId: "cup-reference", role: "primary" as const }],
};
const image: EcommercePlanImage = {
    id: "image-1",
    imageType: "detail",
    platform: "taobao",
    language: "zh-CN",
    goal: "展示可见杯柄",
    theme: "弧线有度",
    composition: "偏轴中景，左侧文案",
    mainVisual: "参考图中的杯子",
    verifiedClaims: "",
    performanceAngle: "可见设计｜从可见杯柄轮廓展开日常拿取体验，不推断材质或承重能力",
    informationComponent: "标题导语｜左上标题、两级字号、24px边距，手机端保持高对比",
    copy: "弧线有度\n从可见轮廓发现设计细节",
    lighting: "左上方柔光",
    fidelity: "保持杯柄形状和釉面颜色",
    prompt: "完整呈现参考杯，左侧排版",
    negativePrompt: "不添加内部夹层",
    imageModel: draft.imageModel,
    ratio: draft.ratio,
    resolution: draft.resolution,
};
/** Deterministic pseudo-random source (Park–Miller) for reproducible orders. */
const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
};
const shotLine = (prompt: string) => /^逐张展示分配[^\n]*/m.exec(prompt)?.[0] || "";
const storyboard = (text: string) => text.split("\n").filter((line) => /^图\d+：/.test(line));
const moduleName = (line: string) => line.replace(/^图\d+：/, "").split("：")[0];

describe("ecommerce design variety", () => {
    test("platform strategies follow each platform's own design language", () => {
        const xiaohongshu = commercePlatformStrategy("xiaohongshu", "set");
        const amazon = commercePlatformStrategy("amazon", "set");
        const taobao = commercePlatformStrategy("taobao", "set");
        expect(new Set([xiaohongshu, amazon, taobao]).size).toBe(3);
        for (const term of ["笔记", "3:4", "手写批注", "素人", "不做价格爆炸贴"]) expect(xiaohongshu).toContain(term);
        for (const term of ["纯白", "RGB 255", "85%", "A+", "第 1 张必须是 imageType=main"]) expect(amazon).toContain(term);
        for (const term of ["旗舰店", "图标卖点气泡", "规格"]) expect(taobao).toContain(term);
        expect(commercePlatformStrategy("douyin", "main")).toContain("强钩子大字");
        expect(commercePlatformStrategy("pdd", "main")).toContain("高饱和");
        expect(commercePlatformStrategy("1688", "main")).toContain("多 SKU");
        expect(commercePlatformStrategy("shopify", "main")).toContain("大留白");
        expect(commercePlatformStrategy("temu", "main")).toContain("copy为空");
        expect(commercePlatformStrategy("wechat-shop", "main")).toContain("熟人");
        expect(commercePlatformStrategy("amazon", "amazon-a-plus")).toContain("不写价格、促销");
    });

    test("every catalog platform has a family and the domestic split matches the catalog", () => {
        for (const id of ["vipshop", "dewu", "aikucun", "railway"]) {
            expect(commercePlatformFamily(id).market).toBe("domestic");
            expect(commercePlatformStrategy(id, "main").startsWith("国内平台")).toBe(true);
        }
        expect(commercePlatformStrategy("dewu", "main")).toContain("得物");
        expect(commercePlatformStrategy("railway", "main")).toContain("国铁商城");
        for (const [id] of platforms) expect(commercePlatformFamily(id).id).not.toBe("general");
        expect(commercePlatformFamily("amazon")).toEqual({ id: "listing", market: "cross-border", label: "Amazon" });
        expect(commercePlatformStrategy("amazon", "main").startsWith("跨境平台")).toBe(true);
        expect(commercePlatformFamily("unknown-shop").id).toBe("general");
    });

    test("white main images obey their platform policy and eBay uses no-text photography", () => {
        for (const platform of ["amazon", "walmart", "aliexpress"]) {
            const rule = commercePlatformImageRule(platform, "main");
            expect(rule).toContain("纯白");
            expect(rule).toContain("无文字");
            expect(commercePlatformListingMain(platform, "main")).toBe(true);
        }
        expect(commercePlatformImageRule("amazon", "main")).toContain("85%");
        expect(commercePlatformListingMain("ebay", "main")).toBe(false);
        expect(commerceAllowsText({ ...draft, platform: "ebay", imageType: "secondary" })).toBe(false);
        expect(commercePlatformImageRule("amazon", "single", "商品主图")).toContain("无文字");
        expect(commercePlatformListingMain("amazon", "secondary")).toBe(false);
        expect(commercePlatformListingMain("taobao", "main")).toBe(false);
        expect(commercePlatformImageRule("xiaohongshu", "white")).toContain("不叠加气泡");

        const amazonMain = { ...draft, platform: "amazon", imageType: "main", count: 4 };
        expect(commerceAllowsText(amazonMain)).toBe(false);
        expect(commerceAllowsText({ ...amazonMain, imageType: "set" })).toBe(true);
        expect(commerceAllowsText({ ...amazonMain, imageType: "set" }, "main")).toBe(false);
        expect(commerceAllowsText({ ...amazonMain, platform: "taobao" })).toBe(true);

        const mainImage = { ...image, imageType: "main", platform: "amazon", informationComponent: "" };
        const prompt = commerceImagePrompt(amazonMain, mainImage, "米白杯身", "奶油白与陶土橙，暖白纸感背景");
        expect(prompt).toContain("【平台主图硬性规则·Amazon】");
        expect(prompt).toContain("无文字模式");
        expect(prompt).not.toContain(mainImage.copy);
        expect(prompt).not.toContain("真实使用环境或使用者手中");
        for (const ui of ["图标卖点气泡", "用引线指向", "放在底部横幅", "超大粗体"]) expect(prompt).not.toContain(ui);
        const edited = commerceImagePrompt(amazonMain, { ...mainImage, manualPrompt: true, prompt: "换成俯拍角度" });
        expect(edited.startsWith("换成俯拍角度")).toBe(true);
        expect(edited).toContain("【平台主图硬性规则·Amazon】");
    });

    test("manual SHEIN main images retain platform constraints without restoring old copy", () => {
        const shein = { ...draft, platform: "shein", imageType: "main" };
        const main = { ...image, imageType: "main", platform: "shein", manualPrompt: true, prompt: "时尚目录的柔光构图", copy: "OLD_UNREVIEWED_COPY" };
        const prompt = commerceImagePrompt(shein, main);
        expect(prompt.startsWith(main.prompt)).toBe(true);
        expect(prompt).toContain("本张不添加文字");
        expect(prompt).toContain("SHEIN");
        expect(prompt).not.toContain(main.copy);
    });

    test("an Amazon main + secondary set clears copy only on the listing main image", () => {
        const pair = { ...draft, platform: "amazon", imageType: "set", count: 2, language: "en", typeOptions: { distribution: "主图 1 张、副图 1 张" } };
        expect(plannerPrompt(pair)).toContain("第 1 张必须是 imageType=main 的 listing 主图");
        const plan: EcommercePlan = {
            productSummary: "White ceramic mug with a curved handle",
            confirmedFacts: [],
            uncertainFacts: [],
            visualStrategy: "Clean white with warm clay accents",
            qualityChecks: ["Check the handle outline"],
            images: [
                { ...image, id: "image-1", imageType: "main", platform: "amazon", language: "en", composition: "Front view on pure white", copy: "Everyday Mug", informationComponent: "" },
                { ...image, id: "image-2", imageType: "secondary", platform: "amazon", language: "en", composition: "Breakfast table scene, mug on the right", copy: "Made for slow mornings", informationComponent: "" },
            ],
        };
        const parsed = parsePlannerOutput(JSON.stringify(plan), pair);
        expect(parsed.images[0].copy).toBe("");
        expect(parsed.images[1].copy).toBe("Made for slow mornings");
    });

    test("an image with copy may show only that copy and the product's own printed text", () => {
        // The plan prompt asks for "3 个小号卖点词" the copy does not supply; the image model must not invent them.
        const prompt = commerceImagePrompt(draft, { ...image, prompt: "左下两行导语与 3 个小号卖点词，大留白" });
        expect(prompt).toContain("【文字白名单·硬性】");
        expect(prompt).toContain("不得新增任何其他文字、数字、卖点词");
        expect(prompt).toContain("保持空白、删去，或只做无字的纯图形");
        expect(prompt.indexOf("【文字白名单·硬性】")).toBeGreaterThan(prompt.indexOf(image.copy));
        // Images without copy keep their no-text wording.
        const quiet = commerceImagePrompt({ ...draft, noText: true }, image);
        expect(quiet).toContain("无文字模式：不添加标题、说明、图标标签或装饰字");
        expect(quiet).not.toContain("【文字白名单·硬性】");
        const blank = commerceImagePrompt(draft, { ...image, copy: "" });
        expect(blank).toContain("【画面文字】不添加新文字。");
        expect(blank).not.toContain("【文字白名单·硬性】");
    });

    test("white images require pure #FFFFFF with at least 8% margin on every side", () => {
        for (const platform of ["taobao", "amazon", "xiaohongshu"]) {
            const rule = commercePlatformImageRule(platform, "white");
            for (const term of ["#FFFFFF", "四边各留不少于画幅 8% 的白边", "不贴边", "不叠加气泡"]) expect(rule).toContain(term);
            expect(rule).not.toContain("85%");
        }
        expect(commercePlatformImageRule("amazon", "white")).toContain("80%–84%");
        expect(commercePlatformStrategy("amazon", "white")).toContain("四边各留不少于 8% 的白边");
        const white = { ...draft, imageType: "white", noText: true, count: 1 };
        const prompt = commerceImagePrompt(white, { ...image, imageType: "white", copy: "", informationComponent: "" });
        for (const term of ["纯白 #FFFFFF（RGB 255,255,255）", "四边各留不少于画幅 8% 的纯白边距", "不贴边、不出画"]) expect(prompt).toContain(term);
        expect(plannerPrompt(white)).toContain("四边各留不少于画幅 8% 的白边");
    });

    test("the shared quality bar is neutral about platform and template", () => {
        for (const term of ["天猫", "抖音", "底部标语横幅", "虚线引线"]) expect(commercePhotoQualityStandard).not.toContain(term);
        expect(commercePhotoQualityStandard).toContain("接触阴影");
        expect(commercePhotoQualityStandard).toContain("不塑料感");
        expect(commercePhotoQualityStandard).toContain("【本套美术系统】");
    });

    test("copy stays verbatim while the layout follows this image's component and the set's UI kit", () => {
        const prompt = commerceImagePrompt(draft, image, "米白杯身", "奶油白与陶土橙，手写批注与牛皮纸便签");
        expect(prompt).toContain(image.copy);
        expect(prompt).toContain("逐字保留");
        expect(prompt).toContain(`本张版式：${image.informationComponent}`);
        expect(prompt).toContain("UI 套件");
        expect(prompt).toContain("【平台画面取向·淘宝】");
        for (const fixed of ["超大粗体", "放在底部横幅", "用引线指向商品对应部位"]) expect(prompt).not.toContain(fixed);
        const note = commerceImagePrompt({ ...draft, platform: "xiaohongshu" }, { ...image, platform: "xiaohongshu" });
        expect(note).toContain("【平台画面取向·小红书电商】");
        expect(note).toContain("手写批注");
    });

    test("the per-image display assignment is redrawn on every planning call and yields to the server playbook", () => {
        const main = { ...draft, imageType: "main", count: 4 };
        const lines = Array.from({ length: 12 }, () => shotLine(plannerPrompt(main)));
        expect(lines.every((line) => line.includes("服务端【本轮版式方案】存在时"))).toBe(true);
        expect(new Set(lines).size).toBeGreaterThan(1);
        // A main image always opens with the whole-product hero view.
        for (const line of lines) expect(line).toContain("图1｜机位与主体朝向：左前方三分之四侧视（英雄主视角）");
        expect(shotLine(plannerPrompt(main, "", seeded(7)))).toBe(shotLine(plannerPrompt(main, "", seeded(7))));
        expect(plannerPrompt(main)).toContain("版式来源优先级");

        const amazon = plannerPrompt({ ...main, platform: "amazon" });
        expect(shotLine(amazon)).toContain("纯白背景");
        expect(shotLine(amazon)).not.toContain("使用场景");
        expect(amazon).toContain('"noText":true');
        expect(amazon).toContain("跨境平台·Amazon（listing 货架）");
        const amazonSet = shotLine(plannerPrompt({ ...draft, platform: "amazon", imageType: "set", count: 3 }));
        expect(amazonSet).toMatch(/^逐张展示分配[^图]*图1｜[^；]*纯白背景/);

        // The image prompt fronts the plan's own composition instead of re-deriving a slot by index.
        const shot = commerceImagePrompt({ ...draft, count: 9 }, { ...image, id: "image-2", composition: "俯拍平铺，商品居中约占画面 50%" });
        expect(shot.startsWith("【本张展示·强制】本套共 9 张，这是第 2 张。按本张分镜的机位、主体朝向、景别和场景重新拍摄商品：俯拍平铺")).toBe(true);
    });

    test("the storyboard keeps the opening hero and closing poster while the middle reshuffles", () => {
        const orders = new Set<string>();
        for (let run = 0; run < 12; run += 1) {
            const lines = storyboard(commerceNarrativeDirection(draft));
            expect(lines).toHaveLength(9);
            expect(lines[0].startsWith("图1：品牌视觉首屏")).toBe(true);
            expect(lines[8].startsWith("图9：收束海报")).toBe(true);
            const middle = lines.slice(1, 8).map(moduleName);
            expect(new Set(middle).size).toBe(7);
            orders.add(middle.join("|"));
        }
        expect(orders.size).toBeGreaterThan(1);
        expect(commerceNarrativeDirection(draft)).toContain("服务端【本轮版式方案】存在时");
        expect(commerceNarrativeDirection(draft, seeded(3))).toBe(commerceNarrativeDirection(draft, seeded(3)));
        // Direct generation keeps its deterministic per-index direction.
        expect(commerceShotDirection(draft, 3)).toContain("细节解说");

        const pair = storyboard(commerceNarrativeDirection({ ...draft, imageType: "set", count: 2, typeOptions: { distribution: "主图 1 张、副图 1 张" } }));
        expect(pair).toHaveLength(2);
        expect(pair[0].startsWith("图1：品牌视觉首屏")).toBe(true);
        expect(pair[1]).not.toContain("收束海报");
        expect(
            storyboard(commerceNarrativeDirection({ ...draft, count: 12 }))
                .map(moduleName)
                .at(-1),
        ).toBe("收束海报");
    });

    test("smart casting follows the run's persona and changes it between runs", () => {
        for (const term of ["【本轮版式方案】", "每次重新策划都主动换一种人设", "同一套图内人物始终一致", "人物数量服从商品用途", "不得模仿真人或名人", "成人在旁看护", "白底、尺寸、SKU、三视图"]) {
            expect(commerceSmartModelInstruction).toContain(term);
        }
        expect(commerceSmartModelInstruction).not.toContain("自己双手抱奶瓶");
    });

    test("an unedited regeneration asks for a new take that keeps copy and hard rules", () => {
        const takes = new Set(Array.from({ length: 24 }, () => commerceRegenerationVariation(draft, image)));
        expect(takes.size).toBeGreaterThan(1);
        for (const take of takes) {
            expect(take.startsWith("【重新生成·换一版】")).toBe(true);
            expect(take).toContain("本张文案逐字不变");
            expect(take).toContain("人物设定（同一人物）");
        }
        const white = commerceRegenerationVariation({ ...draft, imageType: "white", noText: true }, { ...image, imageType: "white", copy: "" }, () => 0.99);
        expect(white).toContain("统一背景、尺度、视角与参考版式");
        expect(white).not.toContain("换场景");
        expect(white).not.toContain("本张文案逐字不变");
        const amazonMain = commerceRegenerationVariation({ ...draft, platform: "amazon", imageType: "main" }, { ...image, imageType: "main" }, () => 0);
        expect(amazonMain).toContain("统一背景、尺度、视角与参考版式");
    });
});
