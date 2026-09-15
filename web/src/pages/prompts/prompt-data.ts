import { scopedLocalStorage } from "@/lib/user-scope";

export type PromptKind = "image" | "video";

export interface PromptPresetItem {
    id: string;
    title: string;
    kind: PromptKind;
    category: string;                  // 一级精细专题
    crossCategories?: string[];        // 交叉关联的一级专题（双向覆盖）
    description: string;               // 效果与场景描述
    positivePrompt: string;            // 核心正向提示词（带 {主体} 等插槽）
    negativePrompt?: string;           // 负向提示词
    styleTokens: string[];             // 核心风格词
    tags: string[];                    // 交叉多维检索标签
    gradient: string;
    accentColor: string;
    icon: string;
    previewImage?: string;             // 真实出图效果预览图
    previewThumbnail?: string;         // 网格自适应压缩缩略图 (WebP)
    previewImages?: string[];          // 多视角画册范例
    previewVideo?: string;             // 视频预览/播放地址 (MP4/WebM)
    remoteBackupUrl?: string;          // 外部 CDN 高清大图/视频兜底 URL
    remoteThumbBackupUrl?: string;     // 外部 CDN 缩略图兜底 URL
    linkedPresetId?: string;           // 关联的生图/生视频预设ID
    hasImage?: boolean;                // 是否具备真实配图
    isPureText?: boolean;              // 纯文本模版（0图片带宽）
    isCustom?: boolean;
    isOverridden?: boolean;
    createdAt?: number;
    author?: string;
    source?: string;
    sourceUrl?: string;
    recommendedParams?: {
        aspectRatio?: string;
        duration?: number;
        model?: string;
    };
}

export const IMAGE_CATEGORIES = [
    "全部",
    "广告创意",
    "角色设计",
    "模型对比与实验",
    "电商与产品",
    "人像与摄影",
    "海报与插画",
    "UI 与社交媒体",
    "电商产品与白底精修",
    "时尚人像与模特写真",
    "商业海报与营销视觉",
    "商业广告与TVC故事板",
    "品牌包装与3D立体设计",
    "界面UI与信息图表",
    "3D立体字效与字体排印",
    "国风国潮与东方美学",
    "二次元动漫与游戏原画",
    "角色资产与微表情控制",
    "建筑空间与室内设计",
    "美食餐饮与商业静物",
    "鞋靴箱包与奢品配饰",
    "赛博科幻与未来机甲",
    "微缩景观与粘土盲盒",
    "自然风光与生态摄影",
    "图像重绘与风格迁移",
    "分镜漫画与绘本设计",
    "其他综合与实验风格",
] as const;

export const VIDEO_CATEGORIES = [
    "全部",
    "文本生成",
    "参考素材生成",
    "广告与商品短片",
    "叙事、动作与电影化镜头",
    "游戏与 UI",
    "音乐与节奏视频",
    "商业广告与TVC故事板",
    "电影级运镜与基础机位",
    "剧情叙事与短剧分镜",
    "角色动作与武打格斗",
    "演员神态与情绪调度",
    "环境动力学与升格慢动作",
    "其他视频与综合待分类",
] as const;

export const IMAGE_PROMPT_PRESETS: PromptPresetItem[] = [
    {
        "id": "gpt-image-2-ad-creative-case-90",
        "title": "4-Panel Japanese Digital Ad Banner Grid",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @makaneko_AI",
        "positivePrompt": "{\n  \"type\": \"2x2 grid of Japanese digital advertisement banners\",\n  \"layout\": {\n    \"structure\": \"4 equal quadrants\",\n    \"quadrants\": [\n      {\n        \"position\": \"top-left\",\n        \"theme\": \"Travel\",\n        \"subject\": \"A couple holding hands on a white sand beach, looking out at turquoise ocean water under a bright blue sky.\",\n        \"elements\": [\"red hibiscus flower in bottom left corner\"],\n        \"text_labels\": [\n          \"今年こそ、解き放て。\",\n          \"{argument name=\\\"travel destination\\\" default=\\\"沖縄旅行\\\"}\",\n          \"3日間の癒やし旅\",\n          \"航空券+ホテル\",\n          \"39,800円〜\",\n          \"絶景、グルメ、体験 ぜんぶ叶う!\"\n        ],\n        \"icons\": {\n          \"count\": 3,\n          \"descriptions\": [\"airplane\", \"hotel building\", \"car\"]\n        }\n      },\n      {\n        \"position\": \"top-right\",\n        \"theme\": \"Skincare\",\n        \"subject\": \"Close-up portrait of a young woman with glowing, dewy skin, eyes closed, gently touching her cheeks.\",\n        \"elements\": [\n          \"soft pink gradient background\",\n          \"dynamic water splash effects\",\n          \"pink cosmetic jar labeled '{argument name=\\\"skincare product name\\\" default=\\\"LUMIÈRE\\\"} Brightening Gel'\"\n        ],\n        \"text_labels\": [\n          \"毛穴・くすみ卒業!\",\n          \"透明感あふれる\",\n          \"水光肌へ\",\n          \"新感覚スキンケア\",\n          \"初回限定 78%OFF\",\n          \"{argument name=\\\"discount price\\\" default=\\\"1,980円\\\"}\"\n        ],\n        \"badges\": {\n          \"count\": 3,\n          \"style\": \"gold circular\",\n          \"labels\": [\"毛穴ケア\", \"高保湿\", \"ハリ・ツヤ\"]\n        }\n      },\n      {\n        \"position\": \"bottom-left\",\n        \"theme\": \"Gourmet Food\",\n        \"subject\": \"Thick, sliced, medium-rare steak sizzling on a dark grill plate.\",\n        \"elements\": [\n          \"garlic chips\",\n          \"rosemary sprig\",\n          \"dark background with smoke and glowing embers\"\n        ],\n        \"text_labels\": [\n          \"とろける旨さ!\",\n          \"{argument name=\\\"food item\\\" default=\\\"黒毛和牛\\\"}\",\n          \"贅沢ステーキ\",\n          \"期間限定\",\n          \"特別価格\",\n          \"通常価格 8,980円\",\n          \"4,980円\"\n        ],\n        \"badges\": {\n          \"count\": 1,\n          \"style\": \"red circular\",\n          \"labels\": [\"A4 A5等級\"]\n        }\n      },\n      {\n        \"position\": \"bottom-right\",\n        \"theme\": \"Online Education\",\n        \"subject\": \"Young man in a blue shirt studying at a desk, writing in a notebook next to an open laptop.\",\n        \"elements\": [\"bright indoor lighting\", \"desk environment\"],\n        \"text_labels\": [\n          \"スキマ時間で\",\n          \"{argument name=\\\"education goal\\\" default=\\\"最短合格!\\\"}\",\n          \"オンライン資格講座\",\n          \"スマホで完結\",\n          \"効率学習で差がつく!\",\n          \"今だけ! 受講料 20%OFF\"\n        ],\n        \"badges\": {\n          \"count\": 1,\n          \"style\": \"blue circular\",\n          \"labels\": [\"受講者数 10万人 突破!\"]\n        },\n        \"icons\": {\n          \"count\": 2,\n          \"descriptions\": [\"smartphone\", \"open book\"]\n        }\n      }\n    ]\n  }\n}",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-90.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-90.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/ui_case90/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/ui_case90/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/makaneko_AI/status/2045764016858087720",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-112",
        "title": "Anime Character Brand Identity & Merch Board",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @chi_vc_",
        "positivePrompt": "{\n  \"type\": \"brand identity and merchandise design board\",\n  \"theme\": {\n    \"color_palette\": \"{argument name=\\\"theme color\\\" default=\\\"pastel pink\\\"} and white\",\n    \"motif\": \"{argument name=\\\"motif\\\" default=\\\"cherry blossoms\\\"} and pink hearts\"\n  },\n  \"character\": {\n    \"description\": \"anime girl with short brown bob hair, pink eyes, wearing a white hoodie, gentle smile\"\n  },\n  \"branding\": {\n    \"main_logo\": \"{argument name=\\\"character name\\\" default=\\\"癒音ちー\\\"}\",\n    \"sub_logo\": \"{argument name=\\\"character subtext\\\" default=\\\"ゆおんちー\\\"}\"\n  },\n  \"layout\": {\n    \"sections\": [\n      {\n        \"type\": \"header banner\",\n        \"position\": \"top\",\n        \"elements\": [\"large main logo\", \"sub logo\", \"cherry blossom graphics\", \"character portrait on the right\"]\n      },\n      {\n        \"type\": \"product packaging\",\n        \"position\": \"middle left\",\n        \"elements\": [\"1 square box with heart-shaped transparent window showing pink heart candies\", \"character illustration on box\", \"2 individual candy wrappers\", \"5 scattered heart candies\"]\n      },\n      {\n        \"type\": \"promotional poster\",\n        \"position\": \"middle right\",\n        \"elements\": [\"character portrait\", \"heart-shaped candy bowl\", \"main logo\", \"text '4.26 NEW OPEN'\", \"text '{argument name=\\\"social handle\\\" default=\\\"@yuonchii\\\"}'\"]\n      },\n      {\n        \"type\": \"horizontal web banner\",\n        \"position\": \"lower middle\",\n        \"elements\": [\"main logo\", \"cherry blossoms\", \"character portrait on the right\"]\n      },\n      {\n        \"type\": \"social media profile mockup\",\n        \"position\": \"bottom left\",\n        \"elements\": [\"header image with logo\", \"1 circular profile picture\", \"handle '{argument name=\\\"social handle\\\" default=\\\"@yuonchii\\\"}'\", \"1 follow button\", \"mock bio text\"]\n      },\n      {\n        \"type\": \"merchandise collection\",\n        \"position\": \"bottom right\",\n        \"count\": 9,\n        \"items\": [\"1 white t-shirt with logo\", \"1 white mug with character\", \"4 round pin badges\", \"1 acrylic keychain\", \"2 candy packets\"]\n      }\n    ]\n  }\n}",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-112.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-112.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case112/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case112/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/chi_vc_/status/2046061073720369228",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-108",
        "title": "Dark Mode Marketing Case Study UI",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @IndieDevHailey",
        "positivePrompt": "{\n  \"type\": \"UI/UX landing page mockup\",\n  \"theme\": \"dark mode, sleek modern aesthetic, glassmorphism, {argument name=\\\"primary accent color\\\" default=\\\"neon purple and blue\\\"} glowing accents\",\n  \"header\": {\n    \"logo\": \"{argument name=\\\"brand name\\\" default=\\\"goViralX\\\"}\",\n    \"top_right_tag\": \"VIRAL CAMPAIGN CASE STUDY\"\n  },\n  \"layout\": {\n    \"sections\": [\n      {\n        \"name\": \"Hero\",\n        \"headline\": \"{argument name=\\\"hero headline\\\" default=\\\"How We Created 10M+ Viral Impact\\\"}\",\n        \"subheadline\": \"3天引爆全网, 助力品牌实现指数级增长\",\n        \"stats_row\": {\n          \"count\": 4,\n          \"labels\": [\"总播放量\", \"互动率\", \"转化咨询\", \"执行周期\"],\n          \"values\": [\"{argument name=\\\"main statistic\\\" default=\\\"10,240,000+\\\"}\", \"18.7%\", \"3,200+\", \"72小时\"]\n        },\n        \"visual\": \"cinematic shot of a person in a hoodie looking at glowing digital screens and graphs, large play button overlay\"\n      },\n      {\n        \"name\": \"Strategy\",\n        \"title\": \"Our 3-Day Execution Strategy\",\n        \"layout_type\": \"vertical timeline\",\n        \"steps_count\": 3,\n        \"elements_per_step\": [\"timeline node\", \"title\", \"bullet points\", \"video thumbnail with play button\", \"description box\"]\n      },\n      {\n        \"name\": \"Performance\",\n        \"title\": \"Data-Driven Performance\",\n        \"left_column\": {\n          \"stat_cards_count\": 4,\n          \"values\": [\"10M+\", \"43%\", \"28,000+\", \"3,200+\"]\n        },\n        \"right_column\": {\n          \"charts_count\": 2,\n          \"chart_1\": \"line graph showing 7-day growth peaking at Day 3\",\n          \"chart_2\": \"horizontal segmented bar chart showing platform distribution (TikTok 52%, Instagram 24%, X 15%, YouTube 9%)\"\n        }\n      },\n      {\n        \"name\": \"Keys to Success\",\n        \"title\": \"The 3 Keys to Viral Success\",\n        \"cards_count\": 3,\n        \"card_elements\": [\"glowing icon (fire, target, antenna)\", \"title\", \"description\", \"VIEW DETAIL link\"]\n      },\n      {\n        \"name\": \"Social Proof\",\n        \"title\": \"TRUSTED BY CREATORS & BRANDS\",\n        \"left_column\": {\n          \"logos_count\": 8,\n          \"grid\": \"2x4\",\n          \"brands\": [\"SHEIN\", \"SHOPLINE\", \"Blueglass\", \"instacart\", \"lemon8\", \"mi\", \"CIDER\", \"bellroy\"]\n        },\n        \"right_column\": {\n          \"testimonial_cards_count\": 2,\n          \"elements\": [\"quote\", \"author title (SaaS Founder, Growth Manager)\"]\n        }\n      },\n      {\n        \"name\": \"Call to Action\",\n        \"title\": \"READY TO GO VIRAL?\",\n        \"interactive_elements\": [\"text input field\", \"glowing button with text '{argument name=\\\"call to action text\\\" default=\\\"获取专属增长方案 ->\\\"}'\"],\n        \"visual\": \"3D render of a rocket ship taking off with purple and blue flames\"\n      }\n    ]\n  }\n}",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-108.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-108.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case108/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case108/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/IndieDevHailey/status/2044974254769463312",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-107",
        "title": "18-Panel Mascot Brand Identity Document",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @Colin_Leeee",
        "positivePrompt": "{\n  \"type\": \"18-panel brand identity and character design document\",\n  \"brand\": {\n    \"name\": \"{argument name=\\\"brand name\\\" default=\\\"沐阳 MUYANG TEA\\\"}\",\n    \"industry\": \"{argument name=\\\"industry\\\" default=\\\"tea shop\\\"}\",\n    \"colors\": [\"{argument name=\\\"primary color\\\" default=\\\"yellow\\\"}\", \"{argument name=\\\"secondary color\\\" default=\\\"green\\\"}\", \"white\", \"brown\", \"dark green\"]\n  },\n  \"subject\": \"{argument name=\\\"character description\\\" default=\\\"3D rendered cute Shiba Inu mascot wearing a green apron\\\"}\",\n  \"layout\": {\n    \"grid\": \"3 columns by 6 rows\",\n    \"sections\": [\n      {\n        \"title\": \"01 品牌DNA分析 / BRAND DNA ANALYSIS\",\n        \"elements\": [\"logo\", \"5 color swatches\", \"6 icons\", \"target audience charts\"]\n      },\n      {\n        \"title\": \"02 概念构思 / CONCEPT MOODBOARD\",\n        \"elements\": [\"5 photo references\", \"4 mood icons\", \"design equation\"]\n      },\n      {\n        \"title\": \"03 形态研究 / FORM STUDY\",\n        \"elements\": [\"4 logo anatomy icons\", \"4 evolution steps\", \"4 silhouettes\"]\n      },\n      {\n        \"title\": \"04 概念探索 / CONCEPT EXPLORATION\",\n        \"elements\": [\"12 line-art character sketches\"]\n      },\n      {\n        \"title\": \"05 精细线稿 / REFINED LINE ART\",\n        \"elements\": [\"3 rows of front and side line art with proportion guides\"]\n      },\n      {\n        \"title\": \"06 细节精修 / DETAIL REFINEMENT\",\n        \"elements\": [\"2 full-body renders with labels\", \"4 circular close-ups\"]\n      },\n      {\n        \"title\": \"07 表情设定 / EXPRESSION SHEET\",\n        \"elements\": [\"11 3D rendered head expressions\"]\n      },\n      {\n        \"title\": \"08 姿势库 / POSE LIBRARY\",\n        \"elements\": [\"9 full-body 3D rendered poses\"]\n      },\n      {\n        \"title\": \"09 转身视图 / TURNAROUND VIEW\",\n        \"elements\": [\"5 full-body 3D renders\", \"5 matching line-art views\"]\n      },\n      {\n        \"title\": \"10 色彩开发 / COLOR DEVELOPMENT\",\n        \"elements\": [\"5 rows of 5-color palettes\", \"color psychology text\"]\n      },\n      {\n        \"title\": \"11 材质规格 / MATERIAL SPECIFICATION\",\n        \"elements\": [\"5 texture swatches\", \"property sliders\", \"4 manufacturing icons\"]\n      },\n      {\n        \"title\": \"12 色彩应用 / COLOR APPLICATION\",\n        \"elements\": [\"4 color variant renders\", \"2 light/dark renders\", \"4 contrast rating circles\"]\n      },\n      {\n        \"title\": \"13 构造指南 / CONSTRUCTION GUIDE\",\n        \"elements\": [\"2 line-art diagrams for geometry and grid\"]\n      },\n      {\n        \"title\": \"14 设计系统规则 / DESIGN SYSTEM RULES\",\n        \"elements\": [\"minimum size icons\", \"clear space diagram\", \"4 usage examples\"]\n      },\n      {\n        \"title\": \"15 资产变体 / ASSET VARIANTS\",\n        \"elements\": [\"3 size variants\", \"3 line-art variants\", \"3 simplified flat heads\"]\n      },\n      {\n        \"title\": \"16 数字应用 / DIGITAL APPLICATIONS\",\n        \"elements\": [\"1 app icon\", \"2 social avatars\", \"UI elements\", \"3-step animation cycle\"]\n      },\n      {\n        \"title\": \"17 实物应用 / PHYSICAL APPLICATIONS\",\n        \"elements\": [\"plush toy mockup\", \"packaging mockup\", \"merchandise mockup\", \"storefront mockup\"]\n      },\n      {\n        \"title\": \"18 最终主视觉 / FINAL RENDERING\",\n        \"elements\": [\"large high-res 3D render of mascot holding tea\", \"logo\", \"file format list\"]\n      }\n    ]\n  }\n}",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-107.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-107.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case107/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case107/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/Colin_Leeee/status/2044802802149650631",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-166",
        "title": "Japanese Chinese Food Delivery Flyer",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @xc5_",
        "positivePrompt": "A Japanese neighborhood Chinese restaurant delivery flyer for mailbox posting (3:4 aspect ratio). Designed to look like a double-sided B5 print.\n\nFlyer characteristics (following the grammar of real delivery flyers):\n- Flashy red and yellow color scheme.\n- Large text at the top: \"Delivery Available! {argument name=\"shop name\" default=\"Mona-Hanten\"}\" (shadowed Gothic font).\n- An illustration of a {argument name=\"character\" default=\"Chinese girl in a red cheongsam with a brown short bob\"} holding ramen and saying \"Welcome!\" in a speech bubble.\n- A menu photo grid (4x3) featuring various dishes: different types of ramen, fried rice, gyoza, sweet and sour pork, shrimp in chili sauce, mapo tofu, liver and leek stir-fry, tenshinhan, twice-cooked pork, spring rolls, annin tofu, and fried rice sets.\n- Names and prices for each dish.\n- A large yellow banner saying \"Free delivery on all menu items over ¥1,000!\".\n- \"Order by phone! ☎ 072-XX-XXXX\" emphasized with a red circle.\n- Business hours \"11:00-22:00 (Closed on Tuesdays)\".\n- Delivery area map (simple schematic map).\n- Coupon (perforated line for clipping): \"One free plate of gyoza with this flyer!\".\n\nTexture of cheap paper printing. Includes fold marks. Precision that could be mistaken for a real Japanese delivery flyer.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-166.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-166.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case166/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case166/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/xc5_/status/2048310696686014935",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-167",
        "title": "Pastel Jellyfish Room Goods Poster",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @Ayu_AI_0912",
        "positivePrompt": "{\"type\":\"pastel lifestyle poster / character room-goods feature sheet\",\"theme\":\"soft dreamy lavender jellyfish aesthetic\",\"style\":\"Japanese cute editorial graphic, airy white background, pastel lilac palette, delicate handwritten notes, sparkles and tiny doodles, soft product photography mixed with magazine layout\",\"subject\":{\"character\":{\"name\":\"{argument name=\\\"character name\\\" default=\\\"くらげちゃん\\\"}\",\"appearance\":\"young woman with a short platinum-blonde bob haircut, wearing a fluffy pale-lavender zip hoodie over a white inner top, shown from chest up on the lower right, face intentionally obscured with a plain beige rectangle\"}},\"layout\":{\"orientation\":\"vertical poster\",\"background\":\"clean white with faint pastel doodles of stars, bubbles, tiny jellyfish, and musical notes\",\"sections\":[{\"title\":\"header\",\"position\":\"top\",\"count\":5,\"labels\":[\"speech bubble intro\",\"main title\",\"small subtitle GOODS\",\"horizontal lavender ribbon tagline\",\"round badge on the top right\"]},{\"title\":\"featured goods grid\",\"position\":\"upper and middle left\",\"count\":6,\"labels\":[\"ゆらゆらくらげランプ\",\"くらげと夢見るベッドリネン\",\"くらげシェルミラー\",\"くらげグラデマグ\",\"くらげのときめき収納ボックス\",\"くらげふわもこマット\"]},{\"title\":\"side handwritten note\",\"position\":\"upper right\",\"count\":1,\"labels\":[\"みんなも くらげちゃんRoomで いっしょに まったりしよー♡♡\"]},{\"title\":\"room concept box\",\"position\":\"lower left\",\"count\":1,\"labels\":[\"くらげちゃんの お部屋作りのこだわり\"]},{\"title\":\"pick up circle\",\"position\":\"lower center-left\",\"count\":1,\"labels\":[\"Pick up!\"]}],\"product_images\":{\"count\":6,\"items\":[{\"name\":\"ゆらゆらくらげランプ\",\"description\":\"small translucent jellyfish-shaped lamp on a white base, glowing softly in pale blue-lavender\"},{\"name\":\"くらげと夢見るベッドリネン\",\"description\":\"plush pastel-lavender bed with fluffy comforter and pillows, dreamy cozy bedroom styling\"},{\"name\":\"くらげシェルミラー\",\"description\":\"small tabletop mirror with a puffy shell-like pastel-lilac frame and rounded base\"},{\"name\":\"くらげグラデマグ\",\"description\":\"ceramic mug with lavender-to-pink gradient and a simple jellyfish illustration\"},{\"name\":\"くらげのときめき収納ボックス\",\"description\":\"pastel storage box holding cosmetics and small bottles, decorated with a jellyfish emblem\"},{\"name\":\"くらげふわもこマット\",\"description\":\"small fluffy cloud-like or jellyfish-like mat in pale lavender and white\"}]},\"text_elements\":{\"main_title\":\"{argument name=\\\"headline text\\\" default=\\\"くらげちゃんの お部屋アイテム\\\"}\",\"badge_text\":\"くらげちゃんの Room お部屋作りの こだわりポイントも 教えちゃうよ。\",\"tagline\":\"ふわふわで甘くて、ちょっぴり夢みたいな私のお部屋へようこそ♡\",\"speech_bubble\":\"くらげちゃんの お気に入りだけ集めた お部屋アイテムを紹介するよ♪\",\"concept_points\":{\"count\":3,\"items\":[\"色は白とラベンダーで統一!\",\"光が集まるふわっとした空間に\",\"お友達入りのアイテムに囲まれて 自分らしくいられる空間を大切にしてるよ♪\"]},\"product_blurbs\":\"each product has a short handwritten Japanese description in a cute casual font beside or below the image\"},\"composition\":\"the poster is left-heavy with product cards and text, while the character portrait occupies the lower right third, slightly overlapping the layout\",\"color_palette\":{\"count\":5,\"colors\":[\"white\",\"pastel lavender\",\"soft lilac\",\"pale gray-violet\",\"touches of pastel blue-pink gradient\"]},\"rendering_notes\":\"keep everything very soft, feminine, and cozy; rounded corners on all product photos; mix of bold Japanese headline typography and light handwritten annotations; subtle shadows; clean high-key lighting; social-media-ready editorial collage aesthetic\"}",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-167.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-167.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case167/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case167/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/Ayu_AI_0912/status/2048309565817766139",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-143",
        "title": "Magical Seed Packet Diorama",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @AllaAisling",
        "positivePrompt": "Epic 3D scene: a weathered seed packet lying open on a potting bench, its promise erupting into the garden it describes. The illustration on the front becomes real. {argument name=\"plant type\" default=\"[PLANT / FLOWER]\"} growing at full scale from the paper, roots visible through the packet's base pushing into soil below.\n{argument name=\"detail left\" default=\"[DETAIL 1]\"} in full bloom at one corner. {argument name=\"detail right\" default=\"[DETAIL 2]\"} mid-growth at the other, not yet what it will be.\nTiny insects that belong to this plant, {argument name=\"insect type\" default=\"[BEE / BUTTERFLY / BEETLE]\"}, hovering at correct scale.\nThe written instructions on the back become garden calendar, \"sow in spring\" manifests as actual spring light. \"full sun\" manifests as a single shaft of it, hitting the tallest bloom perfectly.\nScattered seeds between packet and soil each showing their germination stage, split coat, first root, first shoot, first leaf.\nThe packet's torn top edge becomes a treeline.\nPotting bench surface with soil scatter and water droplets.\nTilt-shift depth of field, greenhouse morning light, the packet as the garden it always intended.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-143.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-143.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case143/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case143/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/AllaAisling/status/2048156345518768190",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-144",
        "title": "Luxury Chronograph Watch Ad",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @AlwaveNazca",
        "positivePrompt": "A dramatic luxury product advertising image for a motorsport-inspired chronograph wristwatch in a dark studio. Center-left foreground, show a single stainless steel chronograph watch standing upright at a slight three-quarter angle, with a black dial, two red-accent subdials, slim silver hour markers, a tachymeter bezel, and visible crown and pushers on the right side. The watch has a black leather strap with bold red stitching along both edges and a sporty premium finish. To the right of the watch, place one black square presentation box slightly behind it, textured like leather, with red stitching around the lid and a silver embossed eye-shaped logo above the text “NESS STUDIO” and smaller red text “TRACK SURFACE.” At the top center of the composition, add the same silver eye logo with the words “NESS STUDIO” and smaller “BY NICOLAS.” Across the background, place one oversized blurred word, {argument name=\"headline text\" default=\"PRECISION\"}, in large gray capital letters spanning nearly the full width. The scene is set against a deep black background with cinematic red and white horizontal light streaks crossing behind the products from left to right, suggesting speed and racetrack energy. Use a glossy wet ground plane with reflective texture, catching red highlights and mirrorlike reflections beneath the watch and box. At the bottom center, add the text “CHRONOGRAPH SERIES” in clean white spaced capitals with thin red horizontal lines extending on both sides, and below it smaller red capitals reading {argument name=\"tagline text\" default=\"ALSACE MADE\"}. Color palette: black, charcoal gray, silver steel, vivid racing red, and a touch of white. Lighting should be high-contrast and premium, with crisp specular highlights on the metal case, subtle soft fill on the box, and moody shadows. Overall style: ultra-polished commercial product photography, luxury watch campaign, sharp focus on the products, sleek branding, high-end automotive aesthetic.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-144.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-144.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case144/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case144/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/AlwaveNazca/status/2048147643809865950",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-145",
        "title": "Neon Nike Lumina Ad Poster",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @AlwaveNazca",
        "positivePrompt": "A high-energy vertical Nike fashion campaign poster featuring a single athletic young woman mid-jump against a futuristic neon studio background. She is captured in a dynamic airborne pose with one knee bent up, the other leg folded back, one arm extended outward and the other bent near her chest, conveying motion and power. Her face is obscured by a clean rectangular blur block centered over the face. She wears a cropped iridescent white hooded windbreaker with a black zipper and small Nike logo on the chest, holographic metallic lavender-blue leggings with a subtle Nike swoosh on the thigh, a black branded waistband visible above the leggings, and white chunky Nike sneakers. Her brown hair is tied in a high ponytail flying outward with the jump. Behind her, enormous glowing white serif letters spell “NIKE” across the upper half, with a small white Nike swoosh centered above the word. Across the middle background, the phrase “LUMINA” appears once in wide bold glowing letters with a horizontal glitch and scanline distortion effect, partially obscured by the model. The color palette is saturated magenta, violet, cyan, and electric blue with strong bloom, glossy highlights, lens flares, and chromatic aberration. Add sweeping circular light trails wrapping around the model’s legs and body, suggesting speed and motion. The overall style is premium sportswear advertising, ultra-polished, cinematic, high contrast, hyperreal retouching, crisp product detail, dramatic rim lighting, and a luminous holographic aesthetic. Place 2 small text lines at the bottom: bottom left reads {argument name=\"tagline text\" default=\"LIGHT. MOTION. ENERGY.\"}, bottom right reads {argument name=\"collection name\" default=\"NIKE LUMINA COLLECTION\"} followed by a small Nike swoosh. Include exactly 3 visible Nike swooshes total: 1 above the large NIKE headline, 1 on the jacket chest, and 1 on the leggings.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-145.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-145.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case145/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case145/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/AlwaveNazca/status/2048147643809865950",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-146",
        "title": "Streetwear Sneaker Poster Ad",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @AlwaveNazca",
        "positivePrompt": "Create a bold streetwear poster advertisement for {argument name=\"brand name\" default=\"NESS STUDIO\"} featuring a young adult model seated casually on the ground in a low-angle fashion pose, one knee raised and one leg extended toward the camera so the sneaker in front appears oversized and dominant. The model wears a dark brown oversized leather bomber jacket, a black shirt, light blue loose-fit jeans, white socks, and chunky black-white-gray sneakers with a red accent in the sole and the {argument name=\"brand name\" default=\"NESS STUDIO\"} logo visible on the shoe side and tongue. The face is intentionally obscured by a soft rectangular blur block centered over the face. Use an off-white textured paper background with distressed grunge design elements and collage layering. Behind the model, place a large rough red paint brushstroke shape spanning diagonally across the center. Add black ink splatters, sketch circles, torn paper scraps, and hand-painted graffiti accents. Include 4 major graphic doodles: a large black X in the upper right, a hand-drawn upward arrow in the lower left, a rough crown sketch in the lower right, and a circular scribble near the top center. In the upper left, place a stylized eye logo above the text \"{argument name=\"brand name\" default=\"NESS STUDIO\"}\" and a smaller tagline below reading \"A MOMENT OF YOUR STYLE\". On the left middle area, add the handwritten slogan \"INNOVATE CREATE INSPIRE\" in stacked black brush lettering. On the right middle area, place a torn black paper patch with the handwritten white slogan \"BUILT DIFFERENT MOVE DIFFERENT\" and a red underline stroke. In the lower left near the shoe, add a black distressed label sticker containing a globe scribble, the text \"{argument name=\"brand name\" default=\"NESS STUDIO\"}\", and a barcode. Along the bottom footer, create a clean horizontal strip with 3 social media icons and handles separated by thin vertical dividers: Instagram, Facebook, and Twitter, each followed by \"@NESS.STUDIO\". The overall style should be edgy, urban, youthful, high-contrast, editorial street fashion, mixing product advertising photography with graffiti poster design, collage textures, and dynamic branding.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-146.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-146.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case146/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case146/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/AlwaveNazca/status/2048147643809865950",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-147",
        "title": "Editorial Osaka Six Sweatshirt Ad",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @_LaurentB",
        "positivePrompt": "A clean editorial fashion advertisement poster on a pale powder-blue studio background with a glossy reflective floor. The composition is vertical and minimal, dominated by oversized bold white condensed sans-serif typography in the background reading “OSAKA SIX:” on the top line and “006 REMAINS” below, filling most of the upper half behind the subject. In the top right corner, small white branding text reads “Designed by ARTTEESHOW.” Centered in the lower middle is an oversized forest-green crewneck sweatshirt standing upright like a sculptural object, with soft heavy cotton fabric, dropped shoulders, extra-long sleeves pooled on the floor, and a small black neck label that reads ARTTEESHOW. On the chest of the sweatshirt is a large abstract collage print made from torn paper fragments in beige, tan, black, gray, white, and vivid red, arranged vertically like layered scraps. Leaning against the right side of the giant sweatshirt is a slim female fashion model with long straight black hair, wearing a matching {argument name=\"sweatshirt color\" default=\"forest green\"} sweatshirt and relaxed wide-leg sweatpants with clean white low-top sneakers. She is posed in profile with a calm detached editorial attitude, one hand in her pocket, her body reclining diagonally against the giant garment, legs extended forward; her face is obscured by a soft rectangular blur for an anonymous art-fashion look. The smaller worn sweatshirt has the same abstract torn-paper collage graphic centered on the chest. At the bottom center, add 2 lines of small white copy text: “Made for comfort, worn for confidence.” and “Because life feels better when someone’s carrying the weight of the world.” The image should feel like a premium conceptual streetwear campaign from the early 1990s reimagined as contemporary luxury advertising, with crisp studio lighting, soft shadows, subtle floor reflections, precise product focus, surreal scale contrast between the oversized sweatshirt and the model, and a polished magazine-poster aesthetic.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-147.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-147.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case147/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case147/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/_LaurentB/status/2048126606313464040",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-148",
        "title": "Editorial Perfume Shot on Moss",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @Salmaaboukarr",
        "positivePrompt": "A high-end editorial product photograph of a single luxury perfume bottle centered in a warm earthy still-life scene. The product is a clear rectangular glass bottle filled with golden amber liquid, topped with a glossy rounded black cap, with a clean white front label that reads \"BYREDO\", \"BAL D’AFRIQUE\", and \"EAU DE PARFUM\". Place the bottle upright on 1 curved piece of pale weathered driftwood, surrounded by a dense carpet of 1 layer of rich green moss covering the foreground and lower frame. Use a minimal studio composition with the product isolated against a smooth warm brown-to-amber gradient background, softly illuminated like sunset light. Light the scene with dramatic directional warm light from the upper right, creating a bright glow on the background, a crisp highlight on the cap, soft reflections in the glass, and gentle shadows across the wood and moss. Keep the framing vertical, the bottle centered slightly low in the composition with generous negative space above, and the overall mood natural, luxurious, earthy, cinematic, and polished like a premium fragrance campaign shot.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-148.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-148.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case148/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case148/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/Salmaaboukarr/status/2048103506125463983",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-149",
        "title": "Editorial Perfume Bottle in Golden Fur",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @Salmaaboukarr",
        "positivePrompt": "A luxurious editorial product photograph of a single perfume bottle nestled into dense, plush faux fur in rich golden caramel and honey-brown tones. Center the composition on one clear oval glass bottle filled with warm amber liquid, with a glossy rounded black cap and a clean white rectangular label. The label text should read {argument name=\"brand name\" default=\"BYREDO\"} at the top, {argument name=\"product name\" default=\"BAL D’AFRIQUE\"} large in the middle, and {argument name=\"product type\" default=\"EAU DE PARFUM\"} in small text near the bottom. Shoot it as a close-up still life with soft studio lighting, subtle highlights on the glass and cap, gentle shadows in the folds of the fur, and a warm cinematic color palette. The bottle should sit slightly embedded in the fur so the surrounding texture frames it from all sides, creating a premium fashion editorial mood, minimal composition, shallow depth of field, crisp focus on the label, and a high-end beauty campaign aesthetic.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-149.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-149.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case149/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case149/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/Salmaaboukarr/status/2048103506125463983",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-150",
        "title": "Luxury Miniature Dubai City Model",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @silentempiredev",
        "positivePrompt": "A hyper-detailed cinematic isometric miniature city model of {argument name=\"landmark tower\" default=\"Burj Khalifa\"} rising dramatically from the center of a square architectural master-plan board, presented like a luxury urban planning maquette on a black background. The composition shows one dominant ultra-tall silver skyscraper in the exact center, surrounded by a dense ring of modern high-rise towers, illuminated roads, bridges, and glowing warm city lights. Curving turquoise-blue water features and artificial lakes wrap around the central district in multiple connected pools and canals, with one large circular fountain-like feature near the tower base and several small island shapes visible in the water. In the lower right quadrant, include a large low-rise complex with rounded geometric roofs and subtle green-lit sections, connected by multilane roads and looping interchanges. The entire city sits on one square beige map board engraved with faint street grids and planning lines, with the board edges clearly visible and slightly raised. Viewpoint is a high three-quarter isometric angle, centered and symmetrical, with the tower extending far upward into negative space. Lighting is dramatic and luxurious: warm golden edge lights on buildings and roads, cool reflections in the water, crisp metallic highlights on the central tower, and a deep black void surrounding the model. Style should feel like a photorealistic architectural visualization mixed with a premium collectible scale model, extremely intricate, sharp, polished, and elegant.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-150.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-150.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case150/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case150/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/silentempiredev/status/2048086378383384773",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-131",
        "title": "Parody Luxury Product Advertisement",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @tonysimons_",
        "positivePrompt": "High-impact parody e-commerce infographic for “{argument name=\"product\" default=\"Four Loko\"}” malt beverage. Foreground: An extreme close-up of a rough, weathered hand holding a tall, brightly colored can of {argument name=\"product\" default=\"Four Loko\"} toward the camera. The can is slightly cold with visible condensation droplets and a loud, chaotic flavor design. The hand and can have a slight macro-lens blur for depth, with the can still reading clearly as the hero product. Central Subject: In the mid-ground, a funny, disheveled {argument name=\"subject\" default=\"homeless-looking man\"} sitting casually on a milk crate in an urban alley. He has a scruffy beard, messy hair, layered worn clothing, and a huge unbothered grin. He should look chaotic but oddly charismatic, like the accidental king of bad decisions. He is posed like a confident lifestyle-ad model, proudly showing off the can. Background & Lighting: A ridiculously polished ad-style backdrop mixed with a grimy city alley setting. Soft-focus urban textures, dumpster shapes, graffiti hints, and scattered clutter in the distance. Add dramatic studio lighting, soft glow, rainbow prism flares, and subtle light leaks to make the whole thing look way too premium for the subject matter. A few blurred {argument name=\"product\" default=\"Four Loko\"} cans can float artistically in the background for extra absurdity. Typography & Layout (Bold sans-serif, white and neon accent styling): Top Center (Background): Massive, bold text reading “{argument name=\"brand name\" default=\"FOUR LOKO\"}” positioned behind the subject. Top Right: Bold text reading “The Champagne of Bad Ideas”. Mid-Left: “Premium chaos and zero self-control” Mid-Right: Large, bold “23” with the text “ounces of terrible decisions.” Bottom-Right: Large, bold “1\" with the text “can to ruin tomorrow.” Optional small callout text near the bottom: “Now with more regret.” Style: Ultra-detailed, 8k parody commercial photography, sharp focus on the can, shallow depth of field, vibrant trashy color palette, clean advertising composition, exaggerated premium product-ad aesthetic, funny visual contrast between polished branding and the wrecked subject.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-131.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-131.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case131/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case131/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/tonysimons_/status/2048057490940596595",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-109",
        "title": "VR Headset Exploded View Poster",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @wory37303852",
        "positivePrompt": "{\n  \"type\": \"exploded view product diagram poster\",\n  \"subject\": \"VR headset\",\n  \"style\": \"clean high-tech 3D render, studio lighting, glowing accents\",\n  \"background\": \"{argument name=\\\"background color\\\" default=\\\"soft purple and blue gradient\\\"}\",\n  \"header\": {\n    \"logo\": \"∞ {argument name=\\\"product name\\\" default=\\\"Meta Quest 3\\\"}\",\n    \"subtitle\": \"{argument name=\\\"main catchphrase\\\" default=\\\"まったく新しい現実を、まったく新しい構造から。\\\"}\"\n  },\n  \"layout\": {\n    \"centerpiece\": \"vertically stacked exploded view of a VR headset showing 9 distinct layers of internal components: outer shell, camera sensors, motherboard with chip, pancake lenses, internal frame, battery packs, side straps, top strap, and facial interface cushion.\",\n    \"callout_labels\": {\n      \"count\": 8,\n      \"left_side\": [\n        \"Snapdragon® XR2 Gen 2\\n圧倒的な処理性能でリアルタイムな体験を。\",\n        \"調整可能なIPD機構\\n幅広いユーザーに快適なフィット感を。\",\n        \"精密設計されたヘッドストラップ\\n快適さと安定性を追求したエルゴノミクス。\"\n      ],\n      \"right_side\": [\n        \"フェイスプレート\\n洗練されたデザインと最適な重量バランス。\",\n        \"トラッキングカメラ\\n高精度な位置トラッキングと環境認識を実現。\",\n        \"パンケーキレンズ\\n薄型設計で広い視野角と鮮明な映像を提供。\",\n        \"高性能バッテリー\\n長時間駆動を支える最適化された電源設計。\",\n        \"柔らかなフェイスインターフェース\\n長時間でも快適な装着感を実現。\"\n      ]\n    },\n    \"footer\": {\n      \"left_text_block\": {\n        \"headline\": \"{argument name=\\\"bottom headline\\\" default=\\\"体験は、構造から進化する。\\\"}\",\n        \"body\": \"一つひとつのパーツに、没入体験を支える最先端テクノロジーとこだわりの設計。Meta Quest 3は、未来を感じさせる体験を内部から生み出しています。\"\n      },\n      \"right_logo\": \"∞ Meta\"\n    }\n  }\n}",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-109.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-109.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case109/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case109/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/wory37303852/status/2045925660401795478",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-168",
        "title": "Luxury poster for fictional AI ad printer",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @nijisora_yuma",
        "positivePrompt": "縦型3:4の、高級商業ポスターを制作してください。\n\nテーマは、架空の新商品広告です。商品は「BRAND PRESS 01（ブランドプレス・ゼロワン）」という、Pollo AIを搭載した架空の広告ポスター生成プリンターです。\n\nこの商品は、まだ存在しないブランド名・商品ジャンル・世界観・ターゲット層を入力すると、Pollo AIがコピー、ビジュアル、レイアウトまで完成された商業広告ポスターを自動生成し、高精細な印刷物としてその場で出力する未来型プリンターです。単なるAIサービスの概念広告ではなく、実際に販売されていそうな架空商品の広告として成立させてください。\n\nメインコンセプト: 「まだないブランドに、最初の一目惚れを。」\n\n商品ビジュアル: 画面中央に実物の商品「BRAND PRESS 01」を大きく配置。未来型の高級プロ用印刷デバイスとして、黒い金属筐体、シルバーのエッジ、透明カバー、青白く発光するAIコア、精密な印刷ヘッド、ローラー、タッチパネル、排紙スロット、ポスター受けトレイを備える。排紙スロットから、架空の高級香水ブランド広告ポスターが紙として大きく出力されている構図。\n\n構図: ややローアングル、斜め45度。背景は暗いネイビーから黒の高級広告制作スタジオ。映画的でドラマチックな高級プロダクト広告。\n\n広告レイアウト: 上部に大きなキャッチコピー、中央にプリンター本体と排出中のポスター、右側に機能説明、左下に価格と発売日、下部にCTA。\n\n入れる文字: 「まだないブランドに、最初の一目惚れを。」 / BRAND PRESS 01 / 「Pollo AI搭載・広告ポスター生成プリンター」 / 「名前だけのアイデアを、完成された商業ポスターとして出力。」 / 「構想、コピー、ビジュアル、印刷まで。1台で。」",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-168.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-168.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case168/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case168/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/nijisora_yuma/status/2049462065639858687",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-169",
        "title": "Luxury chocolate campaign system",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @SPEEDAI07",
        "positivePrompt": "Create a premium, square (1:1) product advertisement for a fictional luxury chocolate brand called Noirvelle Chocolat, inspired by high-end chocolate brands. The ad should feel like a high-end editorial campaign, combining luxury food photography, refined packaging design, and cinematic lighting. Use matte black wrapper, subtle gold foil, elegant serif typography, and realistic product rendering. Generate flavor variants such as Blood Orange Noir, Salted Pistachio Muse, and Raspberry Ember with distinct mood, color palette, ingredients, headline, and supporting copy. Keep the chocolate bar as hero centerpiece with subtle reflections, shallow depth of field, luxury minimalism, and a small CTA: “Shop the drop.”",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-169.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-169.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case169/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case169/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/SPEEDAI07/status/2049459155086500321",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-170",
        "title": "Urban fruit juice ad poster",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @AIwithSarah_",
        "positivePrompt": "Create a premium modern beverage advertisement poster in a vertical 3:4 format featuring a stylish young female model crouching confidently in a bright urban indoor hallway with colorful graffiti wall art on one side and clean minimal architecture on the other. In the foreground, a giant realistic fruit juice bottle is held toward the camera in forced perspective, with fictional branding like “VIVAJUICE”. Add brand logo, tagline, huge bold overlapping typography, four icon-based feature badges, and three smaller bottle variants at bottom right. Use soft natural lighting mixed with commercial studio polish, realistic shadows, shallow depth of field, glossy floor reflections, and a premium energetic eCommerce campaign aesthetic.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-170.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-170.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case170/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/poster_case170/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/AIwithSarah_/status/2049452842931630202",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "gpt-image-2-ad-creative-case-171",
        "title": "Miniature City Diamond Necklace Ad",
        "kind": "image",
        "category": "广告创意",
        "crossCategories": [
            "广告创意"
        ],
        "description": "来源创作者 @ChillaiKalan__",
        "positivePrompt": "Create a hyper-detailed luxury advertising poster in a cinematic miniature-world style. A gigantic royal diamond necklace with intricate gold filigree and massive ruby gemstones stands in the center like an architectural monument. Surround the necklace with a futuristic miniature city built around and inside the jewelry piece, including skyscrapers, elevated highways, bridges, spiral staircases, tiny human figures, luxury billboards, drones, helicopters, and cinematic urban activity. Use a deep crimson red monochrome background with gold and ruby accents. Add premium fashion-ad aesthetics, ultra-realistic textures, glossy reflections, dramatic studio lighting, depth of field, tilt-shift miniature effect, and high-end commercial composition. Include bold elegant typography at the top saying: \"EMBRACE THE EXTRAORDINARY\". Style inspired by luxury jewelry campaigns, surreal city-building concepts, and premium 3D advertising renders. Ultra realistic, 8K, octane render, sharp focus, highly detailed, cinematic shadows, symmetrical composition.",
        "styleTokens": [
            "GPT Image 2",
            "ad-creative"
        ],
        "tags": [
            "GPT Image 2",
            "ad-creative"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#f59e0b",
        "icon": "Camera",
        "previewImage": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-171.webp",
        "previewThumbnail": "/offline-assets/gpt-image-2/images/gpt-image-2-ad-creative-case-171.webp",
        "previewVideo": "",
        "remoteBackupUrl": "https://cheerselfai.com/gpt-image-2/ad_case171/output.jpg.webp",
        "remoteThumbBackupUrl": "https://cheerselfai.com/gpt-image-2/ad_case171/output.jpg.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "GPT Image 2 提示词库",
        "sourceUrl": "https://x.com/ChillaiKalan__/status/2053310109678535000",
        "author": "X 创作者",
        "recommendedParams": {
            "model": "GPT Image 2",
            "aspectRatio": "1:1"
        }
    },
    {
        "id": "sb-baby-care",
        "title": "母婴商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "请生成一张横版16:9的母婴用品广告人物产品设定板 / 产品一致性参考板。\n\n项目标题：《半夜喂奶不慌张》\n\n【核心目标】\n\n这张图不是故事板，而是婴儿恒温奶瓶、新手爸妈、宝宝、夜间喂养动作、产品细节和卧室场景设定板。\n\n用于后续 Seedance 视频生成时保持人物形象、产品外观、奶瓶细节、夜间光影和整体母婴用品广告风格一致。\n\n【整体风格】\n\n母婴用品广告、婴儿恒温奶瓶、夜间喂养、新手爸妈、温柔安心、干净卧室、柔和夜灯、真实生活感、电商广告质感、低饱和电影感。\n\n不是夸张医疗广告，不是焦虑恐吓广告，不是土味促销，不是低幼卡通，而是真实、可信、温柔、有质感的母婴用品短片。\n\n【画面结构】\n\n整体为专业母婴用品广告前期视觉设定板，浅色或中性暖色背景，清晰网格排版，细边框，像母婴品牌广告 / 电商短视频前期美术设定页。\n\n必须包含以下模块：\n\n1. 妈妈角色设定\n\n展示：\n\n- 正面半身\n\n- 侧面半身\n\n- 面部特写\n\n- 半夜起身拿奶瓶的姿态\n\n- 抱着宝宝喂奶的姿态\n\n- 看着宝宝安静下来的温柔表情\n\n角色设定：\n\n妈妈，28-35岁左右，新手妈妈，气质温柔、真实、略带疲惫但稳定。穿浅色家居睡衣或针织开衫，头发自然挽起或松散披发，妆容自然。重点体现夜间照顾宝宝的真实生活感，不要过度精致摆拍。\n\n2. 爸爸角色设定\n\n展示：\n\n- 正面半身\n\n- 侧面半身\n\n- 手持奶瓶递给妈妈的姿态\n\n- 调整夜灯或查看温度显示的姿态\n\n- 在旁边轻声陪伴的姿态\n\n角色设定：\n\n爸爸，30-38岁左右，新手爸爸，穿浅色家居服，神情关心、安静、可靠。出镜不抢主角，主要表现家庭协作和夜间陪伴。\n\n3. 宝宝设定\n\n展示：\n\n- 被妈妈抱在怀里的侧面姿态\n\n- 躺在婴儿床中的安全姿态\n\n- 安静喝奶的状态\n\n- 小手轻握奶瓶边缘的细节\n\n宝宝设定：\n\n婴儿约6-12个月，画面温柔、自然、安全，避免任何危险姿势。宝宝不需要过度夸张表情，重点表现从轻微哭闹到安静放松的变化。\n\n4. 产品主体设定\n\n展示：\n\n- 婴儿恒温奶瓶正面\n\n- 45度角产品图\n\n- 奶嘴细节\n\n- 瓶身刻度\n\n- 温度显示区域\n\n- 防滑握持区域\n\n- 瓶盖细节\n\n- 床头夜灯下的产品静物图\n\n产品设定：\n\n一只简洁高级的婴儿恒温奶瓶，奶白色或透明半磨砂瓶身，柔和圆润轮廓，温度显示区域带微弱柔光，刻度清晰但不要出现乱码。材质看起来干净、安心、亲肤，整体高级、温和、适合母婴场景。\n\n5. 卖点视觉设定\n\n展示：\n\n- 恒温显示\n\n- 夜间方便\n\n- 握持舒适\n\n- 温度稳定\n\n- 材质安心感\n\n- 清洗方便\n\n- 适合新手爸妈\n\n- 床头随手取用\n\n6. 场景元素设定\n\n展示：\n\n- 夜晚主卧\n\n- 婴儿床\n\n- 床头柜\n\n- 柔和夜灯\n\n- 奶瓶加热底座或收纳托\n\n- 小毛巾\n\n- 婴儿毯\n\n- 温奶区\n\n- 窗帘\n\n- 暖色床品\n\n- 干净安静的家庭氛围\n\n7. 色板与风格说明\n\n色彩：\n\n奶油白、浅米色、柔和暖黄、婴儿粉、浅灰、木色、夜灯金、淡蓝灰。\n\n风格关键词：\n\n母婴用品广告、婴儿恒温奶瓶、夜间喂养、新手爸妈、温柔安心、恒温显示、握持舒适、干净卧室、柔和夜灯、真实生活感、电商广告感。\n\n【限制】\n\n不要真实品牌Logo。\n\n不要土味促销大字报。\n\n不要夸张医疗功效。\n\n不要写“治疗”“保证睡整夜”等绝对化表达。\n\n不要制造育儿焦虑。\n\n不要危险抱娃姿势。\n\n不要让宝宝处于不安全睡眠环境。\n\n不要低幼卡通风。\n\n不要二次元动漫风。\n\n不要乱码文字。\n\n不要真实字幕。\n\n不要水印和Logo。\n\n整体必须像真实母婴用品广告产品设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-baby-care.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-baby-care.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-1",
        "title": "客厅情景喜剧：深夜老鼠惊魂16镜线稿故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "阿杰与小敏吃薯片看恐怖片、冰箱制冰声惊跳起跳与捕鼠夹晾袜笑场的16镜情景喜剧完整故事板。",
        "positivePrompt": "故事 = 一部情景喜剧，两人刚看完一部恐怖片，正努力用薯片缓解紧张情绪，发生的老鼠事件让生活变得更有趣味。\n场景：客厅沙发，深夜。\n人物：阿杰（人物形象必须使用图 1）、小敏（人物形象必须使用图 2）\n限制：故事板全部生成线稿图。\n1. 两人紧抱薯片、神情紧张地坐在沙发上看着恐怖片的远景\n2. 阿杰特写，他忽然僵住：“厨房…… 是不是有老鼠？”\n3. 小敏特写，瞳孔地震：“绝对不行！不许过去！”\n4. 阿杰特写，强装镇定：“哎呀，别这样，我可是男人……”\n5. 厨房传来一声塑料响，两人同时抱在一起尖叫的远景\n6. 小敏的手特写，伸进薯片袋，只抓出一点碎渣\n7. 两人全景，她把碎渣撒向阿杰头顶：“你这个坏蛋！租一楼方便了老鼠！”\n8. 阿杰顶着薯片渣的委屈特写：“方便拿快递也是真的……”\n9. 小敏特写，突然眼睛一亮：“等等，你去年买的那个捕鼠夹呢？”\n10. 阿杰特写，眼神躲闪：“那个…… 我拿去晾袜子了。”\n11. 小敏特写，难以置信地愣了两秒：“你把捕鼠夹当晾袜架？”\n12. 阿杰特写（笑场）：“它张力太好了！夹一只袜子从不掉！”\n13. 两人全景，小敏抄起遥控器当武器：“走！一起去看！”\n14. 阿杰特写，拿薯片当盾牌举在脸前：“好吧，听你的……”\n15. 两人侦察兵般弓腰前进的远景，突然冰箱制冰声响起，两人原地起跳\n16. 大远景两人蹲在沙发上爆笑，薯片被跳起来的阿杰踩碎一地\n创建一个电影制作板 / 视觉规划表，比例 16:9，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分为清晰标记的部分。\n包含：\n- 共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背景。\n- 角色与风格参考部分：人物形象严格按参考图设置生成。一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。\n- 环境和场景设计部分：一个具有戏剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的拍摄类型。\n- 故事板部分：一系列编号的帧（大约 16 个镜头）展示场景的进展。每个帧包括：\n    - 摄像机类型 / 镜头感觉\n    - 镜头大小（广角、中景、特写、微距）\n    - 运动方式（静态、跟踪、手持等）\n    - 动作和情绪进展的简要描述\n- 灯光 / 情绪 / 风格备注：与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线质量的变化。\n- 情绪和关键词块：指导作品的简洁情绪基调主题描述列表。\n- 音频 / 音调部分：环境声音、音乐风格和整体声音氛围的指示。\n- 电影摄影笔记：包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。\n整个版面应感觉连贯、电影化且专业设计 —— 就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "情景喜剧",
            "16镜线稿",
            "深夜客厅",
            "幽默生活"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-01.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-01.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-1",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-10",
        "title": "古风甜宠短剧：少年伴读书童身份戳穿故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "浴桶水汽氤氲、女扮男装苏软软僵立、太子萧煜辨认、拽入手腕、耳语撩拨与慢镜定格的古风甜宠故事板。",
        "positivePrompt": "男主：\n8K超高清，电影级画质，超写实人像摄影，镜头特写，一位年轻俊美的古风少年，面容精致柔和，下颌线清晰\n利落，高鼻梁，皮肤白皙细腻，五官清冷又带着傲娇慵懒感。深棕色的眼眸，黑色长发微乱，半束起，侧边编有一条细发辫，发丝被风吹得有些凌乱，身着白纱在浴池中，暖金色逆光勾勒人物轮廓，柔和的光晕，朦胧氛围感，浅景深，背景虚化，整体暖调电影调色，光影柔和通透，发丝发光，皮肤质感真实细腻，发丝细节清晰，慵懒又傲娇古风美少年，电影感氛围，写实渲染，极致细节。\n女主：\n8K超高清，电影级画质，超写实人像摄影，镜头特写，古风女扮男装的俊美少年，面容清冷又带着柔媚感，骨相立体，下颌线利落，皮肤白皙细腻，带点淡淡的桃花腮红，眼尾微微泛红，深棕眼眸含着水光，带着破碎感，眉形纤细如柳叶，唇色是水嫩的红，黑色长发高束，身着浅金色镶红边的古风劲装，领口微敞，露出精致的锁骨，暖金色逆光勾勒发丝轮廓，柔光光晕，朦胧氛围感，浅景深背景虚化，整体暖调柔焦电影调色，光影通透柔和，皮肤质感真实细腻，发丝细节清晰，清冷又柔媚的女扮男装古风少年，精致五官，极致细节，电影感氛围，写实渲染\n\n### 故事板提示词：更换橙色色标注文字为自己要讲的故事\n故事 =古装甜宠故事，苏软软女扮男装，给太子萧煜当伴读书童，被萧煜戳穿了假身份。\n0-2s（近景）：水汽氤氲，萧煜在浴桶，转头见屏风外男装苏软软僵立，苏软软瞳孔骤缩，萧煜水珠滑锁骨、眯\n眼辨认，萧煜台词：“ ”；\n2-4s（特写+中景切换）：苏软软耳尖通红捂眼转身，萧煜从浴桶站起，萧煜长臂攥住她手腕，苏软软踉跄被拽\n回，苏软软台词：“殿下恕罪！”；\n4-7s（中景）：苏软软被拽进浴桶，男装半透，萧煜从背后环住她，苏软软僵立，萧煜收臂、勾开她束发带，萧\n煜台词：“跑什么。”；\n7-10s（近景·耳语）：苏软软长发散落，萧煜咬她耳尖，气息拂过耳廓，苏软软攥紧浴桶边，萧煜唇滑向脸颊，\n萧煜台词：“可知本宫想的什么？”，苏软软台词：“殿下勤政？”；\n10-13s（特写·对视+中景）：萧煜翻转她抵在浴桶壁上，鼻尖相抵，呼吸交缠，苏软软手抵他胸口又缩回，萧煜\n按住她的手贴心口，萧煜台词：“想的是你，想这浴桶够不够两人用。”；\n13-15s（慢镜定格）：萧煜俯身吻下，苏软软睁眼见他眼底光影，苏软软攥住他湿发，萧煜睫毛水珠颤落，苏软\n软内心OS：“他……他什么时候发现的？”。\n避免场景过于相似，创建一个电影制作板/视觉规划表，比例16:9，展示短片或商业广告的完整概念。布局应简\n洁、基于网格，并分为清晰标记的部分。\n包含：\n共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背景。 角色与风格参考部分：\n一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和配饰参考。强调身份的一致\n性，同时允许在特定场景中进行细微变化。\n环境和场景设计部分： 一个具有戏剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动\n路径。包括摄像机位置和沿路线标注的拍摄类型。\n故事板部分： 一系列编号的帧（大约6个镜头）展示场景的进展。每个帧包括：摄像机类型/镜头感觉 镜头大小\n（广角、中景、特写、微距） 运动方式（静态、跟踪、手持等） 动作和情绪进展的简要描述\n灯光/情绪/风格备注： 与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光\n线质量的变化。\n情绪和关键词块：指导作品的简洁情绪基调主题描述列表。 音频/音调部分： 环境声音、音乐风格和整体声音\n氛围的指示。\n电影摄影笔记： 包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。 整个版面应感觉连贯、电影化且专\n业设计——就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "古风甜宠",
            "女扮男装",
            "浴池氤氲",
            "耳语撩拨",
            "逆光电影感"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-10.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-10.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-10",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-2",
        "title": "客厅日常情景喜剧：吃薯片与外出觅食分镜故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "两人坐在沙发吃薯片讨论等下吃什么、扔薯片互动与笑场爆笑日常的经典情景喜剧故事板。",
        "positivePrompt": "故事 = 一部情景喜剧，有两个人一起坐在沙发上讨论在等下出去吃什么，包括笑场\n1. 两人坐在沙发上吃薯片的远景\n2. 两人特写，男人说“等下出去吃寿司可以吗？”\n3. 女士特写：\"绝对不行\"\n4. 男性特写：\"哎呀，别这样\"\n5. 她的手特写，伸手去拿薯片\n6. 两人全景，她把薯片扔向他，说：\"你这个坏蛋\"\n7. 特写男子说\"好吧，听你的\"\n8. 大远景两人笑 避免场景过于相似 避免场景过于相似\n创建一个电影制作板/视觉规划表，比例16:9，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分\n为清晰标记的部分。 包含： 共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背\n景。 角色与风格参考部分： 一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和\n配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。 环境和场景设计部分： 一个具有戏剧性\n自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的\n拍摄类型。 故事板部分： 一系列编号的帧（大约 8 个镜头）展示场景的进展。每个帧包括：摄像机类型/镜头\n感觉 镜头大小（广角、中景、特写、微距） 运动方式（静态、跟踪、手持等） 动作和情绪进展的简要描述 灯\n光/情绪/风格备注： 与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线\n质量的变化。 情绪和关键词块：指导作品的简洁情绪基调主题描述列表。 音频/音调部分： 环境声音、音乐风\n格和整体声音氛围的指示。 电影摄影笔记： 包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。 整个\n版面应感觉连贯、电影化且专业设计——就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "情景喜剧",
            "多视角网格",
            "日常生活",
            "欢快笑场"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-02.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-02.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-2",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-3",
        "title": "校园日常喜剧：教室讨论吃什么趣味故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "教室吃薯片讨论烤肉与麻辣烫、扔薯片抗议与笑场的校园日常幽默分镜故事板。",
        "positivePrompt": "故事 = 一部校园喜剧，有两个人一起坐在教室讨论等下出去吃什么，包括笑场\n1. 两人坐在教室吃薯片的远景\n2. 两人特写，男人说\"出去吃烤肉怎么样？\"\n3. 女士特写：\"太腻了\"\n4. 男性特写：\"那麻辣烫？\"\n5. 她的手特写，伸手去拿薯片\n6. 两人全景，她把薯片扔向他，说：\"你能不能换个花样\"\n7. 特写男子说\"好吧，你定\"\n8. 大远景两人笑\n创建一个电影制作板/视觉规划表，比例16:9，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分\n为清晰标记的部分。 包含： 共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背\n景。 角色与风格参考部分： 一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和\n配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。 环境和场景设计部分： 一个具有戏剧性\n自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的\n拍摄类型。 故事板部分： 一系列编号的帧（大约 8 个镜头）展示场景的进展。每个帧包括：摄像机类型/镜头\n感觉 镜头大小（广角、中景、特写、微距） 运动方式（静态、跟踪、手持等） 动作和情绪进展的简要描述 灯\n光/情绪/风格备注： 与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线\n质量的变化。 情绪和关键词块：指导作品的简洁情绪基调主题描述列表。 音频/音调部分： 环境声音、音乐风\n格和整体声音氛围的指示。 电影摄影笔记： 包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。 整个\n版面应感觉连贯、电影化且专业设计——就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "校园喜剧",
            "教室情境",
            "微距网格",
            "青春幽默"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-03.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-03.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-3",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-4",
        "title": "仙侠玄幻剑决：山壁受击御剑破空分镜故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "女主被击飞砸入山壁、尘土飞扬、剑诀御剑高空舞动与淡蓝剑气破空轰击黑雾的玄幻动作故事板。",
        "positivePrompt": "故事 =女主被击飞，倒飞砸在身后的山壁上。周围扬起尘土。突然，女主从尘土中飞出，手掐起剑诀，御剑而起飞向高空，长剑围绕女主身体四周舞动，随后在女主停止上升后，飞剑伴随着淡蓝色剑气破空而出，以几块的速度向远方的黑雾攻击而去。\n避免场景过于相似 创建一个电影制作板/视觉规划表，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分为清晰标记的部分。 包含： 共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背景。 角色与风格参考部分： 一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。 环境和场景设计部分： 一个具有戏剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的拍摄类型。 故事板部分： 一系列编号的帧（大约 8 个镜头）展示场景的进展。每个帧包括：摄像机类型/镜头感觉 镜头大小（广角、中景、特写、微距） 运动方式（静态、跟踪、手持等） 动作和情绪进展的简要描述 灯光/情绪/风格备注： 与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线质量的变化。 情绪和关键词块：指导作品的简洁情绪基调主题描述列表。 音频/音调部分： 环境声音、音乐风格和整体声音氛围的指示。 电影摄影笔记： 包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。 整个版面应感觉连贯、电影化且专业设计——就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。 将宽高比设为 16:9，并且标注每个镜头的时长（秒）这是一个以“清晰排版”和“文字可读性”为优先的专业故事板设计。所有文字必须清晰锐利、准确可读，禁止乱码和伪文字。分区标题、镜头编号、角色角度标签必须明显放大。每个分镜中的文字说明必须非常简短，控制在1到2行内，避免长段落。采用干净背景、高对比度文字、整齐网格布局和充足留白，确保整张板上的中文说明一眼可读。",
        "styleTokens": [
            "仙侠玄幻",
            "御剑飞行",
            "淡蓝剑气",
            "高空舞剑"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-04.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-04.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-4",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-5",
        "title": "街头篮球训练：4x4网格16步动作解构示意图",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "4x4网格16步彩铅手绘街球教学示意图，身体姿势、运球轨迹、脚步站位与15秒3D写实街球广告。",
        "positivePrompt": "这是一份用于街球训练的彩色铅笔画风格的动作示意图。布局为16个步骤，呈4x4的网格结构。每个步骤都对应一个独特的篮球动作。主角是一名年轻的篮球运动员，他留着短而卷曲的发型，展现出自信的街头风格。他穿着NIKE的篮球衫、黑色短裤、连脚袜和高帮运动鞋。在每一个画面中，他都在与篮球进行互动。风格上，采用手工绘制的彩色铅笔画，色调柔和，能看出铅笔的纹理。线条略带草图风格，但整体很清晰。整体色调温暖，同时带有鲜艳的橙色点缀。各个动作之间有明显的区别:每个动作的身体姿势、球的摆放位置和脚的站位都不一样。具体步骤如下:\n1.站立时用右手运球;\n2.低身姿势下，从左向右交叉运球;\n3.让球在两腿之间滚动;\n4.将球甩到背后;\n5.持球停在髋部，稍作停顿;\n6.双脚大幅交叉，保持宽站姿;\n7.带着球完成360度旋转;\n8.先将球向外推，再拉回;\n9.踢出长长的横向步幅;\n10.快速停下，球保持在较低位置\n11.后退一步，同时让球也向后移动。\n12.用八字形步伐绕过双腿;\n13.突然向前冲的同时低身运球;\n14.以高速运球进入冲刺状态;\n15.全速冲向篮筐;\n16.最后动作:将球高高举过头顶，单手握球。\n每幅图中的球员轮廓和体型都必须与其他画面有明显区别。每帧画面中都有清晰的箭头，标明球的运动方向、身体的移动轨迹以及脚部的位置。\n设计风格:现代街头篮球风格，简洁大气的信息图表布局，柔和的阴影效果。步骤编号为1至16，每幅画面下方都有简短的文字说明，解释相应的动作。标题位于顶部-“篮球技巧-16次投篮机会-15秒计时--街头篮球风格”。\n场景:纽约市户外的硬地篮球场，周围有铁丝网围栏、涂鸦墙;光线为黄金时刻的光线效果，地面为混凝土材质，背景元素较为简洁。\n质量:细节丰富、构图清晰、布局合理，堪称一张优秀的街头篮球教学海报。\n保持原有提示词格式，只改变可以改变的变量，其他固定不变，结合我上传的3d角色人物生成一份用于街球训练的彩色铅笔画风格的动作示意图;",
        "styleTokens": [
            "街头篮球",
            "彩色铅笔画",
            "4x4网格",
            "动作解构",
            "3D写实动画"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-05.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-05.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-5",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-6",
        "title": "专业机车竞速：城市街道极速漂移16镜故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "赛车手穿戴头盔、启动轰鸣、弯心贴地过弯火花与夜间赛道降档漂移的16镜电影级竞速故事板。",
        "positivePrompt": "故事=这是一段赛车骑手的专业竞速展示视频。\n场景:城市街道。\n人物:青年(人物形象必须使用图1，衣服穿着必须根据剧情中的设定\n剧情内容如下:\n镜头1:特写·静态，黑暗中，一双手套的手指缓缓收紧。碳纤维与皮革的材质光泽细腻，指尖有磨损的痕迹。头盔安静地放置在面前，深色镜片倒映出机库的顶灯。\n镜头2:中景·慢动作起幅，他拿起头盔。动作不急不躁，像执行一个仪式。手腕翻转时，可以看见手套背部坚硬的护壳结构。背景中，赛车的轮廓在阴影里隐约浮现。\n镜头3:大特写·固定机位，头盔穿过画面中心，稳稳套下。镜片“咔嗒”一声扣紧，声音清脆。视线被深色镜片吞没，只剩对面赛车轮廓上的一丝高光。\n镜头4:近景·甩镜头跟拍，他俯身，拉拽赛车服的拉链。红色竞技服上布满赞助商Log0与耐磨滑块，布料紧绷，勾勒出肩背线条。拉链一拉到底，胸膛起伏-次。\n镜头5:低角度仰拍·横移，他走向赛车。靴底踩过水泥地面每一步都坚实。镜头从靴子摇到腰间，再摇到低垂的头盔。赛车尾部的单摇臂与排气管进入画面边缘。\n镜头6:细节蒙太奇·快切，三组快速切换:1插钥匙，仪表盘灯光自检亮起，指针扫过表底。2戴手套，掌心紧扣车把。3启动按钮按下，引擎第一声低吼，画面微微震动，\n镜头7:侧面特写·慢动作。车身侧倾，他跨坐上去。动作流畅如一体。俯身趴下，胸口贴住油箱。曲轴箱边盖映出他头盔的一角倒影，逐渐稳定。\n镜头8:主观视角·速度感，头盔镜片内视角。赛道白线从中央向两侧飞速后掠。转速表指针猛烈敲击红线区，换挡提示灯依次亮起猩红色。引擎声高亢啸叫。\n镜头9:大远景·航拍感。赛车在赛道上划出高速弧线。带刹车进弯瞬间，尾灯拉成一道红色光痕。车身低得几乎贴地，膝盖滑块擦出白色烟雾。背景看台虚化。\n镜头10:中景·低位路肩视角赛车轮毂从镜头旁高速碾过，胎屑飞溅。骑手身体大幅度侧挂，头盔几乎接触地面，肘部滑块摩擦火花。弯心路肩的黄红路缘石急速后退。\n镜头11:主观视角(头盔内侧)，镜片略微抬起一瞬。前方是高速隧道入口，黑暗迅速吞没光线。仪表背光是唯一照明，照出他紧绷的下颌线。呼吸声变得沉重而清晰。\n镜头12:正面特写·慢动作，冲出隧道。强光瞬间铺满镜片，反光中看不清眼睛，只能看见对面山壁的倒影。水汽在镜片外侧被风吹散，像撕裂一道帷幕。\n镜头13:近景·手持跟拍，进入城市夜间赛道。路灯眩光在镜片上拉出条状光轨。他连续快速降档，每一下都伴随补油声。刹车碟因高温变为暗红色，照亮前轮。\n镜头14:远景·空旷街道，从一个低速发卡弯出来，后轮在出弯瞬间短暂打滑空转，留下一条黑色胎痕。烟尘中，车身短暂扭曲后恢复笔直，加速冲向下一个直道。\n镜头15:中景·推轨横移，赛车滑行进入维修区。速度逐渐降低，他抬起身体，坐直。引擎声从高频回落为沉稳怠速。头盔缓慢转向侧面，看向某个方向一-那里什么都没有，又好像什么都有。\n镜头16:低角度特写·一个连贯动作，停车瞬间。左脚从脚踏上移开，准确踩下侧支架。金属支脚以干净利落的力道“咔”一声撑开地面。他松开离合，车身微沉。下一秒，从右边下车，拔钥匙，转身一-头盔镜片内，视线穿过画面，望向观众。安静。轰鸣声消失。只剩下金属冷却的细微响声，\n避免场景过于相似\n创建一个电影制作板/视觉规划表，比例16:9，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分为清晰标记的部分。包含:共享创意指导(顶部栏):整体限制，如镜头数量、统一的调色板和一般的环境背景。角色与风格参考部分:人物形象严格按参考图设置生成。一个从多个角度展示的模型(正面、背面、侧面、特写、放松姿态)，配有服装和配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。环境和场景设计部分:一个具有戏剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的拍摄类型。故事板部分:一系列编号的帧(大约16个镜头)展示场景的进展。每个帧包括:摄像机类型/镜头感觉镜头大小(广角、中\n景、特写、微距)运动方式(静态、跟踪、手持等)动作和情绪进展的简要描述灯光/情绪/风格备注:与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线质量的变化。情绪和关键词块:指导作品的简洁情绪基调主题描述列音频/音调部分:环境声音、音乐风格和整体声音氛围的指示。电影摄影笔记:包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。整个版面应感觉连贯、电影化且专业设计一-就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "机车竞速",
            "城市夜赛",
            "弯心火花",
            "16镜蒙太奇",
            "引擎声浪"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-06.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-06.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-6",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-7",
        "title": "超时空超市格斗：子弹时间与极限残影16镜故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "冷色调超市荧光下，人类极限爆发速度、蛛网地砖裂纹、护甲内陷与子弹时间连击的16镜硬核格斗。",
        "positivePrompt": "故事=这是一段高速移动的动态模糊与子弹时间的冲击感打斗视频。场景:超市。\n人物:青年(人物形象必须使用图1，衣服穿着必须根据剧情中的设定)\n剧情内容如下:\n[总体风格与氛围】\n电影感写实、冷色调超市荧光，青年拥有顶尖人类极限的速度(启动爆发带残影)，打击瞬间触发子弹时间特效。武装人员未来感十足，面部完全被战术面具遮挡。\n[16镜头分镜脚本】(总长15秒)\n镜头1(1秒)\n中景。超市货架通道，青年身着深色连帽衫，正伸手从货架上拿起一袋零食查看。\n镜头2(0.8秒)\n广角。超市自动门猛然滑开，十几个全副武装的黑甲作战人员冲入，作战头盔下是纯黑战术面罩，脸部完全不可见，突击步枪枪口齐刷刷平举。\n镜头3(0.5秒)\n特写。青年眼神斜瞥向门口，表情瞬间由闲适转为绝对的镇定，缓缓放下手中零食。\n镜头4(0.7秒)\n过肩视角。十几支黑洞洞的枪口共同指向青年后背，激光指示器的红点密集地落在他心脏位置。\n镜头5(1.2秒)\n子弹时间特效开始。青年闭眼一秒后睁眼，周围时间流速急剧变慢他身体重心微降，右脚蹬地的一瞬，地砖出现蛛网裂纹，裂纹缓慢扩散。\n镜头6(0.5秒)\n极速摇镜。青年原地留下一道破碎的残影，本体已如贴地飞行般闪向最近的一名武装人员，货架上的商品被劲风带起悬空。\n镜头7(0.6秒)\n主观追踪镜头。以超高速侧面跟拍青年在过道冲刺，身体拖出流线型速度线，画面边缘因极速产生拉伸畸变，0.2秒内逼近第一个目标。\n镜头8(1.5秒)\n子弹时间特写。青年一记冲拳轰在第一个敌人腹腔护甲上。时间几乎凝固，护甲以拳头接触点为中心内陷形变，敌人身体被击退腾空，双手脱力松开步枪，战术面罩挤出气流。\n镜头9(1.2秒)\n子弹时间延续。青年顺势转身，一记回旋鞭腿扫向第二人颈部。慢动作下，腿如钢鞭划过空气，击中的刹那，头盔侧面战术手电碎裂，晶莹碎片缓缓飞散，敌人身体开始侧向折叠。\n镜头10(0.8秒)\n瞬间恢复正常速度。被拳击的敌人重重砸倒一排购物篮，被踢中的敌人横飞进货架，商品哗然崩塌。青年已不在原地。\n镜头11(0.7秒)\n高速双连击。画面快速横摇，青年同时出现在第三、四人中间，左肘击打一人面罩，右掌劈向另一人持枪手腕，动作快到出现多重残影，两个敌人同时失衡。\n镜头12(1秒)\n子弹时间仰拍。青年跃起，膝盖顶向第五人下巴。时间变慢，青年腾空姿态舒展，膝盖接触下巴瞬间，面罩出现凹陷，敌人口中喷出细微唾液，身体被竖直顶起离地。\n镜头13(0.9秒)\n窄通道穿梭。青年以极限跑酷般的高速在人群中Z字形穿插，经过货架时脚尖轻点，将第六、七人用肩撞和扫腿快速放倒，背景中商品纸盒漫天飞舞。\n镜头14(1.2秒)\n子弹时间终结技。青年闪到最后一名敌人身前，右手快如闪电抓住其步枪枪管，在慢速中直接将金属枪管捏至弯曲，左手借力将其整个人抡翻过头摔向地面，敌人身体悬浮在半空缓慢划出弧线。\n镜头15(1.6秒)\n恢复正常。最后一名敌人砰然落地，激起尘埃。所有十余名武装分子横七竖八倒在过道。青年在漫天缓慢飘落的商品包装纸中站定，神态平静，伸手轻拍肩头灰尘。\n镜头16(1.8秒)\n固定全景。青年走回货架前，弯腰捡起最初那袋零食，若无其事走向收银台。身后狼藉的过道顶灯闪烁，映出他修长淡定的影子。画面渐暗，结束。\n避免场景过于相似\n创建一个电影制作板/视觉规划表，比例16:9，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分为清晰标记的部分。\n包含:共享创意指导(顶部栏):整体限制，如镜头数量、统一的调色板和一般的环境背景。\n角色与风格参考部分:人物形象严格按参考图设置生成。一个从多个角度展示的模型(正面、背面、侧面、特写、放松姿态)，配有服装和配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。环境和场景设计部分:一个具有戏剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的拍摄类型。\n故事板部分:一系列编号的帧(大约16个镜头)展示场景的进展。每个帧包括:摄像机类型/镜头感觉镜头大小(广角、中景、特写、微距)运动方式(静态、跟踪、手持等)动作和情绪进展的简要描述灯光/情绪/风格备注:与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线质量的变化。情绪和关键词块:指导作品的简洁情绪基调主题描述列表。音频/音调部分:环境声音、音乐风格和整体声音氛围的指示。电影摄影笔记:包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。整个版面应感觉连贯、电影化且专业设计一-就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "子弹时间",
            "极速残影",
            "超市冷光",
            "蛛网裂纹",
            "近身搏击"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-07.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-07.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-7",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-8",
        "title": "异能觉醒重力倒流：半透明凤凰法相显化故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "废墟中站定、碎石逆重力缓缓升起、紫色能量流动、双手结印与天地间半透明巨型凤凰法相显化。",
        "positivePrompt": "故事 =遍体鳞伤的主角在废墟中艰难站定，汗水顺着手臂滴落。 突然，周围的碎石违背重力缓缓升起，\n空气中出现紫色的能量流动。 主角双手结印，怒吼而出。由于能量过强，他的轮廓开始产生视觉错位。\n身后巨大的半透明凤凰法相开始显现。 巨大的法相连接地面，屹立于天地之间。 它的身体由无发光洁的\n几何面构成，折射着光芒，而主角只是脚下渺小的黑点。\n避免场景过于相似 创建一个电影制作板/视觉\n规划表，比例16:9，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分为清晰标记的部\n分。 包含： 共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背景。 角色\n与风格参考部分： 一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和配\n饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。 环境和场景设计部分： 一个具有戏\n剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿\n路线标注的拍摄类型。 故事板部分： 一系列编号的帧（大约 8 个镜头）展示场景的进展。每个帧包\n括：摄像机类型/镜头感觉 镜头大小（广角、中景、特写、微距） 运动方式（静态、跟踪、手持等） 动\n作和情绪进展的简要描述 灯光/情绪/风格备注： 与灯光条件、氛围和纹理相关的视觉示例和简短描述。\n包括一天中不同时间的过渡和光线质量的变化。 情绪和关键词块：指导作品的简洁情绪基调主题描述列\n表。 音频/音调部分： 环境声音、音乐风格和整体声音氛围的指示。 电影摄影笔记： 包括镜头特性、运\n动风格和后期处理感觉的总体视觉哲学。 整个版面应感觉连贯、电影化且专业设计——就像导演的预制\n作指南，能一眼传达出基调、节奏和视觉叙事。 将宽高比设为 16:9",
        "styleTokens": [
            "重力倒流",
            "紫色能量",
            "凤凰法相",
            "天地屹立",
            "史诗异能"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-08.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-08.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-8",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-case-9",
        "title": "民国抗战谍战短片：梨园戏台以命换命决绝故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "戏班后台与寿宴戏台之间，整理龙凤戏服、暗下毒药、夫妻对视合唱立咒与戏楼火海坍塌的悲壮故事板。",
        "positivePrompt": "故事=一部民国抗战题材悲剧短片，“梨园双星”在日军寿宴前夕，于戏台与后台之间完成一场以命换命的复仇，\n包括压抑、对视、诀别与烈火中的唱词。\n1)后台远景，两人坐在昏暗的戏班后台，一边整理戏服一边沉默，对面摆着日军送来的寿宴酒菜。\n2)男人特写，他低声说道:“今夜这一场戏，唱完就再也回不来了。\"\n3)女人特写，她缓缓抬眼:\"只要能让他们偿命，值了。\n4)近景，男人从抽中拿出毒药，倒入酒壶:\"等他们举杯的时候，就是报仇的时候。\n5)女人手部特写，她轻轻抚摸戏服上的凤冠流苏，说:“戏要唱完，魂也得留在这戏台上。\n6)宴席全景，日军军官大笑饮酒，两人在台上唱戏，对视一眼。\n7)男人特写，看着台下逐渐毒发的日军军官，低声唱道:“今我二人。\"\n8)女人特写，她忽然抢了戏词，高声唱道:\"今我夫妻二人”，女人眼含热泪却神情决绝，男人侧头望向她，嘴角\n带着释然与悲壮。然后男女一起和合唱:\"立咒于此台，以此身，此魂，镇压，尔等罪人!“\n9)大远景，戏台烈火燃起，两人穿着戏服站在火海中央，台下日军挣扎倒地，戏楼在火光中轰然坍塌。\n避免场景过于相似 ，创建一个电影制作板/视觉规划表，比例16:9，展示短片或商业广告的完整概念。布局应简\n洁、基于网格，并分为清晰标记的部分。\n包含：\n共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背景。\n角色与风格参考部分：一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和配饰参考。强调身份的一致性，同时允许在特定场景中进行细微变化。\n环境和场景设计部分： 一个具有戏剧性自然特征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的拍摄类型。\n故事板部分： 一系列编号的帧（大约6个镜头）展示场景的进展。每个帧包括：摄像机类型/镜头感觉 镜头大小（广角、中景、特写、微距） 运动方式（静态、跟踪、手持等） 动作和情绪进展的简要描述\n灯光/情绪/风格备注： 与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不同时间的过渡和光线质量的变化。\n情绪和关键词块：指导作品的简洁情绪基调主题描述列表。 音频/音调部分： 环境声音、音乐风格和整体声音氛围的指示。\n电影摄影笔记： 包括镜头特性、运动风格和后期处理感觉的总体视觉哲学。 整个版面应感觉连贯、电影化且专业设计——就像导演的预制作指南，能一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "民国谍战",
            "梨园戏班",
            "龙凤戏服",
            "以命换命",
            "戏台火海"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-09.webp",
        "previewThumbnail": "/images/inspirations/high/vid-storyboard-case-09.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "linkedPresetId": "seedance-storyboard-case-9",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-cosmetics",
        "title": "美妆商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "请生成一张横版16:9的轻奢护肤美妆广告产品设定板 / 产品一致性参考板。\n\n项目标题：《晨光里的第一滴光》\n\n【核心目标】\n这张图不是故事板，而是轻奢精华液、人物妆容、关键道具和高级浴室 / 梳妆台场景设定板。\n用于后续 Seedance 视频生成时保持产品外观、人物气质、护肤动作、场景环境和整体轻奢美妆广告风格一致。\n\n【整体风格】\n轻奢护肤美妆广告、高级晨间生活方式、奶油白浴室、透明玻璃瓶精华、自然水润肌、低饱和高级色调、柔和晨光、干净、精致、有质感。\n\n不是夸张医美广告，不是廉价促销，不是过度磨皮滤镜，不是浓妆带货直播，而是高级护肤品牌短片 / 小红书种草广告质感。\n\n【画面结构】\n整体为专业美妆广告前期视觉设定板，浅色高级背景，清晰网格排版，细边框，像护肤品牌短片前期美术设定页。\n\n必须包含以下模块：\n\n1. 产品主体设定\n展示：\n- 精华液玻璃瓶正面\n- 精华液45度角产品图\n- 滴管细节\n- 透明质地滴落细节\n- 瓶身金属瓶盖细节\n- 产品放在梳妆台上的静物图\n\n产品设定：\n一瓶轻奢修护精华液，透明或磨砂玻璃瓶，奶油白 / 香槟金 / 透明水感设计，瓶盖为浅金色金属质感，滴管精致，整体高级、干净、轻盈。不要真实品牌LOGO。\n\n2. 女主形象设定\n展示：\n- 正面半身\n- 侧面半身\n- 面部特写\n- 涂抹精华姿态\n- 照镜子观察肌肤姿态\n- 完成轻薄妆容后的自然状态\n\n人物设定：\n25-30岁亚洲女性，气质干净知性，皮肤自然细腻，妆容轻透，发型为低盘发、松散披发或晨间自然发型。穿米白色丝质睡袍、浅色针织上衣或简洁浴袍。气质松弛、精致、自信，重点是自然护肤状态，不要夸张网红妆。\n\n3. 关键动作与质地设定\n展示：\n- 滴管吸取精华\n- 精华滴在手背或脸颊\n- 指腹轻轻推开质地\n- 肌肤出现自然水润光泽\n- 轻薄底妆服帖效果\n- 女主在镜前微笑\n\n4. 场景元素设定\n展示：\n- 高级浅色浴室\n- 大理石洗手台\n- 梳妆镜\n- 玻璃杯\n- 白色毛巾\n- 鲜花或绿植\n- 香薰蜡烛\n- 晨光窗帘\n- 化妆刷\n- 粉底 / 口红 / 气垫等美妆小物\n\n5. 卖点视觉设定\n展示：\n- 轻盈质地\n- 保湿水光\n- 妆前服帖\n- 细腻光泽\n- 日常可用\n- 高级感护肤仪式\n\n6. 色板与风格说明\n色彩：\n奶油白、香槟金、浅肤粉、透明水光、浅灰、暖米色、柔和晨光黄。\n\n风格关键词：\n轻奢护肤、美妆种草、玻璃瓶精华、晨间护肤、自然水光肌、妆前服帖、高级浴室、低饱和、干净高级、小红书质感、电商广告感。\n\n【限制】\n不要生成真实品牌LOGO。\n不要生成夸张医疗功效。\n不要写治疗、祛斑、抗炎、医学修复等绝对化功效。\n不要过度磨皮。\n不要前后对比夸张变脸。\n不要生成杂乱乱码文字。\n不要浓妆直播风。\n不要让人物抢过产品主体。\n整体必须像真实轻奢护肤美妆广告产品设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-cosmetics.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-cosmetics.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-elderly-care",
        "title": "老年商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "请生成一张横版16:9的老年服饰广告人物产品设定板 / 产品一致性参考板。\n\n项目标题：《穿得舒服，出门才自在》\n\n【核心目标】\n\n这张图不是故事板，而是中老年模特、舒适外套、关键穿着细节、家庭生活场景和小区散步场景设定板。\n\n用于后续 Seedance 视频生成时保持人物形象、服装外观、面料质感、穿着动作和整体老年服饰广告风格一致。\n\n【整体风格】\n\n老年服饰广告、中老年日常穿搭、轻暖舒适外套、家庭送礼、真实生活感、温暖克制、干净自然、电商广告质感、低饱和电影感。\n\n不是夸张保健品广告，不是土味促销，不是过度年轻化时尚大片，而是真实、可信、有品质感的中老年日常服饰短片。\n\n【画面结构】\n\n整体为专业服饰广告前期视觉设定板，浅色或中性暖色背景，清晰网格排版，细边框，像中老年服饰品牌广告 / 电商短视频前期美术设定页。\n\n必须包含以下模块：\n\n1. 男主周叔角色设定\n\n展示：\n\n- 正面全身\n\n- 侧面全身\n\n- 背面全身\n\n- 面部特写\n\n- 拉上外套拉链的姿态\n\n- 抬手活动肩背的姿态\n\n- 双手插进口袋的姿态\n\n- 小区散步姿态\n\n角色设定：\n\n周叔，65岁左右，退休男性，精神状态自然亲切，短发略带灰白，面容真实，不要过度年轻化。穿深灰、藏蓝或咖色中老年轻暖外套，内搭浅色针织衫或衬衫，深色休闲裤，舒适运动鞋。气质稳重、温和、干净，有“爸妈日常穿得舒服也体面”的真实感。\n\n2. 女主林阿姨角色设定\n\n展示：\n\n- 正面全身\n\n- 面部特写\n\n- 帮周叔整理衣领的姿态\n\n- 与周叔一起散步的姿态\n\n- 穿同系列女款外套的参考姿态\n\n角色设定：\n\n林阿姨，60岁左右，温柔朴素，短发或低盘发，穿米色、浅驼色或豆沙色中老年轻暖外套，内搭柔软针织衫，深色长裤。气质亲切、自然、精神利落，体现中老年女性日常穿搭的舒适和体面。\n\n3. 子女送礼设定\n\n展示：\n\n- 女儿递出衣服礼盒的手部动作\n\n- 子女帮父母试穿外套的生活场景\n\n- 父母看着衣服微笑的反应\n\n人物设定：\n\n女儿30岁左右，不需要过多正脸出镜，重点用手部和生活动作体现“送给爸妈的实用衣服”。不要让子女抢占主角，主角应是父母和服装。\n\n4. 产品主体设定\n\n展示：\n\n- 男款轻暖外套正面\n\n- 男款轻暖外套背面\n\n- 女款轻暖外套正面\n\n- 领口细节\n\n- 袖口细节\n\n- 拉链细节\n\n- 口袋细节\n\n- 面料纹理细节\n\n产品设定：\n\n中老年轻暖舒适外套，版型宽松但不臃肿，肩背活动空间充足，面料柔软有轻微细纹理，颜色低饱和、耐看、适合日常：藏蓝、深灰、咖色、米驼、豆沙色。设计简洁，不要夸张潮牌感，不要廉价塑料感。\n\n5. 卖点视觉设定\n\n展示：\n\n- 轻暖不臃肿\n\n- 肩背活动方便\n\n- 拉链顺滑\n\n- 口袋能放手机钥匙\n\n- 面料柔软亲肤\n\n- 日常买菜散步都能穿\n\n- 子女送父母实用\n\n6. 场景元素设定\n\n展示：\n\n- 清晨家中玄关\n\n- 客厅衣架\n\n- 鞋柜\n\n- 穿衣镜\n\n- 小区绿道\n\n- 晨光树影\n\n- 菜篮或购物袋\n\n- 手机钥匙\n\n- 礼盒包装\n\n- 温暖家庭氛围\n\n7. 色板与风格说明\n\n色彩：\n\n藏蓝、深灰、咖色、米驼、豆沙、奶油白、木色、晨光金、浅绿。\n\n风格关键词：\n\n老年服饰广告、中老年外套、轻暖舒适、日常穿搭、父母送礼、口袋实用、活动方便、面料柔软、真实生活感、电商广告感。\n\n【限制】\n\n不要真实品牌Logo。\n\n不要土味促销大字报。\n\n不要夸张医疗保健功效。\n\n不要把老人画得病态虚弱。\n\n不要过度年轻化。\n\n不要低幼卡通。\n\n不要二次元动漫风。\n\n不要乱码文字。\n\n不要真实字幕。\n\n不要水印和Logo。\n\n整体必须像真实中老年服饰广告产品设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-elderly-care.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-elderly-care.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-health",
        "title": "健康商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "请生成一张横版16:9的中老年健康养护人物设定板 / 生活方式一致性参考板。\n\n项目标题：《每天早上，先照顾好自己》\n\n【核心目标】\n这张图不是故事板，而是中老年人物、家庭场景、健康养护动作、关键道具和整体生活方式风格设定板。\n用于后续 Seedance 视频生成时保持人物形象、家居环境、健康管理道具、晨间光影和真实生活氛围一致。\n\n【整体风格】\n中老年健康养护、家庭生活、晨间规律、真实温暖、干净家居、轻运动、主动健康管理、低饱和电影感、柔和阳光、生活质感。\n\n不是医疗广告，不是夸张保健品广告，不是医院治疗场景，不是恐吓式健康宣传，而是真实、温和、可信的中老年日常健康养护短片质感。\n\n【画面结构】\n整体为专业生活方式广告前期视觉设定板，浅色或中性暖色背景，清晰网格排版，细边框，像健康生活品牌短片 / 公益宣传片 / 家庭健康管理短片前期美术设定页。\n\n必须包含以下模块：\n\n1. 男主周叔角色设定\n展示：\n- 正面全身\n- 侧面全身\n- 面部特写\n- 坐在餐桌旁测量健康数据的姿态\n- 做简单晨间拉伸的姿态\n- 穿运动鞋准备出门的姿态\n\n角色设定：\n周叔，62岁左右，退休男性，精神状态温和自然，短发略带灰白，面容真实亲切。穿浅灰色家居开衫、白色或浅蓝色内搭、深色休闲裤，出门时穿舒适运动鞋。气质沉稳、温和、有生活阅历，重点表现“主动管理日常健康”的真实感。\n\n2. 妻子林阿姨角色设定\n展示：\n- 正面全身\n- 面部特写\n- 准备清淡早餐的姿态\n- 和周叔一起散步的姿态\n\n角色设定：\n林阿姨，58岁左右，温柔朴素，短发或低盘发，穿米色针织衫、浅色围裙或舒适家居服。气质亲切、关心家人、生活细致，是家庭陪伴感的重要来源。\n\n3. 女儿远程关心设定\n展示：\n- 手机视频通话画面\n- 女儿发来关心消息的手机界面\n- 周叔看手机微笑的姿态\n\n人物设定：\n女儿不需要大量出镜，可通过手机画面或消息体现家庭关心。重点是“家人陪伴”和“日常提醒”，不要喧宾夺主。\n\n4. 关键道具设定\n展示：\n- 家用健康监测设备\n- 记录本或手机健康记录界面\n- 温水杯\n- 清淡早餐\n- 舒适运动鞋\n- 小区步道\n- 挂钟\n- 窗边晨光\n- 简单拉伸垫\n\n健康管理道具设定：\n家用健康监测设备和手机记录界面只作为日常健康管理工具出现，不出现医疗诊断结论，不出现夸张数值和治疗承诺。\n\n5. 场景元素设定\n展示：\n- 清晨客厅\n- 餐桌\n- 厨房\n- 窗边阳光\n- 小区绿道\n- 电梯口\n- 小区长椅\n- 绿植\n- 干净温暖的家庭环境\n\n6. 色板与风格说明\n色彩：\n米白、浅灰、木色、晨光金、浅绿、柔和蓝、温暖米黄。\n\n风格关键词：\n中老年健康养护、晨间规律、家庭陪伴、日常健康管理、适度运动、清淡早餐、温暖真实、低饱和电影感、安心生活。\n\n【限制】\n不要生成医院治疗场景。\n不要生成病痛恐吓画面。\n不要生成夸张医疗功效。\n不要写“治愈疾病”“降血压”“逆转疾病”等绝对化表达。\n不要生成保健品夸张宣传。\n不要生成真实品牌LOGO。\n不要生成杂乱乱码文字。\n不要把中老年人物画得过度衰老或病态。\n整体必须像真实中老年健康生活方式广告设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-health.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-health.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-phone-stand",
        "title": "手机支架商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "请生成一张横版16:9的车载实用配件广告产品设定板 / 产品一致性参考板。\n\n项目标题：《上车就稳稳放好》\n\n【核心目标】\n这张图不是故事板，而是车载手机支架、安装位置、车内场景、使用动作和卖点视觉设定板。\n用于后续 Seedance 视频生成时保持产品外观、手机状态、车内环境和整体车载实用广告风格一致。\n\n【整体风格】\n车载实用配件广告、通勤刚需、黑灰科技感、车内整洁、真实生活感、电商短视频广告质感、干净利落、实用可信。\n\n不是夸张豪车大片，不是赛车广告，不是危险驾驶画面，而是日常通勤中解决手机放置、导航、充电、车内线材凌乱问题的真实车载好物广告。\n\n【画面结构】\n整体为专业电商广告前期视觉设定板，深灰或浅灰高级背景，清晰网格排版，细边框，像车载用品广告 / 淘宝详情页视频前期美术设定页。\n\n必须包含以下模块：\n\n1. 产品主体设定\n展示：\n- 车载磁吸手机支架正面图\n- 45度角产品图\n- 支架安装在中控或出风口位置\n- 手机吸附在支架上的状态\n- 支架球头 / 旋转结构细节\n- 无线充电线或隐藏线材细节\n\n产品设定：\n一款黑色或深灰色车载磁吸无线充电手机支架，设计简洁，有金属质感和科技感。磁吸面平整，支架结构稳固，可调节角度，适合中控台或出风口安装。整体高级、实用、稳固，不要廉价塑料感。\n\n2. 车主使用设定\n展示：\n- 车主单手放手机\n- 车主单手取手机\n- 手机自动吸附支架\n- 导航界面稳定显示\n- 无线充电状态\n- 车内线材整洁状态\n\n人物设定：\n年轻都市车主，男女均可，不需要正脸过多出现，重点是手部动作和真实用车场景。主角应是手机支架和车内使用体验。\n\n3. 痛点场景设定\n展示：\n- 手机放在杯架里不方便看\n- 手机放副驾座位滑动\n- 充电线缠绕\n- 导航视线不顺\n- 中控台杂乱\n- 急刹后手机滑落的安全隐患提示\n\n注意：\n痛点表现要生活化，不要拍成危险驾驶事故，不要夸张碰撞。\n\n4. 卖点视觉设定\n展示：\n- 强力磁吸\n- 单手取放\n- 无线充电\n- 角度可调\n- 不挡视线\n- 车内更整洁\n- 适配多种车型\n- 稳定防滑\n\n5. 车内场景元素\n展示：\n- 现代汽车中控台\n- 出风口\n- 方向盘\n- 仪表盘\n- 手机导航界面\n- 杯架\n- 充电线\n- 日间通勤道路\n- 夜间城市通勤光影\n\n6. 色板与风格说明\n色彩：\n深灰、黑色、金属银、科技蓝、车内暖光、屏幕白光、城市夜景蓝。\n\n风格关键词：\n车载配件、手机支架、磁吸固定、无线充电、通勤刚需、车内整洁、单手取放、稳定防滑、实用电商广告、科技感。\n\n【限制】\n不要生成真实品牌LOGO。\n不要生成危险驾驶画面。\n不要让驾驶员低头长时间操作手机。\n不要遮挡驾驶视线。\n不要生成夸张车祸或碰撞。\n不要生成杂乱乱码文字。\n不要把产品画成夸张科幻设备。\n整体必须像真实车载实用配件广告产品设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-phone-stand.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-phone-stand.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-robot-vacuum",
        "title": "扫地机商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": " 请生成一张横版16:9的扫地机电商广告产品设定板 / 产品一致性参考板。\n\n项目标题：《智能扫拖一体扫地机》\n\n【核心目标】\n\n这张图不是故事板，而是产品外观、核心卖点、家庭场景和清洁能力设定板。\n\n用于后续 Seedance 视频生成时保持扫地机外观、颜色、家庭环境和清洁功能一致。\n\n【画面结构】\n\n整体为专业电商广告前期视觉设定板，干净明亮、清晰网格排版、细边框、商业广告质感。\n\n整体风格适合淘宝主图、详情页、短视频广告、抖音/小红书电商视频。\n\n必须包含以下模块：\n\n1. 产品主视觉设定\n\n展示：\n\n- 扫地机正面俯视图\n\n- 扫地机45度角产品图\n\n- 扫地机侧面低机位图\n\n- 基站 / 充电座展示（如果有）\n\n- 产品细节特写：顶部按键、传感器、边刷、拖布、轮组\n\n产品设定：\n\n一台高颜值智能扫拖一体扫地机，圆形机身，简洁现代设计，白色或浅灰色机身，高级家电风格，带边刷和底部拖布模块。整体干净、科技感强、适合现代家庭。\n\n2. 核心卖点模块\n\n展示：\n\n- 强力吸尘\n\n- 扫拖一体\n\n- 智能避障\n\n- 沿边清扫\n\n- 自动回充\n\n- 适合养宠家庭\n\n- 解放双手\n\n要求：\n\n卖点呈现简洁直观，图标化、清楚、不杂乱。\n\n3. 清洁脏污类型模块\n\n展示：\n\n- 灰尘\n\n- 宠物毛发\n\n- 饼干碎屑 / 零食碎\n\n- 头发\n\n- 沙粒\n\n- 墙角灰尘\n\n4. 家居场景模块\n\n展示：\n\n- 现代客厅\n\n- 沙发区域\n\n- 茶几周围\n\n- 餐桌下方\n\n- 床底 / 沙发底\n\n- 宠物家庭场景\n\n- 木地板 / 地砖环境\n\n5. 色板与风格说明\n\n色彩：\n\n暖白、浅灰、木色、清爽蓝、清洁感白光、柔和家居暖光。\n\n风格关键词：\n\n电商广告、智能家电、扫拖一体、现代家庭、解放双手、科技感、清洁前后对比、宠物友好、简洁高级。\n\n【限制】\n\n不要生成真实品牌LOGO。\n\n不要生成杂乱乱码小字。\n\n不要生成过于工业或商用清洁机器人。\n\n不要生成卡通玩具感。\n\n不要把扫地机画得太厚重或太夸张。\n\n整体必须像专业扫地机电商产品设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-robot-vacuum.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-robot-vacuum.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-shaver",
        "title": "剃须刀商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "请生成一张横版16:9的男士剃须刀广告人物产品设定板 / 产品一致性参考板。\n\n项目标题：《清晨三分钟，状态先到位》\n\n【核心目标】\n\n这张图不是故事板，而是男士电动剃须刀、男主形象、剃须动作、产品细节和清晨浴室 / 通勤场景设定板。\n\n用于后续 Seedance 视频生成时保持人物形象、剃须刀外观、刀头结构、浴室环境和整体男士理容广告风格一致。\n\n【整体风格】\n\n男士理容广告、电动剃须刀、清晨通勤、干净面容、轻商务质感、科技感、黑灰高级、真实生活感、低饱和电影感、电商广告质感。\n\n不是夸张硬广，不是油腻男士广告，不是廉价促销，不是过度肌肉健身大片，而是真实、干净、可信、有质感的男士理容短片。\n\n【画面结构】\n\n整体为专业男士理容广告前期视觉设定板，深灰或中性高级背景，清晰网格排版，细边框，像男士护理品牌广告 / 电商短视频前期美术设定页。\n\n必须包含以下模块：\n\n1. 男主角色设定\n\n展示：\n\n- 正面半身\n\n- 侧面半身\n\n- 面部特写\n\n- 镜前观察胡茬的姿态\n\n- 手持剃须刀剃下巴的姿态\n\n- 整理衬衫衣领准备出门的姿态\n\n角色设定：\n\n男主，28-38岁都市男性，气质干净沉稳，黑色短发或深棕短发，轻商务形象。清晨状态略带倦意，但不邋遢。剃须前下巴和嘴周有自然胡茬，剃须后面容干净利落。穿深色家居T恤或浴袍，后半段换成白衬衫、深色西装或通勤外套。整体真实自然，不要夸张摆拍。\n\n2. 产品主体设定\n\n展示：\n\n- 电动剃须刀正面\n\n- 45度角产品图\n\n- 三头浮动刀头或往复式刀头细节\n\n- 握柄防滑纹理\n\n- 充电底座\n\n- 保护盖\n\n- 水洗状态\n\n- 放在浴室台面上的静物图\n\n产品设定：\n\n一支男士电动剃须刀，黑色、深灰或金属银外观，线条简洁，握柄有防滑纹理，刀头结构清楚，整体科技感和高级感并存。不要真实品牌Logo，不要廉价塑料感。\n\n3. 剃须动作与效果设定\n\n展示：\n\n- 剃下巴胡茬\n\n- 剃嘴周胡茬\n\n- 贴合下颌线\n\n- 镜中观察剃须效果\n\n- 剃后清爽面容\n\n- 水龙头下冲洗刀头\n\n- 放回充电座\n\n4. 卖点视觉设定\n\n展示：\n\n- 快速剃净\n\n- 贴合下颌\n\n- 不易拉扯\n\n- 可水洗\n\n- 握持舒适\n\n- 续航 / 充电收纳\n\n- 适合清晨通勤\n\n- 面容更利落\n\n5. 场景元素设定\n\n展示：\n\n- 清晨高级浴室\n\n- 洗手台\n\n- 镜子\n\n- 水龙头\n\n- 毛巾\n\n- 剃须泡或理容小物\n\n- 充电底座\n\n- 通勤衬衫\n\n- 西装外套\n\n- 城市窗边晨光\n\n- 玄关出门场景\n\n6. 色板与风格说明\n\n色彩：\n\n高级黑、深灰、金属银、冷白、晨光蓝、浅木色、衬衫白、城市灰。\n\n风格关键词：\n\n男士剃须刀广告、电动剃须刀、男士理容、清晨通勤、快速剃净、贴合下颌、可水洗、商务干净、科技感、电商广告感。\n\n【限制】\n\n不要真实品牌Logo。\n\n不要土味促销大字报。\n\n不要夸张医疗功效。\n\n不要写“永久去除胡须”等绝对化表达。\n\n不要油腻硬广风。\n\n不要过度性感。\n\n不要低幼卡通风。\n\n不要二次元动漫风。\n\n不要乱码文字。\n\n不要真实字幕。\n\n不要水印和Logo。\n\n整体必须像真实男士剃须刀广告产品设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-shaver.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-shaver.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-toys",
        "title": "玩具商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "9宫格商业广告TVC故事板：{主体}的产品特写、痛点解决、使用场景与核心卖点展示。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-toys.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-toys.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "sb-womens-wear",
        "title": "女装商业广告TVC 9宫格故事板",
        "kind": "image",
        "category": "商业广告与TVC故事板",
        "crossCategories": [
            "商业海报与营销视觉"
        ],
        "description": "包含分镜机位、动作调度、镜头提示词与实拍参考效果的工业级商业TVC方案。",
        "positivePrompt": "请生成一张横版16:9的女装广告人物产品设定板 / 产品一致性参考板。\n\n项目标题：《今天穿得很有状态》\n\n【核心目标】\n\n这张图不是故事板，而是女主模特、通勤女装、面料细节、穿搭动作和都市生活场景设定板。\n\n用于后续 Seedance 视频生成时保持人物形象、服装版型、面料质感、穿着动作和整体女装广告风格一致。\n\n【整体风格】\n\n女装广告、轻熟通勤、都市女性穿搭、高级简约、低饱和电影感、真实生活感、电商种草质感、干净自然、有质感。\n\n不是夸张走秀大片，不是夜店风，不是廉价促销，不是过度性感，而是真实、耐看、有购买欲的都市女装广告短片。\n\n【画面结构】\n\n整体为专业服饰广告前期视觉设定板，浅色或中性高级背景，清晰网格排版，细边框，像女装品牌广告 / 电商短视频前期美术设定页。\n\n必须包含以下模块：\n\n1. 女主角色设定\n\n展示：\n\n- 正面全身\n\n- 侧面全身\n\n- 背面全身\n\n- 面部特写\n\n- 整理西装外套衣领的姿态\n\n- 拿通勤包出门的姿态\n\n- 坐在办公室会议桌旁的姿态\n\n- 站在城市玻璃窗前的姿态\n\n角色设定：\n\n女主，25-32岁都市女性，气质干净知性，自然自信。发型为低马尾、自然披发或利落中长发。妆容轻透，不夸张。穿轻熟通勤套装，整体显得利落、精神、舒展，有“上班、见客户、约会都能穿”的实用感。\n\n2. 产品主体设定\n\n展示：\n\n- 西装外套正面\n\n- 西装外套背面\n\n- 内搭上衣\n\n- 高腰半裙版本\n\n- 直筒裤版本\n\n- 通勤整套搭配\n\n- 不同角度穿着效果\n\n产品设定：\n\n一套轻熟通勤女装，低饱和高级色系，可为奶油白、浅灰、燕麦色、雾蓝、黑色、咖色。西装外套版型利落但不紧绷，肩线自然，腰部略收，面料有顺滑垂感。内搭简洁，高腰半裙或直筒裤能修饰身形，整体显瘦、干净、耐看。\n\n3. 面料与细节设定\n\n展示：\n\n- 领口细节\n\n- 肩线细节\n\n- 袖口细节\n\n- 腰线剪裁\n\n- 裙摆或裤脚垂感\n\n- 面料纹理\n\n- 纽扣或暗扣\n\n- 通勤包搭配\n\n细节要求：\n\n面料要表现柔软垂顺、有轻微细纹理，不要廉价塑料感。剪裁要体现显瘦、利落、不臃肿。衣服不能过度贴身，保持日常通勤可穿。\n\n4. 使用场景设定\n\n展示：\n\n- 清晨卧室衣柜前\n\n- 家中穿衣镜\n\n- 城市通勤路上\n\n- 办公室会议室\n\n- 咖啡店窗边\n\n- 城市玻璃窗前\n\n- 电梯间\n\n- 街角自然光\n\n5. 卖点视觉设定\n\n展示：\n\n- 显瘦利落\n\n- 舒适不勒\n\n- 垂感高级\n\n- 不易皱视觉表现\n\n- 通勤约会都能穿\n\n- 一衣多场景\n\n- 质感高级\n\n- 好搭配\n\n6. 色板与风格说明\n\n色彩：\n\n奶油白、浅灰、燕麦色、雾蓝、黑色、咖色、城市冷白光、咖啡棕。\n\n风格关键词：\n\n女装广告、轻熟通勤、都市女性、显瘦利落、高级垂感、舒适不勒、办公室穿搭、咖啡店、城市生活方式、电商种草质感。\n\n【限制】\n\n不要真实品牌Logo。\n\n不要土味促销大字报。\n\n不要过度性感。\n\n不要夜店风。\n\n不要夸张走秀姿势。\n\n不要低幼卡通。\n\n不要二次元动漫风。\n\n不要乱码文字。\n\n不要真实字幕。\n\n不要水印和Logo。\n\n不要把服装画得廉价、皱巴或塑料感强。\n\n整体必须像真实女装广告产品设定板，方便后续作为视频参考。",
        "styleTokens": [
            "商业TVC",
            "9宫格分镜",
            "广告摄影",
            "景深推进"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "分镜拆解",
            "实战出片"
        ],
        "gradient": "linear-gradient(135deg, #172554 0%, #1d4ed8 50%, #3b82f6 100%)",
        "accentColor": "#60a5fa",
        "icon": "Film",
        "previewImage": "/images/inspirations/storyboards/sb-womens-wear.webp",
        "previewThumbnail": "/images/inspirations/storyboards/sb-womens-wear.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "本地广告故事板精选",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "ecom-angle-45-gold",
        "title": "45度角黄金透视商品立体展示",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "经典电商 45 度侧角拍摄，兼顾产品正面品牌标与侧面立体厚度与纹理。",
        "positivePrompt": "Commercial 45-degree angle three-quarters perspective product photography of {商品主体:smart coffee mug}. Resting on a smooth neutral stone block, soft studio diffused side-lighting casting gentle natural drop shadow, showing front brand logo and side ergonomic profile simultaneously. Pure light-gray background #ECECEC, 8K ultra-sharp.",
        "negativePrompt": "flat lighting, distorted perspective, blurry edges, harsh specular highlights",
        "styleTokens": [
            "45度透视",
            "立体厚度",
            "柔和漫反射",
            "中性灰底",
            "电商黄金机位"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "45度透视"
        ],
        "gradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
        "accentColor": "#38bdf8",
        "icon": "Package",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-0-NEW003.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-0-NEW003.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-hosiery-silk-luster",
        "title": "丝袜自然缎光与肤感细节微距",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "柔顺贴合腿部线条，微光漫射下的细腻丝质光泽，杜绝假白与反光塑料感。",
        "positivePrompt": "Legwear commercial product photography. Elegant feminine leg wearing {丝袜款式:ultra-sheer 15D matte black silk stockings}, posing gracefully on a minimalist travertine stone bench. Soft continuous studio light gliding over smooth curves, highlighting natural satin sheen and seamless contour, professional e-commerce catalogue.",
        "negativePrompt": "plastic glare, ladders, sagging fabric, artificial fake skin, vulgar pose",
        "styleTokens": [
            "哑光缎面",
            "15D微透",
            "自然肤感",
            "优雅极简",
            "丝滑贴合"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "材质微距"
        ],
        "gradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
        "accentColor": "#38bdf8",
        "icon": "Package",
        "recommendedParams": {
            "aspectRatio": "3:4",
            "model": "FLUX.1"
        },
        "previewImage": "/images/inspirations/high/ecom-20-image-20260507-020953-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-20-image-20260507-020953-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-skincare-cream-hero",
        "title": "护肤面霜高奢白底商拍主图",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "亚克力晶莹双层霜瓶，柔焦底部倒影，纯白无瑕电商黄金图。",
        "positivePrompt": "Luxury skincare cosmetics product photography. A frosted translucent {美妆容器:glass jar with rose-gold metallic lid}, containing {护肤产品:hydrating cream}. Standing centered on a glossy reflective white acrylic surface with subtle shadow reflection. Pure white gradient studio background, soft wrap-around beauty lighting, crisp highlights on jar rim, 8K ultra-detailed.",
        "negativePrompt": "scratches, dust, fingerprints, dull glass, blown out highlights, messy reflections",
        "styleTokens": [
            "高奢美妆",
            "磨砂玻璃",
            "玫瑰金盖",
            "倒影亚克力",
            "纯白无瑕"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
        "accentColor": "#38bdf8",
        "icon": "Package",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-image-20260511-005138-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-image-20260511-005138-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-skincare-water-splash",
        "title": "护肤清爽水滴飞溅与水波凝结",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "高速快门定格水珠悬浮与微波粼粼，直观传递补水锁水功效。",
        "positivePrompt": "High-speed splash product photography of {美妆单品:cosmetic skincare bottle}. Dynamic crystalline water splashes, airborne suspended water droplets, and concentric ripples circling the product base. Crystal-clear turquoise water, bright daylight backlighting creating refractive caustic light patterns, 1/8000s shutter speed, Octane render.",
        "negativePrompt": "murky water, frozen motion blur, deformed bottle, bad reflections, overexposed",
        "styleTokens": [
            "高速水花",
            "水滴悬浮",
            "清爽通透",
            "水波粼粼",
            "焦散光影"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
        "accentColor": "#38bdf8",
        "icon": "Package",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-image-20260511-005343-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-image-20260511-005343-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-ecom-mirror-reflection",
        "title": "黑曜石镜面反光与悬浮展示",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "高反射黑色镜面或水面倒影，主体优雅悬浮微翘，顶部聚光灯窄光束，营造奢侈品与高端数码的尊贵质感。",
        "positivePrompt": "Luxury commercial product display of {主体}, hovering slightly above a glossy black obsidian mirror surface with crisp clear symmetrical reflection, single dramatic overhead spotlight casting rim highlights, deep moody dark ambient studio, sleek and elegant luxury aesthetic, sharp reflections, 8k render",
        "negativePrompt": "dust, scratches, foggy reflection, bright daylight, cheap plastic look, cluttered, low quality",
        "styleTokens": [
            "black obsidian mirror",
            "symmetrical reflection",
            "overhead spotlight",
            "luxury aesthetic",
            "moody dark studio"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
        "accentColor": "#38bdf8",
        "icon": "Package",
        "previewImage": "/images/inspirations/high/showcase-bag.webp",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/showcase-bag.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-ecom-pure-white",
        "title": "电商白底极简抠图主图",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "纯白无杂质背景，精准柔和漫反射光，主体居中悬浮微投地影，符合各大主流电商平台严格主图规范。",
        "positivePrompt": "High-end e-commerce packshot of {主体}, centered, isolated on a pure clean white background (RGB 255,255,255), delicate and subtle contact drop shadow underneath, clean diffuse lighting with no hot spots, flawless silhouette and pristine material finishes, 100mm macro f/8, ultra high fidelity, commercial catalog grade",
        "negativePrompt": "colored background, grey background, harsh shadows, overexposed, blown out highlights, clipping, text, watermark",
        "styleTokens": [
            "pure white background",
            "clean packshot",
            "diffuse studio lighting",
            "flawless materials",
            "contact drop shadow"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "材质微距"
        ],
        "gradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
        "accentColor": "#38bdf8",
        "icon": "Package",
        "previewImage": "/images/inspirations/high/showcase-skincare.webp",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/showcase-skincare.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-acrylic-mirror-reflection",
        "title": "黑色亚克力镜面光影倒影",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "深邃黑色高光镜面，完美对称倒影，神秘冷冽的数码/珠宝高奢感。",
        "positivePrompt": "High-end product photography of {科技单品:wireless mechanical keyboard} placed on a glossy black polished acrylic mirror surface. Perfect crystal reflection beneath, dark moody studio lighting with sharp cyan and amber rim lights defining product silhouette, pitch-black background, 8K, Ray-traced reflections.",
        "negativePrompt": "scratched mirror, dust specks, double reflection, foggy surface, overexposed",
        "styleTokens": [
            "黑色亚克力",
            "镜面倒影",
            "双色轮廓光",
            "科技暗黑",
            "极致冷冽"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #090d16 0%, #064e3b 30%, #0e7490 70%, #a21caf 100%)",
        "accentColor": "#06b6d4",
        "icon": "Zap",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1"
        },
        "previewImage": "/images/inspirations/high/ecom-11-image-20260507-020656-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-11-image-20260507-020656-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-skincare-sku-family",
        "title": "全系列多规格 SKU 色号阵列",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "水乳膏霜全套家族排布，梯度高低错落，构建品牌专业矩阵。",
        "positivePrompt": "Complete commercial skincare product family matrix. Full set of {护肤套组:cleanser, serum dropper, hydrating toner, and cream jar} arranged in an aesthetic tiered composition on layered geometric travertine stone pedestals. Soft directional morning light, warm neutral sandy background, unified commercial color scheme.",
        "negativePrompt": "misaligned bottles, chaotic composition, clashing color schemes, duplicate items",
        "styleTokens": [
            "全套家族",
            "几何台阶",
            "高低错落",
            "统一色系",
            "阵列陈列"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-image-20260511-012417-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-image-20260511-012417-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-silk-lifestyle-scene",
        "title": "都市轻商务生活场景穿搭氛图",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "采光充足的极简现代公寓或咖啡厅，晨光侧逆投射，营造松弛有度的都市精英生活意境。",
        "positivePrompt": "Modern lifestyle editorial photography. A male professional wearing {男装衬衫:slate gray silk shirt}, relaxed sitting in a sunlit minimalist penthouse loft with warm wood and brushed concrete textures. Soft morning sunlight streaming through floor-to-ceiling windows, subtle dust motes in golden ray, warm neutral color grading, Leica Q3 35mm f/2.0.",
        "negativePrompt": "plastic skin, stiff pose, messy background, unnatural lighting, oversaturated",
        "styleTokens": [
            "晨间阳光",
            "轻商务",
            "松弛感",
            "大理石木质",
            "生活方式"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1"
        },
        "previewImage": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013416-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013416-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-skincare-bathroom-morning",
        "title": "晨间日光浴室生活氛围静物",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "晨曦穿透浴室磨砂玻璃，大理石台面上的商品与绿植相映成趣。",
        "positivePrompt": "Morning serenity skincare lifestyle photography. Product bottle placed on a wet white Carrara marble bathroom countertop next to a vase of fresh eucalyptus sprigs and a rolled linen towel. Warm morning sunlight casting dappled botanical shadows across the scene, clean Nordic spa atmosphere, soft depth of field.",
        "negativePrompt": "messy bathroom, harsh artificial light, cluttered bottles, dirty mirror",
        "styleTokens": [
            "晨间阳光",
            "大理石台面",
            "尤加利叶",
            "北欧卫浴",
            "慢生活"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)",
        "accentColor": "#38bdf8",
        "icon": "Package",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1"
        },
        "previewImage": "/images/inspirations/high/ecom-image-20260511-010456-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-image-20260511-010456-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-pet-apparel-techpack",
        "title": "专业级宠物服装打版与工艺说明图",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "左侧比熊/法斗穿戴展示，右侧展开背片、胸腹片裁片图与精准尺寸公差标注。",
        "positivePrompt": "Professional pet apparel tech-pack illustration. Left side: full-body commercial studio shot of a cute Bichon Frise dog wearing a tailored {宠物服装:plaid quilted outdoor vest}. Right side: detailed garment pattern layout showing back panel, chest flap, and neck binding with precise millimetric measurement annotations and sewing guidelines. Clean studio light.",
        "negativePrompt": "anatomically incorrect dog, messy layout, illegible handwriting, distorted patterns",
        "styleTokens": [
            "宠物服装",
            "裁片排版",
            "尺寸公差",
            "结构设计",
            "萌宠实穿"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #3b0764 0%, #581c87 50%, #6b21a8 100%)",
        "accentColor": "#c084fc",
        "icon": "Package",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-25-image-20260507-070011-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-25-image-20260507-070011-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-livestream-backdrop",
        "title": "直播间带货超清虚化视效背景",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "柔和漫反射暖光背景墙，层次丰富的霓虹柔焦光斑，突出主播与前景商品。",
        "positivePrompt": "Professional live-commerce studio background aesthetic. Warm ambient illuminated shelf display with soft blurred warm-white neon strip lights, subtle wooden slats and warm gray acoustic felt backdrop, luxurious bokeh light balls, depth-of-field separation, 16:9 4K streaming studio backdrop.",
        "negativePrompt": "harsh blinding lights, chaotic cables, ugly branding, low quality bokeh",
        "styleTokens": [
            "直播间置景",
            "柔焦光斑",
            "暖色霓虹",
            "木格栅背景",
            "层次纵深"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1"
        },
        "previewImage": "/images/inspirations/high/ecom-new004-livestream-image-20260507-070757-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-new004-livestream-image-20260507-070757-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-silk-craftsmanship-macro",
        "title": "精工双走线与领口工艺特写",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "毫厘级缝线针距展现，德式双针压线工艺，彰显大厂高端制造水准。",
        "positivePrompt": "Ultra-close macro photography of garment craftsmanship. Detailed focus on {服装部件:shirt collar point and placket stitching}, showing precise 18-stitches-per-inch precision sewing thread, clean seam edges, and custom engraved resin button. Raking grazing light to accentuate stitch depth and tactile fabric texture, Canon EF 100mm f/2.8L Macro IS USM.",
        "negativePrompt": "crooked stitch, loose threads, frayed fabric, dull focus, bad lighting",
        "styleTokens": [
            "精工走线",
            "微距针距",
            "领口做工",
            "大厂工艺",
            "侧光勾勒"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "材质微距"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013510-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013510-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-silk-quality-cert",
        "title": "质检合格认证与环保水洗说明标",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "织唛标签特写，烫金字迹与防伪暗纹，强化品牌背书与买家信任度。",
        "positivePrompt": "Close-up macro shot of apparel woven fabric care label and authentic brand tag. Showing textured woven polyester label with crisp gold-foil stamped washing symbols, fiber composition ratio, and micro-embossed QR watermark. Soft directional studio light revealing fine fabric weave beneath the label, 8K.",
        "negativePrompt": "blurry text, bad embroidery, fake looking, dirty label, overexposed",
        "styleTokens": [
            "织唛特写",
            "烫金标识",
            "水洗符号",
            "防伪暗纹",
            "品质背书"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "材质微距"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013639-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013639-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-silk-sizing-guide",
        "title": "标准尺码对照与人体工学测量图",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "严谨工业工程图风格，肩宽、胸围、袖长与衣长精准参考标线。",
        "positivePrompt": "Garment ergonomic sizing specification chart and measurement blueprint. A clean flat-lay outline of men's {服装类别:button shirt} with thin technical dimension lines and arrow callouts indicating shoulder width, chest circumference, sleeve length, and total body length. Clean off-white studio background, minimalist geometric typography, professional apparel tech-pack standard.",
        "negativePrompt": "crooked lines, unreadable text, messy dimensions, low resolution",
        "styleTokens": [
            "尺码规格",
            "工学标线",
            "平铺测量",
            "技术制图",
            "严谨规范"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013535-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013535-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-silk-texture-macro",
        "title": "桑蚕丝织物高密微距特写",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "100mm 微距镜头对焦面料纹理，展现经纬交织的高级丝光反射与亲肤质感。",
        "positivePrompt": "Extreme macro close-up photography of {面料材质:premium mulberry silk fabric}, focusing on the intricate woven thread texture and natural lustrous sheen. Dramatic directional side-lighting revealing microscopic fiber weave and soft undulating fabric folds. High dynamic range, shallow depth of field, f/2.8 100mm macro lens, ultra-sharp detail, commercial textile catalog.",
        "negativePrompt": "blurry, low resolution, dust, loose threads, synthetic shine, rough texture, out of focus",
        "styleTokens": [
            "织物微距",
            "桑蚕丝",
            "经纬交织",
            "微观纤维",
            "侧逆光"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "材质微距"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013355-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-silk-shirt-amazon-pdp-image-20260511-013355-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-skincare-texture-macro",
        "title": "慕斯乳霜膏体微距拉丝质地",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "刮刀抹面质感，展现如慕斯般细腻绵密的乳霜触感与光泽。",
        "positivePrompt": "Extreme macro photography of rich {护肤质地:creamy whipped cosmetic lotion texture}. A smooth cosmetic spatula swipe revealing velvety swirl, creamy peaks, and micro-air bubbles. Glancing soft light revealing buttery consistency, natural organic sheen, pure pastel backdrop, Hasselblad H6D-100c 120mm macro.",
        "negativePrompt": "lumpy, greasy, dry cracks, unnatural colors, blurry focus",
        "styleTokens": [
            "乳霜微距",
            "慕斯膏体",
            "抹刀刮面",
            "绵密细腻",
            "光泽触感"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "材质微距"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "GPT-Image-2"
        },
        "previewImage": "/images/inspirations/high/ecom-image-20260511-005543-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-image-20260511-005543-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-ecom-macro-material",
        "title": "商品材质与工艺微距特写",
        "kind": "image",
        "category": "电商产品与白底精修",
        "crossCategories": [],
        "description": "100mm 微距镜头极致特写，展现金属拉丝、细腻皮革缝线、磨砂透光玻璃或水珠附着的毛孔级精致肌理。",
        "positivePrompt": "Ultra-close macro photography of {主体} surface texture, revealing exquisite craftsmanship, microscopic material details of fine brushed metal, precise leather stitching and delicate translucent highlights, extreme shallow depth of field, 100mm macro f/2.8 lens, cinematic commercial lighting, tactile quality",
        "negativePrompt": "blurry, out of focus, low resolution, plastic flat texture, artifacts, muddy colors",
        "styleTokens": [
            "100mm macro",
            "surface texture",
            "microscopic craftsmanship",
            "tactile detail",
            "shallow depth of field"
        ],
        "tags": [
            "电商产品",
            "白底精修",
            "商业摄影",
            "材质微距"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "previewImage": "/images/inspirations/high/material-macro-texture.webp",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/material-macro-texture.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-haute-couture-runway",
        "title": "高定法式优雅女装秀场大片",
        "kind": "image",
        "category": "时尚人像与模特写真",
        "crossCategories": [],
        "description": "巴黎古典沙龙石膏雕花背景，高定刺绣礼服随步伐摆动，气场全开。",
        "positivePrompt": "Haute couture runway editorial photography. Elegant supermodel wearing an exquisite {高定礼服:flowing black velvet gown with hand-embroidered golden floral motifs}. Walking down a neoclassical salon runway with ornate gilded moldings. Chiaroscuro studio spotlighting, dramatic long shadows, high fashion editorial for Harper's Bazaar.",
        "negativePrompt": "cheap fabric, distorted face, bad anatomy, bad runway lighting, crowded background",
        "styleTokens": [
            "法式高定",
            "重工刺绣",
            "古典沙龙",
            "明暗对照",
            "气场全开"
        ],
        "tags": [
            "时尚人像",
            "模特写真",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "recommendedParams": {
            "aspectRatio": "9:16",
            "model": "FLUX.1"
        },
        "previewImage": "/images/inspirations/high/ecom-19-image-20260507-020940-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-19-image-20260507-020940-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-cinema-kodak-portra",
        "title": "Kodak Portra 400 电影复古人像",
        "kind": "image",
        "category": "时尚人像与模特写真",
        "crossCategories": [],
        "description": "经典 Kodak Portra 400 胶片影调，真实皮肤纹理、柔和自然窗光与微妙颗粒感，85mm f/1.4 唯美浅景深。",
        "positivePrompt": "A cinematic 35mm film portrait of {主体}, shot on Kodak Portra 400, soft natural window lighting, rich organic skin tones, subtle authentic film grain, shallow depth of field, 85mm f/1.4 lens, authentic emotion, cinematic color grading, raw analog photo quality",
        "negativePrompt": "plastic skin, overly smooth, cartoon, CGI, deformed face, bad eyes, oversaturated, blurry, bad anatomy",
        "styleTokens": [
            "Kodak Portra 400",
            "35mm film grain",
            "85mm f/1.4",
            "shallow depth of field",
            "natural skin texture"
        ],
        "tags": [
            "时尚人像",
            "模特写真",
            "商业摄影",
            "胶片质感"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/high/retro-hong-kong.webp",
        "recommendedParams": {
            "aspectRatio": "3:4",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/retro-hong-kong.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-fashion-street-lookbook",
        "title": "时装周高级模特街拍画册",
        "kind": "image",
        "category": "时尚人像与模特写真",
        "crossCategories": [],
        "description": "专业模特上身展示 {服装/主体}，穿行于巴黎或米兰街头，微风吹拂发丝与衣摆，35mm 胶片街拍的松弛高级感。",
        "positivePrompt": "Editorial fashion street style lookbook photograph of a professional model wearing {服装/主体}, walking gracefully on an elegant Parisian boulevard, natural breeze gently catching hair and flowing fabric, candid movement, soft overcast European daylight, 35mm street photography style, high fashion magazine aesthetic",
        "negativePrompt": "stiff awkward pose, distorted anatomy, exaggerated plastic skin, blurry, amateur snapshot",
        "styleTokens": [
            "editorial lookbook",
            "Parisian street style",
            "natural wind flow",
            "35mm candid",
            "high fashion aesthetic"
        ],
        "tags": [
            "时尚人像",
            "模特写真",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/high/clothing-redesign.webp",
        "recommendedParams": {
            "aspectRatio": "3:4",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/clothing-redesign.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-cinema-david-fincher",
        "title": "大卫·芬奇冷调电影工业美学",
        "kind": "image",
        "category": "时尚人像与模特写真",
        "crossCategories": [],
        "description": "低饱和冷绿青色调，克制的高对比度与精准三点布光，深邃阴影与充满悬疑压迫感的画面张力。",
        "positivePrompt": "Cinematic film still in the distinct visual style of David Fincher, featuring {主体}, cold desaturated greenish-cyan and deep amber color palette, sharp precise directional lighting with deep controlled shadows, anamorphic lens flare, atmospheric haze, psychological tension, 35mm film texture",
        "negativePrompt": "bright happy colors, cheerful daylight, pastel shades, cartoonish, oversaturated, flat lighting",
        "styleTokens": [
            "David Fincher aesthetic",
            "desaturated greenish-cyan",
            "precise directional shadows",
            "atmospheric haze",
            "35mm grain"
        ],
        "tags": [
            "时尚人像",
            "模特写真",
            "商业摄影"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "previewImage": "/images/inspirations/high/suspense-noir.webp",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/suspense-noir.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-fashion-contact-lens-eye",
        "title": "商业广告-美瞳眼眸水润微距特写",
        "kind": "image",
        "category": "商业海报与营销视觉",
        "crossCategories": [],
        "description": "特写女性水润明亮双眸，晶莹剔透的美瞳纹理、根根分明的自然睫毛与清透眼神光，商业彩妆大片质感。",
        "positivePrompt": "Commercial beauty advertising extreme close-up of a stunning female eye wearing {主体/美瞳款式}, crystalline iris pattern, hydrated glassy cornea reflection with soft studio catchlight, immaculate natural individual eyelashes, clean dewy skin texture around eyelid, sharp focus, 100mm macro f/4, professional cosmetics campaign",
        "negativePrompt": "bloodshot eyes, cloudy cornea, messy clumpy mascara, artificial cartoon eye, blurry, creepy gaze",
        "styleTokens": [
            "beauty macro eye",
            "catchlight reflection",
            "crystalline iris",
            "dewy skin texture",
            "cosmetics campaign"
        ],
        "tags": [
            "商业海报",
            "营销视觉",
            "主视觉KV"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/high/face-swap.webp",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/face-swap.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-scene-mattress-autumn",
        "title": "高端床垫与秋日木屋品质海报",
        "kind": "image",
        "category": "商业海报与营销视觉",
        "crossCategories": [],
        "description": "蓝白格子厚实软垫床垫，散落红黄秋叶，红砖墙与壁炉燃烧暖光，法式双开门外秋季树林，温馨舒适大片感。",
        "positivePrompt": "Photorealistic interior, center focus on a thick blue and white checkered tufted mattress with scattered autumn leaves. Left: red brick wall with autumn ivy, vintage brown leather armchair, burning cast-iron fireplace. Right: open wooden French doors revealing an autumn forest, sheer brown curtains. Floor: dark wood parquet, beige textured rug. Warm, cozy, cinematic lighting, highly detailed, 8k resolution",
        "negativePrompt": "text, watermark, ugly, blurry, low resolution, bad proportions, unnatural lighting, modern plastic furniture",
        "styleTokens": [
            "tufted mattress",
            "autumn leaves",
            "burning fireplace",
            "open French doors",
            "cozy cinematic warmth"
        ],
        "tags": [
            "商业海报",
            "营销视觉",
            "主视觉KV"
        ],
        "gradient": "linear-gradient(135deg, #701a75 0%, #86198f 50%, #a21caf 100%)",
        "accentColor": "#e879f9",
        "icon": "MoveUpRight",
        "previewImage": "/images/inspirations/high/product-lifestyle.webp",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/product-lifestyle.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-trend-popmart-toy",
        "title": "PopMart 3D 盲盒潮玩手办",
        "kind": "image",
        "category": "微缩景观与粘土盲盒",
        "crossCategories": [],
        "description": "Q版精致粘土与透明树脂材质，马卡龙明快配色，温润漫反射棚拍光，精致微缩底座与萌系角色设计。",
        "positivePrompt": "Adorable PopMart style collectible designer vinyl toy figurine of {主体}, cute chibi proportions, smooth matte clay and glossy resin finishes, soft pastel macaron color palette, standing on a miniature display podium, warm studio softbox illumination, clean background, 3D render in Octane, C4D art toy",
        "negativePrompt": "scary, realistic human skin, gritty texture, dark gloomy, ugly anatomy, low poly",
        "styleTokens": [
            "PopMart designer toy",
            "chibi proportions",
            "matte vinyl and glossy resin",
            "pastel macaron palette",
            "Octane render"
        ],
        "tags": [
            "微缩景观",
            "粘土盲盒",
            "3D潮玩",
            "PopMart风"
        ],
        "gradient": "linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%)",
        "accentColor": "#f59e0b",
        "icon": "ToyBrick",
        "previewImage": "/images/inspirations/high/exploded-view.webp",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/exploded-view.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-trend-ip-merchandise",
        "title": "原创 IP 商业化衍生周边提案",
        "kind": "image",
        "category": "微缩景观与粘土盲盒",
        "crossCategories": [],
        "description": "围绕核心 IP 设计的帆布袋、陶瓷杯、徽章、T恤等周边衍生品矩阵整齐平铺排版，展示商业化方案大图。",
        "positivePrompt": "A neat flat-lay commercial product merchandise mockup collection featuring {主体} IP branding, including printed canvas tote bag, ceramic mug, enamel pin badges, notebook and t-shirt, aligned symmetrically on a clean pastel studio tabletop, soft modern branding identity showcase, high end catalog presentation",
        "negativePrompt": "crooked placement, messy, cluttered background, cheap prints, blurry logos",
        "styleTokens": [
            "flat-lay merchandise mockup",
            "branding identity showcase",
            "symmetrical alignment",
            "pastel tabletop",
            "catalog presentation"
        ],
        "tags": [
            "微缩景观",
            "粘土盲盒",
            "3D潮玩",
            "金属徽章"
        ],
        "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
        "accentColor": "#71717a",
        "icon": "Sparkles",
        "previewImage": "/images/inspirations/high/promo-poster.webp",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/promo-poster.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-arch-ando-concrete",
        "title": "清水混凝土极简建筑光影",
        "kind": "image",
        "category": "建筑空间与室内设计",
        "crossCategories": [],
        "description": "安藤忠雄风格清水混凝土几何结构，天井洒落一道锐利阳光，光影明暗交割，极简空间哲思。",
        "positivePrompt": "Minimalist architectural masterpiece inspired by Tadao Ando, smooth raw exposed concrete walls with circular formwork tie holes, a single dramatic slit skylight casting sharp angular sunlight across the serene interior gallery, polished gray concrete floor, contemplative zen spatial design, photorealistic architectural photography",
        "negativePrompt": "ornate decorations, cluttered, wallpaper, dirty stained walls, distorted lines, wide-angle fisheye",
        "styleTokens": [
            "Tadao Ando inspired",
            "raw exposed concrete",
            "slit skylight illumination",
            "sharp angular shadows",
            "zen spatial design"
        ],
        "tags": [
            "建筑空间",
            "室内设计",
            "空间美学",
            "清水混凝土",
            "极简家居"
        ],
        "gradient": "linear-gradient(135deg, #1c1917 0%, #292524 50%, #44403c 100%)",
        "accentColor": "#a8a29e",
        "icon": "Navigation",
        "previewImage": "/images/inspirations/high/bare-to-renovated.webp",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/bare-to-renovated.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-scene-nordic-home",
        "title": "北欧极简家居生活场景",
        "kind": "image",
        "category": "建筑空间与室内设计",
        "crossCategories": [],
        "description": "主体置于采光极佳的原木茶几或温润棉麻沙发旁，温暖自然晨光斜射，呈现小红书高赞生活美学格调。",
        "positivePrompt": "Cozy minimalist Nordic interior lifestyle scene, featuring {主体} thoughtfully arranged on a natural light oak table beside a soft linen couch, gentle warm morning sunlight streaming through sheer curtains casting soft striped shadows, serene and airy atmosphere, editorial lifestyle photography",
        "negativePrompt": "cluttered, messy room, artificial harsh neon lights, dark and gloomy, distorted furniture, low res",
        "styleTokens": [
            "Nordic minimalist interior",
            "morning sunlight",
            "light oak wood",
            "linen texture",
            "editorial lifestyle"
        ],
        "tags": [
            "建筑空间",
            "室内设计",
            "空间美学",
            "极简家居"
        ],
        "gradient": "linear-gradient(135deg, #1c1917 0%, #292524 50%, #44403c 100%)",
        "accentColor": "#a8a29e",
        "icon": "Navigation",
        "previewImage": "/images/inspirations/high/furniture-in-situ.webp",
        "recommendedParams": {
            "aspectRatio": "4:3",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/furniture-in-situ.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-scifi-orbital-station",
        "title": "深空轨道站全息交互控制舱",
        "kind": "image",
        "category": "建筑空间与室内设计",
        "crossCategories": [],
        "description": "失重漂浮状态，幽蓝冷光全息 HUD 界面，舷窗外浩瀚蔚蓝地球地平线，硬核太空科幻史诗质感。",
        "positivePrompt": "Interior of a futuristic deep space orbital station cockpit, glowing translucent blue holographic HUD interface displays floating in zero gravity, massive curved panoramic observation window revealing the luminous curve of Earth below, sleek white and dark titanium architecture, cinematic hard sci-fi lighting",
        "negativePrompt": "retro steampunk, rust, cluttered fantasy, cartoonish, lowres, flat 2d interface",
        "styleTokens": [
            "deep space station",
            "holographic HUD interface",
            "Earth curve observation window",
            "titanium architecture",
            "hard sci-fi"
        ],
        "tags": [
            "建筑空间",
            "室内设计",
            "空间美学"
        ],
        "gradient": "linear-gradient(135deg, #090d16 0%, #064e3b 30%, #0e7490 70%, #a21caf 100%)",
        "accentColor": "#06b6d4",
        "icon": "Zap",
        "previewImage": "/images/inspirations/high/future-tech.webp",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/future-tech.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "ecom-gourmet-bakery-macro",
        "title": "烘焙美食诱人拉丝与热气微距",
        "kind": "image",
        "category": "美食餐饮与商业静物",
        "crossCategories": [],
        "description": "刚出炉金黄焦脆表皮，芝士拉丝瞬间，缕缕热气在深色逆光中升腾。",
        "positivePrompt": "Appetizing commercial food photography of freshly baked {美食主体:golden croissant being pulled apart}, showing steaming soft buttery honeycomb layers and golden flaky crust crumbs. Delicate steam rising against a dark wooden rustic background, warm golden backlighting, macro lens f/2.8, mouth-watering gourmet magazine cover.",
        "negativePrompt": "burnt, pale, unappetizing, cold looking, plastic cheese, artificial glow",
        "styleTokens": [
            "食欲大开",
            "金黄焦脆",
            "芝士拉丝",
            "缕缕热气",
            "复古木质"
        ],
        "tags": [
            "美食餐饮",
            "美食摄影",
            "商业静物",
            "微距质感"
        ],
        "gradient": "linear-gradient(135deg, #7c2d12 0%, #9a3412 50%, #c2410c 100%)",
        "accentColor": "#f97316",
        "icon": "Package",
        "recommendedParams": {
            "aspectRatio": "4:3",
            "model": "FLUX.1"
        },
        "previewImage": "/images/inspirations/high/ecom-15-image-20260507-020713-01.webp",
        "previewThumbnail": "/images/inspirations/high/ecom-15-image-20260507-020713-01.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "img-scene-cafe-urban",
        "title": "午后咖啡厅都市轻商务摆拍",
        "kind": "image",
        "category": "美食餐饮与商业静物",
        "crossCategories": [],
        "description": "复古深木质咖啡桌，伴随拉花热拿铁与开页笔记本，背景是温和奶油虚化的都市街景，散发精英感与小资情调。",
        "positivePrompt": "A refined urban lifestyle composition of {主体} resting on a rich dark walnut coffee shop table, next to a ceramic cup of hot latte with elegant foam art and an open moleskine notebook, warm golden bokeh lights in the blurred background, soft natural window light, 50mm f/1.8 lens aesthetic",
        "negativePrompt": "overcrowded, messy, plastic cups, harsh flash, blurry subject, bad composition",
        "styleTokens": [
            "urban cafe lifestyle",
            "latte art",
            "dark walnut table",
            "warm bokeh",
            "50mm f/1.8"
        ],
        "tags": [
            "美食餐饮",
            "美食摄影",
            "商业静物"
        ],
        "gradient": "linear-gradient(135deg, #7c2d12 0%, #9a3412 50%, #c2410c 100%)",
        "accentColor": "#f97316",
        "icon": "Package",
        "previewImage": "/images/inspirations/high/drama-city.webp",
        "recommendedParams": {
            "aspectRatio": "16:9",
            "model": "FLUX.1-dev"
        },
        "previewThumbnail": "/images/inspirations/high/drama-city.webp",
        "hasImage": true,
        "isPureText": false
    },
    {
        "id": "builtin-expr-anger-1",
        "title": "愤怒 1/5 · 眉头微蹙",
        "kind": "image",
        "category": "角色资产与微表情控制",
        "crossCategories": [],
        "description": "Nomi 官方高精微表情控制微调模板，强度级别明确，保留五官一致性。",
        "positivePrompt": "保持画面中人物的身份、五官、发型、服装、姿态、构图与光线完全不变，仅将面部表情改为：眉心轻轻皱起，目光略微下沉变冷，嘴角平直并微微下压，面部其余部分保持平静，不易察觉的不快。表情强度：愤怒五档中的第 1 档（最轻）。",
        "styleTokens": [
            "微表情控制",
            "五官一致性",
            "精准情绪强度"
        ],
        "tags": [
            "角色资产",
            "微表情控制",
            "角色设定"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/expressions/builtin-expr-anger-1.webp",
        "previewThumbnail": "/images/inspirations/expressions/builtin-expr-anger-1.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "Nomi 官方微表情库",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "builtin-expr-anger-2",
        "title": "愤怒 2/5 · 面露不悦",
        "kind": "image",
        "category": "角色资产与微表情控制",
        "crossCategories": [],
        "description": "Nomi 官方高精微表情控制微调模板，强度级别明确，保留五官一致性。",
        "positivePrompt": "保持画面中人物的身份、五官、发型、服装、姿态、构图与光线完全不变，仅将面部表情改为：双眉压低皱紧，眼神冷硬直视前方，嘴唇抿成一条紧绷的直线，下颌微微收紧，明显写在脸上的不满。表情强度：愤怒五档中的第 2 档。",
        "styleTokens": [
            "微表情控制",
            "五官一致性",
            "精准情绪强度"
        ],
        "tags": [
            "角色资产",
            "微表情控制",
            "角色设定"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/expressions/builtin-expr-anger-2.webp",
        "previewThumbnail": "/images/inspirations/expressions/builtin-expr-anger-2.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "Nomi 官方微表情库",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "builtin-expr-anger-3",
        "title": "愤怒 3/5 · 愠怒压火",
        "kind": "image",
        "category": "角色资产与微表情控制",
        "crossCategories": [],
        "description": "Nomi 官方高精微表情控制微调模板，强度级别明确，保留五官一致性。",
        "positivePrompt": "保持画面中人物的身份、五官、发型、服装、姿态、构图与光线完全不变，仅将面部表情改为：眉头深锁、眉心挤出竖纹，上眼睑压低让目光变得锐利，鼻翼微张，嘴角紧绷下拉，咬肌隐隐鼓起，压着火气随时要发作。表情强度：愤怒五档中的第 3 档。",
        "styleTokens": [
            "微表情控制",
            "五官一致性",
            "精准情绪强度"
        ],
        "tags": [
            "角色资产",
            "微表情控制",
            "角色设定"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/expressions/builtin-expr-anger-3.webp",
        "previewThumbnail": "/images/inspirations/expressions/builtin-expr-anger-3.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "Nomi 官方微表情库",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "builtin-expr-anger-4",
        "title": "愤怒 4/5 · 怒目而视",
        "kind": "image",
        "category": "角色资产与微表情控制",
        "crossCategories": [],
        "description": "Nomi 官方高精微表情控制微调模板，强度级别明确，保留五官一致性。",
        "positivePrompt": "保持画面中人物的身份、五官、发型、服装、姿态、构图与光线完全不变，仅将面部表情改为：双眉猛压成倒八字，双眼圆瞪、目光如刀，鼻翼张开呼吸加重，牙关紧咬、咬肌明显鼓起，嘴唇紧抿甚至微微掀起，强烈的怒意直逼镜头。表情强度：愤怒五档中的第 4 档。",
        "styleTokens": [
            "微表情控制",
            "五官一致性",
            "精准情绪强度"
        ],
        "tags": [
            "角色资产",
            "微表情控制",
            "角色设定"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/expressions/builtin-expr-anger-4.webp",
        "previewThumbnail": "/images/inspirations/expressions/builtin-expr-anger-4.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "Nomi 官方微表情库",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "builtin-expr-anger-5",
        "title": "愤怒 5/5 · 暴怒嘶吼",
        "kind": "image",
        "category": "角色资产与微表情控制",
        "crossCategories": [],
        "description": "Nomi 官方高精微表情控制微调模板，强度级别明确，保留五官一致性。",
        "positivePrompt": "保持画面中人物的身份、五官、发型、服装、姿态、构图与光线完全不变，仅将面部表情改为：暴怒到失控，眉毛拧成一团、眉心刻出深沟，双眼圆瞪充血，鼻梁皱起，嘴巴大张嘶吼、上下牙齿全露，面部与颈部肌肉青筋紧绷，狂怒爆发的瞬间。表情强度：愤怒五档中的第 5 档（最强）。",
        "styleTokens": [
            "微表情控制",
            "五官一致性",
            "精准情绪强度"
        ],
        "tags": [
            "角色资产",
            "微表情控制",
            "角色设定"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/expressions/builtin-expr-anger-5.webp",
        "previewThumbnail": "/images/inspirations/expressions/builtin-expr-anger-5.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "Nomi 官方微表情库",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        }
    },
    {
        "id": "builtin-expr-fear-1",
        "title": "恐惧 1/5 · 隐隐不安",
        "kind": "image",
        "category": "角色资产与微表情控制",
        "crossCategories": [],
        "description": "Nomi 官方高精微表情控制微调模板，强度级别明确，保留五官一致性。",
        "positivePrompt": "保持画面中人物的身份、五官、发型、服装、姿态、构图与光线完全不变，仅将面部表情改为：目光游移不定、不敢聚焦，眉头轻皱，嘴唇轻抿，面部微微紧绷，说不清缘由的不安。表情强度：恐惧五档中的第 1 档（最轻）。",
        "styleTokens": [
            "微表情控制",
            "五官一致性",
            "精准情绪强度"
        ],
        "tags": [
            "角色资产",
            "微表情控制",
            "角色设定"
        ],
        "gradient": "linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7e22ce 100%)",
        "accentColor": "#a855f7",
        "icon": "Camera",
        "previewImage": "/images/inspirations/expressions/builtin-expr-fear-1.webp",
        "previewThumbnail": "/images/inspirations/expressions/builtin-expr-fear-1.webp",
        "hasImage": true,
        "isPureText": false,
        "source": "Nomi 官方微表情库",
        "recommendedParams": {
            "aspectRatio": "1:1",
            "model": "FLUX.1-dev"
        }
    }
];

export const VIDEO_PROMPT_PRESETS: PromptPresetItem[] = [
    {
        "id": "seedance-2-5-2097048616347299963",
        "title": "Prompt 001 · @youralphamom",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@youralphamom · 文本生成视频",
        "positivePrompt": "15-second photorealistic viral-style video, shot like a real accident on a handheld phone by a man sitting in the passenger seat of the car. Natural shaky phone camera, realistic raw audio, no music, no subtitles.\n\nScene: \ninside a LEFT-HAND-DRIVE black Mercedes convertible in an automatic car wash. The roof is OPEN. The woman is sitting in the DRIVER’S seat on the LEFT, never on the passenger side. She is a very attractive glamorous adult blonde woman with a sexy curvy figure, long voluminous blonde hair, a fitted white top, and a noticeably fuller bust. The man filming is in the passenger seat and stays off camera the whole time, only his voice is heard. The car remains COMPLETELY STATIONARY during the entire video. It does not roll forward at all. Only the car wash machinery moves around the car.\n\nAction:\nAt first, the blonde woman is smiling and relaxed, sitting at the wheel. Large spinning FOAM BRUSHES begin moving toward the open car from the FRONT windshield area. The man filming from the back seat urgently shouts: “Close the roof! Close the roof!”\n\nThe woman turns, confused, and says: “What?” She immediately reaches to the CENTER CONSOLE and repeatedly presses the convertible roof button near the gear area. She presses a BUTTON on the center console, not a handbrake, not a lever, not anything behind her. The roof does not move.\n\nThe big spinning soap brush then reaches into the open cabin and aggressively rubs over her head, hair, shoulders and upper body, covering her with thick white foam. Her long blonde hair is whipped around violently by the spinning brush. She screams and tries to shield herself while still desperately pressing the roof button.\n\nIMPORTANT: \nthe spinning brush must continue moving fully THROUGH the cabin and fully PAST the camera position into the back area, disappearing completely BEHIND the camera, so after that it is no longer visible in front of the car.\n\nImmediately after the brush has fully gone behind the camera, a separate rinse system activates from ABOVE. Strong overhead WATER JETS and heavy rinse spray pour directly into the open convertible. A lot of water hits the woman and floods the cabin. She becomes visibly SOAKED, with wet hair stuck to her face, neck and shoulders, foam turning into dripping suds. The man yells urgently from behind the camera: “Come on! Come on!”\n\nThe woman keeps pressing the same roof button on the center console, panicking, but the roof still does not work.\n\nEnd with the woman drenched, messy, shocked, covered in foam and water, while the open car is still being blasted by heavy water from above.\n\nHard constraints:\n- the driver is on the LEFT side\n- the woman stays in the DRIVER’S seat\n- the man filming is in the PASSENGER SEAT, off camera, voice only\n- the woman presses the ROOF BUTTON on the center console near the gear area\n- the car stays fully stationary the entire time\n- the foam brush must pass completely behind the camera\n- after the foam brush, a separate overhead rinse system must drench the woman and the interior with lots of water\n- the woman must become heavily foamy first, then heavily wet\n- strong realistic panic, raw viral accident energy",
        "styleTokens": [
            "Seedance 2.5",
            "@youralphamom",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@youralphamom",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2097048616347299963.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2097048616347299963.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2097048616347299963/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2097048616347299963/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2097047804715618304/img/G9NK4rft2g22aPRw.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/youralphamom/status/2097048616347299963",
        "author": "@youralphamom",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2097035947531546825",
        "title": "Prompt 002 · @taliaaariz",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@taliaaariz · 文本生成视频",
        "positivePrompt": "FULL-BODY ULTRA-REALISTIC REAL HUMAN WOMAN in a dreamy crimson-red maple forest, sitting gracefully on a simple wooden swing suspended by two thick natural ropes. Match the reference image closely in outfit, pose, atmosphere, flowing fabric, and overall composition.\n\nFACE & MAKEUP:\nElegant adult woman with natural realistic facial proportions, soft oval face, delicate features and calm dreamy expression. Healthy warm-neutral complexion, realistic skin texture, satin glow, soft peach-red blush, naturally straight dark eyebrows, warm rose-brown eyeshadow, subtle cocoa shading, delicate champagne shimmer, thin natural eyeliner, curled eyelashes, subtle aegyo-sal, soft crimson-rose glossy lipstick, subtle red beauty marks near the cheek.\n\nHAIR:\nVery long silky natural black hair, center-parted, soft waves, realistic individual strands, loose strands around the face, gently blowing in the wind, with a small delicate traditional red floral hair ornament.\n\nOUTFIT — MATCH THE REFERENCE:\nElegant luxurious crimson-red traditional Chinese-inspired Hanfu, closely matching the reference. Deep red long-sleeved flowing gown, fitted waist with a long red sash and front bow, extremely wide oversized sleeves, layered translucent chiffon and silk fabric, very long flowing skirt and dramatic trailing train.\n\nMODEST NECKLINE — IMPORTANT:\nKeep the upper chest area modest and covered. The neckline should be elegant and higher/overlapping, with the fabric naturally covering the cleavage. Do NOT emphasize cleavage, breasts, or chest. No revealing neckline, no deep exposure. Maintain the elegant traditional Hanfu appearance while keeping the chest area discreet and naturally covered.\n\nWIND — VERY IMPORTANT:\nStrong graceful wind blowing continuously through the forest. Both oversized sleeves flow dramatically sideways. The enormous translucent red skirt and long train are lifted and swept through the air in large elegant waves, extending far behind and toward both sides of the frame. Multiple chiffon layers move naturally and separately. Hair and loose strands blow gently. Maple leaves float and swirl through the air. Realistic fabric physics, soft lightweight silk and chiffon, never stiff or static.\n\nPOSE:\nSeated naturally on the wooden swing, both hands gently holding the ropes, elegant upright posture, head slightly turned toward the camera, serene dreamy expression, legs naturally covered beneath the flowing gown, one bare foot subtly visible. Natural realistic anatomy.\n\nCAMERA DISTANCE — EXTREMELY IMPORTANT:\nUse an EXTREMELY DISTANT WIDE ENVIRONMENTAL SHOT, even farther away than the reference. Camera positioned several meters farther from the subject. The woman appears relatively small within the huge forest environment, approximately 25–35% of the vertical frame. Show the COMPLETE woman, COMPLETE swing, BOTH ropes, and the entire dramatic flowing dress and train.\n\nDo NOT use close-up, medium shot, waist-up, bust shot, portrait crop, or face-focused composition. Do NOT zoom in. Prioritize the expansive crimson maple forest and atmospheric scenery. The subject must remain fully visible from head to toe with generous empty space surrounding her.\n\nWIDE CINEMATIC ENVIRONMENTAL PORTRAIT, distant camera perspective, spacious composition, full-body subject, expansive forest dominating the frame, dramatic flowing fabric clearly visible.\n\nENVIRONMENT:\nHuge crimson Japanese maple forest, dense scarlet foliage, dark tree trunks, countless red maple leaves, soft mist, atmospheric fog, warm diffused sunlight, floating leaves, subtle glowing particles and cinematic depth.\n\nLIGHTING:\nSoft diffused cinematic sunlight, warm atmospheric backlight, subtle rim light around hair and flowing red fabric, realistic shadows, natural skin tones, dreamy misty atmosphere.\n\nSTYLE:\nUltra-photorealistic real human photography, realistic human anatomy, realistic skin, realistic hair, realistic silk and chiffon, physically accurate wind movement, cinematic fashion photography, high-end environmental editorial photography, natural depth of field, 8K photographic detail.\n\nVERTICAL 9:16.",
        "styleTokens": [
            "Seedance 2.5",
            "@taliaaariz",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@taliaaariz",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #090d16 0%, #064e3b 30%, #0e7490 70%, #a21caf 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2097035947531546825.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2097035947531546825.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2097035947531546825/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2097035947531546825/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2097035730237157376/img/XxkhX2ukB32MHYdq.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/taliaaariz/status/2097035947531546825",
        "author": "@taliaaariz",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096969853936763032",
        "title": "Prompt 003 · @strength04_x",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@strength04_x · 文本生成视频",
        "positivePrompt": "REFERENCE & SUBJECT CONSISTENCY\n\nUse \"@<image1\" as the exact visual reference for the woman. Preserve her face, identity, hairstyle, skin texture, body proportions, clothing, and overall appearance throughout the entire clip.\n\nUse exactly ONE small playful puppy throughout the video. The same puppy remains physically continuous from beginning to end. No second animal and no other animal at any point.\n\nFORMAT\n\n30-second continuous vertical 9:16 smartphone front-camera selfie footage.\n\nThe woman is holding the phone herself with one arm. Natural indoor window daylight, plain realistic environment, no cinematic lighting, no color grading, no beauty filter.\n\nTight chest-up selfie framing with natural arm drift and imperfect handheld movement.\n\n---\n\n0–5 SEC — CASUAL BEGINNING\n\nThe woman is already holding the puppy close against her chest.\n\nShe wears simple sunglasses while looking into the phone and casually talking to the puppy.\n\nThe puppy looks up toward her face, curious and energetic.\n\nShe smiles slightly and gently scratches behind its ear.\n\nThe phone drifts a few centimeters as her wrist relaxes.\n\nNatural breathing, clothing movement, and tiny puppy movements are visible.\n\n---\n\n5–9 SEC — PUPPY NOTICES THE GLASSES\n\nThe puppy suddenly focuses on her sunglasses.\n\nIts head moves closer to her face.\n\nShe notices and pulls her head slightly backward.\n\nShe gives a small amused nose-laugh and says casually:\n\n\"What are you doing?\"\n\nThe puppy stretches one paw toward the sunglasses.\n\n---\n\n9–14 SEC — THEFT\n\nBefore she can react, the puppy grabs the edge of one sunglasses arm with its mouth.\n\nShe immediately laughs in surprise.\n\nThe sunglasses slip slightly sideways.\n\nShe tries to hold them with her free fingers while still keeping the puppy supported.\n\nThe puppy keeps pulling.\n\nThe phone shakes slightly because she is laughing.\n\nHer eyes squeeze shut for a moment.\n\n---\n\n14–19 SEC — SHE LOSES THEM\n\nThe puppy successfully pulls the sunglasses away.\n\nThe woman reacts with genuine disbelief and laughter.\n\nShe looks directly into the camera with one eyebrow raised.\n\nThen looks down at the puppy.\n\nShe says through laughter:\n\n\"Hey, give me those!\"\n\nThe puppy holds the sunglasses proudly and turns its head away.\n\n---\n\n19–24 SEC — CHASE WITHOUT CUT\n\nThe puppy starts trying to move downward out of her arms.\n\nShe adjusts her grip and gently catches it.\n\nHer phone arm moves sideways, causing the selfie framing to drift.\n\nShe laughs harder while trying to retrieve the sunglasses.\n\nThe puppy wiggles energetically.\n\nFabric rustles naturally.\n\n---\n\n24–28 SEC — PUPPY COMES TOWARD CAMERA\n\nThe puppy suddenly moves upward again.\n\nIts face comes closer to the phone.\n\nIts nose approaches the lens.\n\nThe woman pulls her head slightly backward while laughing.\n\nThe sunglasses remain visible near the puppy's mouth.\n\nFocus briefly shifts toward the puppy's face.\n\n---\n\n28–30 SEC — FINAL BOOP\n\nThe puppy reaches its nose directly toward the camera.\n\nIts nose briefly fills the near foreground and almost touches the lens.\n\nThe woman laughs and starts saying:\n\n\"You little—\"\n\nShe never finishes.\n\nThe puppy's nose remains extremely close to the camera as the woman's laughter continues and the clip ends naturally.\n\nAUDIO\n\nDiegetic sound only: woman's voice, natural laughter, puppy breathing, tiny collar/fur movement, clothing rustling, subtle room ambience.\n\nNo music.\n\nNo subtitles.\n\nNo text.\n\nNo watermark.\n\nNo cuts.\n\nNo zoom.\n\nNo duplicate subjects.\n\nNo other animals.\n\nMaintain realistic puppy physics and continuous handheld selfie movement.",
        "styleTokens": [
            "Seedance 2.5",
            "@strength04_x",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@strength04_x",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096969853936763032.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096969853936763032.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096969853936763032/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096969853936763032/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096968660267192320/img/SjOEnhNJZ5GN3qHB.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/strength04_x/status/2096969853936763032",
        "author": "@strength04_x",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096969556816527585",
        "title": "Prompt 004 · @ankit_patel211",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@ankit_patel211 · 文本生成视频",
        "positivePrompt": "【STYLE】\n\nLive-action cinematic adaptation of an original retro side-scrolling run-and-gun arcade game.\n\nVisual identity must be completely distinct from classic military jungle shooters. The game feels like an original late-1980s/early-1990s arcade action title brought into realistic live action.\n\nPhotorealistic human performers, cinematic practical environments, realistic materials, authentic physical lighting, detailed environmental destruction, subtle retro arcade HUD elements, crisp 4K image quality.\n\nNo anime.\nNo cartoon rendering.\nNo game-engine character appearance.\nNo cheap CGI.\n【GAME TITLE】\n“NEON OUTPOST”\nOriginal fictional arcade game identity.\n\nDo not reproduce or imitate any existing game's characters, costumes, logos, HUD, weapons, soundtrack, level design, or trademarked visual assets.\n\n【DURATION】\n\n15 seconds\n\n【ASPECT RATIO】\n\n16:9 landscape\n\n【LANGUAGE】\n\nEnglish dialogue.\n\nNo subtitles.\n\nNo narration.\n\nDialogue is spoken naturally by the characters during gameplay.\n\nOriginal retro arcade-inspired sound design:\nmechanical weapon fire,\njump sounds,\nmetal impacts,\nelectrical pulses,\nexplosions,\npower-up sounds,\nenemy alarms,\narcade score effects.\n\n【CHARACTER A — CYAN】\n\nCyan-haired combat runner wearing a white tactical jacket with cyan panels, black reinforced trousers, silver utility belt, fingerless gloves and white high-top combat boots.\n\nWeapon:\ncompact futuristic burst rifle with a short mechanical barrel and visible recoil.\nPersonality:\ncalm, focused, slightly sarcastic.\n【CHARACTER B — ORANGE】\nShort dark-haired combat runner wearing a dark violet sleeveless tactical vest with bright orange shoulder armor, charcoal cargo pants, orange utility straps, black gloves and heavy black boots.\nWeapon:\nlarge mechanical rotary shotgun with a cylindrical chamber and visible shell ejection.\nPersonality:\nreckless, energetic, confident.\nIMPORTANT:\nThe characters must NEVER wear blue/red bandanas or military outfits from the previous concept.\nCompletely different clothing.\nCompletely different color palette.\nCompletely different weapons.\nCompletely different visual silhouettes.\n\nCharacter A remains CYAN/WHITE.\n\nCharacter B remains VIOLET/ORANGE.\n\nNo color swapping.\nNo outfit swapping.\nNo face swapping.\nNo hairstyle changes.\n【ENVIRONMENT】\n\nAbandoned volcanic mining colony at night.\nThe level takes place on a huge industrial platform suspended above a glowing volcanic crater.\n\nBlack volcanic rock.\nMetal walkways.\nRust-covered machinery.\nSteam vents.\nIndustrial pipes.\nSuspended cargo containers.\nBroken neon warning lights.\nMolten lava visible far below.\nLarge mechanical elevators.\nSmoke and sparks drifting through the air.\n\nThe background continuously scrolls from right to left as both characters advance from left to right.\n\nThis must NOT resemble a tropical jungle.\n【HUD】\n\nUse a completely new arcade HUD design.\nTop-left:\n\nCYAN PLAYER\nENERGY 74%\nSCORE 042600\n×4\n\nTop-right:\n\nORANGE PLAYER\nENERGY 81%\nSCORE 039200\n×4\nHUD colors use cyan, white, violet and orange.\nUpper center briefly displays:\n“OUTPOST 07”\n\nBottom-center contains a thin segmented ENERGY CORE meter.\n\nEnemy defeats generate brief pixel numbers:\n\n“300”\n“600”\n“1200”\nNo existing arcade game's HUD design.\nNo real trademarks.\nNo logos.\nNo watermarks.\n【GLOBAL CAMERA】\n\nClassic side-scrolling perspective throughout.\n\nCharacters always move from LEFT ��� RIGHT.\n\nBackground scrolls RIGHT → LEFT.\n\nCamera follows them horizontally.\nNo first-person perspective.\nNo frontal cinematic hero shots.\nNo aerial shots.\nNo circular camera movement.\nNo dramatic camera orbit.\nNo random cuts.\nThe scene must visually read as an actual playable side-scrolling action game translated into live action.\n【00:00–00:03 — SCENE 1: VOLCANIC PLATFORM】\nSide-view medium-wide tracking shot.\n\nCharacter A and Character B sprint from the left side onto a damaged industrial platform.\n\nSteam erupts from a pipe underneath them.\n\nCharacter A fires three controlled bursts toward robotic guards ahead.\n\nBright realistic muzzle flashes illuminate the white/cyan jacket.\n\nCharacter B runs behind him, then performs a fast forward slide beneath a horizontal security beam.\n\nWhile sliding, Character B fires the rotary shotgun sideways.\nThe shotgun produces a heavy mechanical blast.\nA robotic enemy is knocked backward into a metal railing.\nCharacter A shouts:\n\n“MOVE!”\n\nCharacter B immediately replies:\n“I'm moving!”\nA warning light flashes in the background.\nHUD activates.\n\n“OUTPOST 07” briefly appears.\n\n【00:03–00:07 — SCENE 2: MAGNETIC PLATFORM JUMP】\n\nThe platform suddenly ends.\n\nA huge vertical gap opens between two industrial structures.\n\nBoth characters jump simultaneously.\n\nCharacter A grabs a hanging magnetic cable with one hand while firing downward with the other.\nCharacter B performs a double-step jump across two floating maintenance platforms.\nThree small spherical security drones emerge from below.\n\nCharacter A destroys one.\n\nCharacter B spins during the jump and blasts another.\nThe third drone launches toward them.\nCharacter B kicks a floating metal panel into the drone.\n\nThe collision destroys it.\n\nA glowing orange energy module falls from the destroyed drone.\n\nCharacter A catches it.\n\nHUD flashes:\n\n“OVERCHARGE”\n\nHis weapon temporarily produces faster controlled bursts with realistic muzzle flashes and recoil.\n\nCharacter A says:\n\n“That's useful.”\n\nCharacter B responds:\n\n“You're welcome.”\n\n【00:07–00:11 — SCENE 3: ELEVATOR CHASE】\n\nBoth characters land on a moving industrial elevator platform.\n\nThe elevator rapidly rises along the side of the volcanic facility.\n\nThe camera widens slightly while maintaining the exact side-view perspective.\n\nRobotic enemies appear on platforms above them.\n\nCharacter B fires upward with the rotary shotgun.\n\nMetal fragments and sparks fall around him.\n\nCharacter A crouches and fires controlled bursts at a large security turret.\n\nThe turret rotates and fires.\n\nBullets strike the elevator railing.\n\nCharacter A ducks.\n\nCharacter B jumps over him while firing.\n\nThe shotgun destroys the turret.\n\nA large electrical explosion flashes across the background.\n\nThe elevator continues upward.\n\nCharacter B laughs and shouts:\n\n“Still alive!”\n\nCharacter A answers:\n\n“Unfortunately.”\n\n【00:11–00:15 — SCENE 4: THE CORE GATE】\n\nThe elevator reaches the highest platform.\n\nBoth characters sprint toward an enormous circular industrial blast door.\n\nThe door begins opening.\n\nInside is a massive glowing energy reactor.\n\nPurple and orange light spills across the characters.\n\nBoth stop at the right third of the frame.\n\nCharacter A raises the burst rifle.\n\nCharacter B spins the shotgun chamber and locks it into position.\n\nA huge robotic silhouette appears behind the reactor.\n\nCharacter A says:\n\n“That's bigger than expected.”\n\nCharacter B responds:\n\n“Then shoot bigger.”\n\nBoth raise their weapons.\n\nThe screen freezes at the moment before they fire.\n\nLarge original arcade pixel text appears:\n\n“OUTPOST COMPLETE!”\n\nScores rapidly increase.\n\nCYAN PLAYER:\n042600 → 051900\n\nORANGE PLAYER:\n039200 → 048700\n\nFinal screen remains frozen for approximately one second.\n\nOriginal short arcade victory sound.\n\n【PHYSICAL REALISM】\n\nRealistic human anatomy.\n\nNatural running.\n\nNatural jumping.\n\nBelievable momentum.\n\nRealistic weapon recoil.\n\nReal shell ejection.\n\nRealistic muzzle flash.\n\nPhysical sparks.\n\nReal smoke.\n\nMetal deformation.\n\nVolumetric volcanic steam.\n\nRealistic lighting interaction between explosions and characters.\n\nClothing physically reacts to movement and explosions.\n\nNo floating objects unless explicitly part of the magnetic platform gameplay.\n\n【NEGATIVE PROMPT】\n\nNo blue bandana.\nNo red bandana.\nNo brown ammunition belt.\nNo traditional jungle military uniforms.\nNo tropical jungle.\nNo palm trees.\nNo waterfalls.\nNo concrete jungle bunkers.\nNo previous character outfits.\nNo previous weapon designs.\nNo previous HUD.\nNo existing video-game characters.\nNo existing game logos.\nNo trademarked visual identity.\nNo Konami logo.\nNo recognizable Contra recreation.\nNo anime.\nNo manga.\nNo cartoon.\nNo cel shading.\nNo cheap CGI.\nNo game-engine humans.\nNo plastic skin.\nNo superhero costumes.\nNo fantasy medieval armor.\nNo laser swords.\nNo cartoon laser beams.\nNo weapon morphing.\nNo face swapping.\nNo hairstyle swapping.\nNo costume swapping.\nNo color swapping.\nNo first-person view.\nNo frontal camera.\nNo aerial camera.\nNo orbiting camera.\nNo random cuts.\nNo slow-motion montage.\nNo gore.\nNo blood.\nNo dismemberment.\nNo nudity.\nNo sexualized clothing.\nNo subtitles.\nNo watermark.\nNo screen texture overlay.\nNo fake VHS overlay.\nNo excessive film grain.\nNo excessive bloom.\nNo characters moving right-to-left.\nNo inconsistent character appearance.\nNo inconsistent weapons.\nNo inconsistent enviro",
        "styleTokens": [
            "Seedance 2.5",
            "@ankit_patel211",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@ankit_patel211",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096969556816527585.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096969556816527585.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096969556816527585/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096969556816527585/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096969501053214720/img/EUSVhR9CYGhWGWLW.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/ankit_patel211/status/2096969556816527585",
        "author": "@ankit_patel211",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096962476596175329",
        "title": "Prompt 005 · @kingofdairyque",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@kingofdairyque · 文本生成视频",
        "positivePrompt": "Create a 30-second, 1080p, 16:9 ultra-realistic live-action home video of a naturally beautiful adult Korean woman in her early 20s spending a warm late-summer afternoon with her friend in an older Seoul neighborhood.\n\nThe video should feel like a genuine early-2000s consumer DV recording—not a commercial, music video, or staged production. Keep everything simple, attractive, spontaneous, and believable.\n\nMAIN SUBJECT & CONTINUITY\nLong dark-brown hair worn down with a soft natural wave, minimal makeup, realistic skin texture, relaxed expressions. She wears a fitted white short-sleeve top, light-blue straight-leg jeans, white sneakers, a small dark-brown shoulder bag, and a delicate silver necklace. Keep her face, hairstyle, outfit, accessories, body proportions, and the same bottled drink perfectly consistent throughout.\n\nLOCATION\nA quiet older Seoul residential neighborhood: narrow concrete streets, small apartment buildings, brick walls, potted plants, parked bicycles, utility poles, overhead wires, a tiny convenience shop, and shaded walkways. No landmarks, recognizable brands, advertisements, or commercial activity.\n\nVISUAL STYLE\nAuthentic handheld DV footage with natural camera shake, imperfect framing, autofocus breathing, occasional exposure changes, soft digital detail, faded colors, mild video noise, natural motion blur, and occasional accidental zooms. The friend filming should react naturally. No stabilization, drone shots, gimbal movement, slow motion, beauty filters, or polished cinematic look.\n\nSTORY — 30 SECONDS\n\n- 00:00–00:05: She leaves her apartment, adjusts her bag, notices the camera, and smiles. Her friend follows casually.\n- 00:05–00:10: She buys a cold bottled drink, presses it against her cheek, laughs at a camera zoom, and says, “It's so hot today.”\n- 00:10–00:15: They walk down a quieter street. A bicycle passes, she steps aside, then smiles back at the camera as a breeze moves her hair.\n- 00:15–00:20: She sits on a low wall beside an apartment garden. Her friend points out a tiny leaf in her hair. She removes it and laughs.\n- 00:20–00:25: They walk again. She briefly takes the drink from her friend, takes a sip, gives it back, and smiles toward the camera.\n- 00:25–00:30: At her apartment entrance, she waves and says, “See you tomorrow.” She walks inside. The friend keeps filming for one second as the door closes, then the footage abruptly cuts to black.\n\nAUDIO\nNatural location audio only: footsteps, distant traffic, bicycles, summer insects, apartment ambience, shop refrigerator hum, bottle movement, leaves, and quiet neighborhood voices. Natural dialogue only. No music, narration, artificial sound effects, subtitles, captions, logos, watermarks, or random text.\n\nREALISM\nNatural walking, sitting, drinking, hair movement, and hand gestures. No exaggerated acting, identity drift, outfit changes, distorted hands, extra fingers, duplicated people, teleportation, CGI appearance, or impossible physics.\n\nFINAL FEEL\nSimple, pretty, and real. Like a random personal video discovered years later nothing dramatic happened, but it somehow feels like a real memory.",
        "styleTokens": [
            "Seedance 2.5",
            "@kingofdairyque",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@kingofdairyque",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096962476596175329.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096962476596175329.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096962476596175329/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096962476596175329/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096962408036405248/img/QW95o5_wlXFUBXRK.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/kingofdairyque/status/2096962476596175329",
        "author": "@kingofdairyque",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096961937770697155",
        "title": "Prompt 006 · @zyrellix",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@zyrellix · 文本生成视频",
        "positivePrompt": "A stylish young woman wearing a bright green bomber jacket, a colorful striped crop top, cargo pants, and pink sneakers walking on an open-air train station platform in Tokyo, Japan. Low-angle medium tracking shot following her as she walks towards the camera. She snaps her fingers, and with each snap, the environment and visual style instantly transform: first into a vibrant anime fantasy sky with clouds and a rainbow sunset, then into a black-and-white manga sketch art style with colored accents, and finally back to realistic live-action. She then laughs and covers her mouth with her hand. Cinematic lighting, smooth motion transitions, 8k resolution, photorealistic detail.",
        "styleTokens": [
            "Seedance 2.5",
            "@zyrellix",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@zyrellix",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096961937770697155.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096961937770697155.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096961937770697155/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096961937770697155/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096961725673140225/img/n-DKyUoXVgmSLwsf.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/zyrellix/status/2096961937770697155",
        "author": "@zyrellix",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096959231434063990",
        "title": "Prompt 007 · @ciri_ai",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@ciri_ai · 文本生成视频",
        "positivePrompt": "Generate a continuous 30-second sequence in the style of a real dashcam video, filmed from a car driving behind on an ordinary tree-lined city road in daylight — the dashcam's fixed wide-angle view with the filming car's hood and wiper edge at the bottom of frame, slightly washed-out colors, mild lens distortion, small vibrations from the road, compression artifacts, autofocus staying fixed — exactly the look of viral traffic-camera footage. Ahead: a red semi truck with a long flatbed trailer carrying massive steel coils. Core subject is the same overweight elderly woman in a pale pink floral bathrobe, with tight silver-gray permed curls, walking on the roadside — who, when a giant steel coil breaks loose and rolls off the trailer, calmly stops it with her hands, picks it up, and heaves it back onto the flatbed like it weighs nothing. Tone: absurd but played completely straight, like real footage of something impossible — no reactions from her, pure viral-video energy. Style: raw dashcam realism only — no cinematic grading, no camera movement beyond the car's own driving, no slow motion, zero cuts. Grounded physics on EVERYTHING except her strength: the coil has true massive weight in how it falls, rolls, and lands. The road ahead is otherwise empty of pedestrians; the filming car and the truck both slow safely; nobody is ever in the coil's path; nobody is injured on screen.\n\n阶段一 (0–7s, the drop): Fixed dashcam view following the red flatbed truck at normal traffic distance. A strap visibly snaps on the trailer — one enormous steel coil (taller than a person) tips, slides off the flatbed's edge, and CRASHES onto the asphalt with real catastrophic mass: the road surface cracking under the impact, a bounce of only centimeters despite the drop, dust and grit jumping in a ring, the trailer visibly rocking upward from the released weight. The coil begins rolling toward the roadside on its own momentum, slow and unstoppable, wobbling slightly on its axis. The truck's brake lights flare; it pulls over ahead. The filming car brakes gently, keeping distance, the dashcam view dipping slightly with the deceleration.\n\n阶段二 (7–14s, the stop): Same fixed dashcam view. From the tree-lined sidewalk, the grandma in the floral bathrobe walks into frame at a completely normal unhurried pace, angling to meet the rolling coil — and simply puts both palms flat against its face. The coil stops dead against her hands: her slippers slide backward a few centimeters on the grit as she absorbs its rolling momentum, her body leaning into it at a realistic bracing angle, bathrobe swaying forward from the deceleration — then stillness. She straightens up and looks at the coil the way someone looks at a fallen bag of rice. The truck driver climbs down from the cab far ahead, jogging back, then slowing to a stunned stop mid-road.\n\n阶段三 (14–22s, the lift): Continuous dashcam view. She squats beside the coil with an ordinary, practical motion — hands finding the coil's inner bore and bottom edge — and stands up WITH IT: the coil rising off the ground in her arms, its colossal mass now readable only in the physics around her — her slippers pressing visible marks into the softened asphalt, small stones cracking under her feet, her steps short and flat-footed under the load, the coil's wrapped steel bands creaking. She carries it toward the pulled-over trailer at a normal walking pace, body tilted back to counterbalance, the truck driver backing away with both hands on his head. The dashcam car rolls slowly closer, the view growing, heat shimmer off the road.\n\n阶段四 (22–30s, the throw + walk-off): Same continuous view. At the trailer's side she rocks the coil back once — a real preparatory counter-swing — and HEAVES it up onto the flatbed: the coil arcs a short, heavy, believable trajectory, lands on the trailer bed with a colossal BANG, the entire trailer slamming down on its suspension, tires bulging, the tractor unit bouncing, dust jumping off every surface, and the coil settling into place with one slow half-rotation before going still. The trailer rocks twice more on its springs, settling. She wipes her palms against each other twice — the universal \"done\" gesture — turns, and walks back toward the sidewalk at the same unhurried pace, exiting frame as the truck driver stands frozen beside his trailer. Ends with the dashcam car slowly driving past the scene: the trailer still faintly swaying, the driver staring, the cracked dent in the asphalt where the coil landed sliding past the bottom of frame.\n\n保持一致: Same elderly woman, same pale pink floral bathrobe, same tight silver-gray permed curls (never bald), slippers throughout; the red semi with flatbed trailer and giant steel coils; ONE continuous fixed dashcam shot from the following car — hood and wiper edge at bottom of frame, wide-angle distortion, washed dashcam colors, road vibration, compression-artifact texture, the view moving only with the car's own braking and slow rolling; daylight, tree-lined road; zero cuts. Her demeanor is completely ordinary and unhurried — normal walking pace, practical squat-and-lift, the palm-wipe — played dead straight, no showing off; the comedy IS the contrast between the impossible feat and her total nonchalance. All physics real EXCEPT her strength: the coil falls with catastrophic mass (cracked asphalt, centimeter bounce, trailer rocking upward on release), rolls with slow unstoppable momentum, stops against her hands with her slippers sliding and body bracing, presses her footprints into asphalt during the carry, and lands back on the trailer with full suspension slam, tire bulge, double rebound and a settling half-rotation; secondary motion on dust, grit, bathrobe and the trailer's springs throughout. Road otherwise empty of pedestrians; the driver and filming car always at a safe distance; nobody in the coil's path; nobody injured. No on-screen text, no subtitles, no slow motion, no cuts.\n\nAudio: cabin interior of the filming car — engine idle, faint radio murmur, a soft \"ồ\" from the unseen driver — under the outside sounds carried muffled through the windshield: the strap snapping, the coil's earth-shaking impact and cracking asphalt, its heavy grinding roll, the scrape of her slippers as she stops it, steel bands creaking during the carry, her flat footsteps, the trailer's colossal BANG and suspension slam with double rebound, dust settling, the truck driver's distant exclamation, traffic idling, the filming car slowly accelerating past. No voice-over. No music.",
        "styleTokens": [
            "Seedance 2.5",
            "@ciri_ai",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@ciri_ai",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #090d16 0%, #064e3b 30%, #0e7490 70%, #a21caf 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096959231434063990.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096959231434063990.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096959231434063990/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096959231434063990/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096959003763109888/img/gdI6qn_tTzmtT_DP.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/ciri_ai/status/2096959231434063990",
        "author": "@ciri_ai",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096948259059085379",
        "title": "Prompt 008 · @aiwithlumi",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@aiwithlumi · 文本生成视频",
        "positivePrompt": "Cinematic Wuxia sequence in an autumn maple forest: two martial artists, a female warrior in flowing pink-and-white silk Hanfu and a male warrior in blue robes, face off on wet mossy river rocks as golden sunbeams pierce mist and red maple leaves fall. She leaps into the air, draws her steel Jian, and glides toward him in dramatic slow motion before their blades clash with a burst of glowing sparks. She lands gracefully, splashing water around her, while a black sumi-e ink-wash effect spreads across the frame. End with a perfectly symmetrical wide shot of both warriors holding swords above their heads in synchronized guard stance, framed by red maples and radiant backlight, with hyper-detailed textures, cinematic 24fps motion, and atmospheric volumetric lighting.",
        "styleTokens": [
            "Seedance 2.5",
            "@aiwithlumi",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@aiwithlumi",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096948259059085379.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096948259059085379.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096948259059085379/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096948259059085379/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096948087067693056/img/L7TFhyOyxuafKfdt.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/aiwithlumi/status/2096948259059085379",
        "author": "@aiwithlumi",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096941153753108549",
        "title": "Prompt 009 · @doctorwasif",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@doctorwasif · 文本生成视频",
        "positivePrompt": "30s Gym Vlog — 9 Cuts\n\nCAMERA/LOOK: DV 16mm tape camcorder, handheld POV by CHASE or propped on gym equipment for lifts. Shaky framing, delayed focus, clumsy zooms, occasional face cutoffs. Soft blurry tape texture, faint noise, bloomed gym lights, flickering exposure, muted contrast, realistic skin.\n\nSTYLE: Focused, upbeat, authentic gym-vlog energy. CHASE talks through her progress between sets, showing genuine effort and small wins.\n\nCHASE: Korean idol in her 20s, long black high ponytail, expressive eyes, slim athletic build, light sweat. Modest long-sleeve athletic top, joggers/leggings, sneakers, towel around neck, no jewelry.\n\nSETTING: Evening gym with bench press, shoulder press machine, dip station, mirrors, water bottle, soft overhead lighting.\n\nSTORYBOARD:\n\n1. Bench setup (~3s): Propped medium shot. She adjusts grip and looks at camera. “Okay, push day — starting with bench press.”\n2. Bench reps (~3.5s): Side angle, controlled reps, racks bar. “That’s ten — felt stronger than last week, honestly.”\n3. Walk (~2.5s): Handheld as she grabs towel/water and heads to shoulder press. “Alright, shoulders next.”\n4. Shoulder press (~3.5s): Adjusts seat, performs set, focused. “Okay, this one’s always tough for me.”\n5. Grip insert (~2.5s): Macro close-up of hands gripping handles, sweat in light. Ambient gym audio only.\n6. Recovery (~3s): Handheld. Shakes out arms, checks form in mirror. “Definitely feeling that already.”\n7. Dips (~3.5s): Propped shot. Controlled tricep dips. “Okay, tricep dips — last one for today.”\n8. Finish (~3s): Close handheld. Steps back, slightly breathless but pleased. “That’s a solid session, I think.”\n9. Selfie outro (~3.5s): Arm’s-length selfie, wipes face, tired grin. “Push day, done — see you guys for pull day soon!”",
        "styleTokens": [
            "Seedance 2.5",
            "@doctorwasif",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@doctorwasif",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096941153753108549.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096941153753108549.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096941153753108549/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096941153753108549/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096941104356872193/img/RP03g4hrqUT1tEJM.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/doctorwasif/status/2096941153753108549",
        "author": "@doctorwasif",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096938108482642188",
        "title": "Prompt 010 · @noorwithwifi",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@noorwithwifi · 文本生成视频",
        "positivePrompt": "A slow-motion, aesthetic close-up of a stylish woman turning to smile in a cherry blossom-lined alleyway in Japan. Bright daytime natural lighting, soft focus on traditional wooden architecture in the background, delicate pink sakura petals fluttering past her face in the breeze. Photorealistic, soft warm color grading, 24fps film look.",
        "styleTokens": [
            "Seedance 2.5",
            "@noorwithwifi",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@noorwithwifi",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096938108482642188.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096938108482642188.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096938108482642188/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096938108482642188/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096936409634406401/img/d6lmOBfNszcoRSKR.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/noorwithwifi/status/2096938108482642188",
        "author": "@noorwithwifi",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096936392337358892",
        "title": "Prompt 011 · @bmx_ai13",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@bmx_ai13 · 文本生成视频",
        "positivePrompt": "Two original unique characters only. Do not use Tengen Uzui, Gyutaro, Demon Slayer faces, canon costumes, or any existing anime likeness.\n\nSUBJECT A  KAEL VORNE: tall athletic male, mid-20s, deep bronze skin, sharp jaw, short silver white undercut with thin gold chain braided through the left side, one gold orbital piercing, sleeveless dark teal combat wrap with gold coin-scale pauldron on the right shoulder, loose black hakama-cut trousers, dual short curved blades linked by a thin ringing chain. Flashy, confident, slightly desperate grin.\n\nSUBJECT B  RIVEN MOSS: gaunt male, mid-30s, ashen olive skin, long messy ink black hair with a single dull copper streak, sunken cheeks, jagged smile, tattered rust-brown wrap coat, bare wiry arms, dual hooked kama with dark wet metal. Hunched praying mantis posture, jealous hungry energy.\n\nSCENE: original night pleasure-quarter on a canal, not Yoshiwara replica — leaning timber houses, paper lanterns in amber and sick green, wet cobblestones, laundry lines, a collapsing tea-house already on fire. Smoke, sparks, drifting ash.\n\nVISUAL STYLE: high end cinematic 2D/3D hybrid anime, Ufotable level effects language but original designs  gold spark trails on Kael’s chain, thick watercolor dark blood ink slashes from Riven, impact frames, speed smears, layered debris, no copyrighted symbols.\n\n0s–4s HOOK\nExtreme wide of the burning canal street. Two silhouettes slam together. Smash cut to Kael’s gold chain snapping taut. Fast push in.\n\n4s–9s FIRST CLASH\nMedium-wide tracking: Kael and Riven sprint, dual blades vs dual kama, first lock, sparks, chain whip around a kama and yank. Low angle, readable silhouettes.\n\n9s–14s FLYING SLASHES\nRiven hurls hooked kama that multiply into spinning dark-ink crescent blades that track Kael. Kael reads the rhythm, spins, chain-blades shatter the crescents in a circular burst. Camera orbits once.\n\n14s–19s EXPLOSION + STREET RACE\nThey leap, mid-air head-on clash, fireball of sparks and timber. Cut to wide tracking as they race down the burning street, slashes leaving gold vs black-green trails, lanterns exploding as they pass.\n\n19s–25s ACCELERATING BLOWS + HOLD\nTighter MCU, blows get faster, Kael fights one-handed after the chain snaps, Riven double-kama flurry. Final hero wide: both mid-slash frozen in firelight, debris hanging, then a last impact flash. Hold 1 second.\n\nCAMERA: tracking, orbit, low angle, snap zooms on impacts, no shaky handheld mess. Keep faces and wardrobe consistent the full 25 seconds.\n\nAUDIO: (low pounding taiko + sparse distorted shamisen) <chain rattle, metal-on-metal, whoosh of ink slashes, timber explode, fire roar, wet cobble footsteps> no lyrics, no subtitles.\n\nNEGATIVE: no Tengen, no Gyutaro, no Daki, no Demon Slayer uniforms, no Nichirin logos, no storyboard grid, no panel numbers, no captions, no watermark, no extra crowd heroes, no face morph, no extra arms, no modern city, no daylight.",
        "styleTokens": [
            "Seedance 2.5",
            "@bmx_ai13",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@bmx_ai13",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096936392337358892.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096936392337358892.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096936392337358892/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096936392337358892/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096936082260832256/img/TLfOcmLhlcrTlRiz.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/bmx_ai13/status/2096936392337358892",
        "author": "@bmx_ai13",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096934507672633603",
        "title": "Prompt 012 · @iamahmedfaraz66",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@iamahmedfaraz66 · 文本生成视频",
        "positivePrompt": "Main Subject: Young Korean woman, naturally attractive, realistic skin, minimal makeup, long dark hair loosely tied back. Wearing an oversized faded lavender T-shirt, loose gray lounge pants, white socks, and a thin silver necklace. Preserve her exact identity, facial features, hairstyle, and appearance throughout.\n\nLocation: Small old Seoul apartment entryway on a quiet summer afternoon. Worn wooden floor, narrow shoe cabinet, old slippers, a small cloth, shoe brush, and a pair of slightly dirty black-and-white canvas sneakers. Soft daylight coming through the nearby window.\n\nStyle: Ultra-realistic early-2000s Sony MiniDV home video. Completely ordinary family footage, candid and unplanned. Handheld consumer camcorder, natural shake, imperfect framing, occasional autofocus hunting, slight exposure shifts, faded colors, soft contrast, DV compression, subtle motion blur and built-in microphone noise. No stabilization, cinematic movement, dramatic lighting, or polished aesthetic.\n\n00:00–00:03: She sits on the floor near the entrance, picks up one of her slightly dirty sneakers, and looks at the dusty sole.\n\n00:03–00:06: She uses an old small brush to clean dirt from the sides and sole. The camera stays close, casually following her hands.\n\n00:06–00:09: She dampens a cloth with a little water and starts wiping the sneaker, turning it around to reach the dirty areas.\n\n00:09–00:12: She compares the cleaned shoe with the other one, notices a remaining dirty spot, and casually wipes it again.\n\n00:12–00:15: She puts both sneakers side by side near the door, looks at them for a moment, then gets up and walks away in her socks. The camera remains pointed at the shoes for a few seconds before cutting.\n\nAudio: Only natural sound—brush scraping lightly against the shoe, cloth rubbing fabric, small footsteps, cupboard sounds, distant traffic, refrigerator hum, faint apartment noises and occasional birds outside. No music, narration, dramatic sound design, or added effects.\n\nGoal: Feel like completely unimportant footage from an old family MiniDV tape. Nothing dramatic happens. She is simply cleaning her shoes because they are dirty. Keep her movements casual and realistic, with no posing for the camera and no exaggerated expressions. The charm comes entirely from the mundane activity, quiet domestic atmosphere, and authentic early-2000s camcorder imperfections.",
        "styleTokens": [
            "Seedance 2.5",
            "@iamahmedfaraz66",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@iamahmedfaraz66",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #090d16 0%, #064e3b 30%, #0e7490 70%, #a21caf 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096934507672633603.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096934507672633603.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096934507672633603/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096934507672633603/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096933139352551424/img/ja3hUJUsaXq81q6m.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/iamahmedfaraz66/status/2096934507672633603",
        "author": "@iamahmedfaraz66",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096931238460178592",
        "title": "Prompt 013 · @simplyannisa",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@simplyannisa · 文本生成视频",
        "positivePrompt": "Create a 30-second, 1080p, 16:9 ultra-realistic early-2000s DV home video of a young Korean woman having an ordinary but unexpectedly memorable summer evening in an older Seoul neighborhood.\n\nA naturally pretty Korean woman in her early 20s, realistic skin, minimal makeup, long black slightly wavy hair, pale-blue knit top, loose cream trousers, white sneakers, brown crossbody bag, and silver watch. Keep her identity, face, outfit, hairstyle, and proportions perfectly consistent.\n\nSETTING\n\nA quiet older Seoul residential street with concrete lanes, apartment buildings, potted plants, bicycles, utility poles, leafy trees, and a tiny neighborhood convenience shop. Lived-in and authentic. No brands, logos, advertisements, or tourist locations.\n\nCAMERA STYLE\n\nRaw footage from a cheap early-2000s DV camcorder: shaky handheld movement, imperfect framing, autofocus hunting, exposure shifts, faded colors, soft detail, mild tape noise, accidental zooms, and natural camera mistakes. No stabilization or cinematic shots.\n\n00:00–00:06 — THE MYSTERY\n\nShe walks down the street holding a small plastic bag when she suddenly hears a faint jingling sound behind her.\n\nShe stops and looks around.\n\nThe camera quickly zooms toward her confused face.\n\nShe says:\n\n“Did you hear that?”\n\n00:06–00:12 — THE LITTLE DISCOVERY\n\nShe follows the sound and finds a small old bicycle with a tiny bell stuck slightly open.\n\nShe gently taps the bell.\n\nDing.\n\nShe looks at the camera and laughs.\n\nThen she notices a small handwritten-looking paper tag hanging from the bicycle, but the writing is too unclear to read.\n\n00:12–00:18 — THE WIND\n\nA sudden breeze blows several dry leaves across the street.\n\nOne lands directly on her head.\n\nShe doesn't notice.\n\nThe camera operator laughs.\n\nShe looks confused, then realizes and removes the leaf.\n\nShe gives the camera an embarrassed stare.\n\n00:18–00:24 — THE SMALL CHALLENGE\n\nShe places the leaf on the bicycle seat and tries to balance it there.\n\nThe wind immediately blows it away.\n\nShe tries again.\n\nIt falls again.\n\nShe laughs and finally gives up.\n\n00:24–00:30 — THE MEMORY\n\nShe picks up the leaf, puts it into her small bag, and starts walking home.\n\nAfter a few steps, she turns toward the camera and says:\n\n“Okay, that was pointless.”\n\nShe smiles and keeps walking.\n\nThe camera follows her for a few seconds before abruptly cutting to black.\n\nAUDIO\n\nNatural location sound only: footsteps, distant traffic, bicycle bell, summer insects, leaves, wind, neighborhood ambience, and natural laughter.\n\nNo music, narration, subtitles, captions, logos, watermarks, or on-screen text.\n\nREALISM\n\nNatural human reactions, imperfect timing, realistic physics, consistent objects, authentic Korean neighborhood details, and believable DV-camera imperfections. No CGI look, distorted hands, extra fingers, duplicated people, identity drift, or outfit changes.\n\n16:9 aspect ratio.",
        "styleTokens": [
            "Seedance 2.5",
            "@simplyannisa",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@simplyannisa",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096931238460178592.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096931238460178592.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096931238460178592/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096931238460178592/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096930950760304645/img/4btRZbNEx0NVeT9W.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/simplyannisa/status/2096931238460178592",
        "author": "@simplyannisa",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096930655615758734",
        "title": "Prompt 014 · @aiwithkhan",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@aiwithkhan · 文本生成视频",
        "positivePrompt": "Create a 30-second, 1080p ultra-realistic UGC video of a young Korean woman in her own bedroom, casually talking to the camera about the new camera she recently bought.\nMAIN SUBJECT\nYoung Korean woman in her early 20s, naturally beautiful, realistic skin texture, minimal makeup, black wavy hair loosely tied into a messy side ponytail with a few loose strands around her face. Wearing a fitted pastel-blue short top, loose cream pajama-style pants and a simple silver necklace.\nMaintain her exact facial identity, hairstyle, outfit, body proportions and overall appearance consistently throughout the entire video.\nSETTING\nHer own cozy bedroom in a normal Korean apartment on a warm Monday morning. She is sitting comfortably on her bed with slightly rumpled white bedding, a pillow behind her, a small bedside table, a few everyday personal items and soft natural sunlight coming through the window.\nThe room should feel lived-in and authentic, not staged or luxurious.\nUGC STYLE\nShe is holding the camera herself or it is casually propped up on the bed in front of her. The framing is slightly imperfect, with natural handheld movement, small autofocus adjustments and occasional exposure changes.\nThe video should feel like a genuine personal vlog recorded for her followers, not a polished advertisement.\nACTION / DIALOGUE\nShe sits cross-legged on the bed, looks into the lens and smiles.\nShe says naturally:\n“Okay, I finally got this camera I’ve been talking about.”\nShe laughs softly and picks up the camera to show it briefly.\n“I’ve only had it for like two days, but I already bring it everywhere.”\nShe sets it back down and leans against the pillow.\n“I wanted something that feels a little more personal than just using my phone.”\nShe looks around her room, then back at the lens.\n“The footage has this old-school look that I really love. It kind of feels like I’m recording memories instead of just posting videos.”\nShe smiles and tucks a loose strand of hair behind her ear.\nNear the end she glances at the clock, laughs and says:\n“Anyway, it’s Monday, I should probably get out of bed.”\nShe reaches toward the camera as if to stop recording, smiling naturally, and the video cuts off mid-motion.\nCAMERA / VISUAL LOOK\nAuthentic UGC with a subtle early-2000s DV-inspired feel: soft digital detail, mild image noise, slight autofocus hunting, natural skin texture and warm morning light. No dramatic lighting or cinematic camera moves.\nAUDIO\nOnly natural bedroom ambience, her voice, subtle fabric movement, distant neighborhood sounds and slight camera handling noise. No music, no narration.\nFINAL FEEL\nRelaxed Korean lifestyle creator content. Warm, feminine, intimate and believable, like a casual Monday-morning vlog filmed in her own room.\nNEGATIVE\nNo commercial acting, no perfect studio lighting, no staged influencer poses, no identity drift, no outfit changes, no distorted hands, no extra fingers, no subtitles, logos, watermarks or AI artifacts.",
        "styleTokens": [
            "Seedance 2.5",
            "@aiwithkhan",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@aiwithkhan",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096930655615758734.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096930655615758734.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096930655615758734/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096930655615758734/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096930601689567232/img/UisHINkD3YDTiWka.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/aiwithkhan/status/2096930655615758734",
        "author": "@aiwithkhan",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096921381841813588",
        "title": "Prompt 015 · @zarnab_with_ai",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@zarnab_with_ai · 文本生成视频",
        "positivePrompt": "Create a 40-second cinematic 3D animated fantasy adventure featuring an adorable chubby otter-like baby animal with soft brown fur, a cream-colored face, large expressive eyes, rosy cheeks, tiny rounded ears, and a blue scarf around its neck.\n\nMaintain the exact same character design, proportions, fur pattern, facial features, blue scarf, and visual style throughout the entire video.\n\nSCENE 1 — Meadow Chase\n\nA beautiful magical mountain meadow during a bright sunny morning. Vast green grass, tiny colorful wildflowers, distant blue mountains, fluffy white clouds, and warm golden sunlight.\n\nThe cute otter character happily runs and flies low across the meadow beside a tiny black-and-white bird carrying a small pink flower. The camera follows them with a smooth cinematic tracking shot. The grass and flowers gently blur in the foreground, creating a sense of speed and depth.\n\nSCENE 2 — Determined Hero\n\nCut to a medium close-up of the otter standing on a small grassy hill. It looks forward with a determined and slightly angry expression, raises one paw, and points toward the distant mountains as if announcing an adventure.\n\nUse expressive facial animation, subtle body movement, soft fur simulation, and cinematic depth of field.\n\nSCENE 3 — Magical Wings\n\nThe otter jumps from the edge of a high cliff overlooking a breathtaking mountain valley.\n\nSuddenly, enormous fantasy bat-like wings unfold from its back. The character begins flying through the sky above the mountains.\n\nUse a dramatic wide aerial shot showing the tiny character against the huge landscape, with sunlight glowing behind the wings.\n\nSCENE 4 — Rocket Adventure\n\nThe otter lands briefly on another cliff and activates a small futuristic rocket device attached to its back.\n\nThe rocket suddenly ignites with bright orange flames and thick dark smoke. The otter launches forward at high speed through the sky.\n\nUse dynamic camera movement, strong motion blur, flying smoke particles, glowing rocket exhaust, and a playful comedic tone.\n\nSCENE 5 — Parachute Landing\n\nAfter the chaotic flight, the otter begins descending toward the mountain meadow.\n\nA colorful rainbow-striped parachute suddenly opens above its head. The character gently floats downward while holding the parachute ropes.\n\nUse a wide cinematic shot with the beautiful valley and mountains in the background, soft clouds, warm sunlight, and drifting atmospheric mist.\n\nSCENE 6 — Sad Moment\n\nThe otter lands safely in a quiet grassy field filled with tiny white flowers.\n\nThe mood suddenly becomes emotional. The character sits alone on the grass, looking sad and disappointed, with lowered eyes and a slightly trembling expression.\n\nUse a slow cinematic push-in toward the character. Warm sunlight remains in the background while the foreground becomes softer and more intimate.\n\nSCENE 7 — Happy Discovery\n\nThe otter suddenly notices something and becomes excited. Its eyes become wide and bright, and it raises both paws happily.\n\nThe mood changes from sadness to joy.\n\nSCENE 8 — Flying Deer\n\nA magnificent magical flying deer appears beside the otter. The deer has large elegant antlers, soft fur, enormous fantasy wings, and a friendly expressive face.\n\nThe otter climbs onto the deer's back and holds onto its fur.\n\nThe deer takes off and flies majestically above the mountain valley while the small bird flies alongside them.\n\nUse a sweeping cinematic aerial shot, golden sunset lighting, volumetric clouds, beautiful mountain scenery, and strong sense of scale.\n\nSCENE 9 — Final Hero Shot\n\nEnd with an emotional close-up of the otter riding on the flying deer.\n\nThe otter looks directly toward the camera with a cute but determined expression while the sunset glows behind it. The camera slowly pushes closer to its face.\n\nPremium cinematic 3D animation, high-quality character rendering, realistic soft fur, expressive eyes, detailed environments, beautiful global illumination, volumetric lighting, cinematic depth of field, smooth character animation, natural motion, atmospheric perspective, subtle motion blur, rich environmental details, whimsical fantasy adventure aesthetic, polished animated-film quality, emotionally expressive storytelling, consistent character identity throughout.\n\n16:9 widescreen, cinematic composition, smooth transitions, professional camera movement, high detail, visually stunning, family-friendly fantasy animation.",
        "styleTokens": [
            "Seedance 2.5",
            "@zarnab_with_ai",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@zarnab_with_ai",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096921381841813588.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096921381841813588.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096921381841813588/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096921381841813588/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096921212744310784/img/gNC_q7p_QsQAP-6n.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/zarnab_with_ai/status/2096921381841813588",
        "author": "@zarnab_with_ai",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096908125794164759",
        "title": "部分提示词｜Prompt 016 · @sarantuyasimone",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@sarantuyasimone · 文本生成视频",
        "positivePrompt": "she glides to the floor very gently",
        "styleTokens": [
            "Seedance 2.5",
            "@sarantuyasimone",
            "video",
            "部分提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@sarantuyasimone",
            "video",
            "部分提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096908125794164759.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096908125794164759.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096908125794164759/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096908125794164759/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096907489849565184/img/DPUBCA616z5Qh2RV.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/sarantuyasimone/status/2096908125794164759",
        "author": "@sarantuyasimone",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096906803967840616",
        "title": "Prompt 017 · @imastudio_ai",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@imastudio_ai · 文本生成视频",
        "positivePrompt": "Create a 30-second, 16:9, 24fps photoreal cinematic travel fashion MV set in Chongqing, China.\nCORE CONCEPT:\nA fictional Korean K-pop-style young woman spends one day exploring Chongqing while listening to music through white wired earphones. The whole film feels like a stylish Korean travel vlog mixed with a youth music video — fresh, effortless, lively, and cinematic, never like a tourism commercial.\nCHARACTER LOCK:\nOne woman only, age 20–23, Korean idol visual: small refined face, fair natural skin, long black hair with soft wispy bangs, deep brown eyes, subtle aegyo-sal, thin eyeliner, glossy nude-pink lips, slim figure.\nKeep exactly the same face, hair, body proportions, makeup, and identity in every shot.\nWhite wired earphones remain visible throughout.\nNo dialogue. Emotion is shown through eye contact, small smiles, walking, turning back, laughing, and moving naturally to the music.\nWARDROBE:\nDay: cream cropped knit top, light-blue high-waisted jeans, silver earrings, black shoulder bag.\nSunset: fitted pale blue-gray top, black cropped jacket, jeans.\nNight: black camisole, oversized black jacket, silver jewelry.\nOutfit changes only on hard cuts.\nTIMELINE:\n0–3s: Extreme close selfie at a riverside viewpoint. Chongqing skyline and bridge softly blurred behind. She puts one earbud in, music starts, she smiles at camera.\n3–6s: Follow shot on a steep Chongqing hillside street. Layered buildings, slopes, trees, sunlight through leaves. Hair and earphone cable move naturally.\n6–9s: Liziba. Low angle as the monorail passes through the residential building. She looks up, then turns back and smiles.\n9–12s: Yangtze River Cableway. She stands near the window, looking over the river, bridges, towers, and steep city layers. Wind moves her hair and earphone cord.\n12–15s: Old hillside street / Shancheng Trail / Shibati. Stone stairs, old buildings, lanterns, small shops. She walks upward and glances back at camera.\n15–18s: Fast lifestyle montage: shoes on stone steps, hand on railing, buying a drink, hair in the wind, tall buildings framed between narrow streets.\n18–22s: Sunset overlook. Switch to LOOK 2. Wide skyline, river and bridges in warm orange light. Start from her back, then side profile. She closes her eyes briefly and listens.\n22–26s: Hongya Cave at night. Switch to LOOK 3. Warm golden lights, deep blue sky, real crowds. Shoot casually like a friend following her. She looks back, laughs, and keeps walking.\n26–30s: Riverside night near Qiansimen Bridge. A female friend joins. They casually bounce, turn, laugh and move to the beat — not formal choreography. The lead walks closer, removes one earbud, looks back at the glowing city.\nFinal text:\nCHONGQING\nFOLLOW THE SOUND.\nCAMERA:\n24mm city wides, 35–50mm portraits, 85mm details. Gentle handheld, walking follow, selfie framing, slow push-ins, natural low angles. Hard cuts motivated by action.\nREALISM:\nReal skin texture, natural hair physics, stable earphone cable, realistic Chongqing architecture, monorail, cableway, crowds, river and slopes.\nNEGATIVE:\nNo face drift, duplicate character, random wardrobe change, missing earphones, warped hands, plastic skin, cyberpunk Chongqing, Japanese or Korean streets replacing Chongqing, fake landmarks, random text, subtitles, watermark, excessive beauty filtering.\nFINAL FEEL:\nA Korean K-pop girl’s first day in Chongqing — music in her ears, the whole city moving like her own MV.",
        "styleTokens": [
            "Seedance 2.5",
            "@imastudio_ai",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@imastudio_ai",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #090d16 0%, #064e3b 30%, #0e7490 70%, #a21caf 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096906803967840616.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096906803967840616.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096906803967840616/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096906803967840616/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096906661663490048/img/v85yCRL1jZ4kFbqX.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/imastudio_ai/status/2096906803967840616",
        "author": "@imastudio_ai",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096903888813330826",
        "title": "Prompt 018 · @lianaalane",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@lianaalane · 文本生成视频",
        "positivePrompt": "Create a hyper-realistic cinematic 15-second food video in the exact glossy ultra-detailed commercial style of premium Asian street-food ASMR films, with creamy soft lighting, slow-motion juice drips, rising steam and mouth-watering close-ups.  \nWooden chopsticks slowly lift a plump white shengjianbao from a black iron pan, black sesame seeds and green onion on top, dough shining under warm light. The bao is torn open in dramatic slow motion as thick golden broth and juicy minced meat filling burst out, sticky amber sauce stretching and cascading downward in long glossy strands while dense white steam swirls upward. Extreme close-up of the savory meatball-like filling as golden liquid continuously drips into a white ceramic spoon, forming perfect heavy droplets. Wide shot of a cast-iron skillet packed with perfectly pleated raw baozi on a gas stove as clear water is poured in, instantly creating thick clouds of steam. Tight shots show the bottoms crisping into golden lace-like crusts while a metal spatula flips them, revealing caramelized crunchy edges. Finished baozi stacked on a blue-and-white plate, one bitten open to reveal steaming pinkish meat and sauce, chopsticks dipping it into dark soy-sesame dipping sauce. Final wide shot of the steaming plate under a warm hanging lamp on a wooden table in a cozy night kitchen, soft steam rising against a dark window with distant city lights.",
        "styleTokens": [
            "Seedance 2.5",
            "@lianaalane",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@lianaalane",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096903888813330826.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096903888813330826.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096903888813330826/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096903888813330826/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096903839370928128/img/RLabFK1IAGt5PN-3.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/lianaalane/status/2096903888813330826",
        "author": "@lianaalane",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096902275704955354",
        "title": "Prompt 019 · @itswsm105f",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@itswsm105f · 文本生成视频",
        "positivePrompt": "GIRL = MAIN CHARACTER: Young Korean woman in her early 20s, natural appearance, black wavy hair loosely tied into a messy side ponytail, fitted short crop top, loose cargo pants, black sneakers and a simple silver necklace. Realistic skin texture, natural makeup, authentic facial expressions, realistic biomechanics and completely consistent identity throughout. Use the reference image as the exact identity reference.\n\nBOYFRIEND: Young Korean man in his early 20s, casual oversized white T-shirt, loose dark jeans, sneakers, slightly messy black hair, natural appearance and relaxed personality. Keep his appearance completely consistent throughout.\n\nLOCATION: A lively Korean beachside market during a warm late afternoon. Small colorful food stalls, seafood stands, souvenir shops, beach umbrellas, string lights, people walking around, bicycles, scooters, ocean visible in the background and waves rolling onto the nearby beach. Everything feels like an ordinary local beach market.\n\nCAMERA / LOOK: Early-2000s handheld consumer DV camcorder filmed by a friend walking with the couple. Strong natural shake, imperfect framing, autofocus hunting, exposure shifts, faded colors, digital noise, slight motion blur, accidental zooms and rolling-shutter wobble. No polished modern cinematography. Feels like an old personal vacation recording.\n\nSEQUENCE — 30 SECONDS:\n\n0–5 SEC:\nThe girl and her boyfriend walk through the busy beach bazaar together, casually sharing a cold drink. She playfully steals the drink from his hand and takes a sip. He looks at her pretending to be annoyed. She laughs and gives it back.\n\n5–10 SEC:\nThey stop at a small street-food stall. The boyfriend points excitedly at a giant grilled seafood skewer. She laughs at how seriously he is choosing his food. He takes a bite while she watches, then she quickly steals a bite from his skewer.\n\nShe looks directly at the camera and says:\n“He said he wasn't hungry.”\n\nHer boyfriend immediately looks at the camera and says:\n“Hey!”\n\n10–16 SEC:\nThey continue walking. The boyfriend notices a small claw-machine style beach game stall. He challenges her to win a tiny stuffed toy. She confidently tries and completely fails. She laughs and lightly pushes his shoulder.\n\nHe tries next and surprisingly wins.\n\nShe looks genuinely shocked, grabs the tiny prize and hugs it.\n\n16–22\nThey walk toward the beach holding the little toy between them. A sudden ocean breeze blows the girl's hair across her face. Her boyfriend gently fixes her hair while she laughs.\n\nShe playfully takes his sunglasses and puts them on herself.\n\nHe reaches for them, but she runs a few steps toward the beach.\n\nThe camera follows shakily while both laugh.\n\n22–27\nThey stop near the shoreline. She turns toward him, holding the tiny stuffed toy, and jokingly says:\n\nOkay, you win.\n\nHe smiles and points toward the camera.\n\nShe suddenly realizes the camera has been filming everything and laughs.\n\n27–30\nThey walk away together along the beach, shoulder-to-shoulder. She bumps him playfully with her shoulder. He bumps her back.\n\nShe looks back toward the camera with an amused smile and says:\n\nDon't show this to anyone.\n\nHer boyfriend laughs.\n\nThe camera zooms awkwardly toward them as they continue walking beside the ocean.\n\nCUT TO BLACK.\n\nACTION STYLE: Natural couple interaction, playful teasing, casual gestures, realistic walking, believable body movement and authentic chemistry. No exaggerated acting, no dramatic romance poses, no unrealistic movement.\n\nAUDIO: Natural beach ambience, ocean waves, distant conversations, footsteps, food-stall sounds, bicycle bells, light wind, laughter, street vendors, camera operator breathing and handheld camcorder noise. No background music.\n\nFINAL FEEL: A spontaneous early-2000s vacation home video capturing a young couple having silly, affectionate fun at a Korean beach bazaar. Cute, playful, imperfect and authentic rather than cinematic or staged.",
        "styleTokens": [
            "Seedance 2.5",
            "@itswsm105f",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@itswsm105f",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #0f766e 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096902275704955354.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096902275704955354.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096902275704955354/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096902275704955354/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096902157702414336/img/RpbGBKwoqrF4OoUs.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/itswsm105f/status/2096902275704955354",
        "author": "@itswsm105f",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-2-5-2096892990371565650",
        "title": "Prompt 020 · @ayzalnooor24521",
        "kind": "video",
        "category": "文本生成",
        "crossCategories": [
            "文本生成"
        ],
        "description": "@ayzalnooor24521 · 文本生成视频",
        "positivePrompt": "Created, anime style video of this kind, about 15 seconds long.  \nA warm cozy kitchen scene begins with a hand slicing a fresh onion on a wooden cutting board next to diced bacon pieces, then shifts to mixing raw ground meat with sliced onions and a cracked egg inside a clear glass bowl. Next a thick triangular slice of yellow Swiss cheese is carefully placed in the center of a large raw meat patty and the meat is folded and sealed tightly around the cheese to form a stuffed burger. The sealed meat is placed into a hot black cast-iron pan with sizzling oil on a gas stove, searing until the surface turns golden brown with bubbling juices. A wooden spoon then pours thick glossy dark brown sauce over the cooked patty. Finally the juicy sauced patty is stacked between sesame seed buns with melting yellow cheese, tomato and onion slices, a hand gently presses the top bun, and the finished oversized cheese-stuffed burger is shown plated on a white dish beside a tall glass of iced cola on a sunlit wooden table in a bright kitchen.",
        "styleTokens": [
            "Seedance 2.5",
            "@ayzalnooor24521",
            "video",
            "完整提示词"
        ],
        "tags": [
            "seedance2.5",
            "Seedance 2.5",
            "@ayzalnooor24521",
            "video",
            "完整提示词"
        ],
        "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #9a3412 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096892990371565650.jpg",
        "previewThumbnail": "/offline-assets/seedance-2-5/covers/seedance-2-5-2096892990371565650.jpg",
        "previewVideo": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096892990371565650/output.mp4",
        "remoteBackupUrl": "https://pub-62cf7640cd0f4066b60933bd2e9b85ef.r2.dev/x-info/seedance-2-5/2096892990371565650/output.mp4",
        "remoteThumbBackupUrl": "https://pbs.twimg.com/amplify_video_thumb/2096892955567276032/img/60XpVJD-vIvXbztc.jpg",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.5 提示词库",
        "sourceUrl": "https://x.com/ayzalnooor24521/status/2096892990371565650",
        "author": "@ayzalnooor24521",
        "recommendedParams": {
            "model": "Seedance 2.5",
            "duration": 15,
            "aspectRatio": "16:9"
        }
    },
    {
        "id": "seedance-storyboard-case-1",
        "title": "Seedance 2.0 图生视频：客厅深夜老鼠惊魂连续运镜",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "阿杰与小敏吃薯片看恐怖片、冰箱制冰声惊跳起跳与捕鼠夹晾袜笑场的16镜情景喜剧完整故事板。",
        "positivePrompt": "按照这个故事板来创作广告 / 电影。动态的摄像机运动，镜头中不出现摄像机设备\n故事 = 一部情景喜剧，两人刚看完一部恐怖片，正努力用薯片缓解紧张情绪，发生的老鼠事件让生活变得更有趣味。\n场景：客厅沙发，深夜。\n人物：阿杰（人物形象严格参考）、小敏（人物形象严格参考）\n剧情不能遗漏任何一个分镜。\n1. 两人紧抱薯片、神情紧张地坐在沙发上看着恐怖片的远景\n2. 阿杰特写，他忽然僵住：“厨房…… 是不是有老鼠？”\n3. 小敏特写，瞳孔地震：“绝对不行！不许过去！”\n4. 阿杰特写，强装镇定：“哎呀，别这样，我可是男人……”\n5. 厨房传来一声塑料响，两人同时抱在一起尖叫的远景\n6. 小敏的手特写，伸进薯片袋，只抓出一点碎渣\n7. 两人全景，她把碎渣撒向阿杰头顶：“你这个坏蛋！租一楼方便了老鼠！”\n8. 阿杰顶着薯片渣的委屈特写：“方便拿快递也是真的……”\n9. 小敏特写，突然眼睛一亮：“等等，你去年买的那个捕鼠夹呢？”\n10. 阿杰特写，眼神躲闪：“那个…… 我拿去晾袜子了。”\n11. 小敏特写，难以置信地愣了两秒：“你把捕鼠夹当晾袜架？”\n12. 阿杰特写（笑场）：“它张力太好了！夹一只袜子从不掉！”\n13. 两人全景，小敏抄起遥控器当武器：“走！一起去看！”\n14. 阿杰特写，拿薯片当盾牌举在脸前：“好吧，听你的……”\n15. 两人侦察兵般弓腰前进的远景，突然冰箱制冰声响起，两人原地起跳\n16. 大远景两人蹲在沙发上爆笑，薯片被跳起来的阿杰踩碎一地\n---",
        "styleTokens": [
            "情景喜剧",
            "16镜线稿",
            "深夜客厅",
            "幽默生活",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "情景喜剧",
            "线稿故事板",
            "Seedance2.0",
            "分镜调度"
        ],
        "gradient": "linear-gradient(135deg, #7c2d12 0%, #9a3412 50%, #c2410c 100%)",
        "accentColor": "#f97316",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-01.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-01.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-01.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-1",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-2",
        "title": "Seedance 2.0 图生视频：客厅情景喜剧笑场日常多镜调度",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "两人坐在沙发吃薯片讨论等下吃什么、扔薯片互动与笑场爆笑日常的经典情景喜剧故事板。",
        "positivePrompt": "按照这个故事板来创作广告/电影。动态的摄像机运动，镜头中不出现摄像机设备，\n故事 = 一部情景喜剧，有两个人一起坐在沙发上讨论在等下出去吃什么，包括笑场\n1. 两人坐在沙发上吃薯片的远景\n2. 两人特写，男人说“等下出去吃寿司可以吗？”\n3. 女士特写：\"绝对不行\"\n4. 男性特写：\"哎呀，别这样\"\n5. 她的手特写，伸手去拿薯片\n6. 两人全景，她把薯片扔向他，说：\"你这个坏蛋\"\n7. 特写男子说\"好吧，听你的\"\n8. 大远景两人笑 避免场景过于相似",
        "styleTokens": [
            "情景喜剧",
            "多视角网格",
            "日常生活",
            "欢快笑场",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "客厅日常",
            "笑场分镜",
            "Seedance2.0",
            "多镜头叙事"
        ],
        "gradient": "linear-gradient(135deg, #854d0e 0%, #a16207 50%, #ca8a04 100%)",
        "accentColor": "#eab308",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-02.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-02.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-02.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-2",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-3",
        "title": "Seedance 2.0 图生视频：校园教室吃什么情景喜剧连镜",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "教室吃薯片讨论烤肉与麻辣烫、扔薯片抗议与笑场的校园日常幽默分镜故事板。",
        "positivePrompt": "按照这个故事板来创作广告/电影。动态的摄像机运动，镜头中不出现摄像机设备，\n故事 = 一部校园喜剧，有两个人一起坐在教室讨论等下出去吃什么，包括笑场\n两人坐在教室吃薯片的远景\n两人特写，男人说\"出去吃烤肉怎么样？\"\n女士特写：\"太腻了\"\n男性特写：\"那麻辣烫？\"\n她的手特写，伸手去拿薯片\n两人全景，她把薯片扔向他，说：\"你能不能换个花样\"\n特写男子说\"好吧，你定\"\n大远景两人笑",
        "styleTokens": [
            "校园喜剧",
            "教室情境",
            "微距网格",
            "青春幽默",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "校园青春",
            "情景喜剧",
            "Seedance2.0",
            "短剧分镜"
        ],
        "gradient": "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #2563eb 100%)",
        "accentColor": "#3b82f6",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-03.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-03.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-03.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-3",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-4",
        "title": "Seedance 2.0 图生视频：仙侠受击倒飞与御剑破空特效",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "女主被击飞砸入山壁、尘土飞扬、剑诀御剑高空舞动与淡蓝剑气破空轰击黑雾的玄幻动作故事板。",
        "positivePrompt": "按照这个故事板来创作广告/电影。动态的摄像机运动，镜头中不出现摄像机设备，\n故事 =女主被击飞，倒飞砸在身后的山壁上。周围扬起尘土。突然，女主从尘土中飞出，手掐起剑诀，御剑而起飞向高空，长剑围绕女主身体四周舞动，随后在女主停止上升后，飞剑伴随着淡蓝色剑气破空而出，以几块的速度向远方的黑雾攻击而去",
        "styleTokens": [
            "仙侠玄幻",
            "御剑飞行",
            "淡蓝剑气",
            "高空舞剑",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "仙侠玄幻",
            "御剑破空",
            "Seedance2.0",
            "视觉特效"
        ],
        "gradient": "linear-gradient(135deg, #064e3b 0%, #047857 50%, #059669 100%)",
        "accentColor": "#10b981",
        "icon": "Film",
        "previewImage": "/images/inspirations/high/vid-storyboard-case-04.webp",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-04.webp",
        "previewVideo": "",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-4",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-5",
        "title": "Seedance 2.0 图生视频：3D写实街球16步连续运球训练广告",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "4x4网格16步彩铅手绘街球教学示意图，身体姿势、运球轨迹、脚步站位与15秒3D写实街球广告。",
        "positivePrompt": "@图片1(上传角色参考图)，@图片2(上传16步篮球训练动作示意图)\n以图片1中的角色为唯一主角，严格保持角色外观一致:瘦高夸张体型、细长脖子、卷短发、长脸、大耳朵、浅蓝色NIKE街头篮球上衣、宽松黑浅黄短裤、白色连脚袜、黑白高帮球鞋。\n参考图片2中的16个篮球训练动作顺序:生成一段15秒的3D写实街头篮球训练视频。整体风格为高质量3D角色动画、电影级真实感、街头篮球广告片质感。动作流畅自然，篮球物理真实，身体发力清晰，动作衔接丝滑。\n场景为纽约市户外硬地篮球场，混凝土地面，铁丝网围栏，涂鸦墙，远处城市楼群黄金时刻暖色夕阳光，街头氛围强烈，背景简洁。\n镜头采用全景/中全景跟拍，角色始终位于画面中央，从头到脚完整可见，篮球始终在画面内。镜头轻微手持感和平滑跟随，避免特写裁切、避免极端角度、避免频繁跳切。\n15秒内按顺序完成16个动作:\n右手原地运球低位左右交叉运球胯下过球背后运球髋部停球节奏大幅交叉步360度转身控球外推后拉回横向长跨步急停低运球后撤带球八字绕腿步法低身前冲突破高速运球冲刺全速冲向篮筐单手高举篮球收尾。\n每个动作都必须与上一个动作明显不同，身体姿势、持球方式、脚步站位、重心变化都要清晰可辨。动作之间自然衔接，形成一整套高水平街球连续运球组合，快速、利落、流畅，不重复。\n画面要求:真实3D质感，动作自然，球体弹跳真实，鞋底摩擦地面有力量感，角色比例和服装保持一致。背景音乐为纽约街头嘻哈节奏，低音有力，鼓点清晰。加入篮球落地声、鞋底摩擦声、急停滑步声。\n负面限制:不要裁掉头或脚部，不要换脸，不要换衣服，不要多人物，不要篮球漂浮，不要动作重复，不要手脚畸形，不要画面闪烁，不要纯CG假人感。",
        "styleTokens": [
            "街头篮球",
            "彩色铅笔画",
            "4x4网格",
            "动作解构",
            "3D写实动画",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "街头篮球",
            "运动训练",
            "Seedance2.0",
            "动作示意图"
        ],
        "gradient": "linear-gradient(135deg, #c2410c 0%, #ea580c 50%, #f97316 100%)",
        "accentColor": "#fb923c",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-05.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-05.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-05.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-5",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-6",
        "title": "Seedance 2.0 图生视频：赛车手城市竞速16镜极限漂移",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "赛车手穿戴头盔、启动轰鸣、弯心贴地过弯火花与夜间赛道降档漂移的16镜电影级竞速故事板。",
        "positivePrompt": "按照这个故事板来创作广告/电影。动态的摄像机运动，镜头中不出现摄像机设备，\n故事=这是一段赛车骑手的专业竞速展示视频。\n场景:城市街道。\n人物:青年(人物形象必须使用图1，衣服穿着必须根据剧情中的设定\n剧情内容如下:\n镜头1:特写·静态，黑暗中，一双手套的手指缓缓收紧。碳纤维与皮革的材质光泽细腻，指尖有磨损的痕迹。头盔安静地放置在面前，深色镜片倒映出机库的顶灯。\n镜头2:中景·慢动作起幅，他拿起头盔。动作不急不躁，像执行一个仪式。手腕翻转时，可以看见手套背部坚硬的护壳结构。背景中，赛车的轮廓在阴影里隐约浮现。\n镜头3:大特写·固定机位，头盔穿过画面中心，稳稳套下。镜片“咔嗒”一声扣紧，声音清脆。视线被深色镜片吞没，只剩对面赛车轮廓上的一丝高光。\n镜头4:近景·甩镜头跟拍，他俯身，拉拽赛车服的拉链。红色竞技服上布满赞助商Log0与耐磨滑块，布料紧绷，勾勒出肩背线条。拉链一拉到底，胸膛起伏-次。\n镜头5:低角度仰拍·横移，他走向赛车。靴底踩过水泥地面每一步都坚实。镜头从靴子摇到腰间，再摇到低垂的头盔。赛车尾部的单摇臂与排气管进入画面边缘。\n镜头6:细节蒙太奇·快切，三组快速切换:1插钥匙，仪表盘灯光自检亮起，指针扫过表底。2戴手套，掌心紧扣车把。3启动按钮按下，引擎第一声低吼，画面微微震动，\n镜头7:侧面特写·慢动作。车身侧倾，他跨坐上去。动作流畅如一体。俯身趴下，胸口贴住油箱。曲轴箱边盖映出他头盔的一角倒影，逐渐稳定。\n镜头8:主观视角·速度感，头盔镜片内视角。赛道白线从中央向两侧飞速后掠。转速表指针猛烈敲击红线区，换挡提示灯依次亮起猩红色。引擎声高亢啸叫。\n镜头9:大远景·航拍感。赛车在赛道上划出高速弧线。带刹车进弯瞬间，尾灯拉成一道红色光痕。车身低得几乎贴地，膝盖滑块擦出白色烟雾。背景看台虚化。\n镜头10:中景·低位路肩视角赛车轮毂从镜头旁高速碾过，胎屑飞溅。骑手身体大幅度侧挂，头盔几乎接触地面，肘部滑块摩擦火花。弯心路肩的黄红路缘石急速后退。\n镜头11:主观视角(头盔内侧)，镜片略微抬起一瞬。前方是高速隧道入口，黑暗迅速吞没光线。仪表背光是唯一照明，照出他紧绷的下颌线。呼吸声变得沉重而清晰。\n镜头12:正面特写·慢动作，冲出隧道。强光瞬间铺满镜片，反光中看不清眼睛，只能看见对面山壁的倒影。水汽在镜片外侧被风吹散，像撕裂一道帷幕。\n镜头13:近景·手持跟拍，进入城市夜间赛道。路灯眩光在镜片上拉出条状光轨。他连续快速降档，每一下都伴随补油声。刹车碟因高温变为暗红色，照亮前轮。\n镜头14:远景·空旷街道，从一个低速发卡弯出来，后轮在出弯瞬间短暂打滑空转，留下一条黑色胎痕。烟尘中，车身短暂扭曲后恢复笔直，加速冲向下一个直道。\n镜头15:中景·推轨横移，赛车滑行进入维修区。速度逐渐降低，他抬起身体，坐直。引擎声从高频回落为沉稳怠速。头盔缓慢转向侧面，看向某个方向一-那里什么都没有，又好像什么都有。\n镜头16:低角度特写·一个连贯动作，停车瞬间。左脚从脚踏上移开，准确踩下侧支架。金属支脚以干净利落的力道“咔”一声撑开地面。他松开离合，车身微沉。下一秒，从右边下车，拔钥匙，转身一-头盔镜片内，视线穿过画面，望向观众。安静。轰鸣声消失。只剩下金属冷却的细微响声，\n限制:仅生成对白和BGM，但禁止生成字幕。剧情不能遗漏任何一个分镜。",
        "styleTokens": [
            "机车竞速",
            "城市夜赛",
            "弯心火花",
            "16镜蒙太奇",
            "引擎声浪",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "机车竞速",
            "硬核动作",
            "Seedance2.0",
            "电影摄影"
        ],
        "gradient": "linear-gradient(135deg, #831843 0%, #9d174d 50%, #be185d 100%)",
        "accentColor": "#f43f5e",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-06.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-06.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-06.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-6",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-7",
        "title": "Seedance 2.0 图生视频：超市子弹时间与超极限残影打斗",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "冷色调超市荧光下，人类极限爆发速度、蛛网地砖裂纹、护甲内陷与子弹时间连击的16镜硬核格斗。",
        "positivePrompt": "按照这个故事板来创作广告/电影。动态的摄像机运动，镜头中不出现摄像机设备，\n故事 =这是一段高速移动的动态模糊与子弹时间的冲击感打斗视频。\n场景:超市。\n人物:青年(人物形象必须使用图1，衣服穿着必须根据剧情中的设定)\n限制:仅生成对白和BGM，但禁止生成字幕。剧情不能遗漏任何一个分镜。剧情内容如下:\n[总体风格与氛围】\n电影感写实、冷色调超市荧光，青年拥有顶尖人类极限的速度(启动爆发带残影)，打击瞬间触发子弹时间特效。武装人员未来感十足，面部完全被战术面具遮挡。\n[16镜头分镜脚本】(总长15秒)\n镜头1(1秒)\n中景。超市货架通道，青年身着深色连帽衫，正伸手从货架上拿起一袋零食查看。\n镜头2(0.8秒)\n广角。超市自动门猛然滑开，十几个全副武装的黑甲作战人员冲入，作战头盔下是纯黑战术面罩，脸部完全不可见，突击步枪枪口齐刷刷平举。\n镜头3(0.5秒)\n特写。青年眼神斜瞥向门口，表情瞬间由闲适转为绝对的镇定，缓缓放下手中零食。\n镜头4(0.7秒)\n过肩视角。十几支黑洞洞的枪口共同指向青年后背，激光指示器的红点密集地落在他心脏位置。\n镜头5(1.2秒)\n子弹时间特效开始。青年闭眼一秒后睁眼，周围时间流速急剧变慢他身体重心微降，右脚蹬地的一瞬，地砖出现蛛网裂纹，裂纹缓慢扩散。\n镜头6(0.5秒)\n极速摇镜。青年原地留下一道破碎的残影，本体已如贴地飞行般闪向最近的一名武装人员，货架上的商品被劲风带起悬空。\n镜头7(0.6秒)\n主观追踪镜头。以超高速侧面跟拍青年在过道冲刺，身体拖出流线型速度线，画面边缘因极速产生拉伸畸变，0.2秒内逼近第一个目标。\n镜头8(1.5秒)\n子弹时间特写。青年一记冲拳轰在第一个敌人腹腔护甲上。时间几乎凝固，护甲以拳头接触点为中心内陷形变，敌人身体被击退腾空，双手脱力松开步枪，战术面罩挤出气流。\n镜头9(1.2秒)\n子弹时间延续。青年顺势转身，一记回旋鞭腿扫向第二人颈部。慢动作下，腿如钢鞭划过空气，击中的刹那，头盔侧面战术手电碎裂，晶莹碎片缓缓飞散，敌人身体开始侧向折叠。\n镜头10(0.8秒)\n瞬间恢复正常速度。被拳击的敌人重重砸倒一排购物篮，被踢中的敌人横飞进货架，商品哗然崩塌。青年已不在原地。\n镜头11(0.7秒)\n高速双连击。画面快速横摇，青年同时出现在第三、四人中间，左肘击打一人面罩，右掌劈向另一人持枪手腕，动作快到出现多重残影，两个敌人同时失衡。\n镜头12(1秒)\n子弹时间仰拍。青年跃起，膝盖顶向第五人下巴。时间变慢，青年腾空姿态舒展，膝盖接触下巴瞬间，面罩出现凹陷，敌人口中喷出细微唾液，身体被竖直顶起离地。\n镜头13(0.9秒)\n窄通道穿梭。青年以极限跑酷般的高速在人群中Z字形穿插，经过货架时脚尖轻点，将第六、七人用肩撞和扫腿快速放倒，背景中商品纸盒漫天飞舞。\n镜头14(1.2秒)\n子弹时间终结技。青年闪到最后一名敌人身前，右手快如闪电抓住其步枪枪管，在慢速中直接将金属枪管捏至弯曲，左手借力将其整个人抡翻过头摔向地面，敌人身体悬浮在半空缓慢划出弧线。\n镜头15(1.6秒)\n恢复正常。最后一名敌人砰然落地，激起尘埃。所有十余名武装分子横七竖八倒在过道。青年在漫天缓慢飘落的商品包装纸中站定，神态平静，伸手轻拍肩头灰尘。\n镜头16(1.8秒)\n固定全景。青年走回货架前，弯腰捡起最初那袋零食，若无其事走向收银台。身后狼藉的过道顶灯闪烁，映出他修长淡定的影子。画面渐暗，结束。",
        "styleTokens": [
            "子弹时间",
            "极速残影",
            "超市冷光",
            "蛛网裂纹",
            "近身搏击",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "子弹时间",
            "硬核打斗",
            "Seedance2.0",
            "特工动作"
        ],
        "gradient": "linear-gradient(135deg, #312e81 0%, #3730a3 50%, #4338ca 100%)",
        "accentColor": "#6366f1",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-07.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-07.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-07.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-7",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-8",
        "title": "Seedance 2.0 图生视频：废墟重力倒流与半透明巨型法相",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "废墟中站定、碎石逆重力缓缓升起、紫色能量流动、双手结印与天地间半透明巨型凤凰法相显化。",
        "positivePrompt": "按照这个故事板来创作广告/电影。动态的摄像机运动，镜头中不出现摄像机设备，\n故事 =遍体鳞伤的主角在废墟中艰难站定，汗水顺着手臂滴落。 突然，周围的碎石违背重力缓缓升起，\n空气中出现紫色的能量流动。 主角双手结印，怒吼而出。由于能量过强，他的轮廓开始产生视觉错位。\n身后巨大的半透明凤凰法相开始显现。 巨大的法相连接地面，屹立于天地之间。 它的身体由无发光洁的\n几何面构成，折射着光芒，而主角只是脚下渺小的黑点\n\n\n### 故事板提示词\n图1图2是主角的图片，图3是法相变身后的参考（参考武器，穿着）故事 =主角站在悬崖边上，闭眼双\n手快速结印，结印完成后后摊开双臂，同时头顶一只金色巨眼张开，金色巨眼消散后汇聚成巨大的法\n相，巨大的法相连接地面，屹立于天地之间，而主角只是脚下渺小的黑点。 法相身着黑金色盔甲，白色\n屁帘，一头白发，浑身萦绕着金光和仙气飘带\n避免场景过于相似 创建一个电影制作板/视觉规划表，\n比例16:9，展示短片或商业广告的完整概念。布局应简洁、基于网格，并分为清晰标记的部分。 包含：\n共享创意指导（顶部栏）：整体限制，如镜头数量、统一的调色板和一般的环境背景。 角色与风格参考\n部分： 一个从多个角度展示的模型（正面、背面、侧面、特写、放松姿态），配有服装和配饰参考。强\n调身份的一致性，同时允许在特定场景中进行细微变化。 环境和场景设计部分： 一个具有戏剧性自然特\n征的场景户外地点，以及一个俯视示意图，说明在空间中的移动路径。包括摄像机位置和沿路线标注的\n拍摄类型。 故事板部分： 一系列编号的帧（大约 8 个镜头）展示场景的进展。每个帧包括：摄像机类\n型/镜头感觉 镜头大小（广角、中景、特写、微距） 运动方式（静态、跟踪、手持等） 动作和情绪进展\n的简要描述 灯光/情绪/风格备注： 与灯光条件、氛围和纹理相关的视觉示例和简短描述。包括一天中不\n同时间的过渡和光线质量的变化。 情绪和关键词块：指导作品的简洁情绪基调主题描述列表。 \n音频/音调部分： 环境声音、音乐风格和整体声音氛围的指示。 电影摄影笔记： 包括镜头特性、运动风格和后\n期处理感觉的总体视觉哲学。 整个版面应感觉连贯、电影化且专业设计——就像导演的预制作指南，能\n一眼传达出基调、节奏和视觉叙事。",
        "styleTokens": [
            "重力倒流",
            "紫色能量",
            "凤凰法相",
            "天地屹立",
            "史诗异能",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "异能觉醒",
            "凤凰法相",
            "Seedance2.0",
            "视觉奇观"
        ],
        "gradient": "linear-gradient(135deg, #4c1d95 0%, #5b21b6 50%, #6d28d9 100%)",
        "accentColor": "#8b5cf6",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-08.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-08.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-08.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-8",
        "recommendedParams": {
            "duration": 20,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-9",
        "title": "Seedance 2.0 图生视频：民国梨园以命换命戏台悲壮大片",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "戏班后台与寿宴戏台之间，整理龙凤戏服、暗下毒药、夫妻对视合唱立咒与戏楼火海坍塌的悲壮故事板。",
        "positivePrompt": "故事全能参考模式\n核心风格：民国抗战悲剧，梨园戏班氛围感，压抑悲壮，电影级画质，暗调光影，细节拉满，适配Seedance2.0模型，优先渲染人物情绪与场景氛围感，镜头衔接自然流畅\n【分镜1】画质4K，电影级暗调，民国戏班后台实景，远景缓慢推进，两人端坐镜前整理龙凤戏服，全程沉默，对面摆日军寿宴酒菜，氛围极致压抑；时长：5秒\n【分镜2】画质4K，男人面部特写，光线偏暗照亮半张脸，眼神凝重，低声说：“今夜这一场戏，唱完就再也回不来了”，语气沙哑决绝；时长：6秒\n【分镜3】画质4K，女人面部特写，光线柔和却昏暗，缓缓抬眼，眼神坚定：“只要能让他们偿命，值了”；时长：6秒\n【分镜4】画质4K，近景水平运镜，男人侧身从袖口抽毒药，隐秘倒入酒壶，低声说：“等他们举杯，就是报仇的时候”；时长：6秒\n【分镜5】画质4K，女人手部特写，轻轻抚摸凤冠流苏，呢喃：“戏要唱完，魂也得留在这戏台上”；时长：6秒\n【分镜6】画质4K，全景俯拍拉平，日军嚣张宴饮，两人身着戏服台上唱戏，短暂对视藏着默契与诀别；时长：4秒\n【分镜7】画质4K，男人面部特写，余光扫向毒发日军，嘴角冷笑，低声唱：“今我二人”，唱腔苍凉；时长：4秒\n【分镜8】画质4K，特写+近景，女人眼含热泪抢戏词：“今我夫妻二人”，两人对视合唱：“立咒于此台，以此身，此魂，镇压，尔等罪人!”；时长：10秒\n【分镜9】画质4K，大远景缓慢拉远，戏台起火，两人立于火海，日军倒地挣扎，戏楼坍塌，渐暗收尾；时长：6秒",
        "styleTokens": [
            "民国谍战",
            "梨园戏班",
            "龙凤戏服",
            "以命换命",
            "戏台火海",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "民国谍战",
            "戏曲短剧",
            "Seedance2.0",
            "悲剧史诗"
        ],
        "gradient": "linear-gradient(135deg, #881337 0%, #9f1239 50%, #be123c 100%)",
        "accentColor": "#e11d48",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-09.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-09.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-09.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-9",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
        "id": "seedance-storyboard-case-10",
        "title": "Seedance 2.0 图生视频：古风少年伴读书童戳穿甜宠镜头",
        "kind": "video",
        "category": "剧情叙事与短剧分镜",
        "crossCategories": [
            "商业广告与TVC故事板",
            "电影级运镜与基础机位"
        ],
        "description": "浴桶水汽氤氲、女扮男装苏软软僵立、太子萧煜辨认、拽入手腕、耳语撩拨与慢镜定格的古风甜宠故事板。",
        "positivePrompt": "按照这个故事板来创作广告/电影。动态的摄像机运动，镜头中不出现摄像机设备，\n故事 =古装甜宠故事，苏软软女扮男装，给太子萧煜当伴读书童，被萧煜戳穿了假身份。\n0-2s（近景）：水汽氤氲，萧煜在浴桶，转头见屏风外男装苏软软僵立，苏软软瞳孔骤缩，萧煜水珠滑锁骨、眯\n眼辨认，萧煜台词：“ ”；2-4s（特写+中景切换）：苏软软耳尖通红捂眼转身，萧煜从浴桶站起，萧煜长臂攥住\n她手腕，苏软软踉跄被拽回，苏软软台词：“殿下恕罪！”；4-7s（中景）：苏软软被拽进浴桶，男装半透，萧煜\n从背后环住她，苏软软僵立，萧煜收臂、勾开她束发带，萧煜台词：“跑什么。”；7-10s（近景·耳语）：苏软软长\n发散落，萧煜咬她耳尖，气息拂过耳廓，苏软软攥紧浴桶边，萧煜唇滑向脸颊，萧煜台词：“可知本宫想的什\n么？”，苏软软台词：“殿下勤政？”；10-13s（特写·对视+中景）：萧煜翻转她抵在浴桶壁上，鼻尖相抵，呼吸交\n缠，苏软软手抵他胸口又缩回，萧煜按住她的手贴心口，萧煜台词：“想的是你，想这浴桶够不够两人用。”；\n13-15s（慢镜定格）：萧煜俯身吻下，苏软软睁眼见他眼底光影，苏软软攥住他湿发，萧煜睫毛水珠颤落，苏软\n软内心OS：“他……他什么时候发现的？”",
        "styleTokens": [
            "古风甜宠",
            "女扮男装",
            "浴池氤氲",
            "耳语撩拨",
            "逆光电影感",
            "Seedance2.0",
            "多镜头连续运镜"
        ],
        "tags": [
            "商业广告",
            "TVC故事板",
            "古风短剧",
            "甜宠情缘",
            "Seedance2.0",
            "情感特写"
        ],
        "gradient": "linear-gradient(135deg, #701a75 0%, #86198f 50%, #a21caf 100%)",
        "accentColor": "#d946ef",
        "icon": "Film",
        "previewImage": "/videos/inspirations/sb-video-case-10.mp4",
        "previewThumbnail": "/images/inspirations/thumbs/vid-storyboard-case-10.webp",
        "previewVideo": "/videos/inspirations/sb-video-case-10.mp4",
        "hasImage": true,
        "isPureText": false,
        "source": "Seedance 2.0 官方与专家分镜模版",
        "linkedPresetId": "sb-case-10",
        "recommendedParams": {
            "duration": 15,
            "aspectRatio": "16:9",
            "model": "Seedance 2.0"
        }
    },
    {
    "id": "seedance-template-narrative",
    "title": "模板一：叙事故事类 · 电影级起承转合",
    "kind": "video",
    "category": "剧情叙事与短剧分镜",
    "crossCategories": [
        "电影级运镜与基础机位"
    ],
    "description": "标准电影级叙事结构，0-15秒完整起承转合时间轴，支持首尾帧与运镜参考。",
    "positivePrompt": "【风格】电影级写实/动画/水墨/科幻风格\n【时长】15秒\n【画幅】16:9 / 9:16 / 2.35:1电影宽屏\n\n0-3秒：[镜头运动]，[场景建立]，[主体引入]\n3-7秒：[镜头运动]，[情节发展]，[动作描述]\n7-11秒：[镜头运动]，[高潮/冲突]，[情绪爆发]\n11-13秒：[镜头运动]，[转折/过渡]\n13-15秒：[镜头运动]，[结尾/落版]\n\n【声音】配乐风格 + 音效 + 对白\n【参考】@图片1 作为首帧，@视频1 参考运镜",
    "styleTokens": [
        "电影级写实",
        "多镜头叙事",
        "时间轴对齐"
    ],
    "tags": [
        "Seedance2.0",
        "叙事故事",
        "起承转合",
        "多模态参考",
        "短剧分镜"
    ],
    "gradient": "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)",
    "accentColor": "#6366f1",
    "icon": "Film",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-product",
    "title": "模板二：产品展示类 · 商业广告级质感",
    "kind": "video",
    "category": "电影级运镜与基础机位",
    "crossCategories": [
        "剧情叙事与短剧分镜"
    ],
    "description": "商业广告产品展示分镜，包含环绕运镜、细节特写、使用场景与品牌落版。",
    "positivePrompt": "【风格】商业广告/极简/高端/科技感\n【时长】10-15秒\n\n0-2秒：开场抓眼球，产品特写或悬念设置\n2-5秒：产品全景展示，运镜环绕/推拉\n5-8秒：产品细节特写，材质/工艺展示\n8-12秒：使用场景，产品在实际环境中的应用\n12-15秒：品牌落版，slogan展示\n\n【声音】大气恢宏/轻快时尚/科技感配乐\n【参考】@图片1 产品外观，@图片2 材质参考",
    "styleTokens": [
        "商业广告",
        "极简科技",
        "环绕推拉"
    ],
    "tags": [
        "Seedance2.0",
        "产品展示",
        "商业TVC",
        "环绕运镜",
        "品牌落版"
    ],
    "gradient": "linear-gradient(135deg, #0c4a6e 0%, #0369a1 50%, #0284c7 100%)",
    "accentColor": "#0ea5e9",
    "icon": "Package",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-action",
    "title": "模板三：角色动作类 · 动态特技与连招",
    "kind": "video",
    "category": "角色动作与武打格斗",
    "crossCategories": [
        "电影级运镜与基础机位"
    ],
    "description": "角色动作亮相、准备姿态、核心连招至定格落版的标准动作分镜模版。",
    "positivePrompt": "【风格】根据角色设定（武侠/科幻/现代/奇幻）\n【时长】15秒\n\n0-3秒：角色亮相，定格或缓慢展示造型\n3-6秒：动作起始，准备姿势\n6-11秒：核心动作展示（打斗/舞蹈/特技）\n11-13秒：动作收尾，pose定格\n13-15秒：特效/氛围强化，画面落版\n\n【声音】动作音效 + 氛围配乐\n【参考】@图片1 角色形象，@视频1 动作参考",
    "styleTokens": [
        "角色动作",
        "连招打击",
        "动态定格"
    ],
    "tags": [
        "Seedance2.0",
        "角色动作",
        "武打格斗",
        "动作连招",
        "定格Pose"
    ],
    "gradient": "linear-gradient(135deg, #7c2d12 0%, #9a3412 50%, #c2410c 100%)",
    "accentColor": "#f97316",
    "icon": "Zap",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-travel",
    "title": "模板四：风景旅拍类 · 大景别与自然光影",
    "kind": "video",
    "category": "环境动力学与升格慢动作",
    "crossCategories": [
        "电影级运镜与基础机位"
    ],
    "description": "纪录片式风景旅拍时间轴，大景别建立、中景推进、多角度切换至意境落版。",
    "positivePrompt": "【风格】电影级纪录片/治愈系/史诗感\n【时长】15秒\n\n0-3秒：大景别建立镜头，展示环境全貌\n3-6秒：中景推进，引入人物或细节\n6-10秒：多角度切换，展示环境不同面貌\n10-13秒：特写细节，光影变化\n13-15秒：回到大景别或意境落版\n\n【声音】环境音 + 氛围配乐\n【参考】@图片1-5 场景参考",
    "styleTokens": [
        "电影级纪录片",
        "治愈光影",
        "大景别建立"
    ],
    "tags": [
        "Seedance2.0",
        "风景旅拍",
        "自然风光",
        "电影纪录片",
        "光影律动"
    ],
    "gradient": "linear-gradient(135deg, #064e3b 0%, #047857 50%, #059669 100%)",
    "accentColor": "#10b981",
    "icon": "Compass",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-extension",
    "title": "模板五：视频延长/续拍 · 镜头无缝延展",
    "kind": "video",
    "category": "电影级运镜与基础机位",
    "crossCategories": [
        "剧情叙事与短剧分镜"
    ],
    "description": "基于现有视频延长指定时长，保持角色、环境与镜头运镜高度连贯流畅。",
    "positivePrompt": "将@视频1延长X秒（生成长度选择X秒）\n\n延续前视频的风格和主体：\n0-X秒：[新内容描述]，与前视频无缝衔接\n[继续描述新增内容的时间轴]\n\n【要求】保持角色一致性，动作连贯流畅",
    "styleTokens": [
        "无缝延展",
        "主体连贯",
        "运镜顺畅"
    ],
    "tags": [
        "Seedance2.0",
        "视频延长",
        "无缝续拍",
        "一致性保持",
        "时间轴追加"
    ],
    "gradient": "linear-gradient(135deg, #3b0764 0%, #581c87 50%, #7e22ce 100%)",
    "accentColor": "#a855f7",
    "icon": "ChevronsRight",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 10,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-edit",
    "title": "模板六：视频编辑/改剧情 · 精准反转重构",
    "kind": "video",
    "category": "剧情叙事与短剧分镜",
    "crossCategories": [
        "演员神态与情绪调度"
    ],
    "description": "基于原视频指定修改运镜、动作、台词或触发戏剧性剧情反转。",
    "positivePrompt": "基于@视频1进行编辑：\n\n【保留】原视频的运镜/部分动作/场景\n【修改】[具体修改点1]\n【修改】[具体修改点2]\n【颠覆】[剧情反转描述]\n\n【要求】保持镜头连贯，只在指定位置修改",
    "styleTokens": [
        "精准编辑",
        "剧情反转",
        "保留运镜"
    ],
    "tags": [
        "Seedance2.0",
        "视频编辑",
        "剧情反转",
        "局部修改",
        "戏剧冲突"
    ],
    "gradient": "linear-gradient(135deg, #831843 0%, #9d174d 50%, #be185d 100%)",
    "accentColor": "#ec4899",
    "icon": "Edit3",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-conflict",
    "title": "模板七：情感冲突类 · 双人对峙与情绪爆发",
    "kind": "video",
    "category": "演员神态与情绪调度",
    "crossCategories": [
        "剧情叙事与短剧分镜"
    ],
    "description": "双人对立、冲突开场、真相揭示至情感爆发的高戏剧张力分镜模版。",
    "positivePrompt": "【风格】快剪节奏/情绪爆发/唯美虐心\n【时长】15秒\n【画幅】9:16 / 16:9\n\n【角色】[角色1设定] VS [角色2设定]\n\n0-3秒：[镜头运动]，[冲突开场]，[角色互动]\n【对白】[对白内容]\n\n3-7秒：[镜头运动]，[真相揭示]，[关键道具展示]\n【对白】[对白内容]\n\n7-12秒：[镜头运动]，[情感爆发]，[角色反应]\n【对白】[对白内容]\n\n12-15秒：[镜头运动]，[定格/落版]，[情感延续]\n\n【声音】环境音 + 氛围配乐 + 情感高潮音乐\n【参考】@图片1 角色1形象，@图片2 角色2形象",
    "styleTokens": [
        "快剪节奏",
        "情绪爆发",
        "对白调度"
    ],
    "tags": [
        "Seedance2.0",
        "情感冲突",
        "双人对峙",
        "情绪爆发",
        "台词对白"
    ],
    "gradient": "linear-gradient(135deg, #7f1d1d 0%, #991b1b 50%, #b91c1c 100%)",
    "accentColor": "#ef4444",
    "icon": "Flame",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-ui-motion",
    "title": "模板八：产品动效展示类 · UI与3D动效",
    "kind": "video",
    "category": "电影级运镜与基础机位",
    "crossCategories": [
        "其他视频与综合待分类"
    ],
    "description": "UI界面与产品三维动效展示，支持单图或多图连贯转场与细节推拉。",
    "positivePrompt": "【风格】亚克力玻璃质感/快闪风格/科技感\n【时长】15秒\n【画幅】16:9 / 9:16\n\n**单张图片版本：**\n基于@图片1生成产品动效展示视频，用丝滑的动效设计和不同角度的运镜展示UI细节，最后无缝过渡到产品名称\n\n**多张图片版本：**\n将@图片N...@图片1这几个UI展示图，变成多分镜多角度的应用宣传片，并搭配合适的口播介绍，为其增加丰富的转场效果和细节展示，每个分镜的转换需要连贯顺畅\n\n产品介绍为：[产品名称]是一款[产品类型]，让[核心价值]。提供了[功能1]、[功能2]、[功能3]等。\n\n宣传视频制作思路为：[设计理念描述]\n\n【参考】@图片1-N UI界面截图",
    "styleTokens": [
        "亚克力质感",
        "丝滑动效",
        "UI展示"
    ],
    "tags": [
        "Seedance2.0",
        "UI动效",
        "产品动效",
        "亚克力质感",
        "转场动效"
    ],
    "gradient": "linear-gradient(135deg, #14532d 0%, #15803d 50%, #16a34a 100%)",
    "accentColor": "#22c55e",
    "icon": "Layers",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-spatial-tour",
    "title": "模板九：空间漫游类 · 沉浸式动线探访",
    "kind": "video",
    "category": "电影级运镜与基础机位",
    "crossCategories": [
        "环境动力学与升格慢动作"
    ],
    "description": "依托设计稿与平面图动线，生成第一人称视角沉浸式空间参观与光影流转。",
    "positivePrompt": "【风格】沉浸式参观体验/空间展示\n【时长】15秒\n【画幅】16:9 / 9:16\n\n基于@图片2设计稿分镜和@图片1平面图，生成一段沉浸式的空间参观视频，严格按照@图片2的分镜顺序生成视频，模拟真实参观的行走路线，可以切镜头，注意自然光线变化和材质质感\n\n**分镜顺序参考：**\n[空间1] → [空间2] → [空间3] → [空间4] → [空间5] → [空间6] → [空间7]\n\n【声音】氛围配乐 + 环境音 + 转场音效\n【参考】@图片1 平面图，@图片2 分镜图\n\n**分镜图生成提示（给图像模型）：**\n基于当前的平面图，为我设计一套分镜的参观视频分镜图。分镜图需要严格遵循以下顺序，所有的照片都从[入口位置]进入，依托于这个坐标点拍摄。从[入口位置]看向[空间1]，看向[空间2]，再到[空间3]，最后到[空间4]和[空间5]。它的空间关系要跟这个平面图对应，风格得是[指定风格]。",
    "styleTokens": [
        "沉浸式漫游",
        "空间动线",
        "自然光影"
    ],
    "tags": [
        "Seedance2.0",
        "空间漫游",
        "建筑室内",
        "沉浸行走",
        "光影流转"
    ],
    "gradient": "linear-gradient(135deg, #134e4a 0%, #0f766e 50%, #0d9488 100%)",
    "accentColor": "#14b8a6",
    "icon": "Move",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-battle",
    "title": "模板十：角色对战类 · 动作对决与分镜对抗",
    "kind": "video",
    "category": "角色动作与武打格斗",
    "crossCategories": [
        "电影级运镜与基础机位"
    ],
    "description": "双角色打斗对战分镜，支持引用视频运镜与动作节奏，避免版权侵权规范。",
    "positivePrompt": "【风格】写实/动画/电影质感\n【时长】5-15秒\n【画幅】16:9 / 9:16\n\n**基础版本：**\n角色1与角色2在[场景]中进行对战\n\n**详细版本：**\n一场[角色1]和[角色2]之间的战斗。他们在[场景]打斗。使用[视频1]中的动作。使用[视频1]中的镜头运动。\n\n**注意：**使用\"Figure 1\"、\"Figure 2\"替代角色名称，避免版权问题被拒绝生成。\n\n【参考】@图片1 角色1，@图片2 角色2，@视频1 动作参考",
    "styleTokens": [
        "写实对战",
        "动作参考",
        "镜头碰撞"
    ],
    "tags": [
        "Seedance2.0",
        "角色对战",
        "武术格斗",
        "动作参考",
        "竞技对决"
    ],
    "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #92400e 100%)",
    "accentColor": "#d97706",
    "icon": "Swords",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-talking-head",
    "title": "模板十一：口播类 · 对口型与自然神态",
    "kind": "video",
    "category": "演员神态与情绪调度",
    "crossCategories": [
        "剧情叙事与短剧分镜"
    ],
    "description": "基于单张人物图结合音频生成自然对口型播客口播，支持情绪与字幕驱动。",
    "positivePrompt": "【风格】专业播客/自然对话风格\n【时长】15秒（可延长）\n【画幅】16:9 / 9:16\n\n使用@图片1的人物和环境，然后使用@音频1作为人物的声音内容，生成一个口播视频，需要加上字幕，适当的给@音频1一些情感表现让他更真实和激动。\n\n【功能】\n- 自动生成对口型的说话画面\n- 支持情感调整（激动/平静/悲伤等）\n- 支持延长生成长视频\n- 保持人物和声音跨镜头一致性\n\n【声音】@音频1 作为声音源\n【参考】@图片1 人物形象照，@音频1 语音内容",
    "styleTokens": [
        "专业播客",
        "唇形自然",
        "情感对齐"
    ],
    "tags": [
        "Seedance2.0",
        "口播视频",
        "唇形对齐",
        "音频驱动",
        "自然神态"
    ],
    "gradient": "linear-gradient(135deg, #172554 0%, #1e3a8a 50%, #1d4ed8 100%)",
    "accentColor": "#3b82f6",
    "icon": "Mic",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-music-beat",
    "title": "模板十二：音乐卡点类 · 节拍转场与节奏剪辑",
    "kind": "video",
    "category": "环境动力学与升格慢动作",
    "crossCategories": [
        "电影级运镜与基础机位"
    ],
    "description": "根据音频波形与节拍点依次切换图片素材，丝滑自然卡点与动感转场。",
    "positivePrompt": "【风格】卡点剪辑/转场特效\n【时长】根据音频长度\n【画幅】根据平台选择\n\n将图片@图N...@图1依次按顺序，卡入@音频1的卡点中\n\n【要求】画面切换与音乐节奏同步，转场自然流畅\n\n【参考】@图片1-N 照片素材，@音频1 背景音乐",
    "styleTokens": [
        "卡点剪辑",
        "节拍同步",
        "动感转场"
    ],
    "tags": [
        "Seedance2.0",
        "音乐卡点",
        "节奏剪辑",
        "节拍同步",
        "转场特效"
    ],
    "gradient": "linear-gradient(135deg, #500724 0%, #831843 50%, #9d174d 100%)",
    "accentColor": "#f43f5e",
    "icon": "Music",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-warfare",
    "title": "模板十四：战争场景类 · 史诗交火与手持运镜",
    "kind": "video",
    "category": "剧情叙事与短剧分镜",
    "crossCategories": [
        "电影级运镜与基础机位"
    ],
    "description": "手持镜头沉浸纪实感，低角度推进、冲突交火、推进至高点全景的战争大片分镜。",
    "positivePrompt": "【风格】电影级写实，手持镜头质感，紧张压抑氛围\n【时长】15秒\n【画幅】2.35:1 电影宽屏\n\n0-4秒：[主体]缓慢进入[场景]，低角度视角推进，环境细节展示，营造压抑氛围\n\n4-8秒：[冲突爆发]，[交火场景]，镜头快速移动，捕捉[关键动作]\n\n8-12秒：[推进过程]，进入[新场景]，光线变化，[角色互动]\n\n12-15秒：[占据高点]，俯瞰[全景]，镜头拉远，[结尾氛围]\n\n【声音】环境音 + 紧张氛围配乐\n【参考】@图片1-2 场景参考",
    "styleTokens": [
        "手持纪实",
        "紧张压抑",
        "电影宽屏"
    ],
    "tags": [
        "Seedance2.0",
        "战争场景",
        "手持镜头",
        "史诗大片",
        "交火场景"
    ],
    "gradient": "linear-gradient(135deg, #18181b 0%, #27272a 50%, #3f3f46 100%)",
    "accentColor": "#71717a",
    "icon": "Crosshair",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "2.35:1",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-tracking-shot",
    "title": "模板十五：长镜头追踪类 · 动态模糊与极速跟拍",
    "kind": "video",
    "category": "电影级运镜与基础机位",
    "crossCategories": [
        "环境动力学与升格慢动作"
    ],
    "description": "高速运动物体追踪长镜头，动态模糊、镜头加速紧随轨迹至最终定格命中。",
    "positivePrompt": "【风格】电影级写实，动态模糊，高速镜头追踪\n【时长】15秒\n【画幅】2.35:1\n\n0-2秒：[场景建立]，[主体准备]，[特写细节]\n\n2-3秒：[动作起始]，[特写关键部位]\n\n3-5秒：[动作释放]，[画面震动]\n\n5-12秒：[镜头加速]，锁定在[飞行物体]上，镜头紧随其后，记录[飞行轨迹]，背景[动态模糊]，[环境细节]\n\n12-15秒：[目标命中]，[特写结果]，画面定格，渐隐\n\n【声音】[释放声] + [飞行音效] + [命中音效]\n【参考】@图片1 人物形象，@图片2 场景",
    "styleTokens": [
        "极速追踪",
        "动态模糊",
        "一镜到底"
    ],
    "tags": [
        "Seedance2.0",
        "长镜头",
        "高速追踪",
        "动态模糊",
        "运动轨迹"
    ],
    "gradient": "linear-gradient(135deg, #022c22 0%, #064e3b 50%, #065f46 100%)",
    "accentColor": "#059669",
    "icon": "FastForward",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "2.35:1",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-template-mockumentary",
    "title": "模板十六：伪纪录片类 · Vlog实拍与反转高能",
    "kind": "video",
    "category": "剧情叙事与短剧分镜",
    "crossCategories": [
        "演员神态与情绪调度"
    ],
    "description": "伪纪录片与Vlog实拍质感，日常铺垫、异常高能爆点至戏剧性反转落版。",
    "positivePrompt": "【风格】伪纪录片（Vlog Style），超写实主义，固定机位实拍感，自然光，带有一点点悬疑喜剧色彩\n【时长】15秒\n【画幅】9:16 竖屏\n【主角】[主角设定]\n\n0-6秒（日常铺垫）：场景：[场景描述]。动作：[日常动作]。关键细节：[正常状态描述]\n\n6-11秒（异常出现）：动作：[动作转变]。高能时刻（核心爆点）：[异常现象描述]，[异常行为细节]。导演备注：[特殊效果要求]\n\n11-15秒（结尾反转）：动作：[主角反应]。结果：[最终状态]。画面在[结尾画面]中定格（喜剧效果）\n\n【声音】日常环境音 + 突变音效（异常出现时）\n【参考】@图片1 主角形象\n```\n\n---",
    "styleTokens": [
        "伪纪录片",
        "固定机位实拍",
        "悬疑喜剧"
    ],
    "tags": [
        "Seedance2.0",
        "伪纪录片",
        "Vlog实拍",
        "剧情反转",
        "高能反转"
    ],
    "gradient": "linear-gradient(135deg, #365314 0%, #4d7c0f 50%, #65a30d 100%)",
    "accentColor": "#84cc16",
    "icon": "Video",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "9:16",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-example-emotion",
    "title": "示例一：情感叙事类 · 温馨归家与情绪治愈",
    "kind": "video",
    "category": "剧情叙事与短剧分镜",
    "crossCategories": [
        "演员神态与情绪调度"
    ],
    "description": "疲惫归家、开门相拥的温情电影级分镜，微表情与室内暖光细腻调度。",
    "positivePrompt": "电影级写实风格，15秒，2.35:1电影宽屏，温馨家庭氛围\n\n0-3秒：中景跟随镜头，男人疲惫地走在走廊，脚步逐渐变缓，最后停在家门口\n3-5秒：脸部特写，男人深呼吸，调整情绪，收起负面情绪，表情变得轻松\n5-7秒：特写手部动作，翻找出钥匙，插入门锁，门打开\n7-12秒：室内中景，小女儿和宠物狗欢快地跑过来迎接，男人蹲下拥抱他们\n12-15秒：近景，男人脸上洋溢着幸福的笑容，室内暖光营造温馨氛围\n\n【声音】轻缓的钢琴配乐，环境音效（脚步声、开门声、孩子的笑声）\n【参考】@图片1 男人形象，@图片2 女儿形象，@图片3 宠物狗形象",
    "styleTokens": [
        "电影级写实",
        "温馨氛围",
        "微表情特写"
    ],
    "tags": [
        "Seedance2.0",
        "情感叙事",
        "家庭温馨",
        "情绪微调",
        "电影质感"
    ],
    "gradient": "linear-gradient(135deg, #451a03 0%, #78350f 50%, #b45309 100%)",
    "accentColor": "#f59e0b",
    "icon": "Heart",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "2.35:1",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-example-wuxia",
    "title": "示例二：动作打斗类 · 水墨武侠枫叶对决",
    "kind": "video",
    "category": "角色动作与武打格斗",
    "crossCategories": [
        "电影级运镜与基础机位"
    ],
    "description": "中国水墨武侠风格，长枪突刺与双刀格挡，气浪卷起红枫的东方动作经典。",
    "positivePrompt": "中国水墨武侠风格，15秒，16:9，枫叶飘落的秋季场景\n\n0-2秒：远景，两位侠客对峙，一人持长枪（参考@图1@图2），一人持双刀（参考@图3@图4）\n2-4秒：快速推近，两人眼神交锋，杀气弥漫\n4-9秒：中景快速剪辑，长枪突刺，双刀格挡，武器碰撞火花四溅，模仿@视频1的动作节奏\n9-12秒：环绕镜头，展示激烈打斗，枫叶被气浪卷起飞舞\n12-15秒：定格pose，两人武器相交，画面渐隐\n\n【声音】金属碰撞音效 + 古风激昂配乐\n【参考】@图1-4 角色造型，@图5 枫叶林场景，@视频1 动作参考",
    "styleTokens": [
        "水墨写意",
        "快节奏剪辑",
        "火花碰撞"
    ],
    "tags": [
        "Seedance2.0",
        "水墨武侠",
        "动作打斗",
        "红枫场景",
        "国风意境"
    ],
    "gradient": "linear-gradient(135deg, #881337 0%, #9f1239 50%, #be123c 100%)",
    "accentColor": "#e11d48",
    "icon": "Shield",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-example-coffee-ad",
    "title": "示例三：产品广告类 · 晨光咖啡微距商业TVC",
    "kind": "video",
    "category": "电影级运镜与基础机位",
    "crossCategories": [
        "剧情叙事与短剧分镜"
    ],
    "description": "高端商业广告质感，咖啡液注入微距特写、晨光窗边推镜与品牌文字渐显。",
    "positivePrompt": "高端商业广告风格，15秒，16:9，暖色调晨光氛围\n\n0-3秒：微距特写，咖啡液缓缓注入杯中，油脂丰富，蒸汽升腾\n3-6秒：中景环绕，手握咖啡杯，阳光透过窗户洒在桌面\n6-10秒：推镜头至咖啡豆，一粒咖啡豆从上方飘落，镜头跟随推进\n10-12秒：画面黑屏转场\n12-15秒：文字渐显，第一行\"Lucky Coffee\"，第二行\"Breakfast\"，第三行\"AM 7:00-10:00\"\n\n【声音】咖啡倒入声 + 轻松的爵士乐\n【参考】@图片1 咖啡杯，@图片2 品牌logo",
    "styleTokens": [
        "高端商业",
        "微距特写",
        "自然晨光"
    ],
    "tags": [
        "Seedance2.0",
        "商业广告",
        "咖啡TVC",
        "微距特写",
        "暖色调晨光"
    ],
    "gradient": "linear-gradient(135deg, #3f2e18 0%, #5b3e1f 50%, #785226 100%)",
    "accentColor": "#d97706",
    "icon": "Coffee",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-example-sunflower-skate",
    "title": "示例四：视频延长类 · 向日葵滑板治愈漫游",
    "kind": "video",
    "category": "电影级运镜与基础机位",
    "crossCategories": [
        "环境动力学与升格慢动作"
    ],
    "description": "向日葵花摊与红色滑板少年街头漫游，治愈温暖光线与动作平滑延展。",
    "positivePrompt": "将@视频1延长10秒（生成长度选择10秒）\n\n延续前视频向日葵滑板的治愈风格：\n0-3秒：温暖的午后光线，镜头从街角遮阳篷慢慢下移到墙根小雏菊\n3-6秒：主人公的红色板鞋入镜，他蹲在街边花摊前，笑着把向日葵拢进怀里\n6-8秒：花瓣蹭过白T恤，他转身踏上滑板，花摊老板笑着喊话\n8-10秒：他冲老板挥手，开始滑行，金黄花瓣落在滑板板面\n\n【要求】与前视频保持色调一致，动作连贯流畅\n【参考】@视频1 原视频",
    "styleTokens": [
        "治愈风",
        "午后暖光",
        "平滑延展"
    ],
    "tags": [
        "Seedance2.0",
        "视频延长",
        "治愈午后",
        "街头滑板",
        "连续运镜"
    ],
    "gradient": "linear-gradient(135deg, #713f12 0%, #854d0e 50%, #a16207 100%)",
    "accentColor": "#eab308",
    "icon": "Sun",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 10,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
},
    {
    "id": "seedance-example-plot-twist",
    "title": "示例五：剧情颠覆类 · 古风桥头反转决裂",
    "kind": "video",
    "category": "剧情叙事与短剧分镜",
    "crossCategories": [
        "演员神态与情绪调度"
    ],
    "description": "古装桥头站位与运镜保留，眼神从温柔骤变狠厉，跌宕起伏的反转高光。",
    "positivePrompt": "基于@视频1进行剧情颠覆：\n\n【保留】原视频的古装场景、桥上站位、运镜方式\n【修改】0-3秒：男人眼神从温柔瞬间转为冰冷狠厉\n【颠覆】3-5秒：在女主毫无防备时，猛地将她推进水里，动作干脆利落，蓄谋已久的决绝\n【新增】5-8秒：女主坠入水中，难以置信的眼神，抬头嘶吼\"你从一开始就在骗我！\"\n【新增】8-12秒：男主站在桥上，阴冷笑容，对水面低声说\"这是你欠我家族的\"\n【新增】12-15秒：水面涟漪，画面渐暗\n\n【要求】保持镜头连贯，只在指定位置修改动作和表情\n【参考】@视频1 原视频素材\n```\n\n---",
    "styleTokens": [
        "古装戏曲",
        "戏剧反转",
        "眼神突变"
    ],
    "tags": [
        "Seedance2.0",
        "剧情颠覆",
        "古装短剧",
        "戏剧反转",
        "高燃冲突"
    ],
    "gradient": "linear-gradient(135deg, #31135e 0%, #4c1d95 50%, #5b21b6 100%)",
    "accentColor": "#8b5cf6",
    "icon": "AlertCircle",
    "previewImage": "",
    "previewThumbnail": "",
    "hasImage": false,
    "isPureText": true,
    "source": "Seedance 2.0 官方与专家分镜模版",
    "recommendedParams": {
        "duration": 15,
        "aspectRatio": "16:9",
        "model": "Seedance 2.0"
    }
}
];

// —— 用户自定义提示词存储管理（用户隔离与旧版本平滑迁移） ——
const CUSTOM_PROMPTS_STORAGE_KEY = "canvas_custom_prompt_presets_v2";
const PRESET_OVERRIDES_KEY = "canvas_prompt_preset_overrides_v2";
const DELETED_PRESETS_KEY = "canvas_prompt_presets_deleted_v2";

function getScopedOrLegacyItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    const scopedVal = scopedLocalStorage.getItem(key);
    if (scopedVal !== null) return scopedVal;
    const legacyVal = window.localStorage.getItem(key);
    if (legacyVal !== null) {
        scopedLocalStorage.setItem(key, legacyVal);
        return legacyVal;
    }
    return null;
}

export function loadCustomPrompts(): PromptPresetItem[] {
    try {
        const raw = getScopedOrLegacyItem(CUSTOM_PROMPTS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function saveCustomPrompt(item: Omit<PromptPresetItem, "id" | "isCustom" | "createdAt"> & { id?: string }): PromptPresetItem {
    const list = loadCustomPrompts();
    const now = Date.now();
    const newItem: PromptPresetItem = {
        ...item,
        id: item.id || `custom-${now}-${Math.random().toString(36).slice(2, 6)}`,
        isCustom: true,
        createdAt: now,
    };
    const idx = list.findIndex((p) => p.id === newItem.id);
    if (idx >= 0) {
        list[idx] = newItem;
    } else {
        list.unshift(newItem);
    }
    scopedLocalStorage.setItem(CUSTOM_PROMPTS_STORAGE_KEY, JSON.stringify(list));
    return newItem;
}

export function deleteCustomPrompt(id: string): void {
    const list = loadCustomPrompts().filter((p) => p.id !== id);
    scopedLocalStorage.setItem(CUSTOM_PROMPTS_STORAGE_KEY, JSON.stringify(list));
}

// —— 预设提示词的软删除与覆盖逻辑 ——
export function loadDeletedPresetIds(): Set<string> {
    try {
        const raw = getScopedOrLegacyItem(DELETED_PRESETS_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
        return new Set();
    }
}

export function markPresetDeleted(id: string): void {
    const set = loadDeletedPresetIds();
    set.add(id);
    scopedLocalStorage.setItem(DELETED_PRESETS_KEY, JSON.stringify(Array.from(set)));
}

export function resetPresetDeleted(id: string): void {
    const set = loadDeletedPresetIds();
    set.delete(id);
    scopedLocalStorage.setItem(DELETED_PRESETS_KEY, JSON.stringify(Array.from(set)));
}

export function deleteInspirationPreset(preset: PromptPresetItem): void {
    if (preset.isCustom) {
        deleteCustomPrompt(preset.id);
    } else {
        markPresetDeleted(preset.id);
    }
}

export function loadPresetOverrides(): Record<string, Partial<PromptPresetItem>> {
    try {
        const raw = getScopedOrLegacyItem(PRESET_OVERRIDES_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function isPresetOverridden(id: string): boolean {
    const overrides = loadPresetOverrides();
    return Boolean(overrides[id]);
}

export function savePresetOverride(id: string, updates: Partial<PromptPresetItem>): void {
    const overrides = loadPresetOverrides();
    overrides[id] = { ...overrides[id], ...updates };
    scopedLocalStorage.setItem(PRESET_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function resetPresetOverride(id: string): void {
    const overrides = loadPresetOverrides();
    delete overrides[id];
    scopedLocalStorage.setItem(PRESET_OVERRIDES_KEY, JSON.stringify(overrides));
    resetPresetDeleted(id);
}

let cachedFullImagePresets: PromptPresetItem[] | null = null;
let cachedFullVideoPresets: PromptPresetItem[] | null = null;
let cachedTop500VideoPresets: PromptPresetItem[] | null = null;

export async function fetchAllImagePresets(): Promise<PromptPresetItem[]> {
    if (cachedFullImagePresets && cachedFullImagePresets.length > 0) {
        return mergeWithOverrides(cachedFullImagePresets);
    }
    try {
        const resp = await fetch("/data/image-presets.json");
        if (resp.ok) {
            const data: PromptPresetItem[] = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
                cachedFullImagePresets = data;
                return mergeWithOverrides(data);
            }
        }
    } catch (e) {
        console.warn("Failed to load /data/image-presets.json:", e);
    }
    return getImagePresets();
}

export async function fetchTop500VideoPresets(): Promise<PromptPresetItem[]> {
    if (cachedTop500VideoPresets && cachedTop500VideoPresets.length > 0) {
        return mergeWithOverrides(cachedTop500VideoPresets);
    }
    try {
        const resp = await fetch("/data/video-presets-500.json");
        if (resp.ok) {
            const data: PromptPresetItem[] = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
                cachedTop500VideoPresets = data;
                return mergeWithOverrides(data);
            }
        }
    } catch (e) {
        console.warn("Failed to load /data/video-presets-500.json:", e);
    }
    const all = await fetchAllVideoPresets();
    return all.slice(0, 500);
}

export async function fetchAllVideoPresets(): Promise<PromptPresetItem[]> {
    if (cachedFullVideoPresets && cachedFullVideoPresets.length > 0) {
        return mergeWithOverrides(cachedFullVideoPresets);
    }
    try {
        const resp = await fetch("/data/video-presets.json");
        if (resp.ok) {
            const data: PromptPresetItem[] = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
                cachedFullVideoPresets = data;
                return mergeWithOverrides(data);
            }
        }
    } catch (e) {
        console.warn("Failed to load /data/video-presets.json:", e);
    }
    return getVideoPresets();
}

/**
 * 智能灵感图片加速分发解析器
 * 1. 本地图片 (/images/...) -> 直接返回，0网络开销
 * 2. raw.githubusercontent.com -> 优先走 cdn.jsdelivr.net 高速镜像 + wsrv.nl 动态 WebP 切片 (20KB 轻量化)
 * 3. pbs.twimg.com (推特受限域名) -> 自动走全球边缘 WebP CDN (wsrv.nl)
 * 4. github.com/user-attachments / camo -> 自动走全球边缘 WebP CDN
 */
export function resolveInspirationImageUrl(url: string | undefined, isThumbnail = false): string {
    if (!url || typeof url !== "string") return "";
    if (url.startsWith("/")) return url;

    // 1. 如果已经是 wsrv.nl 的链接，根据 isThumbnail 适配最佳尺寸
    if (url.includes("wsrv.nl/?url=")) {
        const targetWidth = isThumbnail ? 480 : 1280;
        if (url.includes("&w=")) {
            return url.replace(/&w=\d+/, `&w=${targetWidth}`);
        }
        return `${url}&w=${targetWidth}`;
    }

    // 2. raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main/
    if (url.includes("raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main/")) {
        const path = url.split("raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main/")[1];
        const targetWidth = isThumbnail ? 480 : 1280;
        return `https://wsrv.nl/?url=cdn.jsdelivr.net/gh/ZeroLu/awesome-gpt-image@main/${path}&w=${targetWidth}&output=webp&q=85`;
    }

    if (url.includes("raw.githubusercontent.com/")) {
        const path = url.replace("https://raw.githubusercontent.com/", "");
        const parts = path.split("/");
        if (parts.length >= 3) {
            const [owner, repo, branch, ...rest] = parts;
            const jsdelivrPath = `cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${rest.join("/")}`;
            const targetWidth = isThumbnail ? 480 : 1280;
            return `https://wsrv.nl/?url=${jsdelivrPath}&w=${targetWidth}&output=webp&q=85`;
        }
    }

    // 3. Twitter images (pbs.twimg.com) -> 优先走全球边缘 WebP CDN (wsrv.nl，15KB 轻量化，全球 CDN 节点与 HTTP/2 多路复用)
    if (url.includes("pbs.twimg.com/")) {
        const clean = url.replace(/^https?:\/\//, "");
        const targetWidth = isThumbnail ? 480 : 1280;
        return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=${targetWidth}&output=webp&q=80`;
    }

    // 4. GitHub attachments or camo
    if (url.includes("github.com/user-attachments/assets/") || url.includes("camo.githubusercontent.com/")) {
        const clean = url.replace(/^https?:\/\//, "");
        return `https://wsrv.nl/?url=${clean}&w=${isThumbnail ? 480 : 1280}&output=webp&q=85`;
    }

    // 5. Remote image (http/https) -> Global edge WebP proxy (wsrv.nl)
    if (url.startsWith("http://") || url.startsWith("https://")) {
        const clean = url.replace(/^https?:\/\//, "");
        const targetWidth = isThumbnail ? 480 : 1280;
        return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=${targetWidth}&output=webp&q=85`;
    }

    return url;
}

function mergeWithOverrides(presets: PromptPresetItem[]): PromptPresetItem[] {
    const overrides = loadPresetOverrides();
    const deletedIds = loadDeletedPresetIds();
    return presets
        .filter((preset) => !deletedIds.has(preset.id))
        .map((preset) => {
            const override = overrides[preset.id];
            const p = override ? { ...preset, ...override, isOverridden: true } : preset;
            return {
                ...p,
                previewThumbnail: resolveInspirationImageUrl(p.previewThumbnail || p.previewImage, true),
                previewImage: resolveInspirationImageUrl(p.previewImage, false),
            };
        });
}

export const TOTAL_OFFICIAL_IMAGE_PRESETS_COUNT = 2902;
export const TOTAL_OFFICIAL_VIDEO_PRESETS_COUNT = 12204;

export function getImagePresets(): PromptPresetItem[] {
    return mergeWithOverrides(IMAGE_PROMPT_PRESETS);
}

export function getVideoPresets(): PromptPresetItem[] {
    return mergeWithOverrides(VIDEO_PROMPT_PRESETS);
}
