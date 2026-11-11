import type { DramaStyle, DramaStyleCategory } from "./drama-styles";

export type DramaStyleFormId = "2d" | "3d" | "realistic" | "semi-realistic";
export type DramaStyleThemeId = "urban" | "xuanhuan" | "apocalypse" | "palace" | "wuxia" | "campus" | "suspense" | "scifi" | "romance" | "rural" | "historical" | "fantasy" | "story";
export type DramaStyleComposition = { formId: DramaStyleFormId; themeId: DramaStyleThemeId };

type StyleForm = {
    id: DramaStyleFormId;
    name: string;
    description: string;
    category: DramaStyleCategory;
    medium: string;
    forbid: string;
};
type StyleTheme = {
    id: DramaStyleThemeId;
    name: string;
    description: string;
    world: string;
    look: string;
    wardrobe: string;
    palette: DramaStyle["palette"];
};

// 表现形式不携带题材；题材不指定渲染媒介。换一轴时重新组合，不能叠加旧预设的 prompt。
export const DRAMA_STYLE_FORMS: readonly StyleForm[] = [
    {
        id: "2d",
        name: "2D 动画",
        description: "清晰线稿、平面上色",
        category: "2d",
        medium: "高品质 2D 动画漫剧，线稿清晰流畅，赛璐璐上色干净，二维色块塑造光影，角色五官稳定",
        forbid: "真人照片质感、3D 渲染感、崩坏五官、文字水印",
    },
    {
        id: "3d",
        name: "3D 动画",
        description: "立体建模、材质光照",
        category: "3d",
        medium: "高品质 3D 动画渲染，立体建模精致，材质与光照物理可信，角色表情自然生动，全剧保持一致的模型比例",
        forbid: "真人照片质感、二维平涂、低模与穿模、文字水印",
    },
    {
        id: "realistic",
        name: "写实",
        description: "真人质感、自然细节",
        category: "live",
        medium: "真人影视写实质感，自然皮肤纹理与毛孔，可信的真实材质，电影级布光，人物表情自然生动",
        forbid: "动漫化、塑料皮肤、过度磨皮、畸形手指、文字水印",
    },
    {
        id: "semi-realistic",
        name: "半写实",
        description: "真实比例、绘画塑形",
        category: "art",
        medium: "半写实数字绘画，人物结构与物体比例可信，光影塑造体积，保留细腻绘画笔触与适度造型简化，全剧笔触统一",
        forbid: "真人照片质感、夸张卡通比例、纯平面色块、畸形手指、文字水印",
    },
];

export const DRAMA_STYLE_THEMES: readonly StyleTheme[] = [
    {
        id: "urban",
        name: "都市",
        description: "现代街区、职场与日常生活",
        world: "现代都市的街区、公寓、办公楼与公共空间，环境细节符合当代生活",
        look: "冷灰蓝与暖白为基调，自然日光与室内灯光层次清晰",
        wardrobe: "当代通勤装、休闲装与生活用品，服装随角色身份和剧情变化",
        palette: ["#0f172a", "#475569", "#e2e8f0"],
    },
    {
        id: "xuanhuan",
        name: "玄幻",
        description: "仙山宗门、秘境与法术",
        world: "玄幻世界的云海仙山、宗门殿宇、秘境古林与上古遗迹",
        look: "青蓝与暖金相映，雾气与法术光效层次分明，能量光效克制不过曝",
        wardrobe: "古风长袍、护甲、发冠与法器，纹样和材质统一",
        palette: ["#0c1e2e", "#2c6e8f", "#f0c674"],
    },
    {
        id: "apocalypse",
        name: "末日",
        description: "废墟城市、营地与生存装备",
        world: "末日后的破损城市、废弃设施、临时营地与物资仓库",
        look: "灰褐低饱和色调，尘埃、污渍与局部生存灯光形成层次",
        wardrobe: "实用的户外衣物、防护装备、背包与修补工具，磨损符合生存处境",
        palette: ["#2a2620", "#6b5d45", "#c2a36b"],
    },
    {
        id: "palace",
        name: "古装宫廷",
        description: "宫苑殿堂、礼制与华服",
        world: "古代宫苑、殿堂、庭院与长廊，建筑和陈设符合故事时代",
        look: "朱红、墨绿与暖金配色，烛火与天光层次庄重",
        wardrobe: "符合身份礼制的华服、发冠、首饰与宫廷器物",
        palette: ["#5b1a18", "#a3332b", "#d9a441"],
    },
    {
        id: "wuxia",
        name: "武侠",
        description: "江湖客栈、竹林与刀剑",
        world: "江湖中的客栈、竹林、渡口、山门与大漠古道",
        look: "土黄与墨绿配色，日光、月色与扬尘衬托江湖氛围",
        wardrobe: "劲装、长袍、斗笠、披风与刀剑兵器，材质和磨损符合人物经历",
        palette: ["#2b2116", "#8a6a3f", "#d9c4a0"],
    },
    {
        id: "campus",
        name: "校园",
        description: "教室操场、青春与成长",
        world: "校园教室、操场、图书馆、林荫道与周边街区",
        look: "青绿与浅黄配色，明亮通透的日光，生活氛围清新",
        wardrobe: "校服、运动装、休闲装与学习用品，符合角色年龄和学校设定",
        palette: ["#e0f2fe", "#86efac", "#fde68a"],
    },
    {
        id: "suspense",
        name: "悬疑",
        description: "雨夜街巷、调查与未知",
        world: "雨夜街巷、老旧楼道、调查现场与封闭室内空间",
        look: "冷青灰低饱和色调，局部光源与深浅暗部营造悬念，关键线索清晰",
        wardrobe: "符合剧情时代的便装、外套与调查用具，细节贴合人物身份",
        palette: ["#0b1215", "#1f3a40", "#5eead4"],
    },
    {
        id: "scifi",
        name: "科幻",
        description: "未来城市、星际与科技",
        world: "未来城市、实验设施、飞船与空间站，科技结构逻辑一致",
        look: "冷白、深空蓝与局部仪表光，科技材质层次清晰",
        wardrobe: "功能性制服、防护服、科技设备与复合材料配件",
        palette: ["#020617", "#1e3a8a", "#e2e8f0"],
    },
    {
        id: "romance",
        name: "甜宠恋爱",
        description: "温馨日常、约会与心动",
        world: "适合恋爱故事的街角、咖啡馆、公寓、花园与海边",
        look: "奶油白与蜜桃暖色，柔和光线与温暖生活氛围",
        wardrobe: "贴合剧情时代的日常服饰、约会装与精致配件",
        palette: ["#fde2e4", "#f7a1b5", "#fff1e6"],
    },
    {
        id: "rural",
        name: "田园生活",
        description: "村落山野、农事与烟火气",
        world: "乡村、田野、果园、小院与集市，生活细节贴合故事地域",
        look: "麦黄与青绿配色，自然暖光，季节和天气变化连贯",
        wardrobe: "符合剧情时代的朴素衣物、劳作工具与日常用品",
        palette: ["#2f3a1f", "#8aa35a", "#f2e2b3"],
    },
    {
        id: "historical",
        name: "年代复古",
        description: "旧街巷、年代陈设与怀旧生活",
        world: "故事年代的街巷、住宅、车站与公共场所，建筑和生活细节保持时代一致",
        look: "暖棕与米黄为基调，略褪色的怀旧配色与柔和光线",
        wardrobe: "与故事年代相符的服饰、交通工具和生活用品",
        palette: ["#3f3a2e", "#8a7a52", "#e2c98d"],
    },
    {
        id: "fantasy",
        name: "奇幻冒险",
        description: "王国古堡、魔法与异世界",
        world: "异世界王国、古堡、森林、浮空岛与魔法遗迹",
        look: "天空蓝与暖金色相映，天气与魔法光源营造冒险氛围",
        wardrobe: "冒险者皮甲、法袍、骑士铠甲与魔法道具，文化设定一致",
        palette: ["#0c4a6e", "#f59e0b", "#fef3c7"],
    },
    {
        id: "story",
        name: "跟随剧情",
        description: "不限定时代与世界设定",
        world: "遵循原作与当前剧情确定时代、地域和环境，不额外引入其他世界设定",
        look: "根据剧情统一色彩与光线，同一场景保持连续",
        wardrobe: "依据原作、人物身份和剧情选择服饰与道具",
        palette: ["#27272a", "#71717a", "#d4d4d8"],
    },
];

const formsById = new Map(DRAMA_STYLE_FORMS.map((form) => [form.id, form]));
const themesById = new Map(DRAMA_STYLE_THEMES.map((theme) => [theme.id, theme]));

/** 轴 ID 是持久化协议，名称和排序变化不影响已保存的组合。 */
export function composeDramaStyleId(formId: DramaStyleFormId, themeId: DramaStyleThemeId): string {
    if (!formsById.has(formId) || !themesById.has(themeId)) throw new RangeError("无效的表现形式或题材");
    return `composition:v1:${formId}:${themeId}`;
}

export const DEFAULT_DRAMA_STYLE_ID = composeDramaStyleId("realistic", "urban");

const composedStyles = new Map<string, DramaStyle & { composition: DramaStyleComposition }>();
for (const form of DRAMA_STYLE_FORMS) {
    for (const theme of DRAMA_STYLE_THEMES) {
        const id = composeDramaStyleId(form.id, theme.id);
        const detail = { medium: form.medium, world: theme.world, look: theme.look, wardrobe: theme.wardrobe, forbid: form.forbid };
        composedStyles.set(id, {
            id,
            name: `${form.name} · ${theme.name}`,
            category: form.category,
            tags: [form.name, theme.name],
            description: `${form.description}；${theme.description}`,
            palette: theme.palette,
            detail,
            composition: { formId: form.id, themeId: theme.id },
            prompt: [`表现形式：${detail.medium}`, `题材场景：${detail.world}`, `色彩光影：${detail.look}`, `服化道：${detail.wardrobe}`, `禁止：${detail.forbid}`].join("。"),
        });
    }
}

export function findComposedDramaStyle(id: string): DramaStyle | undefined {
    return composedStyles.get(id);
}

export function parseDramaStyleId(id: string): DramaStyleComposition | undefined {
    const composition = composedStyles.get(id)?.composition;
    return composition ? { ...composition } : undefined;
}
