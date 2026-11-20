import type { EcommerceDraft } from "@/services/api/ecommerce";

export type CommercePhraseGroup = { key: string; label: string; phrases: string[] };
export type CommerceScene = {
    label: string;
    imageType: string;
    count: number;
    distribution?: string;
    /** 一句话说明这个场景产出什么。 */
    summary: string;
    /** 场景需要的素材：必需项决定能否开始，建议项只做提示。 */
    materials: { required: string; suggested?: string };
    /** 需要 Agent 先策划整套内容的场景。 */
    planned: boolean;
    phrases: CommercePhraseGroup[];
};

const background: CommercePhraseGroup = { key: "background", label: "背景", phrases: ["纯白无缝背景", "浅灰影棚背景", "大理石台面", "原木桌面", "绿植与自然光", "简约居家场景", "户外阳光", "节日氛围布景"] };
const light: CommercePhraseGroup = { key: "light", label: "光线", phrases: ["柔和棚拍光", "自然窗光", "侧逆光勾勒轮廓", "高调明亮", "低调质感光", "真实接触阴影"] };
const composition: CommercePhraseGroup = { key: "composition", label: "构图", phrases: ["商品居中完整呈现", "45° 俯拍", "平视正面", "微距细节特写", "一侧留白便于排版", "多件组合陈列"] };
const style: CommercePhraseGroup = { key: "style", label: "风格", phrases: ["极简高级感", "清新日系", "奢华质感", "科技未来感", "国潮配色", "温暖生活感"] };
const story: CommercePhraseGroup = { key: "story", label: "叙事", phrases: ["首屏突出商品整体", "按卖点逐张展开", "加入真实使用场景", "细节特写说明材质", "规格信息单独成页", "结尾展示包装与配件"] };

export const commerceScenes: CommerceScene[] = [
    {
        label: "白底图",
        imageType: "white",
        count: 1,
        summary: "纯白背景、轮廓与颜色准确，不加文字，适合平台主图。",
        materials: { required: "1 张清晰的商品正面图" },
        planned: false,
        phrases: [
            { key: "shadow", label: "阴影", phrases: ["保留自然接触阴影", "轻柔棚拍阴影", "无阴影"] },
            { key: "composition", label: "构图", phrases: ["商品居中完整呈现", "四周保留充足留白", "平视正面", "45° 俯拍"] },
        ],
    },
    {
        label: "单图",
        imageType: "single",
        count: 1,
        summary: "按一个用途做一张图，可用作主图、副图、Banner 或场景图。",
        materials: { required: "商品主图", suggested: "细节图" },
        planned: false,
        phrases: [background, light, composition, style],
    },
    {
        label: "主副图",
        imageType: "set",
        count: 2,
        distribution: "主图 1 张、副图 1 张",
        summary: "1 张主图加 1 张互补副图，展示其他角度或细节。",
        materials: { required: "商品主图", suggested: "侧面或背面图" },
        planned: false,
        phrases: [background, light, composition, style],
    },
    {
        label: "产品套图",
        imageType: "set",
        count: 8,
        summary: "主图、场景、卖点、细节和规格按商品资料分配，整套风格统一。",
        materials: { required: "商品主图", suggested: "细节、包装、Logo" },
        planned: true,
        phrases: [story, background, light, style],
    },
    {
        label: "详情图",
        imageType: "detail",
        count: 9,
        summary: "按卖点、场景、细节、规格和包装规划连贯的详情页，逐张可调。",
        materials: { required: "商品主图", suggested: "细节、包装，或一张参考长图" },
        planned: true,
        phrases: [story, background, light, style],
    },
    {
        label: "营销物料",
        imageType: "marketing",
        count: 1,
        summary: "海报、Banner 或信息流素材；价格和活动只用你提供的真实信息。",
        materials: { required: "商品主图", suggested: "品牌 Logo" },
        planned: true,
        phrases: [
            { key: "layout", label: "版式", phrases: ["一侧留白便于排版", "醒目标题区", "商品大面积特写", "品牌色背景"] },
            { key: "mood", label: "氛围", phrases: ["节日氛围布景", "清爽夏日", "高级质感", "活力撞色"] },
        ],
    },
];

/** 当前草稿对应的场景；套图按“主副图”的固定分配区分。 */
export function currentCommerceScene(draft: Pick<EcommerceDraft, "imageType" | "count" | "typeOptions">): CommerceScene | undefined {
    if (draft.imageType === "set") return commerceScenes.find((scene) => scene.label === (draft.count === 2 && draft.typeOptions?.distribution === "主图 1 张、副图 1 张" ? "主副图" : "产品套图"));
    return commerceScenes.find((scene) => scene.imageType === draft.imageType);
}
