/** 电商 Agent「商品图片 · 批量换装」：可切换的换装功能、上传位与各功能的可选项。界面文字与提示词同为中文。 */

export type TryOnFunction = "outfit" | "fine-outfit" | "model-views" | "multi-model" | "multi-outfit" | "pose" | "face-swap" | "smart-face" | "smart-head" | "background" | "scene" | "enhance" | "print";

export type TryOnSlotKey = "model" | "garment" | "garment-back" | "background" | "subject" | "pose" | "face";

/** 悬停上传位时弹出的「上传示范」类型。 */
export type TryOnTipKind = "model" | "garment" | "subject" | "pose" | "face" | "print";

export type TryOnSlot = {
    key: TryOnSlotKey;
    /** 上传卡片与句子里的名称：模特 / 图片 / 主体 / 姿势 / 脸部 / 服装。 */
    label: string;
    max: number;
    /** 至少需要几张；姿势位可以改用文本姿势，所以最少 0 张。 */
    min: number;
    note: string;
    tip: TryOnTipKind;
};

/** 句子模板：文字段与上传位交替，上传位按出现顺序编号为图一、图二。 */
export type TryOnSentencePart = string | { slot: TryOnSlotKey };

export type TryOnFunctionConfig = {
    id: TryOnFunction;
    label: string;
    title: string;
    description: string;
    sentence: TryOnSentencePart[];
    /** 换成 AI 真人模特时的句子（多模特同款 / 一模多衣）。 */
    aiSentence?: TryOnSentencePart[];
    slots: TryOnSlot[];
    /** 两个上传位之间的互换按钮。 */
    swap?: [TryOnSlotKey, TryOnSlotKey];
    placeholder: string;
    examples: string[];
    /** 是否出现「场景与风格」（重新拍摄人物所在的画面）。 */
    scenes: boolean;
    /** 「模特：智能匹配 / 统一模特」在本功能里的含义；不适用时置灰。 */
    castingNote?: { smart: string; unified: string };
    defaultRatio: string;
    /** 结果卡片上的短标签。 */
    badge: string;
};

const slot = (key: TryOnSlotKey, label: string, max: number, note: string, tip: TryOnTipKind, min = 1): TryOnSlot => ({ key, label, max, min, note, tip });

export const TRYON_FUNCTIONS: TryOnFunctionConfig[] = [
    {
        id: "model-views",
        label: "模特三视图",
        title: "模特三视图",
        description: "以同一位模特生成正面、45°侧面、背面的三视图拼接图，可选服装正背面和背景参考",
        sentence: ["为 ", { slot: "model" }, " 的模特生成正面 / 45°侧面 / 背面三视图，可参考服装与背景。"],
        slots: [
            slot("model", "模特", 1, "限 1 张 · 同一位人物", "model"),
            slot("garment", "服装正面", 1, "可选 · 锁定服装正面细节", "garment", 0),
            slot("garment-back", "服装背面", 1, "可选 · 锁定服装背面细节", "garment", 0),
            slot("background", "背景", 1, "可选 · 统一三格场景", "subject", 0),
        ],
        placeholder: "补充三视图要求，例如：全身入镜、浅灰背景、保持人物与服装一致…",
        examples: ["同一位人物等高全身，正面、45°侧面、背面从左到右排列", "纯浅灰背景，柔和均匀光线，服装细节清楚"],
        scenes: false,
        defaultRatio: "3:2",
        badge: "三视图",
    },
    {
        id: "outfit",
        label: "模特换装",
        title: "模特换装",
        description: "上传模特和服装，让这位模特穿上你的衣服；可保持原图，也可让 Agent 规划多场景",
        sentence: ["让 ", { slot: "model" }, " 的模特穿上 ", { slot: "garment" }, " 的衣服，AI 自动出图。"],
        slots: [slot("model", "模特", 1, "限 1 张 · 正面清晰", "model"), slot("garment", "图片", 3, "最多 3 张 · 同一件衣服", "garment")],
        swap: ["model", "garment"],
        placeholder: "补充要求（选填），例如：调整光线、风格、姿态、内搭颜色…",
        examples: [
            "保持模特原来的姿势和背景，只把衣服换成参考图里的款式，面料垂坠自然",
            "衣服下摆塞进裤腰，袖口自然挽起，整体干练通勤感",
            "外套敞开穿，露出内搭，搭配同色系阔腿裤与乐福鞋",
            "柔和窗光，暖调胶片质感，适合小红书种草图",
            "改成白底棚拍全身照，平视机位，用于商品主图",
        ],
        scenes: true,
        castingNote: { smart: "沿用你上传的模特", unified: "沿用你上传的模特" },
        defaultRatio: "3:4",
        badge: "换装",
    },
    {
        id: "fine-outfit",
        label: "精细化换装",
        title: "精细化换装",
        description: "以图一人物为准精确替换服装，重点保留版型、面料纹理、缝线、印花和身体遮挡关系",
        sentence: ["让 ", { slot: "model" }, " 的模特精细穿上 ", { slot: "garment" }, " 的服装。"],
        slots: [slot("model", "图一人物", 1, "限 1 张 · 人物完整清晰", "model"), slot("garment", "服装参考", 3, "最多 3 张 · 同一件衣服", "garment")],
        swap: ["model", "garment"],
        placeholder: "补充要求（选填），例如：保持原图姿势和背景，锁定衣领、袖口、褶皱与印花位置…",
        examples: ["只替换图一人物身上的服装，锁定衣领、袖口、门襟、口袋、缝线和印花位置", "服装与身体自然贴合，保留真实面料纹理、垂坠、受力褶皱和遮挡关系", "人物脸、发型、手脚、姿势、机位、背景和光线全部沿用图一"],
        scenes: false,
        castingNote: { smart: "沿用图一人物", unified: "沿用图一人物" },
        defaultRatio: "auto",
        badge: "精细换装",
    },
    {
        id: "multi-model",
        label: "多模特同款",
        title: "多模特同款",
        description: "一件衣服让多位真人模特同时上身：上传多位模特，或按国家和地区由 AI 选角，肤色与长相随地区变化",
        sentence: ["让 ", { slot: "model" }, " 的每位模特都穿上 ", { slot: "garment" }, " 的同款衣服，一次出多人上身效果。"],
        aiSentence: ["让 AI 按所选国家选出不同的真人模特，都穿上 ", { slot: "garment" }, " 的同款衣服。"],
        slots: [slot("model", "模特", 8, "最多 8 位 · 每位 1 张", "model"), slot("garment", "服装", 3, "最多 3 张 · 同一件衣服", "garment")],
        swap: ["model", "garment"],
        placeholder: "补充要求（选填），例如：统一白底棚拍、不同肤色和身材都要好看…",
        examples: ["每位模特用同一个白底棚拍场景和相同机位，方便放在一起对比上身效果", "覆盖不同身材：标准、微胖、高挑各一位，展示版型包容度", "按各自国家的街头场景拍摄，人物神态自然，像当地博主实拍", "全部半身近景，突出领口和面料细节"],
        scenes: true,
        castingNote: { smart: "每张换一位模特，长相与身材各不相同", unified: "全部使用同一位 AI 模特，换场景不换人" },
        defaultRatio: "3:4",
        badge: "多模特",
    },
    {
        id: "multi-outfit",
        label: "一模多衣",
        title: "一模多衣",
        description: "一位模特试穿多件衣服或商品：可以一件一张逐件上身，也可以组合成一整套穿搭",
        sentence: ["让 ", { slot: "model" }, " 的模特依次穿上 ", { slot: "garment" }, " 的每件衣服，一件一套出图。"],
        aiSentence: ["让同一位 AI 真人模特依次穿上 ", { slot: "garment" }, " 的每件衣服，一件一套出图。"],
        slots: [slot("model", "模特", 1, "限 1 张 · 正面清晰", "model"), slot("garment", "服装", 8, "最多 8 件 · 每件 1 张", "garment")],
        placeholder: "补充要求（选填），例如：同一场景同一姿势，方便做 SKU 对比…",
        examples: ["所有款式用同一场景、同一姿势和机位，适合做颜色 / SKU 对比图", "上衣、裤子、鞋子组合成一整套穿搭，全身入镜", "每件换一个适合它的场景：衬衫通勤、卫衣街头、针织居家", "统一浅灰影棚，模特表情自然，略带微笑"],
        scenes: true,
        castingNote: { smart: "沿用同一位模特", unified: "沿用同一位模特" },
        defaultRatio: "3:4",
        badge: "一模多衣",
    },
    {
        id: "pose",
        label: "姿势参考",
        title: "姿势参考",
        description: "让主体摆出参考图或文本描述的姿势，服装、长相和画面风格保持不变",
        sentence: ["让 ", { slot: "subject" }, " 的主体摆出 ", { slot: "pose" }, " 的姿势。"],
        slots: [slot("subject", "主体", 1, "限 1 张 · 人物完整", "subject"), slot("pose", "姿势", 6, "最多 6 张，或下方选文本姿势", "pose", 0)],
        swap: ["subject", "pose"],
        placeholder: "补充姿势要求（选填），例如：手部动作、视线方向、站姿重心…",
        examples: ["双手自然下垂，重心放在一条腿上，肩膀放松", "侧身 45 度回头看镜头，下巴微收", "坐在高脚凳上，一条腿踩在横杆，双手搭在膝盖", "迈步向前的抓拍瞬间，衣摆被带起"],
        scenes: false,
        castingNote: { smart: "沿用主体本人", unified: "沿用主体本人" },
        defaultRatio: "3:4",
        badge: "姿势",
    },
    {
        id: "face-swap",
        label: "模特换脸",
        title: "模特换脸",
        description: "只换脸不换头：把指定的五官换到模特脸上，发型、头型、身材、服装和场景都不变；可一次换多张模特图",
        sentence: ["把 ", { slot: "face" }, " 的脸换到 ", { slot: "model" }, " 的人物身上。"],
        slots: [slot("face", "脸部", 3, "最多 3 张 · 同一个人", "face"), slot("model", "模特", 8, "最多 8 张 · 批量换脸", "model")],
        swap: ["face", "model"],
        placeholder: "补充换脸要求（选填），例如：保留原图妆容、肤色和身体统一…",
        examples: ["肤色与脖子、手臂统一，光影跟随原图", "表情改为自然微笑，眼神看向镜头"],
        scenes: false,
        castingNote: { smart: "所有图片使用同一张脸", unified: "所有图片使用同一张脸" },
        defaultRatio: "auto",
        badge: "换脸",
    },
    {
        id: "smart-face",
        label: "智能换脸",
        title: "智能换脸",
        description: "只换脸不换头：给模特换一张 AI 原创的新五官，可按国家和气质指定方向；发型、头型、服装与画面不变",
        sentence: ["给 ", { slot: "model" }, " 模特随机换一张新脸。"],
        slots: [slot("model", "模特", 8, "最多 8 张 · 批量换脸", "model")],
        placeholder: "补充换脸要求（选填），例如：欧美五官、亚洲五官、年轻一些…",
        examples: ["换成东亚面孔，清透淡妆，气质温柔", "换成欧美面孔，五官立体，自然雀斑", "年龄看起来 25 岁左右，表情自然微笑"],
        scenes: false,
        castingNote: { smart: "每张图换一张不同的新脸", unified: "全部图片换成同一张新脸" },
        defaultRatio: "auto",
        badge: "智能换脸",
    },
    {
        id: "smart-head",
        label: "智能换头",
        title: "智能换头",
        description: "给模特随机换一个新头型：脸和发型一起换新，可指定发型、发色与国家；身体与服装不变",
        sentence: ["给 ", { slot: "model" }, " 模特随机换一个新头型。"],
        slots: [slot("model", "模特", 8, "最多 8 张 · 批量换头", "model")],
        placeholder: "补充换头要求（选填），例如：欧美五官、短发、亚麻色…",
        examples: ["换成短发利落的欧美模特，五官立体", "长卷发、温柔气质的亚洲模特", "高马尾、运动感，适合运动服展示", "银灰短发的成熟模特，适合中老年服饰"],
        scenes: false,
        castingNote: { smart: "每张图换一个不同的新头型", unified: "全部图片换成同一个新头型" },
        defaultRatio: "auto",
        badge: "智能换头",
    },
    {
        id: "background",
        label: "换背景",
        title: "换背景",
        description: "保留图一主体，只把环境背景替换为图二背景，并匹配透视、光线与接触阴影",
        sentence: ["保留 ", { slot: "subject" }, " 的主体，把背景换成 ", { slot: "background" }, "。"],
        slots: [slot("subject", "图一主体", 1, "限 1 张 · 人物或商品完整", "subject"), slot("background", "图二背景", 1, "限 1 张 · 目标环境参考", "subject")],
        swap: ["subject", "background"],
        placeholder: "补充要求（选填），例如：主体大小不变、地面接触自然、保留原商品标签…",
        examples: ["只替换背景，图一人物和商品的轮廓、颜色、文字、姿势和构图保持不变", "按图二环境的透视、光向、色温、接触阴影和反射重新合成", "主体边缘尤其是发丝、透明材质和细小配件自然抠出，不出现光晕和残留背景"],
        scenes: false,
        defaultRatio: "auto",
        badge: "换背景",
    },
    {
        id: "scene",
        label: "场景提取",
        title: "场景提取",
        description: "提取图二的场景氛围、空间关系和光线，重新拍摄图一主体",
        sentence: ["提取 ", { slot: "background" }, " 的场景，让 ", { slot: "subject" }, " 融入其中。"],
        slots: [slot("subject", "图一主体", 1, "限 1 张 · 人物或商品完整", "subject"), slot("background", "图二场景", 1, "限 1 张 · 场景与光线参考", "subject")],
        swap: ["subject", "background"],
        placeholder: "补充要求（选填），例如：主体站在场景中央、保留图一服装和姿势、自然景深…",
        examples: ["提取图二的空间布局、材质、色调、光线方向和景深，作为图一主体的新拍摄场景", "主体比例、身份、商品外观、服装、姿势和机位以图一为准，不复制图二人物", "主体与环境有真实遮挡、接触阴影和反射，像同一台相机现场拍摄"],
        scenes: false,
        defaultRatio: "auto",
        badge: "场景提取",
    },
    {
        id: "enhance",
        label: "脸部增强",
        title: "脸部增强",
        description: "增强图一人物脸部清晰度和自然细节，保留本人身份、表情、妆容与整体画面",
        sentence: ["增强 ", { slot: "subject" }, " 的脸部细节。"],
        slots: [slot("subject", "图一人像", 1, "限 1 张 · 含清晰面部", "subject")],
        placeholder: "补充要求（选填），例如：保留妆容与年龄感，轻微修复压缩和运动模糊…",
        examples: ["只增强脸部清晰度、眼神、皮肤纹理和发丝细节，保留本人五官与年龄感", "修复轻微模糊、噪点和压缩痕迹，肤质自然，不磨皮、不换脸、不瘦脸", "脸部增强后的光线、色温、妆容、表情和身体画面与原图一致"],
        scenes: false,
        defaultRatio: "auto",
        badge: "脸部增强",
    },
    {
        id: "print",
        label: "印花提取",
        title: "印花提取",
        description: "从服装照片里提取印花图案，去掉褶皱和光影，输出 PNG 图案稿",
        sentence: ["提取 ", { slot: "garment" }, " 服装的印花，输出 PNG 图案。"],
        slots: [slot("garment", "服装", 6, "最多 6 张 · 批量提取", "print")],
        placeholder: "补充印花提取要求（选填），例如：只保留胸前图案、去掉文字…",
        examples: ["只保留胸前的主图案，去掉衣服本身", "整件衣服的印花平铺展开，去掉褶皱和阴影", "做成可以无缝拼接的四方连续图案", "保留原图配色，线条边缘清晰锐利"],
        scenes: false,
        defaultRatio: "1:1",
        badge: "印花",
    },
];

export const tryOnFunction = (id: TryOnFunction) => TRYON_FUNCTIONS.find((item) => item.id === id) || TRYON_FUNCTIONS[0];

export const isTryOnFunction = (value: unknown): value is TryOnFunction => TRYON_FUNCTIONS.some((item) => item.id === value);

/** 句子里的上传位编号：按出现顺序。 */
export const CHIP_NAMES = ["图一", "图二", "图三", "图四"];

// ---------- 模特来源：多模特同款 / 一模多衣 ----------
export type TryOnModelSource = "upload" | "ai";

export type TryOnGender = "female" | "male" | "any";
export type TryOnAge = "child" | "teen" | "young" | "adult" | "middle" | "senior";
export type TryOnBody = "standard" | "slim" | "curvy" | "athletic" | "plus";

export const GENDERS: Array<{ value: TryOnGender; label: string }> = [
    { value: "female", label: "女" },
    { value: "male", label: "男" },
    { value: "any", label: "不限" },
];

export const AGES: Array<{ value: TryOnAge; label: string; text: string }> = [
    { value: "child", label: "儿童", text: "6–10 岁儿童" },
    { value: "teen", label: "少年", text: "13–17 岁少年" },
    { value: "young", label: "青年", text: "20–28 岁青年" },
    { value: "adult", label: "轻熟", text: "29–38 岁" },
    { value: "middle", label: "中年", text: "40–52 岁" },
    { value: "senior", label: "银发", text: "58–70 岁银发" },
];

export const BODIES: Array<{ value: TryOnBody; label: string; text: string }> = [
    { value: "standard", label: "标准", text: "匀称标准身材" },
    { value: "slim", label: "纤瘦", text: "纤瘦高挑身材" },
    { value: "curvy", label: "曲线", text: "曲线明显的沙漏身材" },
    { value: "athletic", label: "健美", text: "线条紧实的健美身材" },
    { value: "plus", label: "大码", text: "健康自信的大码身材" },
];

// ---------- 国家和地区：AI 选角时决定人物的肤色、五官、发色与气质 ----------
export type TryOnMarket = { id: string; label: string; group: string; casting: string };

export const MARKET_GROUPS = ["东亚", "东南亚", "南亚 · 中东", "欧洲", "美洲", "非洲 · 大洋洲"];

export const MARKETS: TryOnMarket[] = [
    { id: "cn", label: "中国", group: "东亚", casting: "中国本土真人：东亚面孔，肤色从白皙到健康小麦色自然多样，黑色或深棕色头发，妆发与穿着是中国当下的日常审美" },
    { id: "jp", label: "日本", group: "东亚", casting: "日本本地真人：东亚面孔，肤色白皙到自然偏暖，妆感清淡，发型偏日系自然" },
    { id: "kr", label: "韩国", group: "东亚", casting: "韩国本地真人：东亚面孔，肤质清透，妆感干净，发型偏韩系" },
    { id: "th", label: "泰国", group: "东南亚", casting: "泰国本地真人：东南亚面孔，小麦到浅棕肤色，五官柔和，深色头发" },
    { id: "vn", label: "越南", group: "东南亚", casting: "越南本地真人：东南亚面孔，肤色白皙到小麦色，黑色长直发常见" },
    { id: "id", label: "印尼", group: "东南亚", casting: "印度尼西亚本地真人：东南亚面孔，暖棕到小麦肤色，深色头发；穿着得体，不额外添加会遮挡服装的配饰" },
    { id: "my", label: "马来西亚", group: "东南亚", casting: "马来西亚本地真人：族裔多元（马来裔、华裔、印度裔均可），肤色从浅到深棕自然多样" },
    { id: "ph", label: "菲律宾", group: "东南亚", casting: "菲律宾本地真人：东南亚面孔，暖调小麦到棕色肤色，深色头发，笑容亲和" },
    { id: "in", label: "印度", group: "南亚 · 中东", casting: "印度本地真人：南亚面孔，小麦到深棕肤色，深色眼睛与浓密深色头发" },
    { id: "ae", label: "中东", group: "南亚 · 中东", casting: "中东海湾地区本地真人：橄榄到小麦肤色，深色浓眉与深色头发，造型得体大方，不额外添加会遮挡服装的配饰" },
    { id: "tr", label: "土耳其", group: "南亚 · 中东", casting: "土耳其本地真人：橄榄肤色，深色头发与深邃眉眼" },
    { id: "gb", label: "英国", group: "欧洲", casting: "英国本地真人：族裔多元（以欧裔为主，也可以是非裔、南亚裔），肤色与发色按所选人物自然呈现" },
    { id: "fr", label: "法国", group: "欧洲", casting: "法国本地真人：欧洲面孔为主，自然松弛的法式妆发，也可以是北非裔或非裔法国人" },
    { id: "de", label: "德国", group: "欧洲", casting: "德国本地真人：欧洲面孔，浅肤色，金发、浅棕或深棕发均可，气质干净利落" },
    { id: "it", label: "意大利", group: "欧洲", casting: "意大利本地真人：南欧面孔，橄榄到浅肤色，深棕色头发与浓眉，气质热情" },
    { id: "es", label: "西班牙", group: "欧洲", casting: "西班牙本地真人：南欧面孔，橄榄肤色，深色头发，五官立体" },
    { id: "nordic", label: "北欧", group: "欧洲", casting: "北欧本地真人：浅肤色，金发或浅棕发，浅色眼睛常见，气质清爽" },
    { id: "ru", label: "俄罗斯", group: "欧洲", casting: "俄罗斯本地真人：东欧面孔，浅肤色，浅棕到深棕色头发，五官立体" },
    { id: "us", label: "美国", group: "美洲", casting: "美国本地真人：族裔多元（欧裔、非裔、拉丁裔、亚裔均可），每位人物写清具体肤色与五官，不千篇一律" },
    { id: "ca", label: "加拿大", group: "美洲", casting: "加拿大本地真人：族裔多元，肤色与发色自然多样，气质随和" },
    { id: "br", label: "巴西", group: "美洲", casting: "巴西本地真人：混血特征常见，肤色从浅橄榄到深棕，自然卷发或波浪发，健康阳光" },
    { id: "mx", label: "墨西哥", group: "美洲", casting: "墨西哥本地真人：拉丁面孔，小麦到棕色肤色，深色头发与深色眼睛" },
    { id: "ng", label: "尼日利亚", group: "非洲 · 大洋洲", casting: "尼日利亚本地真人：深肤色，五官立体，自然卷发、编发或短发" },
    { id: "za", label: "南非", group: "非洲 · 大洋洲", casting: "南非本地真人：族裔多元（非洲裔为主，也可以是有色人种或欧裔），肤色自然多样" },
    { id: "au", label: "澳大利亚", group: "非洲 · 大洋洲", casting: "澳大利亚本地真人：族裔多元，户外感的健康肤色，气质阳光" },
];

export const marketById = (id: string) => MARKETS.find((item) => item.id === id);

// ---------- 场景 ----------
export type TryOnSceneMode = "keep" | "smart" | "custom";

export type TryOnScene = { id: string; label: string; text: string };

export const SCENES: TryOnScene[] = [
    { id: "studio-white", label: "白底棚拍", text: "纯白无缝影棚，柔和大面积光，干净的地面接触阴影，适合商品主图" },
    { id: "studio-color", label: "纯色影棚", text: "与服装色彩协调的纯色无缝背景，棚拍柔光，时尚画册质感" },
    { id: "street", label: "城市街拍", text: "城市街头，街角与建筑立面做背景，自然日光，街拍抓拍感" },
    { id: "cafe", label: "咖啡店", text: "精致的咖啡店窗边，木质桌椅与绿植，柔和窗光" },
    { id: "office", label: "通勤办公", text: "现代写字楼大堂或明亮办公室，通勤氛围，干净利落" },
    { id: "home", label: "居家生活", text: "温馨的居家客厅或卧室，自然窗光，生活方式感" },
    { id: "park", label: "公园户外", text: "公园草地与树荫，午后自然光，轻松惬意" },
    { id: "beach", label: "海边度假", text: "海边沙滩或海岸步道，明亮阳光，度假氛围" },
    { id: "campus", label: "校园", text: "校园林荫道或教学楼前，青春自然" },
    { id: "sport", label: "运动场", text: "户外跑道、球场或健身房，动感光线" },
    { id: "night", label: "夜景霓虹", text: "城市夜景街道，霓虹与橱窗灯光，电影感" },
    { id: "travel", label: "旅行风光", text: "知名度不高的自然风光或古镇小巷，旅行随拍感" },
    { id: "party", label: "节日派对", text: "节日派对或晚宴现场，暖色灯串与氛围光" },
    { id: "mall", label: "商场橱窗", text: "高级商场中庭或精品店橱窗前，明亮通透" },
];

export const sceneById = (id: string) => SCENES.find((item) => item.id === id);

// ---------- 服装品类：决定 Agent 关闭时的场景池与穿着方式 ----------
export type TryOnGarmentType = { id: string; label: string; scenes: string[]; wear: string };

export const GARMENT_TYPES: TryOnGarmentType[] = [
    { id: "auto", label: "自动识别", scenes: ["studio-white", "street", "cafe", "home", "office", "park"], wear: "按参考图识别服装类型并按正确方式穿着" },
    { id: "top", label: "上装", scenes: ["street", "cafe", "office", "studio-color", "campus", "home"], wear: "上装：替换模特的上身服装，下装按整体风格自然搭配" },
    { id: "bottom", label: "下装", scenes: ["street", "office", "studio-white", "park", "mall", "campus"], wear: "下装：替换裤子或半身裙，全身或七分身构图让下装完整入镜" },
    { id: "dress", label: "连衣裙", scenes: ["park", "beach", "cafe", "travel", "studio-color", "party"], wear: "连衣裙：替换整身服装，裙长、腰线与裙摆垂坠完整呈现" },
    { id: "set", label: "套装", scenes: ["office", "street", "studio-white", "mall", "cafe", "travel"], wear: "套装：上下装一起替换，成套搭配完整入镜" },
    { id: "outer", label: "外套", scenes: ["street", "night", "office", "travel", "mall", "park"], wear: "外套：穿在内搭外面，可敞开或扣合，展示版型与长度" },
    { id: "sport", label: "运动服", scenes: ["sport", "park", "street", "studio-color", "beach", "campus"], wear: "运动服：贴合身体的运动穿着，动作舒展自然" },
    { id: "lounge", label: "内衣家居", scenes: ["home", "studio-white", "studio-color", "home", "travel", "studio-white"], wear: "家居服 / 内衣：得体的商业展示姿态，构图克制，不暴露、不低俗" },
    { id: "swim", label: "泳装", scenes: ["beach", "travel", "studio-color", "beach", "studio-white", "travel"], wear: "泳装：海边或泳池场景，健康阳光的商业展示，姿态得体" },
    { id: "kids", label: "童装", scenes: ["park", "home", "campus", "studio-white", "studio-color", "travel"], wear: "童装：儿童模特，动作自然安全、符合年龄，不做成人化姿态" },
    { id: "formal", label: "礼服婚纱", scenes: ["party", "studio-color", "mall", "travel", "studio-white", "night"], wear: "礼服 / 婚纱：完整展示裙摆与拖尾，姿态优雅" },
    { id: "ethnic", label: "汉服 · 民族", scenes: ["travel", "studio-color", "park", "travel", "studio-white", "home"], wear: "汉服 / 民族服饰：按传统形制正确穿着，层次、系带与配饰位置准确" },
    { id: "shoes", label: "鞋靴", scenes: ["street", "studio-white", "park", "mall", "sport", "campus"], wear: "鞋靴：穿在模特脚上，构图包含完整鞋款与脚部姿态，鞋面细节清晰" },
    { id: "bag", label: "包袋配饰", scenes: ["street", "cafe", "mall", "travel", "office", "studio-color"], wear: "包袋 / 配饰：由模特背、提、挎或佩戴，商品完整清晰不被遮挡" },
];

export const garmentTypeById = (id: string) => GARMENT_TYPES.find((item) => item.id === id) || GARMENT_TYPES[0];

// ---------- 姿势：文本案例 ----------
export const POSE_EXAMPLES = [
    "自然正面站立",
    "双手叉腰",
    "单手插兜侧身",
    "回眸背影",
    "迈步行走抓拍",
    "倚靠墙面",
    "坐在高脚凳上",
    "席地盘腿而坐",
    "抬手整理头发",
    "双手轻提裙摆",
    "双臂交叉",
    "侧身展示腰线",
    "半蹲街头感",
    "手扶帽檐",
    "低头看向衣角",
    "张开双臂转圈",
];

/** 场景出图时轮换的姿势与机位（Agent 关闭或规划结果不完整时使用）。 */
export const SHOT_ROTATION = [
    { pose: "自然正面站立，重心落在一条腿上，双手自然下垂", camera: "平视全身，35mm 视角" },
    { pose: "四分之三侧身，一只手轻插口袋，看向镜头", camera: "略低机位全身，拉长腿部比例" },
    { pose: "向前迈步的行走抓拍，衣摆自然摆动", camera: "平视七分身，轻微动态模糊背景" },
    { pose: "坐姿，身体微微前倾，双手放在膝上", camera: "平视半身到全身，50mm 视角" },
    { pose: "回头看向镜头，展示服装背面与侧面", camera: "平视全身，背侧 45 度" },
    { pose: "抬手整理头发或衣领，表情放松", camera: "中近景半身，85mm 人像视角" },
    { pose: "倚靠墙面或栏杆，一条腿轻抬", camera: "平视全身，留出环境" },
    { pose: "双臂自然交叉或轻扶腰部，自信站姿", camera: "略低机位七分身" },
];

// ---------- 智能换脸 / 换头 ----------
export const FACE_STYLES = ["自然亲和", "清冷高级", "甜美元气", "知性优雅", "阳光健康", "酷飒个性", "成熟稳重"];

export const HAIRSTYLES = ["随机", "长直发", "大波浪长发", "锁骨发", "鲍勃短发", "精灵短发", "高马尾", "低马尾", "丸子头", "编发", "法式盘发", "齐刘海", "寸头", "背头", "纹理烫", "自然卷"];

export const HAIR_COLORS = ["随机", "自然黑", "深棕", "栗棕", "奶茶色", "亚麻金", "铂金", "银灰", "酒红"];

/** 换脸 / 换头的新面孔差异点：智能匹配时每张取不同的一组。 */
export const FACE_VARIANTS = [
    "鹅蛋脸、自然平眉、柔和下颌",
    "略方的脸型、较浓的眉毛、清晰下颌线",
    "略长的脸型、弧形眉、唇峰清晰",
    "偏圆的脸型、饱满面颊、自然眉峰",
    "颧骨清晰、唇线平缓、单眼皮或内双",
    "宽额头、略圆下巴、眼距自然",
    "高鼻梁、深邃眼窝、薄唇",
    "小巧鼻头、杏仁眼、丰润嘴唇",
];

// ---------- 印花提取 ----------
export type TryOnPrintMode = "motif" | "flat" | "seamless";

export const PRINT_MODES: Array<{ value: TryOnPrintMode; label: string; hint: string }> = [
    { value: "motif", label: "单独图案", hint: "只保留图案本身，背景去掉，输出透明 PNG" },
    { value: "flat", label: "平铺展开", hint: "把整片印花摊平成正面矩形，去掉褶皱和光影" },
    { value: "seamless", label: "四方连续", hint: "做成上下左右都能无缝拼接的循环图案" },
];

export const MAX_TRYON_COUNT = 20;
export const MAX_TRYON_NOTES = 500;
