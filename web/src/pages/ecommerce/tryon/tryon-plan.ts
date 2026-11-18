import { commerceHumanPhotographyInstruction } from "../human-photography";
import {
    AGES,
    BODIES,
    FACE_VARIANTS,
    GARMENT_TYPES,
    MARKETS,
    SCENES,
    SHOT_ROTATION,
    garmentTypeById,
    marketById,
    sceneById,
    tryOnFunction,
    type TryOnAge,
    type TryOnBody,
    type TryOnFunction,
    type TryOnGender,
    type TryOnModelSource,
    type TryOnPrintMode,
    type TryOnSceneMode,
    type TryOnSlotKey,
} from "./tryon-kinds";

/** 一张已上传（或正在上传）的素材。 */
export type TryOnImage = {
    id: string;
    slot: TryOnSlotKey;
    resourceId: string;
    name: string;
    previewUrl: string;
    width?: number;
    height?: number;
    /** 来自内置模特库的角色卡（多视角拼版）。 */
    catalogId?: string;
    referenceInfo?: { id: string; title: string; category: string; angle?: string; instruction: string };
    progress?: number;
    error?: string;
};

export type TryOnCasting = "smart" | "unified";

export type TryOnDraft = {
    fn: TryOnFunction;
    /** 每个功能各自的素材；切换功能时空位会沿用上一个功能的同类素材。 */
    images: Partial<Record<TryOnFunction, TryOnImage[]>>;
    notes: string;
    modelSource: TryOnModelSource;
    markets: string[];
    gender: TryOnGender;
    age: TryOnAge;
    body: TryOnBody;
    sceneMode: TryOnSceneMode;
    scenes: string[];
    garmentType: string;
    agent: boolean;
    outfitMode: "each" | "set";
    poses: string[];
    faceStyles: string[];
    hairstyle: string;
    hairColor: string;
    keepGender: boolean;
    keepHair: boolean;
    printMode: TryOnPrintMode;
    flatten: boolean;
    consent: boolean;
    imageModel: string;
    ratio: string;
    resolution: string;
    casting: TryOnCasting;
    count: number;
};

export const defaultTryOnDraft = (): TryOnDraft => ({
    fn: "outfit",
    images: {},
    notes: "",
    modelSource: "upload",
    markets: ["cn"],
    gender: "female",
    age: "young",
    body: "standard",
    sceneMode: "keep",
    scenes: [],
    garmentType: "auto",
    agent: true,
    outfitMode: "each",
    poses: [],
    faceStyles: [],
    hairstyle: "随机",
    hairColor: "随机",
    keepGender: true,
    keepHair: true,
    printMode: "motif",
    flatten: true,
    consent: false,
    imageModel: "",
    ratio: "",
    resolution: "",
    casting: "smart",
    count: 1,
});

export const slotImages = (draft: TryOnDraft, slot: TryOnSlotKey, fn = draft.fn) => (draft.images[fn] || []).filter((image) => image.slot === slot);
export const readyImages = (draft: TryOnDraft, slot: TryOnSlotKey, fn = draft.fn) => slotImages(draft, slot, fn).filter((image) => image.resourceId && !image.error);

/** 只换五官的两个换脸功能（智能换头不在内）。 */
export const isFaceSwapFunction = (fn: TryOnFunction) => fn === "face-swap" || fn === "smart-face";

/** 需要 AI 真人模特（没有上传模特图）的情况。 */
export function usesAiModel(draft: TryOnDraft) {
    return (draft.fn === "multi-model" || draft.fn === "multi-outfit") && draft.modelSource === "ai";
}

/** 本功能里「模特：智能匹配 / 统一模特」是否可选。 */
export function castingSelectable(draft: TryOnDraft) {
    // 一模多衣的 AI 模特固定为同一人（首张定人，后续沿用），不提供「智能匹配」。
    return (draft.fn === "multi-model" && draft.modelSource === "ai") || draft.fn === "smart-face" || draft.fn === "smart-head";
}

/** 场景是否由画面重新拍摄（保持原图时不需要场景规划）。 */
export function sceneOptionsVisible(draft: TryOnDraft) {
    return tryOnFunction(draft.fn).scenes;
}

export function effectiveSceneMode(draft: TryOnDraft): TryOnSceneMode {
    if (!sceneOptionsVisible(draft)) return "keep";
    // AI 真人模特没有原图可以保持。
    if (usesAiModel(draft) && draft.sceneMode === "keep") return "smart";
    return draft.sceneMode;
}

/** 本批次需要 Agent 先读图规划（多场景 + 开启 Agent）。 */
export function needsAgentPlan(draft: TryOnDraft) {
    // 换脸先读图：把原图发型写成文字锁定、框出脸部参考的五官区域（裁掉头发头顶），否则图片模型会把参考人的头型一起换过来。
    if (isFaceSwapFunction(draft.fn)) return readyImages(draft, "model").length > 0;
    // 素材库已提供动作与机位，文本姿势也可直接交给图片模型，避免重复读图。
    if (draft.fn === "pose") return readyImages(draft, "pose").some((image) => !image.referenceInfo?.instruction?.trim());
    return effectiveSceneMode(draft) === "smart" && draft.agent;
}

/**
 * 一批图片按「单元」轮流分配：多模特同款按模特、一模多衣（逐件）按衣服、换脸换头按模特图、印花按服装、姿势按姿势。
 * 张数不少于单元数，多出来的张数在单元间轮流分配为不同版本。
 */
export function tryOnUnits(draft: TryOnDraft): number {
    switch (draft.fn) {
        case "fine-outfit":
            return 1;
        case "multi-model":
            return draft.modelSource === "ai" ? 1 : Math.max(1, readyImages(draft, "model").length);
        case "multi-outfit":
            return draft.outfitMode === "set" ? 1 : Math.max(1, readyImages(draft, "garment").length);
        case "pose":
            return Math.max(1, readyImages(draft, "pose").length + draft.poses.length);
        case "face-swap":
        case "smart-face":
        case "smart-head":
            return Math.max(1, readyImages(draft, "model").length);
        case "background":
        case "scene":
        case "enhance":
            return 1;
        case "print":
            return Math.max(1, readyImages(draft, "garment").length);
        default:
            return 1;
    }
}

export function unitName(fn: TryOnFunction) {
    switch (fn) {
        case "multi-model":
            return "位模特";
        case "multi-outfit":
            return "件衣服";
        case "pose":
            return "个姿势";
        case "print":
            return "件服装";
        default:
            return "张模特图";
    }
}

/** 张数说明，例如「3 位模特 × 每位 2 张」。 */
export function distributionNote(draft: TryOnDraft) {
    const units = tryOnUnits(draft);
    if (units <= 1) return draft.count > 1 ? `同一组素材出 ${draft.count} 个不同版本` : "";
    const per = Math.floor(draft.count / units);
    const extra = draft.count % units;
    if (!extra) return `${units} ${unitName(draft.fn)} × 每个 ${per} 张`;
    return `${units} ${unitName(draft.fn)}轮流分配，前 ${extra} 个各多 1 张`;
}

/** 缺少的必填素材；返回空串表示可以生成。 */
export function missingInput(draft: TryOnDraft): string {
    const config = tryOnFunction(draft.fn);
    for (const slot of config.slots) {
        if (slot.key === "model" && usesAiModel(draft)) continue;
        const items = slotImages(draft, slot.key);
        if (items.some((image) => image.error)) return `${slot.label}有上传失败的图片，请重传或移除后再生成`;
        if (items.some((image) => !image.resourceId && !image.error)) return `${slot.label}还在上传`;
        if (items.length > slot.max) return `${slot.label}最多 ${slot.max} 张，请移除多余图片`;
        const ready = items.filter((image) => image.resourceId && !image.error).length;
        if (ready < slot.min) return `请上传${slot.label}`;
    }
    if (draft.fn === "pose" && !readyImages(draft, "pose").length && !draft.poses.length) return "请上传姿势参考图，或选择一个文本姿势";
    if (draft.fn === "multi-outfit" && draft.outfitMode === "set" && readyImages(draft, "garment").length < 2) return "整套搭配至少需要 2 件单品";
    if (draft.fn === "face-swap" && !draft.consent) return "请确认已取得人物肖像授权";
    if (usesAiModel(draft) && !draft.markets.length) return "请至少选择一个国家或地区";
    if (draft.notes.length > 500) return "补充要求最多 500 字";
    return "";
}

// ---------- 提示词 ----------

const GARMENT_FIDELITY =
    "【服装保真·最高优先级】服装只以服装参考图为依据：款式与版型、衣长裙长、领型、袖型与袖长、门襟和开合方式、口袋、褶裥与开衩、腰头、颜色（色相、明度与饱和度）、面料质感与光泽、印花 / 图案 / 刺绣 / Logo 的内容、位置、比例与方向、纽扣拉链与五金的数量和位置都必须一致；不简化、不新增设计、不改颜色、不镜像印花。服装按真实人体合身穿着，有真实的褶皱、垂坠与受光，与身体贴合自然，不像贴图、不穿模。服装参考图如果是平铺图、挂拍、假人或他人上身图，只提取服装本身，不带入其中的人物、衣架、背景或文字。";

const IDENTITY = "【人物身份】成片人物与模特参考图是同一个人：脸型五官、肤色、发型发色、身高体型和年龄感保持一致；不美颜换脸、不改变身材比例。";

const CATALOG_SHEET = "模特参考图如果是同一个人的多视角角色卡（正面、侧面、斜侧与特写拼在一张图里），它只用来识别这位模特；成片只出现这一位模特、一个完整画面，不拼接多个视角。";

const OUTPUT = "【成片要求】只输出一张真实拍摄的商业摄影照片：单一画面，不拼图、不分屏、不加边框、文字、水印或尺寸标注；人物结构正确，手指、手臂和脚部自然。";

const AVOID = "【避免】AI 生成感、3D 渲染感、CG 人偶与游戏角色感；塑料皮肤、过度磨皮、发光美白皮肤、完美对称的网红脸；多余或缺失的肢体、畸形手指、服装融化或与身体粘连、印花扭曲、乱码文字、廉价滤镜感。";

/** 换脸只换五官：明确排除换头，模型不得顺带改发型、头型。 */
const FACE_ONLY = "【只换脸不换头】这是换脸，不是换头：只改面部五官区域，头发（发型、发色、长度、刘海、发际线、发丝走向）、头型轮廓、头部大小与位置、耳朵和颈部都与第 1 张原图一致，不重画整个头部。";

/** 读图得到的原图发型写成文字锁定：图片模型整张重画时，文字描述比「保持不变」更能留住原头发。 */
function hairLock(hair?: string) {
    return hair ? `【原图头部·必须原样保留】第 1 张原图人物：${hair}。成片人物的头发与头型必须与这段描述及第 1 张原图完全一致：原图有头发就不能变成光头或寸头，不剪短、不加长、不改发色和发际线。` : "";
}

const CHILD_SAFETY = "儿童模特：造型、表情与姿势自然、安全、符合年龄，不做成人化姿态，不出现危险动作。";

export type TryOnShot = { scene: string; pose: string; camera: string; lighting: string; styling?: string; persona?: string };

export type TryOnAnalysis = {
    garment?: { category?: string; style?: string; season?: string; fit?: string; colors?: string; material?: string; details?: string; audience?: string };
    shots: TryOnShot[];
    /** Agent 实际参考的后台知识条目数量（为 0 表示用了内置知识）。 */
    knowledgeEntries?: number;
    /** 换脸读图：每张模特原图的头发与头部描述、每张脸部参考的头发描述与五官框，以及裁好的五官图。 */
    faceRead?: TryOnFaceRead;
};

/** box 为相对整张图的千分比 [x0, y0, x1, y1]；crops 与脸部参考一一对应，裁失败的位置为空串。 */
export type TryOnFaceRead = { modelHair: string[]; faceHair: string[]; boxes: Array<[number, number, number, number] | null>; crops?: string[] };

export type TryOnReference = { resourceId: string; role: TryOnSlotKey | "anchor" };

export type TryOnJobSpec = {
    key: string;
    index: number;
    title: string;
    /** 作品卡片上的一句话：本张的场景 / 姿势 / 新面孔方向。 */
    caption?: string;
    prompt: string;
    references: TryOnReference[];
    /** 统一模特：lead 先生成，follow 等 lead 成片后把它作为身份参考再提交。 */
    anchor?: "lead" | "follow";
    /** follow 的首张成片放在参考图的最前（新模特）还是最后（新面孔 / 新头型）。 */
    anchorAt?: "first" | "last";
    /** 跟随原图比例时这张图的目标比例来源。 */
    sizeSource?: { width?: number; height?: number };
};

function genderText(gender: TryOnGender, index: number) {
    if (gender === "female") return "女性";
    if (gender === "male") return "男性";
    return index % 2 ? "男性" : "女性";
}

function agesText(age: TryOnAge) {
    return AGES.find((item) => item.value === age)?.text || "20–28 岁青年";
}

function bodyText(body: TryOnBody) {
    return BODIES.find((item) => item.value === body)?.text || "匀称标准身材";
}

/** AI 选角：按所选国家轮流，第 index 位人物。 */
export function castingFor(draft: TryOnDraft, index: number) {
    const markets = draft.markets.map(marketById).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const market = markets.length ? markets[index % markets.length] : MARKETS[0];
    const face = FACE_VARIANTS[(index * 3 + draft.markets.length) % FACE_VARIANTS.length];
    const age = draft.age;
    const lines = [`${market.casting}`, `${genderText(draft.gender, index)}，${agesText(age)}，${bodyText(draft.body)}`, `面貌识别点：${face}`];
    if (age === "child" || age === "teen") lines.push(CHILD_SAFETY);
    return { market, text: `${lines.join("；")}。这是原创的虚构人物，长相像真实生活中的普通人、带有个人特征，不是完美的网红脸；不模仿任何真实名人或公众人物。` };
}

function sceneText(draft: TryOnDraft, index: number): TryOnShot {
    const rotation = SHOT_ROTATION[index % SHOT_ROTATION.length];
    const mode = effectiveSceneMode(draft);
    const pool = mode === "custom" && draft.scenes.length ? draft.scenes : garmentTypeById(draft.garmentType).scenes;
    const scene = sceneById(pool[index % pool.length]) || SCENES[0];
    return { scene: scene.text, pose: rotation.pose, camera: rotation.camera, lighting: "按场景的真实光源布光，人物与环境光向、色温一致，有自然的接触阴影" };
}

/** 第 index 张的拍摄方案：优先用 Agent 规划，缺失时按内置场景库轮换。 */
export function shotFor(draft: TryOnDraft, index: number, analysis?: TryOnAnalysis | null): TryOnShot {
    const planned = analysis?.shots?.length ? analysis.shots[index % analysis.shots.length] : null;
    const fallback = sceneText(draft, index);
    if (!planned) return fallback;
    return {
        scene: planned.scene || fallback.scene,
        pose: planned.pose || fallback.pose,
        camera: planned.camera || fallback.camera,
        lighting: planned.lighting || fallback.lighting,
        styling: planned.styling,
        persona: planned.persona,
    };
}

function shotBlock(shot: TryOnShot) {
    return `【本张拍摄】场景：${shot.scene}。姿势：${shot.pose}。机位：${shot.camera}。光线：${shot.lighting}。${shot.styling ? `造型：${shot.styling}。` : ""}同一批次每张的场景、姿势与机位都不同，本张不是只换背景的重复画面。`;
}

function garmentSummary(analysis?: TryOnAnalysis | null) {
    const garment = analysis?.garment;
    if (!garment) return "";
    const parts = [
        garment.category && `品类：${garment.category}`,
        garment.style && `风格：${garment.style}`,
        garment.fit && `版型：${garment.fit}`,
        garment.colors && `颜色：${garment.colors}`,
        garment.material && `面料：${garment.material}`,
        garment.details && `关键细节：${garment.details}`,
    ].filter(Boolean);
    return parts.length ? `【服装识别（Agent 观察，仅用于保真，不是新增要求）】${parts.join("；")}。` : "";
}

function notesBlock(draft: TryOnDraft) {
    const notes = draft.notes.trim();
    return notes ? `【用户补充要求（在不违反服装保真与人物身份的前提下执行）】${notes}` : "";
}

function wearRule(draft: TryOnDraft) {
    return garmentTypeById(draft.garmentType).wear;
}

const refsText = (from: number, to: number) => (from === to ? `第 ${from} 张参考图` : `第 ${from}–${to} 张参考图`);

const join = (...blocks: Array<string | false | undefined>) => blocks.filter(Boolean).join("\n\n");

type Ready = Record<TryOnSlotKey, TryOnImage[]>;

function readyAll(draft: TryOnDraft): Ready {
    return {
        model: readyImages(draft, "model"),
        garment: readyImages(draft, "garment"),
        "garment-back": readyImages(draft, "garment-back"),
        background: readyImages(draft, "background"),
        subject: readyImages(draft, "subject"),
        pose: readyImages(draft, "pose"),
        face: readyImages(draft, "face"),
    };
}

const ref = (image: TryOnImage, role: TryOnReference["role"]): TryOnReference => ({ resourceId: image.resourceId, role });

export function configViewReferences(draft: TryOnDraft) {
    return (["model", "garment", "garment-back", "background"] as const).flatMap((slot) => readyImages(draft, slot).slice(0, 1));
}

function modelNote(image?: TryOnImage) {
    return image?.catalogId ? CATALOG_SHEET : "";
}

/** 「自动」比例跟随原图时的尺寸来源；模特库角色卡是四栏拼版，不能当成片比例。 */
const sizeOf = (image?: TryOnImage) => (image && !image.catalogId ? image : undefined);

const KEEP_BLOCK = "【保持原图】人物的姿势、机位、构图、背景与光线全部沿用第 1 张参考图，只替换服装；服装以外的区域尽量保持原样。";
const KEEP_CATALOG_BLOCK = "【保持原图】按角色卡里正面全身图的站姿、机位与纯色影棚背景，拍一张这位模特的单人全身照，只替换服装。";
const keepBlockFor = (model?: TryOnImage) => (model?.catalogId ? KEEP_CATALOG_BLOCK : KEEP_BLOCK);

/**
 * 按当前草稿和（可选的）Agent 规划，生成本批次的每一张：提示词 + 参考图（顺序即提示词里的「第 N 张参考图」）。
 * 统一模特的后续张数标记为 follow，提交时再追加首张成片作为身份参考。
 */
export function buildTryOnJobs(draft: TryOnDraft, analysis?: TryOnAnalysis | null): TryOnJobSpec[] {
    const ready = readyAll(draft);
    const count = Math.max(1, Math.min(20, draft.count));
    const units = tryOnUnits(draft);
    const mode = effectiveSceneMode(draft);
    const summary = garmentSummary(analysis);
    const quality = commerceHumanPhotographyInstruction;
    const jobs: TryOnJobSpec[] = [];
    const short = (value: string, limit = 16) => (Array.from(value).length > limit ? `${Array.from(value).slice(0, limit).join("")}…` : value);
    for (let index = 0; index < count; index++) {
        const unit = index % units;
        const variant = Math.floor(index / units);
        const shot = shotFor(draft, index, analysis);
        const keep = mode === "keep";
        const sceneCaption = keep ? "保持原图场景" : short(shot.scene.split(/[，,。；;]/)[0] || shot.scene);
        switch (draft.fn) {
            case "model-views": {
                const refs = configViewReferences(draft);
                jobs.push({
                    key: `model-views-${index}`,
                    index,
                    title: "模特三视图",
                    caption: "正面 · 45°侧面 · 背面",
                    references: refs.map((image) => ref(image, image.slot)),
                    prompt: join(
                        "【任务】生成一张同一位模特的三视图角色卡，三个等宽画面从左至右依次为正面、45°侧面、背面。三格为同一个人，五官、发型、肤色、身材比例和服装完全一致，全身完整且人物等高，光线和背景连续统一。不是三个不同的人。",
                        refs
                            .map(
                                (image, i) =>
                                    `第 ${i + 1} 张参考图用途：${image.slot === "model" ? "唯一人物身份与体型来源，未提供服装时保留其原服装" : image.slot === "garment" ? "服装正面款式、颜色、印花和细节" : image.slot === "garment-back" ? "同一件服装的背面结构与印花，禁止挪到正面" : "三格统一背景，只参考环境，不引入其中的人物"}`,
                            )
                            .join("\n"),
                        IDENTITY,
                        GARMENT_FIDELITY,
                        notesBlock(draft),
                        quality,
                        "【输出】只输出这一张三视图拼接图，不加文字、视角标签、水印或装饰边框。每格只出现同一位模特一次，衣服保真。",
                        AVOID,
                    ),
                });
                break;
            }
            case "fine-outfit":
            case "outfit": {
                const model = ready.model[0];
                const garments = ready.garment;
                jobs.push({
                    key: `outfit-${index}`,
                    index,
                    title: keep ? (count > 1 ? `版本 ${index + 1}` : "换装") : `场景 ${index + 1}`,
                    caption: sceneCaption,
                    references: [ref(model, "model"), ...garments.map((image) => ref(image, "garment"))],
                    sizeSource: keep ? sizeOf(model) : undefined,
                    prompt: join(
                        `【任务】虚拟试穿：让第 1 张参考图中的模特穿上${refsText(2, garments.length + 1)}中的服装${garments.length > 1 ? "（同一件衣服的不同角度或细节）" : ""}。把模特身上对应部位的原服装完整替换为参考服装：上装换上装，下装换下装，连衣裙或套装换整身；${wearRule(draft)}。`,
                        modelNote(model),
                        keep ? keepBlockFor(model) : shotBlock(shot),
                        draft.fn === "fine-outfit"
                            ? "【精细化换装】只替换图一人物的服装，逐项保留参考服装的衣领、袖口、门襟、口袋、缝线、印花位置与面料纹理；按原人物体型重建自然垂坠、受力褶皱及手臂与服装的遮挡关系。人物脸、发型、手脚、姿势、机位、背景和光线全部沿用图一。"
                            : "",
                        keep && count > 1 && variant > 0 ? `本张是第 ${index + 1} 个版本：服装与人物不变，只在面料褶皱、表情和手部细节上自然变化。` : "",
                        summary,
                        GARMENT_FIDELITY,
                        IDENTITY,
                        notesBlock(draft),
                        quality,
                        OUTPUT,
                        AVOID,
                    ),
                });
                break;
            }
            case "multi-model": {
                const garments = ready.garment;
                if (draft.modelSource === "ai") {
                    const unified = draft.casting === "unified";
                    const persona = castingFor(draft, unified ? 0 : index);
                    const follow = unified && index > 0;
                    const garmentStart = follow ? 2 : 1;
                    jobs.push({
                        key: `ai-model-${index}`,
                        index,
                        title: unified ? `场景 ${index + 1}` : `${persona.market.label}模特 ${index + 1}`,
                        caption: unified ? sceneCaption : `${persona.market.label} · ${sceneCaption}`,
                        anchor: unified && count > 1 ? (index === 0 ? "lead" : "follow") : undefined,
                        anchorAt: "first",
                        references: garments.map((image) => ref(image, "garment")),
                        prompt: join(
                            `【任务】真人模特上身：让一位真人模特穿上${refsText(garmentStart, garmentStart + garments.length - 1)}中的服装${garments.length > 1 ? "（同一件衣服的不同角度或细节）" : ""}；${wearRule(draft)}。`,
                            follow
                                ? "【统一模特】第 1 张参考图是本批次已经确定的模特（首张成片），本张必须是同一个人：脸型五官、肤色、发型、身材完全一致，只换场景、姿势与机位。"
                                : `【本张模特】${shot.persona && !unified ? `${shot.persona}；` : ""}${persona.text}`,
                            shotBlock(shot),
                            summary,
                            GARMENT_FIDELITY,
                            notesBlock(draft),
                            quality,
                            OUTPUT,
                            AVOID,
                        ),
                    });
                    break;
                }
                const model = ready.model[unit];
                jobs.push({
                    key: `model-${unit}-${variant}`,
                    index,
                    title: `模特 ${unit + 1}${variant ? ` · 版本 ${variant + 1}` : ""}`,
                    caption: sceneCaption,
                    references: [ref(model, "model"), ...garments.map((image) => ref(image, "garment"))],
                    sizeSource: keep ? sizeOf(model) : undefined,
                    prompt: join(
                        `【任务】多模特同款：让第 1 张参考图中的这位模特穿上${refsText(2, garments.length + 1)}中的服装${garments.length > 1 ? "（同一件衣服的不同角度或细节）" : ""}；本批次其他模特穿同一件衣服，便于对比上身效果。把模特身上对应部位的原服装完整替换为参考服装；${wearRule(draft)}。`,
                        modelNote(model),
                        keep ? keepBlockFor(model) : shotBlock(shot),
                        summary,
                        GARMENT_FIDELITY,
                        IDENTITY,
                        notesBlock(draft),
                        quality,
                        OUTPUT,
                        AVOID,
                    ),
                });
                break;
            }
            case "multi-outfit": {
                const garments = draft.outfitMode === "set" ? ready.garment : [ready.garment[unit]];
                const ai = draft.modelSource === "ai";
                const model = ai ? undefined : ready.model[0];
                const follow = ai && index > 0;
                const persona = ai ? castingFor(draft, 0) : null;
                const lead = model ? 1 : follow ? 1 : 0;
                const start = lead + 1;
                const garmentRefs = garments.map((image) => ref(image, "garment"));
                const task =
                    draft.outfitMode === "set"
                        ? `【任务】整套搭配：让${model ? "第 1 张参考图中的模特" : "一位真人模特"}同时穿上${refsText(start, start + garments.length - 1)}中的全部单品，组合成一整套穿搭：上装、下装、外套、鞋、包与配饰各就其位，层次和叠穿顺序合理，全身完整入镜。`
                        : `【任务】一模多衣：让${model ? "第 1 张参考图中的模特" : "一位真人模特"}穿上第 ${start} 张参考图中的这件单品；本批次同一位模特依次试穿不同单品。把对应部位的原服装完整替换，其余部位按单品风格自然搭配；${wearRule(draft)}。`;
                jobs.push({
                    key: `outfit-${unit}-${variant}`,
                    index,
                    title: draft.outfitMode === "set" ? `整套 ${index + 1}` : `单品 ${unit + 1}${variant ? ` · 版本 ${variant + 1}` : ""}`,
                    caption: sceneCaption,
                    anchor: ai && count > 1 ? (index === 0 ? "lead" : "follow") : undefined,
                    anchorAt: "first",
                    references: model ? [ref(model, "model"), ...garmentRefs] : garmentRefs,
                    sizeSource: mode === "keep" ? sizeOf(model) : undefined,
                    prompt: join(
                        task,
                        model
                            ? modelNote(model)
                            : follow
                              ? "【统一模特】第 1 张参考图是本批次已经确定的模特（首张成片），只用来锁定人物身份：本张必须是同一个人（脸型五官、肤色、发型、身材一致），但要把图中的衣服完全换成本张的单品，不保留第 1 张参考图里的服装和场景。"
                              : `【本张模特】${persona?.text}`,
                        mode === "keep" && model ? keepBlockFor(model) : shotBlock(shot),
                        summary,
                        GARMENT_FIDELITY,
                        model ? IDENTITY : "",
                        notesBlock(draft),
                        quality,
                        OUTPUT,
                        AVOID,
                    ),
                });
                break;
            }
            case "pose": {
                const subject = ready.subject[0];
                const poseImages = ready.pose;
                const poseImage = unit < poseImages.length ? poseImages[unit] : undefined;
                const textPose = poseImage ? "" : draft.poses[unit - poseImages.length] || draft.poses[0] || "自然正面站立";
                jobs.push({
                    key: `pose-${unit}-${variant}`,
                    index,
                    title: poseImage ? `姿势图 ${unit + 1}` : textPose,
                    caption: poseImage ? "按姿势参考图" : `文本姿势 · ${textPose}`,
                    references: poseImage ? [ref(subject, "subject"), ref(poseImage, "pose")] : [ref(subject, "subject")],
                    sizeSource: sizeOf(subject),
                    prompt: join(
                        poseImage
                            ? "【任务】姿势迁移：让第 1 张参考图中的主体摆出第 2 张参考图中人物的姿势，肢体角度、身体朝向、重心与手部动作和姿势参考一致。姿势参考图只提供动作，不带入其中人物的长相、服装、发型或背景。"
                            : `【任务】姿势调整：让第 1 张参考图中的主体摆出以下姿势：${textPose}。动作自然舒展，符合人体结构与重心。`,
                        modelNote(subject),
                        poseImage?.referenceInfo ? `【姿势与视角】${poseImage.referenceInfo.title}；${poseImage.referenceInfo.angle || "按参考图机位"}。${poseImage.referenceInfo.instruction}。姿势只用于骨架动作和相机角度，不改变主体身份与服装。` : "",
                        analysis?.shots[index] ? `【Agent 读图执行】姿势：${analysis.shots[index].pose}；相机角度：${analysis.shots[index].camera}。以对应姿势图和用户明确要求为准，保持其肢体、重心、朝向和透视，不随机换动作。` : "",
                        "【保持不变】主体的脸、发型、身材、服装（款式、颜色、印花与细节）、配饰与整体画风保持第 1 张参考图不变；背景与光线沿用原图，因姿势变化露出的背景合理补全。",
                        variant > 0 ? `本张是同一姿势的第 ${variant + 1} 个版本：动作要点不变，表情与手部细节自然变化。` : "",
                        notesBlock(draft),
                        quality,
                        OUTPUT,
                        AVOID,
                    ),
                });
                break;
            }
            case "face-swap": {
                const model = ready.model[unit];
                const read = analysis?.faceRead;
                const crops = read?.crops || [];
                const cropped = crops.some(Boolean);
                // 有裁好的五官图就用它替换脸部参考：图片模型看不到参考人的头发和头顶，才不会把头型一起换过来。
                const faces = ready.face.map((image, at) => (crops[at] ? { ...image, resourceId: crops[at] } : image));
                const refHair = (read?.faceHair || []).filter(Boolean).join("；");
                jobs.push({
                    key: `face-${unit}-${variant}`,
                    index,
                    title: `模特图 ${unit + 1}${variant ? ` · 版本 ${variant + 1}` : ""}`,
                    caption: "换脸 · 只换五官",
                    references: [ref(model, "model"), ...faces.map((image) => ref(image, "face"))],
                    sizeSource: model,
                    prompt: join(
                        `【任务】换脸（不是换头）：只把${refsText(2, faces.length + 1)}中这个人的面部五官换到第 1 张参考图的人物脸上${faces.length > 1 ? "（脸部参考是同一个人的不同角度）" : ""}；脸部参考只提供五官长相，不带入其中的发型、发色、头型、帽饰或背景。`,
                        hairLock(read?.modelHair[unit]),
                        cropped ? "【脸部参考说明】脸部参考是只裁出五官区域的特写，只用来识别这个人的五官长相；画面外的头发、头顶和头型一律以第 1 张原图为准。" : "",
                        refHair ? `【不要带入】脸部参考人物的头部特征（${refHair}）不能出现在成片上，成片头发与头型只按第 1 张原图。` : "",
                        "【换脸要求】替换范围只限面部：眉、眼、鼻、唇、脸颊与下巴轮廓与脸部参考一致；肤色与脖子、手臂自然统一，面部角度、光影、表情和妆容风格跟随第 1 张原图。",
                        FACE_ONLY,
                        "【保持不变】第 1 张原图的发型、发色、发际线、刘海、头型与头部大小、耳朵、颈部、身体、姿势、服装、配饰、背景、光线与构图全部不变，只替换面部五官。",
                        notesBlock(draft),
                        quality,
                        OUTPUT,
                        AVOID,
                    ),
                });
                break;
            }
            case "smart-face":
            case "smart-head": {
                const model = ready.model[unit];
                const unified = draft.casting === "unified";
                const follow = unified && index > 0;
                const persona = castingFor(draft, unified ? 0 : index);
                const face = FACE_VARIANTS[(unified ? 0 : index * 3 + 1) % FACE_VARIANTS.length];
                const marketLine = draft.markets.length ? persona.market.casting : "与原图人物同一族裔与肤色基调";
                const styles = draft.faceStyles.length ? draft.faceStyles[(unified ? 0 : index) % draft.faceStyles.length] : "";
                const age = draft.keepGender ? "年龄感与原图人物相近" : agesText(draft.age);
                const gender = draft.keepGender ? "与原图人物性别相同" : genderText(draft.gender, index);
                const head = draft.fn === "smart-head";
                const hairstyle = draft.hairstyle && draft.hairstyle !== "随机" ? draft.hairstyle : "";
                const hairColor = draft.hairColor && draft.hairColor !== "随机" ? draft.hairColor : "";
                jobs.push({
                    key: `${draft.fn}-${unit}-${variant}`,
                    index,
                    title: `模特图 ${unit + 1}${variant ? ` · 版本 ${variant + 1}` : ""}`,
                    caption: [follow ? "统一新面孔" : draft.markets.length ? persona.market.label : "跟随原图族裔", head ? hairstyle || "新发型" : styles].filter(Boolean).join(" · "),
                    anchor: unified && count > 1 ? (index === 0 ? "lead" : "follow") : undefined,
                    anchorAt: "last",
                    references: [ref(model, "model")],
                    sizeSource: model,
                    prompt: join(
                        head ? "【任务】智能换头：给第 1 张参考图中的模特换一个新头型——新的脸和新的发型一起替换。" : "【任务】智能换脸（不是换头）：只把第 1 张参考图中模特的面部五官换成一张原创的新面孔，头发和头部其余部分原样保留。",
                        head ? "" : hairLock(analysis?.faceRead?.modelHair[unit]),
                        follow
                            ? `【统一新${head ? "头型" : "面孔"}】第 2 张参考图是本批次已经确定的新${head ? "头型" : "面孔"}（首张成片），本张换上完全相同的${head ? "脸和发型" : "脸"}，五官与${head ? "发型发色" : "脸型"}一致。`
                            : `【新${head ? "头型" : "面孔"}】${marketLine}；${gender}；${age}；面貌识别点：${face}${styles ? `；气质：${styles}` : ""}${head ? `；发型：${hairstyle || "按服装风格挑选一款与原图明显不同、适合商业拍摄的发型"}；发色：${hairColor || "自然、与新面孔协调"}` : ""}。与原图人物明显是不同的人，是原创的真实感面孔（像生活中的普通人，有个人特征），不模仿任何真实名人或公众人物。`,
                        head
                            ? "【保持不变】颈部以下的身体、肤色、姿势、服装、配饰、背景、光线与构图保持第 1 张原图不变；新头部的大小比例、朝向与原图身体匹配，颈部衔接自然，光影一致。"
                            : `【保持不变】发型、发色、发际线、刘海、头型与头部大小、耳朵、颈部、身体、姿势、服装、配饰、背景、光线与构图保持第 1 张原图不变；新面孔的角度、表情与光影贴合原图，脸部与颈部肤色统一。${FACE_ONLY}`,
                        notesBlock(draft),
                        quality,
                        OUTPUT,
                        AVOID,
                    ),
                });
                break;
            }
            case "background":
            case "scene": {
                const subject = ready.subject[0];
                const background = ready.background[0];
                jobs.push({
                    key: `${draft.fn}-${index}`,
                    index,
                    title: tryOnFunction(draft.fn).title,
                    caption: draft.fn === "background" ? "保留主体 · 替换背景" : "提取场景 · 融合主体",
                    references: [ref(subject, "subject"), ref(background, "background")],
                    sizeSource: sizeOf(subject),
                    prompt: join(
                        draft.fn === "background"
                            ? "【任务】换背景：保留第 1 张参考图中的主体，只把环境背景替换为第 2 张参考图的背景。主体大小、姿势和构图不变，匹配新环境的透视、光向、色温、接触阴影与反射，发丝、透明材质和细小配件边缘自然，没有光晕或残留背景。"
                            : "【任务】场景提取：提取第 2 张参考图的空间布局、材质、色调、光线方向和景深，为第 1 张参考图的主体重建拍摄场景。保留图一主体比例、姿势与机位，以真实遮挡、接触阴影和反射融入环境，像同一台相机现场拍摄。",
                        "【参考图职责】第 1 张是唯一主体来源，人物身份、脸、发型、服装、商品外观、颜色、标签与文字全部保留；第 2 张只提供环境，不复制其中的人物或商品，不替换图一主体。",
                        notesBlock(draft),
                        "【输出】只输出一张完整照片，不拼图、不加边框或额外文字、水印。",
                    ),
                });
                break;
            }
            case "enhance": {
                const subject = ready.subject[0];
                jobs.push({
                    key: `enhance-${index}`,
                    index,
                    title: "脸部增强",
                    caption: "保留身份 · 增强自然细节",
                    references: [ref(subject, "subject")],
                    sizeSource: sizeOf(subject),
                    prompt: join(
                        "【任务】脸部增强：仅增强第 1 张参考图中人物脸部的清晰度、眼神、自然皮肤纹理与细小发丝，修复轻微模糊、噪点和压缩痕迹。",
                        "【保持不变】本人身份、五官比例、年龄感、表情、妆容、肤色、发型及原图身体、服装、姿势、背景、机位、光线和色温全部保持一致；不换脸、不瘦脸、不磨皮、不美白、不凭空添加面部特征。",
                        notesBlock(draft),
                        "【输出】保持原图完整构图，不裁成脸部特写，不拼图、不加文字、水印或边框。",
                    ),
                });
                break;
            }
            case "print": {
                const garment = ready.garment[unit];
                const modeText =
                    draft.printMode === "motif"
                        ? "只输出印花图案本身：图案居中完整，放在纯白色（#FFFFFF）背景上，四周留出约 8% 的白边；去掉衣服本身、褶皱、阴影与布纹。"
                        : draft.printMode === "flat"
                          ? "把服装上的整片印花摊平成正面矩形图案并铺满画面，去掉褶皱、透视变形、阴影与高光，颜色均匀准确。"
                          : "根据服装上的印花重绘为四方连续图案：画面上下边缘、左右边缘可以无缝拼接，元素密度均匀，铺满画面，没有边框。";
                jobs.push({
                    key: `print-${unit}-${variant}`,
                    index,
                    title: `服装 ${unit + 1}${variant ? ` · 版本 ${variant + 1}` : ""}`,
                    caption: PRINT_LABEL[draft.printMode],
                    references: [ref(garment, "garment")],
                    prompt: join(
                        "【任务】印花提取：从第 1 张参考图的服装上提取印花图案，输出可直接用于设计和生产的平面图案稿。",
                        `【输出形式】${modeText}`,
                        `【图案要求】${draft.flatten ? "去除所有褶皱、透视、阴影和面料光泽，" : ""}${"颜色还原为原印花的真实颜色，"}线条与边缘清晰锐利；不出现人物、衣服轮廓、衣架、吊牌、文字或水印；不新增原印花没有的元素。平面设计稿质感（类似矢量或印刷分色稿），不是照片。`,
                        variant > 0 ? `本张是第 ${variant + 1} 个版本：图案内容一致，可在线条细节和排布上做细微变化。` : "",
                        notesBlock(draft),
                    ),
                });
                break;
            }
        }
    }
    const promptReferences = tryOnPromptReferences(draft);
    return jobs.map((job) => ({
        ...job,
        prompt: hoistBlock(
            resolveTryOnPromptReferences(
                job.prompt,
                promptReferences,
                job.references.map((item) => item.resourceId),
            ),
            quality,
        ),
    }));
}

/** 真人质感段落紧跟在【任务】之后：图片模型更重视靠前的要求，放在末尾时容易被忽略。 */
function hoistBlock(prompt: string, block: string) {
    const blocks = prompt.split("\n\n");
    const at = blocks.indexOf(block);
    if (at <= 1) return prompt;
    blocks.splice(at, 1);
    blocks.splice(1, 0, block);
    return blocks.join("\n\n");
}

// ---------- Agent 规划 ----------

/** 后台知识库不可用时的内置知识：服饰上身拍摄的场景、选角与平台方法。 */
export const BUILTIN_TRYON_KNOWLEDGE = [
    "【内置服饰上身知识】",
    "场景匹配：通勤衬衫与西装配写字楼、城市街道、咖啡店；卫衣、牛仔与休闲装配街头、校园、公园；连衣裙与半身裙配花园、海边、旅行与咖啡店；外套与大衣配秋冬街头、夜景与商场；运动服配跑道、球场、健身房；泳装只配海边或泳池；家居服配卧室与客厅；礼服婚纱配晚宴、影棚与教堂；童装配公园、家里、校园，场景必须符合服装季节与正式程度。",
    "主图与种草：白底或浅色影棚全身照用于主图和详情首屏，平视机位、站姿端正、服装完整；生活场景图用于种草和信息流，抓拍感、自然表情、真实光线；同一批次覆盖全身、七分身、半身细节，至少一张能看清版型、一张能看清面料或细节。",
    "选角：按目标市场选当地真实人物，国内平台默认中国本土人物；跨境市场匹配当地肤色、五官、发型与穿着习惯，同一市场内人物也要多元，国籍不能只用肤色判断；按服装定位选年龄与身材，包容大码和不同身形；用户上传模特时只保留其身份，不随机改脸。",
    "姿势与机位：站姿重心在一条腿、身体略侧更显版型；行走抓拍展示面料垂坠；回头与背影展示背部设计；坐姿展示裤装与裙摆；35mm 环境全身、50mm 七分身、85mm 半身人像，略低机位拉长比例。",
    "平台：淘宝 / 天猫 / 京东主图 1:1 或 3:4，白底或简洁背景；小红书、抖音 3:4 竖图，生活方式与氛围感优先；亚马逊主图纯白背景、服装占画面主体；SHEIN 与独立站偏 3:4 棚拍与街拍组合。",
].join("\n");

export type TryOnKnowledge = { knowledge: string; entries: Array<{ id: string; title: string; domain?: string }>; source: "backend" | "builtin" };

function referenceList(draft: TryOnDraft) {
    const ready = readyAll(draft);
    const lines: string[] = [];
    let order = 1;
    const push = (images: TryOnImage[], label: string) => {
        for (const image of images) lines.push(`第 ${order++} 张：${label}${image.catalogId ? "（多视角角色卡）" : ""}${image.referenceInfo ? `；${image.referenceInfo.title}；${image.referenceInfo.angle || ""}；${image.referenceInfo.instruction}` : ""}`);
    };
    if (draft.fn === "pose") {
        push(ready.subject.slice(0, 1), "唯一主体，保留身份、服装与画风");
        push(ready.pose, "姿势与机位参考，不带入人物身份和服装");
        return lines;
    }
    if (draft.fn === "outfit" || (draft.fn === "multi-model" && draft.modelSource === "upload") || (draft.fn === "multi-outfit" && draft.modelSource === "upload")) push(ready.model.slice(0, draft.fn === "multi-model" ? 4 : 1), "模特");
    push(ready.garment.slice(0, draft.fn === "multi-outfit" ? 6 : 3), draft.fn === "multi-outfit" ? "单品" : "服装");
    return lines;
}

/** 参与 Agent 读图的素材（与 referenceList 的顺序一致）。 */
export function agentReferenceIds(draft: TryOnDraft) {
    const ready = readyAll(draft);
    if (isFaceSwapFunction(draft.fn)) return [...ready.model, ...(draft.fn === "face-swap" ? ready.face : [])].map((image) => image.resourceId);
    if (draft.fn === "pose") return [...ready.subject.slice(0, 1), ...ready.pose].map((image) => image.resourceId);
    const models = draft.fn === "outfit" || (draft.fn === "multi-outfit" && draft.modelSource === "upload") ? ready.model.slice(0, 1) : draft.fn === "multi-model" && draft.modelSource === "upload" ? ready.model.slice(0, 4) : [];
    const garments = ready.garment.slice(0, draft.fn === "multi-outfit" ? 6 : 3);
    return [...models, ...garments].map((image) => image.resourceId);
}

export function tryOnPromptReferences(draft: TryOnDraft) {
    return tryOnFunction(draft.fn)
        .slots.filter((slot) => slot.key !== "model" || !usesAiModel(draft))
        .flatMap((slot) => readyImages(draft, slot.key).map((image, index) => ({ resourceId: image.resourceId, name: image.name, label: `${slot.label}${index + 1}` })));
}

function resolveTryOnPromptReferences(prompt: string, references: ReturnType<typeof tryOnPromptReferences>, resourceIds: string[]) {
    return prompt.replace(/@([^@\s]+?\d+)(?!\d)/g, (token, label: string) => {
        const ref = references.find((item) => item.label === label);
        if (!ref) return token;
        const index = resourceIds.indexOf(ref.resourceId);
        return index < 0 ? `（${label}未用于本张）` : `第 ${index + 1} 张参考图`;
    });
}

export function tryOnAgentPrompt(draft: TryOnDraft, knowledge: TryOnKnowledge, market: { platform: string; platformLabel: string; language: string; languageLabel: string }) {
    const config = tryOnFunction(draft.fn);
    const count = Math.max(1, Math.min(20, draft.count));
    const ai = usesAiModel(draft);
    const notes = resolveTryOnPromptReferences(draft.notes.trim(), tryOnPromptReferences(draft), agentReferenceIds(draft));
    if (isFaceSwapFunction(draft.fn)) return tryOnFaceReadPrompt(draft);
    if (draft.fn === "pose")
        return [
            "你是人物姿势与相机视角分析 Agent。必须实际观察主体图与每张姿势图，结合用户中文要求，写出可执行的逐张动作指令；禁止只按文件名猜测姿势。",
            `【参考图及用途】\n${referenceList(draft).join("\n")}`,
            `【文本姿势】${draft.poses.join("；") || "无"}\n【用户要求】${notes || "忠实复刻参考姿势及机位"}`,
            `【输出对应规则】共 ${count} 张，先按姿势参考图上传顺序，然后按文本姿势顺序循环分配；每张只对应一个姿势。每条 pose 要写清头部、肩胯朝向、左右手臂与手势、膝盖、双脚、重心及遮挡；camera 要区分正面、俯视、仰视、侧面、斜侧视角和透视缩短，不可把不同视角当作不同动作。`,
            "主体图只锁定身份与服装，姿势图只指导骨架与镜头；不复制人偶线稿的材质、脸、服装或背景。保留主体原场景与光线，随新机位合理重建透视。用户明确要求优先，未要求的细节忠实参考，无法看清的不编造。",
            knowledge.knowledge,
            `只输出 JSON：{"shots":[{"scene":"沿用主体场景","pose":"可执行的肢体细节","camera":"机位与透视","lighting":"沿用主体光线"}]}，shots 恰好 ${count} 条。`,
        ].join("\n\n");
    const unified = draft.casting === "unified";
    const markets = draft.markets
        .map((id) => marketById(id)?.label)
        .filter(Boolean)
        .join("、");
    const settings = [
        `功能：${config.label}`,
        `服装品类：${garmentTypeById(draft.garmentType).label}`,
        `场景：${
            effectiveSceneMode(draft) === "custom" && draft.scenes.length
                ? draft.scenes
                      .map((id) => sceneById(id)?.label)
                      .filter(Boolean)
                      .join("、")
                : "由你按服装规划多个不同场景"
        }`,
        draft.fn === "multi-outfit" ? `出图方式：${draft.outfitMode === "set" ? "所有单品组合成一整套" : "一件单品一套图"}` : "",
        ai
            ? `模特：AI 真人选角（国家 / 地区：${markets || "中国"}；${genderText(draft.gender, 0)}${draft.gender === "any" ? "与男性混合" : ""}；${agesText(draft.age)}；${bodyText(draft.body)}；${unified ? "全部使用同一位模特" : "每张一位不同的模特"}）`
            : "模特：使用参考图中的模特，保留其身份",
        `投放平台：${market.platformLabel}；图中不出现文字（目标语言 ${market.languageLabel} 仅供场景本地化参考）`,
        notes ? `用户补充要求：${notes}` : "",
    ].filter(Boolean);
    return [
        `你是电商服装拍摄策划 Agent。先观察参考图识别服装，再结合下方后台电商知识库，为「${config.label}」规划 ${count} 张图的拍摄方案。`,
        `【参考图】\n${referenceList(draft).join("\n")}`,
        `【用户设置】\n${settings.join("\n")}`,
        knowledge.knowledge,
        "【规划要求】",
        "1. 识别服装：品类、风格、季节、版型、颜色、面料、关键设计细节、适合人群与穿着场合；只写看得见的内容，不编造面料成分或功能。",
        `2. 为 ${count} 张图分别规划场景、姿势、机位与光线：覆盖不同的真实使用场景（例如棚拍主图、通勤、街头、居家、度假等按服装取舍），同一批次内场景与姿势不重复；场景必须适合这件服装的季节、正式程度与品类，不能出现不合理的组合（例如羽绒服配海滩、泳装配办公室）。至少一张适合做主图（简洁背景、全身完整、能看清版型）。`,
        ai && !unified
            ? `3. 为每张图设计一位真人模特（persona 字段）：按所选国家轮流，写清肤色、五官、发型发色、年龄与身材，彼此明显不同；像真实生活中的普通人，可写一两个个人特征（雀斑、小痣、略宽的鼻翼等），不用「完美」「精致无瑕」「白皙无瑕」之类美颜词；原创人物，不模仿真实名人。`
            : ai
              ? "3. 全部张数使用同一位模特，persona 字段只在第 1 条写清这位模特的肤色、五官、发型发色、年龄与身材，其余留空。"
              : "3. persona 字段留空（模特来自参考图）。",
        "4. styling 字段写本张的搭配与造型补充（例如内搭、下装、鞋包与发型），不能遮挡或改变服装本身。lighting 写现场真实存在的光源（窗光、阴天日光、街边树荫、影棚柔光箱），画面要像真实拍摄的照片，不写梦幻光晕、完美无影或发光皮肤。",
        `5. 只输出一个 JSON 对象，不要解释、不要 Markdown：{"garment":{"category":"","style":"","season":"","fit":"","colors":"","material":"","details":"","audience":""},"shots":[{"scene":"","pose":"","camera":"","lighting":"","styling":"","persona":""}]}，shots 恰好 ${count} 条，每个字段 10–60 个汉字。`,
    ].join("\n");
}

/** 换脸读图：原图头部写成文字、脸部参考框出五官区域（随后在浏览器里裁掉头发和头顶）。 */
function tryOnFaceReadPrompt(draft: TryOnDraft) {
    const ready = readyAll(draft);
    const models = ready.model.length;
    const faces = draft.fn === "face-swap" ? ready.face.length : 0;
    const lines = [...ready.model.map((_, index) => `第 ${index + 1} 张：模特原图 ${index + 1}（换脸后头发与头部必须原样保留）`), ...Array.from({ length: faces }, (_, index) => `第 ${models + index + 1} 张：脸部参考 ${index + 1}（同一个人，只取五官）`)];
    return [
        "你是人像换脸前的读图 Agent。换脸只换五官、不换头。必须实际观察每张图，只写看得见的内容，看不清就写「看不清」，不编造。",
        `【参考图】\n${lines.join("\n")}`,
        "【任务 1】为每张模特原图写 hair：客观描述头发与头部，供出图时原样保留。必须写清：有没有头发（光头、寸头要明确写出）、发型、长度、颜色、分缝与刘海、发际线位置、头型轮廓，以及帽子、发饰；多视角拼图按画面中的人统一描述。20–60 个汉字。",
        faces
            ? "【任务 2】为每张脸部参考写 hair（同样的写法，用来告诉出图模型不要带入），并给出 box：只框住面部五官区域——左右到两侧脸颊外缘（不含耳朵），上边在眉毛上方约三分之一额头处（不能包含发际线、头发或头顶），下边到下巴底部。box 为相对整张图的千分比坐标 [x0, y0, x1, y1]，0–1000 的整数。一张图里有多张脸时框最大、最清晰的那张。"
            : "",
        `只输出一个 JSON 对象，不要解释、不要 Markdown：{"models":[{"hair":""}],"faces":[${faces ? '{"hair":"","box":[0,0,0,0]}' : ""}]}，models 恰好 ${models} 条，faces 恰好 ${faces} 条，顺序与参考图一致。`,
    ]
        .filter(Boolean)
        .join("\n\n");
}

function faceBox(value: unknown): [number, number, number, number] | null {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const [x0, y0, x1, y1] = value.map((item) => Math.round(Number(item)));
    if (![x0, y0, x1, y1].every((item) => Number.isFinite(item) && item >= 0 && item <= 1000)) return null;
    // 太小或反向的框不可信，宁可用原图。
    if (x1 - x0 < 30 || y1 - y0 < 30) return null;
    return [x0, y0, x1, y1];
}

/** 解析换脸读图结果；模特描述一条都没有时抛错，调用方按纯提示词换脸。 */
export function parseTryOnFaceRead(text: string, draft: TryOnDraft): TryOnFaceRead {
    const raw = firstJsonObject(text);
    if (!raw) throw new Error("Agent 没有返回读图 JSON");
    const value = JSON.parse(raw) as { models?: Array<Record<string, unknown>>; faces?: Array<Record<string, unknown>> };
    const ready = readyAll(draft);
    const usable = (hair: unknown) => {
        const textValue = clip(hair, 80);
        return textValue && !textValue.includes("看不清") ? textValue : "";
    };
    const models = Array.isArray(value.models) ? value.models : [];
    const faces = Array.isArray(value.faces) ? value.faces : [];
    const modelHair = ready.model.map((_, index) => usable(models[index]?.hair));
    if (!modelHair.some(Boolean)) throw new Error("Agent 没有识别出原图发型");
    const faceCount = draft.fn === "face-swap" ? ready.face.length : 0;
    return {
        modelHair,
        faceHair: Array.from({ length: faceCount }, (_, index) => usable(faces[index]?.hair)),
        boxes: Array.from({ length: faceCount }, (_, index) => faceBox(faces[index]?.box)),
    };
}

function firstJsonObject(text: string) {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    if (start < 0) return "";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < cleaned.length; index++) {
        const char = cleaned[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") depth++;
        else if (char === "}") {
            depth--;
            if (!depth) return cleaned.slice(start, index + 1);
        }
    }
    return "";
}

const clip = (value: unknown, limit = 120) => (typeof value === "string" ? Array.from(value.trim()).slice(0, limit).join("") : "");

/** 解析 Agent 的规划结果；格式不对时抛错，由调用方回退到内置场景库。 */
export function parseTryOnAnalysis(text: string): TryOnAnalysis {
    const raw = firstJsonObject(text);
    if (!raw) throw new Error("Agent 没有返回规划 JSON");
    const value = JSON.parse(raw) as { garment?: Record<string, unknown>; shots?: Array<Record<string, unknown>> };
    const shots = (Array.isArray(value.shots) ? value.shots : [])
        .map((shot) => ({ scene: clip(shot?.scene), pose: clip(shot?.pose), camera: clip(shot?.camera), lighting: clip(shot?.lighting), styling: clip(shot?.styling), persona: clip(shot?.persona, 200) }))
        .filter((shot) => shot.scene || shot.pose);
    if (!shots.length) throw new Error("Agent 规划里没有可用的拍摄方案");
    const garment = value.garment && typeof value.garment === "object" ? value.garment : {};
    return {
        garment: {
            category: clip(garment.category, 40),
            style: clip(garment.style, 60),
            season: clip(garment.season, 30),
            fit: clip(garment.fit, 60),
            colors: clip(garment.colors, 60),
            material: clip(garment.material, 60),
            details: clip(garment.details, 160),
            audience: clip(garment.audience, 60),
        },
        shots,
    };
}

/** 结果卡片与批次标题里的一句话摘要。 */
export function tryOnSummary(draft: TryOnDraft) {
    const config = tryOnFunction(draft.fn);
    const parts: string[] = [config.label];
    const ready = readyAll(draft);
    if (draft.fn === "multi-model")
        parts.push(
            draft.modelSource === "ai"
                ? `AI 选角 · ${
                      draft.markets
                          .map((id) => marketById(id)?.label)
                          .filter(Boolean)
                          .join("/") || "中国"
                  }`
                : `${ready.model.length} 位模特`,
        );
    if (draft.fn === "multi-outfit") parts.push(`${ready.garment.length} 件${draft.outfitMode === "set" ? " · 整套搭配" : ""}`);
    if (draft.fn === "pose") parts.push(`${ready.pose.length + draft.poses.length} 个姿势`);
    if (draft.fn === "face-swap" || draft.fn === "smart-face" || draft.fn === "smart-head") parts.push(`${ready.model.length} 张模特图`);
    if (draft.fn === "print") parts.push(PRINT_LABEL[draft.printMode]);
    if (sceneOptionsVisible(draft)) {
        const mode = effectiveSceneMode(draft);
        parts.push(
            mode === "keep"
                ? "保持原图"
                : mode === "custom"
                  ? draft.scenes
                        .map((id) => sceneById(id)?.label)
                        .filter(Boolean)
                        .join("/") || "指定场景"
                  : needsAgentPlan(draft)
                    ? "Agent 多场景"
                    : "多场景",
        );
    }
    return parts.join(" · ");
}

const PRINT_LABEL: Record<TryOnPrintMode, string> = { motif: "单独图案", flat: "平铺展开", seamless: "四方连续" };

export const garmentTypeOptions = GARMENT_TYPES.map((item) => ({ value: item.id, label: item.label }));
