export const platforms = [
    ["taobao", "淘宝"],
    ["tmall", "天猫"],
    ["jd", "京东"],
    ["pdd", "拼多多"],
    ["douyin", "抖音电商"],
    ["kuaishou", "快手电商"],
    ["1688", "1688"],
    ["xiaohongshu", "小红书电商"],
    ["amazon", "Amazon"],
    ["temu", "Temu"],
    ["shein", "SHEIN（希音）"],
    ["shopee", "Shopee"],
    ["lazada", "Lazada"],
    ["tiktok", "TikTok Shop"],
    ["shopify", "Shopify"],
    ["ebay", "eBay"],
    ["aliexpress", "AliExpress"],
    ["wechat-shop", "微信小店"],
    ["video-shop", "视频号小店"],
    ["etsy", "Etsy"],
    ["walmart", "Walmart"],
    ["mercado-libre", "Mercado Libre"],
    ["coupang", "Coupang"],
    ["rakuten", "Rakuten"],
    ["ozon", "Ozon"],
    ["alibaba", "阿里巴巴国际站"],
    ["dhgate", "DHgate"],
    ["11street", "11Street"],
    ["wayfair", "Wayfair"],
    ["noon", "Noon"],
    ["wildberries", "WBPartners"],
    ["emag", "eMAG"],
    ["vipshop", "唯品会"],
    ["dewu", "得物"],
    ["aikucun", "爱库存"],
    ["railway", "国铁商城"],
] as const;

export const commercePlatformGroups = {
    crossBorder: [
        "amazon",
        "temu",
        "shein",
        "shopee",
        "tiktok",
        "aliexpress",
        "alibaba",
        "ozon",
        "lazada",
        "dhgate",
        "coupang",
        "11street",
        "wayfair",
        "etsy",
        "noon",
        "ebay",
        "wildberries",
        "mercado-libre",
        "emag",
        "shopify",
        "walmart",
        "rakuten",
    ] as const,
    domestic: ["taobao", "jd", "pdd", "1688", "xiaohongshu", "douyin", "vipshop", "dewu", "aikucun", "railway", "tmall", "kuaishou", "wechat-shop", "video-shop"] as const,
};

export const languageVisuals: Record<string, { flag: string; label: string }> = {
    "zh-CN": { flag: "cn", label: "中文简体（推荐）" },
    "zh-TW": { flag: "cn", label: "中文繁体" },
    en: { flag: "us", label: "英文" },
    ru: { flag: "ru", label: "俄语" },
    ja: { flag: "jp", label: "日语" },
    ko: { flag: "kr", label: "韩语" },
    ar: { flag: "sa", label: "阿拉伯语" },
    de: { flag: "de", label: "德语" },
    es: { flag: "es", label: "西班牙语" },
    fr: { flag: "fr", label: "法语" },
    pt: { flag: "pt", label: "葡萄牙语" },
    auto: { flag: "", label: "自动识别目标市场" },
};

export const imageTypes = [
    ["main", "电商主图"],
    ["secondary", "电商副图"],
    ["sku", "商品 SKU 图"],
    ["white", "商品白底图"],
    ["detail", "商品详情页"],
    ["scene", "商品场景图"],
    ["selling", "商品卖点图"],
    ["feature", "产品功能图"],
    ["size", "产品尺寸展示图"],
    ["three-view", "产品三视图"],
    ["material", "产品材质展示图"],
    ["package", "产品包装展示图"],
    ["poster", "电商活动海报"],
    ["amazon-a-plus", "Amazon A+ 页面素材"],
    ["social", "社交电商推广图"],
    ["set", "AI 一键整套商品图"],
    ["single", "单图"],
    ["marketing", "营销物料"],
] as const;

export const languages = [
    ["zh-CN", "简体中文"],
    ["zh-TW", "繁体中文"],
    ["en", "英文"],
    ["ja", "日文"],
    ["ko", "韩文"],
    ["ru", "俄语"],
    ["fr", "法文"],
    ["de", "德文"],
    ["es", "西班牙文"],
    ["pt", "葡萄牙文"],
    ["ar", "阿拉伯文"],
    ["auto", "自动识别目标市场"],
] as const;

export const styles = [
    ["commercial", "高级商业摄影"],
    ["white", "极简白底"],
    ["family", "母婴温馨"],
    ["future", "科技未来"],
    ["luxury", "轻奢质感"],
    ["home", "现代家居"],
    ["youth", "潮流年轻化"],
    ["nature", "清新自然"],
    ["chinese", "新中式"],
    ["japanese", "日系"],
    ["korean", "韩系"],
    ["western", "欧美商业"],
    ["studio", "高级棚拍"],
    ["lifestyle", "真实生活场景"],
    ["festival", "节日促销"],
    ["street", "潮流穿搭"],
    ["healing", "清新治愈"],
    ["electro", "潮酷电音"],
    ["glass", "磨砂玻璃"],
    ["editorial", "编辑杂志"],
    ["retro", "复古印刷"],
    ["sport", "运动动势"],
    ["cute", "趣味可爱"],
    ["beauty", "清透美妆"],
    ["food", "食欲摄影"],
    ["coastal", "海岸度假"],
    ["industrial", "工业机能"],
    ["handmade", "手作温度"],
    ["monochrome", "黑白编辑"],
    ["paper", "纸张拼贴"],
    ["bold", "撞色潮玩"],
    ["macro", "细节微距"],
    ["minimal", "极简留白"],
] as const;

export const options = (items: readonly (readonly [string, string])[]) => items.map(([value, label]) => ({ value, label }));
export const labelOf = (items: readonly (readonly [string, string])[], value: string) => items.find(([id]) => id === value)?.[1] || value;
export const formatCommerceCredits = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);

const aspectCandidates = Array.from({ length: 24 }, (_, width) => Array.from({ length: 24 }, (_, height) => ({ width: width + 1, height: height + 1 }))).flat();

export function imageSizeLabel(value: string) {
    if (value === "auto") return "自动";
    const dimensions = /^(\d+)[x×](\d+)$/i.exec(value);
    if (!dimensions) return value;
    const ratio = Number(dimensions[1]) / Number(dimensions[2]);
    const common = [
        ["1:1", 1],
        ["4:5", 0.8],
        ["3:4", 0.75],
        ["2:3", 2 / 3],
        ["9:16", 9 / 16],
        ["5:4", 1.25],
        ["4:3", 4 / 3],
        ["3:2", 1.5],
        ["16:9", 16 / 9],
        ["2:1", 2],
        ["21:9", 21 / 9],
        ["4:1", 4],
    ] as const;
    const match = common.find(([, expected]) => Math.abs(ratio / expected - 1) < 0.035);
    if (match) return match[0];
    const closest = aspectCandidates.reduce((best, candidate) =>
        Math.abs(candidate.width / candidate.height / ratio - 1) + (candidate.width + candidate.height) * 0.0001 < Math.abs(best.width / best.height / ratio - 1) + (best.width + best.height) * 0.0001 ? candidate : best,
    );
    return `${closest.width}:${closest.height}`;
}

function sizeAspect(value: string) {
    const match = /^(\d+)(?:[:x×])(\d+)$/i.exec(value);
    return match ? Number(match[1]) / Number(match[2]) : null;
}

function sizeArea(value: string) {
    const match = /^(\d+)[x×](\d+)$/i.exec(value);
    return match ? Number(match[1]) * Number(match[2]) : null;
}

/** Resolve a displayed ratio to an actual size supported by the selected model. */
export function supportedImageSize(preferred: string, available: string[], current?: string) {
    if (!available.length) return preferred;
    const wanted = sizeAspect(preferred);
    const targetArea = current ? sizeArea(current) : null;
    const candidates = available.filter((value) => imageSizeLabel(value) === imageSizeLabel(preferred));
    const pool = candidates.length ? candidates : wanted ? available.filter((value) => sizeAspect(value) !== null) : available;
    if (!pool.length) return available[0];
    return [...pool].sort((left, right) => {
        const aspectPenalty = (value: string) => (wanted && sizeAspect(value) ? Math.abs(Math.log(sizeAspect(value)! / wanted)) : 0);
        const areaPenalty = (value: string) => (targetArea && sizeArea(value) ? Math.abs(Math.log(sizeArea(value)! / targetArea)) * 0.08 : 0);
        const score = (value: string) => aspectPenalty(value) + areaPenalty(value);
        return score(left) - score(right);
    })[0];
}

export function displayImageSizeChoices(values: string[], current?: string) {
    return [...new Set(values.map(imageSizeLabel))].map((label) => ({ label, value: supportedImageSize(label, values, current) }));
}

/**
 * The ratio 自动 stands for on platforms with a recommendation: 小红书 and 抖音/快手 3:4; 淘宝/天猫/京东/拼多多/1688
 * 1:1 for main, set, single, white and SKU images and 3:4 for detail pages; Amazon/eBay/Walmart/AliExpress 1:1
 * (A+ and detail modules excepted). Marketing images keep their material slot ratios and banners stay with the
 * model's own choice, so they have none.
 */
export function commerceAutoRatio(platform: string, imageType: string, purpose = ""): string | undefined {
    if (imageType === "marketing" || (imageType === "single" && purpose.includes("Banner"))) return undefined;
    if (platform === "shein") return "3:4";
    if (["xiaohongshu", "douyin", "kuaishou"].includes(platform)) return "3:4";
    if (["taobao", "tmall", "jd", "pdd", "1688"].includes(platform)) return imageType === "detail" ? "3:4" : ["main", "set", "single", "white", "sku"].includes(imageType) ? "1:1" : undefined;
    if (["amazon", "ebay", "walmart", "aliexpress"].includes(platform)) return ["detail", "amazon-a-plus"].includes(imageType) ? undefined : "1:1";
    return undefined;
}

/**
 * Resolves 自动 ("auto") to the platform and type recommendation when the model offers that exact ratio. Without a
 * recommendation or a supported size it stays "auto", so the model keeps choosing as before; any other value is
 * returned unchanged.
 */
export function resolveAutoImageSize(value: string, available: string[], platform: string, imageType: string, purpose = "") {
    if (value !== "auto") return value;
    const recommended = commerceAutoRatio(platform, imageType, purpose);
    if (!recommended || !available.some((size) => size !== "auto" && imageSizeLabel(size) === recommended)) return value;
    return supportedImageSize(recommended, available);
}
