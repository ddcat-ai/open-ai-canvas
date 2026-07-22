import type { CSSProperties } from "react";
import { Check, Clapperboard, Palette, Sparkles } from "lucide-react";
import { Modal } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasStylePreset = {
    id: string;
    title: string;
    category: string;
    description: string;
    tags: string[];
    prompt: string;
    imageUrl: string;
};

// 分类按短剧制作语境组织：先看媒介，再看题材与视觉气质，避免用品牌名称代替画风。
const PROJECT_STYLE_SCOPE = "【使用边界】本规范是全项目美术与影像风格基线，用于统一角色资产、服装材质、建筑世界观、色彩语言和成片质感；它不是某张图片或某个镜头的提示词。具体场景内容、构图、景别、机位、运镜、动作、光源位置、天气和单场情绪由剧情与分镜节点决定，不得从本规范机械复制。";

const stylePresets: CanvasStylePreset[] = [
    {
        id: "urban-live-action",
        title: "都市真人短剧",
        category: "真人实拍",
        description: "中性城市色调、真实东亚演员与生活化服化道；统一自然光感、城市材质和克制表演，服务职场与情感题材。",
        tags: ["职场", "情感", "现实生活"],
        prompt: [
            "【项目定位】当代中国都市真人短剧的写实轻电影风格，视觉核心是真实人物、可信生活空间和克制的精致感；全片保持统一的自然肤色、真实材质与现代城市气质，不做影楼写真、广告大片或网红滤镜。",
            "【项目色彩系统】全项目色板使用权重约为 60% 中性白、雾灰、浅木和水泥色，30% 低饱和藏蓝、灰绿和驼色，10% 琥珀、酒红或项目识别色。该比例用于控制角色服装、场景美术和资产库的整体频率，不要求每个画面机械满足；肤色始终保持自然暖中性。",
            "【角色设计系统】统一采用真实东亚骨相与当代年龄感，五官、发型、体型、妆容和职业气质自然稳定；保留皮肤纹理与微表情，不使用统一网红脸、过度磨皮、夸张欧式深邃五官或跨集年龄漂移。",
            "【服饰与材质系统】按职业、收入、季节和性格建立西装、衬衫、针织、风衣及休闲装的角色衣橱，主配色服从项目色板；羊毛、棉、皮革、玻璃、金属和塑料保持真实粗糙度，固定角色的标志服饰与配饰形成可复用资产。",
            "【建筑世界观】统一使用可信的中国当代办公室、公寓、咖啡馆、商场、社区和城市公共空间，建筑尺度、家具系统、中文标识与生活设施符合本地语境；不同地点可有身份差异，但不得跳成欧美城市、空洞样板间或未来科幻空间。",
            "【影像与动态基线】全片采用自然光感、可信实景光源、适中的对比度和写实表演节奏；动态气质克制、稳定、生活化，允许分镜按剧情选择静态观察或运动摄影，但不使用无叙事动机的炫技运动与滥用慢动作。",
            "【资产一致性】为主要角色固定脸型、发型、体型、衣橱编号和常用道具，为主要地点固定空间布局、材质板和标识系统；跨集变化必须由剧情、时间或季节驱动并在角色资产或场景资产版本中留痕。",
            "【全局禁用】禁止欧美人物默认脸、塑料皮肤、强烈青橙滤镜、过饱和霓虹、廉价棚拍、错误中文、建筑地域漂移、服饰随机换色和同一资产在不同节点中改变材质。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/urban-live-action.jpg",
    },
    {
        id: "period-live-action",
        title: "古装 / 年代真人",
        category: "真人实拍",
        description: "先锁定单一历史时期，再统一人物妆发、服装制度、器物与建筑；用低饱和东方色和材质细节建立时代可信度。",
        tags: ["古装", "民国", "历史"],
        prompt: [
            "【项目定位】历史题材真人短剧的写实东方美学。项目启动时必须依据小说从古代王朝、民国或其他年代中锁定一个明确时代子类型，并形成唯一的时代考据基线；全项目人物制度、服化道、器物和建筑只遵循该基线。",
            "【项目色彩系统】全项目色板使用权重约为 55% 米白、黛灰、木褐和土黄，30% 靛青、竹青、暗红和月白，15% 朱砂、鎏金、翡翠或项目身份色。该比例控制服装阵营、建筑材质和道具资产的整体分布；阶层差异通过色彩纯度、织物等级和金属用量表达。",
            "【角色设计系统】统一采用真实东亚骨相、符合时代的妆容与发式，并按年龄、身份、礼制和劳动状态建立差异；角色的冠发、发髻、胡须、伤痕、体态与身份标记固定，不使用现代偶像妆或与时代无关的审美模板。",
            "【服饰与材质系统】古代子类型按襟形、袖型、腰带、冠帽、鞋履和纹样建立制度；民国子类型按旗袍、长衫、学生装、军装和西装建立阶层。丝、麻、纱、锦、皮革、木、玉和金属使用统一材质库，兵器、首饰与器物必须归属明确年代。",
            "【建筑世界观】古代子类型使用中式木构、斗拱、瓦顶、院落、回廊、园林和城镇体系；民国子类型使用石库门、骑楼、公馆、车站、报馆和旧式街道体系。项目只启用所选时代的建筑库，统一木、砖、石、灰泥的年代质感与使用痕迹。",
            "【影像与动态基线】全片保持自然天光、窗纸漫射、烛火与灯笼等时代可信的光感，表演与动作遵循身份礼制和服装重量；动态风格庄重、克制、有真实惯性，具体节奏与调度交由分镜决定。",
            "【资产一致性】建立时代手册、角色衣橱、纹样库、器物库和建筑模块库；同一角色的发饰、衣层与身份纹样不可随机改变，场景修缮、服装污损和身份升级只能依据剧情版本更新。",
            "【全局禁用】禁止朝代混搭、现代拉链与家具、廉价化纤反光、塑料饰品、日式鸟居、欧洲城堡、现代偶像妆、随机花瓣滤镜和未经过时代归属的武器器物。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/period-live-action.jpg",
    },
    {
        id: "suspense-noir",
        title: "悬疑犯罪夜景",
        category: "真人实拍",
        description: "蓝黑低照度基底配少量危险色，统一城市夜景材质、实景光感与心理压迫气质，服务线索和反转题材。",
        tags: ["悬疑", "犯罪", "反转"],
        prompt: [
            "【项目定位】现代中国悬疑犯罪真人短剧的写实暗调体系，以低照度、真实城市纹理和心理压迫作为全片视觉母题；风格服务于信息隐藏与揭示，但任何场景都必须保持人物、环境和关键叙事信息可读。",
            "【项目色彩系统】全项目色板使用权重约为 65% 蓝黑、炭灰和冷水泥色，25% 青绿荧光、脏黄钠灯和冷白屏幕色，10% 暗红、洋红或项目危险色。强调色只承担危险、权力或关键线索的视觉职责，不扩散成全片霓虹效果。",
            "【角色设计系统】统一采用真实东亚人物与自然年龄状态，允许疲惫、细纹、胡茬、伤痕和职业压力留下痕迹；角色脸型、发型、伤痕与精神状态有版本记录，反派通过行为和身份系统塑造，不使用夸张脸谱妆。",
            "【服饰与材质系统】建立深色哑光外套、制服、便装和职业服饰库，通过剪裁、磨损和材质区分身份；证件、通讯设备、档案、监控设备和关键道具使用统一设计语言，避免高反光材质破坏暗调体系。",
            "【建筑世界观】统一使用中国城市中的旧居民楼、楼梯间、地下空间、办公场所、仓储、便利店、街巷和城郊设施，形成潮湿墙面、玻璃、金属、水泥和旧涂层的材质库；不同地点共享同一城市地域与年代信息。",
            "【影像与动态基线】全片保持低调但可读的明暗关系、可解释的城市实景光感与克制的心理张力；动态风格偏观察、跟随和压迫感，具体信息揭示方式由分镜设计，不把霓虹、烟雾或镜头晃动当作悬疑本身。",
            "【资产一致性】为角色建立伤痕与服饰版本，为主要地点建立平面关系、材质板和照明基线，为关键道具建立唯一外观与状态记录；跨集变化必须对应明确剧情事件。",
            "【全局禁用】禁止黑成不可读、赛博朋克灯海、无来源轮廓光、过量烟雾、反派脸谱化、血浆猎奇、错误警务与城市标识、同一地点地域漂移和关键资产随机变形。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/suspense-noir.jpg",
    },
    {
        id: "chinese-2d",
        title: "国漫 2D",
        category: "二维动画",
        description: "半写实国漫人物、矿物东方色与工笔式场景体系；以稳定线稿、清晰剪影和统一二维资产保障跨集一致性。",
        tags: ["古风", "仙侠", "二维"],
        prompt: [
            "【项目定位】东方古风与仙侠题材的半写实国漫 2D 动画体系，统一采用有粗细变化的手绘线稿、赛璐璐角色上色与工笔式环境绘制；全项目保持二维绘画语言，不混入塑料手办、三维渲染或日系萌系模板。",
            "【项目色彩系统】全项目色板使用权重约为 55% 月白、黛青、石青和烟灰，30% 朱砂、靛蓝、竹青和赭石，15% 金色、亮青或项目法术色。该比例用于统筹角色阵营、场景色板和特效资产；每个主要角色固定主色、辅色与识别色。",
            "【角色设计系统】成年角色统一采用约 7 至 8 头身和东方骨相，眼睛比例、脸型、发际线、发束、眉眼与年龄感遵循同一角色设计规范；不同角色依靠剪影、身高差、发型和服饰结构区分，正侧背参考图必须属于同一二维设计。",
            "【服饰与材质系统】汉服、劲装、甲胄、宗门服和法器按身份与阵营形成款式库，固定衣领、袖型、腰封、纹样和配色；丝绸、麻布、金属、玉石通过二维纹理、线条密度和高光形状区分，不使用三维写实材质贴图。",
            "【建筑世界观】统一使用中式木构、斗拱、飞檐、瓦当、廊桥、山门、古城、竹林、云海与东方山水系统，建立可复用的建筑模块和场景色板；世界观内不出现欧洲城堡、日式鸟居或现代城市元素。",
            "【影像与动态基线】全片保持清晰剪影、两至三阶角色明暗、工笔场景层次和适度水墨空气感；动画采用关键姿势明确、有限但准确的二维运动，口型、发丝、衣摆和特效遵循统一动画节奏，具体动作由分镜决定。",
            "【资产一致性】建立角色线稿规范、标准色卡、表情表、服饰拆件、法术色板、建筑模块与特效元素库；任何新资产先匹配线条粗细、上色层级和纹理密度，再进入分镜生产。",
            "【全局禁用】禁止 3D 塑料质感、手办摄影、欧美漫画肌肉模板、幼态大眼、角色随机换脸换发型、服饰纹样漂移、背景风格跳变、法术颜色失控和画面文字水印。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/chinese-2d.jpg",
    },
    {
        id: "ink-narrative",
        title: "水墨叙事",
        category: "风格化动画",
        description: "宣纸留白占主导，以焦墨、淡墨和少量朱砂组织叙事；人物身份靠稳定轮廓、笔法与色点区分，而不是抽象成不可识别墨团。",
        tags: ["水墨", "东方", "情绪"],
        prompt: [
            "【项目定位】以中国水墨画语言构建的叙事动画项目，统一使用宣纸纤维、干湿笔触、飞白、积墨、破墨与轻工笔勾线；全片保持诗意留白和角色可识别性之间的平衡，不把水墨理解成随机滤镜。",
            "【项目色彩系统】全项目色板使用权重约为 70% 宣纸暖白与留白，20% 焦墨、浓墨、淡墨组成的五级灰，10% 朱砂、石青、赭石或项目点色。点色按角色、阵营和关键器物分配固定职责，不在不同资产间随机更换。",
            "【角色设计系统】人物采用稳定头身、脸部勾线、发髻与外轮廓系统，不同角色拥有固定的笔触节奏、轮廓特征和点色；近实远简是统一的绘制层级，但任何简化都不得破坏角色身份。",
            "【服饰与材质系统】长衫、袍服、斗笠、披风、兵器和文房器物通过墨线疏密、干湿变化与有限纹样区分；固定角色的领口、腰带、发饰和关键道具保持明确形状，衣物可融入笔势但不能失去结构。",
            "【建筑世界观】统一建立山水、村落、亭台、院墙、廊桥、舟船和古道的水墨资产库，以中式结构、近实远虚和墨色层级保持世界一致；雾、水、云与纸白共享同一留白规则。",
            "【影像与动态基线】全片通过墨色浓度、纸白、边缘虚实和点色明度表达光感；动态采用轮廓先行、笔势跟随、墨迹自然生长的统一原则，转场语言可来自墨滴、笔锋或留白，具体动作和调度由分镜决定。",
            "【资产一致性】建立角色笔刷、标准墨阶、点色色卡、服饰勾线、建筑结构和自然元素的统一样本；新增资产必须先通过纸张纹理、笔触尺度、灰阶与点色职责检查。",
            "【全局禁用】禁止西式水彩插画、随机泼墨、全屏脏灰、角色五官消失、每个资产笔触风格不同、建筑结构融化、彩色过多、廉价纸纹滤镜和随机生成文字印章。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/ink-narrative.jpg",
    },
    {
        id: "three-d-cartoon",
        title: "3D 卡通短剧",
        category: "三维动画",
        description: "轮廓鲜明的风格化三维人物、柔和材质与明快配色；用可读表情、夸张节奏和稳定资产支撑喜剧、亲子与治愈内容。",
        tags: ["3D", "喜剧", "治愈"],
        prompt: [
            "【项目定位】面向喜剧、亲子与治愈内容的风格化 3D 卡通短剧体系，统一采用简洁造型、清晰剪影、半哑光材质、柔和次表面散射和可读表情；保持动画片质感，不进入廉价塑料玩具或超写实恐怖谷。",
            "【项目色彩系统】全项目色板使用权重约为 50% 暖白、浅木、柔灰和天空色，35% 高识别度角色主色，15% 黄色、珊瑚红、薄荷绿等项目点睛色。颜色按角色、地点和功能分配，始终保证角色资产与环境资产有稳定明度区分。",
            "【角色设计系统】成人统一约 5 至 6 头身，儿童约 3.5 至 4.5 头身，头手可适度夸张但关节结构合理；通过眼鼻嘴比例、发型、体型和剪影建立差异，所有角色共用同一造型语言与表情夸张尺度。",
            "【服饰与材质系统】服装款式与纹样简化为可复用大色块，棉布、针织、牛仔、皮革和金属通过统一粗糙度范围区分；道具采用适度圆润边缘和清晰功能造型，保持同一世界中的比例、材质与细节密度一致。",
            "【建筑世界观】统一使用圆角、简化几何和清晰功能分区构建都市公寓、学校、店铺、办公室、公园或幻想小镇；背景资产细节层级低于角色但功能合理，所有地点遵循同一比例、材质和色彩系统。",
            "【影像与动态基线】全片保持柔和光感、受控高光、干净轮廓和明快节奏；角色运动统一遵循预备动作、挤压拉伸、跟随、缓入缓出和清晰停顿，夸张幅度由项目表演手册约束，具体动作由分镜决定。",
            "【资产一致性】建立标准角色比例、表情表、材质球、服饰色板、道具比例和建筑模块库；所有新资产必须匹配既有圆角半径、粗糙度、色彩纯度和细节等级。",
            "【全局禁用】禁止塑料公仔反光、僵硬 T Pose、所有角色同脸、过大玻璃眼、毛孔级写实皮肤、随机改变头身、背景贴图模糊、穿模、漂浮道具和不属于同一美术体系的写实资产。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/three-d-cartoon.jpg",
    },
    {
        id: "fantasy-3d",
        title: "国风 3D 玄幻",
        category: "三维动画",
        description: "半写实东方人物、可信中式建筑与分层材质构成玄幻世界；法术色受阵营约束，体积光和特效只强化动作与叙事重点。",
        tags: ["玄幻", "法术", "宏大场景"],
        prompt: [
            "【项目定位】东方玄幻题材的半写实 3D 动画短剧体系，统一采用东方角色设计、电影级 PBR 材质、中式幻想建筑和分级法术视觉语言；项目奇观建立在中国美术与建筑逻辑上，不套用西方魔幻世界模板。",
            "【项目色彩系统】全项目色板使用权重约为 55% 黛青、墨黑、冷灰、古铜和云雾白，30% 朱红、靛蓝、青玉、暗金等阵营色，15% 单一高亮能量色。该比例用于宗门、角色、建筑和法术资产的整体规划；每个阵营与角色的能量色具有唯一职责。",
            "【角色设计系统】成年角色统一采用约 7.5 至 8 头身、真实东方骨相与适度理想化五官，皮肤、发丝和眼神遵循同一半写实渲染标准；发冠、发束、身高、体型和身份符号固定，力量等级通过服饰层级与能量规则表达。",
            "【服饰与材质系统】袍服、劲装、甲胄、披风、宗门纹样、发冠与法器构成阵营化资产库；丝绸、锦缎、皮革、金属、玉石和木材使用统一 PBR 标准与粗糙度范围，武器、吊坠和衣层具有稳定结构。",
            "【建筑世界观】统一使用中式木构山门、殿宇、楼阁、城池、洞府、栈道、山水云海和东方祭坛，建立斗拱、屋脊、瓦面、岩石与云雾模块库；所有奇观必须从中式结构演化，不能混入欧洲尖塔、哥特教堂和随机异域拼贴。",
            "【影像与动态基线】全片保持可信体积感、受控特效亮度、真实材质和有重量的动画表现；法术遵循统一的形状语法、粒子密度、能量色和力量分级，角色与环境的运动规律一致，具体战斗动作与调度由分镜决定。",
            "【资产一致性】建立角色三视图、宗门色板、服饰拆件、材质球、武器法器、建筑模块、法术模板和力量等级表；任何升级、受损或换装都作为有因果的资产版本管理。",
            "【全局禁用】禁止欧洲城堡、默认精灵脸、西式板甲混搭、塑料材质、彩虹粒子、全屏过曝特效、法术体系随机变化、角色无因换装换武器和建筑资产跨文化漂移。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/fantasy-3d.jpg",
    },
    {
        id: "real-life-documentary",
        title: "现实生活纪实",
        category: "真人实拍",
        description: "自然灰土色、真实东亚普通人与中国在地生活空间；保留环境痕迹和观察式影像气质，让家庭与社会议题更可信。",
        tags: ["家庭", "成长", "纪实"],
        prompt: [
            "【项目定位】家庭、成长与社会议题的现实生活纪实短剧体系，接近观察式剧情纪录片：真实东亚普通人、真实中国在地空间、自然曝光和适度不完美；全片追求生活证据与人物关系的可信度，不追求广告级精致。",
            "【项目色彩系统】全项目色板使用权重约为 70% 自然灰、米白、旧木、土色和水泥色，20% 当地墙面、家具、植物与公共设施的环境色，10% 衣物、生活用品或项目识别色。色板允许随季节与地区变化，但始终保持低饱和、自然白平衡和在地真实感。",
            "【角色设计系统】选择具有真实年龄、体型、家庭关系和职业痕迹的东亚人物，保留皱纹、晒痕、眼袋、发丝与生活状态；妆发接近日常，家人之间保持可信相似性，不使用网红脸、统一精致妆和不符合生活条件的造型。",
            "【服饰与材质系统】按季节、职业和经济条件建立家居服、工装、校服、普通衬衫、羽绒服与布鞋等衣橱，保留褶皱、磨损和反复使用痕迹；生活用品采用真实品牌中性化设计与合理使用年限，不做崭新陈列品。",
            "【建筑世界观】统一使用中国老小区、城中村、普通住宅、学校、医院、工厂、菜市场、公交站和县城街道，保留线缆、晾晒、污渍、拥挤家具与中文公共标识；项目地点共享明确地域、年代和经济环境。",
            "【影像与动态基线】全片保持自然光感、现场混合色温、适度颗粒与观察式表演，允许真实环境中的停顿、重复和轻微不完美；动态风格朴素、贴近人物，不使用炫技摄影或消费苦难的煽情手法，具体调度由分镜决定。",
            "【资产一致性】建立家庭成员外貌关系、角色衣橱、生活道具使用痕迹、住宅布局、社区设施和地域标识资产库；时间推进造成的磨损、成长和季节变化必须作为连续版本维护。",
            "【全局禁用】禁止商业广告布光、过度磨皮、精致样板房、欧美都市替代中国在地空间、强烈电影滤镜、摆拍式苦难、统一网红脸、无生活痕迹的道具和把纪实误做成低清脏画面。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/real-life.jpg",
    },
];

export function CanvasStylePickerModal({ open, value, onClose, onSelect }: { open: boolean; value?: string; onClose: () => void; onSelect: (preset: CanvasStylePreset) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <Modal open={open} title={null} footer={null} centered width="min(1040px, calc(100vw - 24px))" onCancel={onClose} styles={{ body: { padding: 0 } }}>
            <div className="overflow-hidden rounded-lg" style={{ color: theme.node.text, background: theme.node.panel }}>
                <header className="flex items-center gap-3 border-b px-4 py-4 sm:px-5" style={{ borderColor: theme.node.stroke }}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.activeStroke }}><Palette className="size-4" /></span>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold"><span>选择项目画风</span><span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>短剧视觉预设</span></div>
                        <div className="mt-0.5 truncate text-[11px]" style={{ color: theme.node.muted }}>选中的画风会作为普通风格板节点加入当前画布，后续角色、分镜和视频提示词会复用。</div>
                    </div>
                    <span className="ml-auto hidden items-center gap-1 text-[11px] sm:flex" style={{ color: theme.node.faint }}><Sparkles className="size-3.5" />先选媒介，再做细节</span>
                </header>
                <div className="thin-scrollbar grid max-h-[76vh] grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
                    {stylePresets.map((preset) => {
                        const active = preset.id === value;
                        return (
                            <button key={preset.id} type="button" className="group overflow-hidden rounded-lg border text-left transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2" style={{ background: theme.node.panel, borderColor: active ? theme.node.activeStroke : theme.node.stroke, boxShadow: active ? `0 0 0 1px ${theme.node.activeStroke}` : undefined, "--tw-ring-color": theme.node.activeStroke } as CSSProperties} onClick={() => onSelect(preset)}>
                                <span className="relative block aspect-[16/9] overflow-hidden" style={{ background: theme.canvas.background }}>
                                    <img src={preset.imageUrl} alt={`${preset.title}画风示意`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
                                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2 text-white" style={{ background: "linear-gradient(180deg, transparent, rgba(0,0,0,.72))" }}><span className="text-[10px] font-medium tracking-wide">{preset.category}</span>{active ? <span className="grid size-5 place-items-center rounded-full bg-white text-black"><Check className="size-3.5" /></span> : null}</span>
                                </span>
                                <span className="block p-3">
                                    <span className="flex items-center gap-2"><span className="text-sm font-semibold">{preset.title}</span>{active ? <span className="text-[10px]" style={{ color: theme.node.activeStroke }}>已选择</span> : null}</span>
                                    <span className="mt-1 block text-xs leading-5" style={{ color: theme.node.muted }}>{preset.description}</span>
                                    <span className="mt-2 flex flex-wrap gap-1">{preset.tags.map((tag) => <span key={tag} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>{tag}</span>)}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                <footer className="flex items-center gap-2 border-t px-4 py-3 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.faint }}><Clapperboard className="size-3.5" />图片是风格示意，实际效果取决于模型、角色参考图与分镜提示词。</footer>
            </div>
        </Modal>
    );
}
