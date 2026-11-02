import { modelCapabilityConfigFor, normalizeImageValue, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import { modelQuoteRequest } from "@/lib/model-pricing";
import { createGenerationTask, queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { parseBackendGenerationResult, prepareBackendGenerationTask } from "@/services/api/generation-task";
import { quoteModel } from "@/services/api/logical-models";
import { resourceStorageKey } from "@/services/api/resources";
import { createWorkbenchTask } from "@/services/api/workbench";
import { createEcommerceProject, getEcommerceSkillPrompt, normalizeEcommerceReferenceGroups, saveEcommerceProject, type EcommerceDraft, type EcommercePlan, type EcommerceProject } from "@/services/api/ecommerce";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import { plannerPrompt, parsePlannerOutput, assertCommercePlanCurrent, groundCommerceClaims, assertCommerceDetailRhythm } from "./planner";
import { commerceDisplayDirective } from "./display-slots";
import { selectedCreationRequirements, typeValidation } from "./type-config";
import { labelOf, languages, resolveAutoImageSize, styles } from "./catalog";
import { activeCommerceReferences, commerceModelInstruction, commercePlanningReferenceCount } from "./model-context";
import { commerceAllowsText, commerceCreativeBrief, normalizeCreativeOptions } from "./creative-controls";
import { commerceLayoutReferences, commerceReferenceImageInstruction, normalizeReferenceDraft, validateCommerceReferencePlan } from "./reference-plan";
import { prepareCommerceReferencePlan, prepareCommerceReferenceViews } from "./long-reference-media";
import { assertCommerceConsumerCopy, commerceTypographyInstruction } from "./consumer-copy";
import { commercePlatformImageRule, commercePlatformListingMain } from "./platform-style";
import { commerceRestrictedPhrase } from "./platform-knowledge";

export function manuallyEditedCommerceImage(original: EcommercePlan["images"][number], edited: EcommercePlan["images"][number]) {
    if (original.prompt === edited.prompt) return edited;
    return {
        ...edited,
        goal: "按用户本轮编辑的提示词创作",
        theme: edited.prompt.split("\n")[0] || "用户自定义视觉方案",
        composition: "以本张最新 AI 提示词中的构图要求为准",
        mainVisual: "以商品参考图和本张最新 AI 提示词为准",
        lighting: "以本张最新 AI 提示词中的灯光要求为准",
    };
}

const commerceRegenerationShifts = [
    "换机位：改用与上一版明显不同的拍摄角度与高度（如三分之四侧视、俯拍或低机位），商品朝向随之改变",
    "换构图：把商品移到画面另一侧，或在偏轴、对角线、居中对称中换一种构图，留白区随之换位",
    "换场景：保持同一使用情境，换一个具体环境、台面材质或道具组合，并改变时段光线",
    "换光影：改变主光方向与光比（侧逆光、顶部柔光或窗光），重新安排阴影与高光的走向",
    "换景别：上一版偏全景就改为中近景并带出一处真实可见细节，偏近景就拉远展示完整商品与环境关系",
];
const commerceRegenerationLayoutShift = "换版式：在本套 UI 套件内换一种信息组织方式（例如卡片改为编号列表、气泡改为角标或手写批注），文字块整体换到新的位置";
const commerceRegenerationPersonShift = "换人物表现：同一位人物换姿态、视线与使用商品的动作，机位随之调整";
const commerceRegenerationFaces = ["偏椭圆脸、自然平眉与柔和下颌", "偏方脸、较浓眉毛与清楚下颌转折", "略长脸、弧眉与清楚唇峰", "偏圆脸、柔和面颊与自然眉峰", "清楚颧骨、平缓唇线与自然眉毛", "宽额、略圆下颌与自然眉间距"];
const commerceFixedRegenerationShifts = ["微调商品的摆放角度与朝向（在本类型允许的视角内），背景与尺度规范不变", "重新布光：调整主光柔和度与高光位置，让轮廓、材质和接触阴影更干净", "按同一规范重新拍摄：提升边缘清晰度与色彩准确度，去除上一版的瑕疵"];

/**
 * Appended to an unedited regeneration so the retry is a new take instead of the
 * same picture again. Fixed-layout, listing-main and reference-driven images only
 * get re-shoot variations that keep their layout contract.
 */
export function commerceRegenerationVariation(draft: EcommerceDraft, image: EcommercePlan["images"][number], random: () => number = Math.random) {
    const fixed = ["white", "sku", "size", "three-view", "package"].includes(image.imageType) || commercePlatformListingMain(draft.platform, image.imageType, draft.typeOptions?.purpose) || Boolean(draft.referenceMode && draft.referenceMode !== "product");
    const hasCopy = commerceAllowsText(draft, image.imageType) && Boolean((image.copy || "").trim());
    const pool = fixed ? commerceFixedRegenerationShifts : [...commerceRegenerationShifts, ...(hasCopy ? [commerceRegenerationLayoutShift] : []), ...(commerceImageUsesModel(draft, image) ? [commerceRegenerationPersonShift] : [])];
    const shift = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    if (draft.count === 1 && commerceImageUsesModel(draft, image) && !draft.references.some((ref) => draft.modelEnabled && ref.role === "model")) {
        const face = commerceRegenerationFaces[Math.min(commerceRegenerationFaces.length - 1, Math.floor(random() * commerceRegenerationFaces.length))];
        return `【重新生成·换一版】单张自动选角重新选人：${shift}；在商品适用人群和目标市场内换一位人物，面貌方向为${face}，肤质真实、表情自然。此轮换人优先于旧分镜中的自动人物面貌；不复用上一版默认面孔，不只换衣服。保留本张已审阅文案、真实商品、所选风格与平台类型规则。明确指定人物身份时仍以用户要求为准。`;
    }
    return `【重新生成·换一版】用户要求在同一方案下换一版，成品要与上一版明显不同：${shift}。保持不变：${hasCopy ? "本张文案逐字不变，" : ""}商品外观与事实、本套色板与字体、人物设定（同一人物）以及平台与类型硬性规则${fixed ? "（统一背景、尺度、视角与参考版式）" : ""}。`;
}

export function commercePlanningSource(task: GenerationTask): EcommerceDraft {
    const input = task.inputJson ? JSON.parse(task.inputJson) : null;
    const source = input?.metadata?.ecommerceDraft;
    if (!source || !Array.isArray(source.references) || !Array.isArray(source.skus) || typeof source.productName !== "string") throw new Error("策划任务缺少提交时的参数快照，请重新策划");
    return { ...normalizeEcommerceReferenceGroups(source), creativeOptions: normalizeCreativeOptions(source) } as EcommerceDraft;
}

/** Shared commercial-photography bar for every generated image. */
export const commercePhotoQualityStandard =
    "商业成品品质：成熟品牌商业摄影的完成度，真实摄影质感的商品与场景，商品本身不是插画或 3D 渲染感。商品是第一视觉，轮廓完整锐利，透视与比例真实；主光、辅光与轮廓光逻辑一致，金属/玻璃有干净的高光条，织物/木/纸能看清纹理；商品与承托面有真实接触阴影和合理反射（手持时手部与商品的遮挡、受光关系真实），道具与商品光向、尺度一致，不能像抠图贴在背景上。商品本色准确、白平衡统一，背景与道具服从本套色板和本张类型规则；后期干净，保留材质细节，不过度锐化、不塑料感、不 HDR 光晕。允许文字时，平面设计层（标题、标签、图标、卡片等）的形式按【本套美术系统】与本张版式执行，不套用一成不变的固定模板。";

/** Reference photos lock product identity only; every page re-shoots the product in its own scene. */
export function commerceProductReshoot(imageType: string) {
    if (["white", "three-view", "sku", "size"].includes(imageType)) return "【商品重拍】参考图只锁定商品身份（外形、颜色、Logo、结构）。重新拍摄干净完整的商品，不沿用参考照片的背景、光线、手部、污渍或残留内容物。";
    return "【商品重拍】参考图只锁定商品身份（外形、颜色、Logo、结构、刻度、接口等可见细节），不是要贴进画面的素材。按本张分镜在新场景中重新拍摄商品：新机位、新布光，商品干净完整、无指纹污渍和杂物，按本张分镜放在与主题匹配的台面、台座、真实使用环境或使用者手中，并有真实接触阴影。不沿用参考照片的背景、光线、裁切、手部、杂物或内容物状态（例如参考图里的半瓶奶只是拍摄时的偶然状态）；严格按本张分镜写明的“商品状态”呈现：空置、满、半满、使用中、拆解组件、收纳、密封演示等，没写明时按本张目的选择最能说明卖点的状态。";
}

const commerceArtifactGuard = "避免 AI 痕迹：扭曲或乱码文字、变形 Logo、多余或融化的部件、错误的手指、重复图案、无来源的光斑粒子和漂浮杂物。没有内部结构资料时，不绘制写实爆炸图、剖面或内部零件。";

export type CommerceImageParameters = { size: string; quality?: string; imageResolution?: string; count: 1; canvasSize?: string };

export function commerceImageParameters(profile: ImageCapabilityConfig, ratio: string, resolution: string): CommerceImageParameters {
    const normalized = normalizeImageValue(profile, { size: ratio, imageResolution: resolution, quality: profile.quality.default, count: "1" });
    const base: CommerceImageParameters = { size: String(normalized.size || ratio), quality: normalized.quality, imageResolution: normalized.imageResolution, count: 1 };
    // Submit the selected ratio itself; never substitute a wider generation canvas.
    return { ...base, canvasSize: base.size };
}

export function commerceImagePrompt(draft: EcommerceDraft, image: EcommercePlan["images"][number], productSummary = "", visualStrategy = "", parameters?: Pick<CommerceImageParameters, "canvasSize">) {
    if (!image.manualPrompt && commerceAllowsText(draft, image.imageType)) assertCommerceConsumerCopy(image.copy || "");
    const prompt = baseCommerceImagePrompt(draft, image, productSummary, visualStrategy);
    const reference = commerceReferenceImageInstruction(draft, image);
    const extended = Boolean(parameters?.canvasSize && parameters.canvasSize !== image.ratio);
    const fullBleed = `【画幅】按 ${extended ? "本次生成尺寸" : image.ratio} 原生构图，full bleed edge-to-edge artwork，场景与背景连续延伸到四条边。禁止上下黑条、白条、letterbox、pillarbox、相框、胶片边框；不能把横向海报缩进竖向画幅。商品参考图即使是多视角拼贴说明板，也只提取商品身份，不复制原板的分格、边框、文字布局。`;
    const frame = extended ? commerceExtendedCanvasNote(image.ratio) : commerceTallCanvasSafeArea(image.ratio);
    const typography = commerceAllowsText(draft, image.imageType) && (image.copy || "").trim() ? `\n\n${commerceTypographyInstruction}` : "";
    return `${prompt}${reference ? `\n\n【参考执行】（优先于默认的构图变化建议，用户本张编辑及真实商品约束仍优先）${reference}` : ""}\n\n${fullBleed}${frame}${typography}`;
}

function commerceExtendedCanvasNote(ratio: string) {
    return `\n\n【成片画布】最终成片为 ${ratio} 竖长画布，本张按较宽的生成尺寸完整构图，系统会在上下两端延展背景补足画布：上下边缘保持干净连续的背景（纯色、渐变或台面延伸），不要在上下边缘放文字、商品或被截断的装饰；左右四边的文字、卡片与商品都完整留在画面内并留出边距。`;
}

/**
 * Background bleed must never be interpreted as permission to bleed copy or UI.
 */
export function commerceTallCanvasSafeArea(_ratio: string) {
    return "\n\n【防溢出安全区，所有比例适用】每一个文字块、标签、胶囊条、图标气泡、放大窗和卡片的完整外框（含描边、阴影及旋转后的四角）都必须在画幅四边各内缩至少 8% 的安全区内，即横纵坐标均在 8%–92% 内；任何元素不得贴边、出界或被裁切。背景满版不等于文字满版：画面四边只延续背景或场景，保留约 20%–30% 干净呼吸空间，不添加外部白框。两侧气泡与卡片要换行、向内移动或重新分栏，不能横向撑出画面；不能以裁切文字、标签或卡片制造设计感。";
}

/**
 * With copy, the listed lines and the product's own printed text are the only text allowed in the image: a plan
 * prompt or layout may still ask for "3 个小卖点词" or a badge the copy does not fill, and the image model would
 * invent claims for them.
 */
export const commerceTextWhitelistRule =
    "【文字白名单·硬性】画面里只允许出现上面列出的文案原文，以及商品本身印刷或压印的文字（Logo、刻度、包装原文）；不得新增任何其他文字、数字、卖点词、标签字、英文装饰字或编号。本张分镜、版式或提示词里要求的标签位、卖点词、胶囊、徽章、气泡或卡片若在上面的文案里没有对应内容，就保持空白、删去，或只做无字的纯图形（图标、色块、线条），绝不自行补写。";

function commerceImageTextBlock(draft: EcommerceDraft, image: EcommercePlan["images"][number]) {
    if (!commerceAllowsText(draft, image.imageType)) return "【画面文字】无文字模式：不添加标题、说明、图标标签或装饰字，仅保留商品本身真实 Logo 和包装原文。";
    if (!(image.copy || "").trim()) return "【画面文字】不添加新文字。";
    const component = image.informationComponent?.trim();
    const layout = component ? `\n本张版式：${component}` : "";
    return `【画面文字】把以下已审阅文案作为成品排版，逐字保留，不改写、不增写主张：\n${image.copy}${layout}\n排版：文字的位置、阅读顺序与组件形式按${component ? "本张版式和" : ""}【本张分镜】的构图执行；组件只从【本套美术系统】定义的 UI 套件中选用（例如该套规定的气泡、卡片、编号列表、手写批注、贴纸、便签或角标），不套用与本张版式无关的固定模板。第一行通常是本张主标题，用本套标题字体形成最强层级；“卖点｜说明”格式的行是一组信息，前半句做粗体短卖点、后半句做常规说明，用同一种组件呈现，不画出“｜”符号；末行若是标语，作为收束信息放在本张版式指定的位置。图标与标注只对应真实可见或已确认的信息，并与商品品类相符。文字清晰完整、无错字，与商品互相避让。\n${commerceTextWhitelistRule}`;
}

function baseCommerceImagePrompt(draft: EcommerceDraft, image: EcommercePlan["images"][number], productSummary = "", visualStrategy = "") {
    const sku = draft.skus.find((item) => item.id === image.skuId);
    const imageDraft = { ...draft, imageType: image.imageType };
    const viewpoint =
        draft.referenceMode !== "detail" && draft.count > 1 && !["sku", "white", "size", "three-view", "package"].includes(image.imageType)
            ? "多图分镜：严格执行本张指定的机位、主体朝向、景别和场景；商品参考图用于识别产品及保留可见外观，不要求复制参考图的拍摄角度。本套任意两张都不能沿用同一机位，也不能只换背景、文案或排版。未展示的侧背轮廓只能合理推演，不能新增明确接口、按钮、Logo 或功能。"
            : "";
    const modelPlacement = commerceImageUsesModel(draft, image)
        ? `本张画面安排模特与商品发生明确的佩戴、持握或使用关系。${draft.references.some((ref) => ref.role === "model") ? "保持已选主模特形象。" : "根据目标市场、目标人群和商品使用方式，在提示词中具体描述适合的模特形象并与本套其他人物图保持一致。"}商品依然清晰完整，人物不能掩盖关键细节。`
        : "本张聚焦商品，不添加模特或路人。";
    const modelInstruction = commerceImageUsesModel(draft, image) ? commerceModelInstruction(draft) : "本张不使用模特，也不读取已选模特参考图。";
    const typeConstraint =
        image.imageType === "white"
            ? "白底图硬性规则：整张背景必须是纯白 #FFFFFF（RGB 255,255,255），无灰底、无渐变、无暗角、无场景、无道具、无模特、无广告字；商品完整，四边各留不少于画幅 8% 的纯白边距，商品任何部分都不贴边、不出画；只保留真实商品轮廓和可选的极轻自然接触阴影。"
            : image.imageType === "single"
              ? "单图硬性规则：只输出一张独立成品，不拼贴成套图或多宫格。"
              : "";
    const listingMain = commercePlatformListingMain(draft.platform, image.imageType, draft.typeOptions?.purpose);
    const platformRule = commercePlatformImageRule(draft.platform, image.imageType, draft.typeOptions?.purpose);
    const summary = (productSummary || "").trim();
    if (image.manualPrompt)
        return [
            image.prompt,
            `【全局创作设置】\n${commerceCreativeBrief(imageDraft)}`,
            typeConstraint,
            // A hand-edited prompt owns composition and tone, but a listing main image stays compliant.
            platformRule,
            `【人物】${modelPlacement}\n模特执行要求：${modelInstruction}`,
            summary ? `【商品保真】商品图可见外观参考：${summary}` : "",
            `以本张用户手动编辑的提示词为最终构图、视角、场景和文案要求；不恢复旧方案文案，不擅自增写未审阅的主张。${commerceAllowsText(draft, image.imageType) ? "" : "纯图规则仍优先：不添加新文字、文字标签或营销标题。"}保留真实商品主体及参考图中可辨认的 Logo、颜色与结构；未提供的背面、接口、材质和功能只可做合理视觉探索，不得标作已验证事实。`,
            `${commercePhotoQualityStandard}\n${commerceArtifactGuard}\n避免：${image.negativePrompt || "虚构认证、价格或功能"}`,
        ]
            .filter(Boolean)
            .join("\n\n");
    // Order matters: image models weigh the opening lines most, so the shot
    // comes first and constraints last, each block stated once.
    const style = visualStrategy.trim() || [labelOf(styles, draft.style), draft.stylePrompt].filter(Boolean).join("；");
    const claims = [draft.claims, sku?.claims].filter(Boolean).join("；");
    const shot = [image.goal && `目的：${image.goal}`, image.mainVisual && `主体：${image.mainVisual}`, image.composition && `构图与机位：${image.composition}`, image.lighting && `布光：${image.lighting}`, viewpoint].filter(Boolean).join("\n");
    const requirements = Object.entries(selectedCreationRequirements(draft))
        .map(([label, value]) => `${label}：${value}`)
        .join("；");
    const userAsks = [
        requirements ? `创作要求：${requirements}` : "",
        visualStrategy.trim() && draft.stylePrompt ? `用户自定义风格：${draft.stylePrompt}` : "",
        draft.lockedDetails ? `必须保留的细节：${draft.lockedDetails}` : "",
        draft.fidelity ? `保真模式：${draft.fidelity}` : "",
        sku ? `SKU：${JSON.stringify({ name: sku.name, color: sku.color, spec: sku.spec, packaging: sku.packaging, claims: sku.claims, price: sku.price })}` : "",
        `目标语言：${labelOf(languages, draft.language)}`,
    ]
        .filter(Boolean)
        .join("\n");
    return [
        commerceDisplayDirective(draft, image),
        image.prompt,
        commerceProductReshoot(listingMain ? "white" : image.imageType),
        style ? `【本套美术系统】所有图片共同执行的配色、布景、光线、字体与图形规则：${style}` : "",
        `【本张分镜】\n${shot}`,
        `【创作设置】\n${commerceCreativeBrief(imageDraft)}${typeConstraint ? `\n${typeConstraint}` : ""}\n${platformRule}\n本次只输出当前这一张完整成品；不拼接其他页面，不输出九宫格。`,
        `【人物】${modelPlacement}\n模特执行要求：${modelInstruction}`,
        `【商品保真】${summary ? `商品图视觉观察（仅用于外观保真，不把推测当作功能或材质事实）：${summary}\n` : ""}${image.fidelity ? `保真约束：${image.fidelity}\n` : ""}保留商品原有真实 Logo 和包装文字，不添加水印。${claims ? `\n已核实卖点：${claims}` : ""}`,
        userAsks ? `【用户要求】\n${userAsks}` : "",
        commerceImageTextBlock(draft, image),
        `【品质标准】${commercePhotoQualityStandard}\n${commerceArtifactGuard}`,
        `【避免】禁止编造材质、功能、认证、价格或售后承诺。${image.negativePrompt ? image.negativePrompt : ""}`,
    ]
        .filter(Boolean)
        .join("\n\n");
}

type Config = AiConfig;

export function commercePlanningModels(config: Config, textModels: string[], referenceCount: number) {
    const required = referenceCount;
    return textModels.filter((model) => (modelCapabilityConfigFor(config, model).text?.references.maxImages || 0) >= required);
}

export function commercePlanningPayload(draft: EcommerceDraft, maxImages: number, skillPrompt = "") {
    draft = normalizeReferenceDraft(draft);
    const invalidType = typeValidation(draft);
    if (invalidType) throw new Error(invalidType);
    if (!Number.isInteger(draft.count) || draft.count < 1 || draft.count > 30) throw new Error("生成数量须为 1–30 的整数");
    const references = activeCommerceReferences(draft);
    if (maxImages < references.length) throw new Error(`后台指定的策划模型最多读取 ${maxImages} 张图片，当前提供 ${references.length} 张；请减少图片或联系管理员更换模型`);
    return {
        prompt: plannerPrompt(draft, skillPrompt),
        referenceImages: references.map((reference) => ({ id: reference.resourceId, name: reference.name || reference.role, type: "image/*", dataUrl: "", storageKey: resourceStorageKey(reference.resourceId) })),
    };
}

export async function prepareCommercePlanningPayload(draft: EcommerceDraft, maxImages: number, skillPrompt = "", assertCurrent?: () => void) {
    // Validate ordinary settings before doing media work or uploads.
    commercePlanningPayload(draft, maxImages, skillPrompt);
    const prepared = await prepareCommerceReferenceViews(draft, maxImages, assertCurrent);
    const payload = commercePlanningPayload(prepared.draft, maxImages, skillPrompt);
    const start = payload.referenceImages.length;
    return {
        draft: prepared.draft,
        ...payload,
        prompt:
            payload.prompt +
            (prepared.views.length
                ? `\n长图局部阅读映射：${JSON.stringify(prepared.views.map((view, index) => ({ inputImageOrder: start + index + 1, sourceResourceId: view.sourceResourceId, top: view.top, bottom: view.bottom })))}。这些图片是各自原长图的连续放大阅读窗，不是新增商品，也不是确定的屏幕边界。请结合对应原图识别各真实内容屏。`
                : ""),
        referenceImages: [...payload.referenceImages, ...prepared.views.map((view) => ({ id: view.resourceId, name: view.name || "长图阅读窗", type: "image/*", dataUrl: "", storageKey: resourceStorageKey(view.resourceId) }))],
    };
}

function commerceGenerationBaseReferences(draft: EcommerceDraft) {
    const refs = activeCommerceReferences(draft);
    if (draft.referenceMode !== "detail") return refs;
    return normalizeEcommerceReferenceGroups(draft).references.filter((ref) => ref.role !== "model" || draft.modelEnabled);
}

export function commerceImageReferences(draft: EcommerceDraft, image: EcommercePlan["images"][number], index: number, clone: boolean) {
    if (draft.referenceMode === "detail") {
        if (!image.referenceScreen?.resourceId) throw new Error(`第${index + 1}屏尚未准备对应参考裁片`);
        return [...commerceGenerationBaseReferences(draft).filter((ref) => ref.role !== "model" || commerceImageUsesModel(draft, image)), { resourceId: image.referenceScreen.resourceId, role: "style" as const, name: `第${index + 1}屏版式参考` }];
    }
    if (clone) {
        const template = commerceLayoutReferences(draft).filter((ref) => ref.role === "style")[index];
        if (!template) throw new Error(`第 ${index + 1} 张缺少版式模板`);
        return [...draft.references.filter((ref) => ref.role === "primary" || (ref.role === "model" && commerceImageUsesModel(draft, image))), template];
    }
    return activeCommerceReferences(draft).filter((ref) => (ref.role !== "sku" || ref.resourceId === draft.skus.find((sku) => sku.id === image.skuId)?.resourceId) && (ref.role !== "model" || commerceImageUsesModel(draft, image)));
}

export function commerceImageUsesModel(draft: EcommerceDraft, image: EcommercePlan["images"][number]) {
    // "智能匹配" (model switch off) still lets the plan cast people where a page needs them.
    if (["white", "sku", "size", "three-view", "material", "package"].includes(image.imageType)) return false;
    return /模特|人物|真人|人像|佩戴|手持|穿着|上身|宝宝|婴儿|妈妈|爸爸|家长|model|person|portrait|wearing|lifestyle|\bbaby\b|\bmother\b|\bparent\b/i.test([image.prompt, image.composition, image.mainVisual].join(" "));
}

export function commerceRequiredImageReferenceCount(draft: EcommerceDraft, clone = false) {
    if (draft.referenceMode === "detail") return commerceGenerationBaseReferences(draft).length + 1;
    const references = activeCommerceReferences(draft);
    if (clone) return references.filter((ref) => ref.role === "primary" || ref.role === "model").length + 1;
    if (draft.imageType === "sku") return Math.max(0, ...draft.skus.map((sku) => references.filter((ref) => ref.role !== "sku" || ref.resourceId === sku.resourceId).length));
    return references.length;
}

export function assertCommerceImageReferenceCapacity(referenceCount: number, modelMaxImages: number) {
    if (referenceCount > 20) throw new Error(`平台单次生图最多接收 20 张参考图片，当前需要 ${referenceCount} 张；请减少本次生图使用的商品图或借鉴图片`);
    const limit = Math.min(20, modelMaxImages);
    if (referenceCount < 0 || referenceCount > limit) throw new Error(`当前图片模型最多接收 ${limit} 张参考图片，当前需要 ${referenceCount} 张；请更换模型或减少图片`);
}

/**
 * The size an image is generated and quoted at: 自动 becomes the platform and type recommendation
 * (commerceAutoRatio) when the image model offers that ratio, otherwise it stays the model's own auto size. A set
 * uses the set's recommendation for every image. The plan itself keeps "auto".
 */
export function commerceGenerationRatio(config: Config, draft: Pick<EcommerceDraft, "platform" | "imageType"> & Partial<Pick<EcommerceDraft, "typeOptions">>, image: { imageModel: string; ratio: string; imageType?: string }) {
    const sizes = modelCapabilityConfigFor(config, image.imageModel).image?.size.values || [];
    return resolveAutoImageSize(image.ratio, sizes, draft.platform, draft.imageType === "set" ? "set" : image.imageType || draft.imageType, draft.typeOptions?.purpose);
}

export async function quoteCommerce(config: Config, draft: EcommerceDraft, count: number, clone = false, planning = true) {
    const imageRefs = commerceRequiredImageReferenceCount(draft, clone);
    const ratio = commerceGenerationRatio(config, draft, draft);
    const imageRequest = modelQuoteRequest(config, draft.imageModel, "image", {
        capability: "image",
        input: { textCount: 1, imageCount: imageRefs, referenceImageCount: imageRefs, videoCount: 0, audioCount: 0, characterCount: 0 },
        imageSize: ratio,
        options: { size: ratio, imageResolution: draft.resolution, count: 1 },
    });
    const maxAgentRefs = modelCapabilityConfigFor(config, draft.agentModel).text?.references.maxImages || 0;
    const agentRefs = commercePlanningReferenceCount(draft);
    if (planning && agentRefs > maxAgentRefs) throw new Error(`后台指定的策划模型最多读取 ${maxAgentRefs} 张图片，请减少参考图或联系管理员更换模型`);
    const agentRequest = modelQuoteRequest(config, draft.agentModel, "text", {
        capability: "text",
        input: { textCount: 1, imageCount: agentRefs, referenceImageCount: agentRefs, videoCount: 0, audioCount: 0, characterCount: 0 },
    });
    if (!imageRequest || (planning && !agentRequest)) throw new Error("当前模型无法报价，请更换模型");
    const [image, agent] = await Promise.all([quoteModel(imageRequest), planning && agentRequest ? quoteModel(agentRequest) : Promise.resolve(null)]);
    const agentCost = agent?.quote.amountMicrocredits || 0;
    return { image: image.quote.amountMicrocredits / 1_000_000, agent: agentCost / 1_000_000, total: (image.quote.amountMicrocredits * count + agentCost) / 1_000_000 };
}

export async function submitCommercePlan(config: Config, draft: EcommerceDraft, existing?: EcommerceProject | null) {
    assertCommerceImageReferenceCapacity(commerceRequiredImageReferenceCount(draft), modelCapabilityConfigFor(config, draft.imageModel).image?.references.maxImages || 0);
    const maxImages = modelCapabilityConfigFor(config, draft.agentModel).text?.references.maxImages || 0;
    const skillPrompt = await getEcommerceSkillPrompt(draft.skillIds || []);
    const payload = await prepareCommercePlanningPayload(draft, maxImages, skillPrompt);
    draft = payload.draft;
    const project = await saveEcommerceProject(existing || (await createEcommerceProject()), draft, null);
    const input = await prepareBackendGenerationTask({
        projectId: project.id,
        mode: "text",
        prompt: payload.prompt,
        config: { ...config, model: draft.agentModel },
        referenceImages: payload.referenceImages,
        metadata: { source: "ecommerce-agent", ecommerceProjectId: project.id, stage: "planning", ecommerceDraft: { ...draft, planningTaskId: undefined } },
    });
    const task = await createGenerationTask(input);
    return { task, project: await saveEcommerceProject(project, { ...draft, planningTaskId: task.id }, null) };
}

export async function settleCommercePlan(task: GenerationTask, _draft: EcommerceDraft, project: EcommerceProject) {
    if (task.status !== "succeeded") throw new Error(task.error || "策划任务未成功");
    const result = parseBackendGenerationResult(task);
    if (!result.text) throw new Error("策划模型没有返回文本");
    const source = commercePlanningSource(task);
    const plan = parsePlannerOutput(result.text, source);
    const nextDraft = { ...source, count: source.referenceMode === "detail" ? plan.images.length : source.count, planningTaskId: undefined };
    return { draft: nextDraft, plan, project: await saveEcommerceProject(project, nextDraft, plan) };
}

// Keep a small client-side pool: the provider queue gets all pages promptly,
// while browser/network pressure and accidental duplicate submissions stay bounded.
export const commerceImageSubmissionConcurrency = 3;

export async function submitCommerceImages(config: Config, draft: EcommerceDraft, plan: EcommercePlan, project: EcommerceProject, onSaved: (project: EcommerceProject, plan: EcommercePlan) => void, clone = false) {
    assertCommercePlanCurrent(plan, draft);
    for (const [index, image] of plan.images.entries()) {
        if (image.taskId || !commerceAllowsText(draft, image.imageType)) continue;
        const phrase = commerceRestrictedPhrase(image.copy || "");
        if (phrase) throw new Error(`第${index + 1}张含高风险宣传词「${phrase}」，请改为有依据的具体描述后再生成`);
    }
    plan = groundCommerceClaims(plan, draft);
    assertCommerceDetailRhythm(plan, draft);
    validateCommerceReferencePlan(plan, draft);
    if (plan.images.length !== draft.count || plan.uncertainFacts.length) throw new Error("请核对策划数量与待确认商品事实后再生成");
    for (const image of plan.images) assertCommerceImageReferenceCapacity(commerceRequiredImageReferenceCount(draft, clone), modelCapabilityConfigFor(config, image.imageModel).image?.references.maxImages || 0);
    let current = project;
    let nextPlan = await prepareCommerceReferencePlan(draft, plan, {
        onSaved: async (prepared) => {
            current = await saveEcommerceProject(current, draft, prepared);
            onSaved(current, prepared);
        },
    });
    const pending = nextPlan.images.flatMap((planned, index) => {
        if (planned.taskId) return [];
        const profile = modelCapabilityConfigFor(config, planned.imageModel).image;
        if (!profile) throw new Error(`第 ${index + 1} 张图片模型不可用`);
        const refs = commerceImageReferences(draft, planned, index, clone);
        assertCommerceImageReferenceCapacity(refs.length, profile.references.maxImages);
        if (!profile.size.values.includes(planned.ratio) || (profile.resolution.supported && !profile.resolution.values.includes(planned.resolution))) throw new Error(`第 ${index + 1} 张的比例或分辨率不受支持`);
        const image = { ...planned, ratio: commerceGenerationRatio(config, draft, planned) };
        const parameters = commerceImageParameters(profile, image.ratio, image.resolution);
        return [{ image, index, refs, parameters, receiptKey: `ecommerce-task:${project.id}:${image.id}` }];
    });
    const outcomes: Array<{ task: GenerationTask; receiptKey: string } | { failed: true; receiptKey: string; error: unknown } | undefined> = Array(nextPlan.images.length);
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(commerceImageSubmissionConcurrency, pending.length) }, async () => {
            while (true) {
                const item = pending[cursor++];
                if (!item) return;
                const { image, index, refs, parameters, receiptKey } = item;
                try {
                    const priorTaskId = sessionStorage.getItem(receiptKey);
                    const task = priorTaskId
                        ? await queryGenerationTask(priorTaskId)
                        : await createWorkbenchTask({
                              kind: "image",
                              prompt: commerceImagePrompt(draft, image, plan.productSummary, plan.visualStrategy, parameters),
                              model: modelOptionName(image.imageModel),
                              ...(logicalModelIDForConfig({ ...config, model: image.imageModel }) ? { logicalModelId: logicalModelIDForConfig({ ...config, model: image.imageModel }) } : { channelId: resolveModelChannel(config, image.imageModel).id }),
                              parameters,
                              references: refs.map((ref) => ({ resourceId: ref.resourceId, kind: "image" as const, role: "reference" as const })),
                          });
                    sessionStorage.setItem(receiptKey, task.id);
                    outcomes[index] = { task, receiptKey };
                } catch (error) {
                    outcomes[index] = { failed: true, receiptKey, error };
                }
            }
        }),
    );

    const completed = outcomes.flatMap((outcome, index) => (outcome && "task" in outcome ? [{ index, task: outcome.task, receiptKey: outcome.receiptKey }] : []));
    const failure = outcomes.find((outcome): outcome is { failed: true; receiptKey: string; error: unknown } => Boolean(outcome && "failed" in outcome));
    if (completed.length) {
        const taskByIndex = new Map(completed.map(({ index, task }) => [index, task]));
        nextPlan = {
            ...nextPlan,
            images: nextPlan.images.map((image, index) => {
                const task = taskByIndex.get(index);
                return task ? { ...image, taskId: task.id } : image;
            }),
        };
        current = await saveEcommerceProject(current, draft, nextPlan);
        onSaved(current, nextPlan);
        for (const item of completed) sessionStorage.removeItem(item.receiptKey);
    }
    if (failure) throw failure.error;
    return { project: current, plan: nextPlan };
}
