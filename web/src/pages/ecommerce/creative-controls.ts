import { defaultEcommerceCreativeOptions, type EcommerceCreativeOptions, type EcommerceDraft } from "@/services/api/ecommerce";
import { commercePlatformListingMain } from "./platform-style";
import { commercePlatformNoText } from "./platform-knowledge";

export const defaultCreativeOptions = defaultEcommerceCreativeOptions;
type CreativeField = { [K in keyof EcommerceCreativeOptions]: { key: K; label: string; options: { value: EcommerceCreativeOptions[K]; label: string; instruction: string }[] } }[keyof EcommerceCreativeOptions];

export const creativeControlFields: CreativeField[] = [
    {
        key: "textMode",
        label: "图中文字",
        options: [
            { value: "auto", label: "智能策划", instruction: "按图片用途安排完整文案：信息图包含标题、解释与真实要点，场景图可适当留白，避免每张只有一句口号。" },
            { value: "rich", label: "丰富图文", instruction: "优先采用主标题、解释性副标题、2–4个短信息模块，围绕一个主题展开。内容充分但不堆字；真实事实不足时增加具体使用情境与设计叙事，不虚构参数。" },
            { value: "concise", label: "精炼文案", instruction: "每张以一个有辨识度的标题和一句具体说明为主，最多补充2个短标签；用准确、有信息量的短句表达，避免空泛口号。" },
            { value: "none", label: "纯图无字", instruction: "不添加营销标题、说明、标签、装饰文字或文字图标；仅保留真实商品自身的Logo和包装原文。" },
        ],
    },
    {
        key: "copyTone",
        label: "文案风格",
        options: [
            { value: "professional", label: "专业卖点", instruction: "用明确的使用价值引出有依据的商品特征，再用细节或使用场景解释；语言成熟、具体、自然，不把画面描述当成标题。" },
            { value: "brand", label: "品牌叙事", instruction: "围绕产品设计气质与使用者的生活建立统一主题，克制而有情绪；不虚构品牌历史、工艺故事、获奖和用户口碑。" },
            { value: "lifestyle", label: "生活场景", instruction: "从一段具体日常切入，说明商品在该情境中的使用关系与情绪价值，避免无依据的效果保证。" },
            { value: "technical", label: "技术解说", instruction: "用清晰的原理或功能说明解释已核实规格；每个数值都必须来自用户资料。没有技术依据时讲可见设计与操作位置，不套用品类常见参数。" },
            { value: "editorial", label: "编辑质感", instruction: "用简洁、准确、有节奏的标题配具体说明，像成熟品牌杂志；避免生硬文艺词、语病和空洞形容词。" },
            { value: "campaign", label: "营销转化", instruction: "以明确需求、已确认利益和适度行动引导组织文案；没有活动资料时不写价格、折扣、销量、限时或售后承诺。" },
        ],
    },
    {
        key: "fontStyle",
        label: "字体风格",
        options: [
            { value: "auto", label: "智能匹配", instruction: "按商品气质、目标语言和画幅确定标题/说明字体家族，说明具体字形与字重，不只写高级。" },
            { value: "modern-sans", label: "现代黑体", instruction: "使用干净现代的无衬线/黑体字形；标题中粗或粗体、正文常规字重，笔画清晰，适合移动端。" },
            { value: "geometric", label: "几何科技", instruction: "使用结构规整的几何无衬线字形，统一数字与文字比例；保持字形完整，不做难辨的断笔、镜像或伪科技符号。" },
            { value: "editorial-serif", label: "杂志宋衬线", instruction: "标题采用清晰的宋体/衬线字形，正文搭配易读黑体；通过字重和留白形成编辑感，不使用过细小字。" },
            { value: "rounded", label: "柔和圆体", instruction: "采用端点柔和、结构清晰的圆体或圆角无衬线字形，保持专业易读，不使用幼稚装饰字。" },
            { value: "display", label: "醒目标题体", instruction: "采用有分量的展示标题字形，正文保持简洁易读；标题最多两行，不拉伸变形或挤压笔画。" },
        ],
    },
    {
        key: "colorRhythm",
        label: "色彩节奏",
        options: [
            { value: "unified", label: "整套统一", instruction: "全套固定主色、辅助色和强调色，只调整画面比例；真实商品颜色始终不变。" },
            { value: "tonal", label: "同色层次", instruction: "保持同一色相家族，逐张变化明度、饱和度和背景材质，形成递进；统一文字和强调色，商品不改色。" },
            { value: "alternating", label: "深浅交替", instruction: "以同一品牌色系按浅底/深底交替安排页面，标题随背景切换高对比配色；保持商品真实颜色和统一图标语言。" },
            { value: "contrast", label: "重点撞色", instruction: "固定一个基底色和一个适合商品的对比强调色，仅在主卖点或关键页面增加强调色面积，避免全页高饱和争抢主体。" },
            { value: "scene", label: "随场景变化", instruction: "背景色与光线色温可以随场景变化，固定标题字体、图标和品牌强调色作为系列联系；校准商品颜色，不让环境光改变商品身份。" },
        ],
    },
    {
        key: "informationDensity",
        label: "信息密度",
        options: [
            { value: "auto", label: "智能分配", instruction: "按信息量与画幅分配文字区：主视觉有呼吸感，参数/功能图集中说明，所有文字须在手机缩略预览中可读。" },
            { value: "airy", label: "留白突出", instruction: "画面以商品和留白为主；丰富文案如确需保留，分成少量清楚的短模块，不压缩成密集小字。" },
            { value: "balanced", label: "均衡易读", instruction: "商品、标题与解释形成明确主次，使用中等信息密度；每项说明靠近对应细节，避免大段连续正文。" },
            { value: "detailed", label: "详解丰富", instruction: "适合信息图的页面使用2–4个有事实依据或场景依据的说明模块，可配局部窗和短标签；优先扩大信息区，不缩小字号凑字。" },
        ],
    },
    {
        key: "layoutStyle",
        label: "排版方向",
        options: [
            { value: "auto", label: "智能编排", instruction: "根据本张主题选择版式，并在整套中安排主视觉、场景、局部解释与信息模块的节奏。" },
            { value: "editorial", label: "杂志编辑", instruction: "采用清晰网格、偏轴主视觉、大小有别的标题和说明，控制对齐线与留白；逐张变化主体位置，保留统一网格。" },
            { value: "feature-cards", label: "卖点模块", instruction: "以大商品主体配2–4个短说明模块，图标或局部窗一一对应可见/已核实信息，模块有主次而非平均堆砌。" },
            { value: "immersive", label: "沉浸场景", instruction: "让商品置于可信、完整的使用环境，文案放在自然留白区；人物、背景和光线服务于商品，不能让场景淹没产品。" },
            { value: "minimal", label: "极简主视觉", instruction: "用大主体、少量图形与明确留白建立视觉焦点；保留已审阅文案的全部信息，通过短模块和留白解决信息量，不随意删字。" },
            { value: "comparison", label: "细节对照", instruction: "用整体与局部、不同真实角度或已确认规格的并置解释产品；不得虚构竞品、前后效果、性能优劣或未证实差异。" },
        ],
    },
];

export function normalizeCreativeOptions(draft: Pick<EcommerceDraft, "creativeOptions">): EcommerceCreativeOptions {
    const result = { ...defaultCreativeOptions };
    for (const field of creativeControlFields) {
        const value = draft.creativeOptions?.[field.key];
        if (field.options.some((option) => option.value === value)) Object.assign(result, { [field.key]: value });
    }
    return result;
}

export function commerceAllowsText(draft: Pick<EcommerceDraft, "noText" | "creativeOptions" | "imageType" | "cloneOptions"> & Partial<Pick<EcommerceDraft, "platform" | "typeOptions">>, imageType = draft.imageType): boolean {
    return (
        !draft.noText &&
        normalizeCreativeOptions(draft).textMode !== "none" &&
        draft.cloneOptions?.copyMode !== "none" &&
        !["white", "three-view"].includes(imageType) &&
        // Amazon-style listing main images must be pure white without any text.
        !commercePlatformListingMain(draft.platform || "", imageType, draft.typeOptions?.purpose) &&
        !commercePlatformNoText(draft.platform || "", imageType, draft.typeOptions?.purpose)
    );
}

/** Compact form for image models: only the chosen instructions, no planning meta rules. */
export function commerceCreativeBrief(draft: EcommerceDraft): string {
    const selected = normalizeCreativeOptions(draft);
    const allowsText = commerceAllowsText(draft);
    return creativeControlFields
        .filter((field) => allowsText || !["textMode", "copyTone"].includes(field.key))
        .map((field) => {
            const option = field.options.find((entry) => entry.value === selected[field.key])!;
            return `- ${field.label} · ${option.label}：${option.instruction}`;
        })
        .join("\n");
}

export function commerceCreativeDirection(draft: EcommerceDraft): string {
    const selected = normalizeCreativeOptions(draft);
    return [
        `用户创作参数（必须逐项落实到文案、视觉策略和每张提示词）：${JSON.stringify(selected)}`,
        ...creativeControlFields.map((field) => {
            const option = field.options.find((entry) => entry.value === selected[field.key])!;
            return `${field.label} · ${option.label}：${option.instruction}`;
        }),
        commerceAllowsText(draft)
            ? "先确定文案内容和层次，再安排文字区域与商品画面；文案模式控制内容量，信息密度控制布局疏密，二者通过分块与留白共同落实。"
            : "本张的纯图规则优先于所有文案偏好：copy 必须为空，不新增任何排版文字；字体和文案风格保留为设置但本张不执行。",
        "以上用户明确选项优先于默认美术建议与 Skills 中的风格建议；白底、三视图、SKU等创作类型的硬性规则仍优先。colorRhythm 控制系列变化方式，统一视觉系统不等于所有页面背景色完全相同。",
    ].join("\n");
}
