import type { EcommerceDraft } from "@/services/api/ecommerce";
import { marketingPlanSlots } from "./marketing-materials";

export type ProductField = "claims" | "scene" | "audience" | "colors" | "materials" | "specifications" | "dimensions" | "packaging" | "brand" | "pricePosition" | "lockedDetails";
type TypeConfig = { brief: string; fields: ProductField[]; required?: ProductField[]; defaultCount: number; noText?: boolean };

export const ecommerceTypeConfig: Record<string, TypeConfig> = {
    main: { brief: "主体完整、卖点聚焦。主图文案和平台规范请以当前官方要求复核。", fields: ["claims", "lockedDetails", "brand"], defaultCount: 5 },
    secondary: { brief: "与主图互补，展示用户提供的其他角度、场景和真实细节。", fields: ["scene", "claims", "lockedDetails"], defaultCount: 5 },
    sku: { brief: "每个 SKU 独立指定名称、颜色、规格与参考图，数量由 SKU 项目相加。", fields: ["colors", "specifications", "lockedDetails"], defaultCount: 1 },
    white: { brief: "干净白底、准确轮廓和颜色，不添加营销文字。", fields: ["colors", "lockedDetails"], defaultCount: 3, noText: true },
    detail: { brief: "按真实卖点、性能表达、场景、细节、规格和包装规划九张连贯详情页，避免重复内容。", fields: ["claims", "scene", "specifications", "packaging"], defaultCount: 9 },
    scene: { brief: "商品与使用场景要有合理关系，避免无法证实的使用效果。", fields: ["scene", "audience", "lockedDetails"], defaultCount: 4 },
    selling: { brief: "可从商品图可见外观、真实使用情境提炼创意表达；性能卖点须有真实资料。", fields: ["claims", "audience", "lockedDetails"], defaultCount: 4 },
    feature: { brief: "可展示可见结构和交互场景；具体功能与效果须有真实资料。", fields: ["claims", "specifications", "lockedDetails"], defaultCount: 4 },
    size: { brief: "尺寸数值必须由用户确认，禁止 AI 猜测或编造刻度。", fields: ["dimensions", "specifications", "lockedDetails"], required: ["dimensions"], defaultCount: 3 },
    "three-view": { brief: "请尽量上传正面、侧面、背面参考图；缺少角度时须人工确认。", fields: ["dimensions", "lockedDetails", "colors"], defaultCount: 3, noText: true },
    material: { brief: "只呈现用户确认的材质和表面纹理。", fields: ["materials", "lockedDetails", "claims"], required: ["materials"], defaultCount: 3 },
    package: { brief: "包装结构、文字、配件数量应与真实参考一致。", fields: ["packaging", "brand", "lockedDetails"], required: ["packaging"], defaultCount: 3 },
    poster: { brief: "活动价格、权益与时间必须来自用户资料；留出可编辑文字区域。", fields: ["pricePosition", "claims", "brand"], defaultCount: 4 },
    "amazon-a-plus": { brief: "建立连续品牌叙事，平台规则请按当前 Amazon 官方要求复核。", fields: ["brand", "claims", "scene", "specifications"], defaultCount: 6 },
    social: { brief: "面向目标人群的真实生活场景，避免编造评价。", fields: ["audience", "scene", "claims"], defaultCount: 4 },
    set: { brief: "主图、场景、卖点、细节和规格按商品事实动态分配。", fields: ["claims", "scene", "specifications", "lockedDetails"], defaultCount: 8 },
    single: { brief: "每张图按所选用途独立策划，可用于主图、副图、Banner、SKU 展示或场景图；始终保持商品保真。", fields: ["claims", "scene", "lockedDetails"], defaultCount: 1 },
    marketing: { brief: "制作海报、Banner 或信息流素材；价格、活动与权益只能采用用户提供的真实资料。", fields: ["claims", "audience", "pricePosition", "brand"], defaultCount: 4 },
};
export const fieldLabel: Record<ProductField, string> = {
    claims: "已确认的卖点",
    scene: "使用场景",
    audience: "目标用户",
    colors: "产品颜色",
    materials: "已确认的材质",
    specifications: "规格参数",
    dimensions: "尺寸",
    packaging: "包装与配件",
    brand: "品牌",
    pricePosition: "价格定位 / 活动信息",
    lockedDetails: "禁止修改的产品细节",
};
export type CreationOption = { key: string; label: string; placeholder?: string; choices?: string[]; required?: boolean };
export const creationOptions: Record<string, CreationOption[]> = {
    main: [
        { key: "background", label: "主图背景", choices: ["纯白背景", "简洁棚拍", "真实使用场景"] },
        { key: "focus", label: "主图视觉重点", choices: ["商品整体外观", "已确认核心卖点", "品牌与包装组合"] },
    ],
    secondary: [
        { key: "complement", label: "与主图互补的信息", placeholder: "例如：背部接口、配件组合、操作细节" },
        { key: "angle", label: "展示角度", placeholder: "例如：侧面与背面；请提供对应实拍图" },
    ],
    sku: [
        { key: "background", label: "全 SKU 统一背景", choices: ["纯白", "浅灰棚拍", "品牌色背景"] },
        { key: "layout", label: "全 SKU 文案位置", choices: ["上方留白", "下方留白", "右侧留白", "不添加文字"] },
    ],
    white: [
        { key: "shadow", label: "白底阴影处理", choices: ["保留自然接触阴影", "轻柔棚拍阴影", "无阴影"] },
        { key: "crop", label: "主体留白", choices: ["完整主体居中", "四周保留充足留白"] },
    ],
    detail: [
        { key: "sections", label: "详情页板块与顺序", placeholder: "例如：首屏 → 已确认卖点 → 使用场景 → 规格 → 包装，每张对应一个板块" },
        { key: "afterSales", label: "真实售后政策（可选）", placeholder: "仅填写实际提供的售后政策；留空则不策划售后承诺" },
    ],
    scene: [
        { key: "environment", label: "场景环境与时段", placeholder: "例如：清晨卧室床头、自然窗光" },
        { key: "people", label: "人物出现方式", choices: ["不出现人物", "仅手部使用", "人物与商品同框"] },
    ],
    selling: [
        { key: "claimOrder", label: "卖点优先顺序", placeholder: "按真实卖点逐行填写；每张图表达一项" },
        { key: "layout", label: "卖点版式", choices: ["主体加短标题", "局部特写加说明", "场景与卖点结合"] },
    ],
    feature: [
        { key: "steps", label: "真实操作步骤", placeholder: "例如：连接电源 → 按下按钮 → 选择档位，勿填未经确认的功能" },
        { key: "method", label: "功能展示方式", choices: ["操作步骤", "功能特写", "结构示意（需真实资料）"] },
    ],
    size: [
        { key: "unit", label: "尺寸标注单位", choices: ["毫米 mm", "厘米 cm", "英寸 in"] },
        { key: "view", label: "尺寸视角", choices: ["正面长宽", "侧面高度", "整体三维尺寸"] },
    ],
    "three-view": [
        { key: "angles", label: "三视图角度", choices: ["正面 / 侧面 / 背面", "正面 / 侧面 / 顶面"] },
        { key: "alignment", label: "视图编排", choices: ["每张一个角度，统一尺度", "同张横排，统一尺度"] },
    ],
    material: [
        { key: "surface", label: "已确认的表面工艺", placeholder: "例如：磨砂纹理；不确定可留空" },
        { key: "magnification", label: "材质呈现尺度", choices: ["整体质感", "局部微距", "整体与局部结合"] },
    ],
    package: [
        { key: "state", label: "包装展示状态", choices: ["完整外包装", "开箱陈列", "商品与包装合影"] },
        { key: "packageText", label: "须保持的真实包装文字", placeholder: "请填写原包装文字或提供清晰包装参考图" },
    ],
    poster: [
        { key: "activity", label: "真实活动内容", required: true, placeholder: "填写已确定的活动名称、日期、价格与权益；不编造折扣" },
        { key: "headline", label: "活动主标题", placeholder: "可留空交给 Agent 根据真实活动信息撰写" },
    ],
    "amazon-a-plus": [
        { key: "modules", label: "A+ 内容模块", placeholder: "例如：品牌介绍、使用场景、细节、已确认规格；一张对应一个模块" },
        { key: "brandStory", label: "已确认品牌故事", placeholder: "只填写可证实的品牌事实，留空则不编造品牌历史" },
    ],
    social: [
        { key: "placement", label: "社交投放位置", choices: ["信息流", "竖版故事", "封面", "轮播图"] },
        { key: "tone", label: "文案表达", choices: ["简洁介绍", "生活方式", "产品使用指南"] },
    ],
    set: [
        { key: "distribution", label: "套图类型分配", placeholder: "例如：主图 2 张、场景 2 张、卖点 2 张；合计必须等于生成数量" },
        { key: "sequence", label: "整套叙事顺序", placeholder: "例如：认识商品 → 使用场景 → 细节 → 规格" },
    ],
    single: [
        { key: "purpose", label: "单图用途", choices: ["商品主图", "商品副图", "Banner", "SKU 展示", "商品场景图", "自定义"] },
        { key: "focus", label: "画面重点", placeholder: "例如：商品完整轮廓与真实包装；不要补造未提供的细节" },
    ],
    marketing: [],
};
export function selectedCreationRequirements(draft: EcommerceDraft) {
    const requirements = Object.fromEntries((creationOptions[draft.imageType] || []).filter((item) => draft.typeOptions?.[item.key]?.trim()).map((item) => [item.label, draft.typeOptions![item.key].trim()]));
    if (draft.imageType === "marketing")
        requirements["物料配置"] = marketingPlanSlots(draft)
            .map((item, index) => `${index + 1}. ${item.category} / ${item.name} / ${item.ratio}`)
            .join("；");
    return requirements;
}
export function typeValidation(draft: EcommerceDraft): string | null {
    const type = ecommerceTypeConfig[draft.imageType];
    if (!type) return "不支持的创作类型，请重新选择";
    if (draft.imageType === "white" && (draft.modelEnabled || !draft.noText)) return "白底图须关闭模特和画面文字";
    if (draft.imageType === "single" && draft.count !== 1) return "单图只能生成 1 张";
    if (draft.imageType === "marketing" && (marketingPlanSlots(draft).length < 1 || marketingPlanSlots(draft).length > 15 || draft.count !== marketingPlanSlots(draft).length)) return "请在物料配置中选择 1 到 15 张，并确认张数一致";
    if (draft.modelEnabled && draft.imageType === "scene" && draft.typeOptions?.people === "不出现人物") return "已开启模特，请将场景人物改为“人物与商品同框”或关闭模特";
    const missing = type.required?.find((field) => !draft[field]?.trim());
    if (missing) return `${fieldLabel[missing]}是当前创作类型的真实资料，请填写后再策划`;
    const specific = creationOptions[draft.imageType] || [];
    for (const [key, value] of Object.entries(draft.typeOptions || {})) {
        const option = specific.find((item) => item.key === key);
        if ((!option && !(draft.imageType === "marketing" && key === "materialPlan")) || (option?.choices && value && !option.choices.includes(value))) return "创作类型专属参数无效，请重新选择";
    }
    const missingOption = specific.find((item) => item.required && !draft.typeOptions?.[item.key]?.trim());
    return missingOption ? `请填写${missingOption.label}后再策划` : null;
}
