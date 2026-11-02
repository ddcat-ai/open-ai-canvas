import type { EcommerceDraft, EcommercePlanImage } from "@/services/api/ecommerce";
import { commerceShuffle } from "./art-direction";
import { commercePlatformFamily, commercePlatformListingMain } from "./platform-style";

/**
 * 多张图的逐张展示分配。
 *
 * 同一套里每张图由程序预先分配不同的机位与主体朝向、景别和场景：每次策划随机抽取并写进策划提示词，
 * 出图时再把本张策划落实的机位放在出图指令最前面。只靠模型自觉时，策划结果和生图模型都容易沿用
 * 商品参考图的角度，做出多张只换背景、文案或排版的同一画面。
 *
 * 长图逐屏参考（按原图逐屏还原）和版式克隆（每张对应一张用户模板）由参考图决定构图，不参与分配。
 */
type DisplaySlot = { view: string; scale: string; scene: string };

const usageView = "商品处于真实使用状态（本张安排人物时写明佩戴、持握或操作方式；不安排人物时用环境道具表现使用情境）";

const generalSlots: DisplaySlot[] = [
    { view: "左前方三分之四侧视（英雄主视角），商品完整", scale: "全景", scene: "品牌主视觉场景或主题台座" },
    { view: usageView, scale: "中景", scene: "符合用途的真实使用场景" },
    { view: "正侧面 90° 轮廓，主体朝向画面右侧", scale: "中景", scene: "简洁的纯色或无缝背景" },
    { view: "真实可见的局部结构或材质", scale: "微距特写", scene: "局部占满画面，背景虚化" },
    { view: "俯拍顶视，镜头垂直向下", scale: "全景", scene: "平铺陈列，配少量与用途相关的道具" },
    { view: "低机位仰拍，商品显得高大有力量", scale: "近景", scene: "户外或开阔空间" },
    { view: "背面或后方三分之四（未展示的部分保守推演）", scale: "中景", scene: "环境场景" },
    { view: "商品融入环境的远景，约占画面三分之一", scale: "宽景", scene: "另一个符合用途的生活或户外场景" },
    { view: "正面平视，主体正对镜头", scale: "中景", scene: "情感或氛围场景" },
    { view: "斜上方 45° 俯视", scale: "近景", scene: "桌面或台面局部场景" },
    { view: "商品的另一种使用动作或摆放姿态", scale: "近景", scene: "另一个时段或地点的使用场景" },
    { view: "状态变化并置（开合、折叠、装满与空置等；只有商品确有多色、多件或随附配件时才做组合，不虚构其他颜色或款式）", scale: "全景", scene: "状态或组合陈列" },
    { view: "右前方 25°，镜头轻俯 15°，以近处的使用动作建立前后层次", scale: "近景", scene: "使用者所在空间的入口或过渡位置，明确前景与窗外远景" },
    { view: "左前方 55°，镜头轻俯 20°，从使用者肩后观察商品", scale: "中景", scene: "越肩真实操作，人物关注商品而不是对镜头摆拍" },
    { view: "右前方 65°，镜头俯角 35°，斜向拍摄商品与接触面", scale: "近景", scene: "逆侧光照亮纹理，前景手部与使用痕迹体现生活感" },
    { view: "左前方 15°，镜头俯角 60°，只拍有证据的接触部位", scale: "特写", scene: "一次真实操作中的关键瞬间，接触面清楚可见" },
    { view: "右前方 40°，镜头俯角 70°，展示人与商品的实际尺度", scale: "中景", scene: "人与商品相邻的自然生活空间，环境与商品形成尺度关系" },
    { view: "左前方 70°，镜头轻仰 10°，让主体斜向进入画面", scale: "全景", scene: "前景遮挡与远景透视构成景深，环境符合真实用途" },
    { view: "右前方 10°，镜头平视，取局部可见轮廓与光影边界", scale: "微距特写", scene: "柔和斜射光表现真实表面，背景只留轻量环境线索" },
    { view: "左前方 35°，镜头俯角 50°，完整商品与使用者视线形成对角线", scale: "宽景", scene: "使用结束后的生活片刻，留出自然呼吸空间" },
];

// 详情页：首屏英雄视角，随后细节、使用、轮廓、平铺交替，末屏正面收束。
const detailSlots: DisplaySlot[] = [0, 3, 1, 2, 4, 9, 12, 13, 14, 15, 16, 17, 18, 6, 5, 7, 10, 11, 19, 8].map((index) => generalSlots[index]);

const whiteSlots: DisplaySlot[] = [
    { view: "左前方三分之四侧视，商品完整", scale: "全景", scene: "纯白背景" },
    { view: "正面平视，主体正对镜头", scale: "全景", scene: "纯白背景" },
    { view: "正侧面 90° 轮廓", scale: "全景", scene: "纯白背景" },
    { view: "背面或后方三分之四（未展示的部分保守推演）", scale: "全景", scene: "纯白背景" },
    { view: "俯拍顶视", scale: "全景", scene: "纯白背景" },
    { view: "真实可见的局部结构", scale: "特写", scene: "纯白背景" },
    { view: "斜上方 45° 俯视", scale: "全景", scene: "纯白背景" },
    { view: "低机位轻仰视", scale: "全景", scene: "纯白背景" },
];

const threeViewSlots: DisplaySlot[] = [
    { view: "正面视图，正交视角", scale: "全景", scene: "纯色背景" },
    { view: "正侧面视图，正交视角", scale: "全景", scene: "纯色背景" },
    { view: "背面视图，正交视角（未展示的部分保守推演）", scale: "全景", scene: "纯色背景" },
    { view: "俯视视图，正交视角", scale: "全景", scene: "纯色背景" },
    { view: "另一侧的侧面视图", scale: "全景", scene: "纯色背景" },
    { view: "底部或仰视视图（未展示的部分保守推演）", scale: "全景", scene: "纯色背景" },
];

const sizeSlots: DisplaySlot[] = [
    { view: "正面平视，标注宽与高", scale: "全景", scene: "干净背景，尺寸线清晰" },
    { view: "正侧面，标注厚度或深度", scale: "全景", scene: "干净背景，尺寸线清晰" },
    { view: "俯拍顶视，标注长与宽", scale: "全景", scene: "干净背景，尺寸线清晰" },
    { view: "真实可见的局部，只标注已确认的局部尺寸", scale: "特写", scene: "干净背景，尺寸线清晰" },
    { view: "左前方三分之四，展示整体尺寸关系", scale: "全景", scene: "干净背景，尺寸线清晰" },
    { view: "与常见参照物同框，体现大小比例（不编造数值）", scale: "中景", scene: "生活场景" },
];

const packageSlots: DisplaySlot[] = [
    { view: "包装正面平视", scale: "全景", scene: "干净台面" },
    { view: "包装左前方三分之四侧视", scale: "全景", scene: "主题台面" },
    { view: "开箱状态：包装打开、内容物露出", scale: "中景", scene: "桌面场景" },
    { view: "内容物俯拍平铺（只放已确认的配件）", scale: "全景", scene: "整齐排列的平铺陈列" },
    { view: "包装背面或侧面信息面", scale: "近景", scene: "干净台面" },
    { view: "商品与包装同框陈列", scale: "中景", scene: "礼赠或生活场景" },
];

// 张数超过分配表时，重复出现的机位改用不同景别，并换新的场景与主体位置。
const extraScales = ["近景", "特写", "宽景", "中景", "全景"];

type DisplayDraft = Pick<EcommerceDraft, "count" | "referenceMode" | "cloneOptions" | "imageType"> & Partial<Pick<EcommerceDraft, "platform" | "typeOptions">>;

/** 这些类型的第 1 张固定为完整商品的英雄视角，其余张随机。 */
const heroFirstTypes = new Set(["main", "detail", "set", "amazon-a-plus", "poster"]);

function paletteFor(draft: DisplayDraft): DisplaySlot[] {
    if (draft.imageType === "white") return whiteSlots;
    if (draft.imageType === "three-view") return threeViewSlots;
    if (draft.imageType === "size") return sizeSlots;
    if (draft.imageType === "package") return packageSlots;
    // Amazon 一类平台的 listing 主图只能是纯白背景，只在角度与光影上区分。
    if (commercePlatformListingMain(draft.platform || "", draft.imageType, draft.typeOptions?.purpose)) return whiteSlots;
    if (draft.imageType === "detail") return detailSlots;
    return generalSlots;
}

/**
 * 每次策划重新抽取一套分配：英雄首张类型保留第 1 个机位在首位，其余顺序随机，
 * 因此同一风格再次策划时，逐张的机位、景别与场景也会换一套。
 * listing 平台的产品套图第 1 张是纯白主图。
 */
function drawPalette(draft: DisplayDraft, random: () => number): DisplaySlot[] {
    const palette = paletteFor(draft);
    const keepFirst = heroFirstTypes.has(draft.imageType);
    const drawn = keepFirst ? [palette[0], ...commerceShuffle(palette.slice(1), random)] : commerceShuffle(palette, random);
    if (draft.imageType === "set" && commercePlatformFamily(draft.platform || "").id === "listing") return [whiteSlots[0], ...drawn.slice(1)];
    return drawn;
}

function describeSlot(palette: DisplaySlot[], index: number): string {
    const base = palette[index % palette.length];
    const round = Math.floor(index / palette.length);
    if (round === 0) return `机位与主体朝向：${base.view}｜景别：${base.scale}｜场景：${base.scene}`;
    const scales = extraScales.filter((scale) => scale !== base.scale);
    const scale = scales[(round - 1) % scales.length];
    return `机位与主体朝向：在${base.view}的基础上向${round % 2 ? "右" : "左"}移动${10 + round * 5}°并改变俯角${round * 8}°，禁止复用前面的机位组合｜景别：${scale}｜场景：换一个新的${base.scene}，本页强调不同的真实细节或操作，商品在画面中的位置也要变化`;
}

export function commerceDisplaySlotsApply(draft: Pick<EcommerceDraft, "count" | "referenceMode" | "cloneOptions">): boolean {
    return Number.isInteger(draft.count) && draft.count >= 1 && draft.referenceMode !== "detail" && !draft.cloneOptions;
}

/** 整套逐张展示分配（每次调用重新随机抽取）；不需要分配时返回空数组。任意两张的分配互不相同。 */
export function commerceDisplaySlots(draft: DisplayDraft, random: () => number = Math.random): string[] {
    if (!commerceDisplaySlotsApply(draft)) return [];
    const palette = drawPalette(draft, random);
    return Array.from({ length: draft.count }, (_, index) => describeSlot(palette, index));
}

/** 写进策划提示词：让策划模型按本轮分配逐张展开构图、主体和提示词。 */
export function commerceDisplayAssignment(draft: DisplayDraft, random: () => number = Math.random): string {
    const slots = commerceDisplaySlots(draft, random);
    if (!slots.length) return "";
    return `逐张展示分配（本轮随机抽取，每次策划都会重新分配；服务端【本轮版式方案】存在时，逐张版式与机位以其为准，本分配用来保证任意两张的展示互不相同）：${slots.map((slot, index) => `图${index + 1}｜${slot}`).join("；")}。同一套里任意两张都不能是同一种展示：不得使用相同的机位与主体朝向，也不能只换背景、文案、配色或版式来充当新的一张。每张 composition、mainVisual 和 prompt 都必须写明本张的机位、主体朝向、景别和场景，出图时会按 composition 重新拍摄；用户补充要求里明确指定了某张的角度时以用户为准，其余张仍互不相同。白底、三视图、尺寸、包装与平台主图等硬性规则优先于分配中的场景描述。未展示的轮廓只能保守推演，不把推演角度写成已证实的功能或结构。`;
}

function displayIndex(image: Pick<EcommercePlanImage, "id">): number {
    return Number(/^(?:image|direct)-(\d+)$/.exec((image.id || "").trim())?.[1]) - 1;
}

/**
 * 放在每张出图指令最前面：生图模型最看重开头几行。
 * 机位取自本张策划写下的 composition（它落实了本轮分配与服务端版式方案），
 * 不在出图时按序号重新推算，所以策划与出图始终一致。
 */
export function commerceDisplayDirective(draft: DisplayDraft, image: Pick<EcommercePlanImage, "id"> & Partial<Pick<EcommercePlanImage, "composition" | "displayAssignment">>): string {
    if (image.displayAssignment) return `【本张展示·强制】${image.displayAssignment}\n参考图只锁定商品身份；按指定机位重新拍摄，不得把参考商品原角度贴到新背景中。不得虚构不可见结构或功能。`;
    if (!commerceDisplaySlotsApply(draft)) return "";
    const index = displayIndex(image);
    if (!Number.isInteger(index) || index < 0 || index >= draft.count) return "";
    const composition = (image.composition || "").trim().replace(/\s+/g, " ");
    const shot = composition ? `按本张分镜的机位、主体朝向、景别和场景重新拍摄商品：${composition.length > 160 ? `${composition.slice(0, 160)}…` : composition}。` : "按本张分镜写明的机位、主体朝向、景别和场景重新拍摄商品。";
    return `【本张展示·强制】本套共 ${draft.count} 张，这是第 ${index + 1} 张。${shot}商品参考图只用来识别商品外观，不沿用参考图的拍摄角度、朝向和裁切。本套每张的展示方式都不同，本张不能做成只换背景、文案或排版的同一画面。白底、无人物与平台主图等硬性规则优先于本条的场景描述。`;
}
