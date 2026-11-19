/**
 * DMC 模型目录与价格快照。
 *
 * 数据来源（2026-11-17 实测）：
 *   展示价  https://ll2.cn/pricing
 *   完整清单 https://ll2.cn/api/pricing  （公开接口，21 个模型，允许跨域）
 *
 * 说明：
 *   - 官网展示价是人民币最终口径，不以 /api/pricing 的内部计费系数替代。
 *   - wan3.0-video-prime 官网未给出展示价文本，其单价由计费系数 × 6.8 换算
 *     （倍率经 MiniMax-H3 / wan3.0-video / viduq3-pro 三处交叉验证），标 derived。
 *   - 实时价格以官网价格页为准，账单以 DMC 控制台为准。产品内所有预估都必须带这句。
 *   - 品牌名是 DMC，域名是 ll2.cn（api.ll2.cn）。ll2 只是域名，不是品牌名；
 *     代码里的 LL2_* 常量名、ll2-* 类名与文件名属于技术标识，不随品牌改名。
 */

export const LL2_API_BASE = "https://api.ll2.cn/v1";
export const LL2_PRICING_URL = "https://ll2.cn/pricing";
export const LL2_PRICING_API = "https://ll2.cn/api/pricing";
export const LL2_DOCS_URL = "https://ll2.cn/docs";
export const LL2_STATUS_URL = "https://status.ll2.cn/status/ll2";
export const LL2_PRICE_SNAPSHOT_DATE = "2026-11-17";
export const LL2_PRICE_DISCLAIMER = "按 LL2 官网价格估算，实际账单以控制台为准";

export type LL2ModelCategory = "video" | "upscale" | "text";

export type LL2Model = {
    id: string;
    name: string;
    category: LL2ModelCategory;
    vendor: string;
    /** 一句话能力，给客户看，不写工程术语。 */
    capability: string;
    /** 规格：分辨率、时长、参考素材等。 */
    spec: string;
    /** 官网原文单价，例如 "¥0.05/秒"。 */
    priceText: string;
    /** 计费单位口径。 */
    billingUnit: string;
    /** 按秒计费时的单价区间（元/秒）。 */
    perSecondMin?: number;
    perSecondMax?: number;
    /** 文本模型：元 / 1M Token。 */
    tokenInput?: number;
    tokenOutput?: number;
    tokenCache?: number;
    /** 官网给出的典型一次调用示例。 */
    sampleSeconds?: number;
    sampleCost?: number;
    sampleLabel: string;
    /** 复合计费（输入秒数 + 输出秒数 + 图片超额量）。 */
    composite?: boolean;
    /** 单价为换算值而非官网展示文本。 */
    derived?: boolean;
    docs?: string;
};

const doc = (chapter: string) => `${LL2_DOCS_URL}?chapter=${chapter}`;

export const LL2_MODELS: LL2Model[] = [
    // ── 旗舰 / 视频生成 ──────────────────────────────────────────────
    {
        id: "MiniMax-H3",
        name: "MiniMax-H3",
        category: "video",
        vendor: "MiniMax · DMC 自建机房",
        capability: "文生视频、首尾帧、参考图片 / 视频 / 音频",
        spec: "固定 768P · 1–15 秒 · 24 FPS · MP4",
        priceText: "¥0.05/秒",
        billingUnit: "按成片秒数",
        perSecondMin: 0.05,
        perSecondMax: 0.05,
        sampleSeconds: 5,
        sampleCost: 0.25,
        sampleLabel: "768P 5s ≈ ¥0.25",
        docs: doc("9548144m0"),
    },
    {
        id: "auto-hd",
        name: "auto-hd",
        category: "upscale",
        vendor: "DMC 超分后处理",
        capability: "把已有视频超分到更高清晰度（独立后处理，不重新生成视频）",
        spec: "720p / 1080p / 2K / 4K · 按成片实际秒数",
        priceText: "¥0.008333–¥0.06/秒",
        billingUnit: "按成片秒数，按清晰度分档",
        perSecondMin: 0.008333,
        perSecondMax: 0.06,
        sampleSeconds: 60,
        sampleCost: 0.5,
        sampleLabel: "720p 60s ≈ ¥0.5",
        docs: doc("9548568m0"),
    },
    {
        id: "doubao-seedance-2-0",
        name: "doubao-seedance-2-0",
        category: "video",
        vendor: "豆包 Seedance",
        capability: "视频生成，可带参考视频",
        spec: "480p / 720p / 1080p / 4K",
        priceText: "¥12.5248–¥39.9228 / 1M Token",
        billingUnit: "按 Token 用量（视频任务）",
        sampleSeconds: 5,
        sampleCost: 1.7298,
        sampleLabel: "480p 5s ≈ ¥1.7298",
        docs: doc("9548487m0"),
    },
    {
        id: "doubao-seedance-2-0-fast",
        name: "doubao-seedance-2-0-fast",
        category: "video",
        vendor: "豆包 Seedance",
        capability: "快速版视频生成，可带参考视频",
        spec: "480p / 720p",
        priceText: "¥16.0886–¥27.0581 / 1M Token",
        billingUnit: "按 Token 用量（视频任务）",
        sampleSeconds: 5,
        sampleCost: 1.2998,
        sampleLabel: "480p 5s ≈ ¥1.2998",
        docs: doc("9548487m0"),
    },
    {
        id: "doubao-seedance-2-0-mini",
        name: "doubao-seedance-2-0-mini",
        category: "video",
        vendor: "豆包 Seedance",
        capability: "轻量版视频生成，可带参考视频",
        spec: "480p / 720p",
        priceText: "¥8.7962–¥14.4509 / 1M Token",
        billingUnit: "按 Token 用量（视频任务）",
        sampleSeconds: 5,
        sampleCost: 0.694192,
        sampleLabel: "480p 5s ≈ ¥0.694192",
        docs: doc("9548487m0"),
    },
    {
        id: "doubao-seedance-2-5",
        name: "doubao-seedance-2-5",
        category: "video",
        vendor: "豆包 Seedance",
        capability: "视频生成，可带参考视频",
        spec: "480p / 720p / 1080p",
        priceText: "¥34.1754–¥62.6549 / 1M Token",
        billingUnit: "按 Token 用量（视频任务）",
        sampleSeconds: 5,
        sampleCost: 2.7362,
        sampleLabel: "480p 5s ≈ ¥2.7362",
        docs: doc("9548487m0"),
    },
    {
        id: "viduq3-pro",
        name: "viduq3-pro",
        category: "video",
        vendor: "Vidu Q3",
        capability: "视频生成",
        spec: "540p / 720p / 1080p",
        priceText: "¥0.193125–¥0.579375/秒",
        billingUnit: "按秒，按清晰度分档",
        perSecondMin: 0.193125,
        perSecondMax: 0.579375,
        sampleSeconds: 5,
        sampleCost: 0.965625,
        sampleLabel: "540p 5s ≈ ¥0.965625",
        docs: doc("9548490m0"),
    },
    {
        id: "viduq3-turbo",
        name: "viduq3-turbo",
        category: "video",
        vendor: "Vidu Q3",
        capability: "视频生成（更快）",
        spec: "540p / 720p / 1080p",
        priceText: "¥0.1545–¥0.270375/秒",
        billingUnit: "按秒，按清晰度分档",
        perSecondMin: 0.1545,
        perSecondMax: 0.270375,
        sampleSeconds: 5,
        sampleCost: 0.7725,
        sampleLabel: "540p 5s ≈ ¥0.7725",
        docs: doc("9548490m0"),
    },
    {
        id: "wan3.0-video",
        name: "wan3.0-video",
        category: "video",
        vendor: "阿里云百炼万相 3.0",
        capability: "文生、首帧、首尾帧，参考图 / 视频 / 音频 / 文件 / 网页",
        spec: "480P / 720P / 1080P · 2–30 秒",
        priceText: "¥0.132–¥0.528/秒",
        billingUnit: "按秒，按清晰度分档",
        perSecondMin: 0.132,
        perSecondMax: 0.528,
        sampleSeconds: 5,
        sampleCost: 0.66,
        sampleLabel: "480P 5s ≈ ¥0.66（按最低档折算）",
        derived: true,
        docs: doc("9671189m0"),
    },
    {
        id: "wan3.0-video-prime",
        name: "wan3.0-video-prime",
        category: "video",
        vendor: "阿里云百炼万相 3.0",
        capability: "万相 3.0 高速版，参数与 wan3.0-video 相同",
        spec: "480P / 720P / 1080P · 2–30 秒",
        priceText: "¥0.234–¥0.936/秒",
        billingUnit: "按秒，按清晰度分档",
        perSecondMin: 0.234,
        perSecondMax: 0.936,
        sampleSeconds: 5,
        sampleCost: 1.17,
        sampleLabel: "480P 5s ≈ ¥1.17（按最低档折算）",
        derived: true,
        docs: doc("9671189m0"),
    },
    // ── Super Vega 系列（复合计费） ──────────────────────────────────
    {
        id: "Super Vega 1.0-lite",
        name: "Super Vega 1.0-lite",
        category: "video",
        vendor: "Super Vega",
        capability: "视频生成，按输入 / 输出秒数与图片超额量复合计费",
        spec: "768P",
        priceText: "输入/输出 ¥0.24651–¥0.6225/秒 · 图片 ¥0.1245/单位",
        billingUnit: "复合：输入秒 + 输出秒 + 图片超额量",
        perSecondMin: 0.24651,
        perSecondMax: 0.6225,
        sampleSeconds: 5,
        sampleCost: 1.5563,
        sampleLabel: "768P 5s ≈ ¥1.5563",
        composite: true,
        docs: doc("9565575m0"),
    },
    {
        id: "Super Vega 1.0-pro",
        name: "Super Vega 1.0-pro",
        category: "video",
        vendor: "Super Vega",
        capability: "视频生成，按输入 / 输出秒数与图片超额量复合计费",
        spec: "768P",
        priceText: "输入 ¥0.215064–¥2.472/秒 · 输出 ¥0.215064–¥4.0376/秒 · 图片 ¥0.1245/单位",
        billingUnit: "复合：输入秒 + 输出秒 + 图片超额量",
        perSecondMin: 0.215064,
        perSecondMax: 4.0376,
        sampleSeconds: 5,
        sampleCost: 3.2754,
        sampleLabel: "768P 5s ≈ ¥3.2754",
        composite: true,
        docs: doc("9565575m0"),
    },
    {
        id: "Super Vega 1.0-pro-fast",
        name: "Super Vega 1.0-pro-fast",
        category: "video",
        vendor: "Super Vega",
        capability: "视频生成（更快），复合计费",
        spec: "768P",
        priceText: "输入 ¥0.17181–¥0.87067/秒 · 输出 ¥0.17181–¥1.406/秒 · 图片 ¥0.1245/单位",
        billingUnit: "复合：输入秒 + 输出秒 + 图片超额量",
        perSecondMin: 0.17181,
        perSecondMax: 1.406,
        sampleSeconds: 5,
        sampleCost: 2.6767,
        sampleLabel: "768P 5s ≈ ¥2.6767",
        composite: true,
        docs: doc("9565575m0"),
    },
    {
        id: "Super Vega 1.0-pro-mini",
        name: "Super Vega 1.0-pro-mini",
        category: "video",
        vendor: "Super Vega",
        capability: "视频生成（轻量），复合计费",
        spec: "768P",
        priceText: "输入 ¥0.10458–¥0.58598/秒 · 输出 ¥0.10458–¥0.90387/秒 · 图片 ¥0.1245/单位",
        billingUnit: "复合：输入秒 + 输出秒 + 图片超额量",
        perSecondMin: 0.10458,
        perSecondMax: 0.90387,
        sampleSeconds: 5,
        sampleCost: 1.7098,
        sampleLabel: "768P 5s ≈ ¥1.7098",
        composite: true,
        docs: doc("9565575m0"),
    },
    {
        id: "Super Vega 1.5-pro",
        name: "Super Vega 1.5-pro",
        category: "video",
        vendor: "Super Vega",
        capability: "视频生成（1.5 代），复合计费",
        spec: "768P",
        priceText: "输入 ¥0.299606–¥3.4987/秒 · 输出 ¥0.299606–¥5.7738/秒 · 图片 ¥0.1245/单位",
        billingUnit: "复合：输入秒 + 输出秒 + 图片超额量",
        perSecondMin: 0.299606,
        perSecondMax: 5.7738,
        sampleSeconds: 5,
        sampleCost: 4.8958,
        sampleLabel: "768P 5s ≈ ¥4.8958",
        composite: true,
        docs: doc("9565575m0"),
    },
    // ── 文本 / 多模态（元 / 1M Token） ───────────────────────────────
    {
        id: "glm-5.3-flash",
        name: "glm-5.3-flash",
        category: "text",
        vendor: "GLM",
        capability: "原生多模态，高效编程与长程智能体",
        spec: "OpenAI / Anthropic 兼容",
        priceText: "输入 ¥0.44 · 输出 ¥1.54",
        billingUnit: "元 / 1M Token",
        tokenInput: 0.44,
        tokenOutput: 1.54,
        sampleLabel: "按 Token 用量计费，无固定单次价",
    },
    {
        id: "deepseek-v4.1-flash",
        name: "deepseek-v4.1-flash",
        category: "text",
        vendor: "DeepSeek",
        capability: "推理、编程、智能体任务",
        spec: "OpenAI / Anthropic 兼容 · 分时计费",
        priceText: "输入 ¥0.88 · 输出 ¥3.52",
        billingUnit: "元 / 1M Token",
        tokenInput: 0.88,
        tokenOutput: 3.52,
        sampleLabel: "按 Token 用量计费，无固定单次价",
    },
    {
        id: "deepseek-v4-flash-0731",
        name: "deepseek-v4-flash-0731",
        category: "text",
        vendor: "DeepSeek",
        capability: "更快推理与日常任务",
        spec: "OpenAI / Anthropic 兼容 · 分时计费",
        priceText: "输入 ¥1.65 · 输出 ¥4.95",
        billingUnit: "元 / 1M Token",
        tokenInput: 1.65,
        tokenOutput: 4.95,
        sampleLabel: "按 Token 用量计费，无固定单次价",
    },
    {
        id: "glm-5.3",
        name: "glm-5.3",
        category: "text",
        vendor: "GLM",
        capability: "长程编程、智能体、复杂项目交付",
        spec: "OpenAI / Anthropic 兼容",
        priceText: "输入 ¥4.4 · 输出 ¥15.4",
        billingUnit: "元 / 1M Token",
        tokenInput: 4.4,
        tokenOutput: 15.4,
        sampleLabel: "按 Token 用量计费，无固定单次价",
    },
    {
        id: "deepseek-v4-pro-0813",
        name: "deepseek-v4-pro-0813",
        category: "text",
        vendor: "DeepSeek",
        capability: "推理、编程与复杂任务",
        spec: "OpenAI / Anthropic 兼容 · 分时计费",
        priceText: "输入 ¥4.95 · 输出 ¥14.85",
        billingUnit: "元 / 1M Token",
        tokenInput: 4.95,
        tokenOutput: 14.85,
        sampleLabel: "按 Token 用量计费，无固定单次价",
    },
    {
        id: "k3",
        name: "k3",
        category: "text",
        vendor: "Kimi",
        capability: "超大代码库、多文件重构、长文档；1M+ 上下文",
        spec: "OpenAI / Anthropic 兼容 · 支持图片与视频输入",
        priceText: "输入 ¥12 · 输出 ¥60 · 缓存 ¥1.2",
        billingUnit: "元 / 1M Token",
        tokenInput: 12,
        tokenOutput: 60,
        tokenCache: 1.2,
        sampleLabel: "按 Token 用量计费，无固定单次价",
    },
];

export const LL2_MODEL_COUNT = LL2_MODELS.length;
/** 写入影策用户渠道的模型名清单（与 /api/pricing 的 21 个模型一致）。 */
export const LL2_CHANNEL_MODELS = LL2_MODELS.map((model) => model.id);

export function ll2ModelById(id: string): LL2Model | undefined {
    const value = (id || "").trim();
    if (!value) return undefined;
    const exact = LL2_MODELS.find((model) => model.id === value || model.name === value);
    if (exact) return exact;
    // 影策把渠道 id 编码进选中的模型值时，取解码后的名称再匹配一次。
    const decoded = value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value;
    return LL2_MODELS.find((model) => model.id === decoded || model.name === decoded);
}

/** 人民币显示：内部计算用，小数不超过 4 位，去掉尾部多余的 0。 */
export function ll2FormatCNY(value: number): string {
    const fixed = Number.isFinite(value) ? value.toFixed(4) : "0";
    return fixed.replace(/\.?0+$/, "");
}

/**
 * C 端对客金额：不给用户看 ¥0.0417 这种四位小数。
 * 不到 1 分就说「不到 1 分钱」，其余按人民币最小单位「分」显示两位。
 */
export function ll2FriendlyCNY(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "¥0";
    if (value < 0.01) return "不到 1 分钱";
    return `¥${value.toFixed(2)}`;
}

export type LL2PriceEstimate = {
    amount: number;
    label: string;
    basis: string;
    model: LL2Model;
};

/**
 * 提交生成前的人民币预估。只做「按官网示例线性折算」或「最低档单价 × 秒数」，
 * 不编造实际扣费。文本模型返回 null，由调用方显示「按 Token 用量计费」。
 */
export function ll2EstimateCNY(modelId: string, seconds = 5): LL2PriceEstimate | null {
    const model = ll2ModelById(modelId);
    if (!model || model.category === "text") return null;
    const duration = Math.max(1, Number(seconds) || 5);
    let amount: number;
    let basis: string;
    if (typeof model.sampleCost === "number" && typeof model.sampleSeconds === "number") {
        amount = (model.sampleCost * duration) / model.sampleSeconds;
        basis = model.derived ? `按官网单价最低档 × ${duration}s 折算` : `按官网 ${model.sampleSeconds}s 示例价折算到 ${duration}s`;
    } else if (typeof model.perSecondMin === "number") {
        amount = model.perSecondMin * duration;
        basis = `按单价最低档 ¥${ll2FormatCNY(model.perSecondMin)}/秒 × ${duration}s`;
    } else {
        return null;
    }
    return {
        amount,
        label: amount < 0.01 ? "不到 1 分钱" : `约 ${ll2FriendlyCNY(amount)}`,
        basis: `${basis} · ${LL2_PRICE_DISCLAIMER}`,
        model,
    };
}

/** 模型广场用的实时清单核对：只取模型名 / 描述 / 协议，价格仍以本地快照为准。 */
export type LL2LivePricing = { model_name: string; description?: string; supported_endpoint_types?: string[] };

export async function fetchLL2LivePricing(signal?: AbortSignal): Promise<LL2LivePricing[]> {
    const response = await fetch(LL2_PRICING_API, { signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`DMC pricing HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: LL2LivePricing[] };
    return Array.isArray(payload.data) ? payload.data : [];
}

// 2026-11-19 14:30：用户口径「所有模型都能适配才可以」→ 解除只适配 2 个的限制。
// 14 个视频生成模型全部纳入：H3 走 /v2（content[] 契约），其余 13 个走
// /v1/video/generations（与上游 video-provider-newapi 同一套 model/prompt/seconds/
// aspect_ratio/resolution 字段）。auto-hd 是超分后处理、需要输入视频，不列入生成清单。
export const LL2_CONNECTED_VIDEO_MODELS = [
    "MiniMax-H3",
    "wan3.0-video",
    "wan3.0-video-prime",
    "doubao-seedance-2-0",
    "doubao-seedance-2-0-fast",
    "doubao-seedance-2-0-mini",
    "doubao-seedance-2-5",
    "viduq3-pro",
    "viduq3-turbo",
    "Super Vega 1.0-lite",
    "Super Vega 1.0-pro",
    "Super Vega 1.0-pro-fast",
    "Super Vega 1.0-pro-mini",
    "Super Vega 1.5-pro",
] as const;
export type LL2ConnectedVideoModel = (typeof LL2_CONNECTED_VIDEO_MODELS)[number];

export function ll2IsConnectedVideoModel(id: string): id is LL2ConnectedVideoModel {
    return (LL2_CONNECTED_VIDEO_MODELS as readonly string[]).includes((id || "").trim());
}

export type LL2VideoTier = { resolution: string; perSecond: number; label: string };

/**
 * 按清晰度的精确单价（元/秒）。
 * 来源：https://ll2.cn/api/pricing 的 billing_expr 计费系数 × 6.8
 * （倍率经 MiniMax-H3 / wan3.0-video / viduq3-pro 三处交叉验证）。
 * 档位与时长统一从 LL2_MODEL_SPECS 派生（见文件末尾），避免两份清单漂移。
 */

export function ll2TiersFor(modelId: LL2ConnectedVideoModel): LL2VideoTier[] {
    return LL2_VIDEO_TIERS[modelId] || [];
}

export function ll2TierFor(modelId: LL2ConnectedVideoModel, resolution: string): LL2VideoTier {
    const tiers = ll2TiersFor(modelId);
    return tiers.find((tier) => tier.resolution.toLowerCase() === String(resolution || "").trim().toLowerCase()) || tiers[0];
}

/** 按所选清晰度 × 秒数的精确预估，用于提交前显示「本次预计 ¥X」。 */
export function ll2PreciseCNY(modelId: LL2ConnectedVideoModel, seconds: number, resolution: string) {
    const tier = ll2TierFor(modelId, resolution);
    const duration = Math.max(1, Number(seconds) || 5);
    // 豆包四款按 Token 计费，没有「元/秒」单价；算不出来就必须说实话，
    // 不能因为 perSecond=0 就显示「不到 1 分钱」。
    if (ll2IsTokenBilled(modelId)) {
        const spec = ll2SpecFor(modelId);
        return {
            amount: 0,
            label: "按 Token 计费",
            perSecond: 0,
            resolution: tier?.resolution || "",
            basis: `${spec?.unit || "按 Token 用量"} · 官网未标注固定时长，提交前算不出确定金额，以控制台账单为准`,
        };
    }
    const amount = tier.perSecond * duration;
    return {
        amount,
        label: amount < 0.01 ? "不到 1 分钱" : `约 ${ll2FriendlyCNY(amount)}`,
        perSecond: tier.perSecond,
        resolution: tier.resolution,
        basis: `${tier.label} ¥${ll2FormatCNY(tier.perSecond)}/秒 × ${duration} 秒 · ${LL2_PRICE_DISCLAIMER}`,
    };
}

/** 按任务返回的 usage 秒数换算实付，用于出片后显示。 */
export function ll2ActualCNY(modelId: LL2ConnectedVideoModel, seconds: number, resolution: string) {
    const precise = ll2PreciseCNY(modelId, seconds, resolution);
    // 豆包四款按 Token 计费，perSecond=0：套下面那条公式会显示「实付 ¥0」，等于骗人。
    // 直接把预估里的「按 Token 计费」口径带出来，金额以控制台账单为准。
    if (ll2IsTokenBilled(modelId)) {
        return { ...precise, label: "按 Token 计费", basis: `按 Token 用量计费 · ${precise.basis}` };
    }
    return {
        ...precise,
        label: `¥${ll2FormatCNY(precise.amount)}`,
        basis: `${precise.resolution} ¥${ll2FormatCNY(precise.perSecond)}/秒 × ${seconds} 秒（按 LL2 返回的成片秒数，账单以控制台为准）`,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2026-11-17 21:24：全量接入 + 分级适配
//
// 用户口径：「把所有模型都接上，然后适配一下 H3 和 wan3，其他的先不要动」。
//   adapted —— 完成端点 / 轮询 / 分档价 / usage 实付的全链路适配，创作台可直接生成；
//   generic —— 已挂进 DMC 渠道，可被选中与调用，但不写任何专门协议代码，
//              走影策通用 openai-video / chat 协议，价格只展示官网快照。
// 也就是说：接入范围 = 21 个（含官网实时新增），适配范围 = 2 个，两者不再混为一谈。
// ─────────────────────────────────────────────────────────────────────────────

export type LL2ConnectionLevel = "adapted" | "generic";

/** 已完成协议适配的模型（与 LL2_CONNECTED_VIDEO_MODELS 同一个清单，语义更明确）。 */
export const LL2_ADAPTED_VIDEO_MODELS = LL2_CONNECTED_VIDEO_MODELS;
export const LL2_ADAPTED_COUNT = LL2_ADAPTED_VIDEO_MODELS.length;

export function ll2ConnectionLevel(id: string): LL2ConnectionLevel {
    return ll2IsConnectedVideoModel(id) ? "adapted" : "generic";
}

/**
 * 按协议分两个渠道挂，避免把文本模型塞进 openai-video 渠道后误走视频端点：
 *   视频 / 超分 15 个 -> newapi-channel-2（/v1/video/generations 协议）
 *   文本 6 个        -> OpenAI chat completions（interfaceType 留空）
 */
export const LL2_VIDEO_CHANNEL_MODELS = LL2_CHANNEL_MODELS.filter((id) => ll2ModelById(id)?.category !== "text");
export const LL2_TEXT_CHANNEL_MODELS = LL2_CHANNEL_MODELS.filter((id) => ll2ModelById(id)?.category === "text");

export type LL2ChannelModelGroups = {
    all: string[];
    video: string[];
    text: string[];
    /** 官网 /api/pricing 里出现、本地价格快照还没有的模型名。 */
    added: string[];
};

/**
 * 把官网实时清单并入渠道名单：官网以后上架的模型也会自动「接上」，不用再改代码。
 * 本地快照负责顺序与价格口径；新增模型只挂名字，绝不编造单价。
 * 分组依据 /api/pricing 的 supported_endpoint_types：带 openai-video 的进视频渠道，
 * 带 anthropic 且不带 openai-video 的进文本渠道，其余默认视频渠道（DMC 以视频为主）。
 */
export function ll2MergeLiveModels(live: LL2LivePricing[] = []): LL2ChannelModelGroups {
    const video = [...LL2_VIDEO_CHANNEL_MODELS];
    const text = [...LL2_TEXT_CHANNEL_MODELS];
    const known = new Set<string>(LL2_CHANNEL_MODELS);
    const added: string[] = [];
    for (const item of live || []) {
        const name = String(item?.model_name || "").trim();
        if (!name || known.has(name)) continue;
        known.add(name);
        added.push(name);
        const endpoints = (item.supported_endpoint_types || []).map((value) => String(value).toLowerCase());
        const isText = !endpoints.includes("openai-video") && endpoints.includes("anthropic");
        (isText ? text : video).push(name);
    }
    return { all: [...video, ...text], video, text, added };
}

/** 给 UI 用的一句话接入摘要。 */
export function ll2ConnectionSummary(live: LL2LivePricing[] = []) {
    const groups = ll2MergeLiveModels(live);
    return {
        connected: groups.all.length,
        adapted: LL2_ADAPTED_COUNT,
        generic: groups.all.length - LL2_ADAPTED_COUNT,
        added: groups.added.length,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2026-11-17 23:59 用户口径：「查看所有模型的文档，把分辨率、价格、时间等信息
// 都写清楚，这样客户才知道一共花了多少钱」。
//
// 数据源：https://ll2.cn/api/pricing 的 description（分辨率与时长原文）+
// billing_expr 的每一个 tier（逐档单价）。内部系数 × 6.8 换算成人民币，
// 倍率用 H3 / wan3 / viduq3-pro 三处官网展示价交叉验证过。
// 官网 description 没写固定时长的，如实写「未标注」，不编造秒数。
// ─────────────────────────────────────────────────────────────────────────────

export type LL2PriceTier = {
    /** 档位名：分辨率，或文本模型的「输入 / 输出 / 缓存命中」。 */
    label: string;
    /** 元 / 成片秒数。 */
    perSecond?: number;
    /** 元 / 1M Token。 */
    perMillionTokens?: number;
    note?: string;
};

export type LL2ModelSpec = {
    /** 支持的分辨率档位。 */
    resolutions: string;
    /** 支持时长或计费时长口径。 */
    duration: string;
    /** 计费单位。 */
    unit: string;
    /** 官网明确写出时长上下限时才有，用于算价器限制可选秒数。 */
    secondsMin?: number;
    secondsMax?: number;
    tiers: LL2PriceTier[];
};

export const LL2_MODEL_SPECS: Record<string, LL2ModelSpec> = {
    "MiniMax-H3": { resolutions: "768P（固定）", duration: "1–15 秒", unit: "按成片秒数", secondsMin: 1, secondsMax: 15, tiers: [
        { label: "768P", perSecond: 0.05 },
    ] },
    "wan3.0-video": { resolutions: "480P / 720P / 1080P", duration: "2–30 秒", unit: "按成片秒数", secondsMin: 2, secondsMax: 30, tiers: [
        { label: "480P", perSecond: 0.132 },
        { label: "720P", perSecond: 0.264 },
        { label: "1080P", perSecond: 0.528 },
    ] },
    "wan3.0-video-prime": { resolutions: "480P / 720P / 1080P", duration: "2–30 秒", unit: "按成片秒数", secondsMin: 2, secondsMax: 30, tiers: [
        { label: "480P", perSecond: 0.234 },
        { label: "720P", perSecond: 0.468 },
        { label: "1080P", perSecond: 0.936 },
    ] },
    "auto-hd": { resolutions: "720p / 1080p / 2K / 4K", duration: "按成片实际秒数（超分后处理）", unit: "按成片秒数", tiers: [
        { label: "720p", perSecond: 0.008333 },
        { label: "1080p", perSecond: 0.015 },
        { label: "2k", perSecond: 0.026667 },
        { label: "4k", perSecond: 0.06 },
    ] },
    "viduq3-pro": { resolutions: "540p / 720p / 1080p", duration: "官网未标注固定时长；按成片秒数", unit: "按成片秒数", tiers: [
        { label: "540p", perSecond: 0.193125 },
        { label: "720p", perSecond: 0.482812 },
        { label: "1080p", perSecond: 0.579375 },
    ] },
    "viduq3-turbo": { resolutions: "540p / 720p / 1080p", duration: "官网未标注固定时长；按成片秒数", unit: "按成片秒数", tiers: [
        { label: "540p", perSecond: 0.1545 },
        { label: "720p", perSecond: 0.23175 },
        { label: "1080p", perSecond: 0.270375 },
    ] },
    "doubao-seedance-2-0": { resolutions: "480p / 720p / 1080p / 4K", duration: "官网未标注固定时长；按 Token 用量", unit: "元 / 1M Token", tiers: [
        { label: "480p", perMillionTokens: 36.0088, note: "无参考视频；有参考视频另计" },
        { label: "720p", perMillionTokens: 36.0088, note: "无参考视频；有参考视频另计" },
        { label: "1080p", perMillionTokens: 39.9228, note: "无参考视频；有参考视频另计" },
        { label: "4k", perMillionTokens: 20.3528, note: "无参考视频；有参考视频另计" },
    ] },
    "doubao-seedance-2-0-fast": { resolutions: "480p / 720p", duration: "官网未标注固定时长；按 Token 用量", unit: "元 / 1M Token", tiers: [
        { label: "480p", perMillionTokens: 27.0581, note: "无参考视频；有参考视频另计" },
        { label: "720p", perMillionTokens: 27.0581, note: "无参考视频；有参考视频另计" },
    ] },
    "doubao-seedance-2-0-mini": { resolutions: "480p / 720p", duration: "官网未标注固定时长；按 Token 用量", unit: "元 / 1M Token", tiers: [
        { label: "480p", perMillionTokens: 14.4509, note: "无参考视频；有参考视频另计" },
        { label: "720p", perMillionTokens: 14.4509, note: "无参考视频；有参考视频另计" },
    ] },
    "doubao-seedance-2-5": { resolutions: "480p / 720p / 1080p", duration: "官网未标注固定时长；按 Token 用量", unit: "元 / 1M Token", tiers: [
        { label: "480p", perMillionTokens: 56.959, note: "无参考视频；有参考视频另计" },
        { label: "720p", perMillionTokens: 56.959, note: "无参考视频；有参考视频另计" },
        { label: "1080p", perMillionTokens: 62.6549, note: "无参考视频；有参考视频另计" },
    ] },
    "Super Vega 1.0-lite": { resolutions: "480P / 720P / 768P / 1080P / 2K / 4K", duration: "按输入+输出实际秒数", unit: "复合：输入秒 + 输出秒 + 图片超额", tiers: [
        { label: "480P", perSecond: 0.24651 },
        { label: "720P", perSecond: 0.31125 },
        { label: "768P", perSecond: 0.31125 },
        { label: "1080P", perSecond: 0.415 },
        { label: "2K", perSecond: 0.51875 },
        { label: "4K", perSecond: 0.6225 },
    ] },
    "Super Vega 1.0-pro": { resolutions: "480P / 720P / 768P / 1080P / 2K / 4K", duration: "按输入+输出实际秒数", unit: "复合：输入秒 + 输出秒 + 图片超额", tiers: [
        { label: "480P", perSecond: 0.342619 },
        { label: "720P", perSecond: 0.65508 },
        { label: "768P", perSecond: 0.65508 },
        { label: "1080P", perSecond: 1.42552 },
        { label: "2K", perSecond: 3.5432 },
        { label: "4K", perSecond: 4.0376 },
    ] },
    "Super Vega 1.0-pro-fast": { resolutions: "480P / 720P / 768P / 1080P / 2K / 4K", duration: "按输入+输出实际秒数", unit: "复合：输入秒 + 输出秒 + 图片超额", tiers: [
        { label: "480P", perSecond: 0.27805 },
        { label: "720P", perSecond: 0.53535 },
        { label: "768P", perSecond: 0.53535 },
        { label: "1080P", perSecond: 1.162 },
        { label: "2K", perSecond: 1.2782 },
        { label: "4K", perSecond: 1.40602 },
    ] },
    "Super Vega 1.0-pro-mini": { resolutions: "480P / 720P / 768P / 1080P / 2K / 4K", duration: "按输入+输出实际秒数", unit: "复合：输入秒 + 输出秒 + 图片超额", tiers: [
        { label: "480P", perSecond: 0.17347 },
        { label: "720P", perSecond: 0.34196 },
        { label: "768P", perSecond: 0.34196 },
        { label: "1080P", perSecond: 0.747 },
        { label: "2K", perSecond: 0.8217 },
        { label: "4K", perSecond: 0.90387 },
    ] },
    "Super Vega 1.5-pro": { resolutions: "480P / 720P / 768P / 1080P / 2K / 4K", duration: "按输入+输出实际秒数", unit: "复合：输入秒 + 输出秒 + 图片超额", tiers: [
        { label: "480P", perSecond: 0.499097 },
        { label: "720P", perSecond: 0.979159 },
        { label: "768P", perSecond: 0.979159 },
        { label: "1080P", perSecond: 2.131441 },
        { label: "2K", perSecond: 5.24888 },
        { label: "4K", perSecond: 5.773768 },
    ] },
    "glm-5.3-flash": { resolutions: "—（文本模型）", duration: "按 Token 用量，无固定时长", unit: "元 / 1M Token", tiers: [
        { label: "输入", perMillionTokens: 0.44 },
        { label: "输出", perMillionTokens: 1.54 },
    ] },
    "deepseek-v4.1-flash": { resolutions: "—（文本模型）", duration: "按 Token 用量，无固定时长", unit: "元 / 1M Token", tiers: [
        { label: "输入", perMillionTokens: 0.88 },
        { label: "输出", perMillionTokens: 3.52 },
    ] },
    "deepseek-v4-flash-0731": { resolutions: "—（文本模型）", duration: "按 Token 用量，无固定时长", unit: "元 / 1M Token", tiers: [
        { label: "输入", perMillionTokens: 1.65 },
        { label: "输出", perMillionTokens: 4.95 },
    ] },
    "glm-5.3": { resolutions: "—（文本模型）", duration: "按 Token 用量，无固定时长", unit: "元 / 1M Token", tiers: [
        { label: "输入", perMillionTokens: 4.4 },
        { label: "输出", perMillionTokens: 15.4 },
    ] },
    "deepseek-v4-pro-0813": { resolutions: "—（文本模型）", duration: "按 Token 用量，无固定时长", unit: "元 / 1M Token", tiers: [
        { label: "输入", perMillionTokens: 4.95 },
        { label: "输出", perMillionTokens: 14.85 },
    ] },
    "k3": { resolutions: "—（文本模型）", duration: "按 Token 用量，无固定时长", unit: "元 / 1M Token", tiers: [
        { label: "输入", perMillionTokens: 12 },
        { label: "输出", perMillionTokens: 60 },
        { label: "缓存命中", perMillionTokens: 1.2 },
    ] },
};

/**
 * 档位与时长直接从 LL2_MODEL_SPECS 派生。
 * 放在 SPECS 之后定义（而不是各自手写一份），新增模型时只改 SPECS 一处。
 */
export const LL2_VIDEO_TIERS = Object.fromEntries(
    LL2_CONNECTED_VIDEO_MODELS.map((id) => [
        id,
        (LL2_MODEL_SPECS[id]?.tiers || []).map((tier) => ({
            resolution: tier.label,
            // Token 计费的模型没有 perSecond（豆包四款），这里留 0，算价时另走 Token 分支。
            perSecond: typeof tier.perSecond === "number" ? tier.perSecond : 0,
            label: tier.label,
        })),
    ]),
) as Record<LL2ConnectedVideoModel, LL2VideoTier[]>;

export const LL2_VIDEO_DURATION = Object.fromEntries(
    LL2_CONNECTED_VIDEO_MODELS.map((id) => {
        const spec = LL2_MODEL_SPECS[id];
        // 官网没标注固定时长的模型（viduq3 / 豆包）按 1–15 秒给可选范围，
        // 真正能不能出由网关判定，前端不假装知道更多。
        const min = spec?.secondsMin ?? 1;
        const max = spec?.secondsMax ?? 15;
        return [id, { min, max, default: Math.min(5, max) }];
    }),
) as Record<LL2ConnectedVideoModel, { min: number; max: number; default: number }>;

/** 这个模型是不是按 Token 计费（没有「元/秒」单价，无法在提交前精确预估）。 */
export function ll2IsTokenBilled(modelId: string): boolean {
    const tiers = LL2_MODEL_SPECS[modelId]?.tiers || [];
    return tiers.length > 0 && tiers.every((tier) => typeof tier.perSecond !== "number");
}

export function ll2SpecFor(modelId: string): LL2ModelSpec | undefined {
    return LL2_MODEL_SPECS[modelId];
}

/** 档位单价展示，保留官网换算后的有效位数，不把 0.008333 压成 0.0083。 */
export function ll2TierPriceText(tier: LL2PriceTier): string {
    const num = (value: number) => Number(value.toFixed(6)).toString();
    if (typeof tier.perSecond === "number") return `¥${num(tier.perSecond)} / 秒`;
    if (typeof tier.perMillionTokens === "number") return `¥${num(tier.perMillionTokens)} / 1M Token`;
    return "按用量计费";
}

/** 按「档位 × 秒数」算一共多少钱；Token 计费的模型不适用，返回 null。 */
export function ll2TierTotalCNY(modelId: string, tierLabel: string, seconds: number): number | null {
    const tier = LL2_MODEL_SPECS[modelId]?.tiers.find((item) => item.label === tierLabel);
    if (!tier || typeof tier.perSecond !== "number") return null;
    return tier.perSecond * Math.max(1, Number(seconds) || 1);
}
