import { normalizeCreativeStyleBible, type CreativeStyleBible } from "@/lib/creation/creative-style-plan";

export type SmartCreationPlatform = "amazon" | "pinduoduo" | "tiktok_shop" | "shopify" | "generic" | "unknown";
export type SmartCreationMarket = string;

export type SmartCreationTaskPurpose = "hero" | "bullet" | "scene" | "detail" | "text" | "custom";

export type SmartCreationTaskSettings = {
    model?: string;
    size: string;
    aspectRatio: string;
    quality: string;
    count: number;
};

export type SmartCreationTask = {
    itemId: string;
    kind?: "image" | "video" | "text";
    purpose: SmartCreationTaskPurpose;
    title: string;
    prompt: string;
    targetLanguage?: string;
    referenceIds?: string[];
    targetCopy?: string;
    zhReviewCopy?: string;
    dependencies?: string[];
    settings: SmartCreationTaskSettings;
    compliance: string[];
};

export type SmartCreationPlan = {
    planVersion: "1" | "2";
    planId?: string;
    version?: number;
    intent: string;
    targetPlatform: SmartCreationPlatform;
    targetMarket: SmartCreationMarket;
    targetLanguage: string;
    attachments?: { resourceId: string; role: "product" | "person" | "reference" | "competitor" | "style" | "source" }[];
    productFacts?: { id: string; claim: string; sourceIds: string[] }[];
    /** 套图级视觉指导，供每张图复用以保持商业质感和产品一致性。 */
    visualDirection?: string;
    /** 结构化风格锁：宿主编译进每张图的提示词，指纹用于同批次一致性追踪。 */
    styleBible?: CreativeStyleBible;
    platformRules: string[];
    tasks: SmartCreationTask[];
    /** 仅用于真正阻塞生成的最小追问；每轮最多一个。 */
    questions: string[];
    /** Agent 已采用的默认，不应被宿主展示为确认问题。 */
    assumptions: string[];
};

export type SmartCreationPlanInput = {
    intent: string;
    targetModel?: string;
};

const AMAZON_RULES = [
    "明确要求主图时才使用纯白背景；用户要求不要白底时，所有附图都不得使用纯白背景",
    "卖点图只使用参考素材或用户明确提供的事实",
    "平台目标尺寸必须先与当前图片模型能力归一化",
];

const DEFAULT_AMAZON_VISUAL_DIRECTION = "高级商业产品摄影与品牌橱窗陈列；保持产品身份、外观比例、材质和颜色一致；使用受控的主光、轮廓光和柔和阴影，精致材质纹理、克制道具、明确视觉层级、留白和高级色彩关系；每张图像像经过艺术指导的 Amazon showroom campaign，而不是普通生活方式快照、杂乱桌面或廉价库存图";

export const SMART_CREATION_PLATFORMS = ["amazon", "pinduoduo", "tiktok_shop", "shopify", "generic", "unknown"] as const satisfies readonly SmartCreationPlatform[];
export const SMART_CREATION_KNOWN_MARKETS = ["US", "UK", "DE", "JP", "CA", "FR", "IT", "ES", "AU", "IN", "NL", "SE", "PL"] as const;

export type SmartCreationPlatformDefaults = {
    /** 模型没有给出站点、且无法从意图推断时采用的市场。 */
    market?: string;
    /** 模型没有给出 visualDirection 时补齐的整套视觉指导。 */
    visualDirection?: string;
    /** 模型没有给出 platformRules 时补齐的平台规则。 */
    platformRules: string[];
};

/** 计划解析时由宿主补齐的默认值；插件包可通过 contributes.smartCreation.defaults 覆盖。 */
export type SmartCreationPlanDefaults = {
    taskSettings: { size: string; aspectRatio: string; quality: string };
    platforms: Partial<Record<SmartCreationPlatform, SmartCreationPlatformDefaults>>;
};

export const DEFAULT_SMART_CREATION_PLAN_DEFAULTS: SmartCreationPlanDefaults = {
    taskSettings: { size: "auto", aspectRatio: "1:1", quality: "auto" },
    platforms: {
        amazon: { visualDirection: DEFAULT_AMAZON_VISUAL_DIRECTION, platformRules: AMAZON_RULES },
    },
};

function inferMarket(input: string): SmartCreationMarket {
    if (/日本|日站|amazon\.co\.jp|\bJP\b/i.test(input)) return "JP";
    if (/加拿大|加站|amazon\.ca|\bCA\b/i.test(input)) return "CA";
    if (/法国|法站|amazon\.fr|\bFR\b/i.test(input)) return "FR";
    if (/意大利|意站|amazon\.it|\bIT\b/i.test(input)) return "IT";
    if (/西班牙|西站|amazon\.es|\bES\b/i.test(input)) return "ES";
    if (/澳大利亚|澳站|amazon\.com\.au|\bAU\b/i.test(input)) return "AU";
    if (/印度|印站|amazon\.in|\bIN\b/i.test(input)) return "IN";
    if (/德国|德站|amazon\.de|\bDE\b/i.test(input)) return "DE";
    if (/英国|英站|amazon\.co\.uk|\bUK\b/i.test(input)) return "UK";
    if (/美国|美站|amazon\.com|\bUS\b/i.test(input)) return "US";
    return "UNKNOWN";
}

function inferPlatform(input: string): SmartCreationPlatform {
    if (/亚马逊|amazon/i.test(input)) return "amazon";
    if (/拼多多|pinduoduo|\bPDD\b/i.test(input)) return "pinduoduo";
    if (/tiktok\s*shop|抖音小店|TikTok 店/i.test(input)) return "tiktok_shop";
    if (/shopify/i.test(input)) return "shopify";
    return "generic";
}

function inferLanguage(market: SmartCreationMarket, input: string) {
    if (/(?:目标语言|画面文案|图片文案).{0,8}(?:中文|汉语|简体中文)/i.test(input)) return "zh-CN";
    if (/(?:目标语言|画面文案|图片文案).{0,8}(?:日文|日本語)/i.test(input)) return "ja-JP";
    if (market === "DE") return "de-DE";
    if (market === "US") return "en-US";
    if (market === "UK") return "en-GB";
    if (market === "JP") return "ja-JP";
    if (market === "FR") return "fr-FR";
    if (market === "IT") return "it-IT";
    if (market === "ES") return "es-ES";
    if (market === "CA" || market === "AU" || market === "IN") return "en-" + market;
    return "und";
}

function inferCount(input: string) {
    const match = input.match(/(?:做|生成|制作|需要|共|套图[^\d两二三四五六七八九十]{0,4}|^|[，,\s])\s*(\d+|两|二|三|四|五|六|七|八|九|十)\s*(?:张|个|幅|张图)?/i)?.[1];
    const numeric = match ? ({ 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[match] || Number(match)) : 1;
    return Math.max(1, Math.min(12, numeric || 1));
}

function purposeForIndex(input: string, index: number) {
    if (index === 0 || /主图/.test(input) && index === 0) return "hero" as const;
    if (/卖点/.test(input) && index === 1) return "bullet" as const;
    if (/场景/.test(input) && index === 1) return "scene" as const;
    if (/细节|尺寸/.test(input) && index === 1) return "detail" as const;
    return ["bullet", "scene", "detail"][Math.min(index - 1, 2)] as SmartCreationTaskPurpose;
}

function purposeTitle(purpose: SmartCreationTaskPurpose, index: number) {
    if (purpose === "hero") return "主图";
    if (purpose === "bullet") return `卖点图${index}`;
    if (purpose === "scene") return `场景图${index - 1}`;
    if (purpose === "detail") return `细节图${index - 2}`;
    return `创作图${index}`;
}

/**
 * 构造可供测试、预览和模型结果校验使用的最小计划。
 * 真实 Agent 执行时必须使用文本模型返回的结构化计划；模型失败不能静默调用此函数冒充规划结果。
 */
export function createSmartCreationPlan(input: SmartCreationPlanInput): SmartCreationPlan {
    const intent = input.intent.trim();
    const targetMarket = inferMarket(intent);
    const targetPlatform = inferPlatform(intent);
    const targetLanguage = inferLanguage(targetMarket, intent);
    const count = inferCount(intent);
    const tasks = Array.from({ length: count }, (_, index) => {
        const purpose = purposeForIndex(intent, index);
        return {
            itemId: `smart-creation:${purpose}:${index + 1}`,
            purpose,
            title: purposeTitle(purpose, index + 1),
            prompt: intent,
            targetLanguage,
            settings: { model: input.targetModel, size: "1600x1600", aspectRatio: "1:1", quality: "auto", count: 1 as const },
            compliance: targetPlatform === "amazon" ? AMAZON_RULES : [],
        } satisfies SmartCreationTask;
    });
    return {
        planVersion: "1",
        intent,
        targetPlatform,
        targetMarket,
        targetLanguage,
        ...(targetPlatform === "amazon" ? { visualDirection: DEFAULT_AMAZON_VISUAL_DIRECTION } : {}),
        platformRules: targetPlatform === "amazon" ? AMAZON_RULES : [],
        tasks,
        questions: targetMarket === "UNKNOWN" && targetPlatform === "amazon" ? ["请告诉我目标 Amazon 站点"] : [],
        assumptions: [],
    };
}

export function parseSmartCreationPlan(content: string, defaults: SmartCreationPlanDefaults = DEFAULT_SMART_CREATION_PLAN_DEFAULTS): SmartCreationPlan {
    const candidate = content.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const value = JSON.parse(candidate) as Partial<SmartCreationPlan>;
    if ((value.planVersion !== "1" && value.planVersion !== "2") || !value.intent?.trim() || !Array.isArray(value.tasks) || value.tasks.length === 0) {
        throw new Error("智能创作 Agent 返回的计划不完整");
    }
    const intent = value.intent.trim();
    const targetPlatform: SmartCreationPlatform = SMART_CREATION_PLATFORMS.includes(value.targetPlatform as SmartCreationPlatform)
        ? value.targetPlatform as SmartCreationPlatform
        : typeof value.targetPlatform === "string" ? "unknown" : inferPlatform(intent);
    const platformDefaults = defaults.platforms[targetPlatform];
    const inferredMarket = inferMarket(intent);
    const suppliedMarket = typeof value.targetMarket === "string" ? value.targetMarket.trim().toUpperCase() : "";
    const targetMarket: SmartCreationMarket = /^[A-Z]{2}$/.test(suppliedMarket) ? suppliedMarket
        : inferredMarket !== "UNKNOWN" ? inferredMarket : "UNKNOWN";
    const targetLanguage = value.targetLanguage?.trim() || inferLanguage(targetMarket, intent);
    const visualDirection = typeof value.visualDirection === "string" && value.visualDirection.trim() ? value.visualDirection.trim() : undefined;
    const platformRules = Array.isArray(value.platformRules) ? value.platformRules.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : platformDefaults?.platformRules ?? [];
    const styleBible = normalizeCreativeStyleBible((value as { styleBible?: unknown }).styleBible);
    const questions = (Array.isArray(value.questions) ? value.questions : [])
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, 1);
    const assumptions = Array.isArray(value.assumptions)
        ? value.assumptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
    const attachments = Array.isArray(value.attachments) ? value.attachments.filter((item) => item && typeof item.resourceId === "string" && ["product", "person", "reference", "competitor", "style", "source"].includes(item.role)) : [];
    const attachmentRoles = new Map(attachments.map((item) => [item.resourceId, item.role]));
    const productFacts = Array.isArray(value.productFacts) ? value.productFacts : [];
    if (value.planVersion === "2" && (!value.planId?.trim() || !Number.isInteger(value.version) || (value.version ?? 0) < 1)) throw new Error("计划缺少稳定版本标识");
    for (const fact of productFacts) {
        if (!fact?.id?.trim() || !fact.claim?.trim() || !Array.isArray(fact.sourceIds) || !fact.sourceIds.length) throw new Error("产品事实缺少证据来源");
        if (fact.sourceIds.some((id) => id === "user:prompt" ? !intent.includes(fact.claim) : !attachmentRoles.has(id) || attachmentRoles.get(id) === "competitor" || attachmentRoles.get(id) === "style" || attachmentRoles.get(id) === "reference")) throw new Error("竞品或风格素材不能作为产品事实来源");
    }
    const itemIds = new Set(value.tasks.map((task) => task.itemId));
    if (itemIds.size !== value.tasks.length) throw new Error("计划任务 ID 不得重复");
    const tasks = value.tasks.map((task) => {
        const candidateTask = task as Partial<SmartCreationTask>;
        const rawSettings = candidateTask.settings && typeof candidateTask.settings === "object" ? candidateTask.settings as Partial<SmartCreationTaskSettings> : {};
        const validPurpose = candidateTask.purpose === "hero" || candidateTask.purpose === "bullet" || candidateTask.purpose === "scene" || candidateTask.purpose === "detail" || candidateTask.purpose === "text" || candidateTask.purpose === "custom";
        if (!candidateTask.itemId?.trim() || !validPurpose || !candidateTask.title?.trim() || !candidateTask.prompt?.trim()) {
            throw new Error("智能创作 Agent 返回的任务缺少创作用途或提示词");
        }
        if (value.planVersion === "2" && (typeof candidateTask.targetCopy !== "string" || typeof candidateTask.zhReviewCopy !== "string")) throw new Error("每项交付须含目标文案和中文审核对照");
        if (candidateTask.referenceIds?.some((id) => !attachmentRoles.has(id))) throw new Error("任务引用了未授权素材");
        if (candidateTask.dependencies?.some((id) => id === candidateTask.itemId || !itemIds.has(id))) throw new Error("任务依赖无效");
        const count = rawSettings.count === undefined ? 1 : rawSettings.count;
        if (typeof count !== "number" || !Number.isInteger(count) || count < 1) throw new Error("智能创作 Agent 返回的数量必须是有效生成数量");
        return {
            itemId: candidateTask.itemId.trim(),
            purpose: candidateTask.purpose as SmartCreationTaskPurpose,
            title: candidateTask.title.trim(),
            prompt: candidateTask.prompt.trim(),
            ...(candidateTask.kind ? { kind: candidateTask.kind } : {}),
            ...(typeof candidateTask.targetCopy === "string" ? { targetCopy: candidateTask.targetCopy } : {}),
            ...(typeof candidateTask.zhReviewCopy === "string" ? { zhReviewCopy: candidateTask.zhReviewCopy } : {}),
            ...(Array.isArray(candidateTask.dependencies) ? { dependencies: candidateTask.dependencies } : {}),
            ...(typeof candidateTask.targetLanguage === "string" && candidateTask.targetLanguage.trim() ? { targetLanguage: candidateTask.targetLanguage.trim() } : {}),
            ...(Array.isArray(candidateTask.referenceIds) ? { referenceIds: candidateTask.referenceIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0) } : {}),
            settings: {
                ...(typeof rawSettings.model === "string" && rawSettings.model.trim() ? { model: rawSettings.model.trim() } : {}),
                size: typeof rawSettings.size === "string" && rawSettings.size.trim() ? rawSettings.size.trim() : defaults.taskSettings.size,
                aspectRatio: typeof rawSettings.aspectRatio === "string" && rawSettings.aspectRatio.trim() ? rawSettings.aspectRatio.trim() : defaults.taskSettings.aspectRatio,
                quality: typeof rawSettings.quality === "string" && rawSettings.quality.trim() ? rawSettings.quality.trim() : defaults.taskSettings.quality,
                count,
            },
            compliance: Array.isArray(candidateTask.compliance) ? candidateTask.compliance.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
        };
    });
    return {
        planVersion: value.planVersion,
        ...(value.planVersion === "2" ? { planId: value.planId, version: value.version, attachments, productFacts } : {}),
        intent,
        targetPlatform,
        targetMarket,
        targetLanguage,
        ...(visualDirection || platformDefaults?.visualDirection ? { visualDirection: visualDirection || platformDefaults?.visualDirection } : {}),
        ...(styleBible ? { styleBible } : {}),
        platformRules,
        tasks,
        questions,
        assumptions,
    };
}
