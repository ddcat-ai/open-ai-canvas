import { normalizeEcommerceReferenceGroups, type EcommerceDraft, type EcommerceReference } from "@/services/api/ecommerce";
import { commerceModelById } from "./model-catalog";
import { commerceLayoutReferences, commerceReferenceViewRanges } from "./reference-plan";
import { commerceCastingMarketInstruction, commerceHumanPhotographyInstruction } from "./human-photography";

export function activeCommerceReferences(draft: EcommerceDraft): EcommerceReference[] {
    const product = normalizeEcommerceReferenceGroups(draft).references.filter((ref) => ref.role !== "model" || draft.modelEnabled);
    return [...product, ...commerceLayoutReferences(draft)];
}

export function commercePlanningReferenceCount(draft: EcommerceDraft): number {
    let extra = 0;
    for (const source of commerceLayoutReferences(draft)) {
        if (source.width && source.height) {
            try {
                extra += commerceReferenceViewRanges(source.width, source.height).length;
            } catch {
                /* Planning reports the exact invalid-image error. */
            }
        }
    }
    return activeCommerceReferences(draft).length + extra;
}

export function mainCommerceModel(draft: EcommerceDraft): EcommerceReference | undefined {
    if (!draft.modelEnabled) return undefined;
    const models = draft.references.filter((ref) => ref.role === "model");
    return models.find((ref) => ref.resourceId === draft.primaryModelResourceId) || models[0];
}

/**
 * "智能匹配" (model switch off): the plan decides who appears. The server's per-run
 * persona wins; without one the planner picks a fresh persona each run, and every
 * image of one set keeps that same person.
 */
export const commerceSmartModelInstruction =
    "画面模特为“智能匹配”：使用场景、穿戴/手持演示、情感陪伴和多场景拼图等页面安排具备真人实拍质感的原创人物，并在提示词中写清年龄段、性别、长相气质、发型妆容、服饰、动作与商品的互动方式。人物设定以本轮策划为准：服务端【本轮版式方案】给出人物设定时严格采用；没有给出时，按品类、目标人群、平台与本轮风格自行设定，并且每次重新策划都主动换一种人设（年龄段、性别组合、长相与气质、发型服饰、场景与时段），不要每次都落到同一个默认形象。同一套图内人物始终一致（同一张脸、发型与服饰风格），生图时严格沿用本张提示词与本套策划写明的人物，不在单张里另换人。品类方向只作参考，不是固定人设：母婴→婴幼儿与照护者（父母、祖辈或其他家人，组合与年龄每轮变化）；美妆护肤→不同年龄、肤质与风格的使用者上脸或上手；数码→不同职业与生活方式的用户佩戴或桌面操作；服饰鞋包→与风格匹配的穿搭模特全身或半身；家居家电→不同家庭结构在真实居家场景使用；宠物用品→不同宠物与主人互动；食品→家人、朋友或独处时享用。人物数量服从商品用途、用户要求与本轮分镜，不为凑人数重复摆拍。白底、尺寸、SKU、三视图、纯微距细节和产品信息卡主体不需要人物。没有模特参考图时不要声称有参考人物；不得模仿真人或名人。儿童画面自然、安全、适龄：婴幼儿始终有成人在旁看护，不做危险动作，不独自使用需要看护的商品。";

export function commerceModelInstruction(draft: EcommerceDraft): string {
    const humanPhotography = `${commerceCastingMarketInstruction(draft)}\n${commerceHumanPhotographyInstruction}`;
    if (!draft.modelEnabled) return `${commerceSmartModelInstruction}\n${humanPhotography}`;
    const models = draft.references.filter((ref) => ref.role === "model");
    const main = mainCommerceModel(draft);
    const preferred = main ? commerceModelById(main.catalogId) : undefined;
    const photography = preferred?.kind === "mannequin" ? "用户选择陈列假人：保留其材质与结构，不生成真人皮肤、毛孔或表情。" : humanPhotography;
    const anchor =
        (main
            ? `主模特是模特参考图「${main.name || preferred?.name || main.resourceId}」（资源 ${main.resourceId}）。`
            : "用户未选择模特案例或上传模特图。你必须根据商品品类、目标人群、平台市场和品牌气质，自行在需要人物的每张图提示词中写出一致的合适模特：年龄段、形象气质、妆发服饰、肤色和与商品的互动方式；不要声称有模特参考图。服务端【本轮版式方案】给出人物设定时以其为准，否则每次重新策划都换一种合适的人设，同一套图内保持一致。") +
        `\n${photography}\n`;
    const others = models.filter((ref) => ref.resourceId !== main?.resourceId).map((ref) => ref.name || ref.resourceId);
    return `已启用模特。${anchor}只在人物能帮助解释穿戴、手持、使用情境或目标人群时安排模特；白底、SKU、尺寸、三视图、材质微距与包装图通常不需要人物，不要强行每张都出现。需要人物的图片保持同一角色设定，商品外观仍以商品主图为准。已选模特参考图中的多视角拼版只用于识别角色，最终每张商品图是单一完整场景；服装类产品必须以商品参考图替换示例服装。多人画面主模特必须在场，其他人只从已选辅助模特中使用${others.length ? `（${others.join("、")}）` : "，不要凭空添加第二人"}。真人按专业广告模特的仪态、妆发与镜头表现执行；假人保持陈列假人的材质与结构。根据商品、平台、语言和用户参数决定姿态、场景和镜头，避免掩盖商品关键细节。`;
}
