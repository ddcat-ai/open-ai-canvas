package ecommerceagent

import "strings"

// Original creative methods, never a source of product specifications.
const CreativeKnowledgeVersion = "meiye-creative-20261101-industry-taxonomy-v6"

// ProductPhotographyKnowledge is the execution standard every direction and
// every shot is measured against; it turns style names into buildable photos.
const ProductPhotographyKnowledge = `【商业摄影执行标准】
商品是第一视觉：主体占画面约 45–70%（细节特写除外），轮廓完整清晰，透视与比例真实，不变形、不加零件、不改 Logo。
布光按专业棚拍逻辑写清：主光（方向、光质：大柔光箱/条灯/窗光/硬光）+ 辅光或反光板（控制暗部）+ 轮廓光（勾边，分离背景）；金属/玻璃/高光塑料用大面积柔光与黑白旗板塑造干净的高光条，织物/木/纸用侧逆光显纹理，透明液体用背光。
空间可信：商品与台面有真实接触阴影和必要的反射，道具与商品的尺度、透视、光向一致，不能像抠图贴在背景上。
镜头语言：主视觉多用 70–100mm 平视或微俯，细节用微距并控制景深，场景用 35–50mm 并保持商品清晰；同一套内景别与机位轮换。
色彩：商品本色准确，白平衡统一；背景与道具色服从风格色板，饱和度克制；后期干净，保留材质细节，不过度锐化、不塑料感、不 HDR 光晕。
道具与场景：只用能说明使用场景或材质气质的少量道具（一般 1–3 件），材质要具体（亚麻、胡桃木、洞石、磨砂亚克力等），不堆砌花草与漂浮物。
避免 AI 痕迹：不出现扭曲文字、乱码 Logo、多余或融化的部件、不合理的手指、重复图案、无来源的光斑与粒子特效。`

const CopyAndTypographyKnowledge = `【商品文案与字体知识】
即使用户只说“生成详情页”，也要主动完成品类识别、购买问题、可见设计证据、使用情境、文案与排版，不把提示词短等同于内容少。
证据分层：卖家明确资料可用于功能/材质/参数文案；商品图清楚可见的结构、纹理、颜色和操作位置可写具体设计说明；图片上的宣传文字单独识别为“参考图宣称”，未经确认的性能数值、材质成分、认证不升格为事实。知识库提供表达方法，不提供当前商品的性能证据。
功能性表达不是硬凑参数：看见按键可说明按键位置与操作区域，看见头梁/耳垫可说明包覆轮廓、调节结构（仅已展示）、贴耳形态；不得由此推断降噪等级、续航、防水或人体工学效果。用“可见结构 → 对应使用动作 → 具体场景”的信息链补足说明。
图中文字要少而准：生图模型渲染长段中文容易出现错字和乱码，成熟品牌详情页也以大图和短文案为主。每屏一条4–10字主题标题、一条8–16字副标题；信息屏最多再加一句不超过24字的说明或2–3个4–8字短标签；主视觉/收束屏只用标题和副标题。文字是可直接印在图片里的成品，不包含“主标题：”“待确认”“以实物为准”等编辑指令。英文按相当阅读量组织，不逐字硬译。用户明确选简洁/无字时服从设置。
一屏回答一个购买问题，标题抓住场景或差异，副标题给证据，标签帮助扫读；相邻屏不用同一种句式，不反复写“细节可见”“轮廓清晰”“高级质感”。不把镜头、布局、风格名称写成消费者文案。高级来自具体、有节奏、有信息，而非堆砌形容词。
先按品类、真实资料和用户目标列出买家需要了解的问题，再把可证明的信息分配到所需张数；不同品类不共用固定屏序。缺少规格、包装或功能证据时换成有依据的外观、局部或适用场景，不为凑数虚构内容。每屏有独立主题和销售目标，避免相邻屏重复。
字体作为美术系统的一部分：科技/机能选窄体或方正几何黑体大标题，正文用清楚的常规黑体；街头选紧凑超粗黑体、错位断行和少量斜体拉丁字；生活类选人文无衬线与宽松行距；母婴选圆润黑体与温和字距；美妆/珠宝选高对比宋体或衬线标题+精细黑体正文；食品选有温度的展示字+清楚的说明；家居选建筑感宋体或人文黑体。目标语言字形必须完整，不使用难读花体做正文。
标题/副标题/标签按约4:2:1的字号层级；整套固定字体气质和字重，逐屏改变标题位置、断行与图文比例。文字放在画面自然留白区，与商品互相避让，完整组件含描边阴影距离四边至少8%，保留约20%–30%干净呼吸空间。
画幅要求：每张是一幅独立成品，full bleed edge-to-edge composition，背景色/场景连续铺满到四边；不得把横向海报放进竖向画布，不得上下黑条、白条、letterbox、pillarbox或模拟相框。参考图若是拼贴/带边框的产品说明板，只提取商品身份，不能复制其边框、拼贴结构或原排版。深色风格允许深色背景，但必须有连续场景/纹理/光线，不能形成上下空黑横条。`

// Families are intentionally separated in palette, set, light and geometry.
// Each category offers more than four so the model picks what fits the product.
func ProductCreativeKnowledge(product, kind string) string {
	categoryCopy, families := productCreativeFamilies(product, kind)
	return "【原创品类创意库 " + CreativeKnowledgeVersion + "】\n" + categoryCopy + "\n【可选的差异化美术家族（挑选彼此反差最大、分别打不同购买动机的四个）】\n" + families + "\n按真实商品的品类、价格带气质和用户约束挑选并改写，各推荐一套完整风格；四套的色温明度、布景类型、标题字形与版式必须拉开反差。若用户明确指定风格或参考，则在用户约束内探索四种明显不同的设计表达，不强行覆盖用户要求。\n" + ProductPhotographyKnowledge + "\n" + CopyAndTypographyKnowledge
}

// CategoryCreativeIndex lists the category copy and art families of several
// categories once, without repeating the shared photography and copy standards.
// Image-only briefs use it before vision has identified the real category.
func CategoryCreativeIndex(kind string, names []string) string {
	var b strings.Builder
	b.WriteString("【品类美术家族候选（观察商品后只采用匹配品类的一行；通用标准见上文，不再重复）】")
	restricted := kind == "white" || kind == "three-view" || kind == "sku"
	for _, name := range names {
		categoryCopy, families := productCreativeFamilies(name, kind)
		if restricted {
			// 受限类型的美术家族对所有品类相同，上文已给出一次。
			b.WriteString("\n- " + categoryCopy)
			continue
		}
		b.WriteString("\n- " + categoryCopy + " 美术家族：" + families)
	}
	return b.String()
}

func productCreativeFamilies(product, kind string) (string, string) {
	category := strings.ToLower(product)
	families := "极简商业棚拍（暖白 #F4F1EC/浅灰 #D9D7D2，无缝背景与几何台座，大柔光箱主光，细黑体，大留白）；自然生活（米白 #EFE8DC/草绿 #7D8B5E，窗光实景与原木台面，人文黑体，舒展留白）；复古编辑（奶油 #EADBC2/砖红 #A44A3F，纸张与旧书桌静物，宋体标题，杂志网格）；暗场质感（墨黑 #151515/香槟 #C9B18A，低调光与条形高光，细衬线，大面积暗部）；撞色波普（珊瑚 #F06B5B/钴蓝 #2350A8，彩色几何布景硬光投影，超粗展示字，大色块）；未来机能（石墨 #2A2D31/冰蓝 #9CC9E0，建筑光影与金属台面，窄黑体，结构线）"
	categoryCopy := "从真实用途、可见设计、接触动作、日常场景组织价值表达。"
	switch {
	case strings.Contains(category, "耳机"), strings.Contains(category, "headphone"), strings.Contains(category, "数码"), strings.Contains(category, "tech"), strings.Contains(category, "键盘"), strings.Contains(category, "手机"):
		families = "极简科技棚拍（冷白 #F2F3F5/石墨 #2B2E33，无缝背景与悬浮倒影，大柔光箱+轮廓光勾边，几何黑体，大留白）；暗场金属质感（墨黑 #0F1012/钛灰 #8A8F96，低调光与条形高光塑造材质，窄黑体，克制细线）；城市通勤（混凝土灰 #9A9790/信号橙 #E8632B，真实街景与地铁站台日光，紧凑黑体，偏轴构图）；日系唱片（暖白 #F1EBE0/木棕 #8A5A3B/酒红 #7B2D34，日光书桌与唱片角，人文黑体搭宋体，安静编辑网格）；潮流穿搭（奶油白 #F4EEE3/橙红 #E4572E/牛仔蓝 #3D5A80，街景与原创穿搭人物，超粗黑体，偏轴杂志拼贴）；赛博朋克（墨黑 #0B0B14/电青 #00E0D0/洋红 #E0218A，雨夜都市与霓虹反光，方正窄黑体，技术网格）；潮酷电音（酸性黄绿 #C6F432/深紫 #2A1048，舞台光束与节奏光轨，压缩展示字，斜切海报）。若禁止人物，穿搭方向改为街头装备静物，仍保留街头场景与排版"
		categoryCopy = "数码：设计轮廓、真实操控区域、可见连接/佩戴结构、通勤/桌边/音乐时刻。用“按自己的节奏出发”等情境句建立动机，用实际头梁、耳垫、按键等观察支撑说明。只有已确认才讲无线、降噪、音质、续航和材料。"
	case strings.Contains(category, "母婴"), strings.Contains(category, "奶瓶"), strings.Contains(category, "maternal"), strings.Contains(category, "baby"):
		families = "奶油亲子（奶油 #F6EBDD/杏色 #E9B98F，真实家庭日光与棉麻床品，圆润黑体，大幅温暖摄影）；纯净安心棚拍（暖白 #FAF8F5/浅雾蓝 #CFDDE6，柔光无缝背景与柔和接触阴影，圆角黑体，大留白）；自然绘本（鼠尾草绿 #A3B18A/原木 #C8A27A，柔和植物与纸张，人文宋体，插画边注）；童趣波普（鹅黄 #F7D154/天蓝 #6EC1E4，原创纸艺几何，粗圆标题，游戏式信息模块）；法式育儿（象牙白 #F5F0E6/海军蓝 #24324A/砖红 #B5523B，克制生活摄影，细衬线标题，经典杂志网格）"
		categoryCopy = "母婴：围绕照护动作、可见刻度/把手/开口与收纳清洗场景写说明；不猜适用月龄、容量、耐温、无毒或安全认证。语气具体温柔，不贩卖焦虑。"
	case strings.Contains(category, "美妆"), strings.Contains(category, "护肤"), strings.Contains(category, "香水"), strings.Contains(category, "beauty"):
		families = "清透水光（冰白 #F3F7F8/浅青 #BFE0E2，透明亚克力与水波焦散光，纤细黑体，通透留白）；洞石静物（米砂 #E3D8C8/陶土 #B4785A，洞石与石膏台座，侧窗硬光投影，高对比宋体，画册式留白）；法式花影（奶油 #F3E6DA/玫瑰 #C9707D，花影投射梳妆场景，高对比宋体，浪漫编辑）；暗调珠光（墨绿 #1D2B25/香槟 #CDB37E，低调静物与条形高光，精细衬线，珠宝式画册）；先锋色妆（柿橙 #E86A33/钴蓝 #2747A6，硬光色块，超粗黑体，前卫错位）"
		categoryCopy = "美妆：包装设计、可见质地、使用仪式和真实梳妆场景；成分、功效、肤质适配、检测数据仅用已确认信息。"
	case strings.Contains(category, "服"), strings.Contains(category, "鞋"), strings.Contains(category, "apparel"), strings.Contains(category, "珠宝"), strings.Contains(category, "包"):
		families = "极简棚拍（暖灰 #D8D3CC/炭黑 #2A2928，无缝背景与大柔光，细黑体，商品与模特大比例）；法式画报（奶油 #F1E7D6/酒红 #7C2E3A，日光建筑外景，宋体标题，疏朗网格）；街头机能（炭黑 #1E1E1E/荧光黄 #E3F034，城市街拍，粗窄黑体，偏轴动势）；复古学院（海军蓝 #22314F/姜黄 #D19A3B，胶片校园，复古衬线，票据拼贴）；先锋秀场（冷白 #F2F2F0/亮红 #D7263D，强光摄影棚，巨幅展示字，极端比例与留白）"
		categoryCopy = "服饰配件：真实版型、可见纹理、轮廓、搭配关系与穿着场景；不猜面料成分、尺码、产地或工艺等级。"
	case strings.Contains(category, "食品"), strings.Contains(category, "咖啡"), strings.Contains(category, "茶"), strings.Contains(category, "food"):
		families = "晨间餐桌（燕麦 #E8DCC6/焦糖 #B07A43，侧窗晨光与亚麻桌布，人文黑体，松弛留白）；暗调食物摄影（深木 #2E241D/铜色 #A9714B，单侧低调光，衬线标题，油画式静物）；新东方（茶绿 #7E8C69/朱砂 #B6402F，中式器物与竹木，现代宋体，疏密对照）；复古食铺（米黄 #EFE1BE/番茄红 #D8432F，纸感静物，复古展示字，招贴网格）；年轻波普（橙 #F28C28/钴蓝 #2350A8，明快棚拍，圆粗字，几何碰撞）"
		categoryCopy = "食品饮品：可见色泽、包装、用餐动作与具体时刻；口味、原料、营养、产地和保质期必须有真实资料。"
	case strings.Contains(category, "家居"), strings.Contains(category, "卫浴"), strings.Contains(category, "马桶"), strings.Contains(category, "home"), strings.Contains(category, "bathroom"), strings.Contains(category, "灯"):
		families = "现代样板间（暖白 #F2EEE8/胡桃 #6B4A33，真实室内空间与自然窗光，人文黑体，建筑感留白）；自然侘寂（米砂 #DCD2C1/橄榄 #7A7A52，窗光与微水泥墙面，人文宋体，呼吸留白）；极简产品棚拍（浅灰 #E4E4E2/石墨 #333333，无缝背景与大柔光，几何黑体，大主体）；中古画册（胡桃 #5C3B28/焦糖 #B9773E，暖调居室，复古衬线，编辑排版）；包豪斯（原色红 #C7372F/黄 #E9B42B/蓝 #23439A，建筑几何，几何黑体，模块网格）"
		categoryCopy = "家居卫浴：真实空间关系、可见外形、收纳/接触/开启等合理动作；尺寸、承重、材质和智能功能仅据已确认信息。"
	}
	if kind == "white" || kind == "three-view" || kind == "sku" {
		families = "当前类型优先保持统一背景、真实商品、尺度与可核对视角；四方向只探索合规光线/阴影/反射/陈列/留白，不添加彩色背景、营销字或情境。"
	}
	return categoryCopy, families
}
