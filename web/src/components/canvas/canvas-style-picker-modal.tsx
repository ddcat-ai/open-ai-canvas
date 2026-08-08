import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Copy, Eye, Palette, Pencil, Plus, Search, SlidersHorizontal, Star, Trash2, UserRound } from "lucide-react";
import { App, Button, Input, Modal } from "antd";
import { nanoid } from "nanoid";

import { StyleProfileEditorModal } from "@/components/canvas/style-profile-editor-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import {
    compileCanvasStylePreset,
    customCanvasStylePreset,
    recommendedCanvasStylePresets,
    type CanvasStylePreset,
    type ProjectStyleSelection,
} from "@/lib/canvas/canvas-style-system";
import { createStyleProfile, deleteStyleProfile, listStyleProfiles, setStyleProfileFavorite, touchStyleProfile, updateStyleProfile, type UserStyleProfile } from "@/services/api/style-profiles";
import { useThemeStore } from "@/stores/use-theme-store";

export type { CanvasStylePreset } from "@/lib/canvas/canvas-style-system";

// 分类按短剧制作语境组织：先看媒介，再看题材与视觉气质，避免用品牌名称代替画风。
const PROJECT_STYLE_SCOPE = "【使用边界】本规范是全项目美术与影像风格基线，用于统一角色资产、服装材质、建筑世界观、色彩语言和成片质感；它不是某张图片或某个镜头的提示词。具体场景内容、构图、景别、机位、运镜、动作、光源位置、天气和单场情绪由剧情与分镜节点决定，不得从本规范机械复制。";

const legacyCanvasStylePresets: CanvasStylePreset[] = [
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
        id: "future-tech",
        title: "未来科技",
        category: "科幻实拍",
        description: "洁净白灰空间、精密工业结构与克制冷光构成可信近未来；科技来自功能与材质，不依赖满屏霓虹和悬浮界面。",
        tags: ["科技", "近未来", "硬科幻"],
        prompt: [
            "【项目定位】近未来中国科技题材的写实硬科幻短剧体系，以可推演的技术、清晰功能结构和克制先进感为核心；世界比当下领先约十至三十年，所有设备、服装和空间都必须能解释用途，不使用空泛的科幻装饰。",
            "【项目色彩系统】全项目色板使用权重约为 65% 冷白、浅灰、钛金属和透明材质，25% 石墨黑、深海蓝和低饱和工业色，10% 青绿或电蓝状态指示色。高亮色只用于设备状态、权限和风险提示，不扩散为环境染色。",
            "【角色设计系统】角色保持真实东亚骨相、自然年龄与职业可信度，通过精确剪裁、功能装备和身份识别细节区分科研、工程、医疗、安保与管理角色；义体或可穿戴设备必须符合人体结构并具有明确功能。",
            "【服饰与材质系统】建立模块化工作服、防护服、通勤装和轻型外骨骼体系，统一使用哑光技术织物、钛合金、陶瓷、透明聚合物和精密玻璃；接缝、扣具、传感器与磨损位置必须符合使用逻辑。",
            "【建筑世界观】统一使用可信的中国近未来实验室、数据中心、交通枢纽、智能住宅、先进制造与城市公共设施；空间强调结构、维护通道、导视和设备尺度，科技升级建立在现有城市之上而非凭空替换。",
            "【影像与动态基线】全片保持清晰冷静、低噪点和高材质可读性，光源来自顶灯、工作灯、屏幕与自然天光；动态强调精密操作、机械反馈和空间秩序，具体机位与节奏由分镜决定。",
            "【资产一致性】建立设备型号、接口协议、状态灯职责、角色权限色、服装模块和空间导视手册；同类设备共享结构语言，升级与损坏必须形成可追踪版本。",
            "【全局禁用】禁止无功能全息屏、满屏蓝色 HUD、随机发光线、霓虹城市套壳、塑料太空服、错误机械结构、设备尺寸漂移、英文乱码和把未来科技等同于赛博朋克。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/future-tech.jpg",
    },
    {
        id: "cyberpunk-neon",
        title: "赛博霓虹",
        category: "科幻实拍",
        description: "高密度亚洲夜城、潮湿旧材质与受控霓虹形成技术失衡的近未来；人物身份由义体、阶层服装和企业色区分。",
        tags: ["赛博朋克", "霓虹", "都市夜景"],
        prompt: [
            "【项目定位】亚洲高密度都市中的赛博朋克短剧体系，视觉核心是先进技术与老旧城市并存、企业秩序与街头生活碰撞；霓虹只作为商业、交通与身份系统的一部分，世界必须保留真实生活痕迹。",
            "【项目色彩系统】全项目色板使用权重约为 55% 沥青黑、旧水泥、潮湿金属和烟灰，30% 冷青、脏黄与屏幕白，15% 洋红、警戒红或企业识别色。每种高亮色绑定阵营或功能，避免无差别彩虹霓虹。",
            "【角色设计系统】角色采用真实东亚骨相和明确阶层差异，义眼、接口、义肢与皮下设备遵循统一技术代际；街头角色、企业雇员和执法人员通过剪影、改装程度、磨损与身份标记区分。",
            "【服饰与材质系统】建立机能夹克、防水层、企业制服、旧式工装和改装配件库，统一使用磨损尼龙、橡胶、旧皮革、氧化金属、透明塑料和低亮度电子元件；服装必须可活动、可收纳并符合天气。",
            "【建筑世界观】统一使用高密度亚洲街区、旧楼加建、地下交通、企业塔楼、维修铺、夜市与狭窄居住单元，中文标识与在地设施可信；新技术以加装、覆盖和侵入旧城市的方式出现。",
            "【影像与动态基线】全片保持夜景可读、潮湿反射受控、实景光源有出处，动态兼具街头拥挤感与企业空间秩序；雨、烟和故障只在剧情需要时出现，不能遮盖人物表演与关键信息。",
            "【资产一致性】建立企业标识、街区导视、义体代际、设备接口、角色改装和服装磨损版本；同一地点的招牌、线路与空间关系跨集保持稳定。",
            "【全局禁用】禁止纯装饰霓虹、所有角色都装义体、无来源彩色轮廓光、日文城市替代中国语境、英文乱码、全屏雨雾、过曝招牌、随机机械纹身和未来设备无功能逻辑。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/cyberpunk-neon.jpg",
    },
    {
        id: "retro-hong-kong",
        title: "复古港风",
        category: "年代实拍",
        description: "八九十年代华语都市的胶片色、密集街区与生活化服饰；用钨丝暖光、青绿阴影和真实时代器物建立怀旧感。",
        tags: ["港风", "胶片", "年代都市"],
        prompt: [
            "【项目定位】八十至九十年代华语都市题材的复古港风短剧体系，以真实时代生活、紧凑街区和胶片摄影质感为核心；怀旧来自服化道、空间和人物状态，不靠泛黄滤镜或明星仿妆。",
            "【项目色彩系统】全项目色板使用权重约为 50% 奶油白、旧墙灰、墨绿和木褐，35% 钨丝暖黄、青绿色阴影、牛仔蓝与暗红，15% 招牌红、出租车色或角色识别色。色彩保持胶片宽容度和自然肤色。",
            "【角色设计系统】统一采用真实东亚骨相与明确时代发型、妆容和体态，按职业与阶层建立差异；角色通过眉形、卷发、短发、眼镜、手表与稳定服装剪影识别，不照搬具体明星面孔。",
            "【服饰与材质系统】建立宽肩西装、衬衫、针织、牛仔、风衣、连衣裙和工装衣橱，使用真实棉、羊毛、皮革、涤纶和金属配件；版型、花纹、纽扣、鞋履与随身物件锁定明确年代。",
            "【建筑世界观】统一使用骑楼、旧式住宅、茶餐厅、录像厅、办公室、街市、码头、巴士与密集招牌街道，保留窗机、瓷砖、铁闸、电话和时代交通工具；不得混入智能手机与当代城市家具。",
            "【影像与动态基线】全片使用适度胶片颗粒、柔和高光、钨丝灯与窗外冷光的自然混合，动态保持手持观察和经典剧情片的稳健节奏；具体景别、变焦与运动由分镜决定。",
            "【资产一致性】建立年代器物清单、角色衣橱、招牌字形、交通工具、室内材质和胶片色彩基线；时间推进通过服装、发型与城市更新版本体现。",
            "【全局禁用】禁止一键泛黄滤镜、现代手机与车辆、错误年代品牌、过量霓虹、日系昭和混用、具体明星换脸、影楼旗袍写真、干净到失真的街景和随机繁体乱码。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/retro-hong-kong.jpg",
    },
    {
        id: "clay-stop-motion",
        title: "黏土定格",
        category: "定格动画",
        description: "保留手塑痕迹的黏土角色、微缩布景与逐帧动作；统一模型比例、材料颗粒和灯光尺度，形成温暖可触的手工世界。",
        tags: ["黏土", "定格", "手工质感"],
        prompt: [
            "【项目定位】以手工黏土角色和微缩布景制作的定格动画短剧体系，视觉核心是可触摸的材料、真实模型尺度与逐帧表演；全项目保留适度手塑痕迹，不伪装成光滑三维动画。",
            "【项目色彩系统】全项目色板使用权重约为 55% 陶土、米白、旧木和纸张原色，30% 角色主色与场景功能色，15% 珊瑚红、芥末黄、湖蓝或项目点睛色。颜色带有实体颜料的轻微不均匀感。",
            "【角色设计系统】角色采用统一头身、眼球、嘴型替换与骨架关节规则，通过鼻形、发型、体型和服装剪影区分；指纹、接缝与替换口型可适度保留，但正侧背结构必须一致且可制作。",
            "【服饰与材质系统】衣物使用薄黏土、布料、毛线、纸张与细金属件组合，木、石、玻璃和食物以微缩材料模拟；每种材质保持可辨的颗粒、厚度与手工边缘，避免统一塑料表面。",
            "【建筑世界观】统一使用可搭建的微缩住宅、街道、店铺、自然景观与室内布景，结构受真实模型尺寸、灯具和摄影空间约束；背景与道具遵循同一缩尺和手工制作语言。",
            "【影像与动态基线】全片保持棚内微缩摄影的真实景深、柔和体积光与轻微逐帧节奏，动作强调清晰关键姿势、重量和停顿；不得用运动模糊掩盖定格特征，具体表演由分镜决定。",
            "【资产一致性】建立角色骨架、替换脸、手型、标准色泥、缩尺、布景模块与道具制作表；损坏、换装和表情组件必须按资产版本维护。",
            "【全局禁用】禁止光滑 CGI、塑料玩具反光、真实人类皮肤、模型比例漂移、关节凭空变形、材质尺度错误、过度景深虚化、随机指纹污渍和布景看似无限真实空间。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/clay-stop-motion.jpg",
    },
    {
        id: "black-white-noir",
        title: "黑白默片",
        category: "风格化实拍",
        description: "以黑白灰阶、硬朗光影和克制表演建立无对白也可读的戏剧性；时代质感来自构图、材质与表演，不靠复古滤镜。",
        tags: ["黑白", "默片", "电影感"],
        prompt: [
            "【项目定位】以黑白电影和默片叙事为核心的风格化实拍短剧体系，强调轮廓、构图、肢体表演和视觉隐喻；可有少量时代道具，但不把项目固定为某一历史年代。",
            "【项目色彩系统】全项目使用黑、白和五级中性灰作为主色，允许极少量单色强调作为叙事线索；明暗关系优先服务人物层次与信息可读性，禁止把画面压成一团黑或过度漂白。",
            "【角色设计系统】角色保持真实东亚骨相与明确剪影，妆发和年龄感自然稳定；人物通过帽檐、领型、姿态、手势和光影落点区分，正侧背设定必须在灰阶中仍然清楚。",
            "【服饰与材质系统】服装按角色身份建立黑白灰明度差、纹理密度和轮廓结构，使用羊毛、棉、皮革、金属与玻璃的真实反差；图案不依赖颜色，必须通过材质和明度可辨。",
            "【建筑世界观】统一使用几何清晰、层次明确的城市街道、室内、车站、剧院和工业空间；墙面、玻璃、砖石、金属和雾气都以灰阶材质库控制，不添加无叙事的奇观背景。",
            "【影像与动态基线】使用硬光、侧光、背光和局部高光塑造戏剧性，允许少量胶片颗粒与光晕；表演通过停顿、视线、走位和夸张但可信的肢体传达，具体节奏由分镜决定。",
            "【资产一致性】建立灰阶色卡、角色轮廓、帽饰与道具明度表、光影基线和场景构图规则；同一角色的服装纹理和标志道具在不同曝光下仍需稳定。",
            "【全局禁用】禁止随意套用棕色复古滤镜、画面全黑、现代彩色屏幕抢戏、过度烟雾、夸张舞台妆、无意义鱼眼变形、角色剪影混淆和字幕水印。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/black-white-noir.jpg",
    },
    {
        id: "space-opera",
        title: "太空歌剧",
        category: "科幻动画",
        description: "宏大星际尺度与鲜明阵营服饰结合可信航天结构；用色彩、徽记和材质建立政治与冒险叙事，而不是堆砌宇宙奇观。",
        tags: ["星际", "阵营", "史诗"],
        prompt: [
            "【项目定位】东方叙事语境下的太空歌剧项目，融合星际航行、阵营政治、家族关系与冒险成长；世界观允许宏大奇观，但人物动机、技术限制和空间尺度必须清楚可追踪。",
            "【项目色彩系统】全项目色板使用权重约为 45% 深空黑、冷灰、银白和舱体白，35% 阵营主色与舰队识别色，20% 星云紫、能源蓝或警戒橙作为叙事强调；每个阵营只拥有稳定主色和辅助色。",
            "【角色设计系统】角色采用真实东方骨相或统一动画化比例，通过军衔、阵营徽记、发型、体型和功能装备区分；太空服、驾驶服和礼服必须适配人体活动，角色脸部与身体比例跨视角稳定。",
            "【服饰与材质系统】建立舱内工作服、战术航天服、舰队制服、外交礼服和维修装模块，统一使用复合纤维、陶瓷、金属、透明面罩和软质密封件；接口、扣件、徽记与生命保障装置具有功能逻辑。",
            "【建筑世界观】统一使用环形空间站、舰桥、推进舱、殖民地、轨道电梯和低重力生活区，结构遵循压力舱、维护通道、重力与照明逻辑；奇观服务于文明尺度，不随机拼贴异星建筑。",
            "【影像与动态基线】保持深空黑与舱内工作光的层次，使用克制体积光和可信屏幕反射；动作体现惯性、失重、穿戴装备和空间限制，具体战斗与运镜由分镜决定。",
            "【资产一致性】建立舰船型号、阵营徽记、舱体材质、接口标准、武器尺寸、角色制服和能源颜色版本表；任何舰船升级、损坏与换装都要有剧情原因。",
            "【全局禁用】禁止现实宇航服直接套用、星球大小失真、所有阵营同一颜色、无功能 HUD、魔法与科技规则混杂、舰船结构穿透、角色装备随机变化和版权品牌标识。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/space-opera.jpg",
    },
    {
        id: "comic-pop",
        title: "漫画分镜",
        category: "风格化动画",
        description: "高对比块面、网点纹理与漫画格律构成可读的动作喜剧视觉；夸张来自构图、拟声和姿态，角色资产仍保持连续性。",
        tags: ["漫画", "动作", "高对比"],
        prompt: [
            "【项目定位】面向动作、喜剧与都市冒险的漫画分镜风格，统一使用清晰外轮廓、平涂块面、网点纹理和有节奏的画格感；画面可以夸张，但角色关系、动作方向与空间连续性必须可靠。",
            "【项目色彩系统】全项目以米白、墨黑和中性灰为结构底色，30% 使用高饱和红、黄、蓝或项目主色，10% 使用单一冲击色承担危险、速度或情绪重点；颜色必须形成角色和阵营识别。",
            "【角色设计系统】统一采用稳定头身比例、强轮廓、清晰发型和可重复的表情符号；角色通过剪影、服装块面、姿态和道具区分，夸张表情不得改变基本脸型与身份。",
            "【服饰与材质系统】服饰细节简化成大色块、粗线纹样和少量高光，棉、皮革、金属、牛仔和玻璃通过线条密度与高光形状区分；战斗或动作服装必须兼顾可动性。",
            "【建筑世界观】使用可快速识别的街区、商店、学校、办公室、车站和屋顶等都市空间，背景以几何块面、透视线和有限网点表达；场景不抢角色轮廓，也不使用现实品牌标识。",
            "【影像与动态基线】动作使用速度线、冲击形状、停格姿势和清晰重心，切换节奏由分镜控制；镜头可以模拟画格切分，但不得牺牲表情、手势和动作方向的可读性。",
            "【资产一致性】建立角色标准角度、表情表、线宽、网点密度、拟声字形和动作特效模板；不同镜头共享同一线条、色块与纹理规则。",
            "【全局禁用】禁止写实照片与漫画角色混用、线条粗细随机、所有画面满屏速度线、复杂背景压住人物、拟声文字乱码、角色换脸、四肢结构错误和过度血腥猎奇。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/comic-pop.jpg",
    },
    {
        id: "storybook-fantasy",
        title: "绘本童话",
        category: "插画动画",
        description: "纸张颗粒、柔和色块和手绘边缘构成温暖童话世界；角色表情与轮廓清楚，避免把绘本感做成泛化的柔焦滤镜。",
        tags: ["绘本", "童话", "温暖"],
        prompt: [
            "【项目定位】面向成长、亲子与寓言叙事的绘本童话动画体系，统一使用手绘边缘、纸张颗粒、有限色块和可读角色表情；故事世界可以奇幻，但情绪和人物关系保持温暖、具体且可理解。",
            "【项目色彩系统】全项目色板使用权重约为 55% 纸张暖白、雾蓝、鼠尾草绿和浅木色，30% 角色与场景主色，15% 蜜糖黄、珊瑚红或星光金作为叙事点色；避免所有画面都成为粉彩渐变。",
            "【角色设计系统】角色采用统一绘本头身、圆润但有差异的轮廓和清晰眼鼻嘴比例，通过帽子、发型、耳朵、体型与服装区分；正侧背视图必须保留同一手绘造型特征。",
            "【服饰与材质系统】衣服使用布料、针织、皮革、木扣、纸张和毛线等可触摸材质，纹样简化为少量重复元素；角色标志物件和衣领、袖口、鞋履保持稳定。",
            "【建筑世界观】统一使用村庄、森林、阁楼、车站、河岸、市场与小型城堡等可读场景，建筑结构偏手工搭建和绘本透视；奇幻元素从生活物件变形而来，不做无逻辑异域拼贴。",
            "【影像与动态基线】保持柔和但有方向的光影、纸张纹理和有限动画节奏，动作强调呼吸、重心、眼神与衣摆跟随；具体动作与镜头调度交由分镜决定。",
            "【资产一致性】建立标准色卡、纸张纹理、笔刷边缘、角色比例、表情表、场景模块和魔法点色规则；新资产必须匹配已有线条和颗粒尺度。",
            "【全局禁用】禁止塑料 3D、泛滥柔焦、角色同脸、过度糖果色、阴影方向漂移、复杂文字水印、细节密度失控、随机改发型和把儿童角色做成恐怖谷。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/storybook-fantasy.jpg",
    },
    {
        id: "surreal-dream",
        title: "超现实梦境",
        category: "风格化实拍",
        description: "现实材质与不可能空间并置，以镜像、尺度错位和雾化光线表达梦境；所有超现实变化服务角色心理和叙事线索。",
        tags: ["梦境", "超现实", "心理"],
        prompt: [
            "【项目定位】以现实人物进入不可能空间为核心的超现实梦境短剧体系，梦境不是随机奇观，而是由人物记忆、欲望、恐惧和选择构成的可追踪视觉系统；现实段落与梦境段落必须有明确差异和回返规则。",
            "【项目色彩系统】现实段落使用自然中性灰与低饱和环境色，梦境段落使用 35% 雾白、浅金、冷青和暗紫，15% 固定象征色承载角色心理线索；同一象征色不能在不同角色间随意换义。",
            "【角色设计系统】角色保持真实东亚骨相、年龄与身体比例，梦境只允许在发型、服装、尺度、影子或局部材质上做有规则的变形；正侧背结构必须仍能确认是同一角色。",
            "【服饰与材质系统】现实服装遵循生活逻辑，梦境服装可以通过重复、倒置、透明、过大或过小表达心理，但面料、纽扣、鞋履和标志物件需要保持可追踪变体。",
            "【建筑世界观】统一使用镜像房间、无尽楼梯、漂浮街道、倒置建筑、空旷大厅和雾中自然等空间语法；每种不可能空间绑定一个叙事规则，不把随机生成的城堡和星空堆在一起。",
            "【影像与动态基线】现实使用可信光源和稳定镜头，梦境使用慢速漂浮、镜面反射、尺度变化与非连续转场；特效保持节制，具体梦境动作和节拍由分镜决定。",
            "【资产一致性】建立象征色、梦境规则、角色标志物件、空间变形前后对照、镜面材质和转场语法表；每次变形都能对应剧情节点并可恢复。",
            "【全局禁用】禁止无因由的随机变形、全屏烟雾、过度镜面、所有空间都漂浮、梦境与现实没有区别、角色五官融化、符号含义漂移和用噪点掩盖生成错误。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/surreal-dream.jpg",
    },
    {
        id: "nature-healing",
        title: "自然疗愈",
        category: "真人实拍",
        description: "真实自然光、植物与手作生活构成松弛的在地质感；以季节、声音和微小行动表达疗愈，不做广告式空镜。",
        tags: ["疗愈", "自然", "慢生活"],
        prompt: [
            "【项目定位】面向家庭关系、返乡、成长与情绪修复的自然疗愈真人短剧体系，核心是人物在具体自然环境中的生活行动和关系变化；自然不是装饰背景，而是参与叙事的真实空间。",
            "【项目色彩系统】全项目色板使用权重约为 55% 叶绿、苔藓绿、土色和米白，30% 木材、石头、天空与季节环境色，15% 赭红、芥末黄或人物识别色；保持自然白平衡和季节连续性。",
            "【角色设计系统】角色采用真实东亚面孔、自然年龄与生活状态，保留晒痕、发丝、体态和劳动痕迹；通过衣着层次、动作习惯、发型与随身物件建立差异，不使用商业广告式精致人物。",
            "【服饰与材质系统】建立棉麻、针织、旧牛仔、雨具、工作服、帆布鞋与草帽衣橱，材质保留褶皱、泥土、汗水和使用痕迹；固定角色的外套、包和手作物件形成识别资产。",
            "【建筑世界观】统一使用山村住宅、林间小屋、农场、茶室、河岸、菜园、集市和小城边缘空间，保留木、石、土、旧墙、工具与本地生活设施；建筑应有地域和季节证据。",
            "【影像与动态基线】采用真实日光、阴天漫射、篝火与室内暖灯，允许风、雨、昆虫和环境声进入画面；动态观察人物的微小行动与关系停顿，避免只拍漂亮自然空镜。",
            "【资产一致性】建立季节色卡、植物与农具库、住宅布局、角色衣橱、手作物件和天气连续性记录；季节变化应带来可见但渐进的资产版本。",
            "【全局禁用】禁止商业民宿广告感、过度航拍、饱和滤镜、欧美乡村替代中国在地生活、干净无人的自然空间、人物永远精致、随机换季和把疗愈做成空洞慢镜头。",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/nature-healing.jpg",
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

const legacyStyleUpgrades: Partial<Record<string, ProjectStyleSelection>> = {
    "urban-live-action": { world: "urban", tone: "romantic", medium: "live-action", character: "realistic" },
    "period-live-action": { world: "historical", tone: "epic", medium: "live-action", character: "realistic" },
    "suspense-noir": { world: "suspense", tone: "dark", medium: "live-action", character: "realistic" },
    "chinese-2d": { world: "xianxia", tone: "epic", medium: "2d-guoman", character: "semi-real" },
    "ink-narrative": { world: "xianxia", tone: "healing", medium: "ink", character: "semi-real" },
    "three-d-cartoon": { world: "urban", tone: "light-comedy", medium: "3d-cartoon", character: "stylized" },
    "fantasy-3d": { world: "xianxia", tone: "epic", medium: "3d-anime", character: "semi-real" },
    "future-tech": { world: "science-fiction", tone: "epic", medium: "live-action", character: "realistic" },
    "cyberpunk-neon": { world: "science-fiction", tone: "dark", medium: "live-action", character: "realistic" },
    "space-opera": { world: "science-fiction", tone: "epic", medium: "3d-anime", character: "semi-real" },
    "nature-healing": { world: "pastoral", tone: "healing", medium: "live-action", character: "realistic" },
    "real-life-documentary": { world: "urban", tone: "healing", medium: "live-action", character: "realistic" },
};

const resolvedLegacyCanvasStylePresets = legacyCanvasStylePresets.map((preset) => {
    const upgrade = legacyStyleUpgrades[preset.id];
    if (!upgrade) return preset;
    const compiled = compileCanvasStylePreset(upgrade);
    const upgraded = { ...compiled, id: preset.id, imageUrl: preset.imageUrl };
    return { ...upgraded, profile: createStyleProfileSnapshot({ ...compiled.profile!, presetId: preset.id }) };
});

const resolvableCanvasStylePresets: CanvasStylePreset[] = [...recommendedCanvasStylePresets, ...resolvedLegacyCanvasStylePresets];

// 风格中心不靠重复卡片虚增数量；旧 ID 仍留在解析集合中，保证历史项目可以恢复。
export const canvasStylePresets: CanvasStylePreset[] = resolvableCanvasStylePresets.filter((preset, index, presets) => presets.findIndex((candidate) => candidate.prompt === preset.prompt) === index);

export function resolveCanvasStylePreset(id?: string) {
    return resolvableCanvasStylePresets.find((preset) => preset.id === id) || customCanvasStylePreset(id);
}

export function resolveProjectCanvasStyle(presetId?: string, profileJson?: string | null): CanvasStylePreset | undefined {
    const preset = resolveCanvasStylePreset(presetId);
    const profile = parseStyleProfile(profileJson);
    if (!profile) return preset;
    return {
        id: profile.presetId,
        title: profile.title,
        category: preset?.category || "项目风格包",
        description: profile.description,
        tags: [...profile.tags],
        prompt: profile.prompt,
        imageUrl: profile.coverUrl || preset?.imageUrl || "/short-drama-styles/real-life.jpg",
        selection: preset?.selection,
        profile,
    };
}

const STYLE_FAVORITES_KEY = "canvas:style-library:favorites";
const STYLE_RECENT_KEY = "canvas:style-library:recent";

type StyleCenterTab = "system" | "mine" | "favorites" | "recent";
type SystemStyleLibraryItem = { kind: "system"; preset: CanvasStylePreset };
type UserStyleLibraryItem = { kind: "user"; preset: CanvasStylePreset; entity: UserStyleProfile };
type StyleLibraryItem = SystemStyleLibraryItem | UserStyleLibraryItem;
type StyleEditorState = { profile: StyleProfileSnapshot; entityId?: string };

export function CanvasStylePickerModal({ open, value, currentProfile, startInEditor = false, applying = false, onClose, onSelect }: {
    open: boolean;
    value?: string;
    currentProfile?: StyleProfileSnapshot | null;
    startInEditor?: boolean;
    applying?: boolean;
    onClose: () => void;
    onSelect: (preset: CanvasStylePreset) => void;
}) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [detailPreset, setDetailPreset] = useState<CanvasStylePreset | null>(null);
    const [tab, setTab] = useState<StyleCenterTab>("system");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("全部");
    const [systemFavoriteIds, setSystemFavoriteIds] = useState<string[]>([]);
    const [recentIds, setRecentIds] = useState<string[]>([]);
    const [editor, setEditor] = useState<StyleEditorState | null>(null);
    const profilesQuery = useQuery({ queryKey: ["style-profiles"], queryFn: listStyleProfiles, enabled: open });

    useEffect(() => {
        if (!open) return;
        setTab("system");
        setQuery("");
        setCategory("全部");
        setSystemFavoriteIds(readStyleIds(STYLE_FAVORITES_KEY));
        setRecentIds(readStyleIds(STYLE_RECENT_KEY));
        setEditor(startInEditor && currentProfile?.source !== "user" && currentProfile ? { profile: editableCopy(currentProfile) } : null);
    }, [currentProfile, open, startInEditor]);

    const userItems = useMemo<UserStyleLibraryItem[]>(() => (profilesQuery.data?.profiles || []).flatMap((entity) => {
        const preset = userStylePreset(entity);
        return preset ? [{ kind: "user" as const, preset, entity }] : [];
    }), [profilesQuery.data?.profiles]);
    const systemItems = useMemo<SystemStyleLibraryItem[]>(() => canvasStylePresets.map((preset) => ({ kind: "system", preset })), []);
    const categories = useMemo(() => ["全部", ...Array.from(new Set(canvasStylePresets.map((preset) => preset.category)))], []);

    useEffect(() => {
        if (!open || !startInEditor || !currentProfile || currentProfile.source !== "user" || editor || profilesQuery.isFetching || profilesQuery.isError) return;
        const sourceId = currentProfile.sourceProfileId || currentProfile.presetId;
        const sourceEntity = (profilesQuery.data?.profiles || []).find((profile) => profile.id === sourceId);
        const sourceProfile = sourceEntity ? parseStyleProfile(sourceEntity.profileJson) : null;
        if (sourceEntity && sourceProfile) {
            setEditor({ profile: editableCopy(sourceProfile, sourceEntity.id), entityId: sourceEntity.id });
            return;
        }
        if (profilesQuery.isFetched) setEditor({ profile: editableCopy(currentProfile) });
    }, [currentProfile, editor, open, profilesQuery.data?.profiles, profilesQuery.isError, profilesQuery.isFetched, profilesQuery.isFetching, startInEditor]);

    const visibleItems = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase("zh-CN");
        let source: StyleLibraryItem[] = tab === "system" ? systemItems : tab === "mine" ? userItems : tab === "favorites"
            ? [...systemItems.filter((item) => systemFavoriteIds.includes(item.preset.id)), ...userItems.filter((item) => item.kind === "user" && item.entity.favorite)]
            : [...userItems.filter((item) => item.kind === "user" && item.entity.lastUsedAt).sort((a, b) => String(b.entity.lastUsedAt).localeCompare(String(a.entity.lastUsedAt))), ...recentIds.flatMap((id) => systemItems.filter((item) => item.preset.id === id))];
        if (tab === "system" && category !== "全部") source = source.filter((item) => item.preset.category === category);
        if (keyword) source = source.filter((item) => `${item.preset.title} ${item.preset.category} ${item.preset.description} ${item.preset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(keyword));
        return source;
    }, [category, query, recentIds, systemFavoriteIds, systemItems, tab, userItems]);

    const saveMutation = useMutation({
        mutationFn: ({ profile, apply }: { profile: StyleProfileSnapshot; apply: boolean }) => editor?.entityId
            ? updateStyleProfile(editor.entityId, serializeStyleProfile(profile)).then((result) => ({ ...result, apply }))
            : createStyleProfile(serializeStyleProfile(profile)).then((result) => ({ ...result, apply })),
        onSuccess: async ({ profile, apply }) => {
            await queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
            const preset = userStylePreset(profile);
            setEditor(null);
            setTab("mine");
            message.success("风格已保存到“我的风格”");
            if (apply && preset) selectItem({ kind: "user", preset, entity: profile });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "风格保存失败"),
    });
    const favoriteMutation = useMutation({
        mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => setStyleProfileFavorite(id, favorite),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["style-profiles"] }),
        onError: (error) => message.error(error instanceof Error ? error.message : "收藏状态更新失败"),
    });
    const deleteMutation = useMutation({
        mutationFn: deleteStyleProfile,
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["style-profiles"] }); message.success("风格已删除"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "风格删除失败"),
    });

    function selectItem(item: StyleLibraryItem) {
        if (applying) return;
        const { preset } = item;
        const next = [preset.id, ...recentIds.filter((id) => id !== preset.id)].slice(0, 12);
        setRecentIds(next);
        localStorage.setItem(STYLE_RECENT_KEY, JSON.stringify(next));
        if (item.kind === "user") void touchStyleProfile(item.entity.id).then(() => queryClient.invalidateQueries({ queryKey: ["style-profiles"] })).catch((error) => message.warning(error instanceof Error ? error.message : "最近使用记录更新失败"));
        onSelect(preset);
    }
    function toggleSystemFavorite(presetId: string) {
        const next = systemFavoriteIds.includes(presetId) ? systemFavoriteIds.filter((id) => id !== presetId) : [presetId, ...systemFavoriteIds];
        setSystemFavoriteIds(next);
        localStorage.setItem(STYLE_FAVORITES_KEY, JSON.stringify(next));
    }
    function createNewStyle() {
        setEditor({ profile: blankUserStyle() });
    }
    function copyPreset(preset: CanvasStylePreset) {
        setEditor({ profile: editableCopy(preset.profile || createStyleProfileSnapshot(preset), undefined, `${preset.title} 副本`, preset.imageUrl) });
    }
    function confirmDelete(entity: UserStyleProfile) {
        modal.confirm({ title: `删除“${entity.name}”？`, content: "项目中已经保存的快照不会被删除，但该风格将从“我的风格”中移除。", okText: "删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => deleteMutation.mutateAsync(entity.id) });
    }

    return (
        <>
            <Modal rootClassName="canvas-style-picker-modal" open={open} title={null} footer={null} centered width="min(1240px, calc(100vw - 24px))" onCancel={onClose} styles={{ container: { padding: 0 }, body: { padding: 0 } }}>
                <div className="canvas-style-center-shell flex min-h-0 flex-col overflow-hidden" style={{ color: theme.node.text, background: theme.node.panel }}>
                    <header className="flex min-h-16 flex-col gap-3 border-b px-4 py-3 pr-12 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pr-14" style={{ borderColor: theme.node.stroke }}>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold">风格中心</h2>
                            <p className="mt-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>系统规范 · 个人风格 · 项目快照</p>
                        </div>
                        <div className="flex min-w-0 gap-2 sm:items-center">
                            <Input allowClear className="style-center-search min-w-0 flex-1" prefix={<Search className="size-3.5 text-foreground/35" />} value={query} placeholder="搜索风格、题材或媒介" onChange={(event) => setQuery(event.target.value)} />
                            <Button type="primary" className="shrink-0" icon={<Plus className="size-3.5" />} onClick={createNewStyle}>新建风格</Button>
                        </div>
                    </header>
                    <div className="style-center-workspace grid min-h-0 flex-1">
                        <aside className="style-center-sidebar thin-scrollbar min-h-0 overflow-auto border-b p-2 sm:p-3 lg:border-b-0 lg:border-r" style={{ borderColor: theme.node.stroke }}>
                            <nav className="style-center-primary-nav flex gap-1 lg:flex-col" aria-label="风格中心视图">
                                <StyleCenterNavItem active={tab === "system"} icon={<Palette className="size-3.5" />} label="系统风格" count={systemItems.length} onClick={() => setTab("system")} />
                                <StyleCenterNavItem active={tab === "mine"} icon={<UserRound className="size-3.5" />} label="我的风格" count={userItems.length} onClick={() => setTab("mine")} />
                                <StyleCenterNavItem active={tab === "favorites"} icon={<Star className="size-3.5" />} label="收藏" onClick={() => setTab("favorites")} />
                                <StyleCenterNavItem active={tab === "recent"} icon={<Clock3 className="size-3.5" />} label="最近使用" onClick={() => setTab("recent")} />
                            </nav>
                            {tab === "system" ? (
                                <div className="style-center-category-panel mt-2 border-t pt-2 lg:mt-4 lg:pt-3" style={{ borderColor: theme.node.stroke }}>
                                    <div className="hidden px-2 pb-1.5 text-[var(--fs-tiny)] font-medium lg:block" style={{ color: theme.node.muted }}>分类</div>
                                    <nav className="style-center-category-nav flex gap-1 lg:flex-col" aria-label="系统风格分类">
                                        {categories.map((item) => <button key={item} type="button" aria-current={category === item ? "page" : undefined} className={`style-center-category-item h-9 shrink-0 rounded-md px-2.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 ${category === item ? "is-active font-medium" : ""}`} onClick={() => setCategory(item)}>{item}</button>)}
                                    </nav>
                                </div>
                            ) : null}
                        </aside>
                        <main className="flex min-h-0 min-w-0 flex-col">
                            <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4" style={{ borderColor: theme.node.stroke }}>
                                <div className="min-w-0 truncate text-xs font-medium">{styleCenterViewTitle(tab, category)}</div>
                                <div className="shrink-0 text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>{visibleItems.length} 个风格</div>
                            </div>
                            <div className="style-center-grid thin-scrollbar min-h-0 flex-1 content-start overflow-y-auto p-3 sm:p-4">
                            {visibleItems.map((item) => (
                                <StyleCenterCard
                                    key={`${item.kind}-${item.preset.id}`}
                                    item={item}
                                    active={item.preset.id === value}
                                    applying={applying}
                                    favorite={item.kind === "user" ? item.entity.favorite : systemFavoriteIds.includes(item.preset.id)}
                                    theme={theme}
                                    onApply={() => selectItem(item)}
                                    onDetail={() => setDetailPreset(item.preset)}
                                    onFavorite={() => item.kind === "user" ? favoriteMutation.mutate({ id: item.entity.id, favorite: !item.entity.favorite }) : toggleSystemFavorite(item.preset.id)}
                                    onCopy={() => copyPreset(item.preset)}
                                    onEdit={item.kind === "user" ? () => setEditor({ profile: editableCopy(item.preset.profile!, item.entity.id), entityId: item.entity.id }) : undefined}
                                    onDelete={item.kind === "user" ? () => confirmDelete(item.entity) : undefined}
                                />
                            ))}
                            {!visibleItems.length ? <EmptyStyleCenter tab={tab} loading={profilesQuery.isLoading} failed={profilesQuery.isError} color={theme.node.muted} onCreate={createNewStyle} onBrowse={() => { setTab("system"); setQuery(""); }} /> : null}
                            </div>
                        </main>
                    </div>
                </div>
            </Modal>
            <CanvasStyleDetailModal open={Boolean(detailPreset)} preset={detailPreset} selected={detailPreset?.id === value} onClose={() => setDetailPreset(null)} onSelect={(preset) => { setDetailPreset(null); const item = [...systemItems, ...userItems].find((candidate) => candidate.preset.id === preset.id); if (item) selectItem(item); }} />
            <StyleProfileEditorModal open={Boolean(editor)} initialProfile={editor?.profile || null} saving={saveMutation.isPending} onClose={() => setEditor(null)} onSave={(profile, apply) => saveMutation.mutate({ profile, apply })} />
        </>
    );
}

function readStyleIds(key: string) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 100) : [];
    } catch {
        return [];
    }
}

function StyleCenterCard({ item, active, applying, favorite, theme, onApply, onDetail, onFavorite, onCopy, onEdit, onDelete }: { item: StyleLibraryItem; active: boolean; applying: boolean; favorite: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onApply: () => void; onDetail: () => void; onFavorite: () => void; onCopy: () => void; onEdit?: () => void; onDelete?: () => void }) {
    const { preset } = item;
    return (
        <article className={`style-center-card group flex min-w-0 flex-col overflow-hidden rounded-md border ${active ? "is-active" : ""}`} style={{ background: theme.canvas.background, borderColor: active ? theme.node.activeStroke : theme.node.stroke, boxShadow: active ? `inset 0 0 0 1px ${theme.node.activeStroke}` : undefined }}>
            <div className="relative overflow-hidden border-b" style={{ borderColor: theme.node.stroke }}>
                <button type="button" className="style-center-card-cover block w-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset" style={{ "--tw-ring-color": theme.node.activeStroke } as CSSProperties} onClick={onDetail} aria-label={`查看${preset.title}规范`}>
                    <img src={preset.imageUrl} width="640" height="360" alt={`${preset.title}画风示意`} className="h-full w-full object-cover transition-transform" />
                </button>
                <button type="button" className={`style-center-favorite-action absolute right-2 top-2 grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2 ${favorite ? "is-active" : ""}`} onClick={onFavorite} aria-label={favorite ? "取消收藏" : "收藏"} title={favorite ? "取消收藏" : "收藏"}><Star className="size-3.5" fill={favorite ? "currentColor" : "none"} /></button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-3 pt-3">
                <div className="flex min-w-0 items-center gap-2 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}><span className="truncate">{item.kind === "user" ? "我的风格" : preset.category}</span>{active ? <span className="ml-auto flex shrink-0 items-center gap-1 font-medium" style={{ color: theme.node.activeStroke }}><Check className="size-3" />当前</span> : null}</div>
                <h3 className="mt-1.5 truncate text-sm font-semibold">{preset.title}</h3>
                <p className="mt-1.5 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>{preset.description}</p>
                <div className="mt-2 flex min-h-6 flex-wrap gap-1">{preset.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-foreground/5 px-1.5 py-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{tag}</span>)}</div>
            </div>
            <footer className="mt-2 flex min-h-11 items-center gap-1 border-t px-2" style={{ borderColor: theme.node.stroke }}>
                <IconAction label="查看规范" onClick={onDetail}><Eye className="size-3.5" /></IconAction>
                <IconAction label="复制并编辑" onClick={onCopy}><Copy className="size-3.5" /></IconAction>
                {onEdit ? <IconAction label="编辑风格" onClick={onEdit}><Pencil className="size-3.5" /></IconAction> : null}
                {onDelete ? <IconAction label="删除风格" danger onClick={onDelete}><Trash2 className="size-3.5" /></IconAction> : null}
                <Button type="default" size="small" className={`style-center-apply-button ml-auto ${active ? "is-current" : ""}`} disabled={active || applying} icon={active ? <Check className="size-3.5" /> : <Palette className="size-3.5" />} onClick={onApply}>{active ? "当前" : "应用"}</Button>
            </footer>
        </article>
    );
}

function IconAction({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
    return <button type="button" className={`style-center-icon-action grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2 ${danger ? "is-danger" : ""}`} onClick={onClick} aria-label={label} title={label}>{children}</button>;
}

function StyleCenterNavItem({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
    return <button type="button" aria-current={active ? "page" : undefined} className={`style-center-nav-item flex h-11 min-w-fit items-center gap-2 rounded-md px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 lg:w-full ${active ? "is-active font-medium" : ""}`} onClick={onClick}>{icon}<span className="whitespace-nowrap">{label}</span>{count !== undefined ? <span className="ml-auto tabular-nums opacity-55">{count}</span> : null}</button>;
}

function styleCenterViewTitle(tab: StyleCenterTab, category: string) {
    if (tab === "mine") return "我的风格";
    if (tab === "favorites") return "收藏风格";
    if (tab === "recent") return "最近使用";
    return category === "全部" ? "全部系统风格" : category;
}

function EmptyStyleCenter({ tab, loading, failed, color, onCreate, onBrowse }: { tab: StyleCenterTab; loading: boolean; failed: boolean; color: string; onCreate: () => void; onBrowse: () => void }) {
    return <div className="col-span-full grid min-h-64 place-items-center text-center"><div><Search className="mx-auto size-5" style={{ color }} /><p className="mt-2 text-xs font-medium">{loading ? "正在加载风格库" : failed && tab !== "system" ? "我的风格加载失败，请检查登录状态或后端服务" : tab === "mine" ? "还没有自己的风格" : tab === "favorites" ? "还没有收藏风格" : tab === "recent" ? "还没有使用记录" : "没有匹配的系统风格"}</p><div className="mt-3 flex justify-center gap-2">{tab === "mine" && !failed ? <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreate}>新建风格</Button> : null}<Button size="small" onClick={onBrowse}>浏览系统风格</Button></div></div></div>;
}

function userStylePreset(entity: UserStyleProfile): CanvasStylePreset | null {
    const profile = parseStyleProfile(entity.profileJson);
    if (!profile) return null;
    return { id: profile.presetId, title: profile.title, category: "我的风格", description: profile.description, tags: [...profile.tags], prompt: profile.prompt, imageUrl: profile.coverUrl || entity.coverUrl || "/short-drama-styles/real-life.jpg", profile };
}

function blankUserStyle(): StyleProfileSnapshot {
    return createStyleProfileSnapshot({ presetId: `draft-${nanoid()}`, title: "未命名风格", description: "", tags: [], prompt: "", assets: [], source: "user", revision: 1 });
}

function editableCopy(profile: StyleProfileSnapshot, entityId?: string, title?: string, coverUrl?: string): StyleProfileSnapshot {
    return createStyleProfileSnapshot({ ...profile, presetId: entityId || `draft-${nanoid()}`, sourceProfileId: entityId, title: title || profile.title, coverUrl: profile.coverUrl || coverUrl, source: "user", revision: entityId ? profile.revision : 1 });
}

export function CanvasStyleDetailModal({ open, preset, selected = false, onClose, onSelect }: { open: boolean; preset: CanvasStylePreset | null; selected?: boolean; onClose: () => void; onSelect?: (preset: CanvasStylePreset) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const sections = preset ? parseStyleSections(preset.prompt) : [];
    return (
        <Modal rootClassName="canvas-style-detail-modal" open={open} title={null} footer={null} centered destroyOnHidden width="min(820px, calc(100vw - 24px))" onCancel={onClose} styles={{ container: { padding: 0 }, body: { padding: 0 } }}>
            {preset ? <div className="canvas-style-detail-shell flex flex-col overflow-hidden" style={{ color: theme.node.text, background: theme.node.panel }}>
                <div className="flex h-44 shrink-0 items-center justify-center overflow-hidden border-b sm:h-52" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}>
                    <img src={preset.imageUrl} width="960" height="540" alt={`${preset.title}画风示意`} className="h-full w-full object-contain" style={preset.id === "black-white-noir" ? { filter: "grayscale(1) contrast(1.08)" } : undefined} />
                </div>
                <header className="border-b px-4 py-3 pr-12 sm:px-5 sm:pr-12" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-center gap-2 text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.activeStroke }}><span>{preset.category}</span><span className="flex items-center gap-1" style={{ color: theme.node.muted }}><SlidersHorizontal className="size-3" />{preset.profile?.assets.length ? `${preset.profile.assets.length} 个执行资产` : "Prompt 通用"}</span></div>
                    <h2 className="mt-1 text-base font-semibold">{preset.title}</h2>
                    <p className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>{preset.description}</p>
                </header>
                <div className="grid shrink-0 grid-cols-3 divide-x border-b text-[var(--fs-tiny)]" style={{ borderColor: theme.node.stroke }}>
                    <StyleDetailMetric label="执行方式" value={preset.profile?.assets.length ? "组合资产" : "Prompt 通用"} muted={theme.node.muted} />
                    <StyleDetailMetric label="执行策略" value={preset.profile?.executionPolicy === "strict-assets" ? "严格校验" : "兼容降级"} muted={theme.node.muted} />
                    <StyleDetailMetric label="快照版本" value={`r${preset.profile?.revision || 1}`} muted={theme.node.muted} />
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5">
                    {preset.profile?.assets.length ? <section className="border-b py-3" style={{ borderColor: theme.node.stroke }}><h3 className="text-xs font-semibold">执行资产</h3><div className="mt-2 divide-y" style={{ borderColor: theme.node.stroke }}>{preset.profile.assets.map((asset) => <div key={asset.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0"><span className="block truncate font-medium">{asset.title}</span><span className="mt-0.5 block text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{kindOptionsLabel(asset.kind)} · {asset.provider}</span></span><span className="shrink-0 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{asset.status === "validated" ? "已验证" : asset.status === "unavailable" ? "不可用" : "待验证"}</span></div>)}</div></section> : null}
                    {sections.map((section) => <section key={section.title} className="border-b py-3 last:border-b-0" style={{ borderColor: theme.node.stroke }}><h3 className="text-xs font-semibold">{section.title}</h3><p className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>{section.content}</p></section>)}
                    {preset.profile?.negativePrompt ? <section className="border-b py-3 last:border-b-0" style={{ borderColor: theme.node.stroke }}><h3 className="text-xs font-semibold">全局负面 Prompt</h3><p className="mt-1.5 whitespace-pre-wrap text-xs leading-5" style={{ color: theme.node.muted }}>{preset.profile.negativePrompt}</p></section> : null}
                </div>
                <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-4 py-3 sm:px-5" style={{ borderColor: theme.node.stroke }}><Button onClick={onClose}>关闭</Button>{onSelect ? <Button type="primary" disabled={selected} icon={selected ? <Check className="size-3.5" /> : <Palette className="size-3.5" />} onClick={() => onSelect(preset)}>{selected ? "当前画风" : "选择该画风"}</Button> : null}</footer>
            </div> : null}
        </Modal>
    );
}

function StyleDetailMetric({ label, value, muted }: { label: string; value: string; muted: string }) {
    return <div className="min-w-0 px-3 py-2.5 text-center"><span className="block" style={{ color: muted }}>{label}</span><span className="mt-0.5 block truncate font-medium">{value}</span></div>;
}

function kindOptionsLabel(kind: string) {
    return kind === "lora" ? "LoRA" : kind === "template" ? "图片模板" : kind === "reference" ? "参考图组" : "提示词模块";
}

function parseStyleSections(prompt: string) {
    return prompt.split("\n").map((line) => {
        const match = line.match(/^【([^】]+)】(.*)$/);
        return match ? { title: match[1], content: match[2] } : { title: "补充规范", content: line };
    }).filter((section) => section.content);
}
