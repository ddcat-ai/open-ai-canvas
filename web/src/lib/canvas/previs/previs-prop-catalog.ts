import type { PrevisLayoutTemplate, PrevisPropParams, PrevisVec3 } from "@/types/previs";

/**
 * 程序化道具目录：只放数据（ID、名称、分类、占地尺寸），几何体在 previs-prop-geometry.ts 生成。
 * 后端 Agent 白名单 cloud_agent_previs_catalog.go 与这里的 ID 一一对应，增删道具时两边同步。
 * size 为默认变体的宽/高/深（米），原点在底面中心；用于放置避让、取景和提示词。
 */
export type PrevisPropCategoryId = "building" | "base" | "plant" | "ancient" | "modern" | "street" | "vehicle" | "nature" | "furniture";

/** 参数定义：驱动检查器控件、Agent 校验（后端镜像）与默认值。 */
export type PrevisPropParamDef =
    { key: string; label: string; type: "number"; min: number; max: number; step: number; default: number; unit?: string } | { key: string; label: string; type: "enum"; default: string; options: Array<{ value: string; label: string }> };

export type PrevisCatalogProp = {
    id: string;
    name: string;
    category: PrevisPropCategoryId;
    size: PrevisVec3;
    /** 是否有多种造型变体（层数、高度、树冠形状）。 */
    variants?: boolean;
    /** 选择对象颜色时，哪部分跟着变：车身、外墙、花色等。 */
    accent?: string;
    /** 参数化组件的可调参数；有参数的道具尺寸由 resolvePrevisPropSize 按参数求出。 */
    params?: PrevisPropParamDef[];
};

export const PREVIS_PROP_CATEGORIES: Array<{ id: PrevisPropCategoryId; label: string }> = [
    { id: "building", label: "建筑" },
    { id: "base", label: "基础组件" },
    { id: "plant", label: "花草树木" },
    { id: "ancient", label: "古风建筑" },
    { id: "modern", label: "现代建筑" },
    { id: "street", label: "街道设施" },
    { id: "vehicle", label: "交通工具" },
    { id: "nature", label: "山石自然" },
    { id: "furniture", label: "室内家具" },
];

const prop = (id: string, name: string, category: PrevisPropCategoryId, size: PrevisVec3, extra: Partial<PrevisCatalogProp> = {}): PrevisCatalogProp => ({ id, name, category, size, ...extra });

const num = (key: string, label: string, min: number, max: number, step: number, value: number, unit?: string): PrevisPropParamDef => ({ key, label, type: "number", min, max, step, default: value, unit });
const pick = (key: string, label: string, value: string, options: Array<[string, string]>): PrevisPropParamDef => ({
    key,
    label,
    type: "enum",
    default: value,
    options: options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel })),
});

const MATERIAL_OPTIONS: Array<[string, string]> = [
    ["plaster", "白墙"],
    ["brick", "红砖"],
    ["stone", "石材"],
    ["concrete", "混凝土"],
    ["wood", "木"],
];

export const PREVIS_PROP_CATALOG: PrevisCatalogProp[] = [
    prop("building", "楼房", "building", [14, 19.2, 12], {
        accent: "外墙",
        params: [
            num("floors", "层数", 1, 80, 1, 6, "层"),
            num("width", "面宽", 4, 80, 0.5, 14, "m"),
            num("depth", "进深", 4, 60, 0.5, 12, "m"),
            num("floorHeight", "层高", 2.6, 6, 0.1, 3.2, "m"),
            pick("style", "立面", "modern", [
                ["modern", "现代白墙"],
                ["glass", "玻璃幕墙"],
                ["brick", "红砖"],
                ["concrete", "清水混凝土"],
                ["ancient", "古风楼阁"],
            ]),
            pick("roof", "屋顶", "flat", [
                ["flat", "平顶"],
                ["gable", "坡顶"],
                ["chinese", "中式飞檐"],
            ]),
            pick("balcony", "阳台", "none", [
                ["none", "无"],
                ["front", "正面阳台"],
            ]),
        ],
    }),
    prop("tower", "塔楼", "building", [28, 144, 28], {
        params: [
            num("floors", "层数", 10, 150, 1, 40, "层"),
            num("width", "面宽", 12, 70, 1, 28, "m"),
            num("setbacks", "退台", 0, 3, 1, 2, "次"),
            pick("crown", "顶部", "spire", [
                ["flat", "平顶"],
                ["spire", "尖顶"],
                ["crown", "冠顶"],
            ]),
        ],
    }),
    prop("chinese_hall", "古建殿堂", "building", [17, 7, 9], {
        accent: "墙面",
        params: [num("bays", "开间", 3, 11, 1, 5, "间"), num("depth", "进深", 5, 20, 0.5, 9, "m"), num("tiers", "层数", 1, 5, 1, 1, "层")],
    }),
    prop("road", "道路", "base", [15, 0.2, 40], {
        params: [
            num("length", "长度", 2, 600, 1, 40, "m"),
            num("width", "路宽", 2, 60, 0.5, 10, "m"),
            num("lanes", "车道", 0, 8, 1, 2, "条"),
            num("sidewalk", "人行道", 0, 10, 0.5, 2.5, "m"),
            pick("surface", "铺装", "asphalt", [
                ["asphalt", "沥青"],
                ["stone", "石板"],
                ["dirt", "土路"],
            ]),
        ],
    }),
    prop("wall", "墙体", "base", [8, 3, 0.3], {
        params: [
            num("length", "长度", 0.5, 200, 0.5, 8, "m"),
            num("height", "高度", 0.3, 20, 0.1, 3, "m"),
            num("thickness", "厚度", 0.08, 8, 0.02, 0.3, "m"),
            pick("material", "材质", "plaster", MATERIAL_OPTIONS),
            pick("top", "墙头", "none", [
                ["none", "无"],
                ["tiles", "瓦顶"],
                ["battlement", "垛口"],
            ]),
        ],
    }),
    prop("ground_patch", "地面", "base", [20, 0.05, 20], {
        params: [
            num("width", "宽度", 0.5, 800, 0.5, 20, "m"),
            num("depth", "深度", 0.5, 800, 0.5, 20, "m"),
            pick("surface", "表面", "grass", [
                ["grass", "草地"],
                ["plaza", "广场砖"],
                ["stone", "石面"],
                ["sand", "沙地"],
                ["water", "水面"],
                ["soil", "泥土"],
                ["snow", "雪地"],
            ]),
        ],
    }),
    prop("stairs", "台阶", "base", [3, 1.36, 2.4], {
        params: [
            num("width", "宽度", 0.6, 40, 0.1, 3, "m"),
            num("steps", "级数", 1, 60, 1, 8, "级"),
            num("stepHeight", "踏步高", 0.08, 0.5, 0.01, 0.17, "m"),
            num("stepDepth", "踏步深", 0.15, 1, 0.01, 0.3, "m"),
            pick("material", "材质", "stone", [
                ["stone", "石材"],
                ["concrete", "混凝土"],
                ["wood", "木"],
            ]),
        ],
    }),
    prop("fence_line", "围栏", "base", [8, 1.1, 0.3], {
        params: [
            num("length", "长度", 1, 200, 0.5, 8, "m"),
            num("height", "高度", 0.4, 4, 0.1, 1.1, "m"),
            pick("style", "样式", "wood", [
                ["wood", "木栅"],
                ["metal", "铁艺"],
                ["stone", "石栏"],
            ]),
        ],
    }),
    prop("room", "房间", "base", [6, 3, 5], {
        accent: "墙面",
        params: [
            num("width", "宽度", 2, 40, 0.1, 6, "m"),
            num("depth", "进深", 2, 40, 0.1, 5, "m"),
            num("height", "层高", 2.2, 8, 0.1, 3, "m"),
            num("windows", "窗户", 0, 6, 1, 2, "扇"),
            pick("door", "门", "right", [
                ["none", "无"],
                ["left", "左墙"],
                ["right", "右墙"],
                ["back", "后墙"],
            ]),
            pick("front", "正面", "open", [
                ["open", "敞开（给机位）"],
                ["closed", "封闭"],
            ]),
        ],
    }),
    prop("platform", "平台", "base", [8, 0.6, 8], {
        params: [
            num("width", "宽度", 0.5, 200, 0.5, 8, "m"),
            num("depth", "深度", 0.5, 200, 0.5, 8, "m"),
            num("height", "高度", 0.05, 10, 0.05, 0.6, "m"),
            pick(
                "material",
                "材质",
                "stone",
                MATERIAL_OPTIONS.filter(([value]) => value !== "brick"),
            ),
        ],
    }),
    prop("column", "柱子", "base", [0.7, 3, 0.7], {
        params: [
            num("height", "高度", 0.5, 30, 0.1, 3, "m"),
            num("radius", "半径", 0.05, 3, 0.05, 0.25, "m"),
            pick("style", "样式", "round", [
                ["round", "圆柱"],
                ["square", "方柱"],
                ["chinese", "中式红柱"],
            ]),
        ],
    }),

    prop("tree_broadleaf", "阔叶树", "plant", [5, 7, 5], { variants: true }),
    prop("tree_pine", "松树", "plant", [3.6, 8, 3.6], { variants: true }),
    prop("tree_willow", "垂柳", "plant", [5.5, 6.5, 5.5], { variants: true }),
    prop("tree_cherry", "樱花树", "plant", [4.6, 5, 4.6], { variants: true, accent: "花色" }),
    prop("tree_palm", "棕榈树", "plant", [4, 7, 4], { variants: true }),
    prop("bamboo", "竹丛", "plant", [2.4, 6, 2.4], { variants: true }),
    prop("bush", "灌木", "plant", [1.6, 1.1, 1.6], { variants: true }),
    prop("hedge", "绿篱", "plant", [4, 1.1, 0.8]),
    prop("grass", "草丛", "plant", [0.9, 0.5, 0.9], { variants: true }),
    prop("flowers", "野花丛", "plant", [1.2, 0.5, 1.2], { variants: true, accent: "花色" }),
    prop("flower_bed", "花坛", "plant", [3, 0.8, 1.6], { variants: true, accent: "花色" }),
    prop("potted_plant", "盆栽", "plant", [0.6, 1.2, 0.6], { variants: true, accent: "花盆" }),
    prop("lotus_pond", "荷花池", "plant", [6, 0.6, 4]),

    prop("ancient_house", "古代民居", "ancient", [9, 5.6, 7], { variants: true, accent: "墙面" }),
    prop("ancient_shop", "古代商铺", "ancient", [8, 8.4, 7], { variants: true, accent: "招幌" }),
    prop("ancient_courtyard", "四合院", "ancient", [22, 6, 22], { accent: "墙面" }),
    prop("tower_hall", "楼阁", "ancient", [16, 20, 13], { variants: true }),
    prop("pagoda", "宝塔", "ancient", [9, 28, 9], { variants: true }),
    prop("pavilion", "凉亭", "ancient", [5, 5.4, 5]),
    prop("city_gate", "城门", "ancient", [32, 22, 14]),
    prop("ancient_wall", "城墙段", "ancient", [20, 9, 6]),
    prop("paifang", "牌坊", "ancient", [12, 9, 1.6], { accent: "梁枋" }),
    prop("stone_bridge", "石拱桥", "ancient", [4, 3.2, 14]),
    prop("well", "水井", "ancient", [2.4, 2.8, 2.4]),
    prop("market_stall", "集市摊位", "ancient", [3, 2.6, 2], { variants: true, accent: "布棚" }),
    prop("lantern_pole", "灯笼杆", "ancient", [0.8, 4, 0.8], { accent: "灯笼" }),

    prop("modern_house", "现代住宅", "modern", [11, 7, 9], { variants: true, accent: "外墙" }),
    prop("villa", "坡顶别墅", "modern", [10, 8.5, 8], { variants: true, accent: "屋顶" }),
    prop("apartment", "公寓楼", "modern", [18, 36, 14], { variants: true, accent: "外墙" }),
    prop("office_tower", "写字楼", "modern", [26, 70, 26], { variants: true }),
    prop("skyscraper", "摩天大楼", "modern", [32, 180, 32], { variants: true }),
    prop("shop_front", "临街商铺", "modern", [10, 5, 9], { variants: true, accent: "雨棚" }),

    prop("street_lamp", "路灯", "street", [1.6, 6.5, 0.4]),
    prop("traffic_light", "红绿灯", "street", [3.4, 5.6, 0.5]),
    prop("bench", "长椅", "street", [1.8, 0.9, 0.7], { accent: "椅面" }),
    prop("bus_stop", "公交站", "street", [5, 2.8, 1.8], { accent: "顶棚" }),
    prop("fence", "栅栏", "street", [4, 1.1, 0.12]),
    prop("trash_bin", "垃圾桶", "street", [0.6, 1, 0.6], { accent: "桶身" }),

    prop("car", "轿车", "vehicle", [1.9, 1.5, 4.6], { variants: true, accent: "车身" }),
    prop("bus", "公交车", "vehicle", [2.6, 3.2, 11], { accent: "车身" }),
    prop("ox_cart", "牛车", "vehicle", [2.2, 2, 5.4]),
    prop("bicycle", "自行车", "vehicle", [0.6, 1.05, 1.8], { accent: "车架" }),

    prop("rock", "岩石", "nature", [1.4, 0.9, 1.2], { variants: true }),
    prop("boulder", "巨石", "nature", [4, 3, 3.4], { variants: true }),
    prop("hill", "山丘", "nature", [40, 14, 34], { variants: true }),
    prop("log", "倒木", "nature", [0.6, 0.6, 4], { variants: true }),

    prop("sofa", "沙发", "furniture", [2.2, 0.85, 0.9], { accent: "布面" }),
    prop("dining_table", "餐桌", "furniture", [1.6, 0.76, 0.9]),
    prop("chair", "椅子", "furniture", [0.5, 0.95, 0.52], { accent: "椅面" }),
    prop("bed", "双人床", "furniture", [1.8, 1.1, 2.15], { accent: "床品" }),
    prop("bookshelf", "书架", "furniture", [1.2, 2, 0.35]),
    prop("desk", "书桌", "furniture", [1.4, 0.76, 0.7]),
];

const PROP_BY_ID = new Map(PREVIS_PROP_CATALOG.map((item) => [item.id, item]));

export function resolvePrevisCatalogProp(id?: string): PrevisCatalogProp | undefined {
    return id ? PROP_BY_ID.get(id) : undefined;
}

/** 参数 → 实际取值：缺失或越界的数值回落默认并夹到范围内，非法枚举回落默认。 */
export function resolvePrevisPropParams(propId: string | undefined, params?: PrevisPropParams): PrevisPropParams {
    const defs = resolvePrevisCatalogProp(propId)?.params;
    if (!defs) return {};
    const result: PrevisPropParams = {};
    for (const def of defs) {
        const value = params?.[def.key];
        if (def.type === "number") {
            const number = Number(value);
            result[def.key] = Number.isFinite(number) ? Math.min(def.max, Math.max(def.min, number)) : def.default;
        } else {
            result[def.key] = typeof value === "string" && def.options.some((option) => option.value === value) ? value : def.default;
        }
    }
    return result;
}

/** 道具实际尺寸（宽/高/深，米）：参数化组件按参数计算，其他道具取目录尺寸。 */
export function resolvePrevisPropSize(propId: string | undefined, params?: PrevisPropParams): PrevisVec3 | undefined {
    const prop = resolvePrevisCatalogProp(propId);
    if (!prop) return undefined;
    if (!prop.params) return prop.size;
    const p = resolvePrevisPropParams(propId, params);
    const n = (key: string) => Number(p[key]);
    switch (prop.id) {
        case "building":
            return p.style === "ancient"
                ? [n("width") + 1.6, n("floors") * (Math.max(3, n("floorHeight")) + 1) + 3, n("depth") + 1.6]
                : [n("width"), n("floors") * n("floorHeight") + (p.roof === "flat" ? 2.6 : 3), n("depth") + (p.balcony === "front" ? 1.2 : 0)];
        case "tower":
            return [n("width"), n("floors") * 3.6 * 1.1, n("width")];
        case "chinese_hall":
            return [n("bays") * 3.4 + 1.6, n("tiers") * 5 + 3, n("depth") + 1.6];
        case "road":
            return [n("width") + n("sidewalk") * 2, 0.2, n("length")];
        case "wall":
            return [n("length"), n("height") + (p.top === "none" ? 0 : 0.8), n("thickness")];
        case "ground_patch":
            return [n("width"), 0.05, n("depth")];
        case "stairs":
            return [n("width"), n("steps") * n("stepHeight"), n("steps") * n("stepDepth")];
        case "fence_line":
            return [n("length"), n("height"), 0.3];
        case "room":
            return [n("width"), n("height"), n("depth")];
        case "platform":
            return [n("width"), n("height"), n("depth")];
        case "column":
            return [n("radius") * 2.8, n("height"), n("radius") * 2.8];
        default:
            return prop.size;
    }
}

export type PrevisLayoutTemplateInfo = { id: PrevisLayoutTemplate; name: string; hint: string; defaultSize: number; minSize: number; maxSize: number };

export const PREVIS_LAYOUT_TEMPLATES: PrevisLayoutTemplateInfo[] = [
    { id: "ancient_city", name: "古代城池", hint: "棋盘街巷、中轴楼阁、城门城墙", defaultSize: 420, minSize: 160, maxSize: 1200 },
    { id: "ancient_street", name: "古街集市", hint: "一条长街，两侧商铺与摊位", defaultSize: 180, minSize: 80, maxSize: 600 },
    { id: "modern_city", name: "现代都市", hint: "路网街区，中心高楼林立", defaultSize: 520, minSize: 200, maxSize: 1200 },
    { id: "modern_street", name: "城市街道", hint: "双向车道、临街商铺与公寓", defaultSize: 200, minSize: 80, maxSize: 600 },
    { id: "village", name: "乡村", hint: "散落民居、田地、土路与树林", defaultSize: 300, minSize: 100, maxSize: 900 },
    { id: "garden", name: "古典园林", hint: "凉亭、拱桥、荷塘、花木", defaultSize: 110, minSize: 50, maxSize: 300 },
    { id: "forest", name: "森林", hint: "松林阔叶林、山石与小径", defaultSize: 260, minSize: 80, maxSize: 1000 },
];

export function resolvePrevisLayoutTemplate(id?: string): PrevisLayoutTemplateInfo | undefined {
    return PREVIS_LAYOUT_TEMPLATES.find((item) => item.id === id);
}

export function formatPrevisSize(size: PrevisVec3) {
    const fmt = (value: number) => (value >= 10 ? String(Math.round(value)) : String(Number(value.toFixed(1))));
    return `${fmt(size[0])}×${fmt(size[1])}×${fmt(size[2])}m`;
}
