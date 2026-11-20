import { commercePlatformGroups, labelOf, platforms } from "./catalog";
import { commerceKnowledgeFor, commerceKnowledgePrompt } from "./platform-knowledge";

/**
 * Platform design language shared by the planner prompt and the image prompt.
 * It only steers layout, UI and tone; fact boundaries never change per platform,
 * and current listing rules must still be checked against official guidelines.
 */
export type CommercePlatformFamilyId = "xiaohongshu" | "short-video" | "flagship" | "value" | "wholesale" | "domestic-specialty" | "wechat" | "listing" | "brand-site" | "mobile-global" | "general";
export type CommercePlatformFamily = { id: CommercePlatformFamilyId; market: "domestic" | "cross-border"; label: string };

const familyOf: Record<string, CommercePlatformFamilyId> = {
    xiaohongshu: "xiaohongshu",
    douyin: "short-video",
    kuaishou: "short-video",
    taobao: "flagship",
    tmall: "flagship",
    jd: "flagship",
    pdd: "value",
    "1688": "wholesale",
    alibaba: "wholesale",
    dhgate: "wholesale",
    vipshop: "domestic-specialty",
    dewu: "domestic-specialty",
    aikucun: "domestic-specialty",
    railway: "domestic-specialty",
    "wechat-shop": "wechat",
    "video-shop": "wechat",
    amazon: "listing",
    ebay: "listing",
    walmart: "listing",
    aliexpress: "listing",
    "mercado-libre": "listing",
    wayfair: "listing",
    noon: "listing",
    emag: "listing",
    coupang: "listing",
    shopify: "brand-site",
    shein: "brand-site",
    etsy: "brand-site",
    tiktok: "mobile-global",
    temu: "mobile-global",
    shopee: "mobile-global",
    lazada: "mobile-global",
    ozon: "mobile-global",
    wildberries: "mobile-global",
    rakuten: "mobile-global",
    "11street": "mobile-global",
};

const familyProfiles: Record<CommercePlatformFamilyId, { name: string; strategy: string; image: string }> = {
    xiaohongshu: {
        name: "种草笔记",
        strategy:
            "画面要像一篇真实的小红书笔记，而不是货架硬广：默认按 3:4 竖版构图（用户已选比例优先）；首图做笔记封面，用醒目的大字标题写口语化的场景句或结果句，可配手写批注、便签纸、贴纸、圈注箭头、胶带等笔记感 UI；整体偏低饱和胶片色或奶油色调（已选风格另有色板时以风格为准），自然光与真实生活方式场景（居家、桌面、通勤、出游、餐桌）；人物用素人感的真实用户形象（自然妆发、生活化姿态，可只露手部或半身），不做棚拍明星感；多图像一组笔记轮播，轮换开箱、前后或多款对比、清单合集、步骤教程、使用心得等结构；不做价格爆炸贴、促销横幅和“全网最低”式硬广，不伪造用户评价、点赞数据或博主身份。",
        image: "真实生活方式的笔记感：自然光、低饱和胶片或奶油色调、素人感人物与生活化道具；允许文字时用笔记语言排版（大字标题、手写批注、便签、贴纸、圈注箭头），不做促销横幅和价格爆炸贴等硬广元素。",
    },
    "short-video": {
        name: "短视频电商",
        strategy:
            "按刷短视频的节奏抓眼：首图用强钩子大字标题（短、口语、直击一个痛点或结果），高对比配色与强明暗，动感斜切构图、对角色块、爆炸贴、放射线或速度线等动态 UI；人物表情和动作要强（惊喜、上手演示、前后反差），像短视频封面或直播间截帧；商品大而近，每张只打 1–3 个直给卖点；直播氛围只作视觉语言，不写未提供的价格、限时、销量或福利。",
        image: "短视频封面感：强钩子大字、高对比与强明暗、动感斜切构图，允许文字时可用爆炸贴、放射线等动态 UI；人物表情与动作鲜明，商品大而近；不出现未提供的价格、销量与限时信息。",
    },
    flagship: {
        name: "旗舰店货架",
        strategy:
            "按品牌旗舰店的信息层级组织：主图先让品类一眼可辨并给出一句核心利益；首屏或卖点总览可用图标卖点气泡、引线标注、规格参数卡、对比栏等结构化 UI，逐屏回答“是什么、好在哪、怎么用、规格如何”；整体干净、精致、可信，品牌色贯穿全套，营销信息克制不堆砌。",
        image: "旗舰店质感：商品第一视觉，干净、精致、可信，信息层级清楚；允许文字时按本张版式选用图标卖点、规格卡、对比栏等结构化组件，品牌色贯穿全套。",
    },
    value: {
        name: "高性价比货架",
        strategy: "用户决策快，要一眼看清商品本身与组合（几件装、套装内容、颜色款式），利益点大字直给（只写真实资料中的件数、规格、赠品与适用场景）；明亮高饱和配色，商品大而饱满，背景干净不抢戏；不写未提供的价格、补贴、销量和平台活动标识。",
        image: "明亮高饱和，商品与组合一眼看清、饱满占画面，利益点大字直给，背景干净不抢商品；不出现未提供的价格、补贴与销量。",
    },
    wholesale: {
        name: "批发采购",
        strategy:
            "面向采购商而非终端消费者，突出供货专业度：规格齐全、多 SKU/多色并列陈列、包装与装箱方式、细节做工放大；工厂实力、产能、资质与定制服务只用用户提供的资料，没有资料时改为可见做工与规格展示；版式偏理性的规格表、SKU 矩阵与细节窗，干净的工业质感；不虚构工厂面积、产能、认证、起订量和价格。",
        image: "理性专业的采购视角：规格齐全、多 SKU/多色并列、细节与包装清晰，干净的工业质感；不出现未提供的产能、资质、起订量与价格。",
    },
    "domestic-specialty": {
        name: "垂直与特卖平台",
        strategy: "按平台的垂直语境调整画面气质，商品真实完整、信息清楚，不套用综合货架的促销模板。",
        image: "按平台垂直语境呈现：商品真实完整、信息清楚，不套用综合货架的促销模板。",
    },
    wechat: {
        name: "社交私域",
        strategy: "熟人分享与朋友圈转发语境：画面真实可信，像店主实拍或朋友推荐，生活化场景、自然光、温和配色；文案口语、亲切，直接说明用途与适合谁；视频号可借短视频封面的大字标题，但不过度刺激；不伪造聊天记录、好评截图、销量或熟人背书。",
        image: "真实可信的熟人分享感：生活化实拍、自然光、温和配色，文字口语亲切；不出现伪造的聊天截图、好评或销量。",
    },
    listing: {
        name: "listing 货架",
        strategy:
            "listing 主图（首张）用纯白背景 RGB 255,255,255，商品完整清晰、约占画面 85%，无文字、无外加 Logo 图形、无水印、无边框、无徽章，也不放非随附道具；副图用目标语言做信息图、生活方式场景、尺寸/规格对比、细节特写、包装与配件清单等分工，每张一个主题，短标题加少量要点，干净留白、国际化无衬线字体；A+ 与详情按模块化品牌叙事（品牌横幅、图文模块、对比表、多宫格特性），每个模块可独立阅读；不使用中文电商式的胶囊标签条、爆炸贴和底部促销横幅，不写未提供的认证、评分、Best Seller 或 Amazon's Choice 等标识。",
        image: "国际化 listing 视觉：商品第一视觉，干净留白，目标语言短标题与少量要点，无衬线字体；按本张分镜做信息图、生活方式或尺寸对比；不使用中文电商式胶囊标签条、爆炸贴和底部促销横幅，不加价格、评分、Best Seller 或认证徽章。",
    },
    "brand-site": {
        name: "品牌独立站",
        strategy: "像品牌官网与杂志大片：编辑感摄影、大留白、克制的配色，精致的衬线或几何无衬线字体与清晰网格，生活方式图与静物特写交替；文字少而精，讲品牌态度与使用情境，不做促销堆砌。",
        image: "品牌编辑摄影：杂志感网格、大留白、克制配色与精致字体，文字少而精，不做促销堆砌。",
    },
    "mobile-global": {
        name: "移动端跨境货架",
        strategy: "按手机信息流的浏览节奏：商品大、近、对比强，背景简洁，目标语言短标题（约 2–6 个词）配 1–3 个图标卖点，缩略图也能看清；首图以商品辨识为先，叠加文字精简，不加边框、水印或二维码；不写未提供的折扣、包邮、评分与平台活动标识。",
        image: "移动端缩略图可识别：商品大、近、对比强，背景简洁，目标语言短标题与 1–3 个图标卖点；不出现未提供的折扣、包邮、评分与平台活动标识。",
    },
    general: {
        name: "通用电商",
        strategy: "适合手机快速浏览：商品第一视觉，标题短、层级清晰，按目标语言写自然文案。",
        image: "商品第一视觉，信息层级清楚，适合手机浏览。",
    },
};

/** Planner-level notes that tell platforms of one family apart. */
const platformNotes: Record<string, string> = {
    taobao: "淘宝可更生活化、有烟火气，突出日常使用与搭配。",
    tmall: "天猫偏品牌调性与旗舰质感。",
    jd: "京东偏理性参数、品质感与服务可信感（服务承诺只用用户资料）。",
    douyin: "抖音偏内容种草与直播间氛围。",
    kuaishou: "快手偏真实、直接、接地气的实用表达。",
    "1688": "1688 面向国内批发与源头采购。",
    alibaba: "阿里巴巴国际站面向海外 B2B 采购，用目标语言专业表达，OEM/ODM 定制能力只在用户提供时出现。",
    dhgate: "DHgate 面向跨境小批量采购，突出款式齐全与规格清楚。",
    vipshop: "唯品会是品牌特卖语境：品牌正品感与专柜质感优先，多角度与模特上身展示，折扣信息只用用户资料。",
    dewu: "得物是潮流正品语境：干净棚拍与潮流编辑感，多角度与微距呈现鞋底纹路、走线、Logo、材质等可见细节；不暗示鉴别结论或官方认证。",
    aikucun: "爱库存是社交分销语境：做便于店主转发的方图或长图，商品清晰、卖点直给、信息完整易读。",
    railway: "国铁商城重在稳重可信：端正规范、信息完整，地方特产与文创可融入地域文化元素；不使用铁路路徽或官方背书（除非用户提供）。",
    "wechat-shop": "微信小店偏朋友圈与私域转发。",
    "video-shop": "视频号小店可带短视频与直播封面感，但保持熟人推荐的真实温度。",
    amazon: "Amazon 主图规范最严格，A+ 走模块化品牌叙事。",
    ebay: "eBay 对图片上添加文字、边框和插画限制较严，副图也以真实商品与场景照片为主、文字极简。",
    walmart: "Walmart 主图同样要求纯白与高占比，副图可用信息图与场景图。",
    aliexpress: "AliExpress 以移动端为主，首图白底干净无水印，副图可用目标语言信息图。",
    "mercado-libre": "Mercado Libre 首图纯白，文案按目标市场用西班牙语或葡萄牙语。",
    wayfair: "Wayfair 以家居家具为主，首图为白底轮廓图，其余为真实家居空间场景。",
    noon: "noon 面向中东市场，阿拉伯语排版注意从右到左的阅读顺序。",
    emag: "eMAG 首图白底，文案用目标市场语言。",
    coupang: "Coupang 面向韩国市场，首图白底干净，副图可用韩文信息图。",
    shopify: "Shopify 独立站按品牌官网首页与产品页的审美。",
    etsy: "Etsy 偏手作与原创设计：自然光生活方式、真实材质与手作温度，首图主体居中便于缩略图裁切。",
    tiktok: "TikTok Shop 偏真人上手、开箱与前后对比的短视频截帧感。",
    temu: "Temu 商品清晰饱满、背景干净明亮，卖点短而直给。",
    shopee: "Shopee 面向东南亚移动端，明亮活泼、节奏快。",
    lazada: "Lazada 面向东南亚移动端，明亮活泼、信息清楚。",
    ozon: "OZON 常用竖版 3:4 信息图式主图，卖点用俄语短句配图标。",
    wildberries: "Wildberries 常用竖版 3:4 信息图式主图，卖点用俄语短句配图标。",
    rakuten: "Rakuten 面向日本市场，信息细致完整，首图文字占比克制、不加边框。",
    "11street": "11Street 面向韩国市场，移动端信息清楚，韩文短标题。",
};

/** Image-level wording for platforms whose family description is too broad. */
const platformImageNotes: Record<string, string> = {
    vipshop: "品牌特卖质感：商品完整、多角度或模特上身，正品感与专柜质感优先，不出现未提供的折扣。",
    dewu: "潮流正品的棚拍编辑感：背景干净，强调鞋底纹路、走线、Logo 与材质等可见细节，不出现鉴别结论或官方认证标识。",
    aikucun: "转发友好的分销素材：商品清晰、卖点直给、信息完整易读。",
    railway: "稳重可信、端正规范，可融入地域文化元素；不使用铁路路徽或官方背书标识（除非用户提供）。",
};

type TypeNotes = Partial<Record<CommercePlatformFamilyId | "default", string>>;
const typeNotes: Record<string, TypeNotes> = {
    main: {
        listing: "本次为电商主图：每张都按 listing 主图规范执行（纯白、无文字，copy 留空；平台硬性规则优先于上方创作类型策略中的场景与文案要求），多张主图之间只变化商品角度、朝向、随附组合与光影。",
        xiaohongshu: "本次为主图：按笔记封面执行，多张之间轮换封面结构（大字封面、清单式陈列、前后对比、手持实拍、氛围大片）。",
        "short-video": "本次为主图：像短视频封面，大字钩子配商品大特写或人物上手，多张之间轮换钩子角度。",
        flagship: "本次为主图：首张商品居中清晰、品类一眼可辨，可带一句核心卖点与品牌标识且文字不压商品；其余主图分别承担卖点、场景、细节等不同职能，需要白底主图时放在最后一张。",
        value: "本次为主图：商品与组合内容饱满、明亮，利益点大字直给。",
        wholesale: "本次为主图：商品清晰完整，可并列展示多色或多规格，体现供货专业感。",
    },
    secondary: {
        listing: "本次为副图：用目标语言做信息图、生活方式、尺寸对比、细节特写或包装清单，每张一个主题。",
    },
    set: {
        listing:
            "本次为整套 listing 图：第 1 张必须是 imageType=main 的 listing 主图（纯白、无文字，copy 留空），其余按副图分工（信息图、生活方式、尺寸对比、细节特写、包装配件），每张一个主题；主副图（主图 1 张、副图 1 张）同样第 1 张为 listing 主图、第 2 张为副图。",
        xiaohongshu: "整套像一篇笔记的轮播：封面 → 场景或痛点 → 细节或对比 → 清单或总结，每张有自己的笔记式标注。",
        "short-video": "整套首图负责抓眼，其余用上手演示、前后对比、细节特写和场景切换保持节奏。",
        flagship: "整套由主图负责点击，其余分别回答卖点、场景、细节与规格。",
    },
    detail: {
        listing: "本次为详情：按 A+ 式模块化版式执行（品牌横幅、图文模块、对比表、多宫格特性、生活方式大图），目标语言短标题；不使用中文电商长图式的标签条、爆炸贴与底部横幅，上文第44条的版式骨架只取信息顺序。",
        xiaohongshu: "本次为详情：按笔记内页节奏，每屏一个要点，用手写批注、便签与圈注说明真实可见的细节。",
        "short-video": "本次为详情：首屏强钩子，后续以上手演示、前后对比和场景切换为主，字少而大、节奏快。",
        flagship: "本次为详情：按旗舰店长图逻辑组织首屏、卖点总览、分卖点、场景、细节、规格与收束，信息层级清晰。",
        "brand-site": "本次为详情：像品牌官网产品页，大图与留白交替，少量编辑式标题。",
    },
    "amazon-a-plus": {
        default: "A+ 模块逐张独立成图：品牌横幅、图文模块、对比表、多宫格特性、生活方式大图；目标语言短标题，不写价格、促销、评价引用与时效信息。",
    },
    white: {
        listing: "白底图按 listing 规范：纯白 #FFFFFF（RGB 255）、商品约占画面 80%–84% 且四边各留不少于 8% 的白边、无文字、无任何 UI 组件。",
        default: "白底图只呈现商品：纯白 #FFFFFF 背景，商品完整且四边各留不少于画幅 8% 的白边、不贴边，无文字、无任何 UI 组件，只保留极轻的接触阴影。",
    },
    sku: {
        listing: "SKU 图如用作变体主图，按主图规范纯白无文字（可在 SKU 文案位置选择“不添加文字”）。",
    },
    single: {
        listing: "单图用途为商品主图时按 listing 主图规范执行（纯白、无文字），其他用途按副图取向执行。",
    },
    marketing: {
        xiaohongshu: "营销物料按小红书笔记封面感执行，不做硬广横幅。",
        listing: "营销物料用于站外广告或社媒时可用场景与标题，但不加价格、评分与平台标识。",
    },
    social: {
        xiaohongshu: "社交推广图按小红书笔记封面感执行，像真实用户分享。",
    },
};

export function commercePlatformFamily(platform: string): CommercePlatformFamily {
    const domestic = (commercePlatformGroups.domestic as readonly string[]).includes(platform);
    return { id: familyOf[platform] || "general", market: domestic ? "domestic" : "cross-border", label: labelOf(platforms, platform) || "通用电商" };
}

/** Amazon-style listing main images: pure white, product about 85% of the frame, no text at all. */
export function commercePlatformListingMain(platform: string, imageType: string, purpose = ""): boolean {
    const profile = commerceKnowledgeFor(platform);
    if (profile) return profile.whiteMain && (imageType === "main" || (imageType === "single" && purpose.includes("主图")));
    return familyOf[platform] === "listing" && (imageType === "main" || (imageType === "single" && purpose.includes("主图")));
}

/** Planner guidance: the platform's layout, UI and tone for the selected creation type. */
export function commercePlatformStrategy(platform: string, imageType: string): string {
    const family = commercePlatformFamily(platform);
    const profile = familyProfiles[family.id];
    const knowledge = commerceKnowledgeFor(platform);
    const notes = typeNotes[imageType];
    const useFamily = !knowledge || (!knowledge.allListingNoText && !["shein", "temu"].includes(platform) && (family.id !== "listing" || knowledge.whiteMain));
    return [
        `${family.market === "domestic" ? "国内平台" : "跨境平台"}·${family.label}（${profile.name}）：${useFamily ? profile.strategy : knowledge?.style}`,
        knowledge ? knowledge.risk : platformNotes[platform] || "",
        commerceKnowledgePrompt(platform, imageType),
        family.id === "listing" && knowledge && !knowledge.whiteMain ? "" : (notes?.[family.id] ?? notes?.default ?? ""),
        family.market === "domestic" ? "文案适合手机快速浏览，中文标题与卖点层级清晰。" : "文案使用目标市场的自然语言，不机械直译中文口号。",
        "平台当期上架规范以官方为准；以上是视觉与版式取向，不改变事实边界，不得伪造评价、价格、销量、功效、认证或平台合规结论。",
    ]
        .filter(Boolean)
        .join("");
}

/** Image-model rule: hard for listing main and white images, a tone hint otherwise. */
export function commercePlatformImageRule(platform: string, imageType: string, purpose = ""): string {
    const family = commercePlatformFamily(platform);
    const knowledge = commerceKnowledgePrompt(platform, imageType, purpose);
    const profile = commerceKnowledgeFor(platform);
    if (profile) {
        const main = imageType === "main" || (imageType === "single" && purpose.includes("主图"));
        return (
            knowledge +
            `\n【平台画面取向·${family.label}】${!profile.allListingNoText && !["shein", "temu"].includes(platform) && family.id !== "listing" ? familyProfiles[family.id].image : profile.style}配色、字体与 UI 套件以本套美术系统为准，平台约束优先。` +
            (main && profile.whiteMain ? `\n【平台主图硬性规则·${family.label}】本张主图使用纯白背景 RGB 255,255,255，商品完整居中，不添加非随附道具，无文字与营销UI。${platform === "amazon" ? "商品约占画面85%，类目例外按官方核实。" : ""}` : "") +
            (imageType === "white" ? `\n本张白底图使用纯白 #FFFFFF 背景${family.id === "listing" ? "，商品约占画面80%–84%" : ""}，商品完整，四边各留不少于画幅 8% 的白边，不贴边、不裁切，无文字，不叠加气泡、标签、角标、引线或其他UI。` : "")
        );
    }
    if (commercePlatformListingMain(platform, imageType, purpose)) {
        return `【平台主图硬性规则·${family.label}】优先于本套美术系统、本张分镜与版式方案：纯白背景 RGB 255,255,255，无渐变、无场景、无台座或非随附道具；商品完整清晰、居中，约占画面 85%；无文字：画面内不加任何文字、外加 Logo 图形、水印、边框、色块、徽章或卖点 UI，只保留商品本身真实的 Logo 与包装原文；可保留极轻的自然接触阴影。`;
    }
    if (imageType === "white") {
        return `【平台画面规则·${family.label}】白底图只呈现商品：纯白背景 #FFFFFF（RGB 255,255,255）${family.id === "listing" ? "，商品约占画面 80%–84%" : ""}，商品完整，四边各留不少于画幅 8% 的白边，任何部分都不贴边、不出画；无文字，也不叠加气泡、标签、角标、引线、横幅等任何 UI 组件，只保留极轻的自然接触阴影。`;
    }
    return `【平台画面取向·${family.label}】${platformImageNotes[platform] || familyProfiles[family.id].image}配色、字体与 UI 套件以【本套美术系统】和本张版式为准。`;
}
