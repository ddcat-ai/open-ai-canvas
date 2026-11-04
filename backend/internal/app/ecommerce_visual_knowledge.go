package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
)

// Original MeiYeAI visual methods supplement reviewed source entries. They are
// data for creative planning, never product facts or platform policy.
func ecommerceOriginalVisualKnowledge(req EcommerceCreativeDirectionsRequest) []model.EcommerceKnowledgeEntry {
	// KB01-KB10 are database-backed (see ecommerce_knowledge_bootstrap.go) so an
	// administrator can disable or reject them; only request-dependent methods
	// are generated here.
	entries := make([]model.EcommerceKnowledgeEntry, 0, 24)
	specs := []struct{ id, kind, title, tags, guidance string }{
		{
			"meiye-category-baseline", "product_knowledge", "品类、人群与场景识别基线", "品类 人群 场景 卖点", "先从商品图片与用户填写内容提取可观察的品类、目标人群和使用场景,再把确认事实与创意假设分开。推荐方向必须服务真实购买决策；没有证据的参数、功效、认证、评价和承诺进入待确认清单,不得当作商品事实。",
		},
		{
			"meiye-marketing-framework", "marketing_strategy", "USP、FAB 与 AIDA 卖点策划", "USP FAB AIDA 卖点 痛点 动机", "先写独特销售主张,再用功能—优势—利益链解释消费者为什么在当前场景需要它,最后按注意、兴趣、欲望、行动组织页面信息。每个卖点都要标记证据来源；没有确认的性能、功效、认证和售后承诺只能作为创意问题,不得写入成片文案。",
		},
		{
			"meiye-platform-boundary", "platform_rule", "平台适配与合规事实边界", "平台 淘宝 天猫 京东 抖音 Amazon Shopify 合规", "平台尺寸、审核规则和内容限制必须引用带日期的已核实来源；未知规则标记为待确认。主图、详情页和广告图按目标平台分别规划安全边距、文字密度与信息顺序,不能把一个平台的经验描述成所有平台的官方强制要求。",
		},
		{
			"meiye-trend-freshness", "trend", "趋势来源、日期与时效标记", "趋势 热点 季节 节日 流行色 日期 来源", "趋势建议必须带来源和更新时间；没有实时采集结果时明确写成历史参考或创意建议。季节、节日和流行色只影响场景、配色和传播角度,不得改变商品身份,也不能制造不存在的销量、热度或市场排名。",
		},
		{
			"meiye-quality-gate", "quality_rule", "商品真实还原与视觉质检门", "质检 保真 Logo 文字 颜色 比例 版权", "交付前检查外形、Logo、文字可读性、颜色、材质、数量、零件、比例、跨图一致性与版权边界。创新只作用于背景、光线、构图和叙事；不能凭空增加内部结构、功能、参数、认证、品牌承诺或竞品内容。",
		},
		{
			"meiye-product-photography", "photography", "商业产品摄影与材质布光", "棚拍 微距 商业摄影 柔光 轮廓光 材质", "按商品可见材质与页面目标匹配棚拍、微距、柔光、逆光或轮廓光；玻璃、金属、透明和织物分别控制反射、边缘、透光与纹理。先锁定商品颜色、轮廓和文字,再改变机位、景别和背景,避免用光效掩盖真实结构。",
		},
		{
			"meiye-model-angle", "model_casting_pattern", "人物使用与商品多角度摄影", "模特 人物 穿搭 多角度 商品 机位",
			"先以用户商品图锁定可见轮廓、颜色、Logo与结构。人物图只在穿戴、手持或真实使用可帮助理解商品时安排；原创虚拟人物需明确年龄段、造型、姿态、镜头方向与商品接触关系,跨图保持一致,且商品不能被遮挡。白底、规格、SKU与纯细节图保持纯商品。多角度分镜按正面、可见侧面、四分之三视角与真实局部变化；未提供的背面、接口、按钮和内部结构只可作为待确认视觉探索,不能当成商品事实。",
		},
		{
			"meiye-style-system", "visual_style", "潮流穿搭、清新治愈与潮酷电音视觉体系", "潮流穿搭 清新治愈 潮酷电音 毛玻璃 风格",
			"潮流穿搭使用有目的的街景纵深、人物动态、偏轴标题与克制的贴纸图形；清新治愈使用柔和自然光、低饱和色、呼吸留白与轻说明；潮酷电音使用高对比配色、节奏线、斜切版式和短标题。依真实商品与品牌气质选择或融合,固定整套主辅色、背景层次、光线、标题字重、图标笔触和安全边距。磨砂玻璃信息卡只作为层级清楚的文字容器：半透明背景、适度模糊、清楚边缘和足够对比；不能借图标暗示未确认功能。",
		},
		{
			"meiye-copy-layout", "copywriting_pattern", "移动端商业文案与信息版式", "文案 排版 字体 UI素材 背景",
			"每张先确定读者、使用场景、要表达的真实或可见价值,再写短标题、说明及少量标签。标题表达情境或可见差异,不把镜头说明当广告语；说明补足商品与场景关系,客观卖点只采用用户确认的信息。保持手机端可读的字号层级、对齐基线、负空间和商品安全区；图标、线条与装饰仅服务信息导航。多张图轮换英雄图、偏轴留白、左右分栏、局部细节与场景叠字,避免同款模板重复、错字、极小字和空泛的高端词。参考案例的字体气质与结构可以借鉴,其他品牌、价格、认证、性能和原文不得复制。",
		},
		{
			"meiye-ui-components", "layout_pattern", "商品视觉 UI 组件系统", "信息卡 UI 毛玻璃 参数卡 标签 版式",
			"按画面目的选组件而不是套模板：主视觉只用标题与一枚克制标签；可见细节图用引线与局部放大窗；确认规格图用网格参数卡；人物场景图可用边缘磨砂玻璃信息卡承载场景说明。玻璃卡具有半透明表面、细边和足够文字对比,避开商品、面部和手部；不能把未知参数伪装成科技数据。每张改变信息卡数量、位置和形状,但整套使用从真实商品提取的语义色与统一字体层级。",
		},
		{
			"meiye-model-composition", "model_casting_pattern", "按品类选择人物造型与商品关系", "模特 人物 耳机 穿搭 美妆 家居",
			"先决定商品是否需要人物：耳机按真实头戴位置和侧面视角选择生活方式模特；服装以真实版型和自然站姿为主；美妆以可见持握或梳妆动作呈现；家居让人物辅助建立比例而不抢主体。描述年龄段、服装色、发型、动作和机位,模特外观应与目标市场和视觉风格一致。玻璃信息卡与人物错位排列,不能盖住商品。白底图与纯商品图不加人物；不得模仿名人或冒充用户真人。",
		},
		{
			"meiye-copy-variation", "copywriting_pattern", "风格驱动的差异化文案", "文案 潮流 治愈 科技 杂志 生活",
			"潮流风用动作和节奏句,治愈风写具体日常片刻,科技风以已确认事实和可见结构说话,杂志风用观察式标题,轻奢风用克制短句与空间留白。写作前为每张指定不同的读者问题和句式：场景开头、动作开头、细节观察、真实对照或收束句；相邻图片不得重复'让…''把…'等同一模板。标题和说明在语义上互补,不能把镜头说明、构图词或风格名直接当消费者文案；不虚构功效、认证、价格和使用评价。",
		},
		{
			"meiye-state-imagination", "creative_state_method", "可动外观的状态演绎与概念解构", "马桶 坐便器 开盖 翻盖 状态切换 爆炸构图 创意",
			"从用户商品图识别外观上可能活动的部分,为详情页和套图提出闭合、合理开启、使用中、局部特写等不同状态候选。只见闭合马桶时,可以规划盖板打开的视觉提案,不要把上传姿态复制到所有画面；对不可动商品则以场景和机位变化代替。概念爆炸构图只分离已可见的外部轮廓,未知内部结构、隐藏零件、连接方式与功能不得杜撰。所有推演是供筛选的视觉探索,文案只表达真实场景和可见设计,不以推演构成商品事实；白底、SKU与严格保真类型仍遵守其展示边界。",
		},
	}
	byType := map[string]struct{ id, title, guidance string }{
		"white":     {"meiye-type-white", "白底商品图纯净背景", "整张画布使用纯白背景,商品独立清晰,不加场景、道具、人物、装饰文字、虚构标签或彩色光晕。只允许有助于表现真实形体的极轻自然接触阴影；保持完整轮廓、真实颜色与商品图一致。若参考图有场景,只借商品角度和结构,不把场景带入白底。"},
		"single":    {"meiye-type-single", "单图独立叙事", "一张图只传达一个明确视觉重点,优先一个真实商品主视角和一个场景或卖点；不拼贴、不把多张套图强行压入一张。用户指定无文字时不加任何文案；若有文字,标题与说明只基于可见或已确认事实。"},
		"detail":    {"meiye-type-detail", "详情页逐屏连贯叙事", "把详情页当作连续章节：首屏感受、可见差异、真实使用情境、局部结构、已确认规格、收束。按用户提供的信息决定实际屏序,不强制每屏都有卖点；相邻屏统一颜色、字体和视觉母题,同时改变镜头远近、文字密度和构图,避免重复模板。"},
		"set":       {"meiye-type-set", "产品套图多角度分镜", "套图先用主视觉建立商品识别,再以真实可见的角度、局部、场景或包装拆分每张任务。保持同一商品外观和统一色彩/光线系统；不要凭空绘制看不到的背面、内部、接口或未确认材质。"},
		"main":      {"meiye-type-main", "电商主副图层级", "主图保持商品主体清晰、视觉集中；副图负责不同角度、真实细节或场景证据。不要把所有卖点堆到主图,文字与装饰根据平台实际要求及用户指令收敛；平台政策必须以已核实资料为准。"},
		"marketing": {"meiye-type-marketing", "营销物料逐项制作", "按用户选中的物料种类、单项数量和比例逐张设计,不用同一个版式复制全部物料。海报重主视觉和短标题,长图重阅读顺序,社交封面重第一眼辨识,印刷物重安全边距与清晰层级,商务图重信息结构。所有日期、价格、活动权益、平台承诺仅使用用户确认的资料。"},
	}
	// 主副图 (a two-image set of 主图 + 副图) reads the main-image card.
	kind := ecommerceKnowledgeContentType(req)
	if rule, ok := byType[kind]; ok {
		specs = append(specs, struct{ id, kind, title, tags, guidance string }{rule.id, "creation_type_rule", rule.title, kind + " 创作类型", rule.guidance})
	}
	styleText := strings.ToLower(strings.Join([]string{req.Style, req.StylePrompt, req.Instruction}, " "))
	styles := []struct{ id, title, keys, guidance string }{
		{"street", "潮流穿搭", "street youth 潮流 街头 穿搭 ootd", "真实城市纵深、自然人物动态、偏轴粗标题与少量街头贴纸；文案偏短促动作感,避免无依据的性能口号。"},
		{"healing", "清新治愈", "healing 清新 治愈 温柔", "柔和自然光、低饱和配色、疏朗留白、圆润细节；文案描述真实日常片刻,节奏轻而不空泛。"},
		{"electro", "潮酷电音", "electro 电音 潮酷 霓虹 音乐", "高反差双色、节奏线、斜切版式与光影层次；文案用短句和节拍感,不把音质、续航等未证实功能写成事实。"},
		{"glass", "磨砂玻璃", "frosted 毛玻璃 磨砂玻璃 glass 柔光", "半透明信息卡保留可读对比和边缘高光,模糊只用于非商品背景；文案置于清楚的阅读层,商品不能被磨砂效果遮挡。"},
		{"luxury", "克制轻奢", "luxury 轻奢 高级 奢华", "低饱和深浅对比、精确留白、细线与局部金属感,仅当真实材质支持时才表现材质；文案克制且具体,拒绝虚构稀缺或等级。"},
		{"editorial", "编辑杂志", "editorial 杂志 排版", "大标题、清晰网格、图文错位与大幅摄影；文案呈现观察与场景,不复制参考刊物文字。"},
		{"minimal", "极简留白", "white minimal 极简 留白 简约", "单一主视觉、稳定中轴或有意识偏轴、大面积呼吸空间；白底图保持纯白,标题只说一个可证实信息。"},
		{"tech", "参数科技", "future tech 科技 赛博 参数 3c", "结构化信息网格、冷暖点缀和局部微距,参数卡仅展示用户确认的规格；不绘制不存在的内部构造。"},
		{"natural", "自然生活", "nature home lifestyle 自然 生活 户外 环保", "自然侧光、真实材质表面与生活场景,文案强调可见使用过程；环保或可持续表述必须有确认资料。"},
		{"retro", "复古印刷", "retro 复古 胶片 怀旧", "温暖颗粒、有限色盘、印刷式字距与旧海报秩序；旧化只作用于背景,不能改变商品真实外观。"},
		{"sport", "运动动势", "sport 运动 活力 动感", "对角线运动构图、清楚主体与冻结动作的光线；不推断运动性能、防水或耐久能力。"},
		{"cute", "趣味可爱", "cute 可爱 萌 趣味", "圆角图形、明快但受控的色彩、轻量插画点缀；文案亲切有场景,避免把商品拟人化成虚假功能。"},
		{"beauty", "清透美妆", "beauty 美妆 清透 护肤", "透明光感、干净肤色、柔和微距与产品质感；不得宣称未经确认的功效、成分、肤质适配。"},
		{"food", "食欲摄影", "food 美食 餐饮 食物", "真实食物质地、近景层次和暖色自然光；文案描述可见色泽与食用场景,不虚构口味、原料或营养。"},
		{"guochao", "现代国潮", "chinese 国潮 东方 新中式", "把传统色与现代网格、留白相结合；纹样只做背景秩序,商品仍是主视觉。文案借节奏与意象,不冒称产地或文化授权。"},
		{"japanese", "日系日常", "japanese 日系 和风 日杂", "自然散射光、温暖低对比与生活空间的偶然感；排版细小但可读,文案写具体的日常动作。"},
		{"korean", "韩系简净", "korean 韩系 韩风", "柔亮中性色、平整背景和干净人物造型,标题留出呼吸空间；文案轻快自然,不套流行语。"},
		{"industrial", "工业机能", "industrial 机能 工业 硬核", "结构线、技术网格和金属色只表现可见设计；微距展示真实接缝与轮廓,不能编造内部零件。"},
		{"coastal", "海岸度假", "coastal 海岸 海边 度假", "开阔水平线、清透日光、蓝砂色组合和松弛的使用场景；文案写真实场景,不暗示防水或户外等级。"},
		{"studio", "专业棚拍", "studio 棚拍 商拍 摄影棚", "控制主光、边缘光和接触阴影,背景从品牌色中取低饱和变化；不同图片切换机位与景别,保持真实颜色。"},
		{"handmade", "手作温度", "handmade 手作 匠心 手工", "纹理背景、侧逆光与人手接触细节营造温度；若无手工制造依据,文案不得声称手工制作。"},
		{"festive", "节日礼赠", "festival 节日 礼赠 新年", "节日配色与礼赠情绪分层,装饰围绕商品并留出文字空间；价格、限时活动和礼盒内容须有真实资料。"},
		{"commercial", "高级商业摄影", "commercial western 商业 商拍", "用可控主光、准确边缘和清晰商品轮廓建立高品质感；文案以商品在真实场景中的价值为中心,不用空泛形容词替代证据。"},
		{"family", "温暖家庭", "family 母婴 亲子", "柔和日光与真实互动建立亲近感,注意人物年龄、动作与商品用途相符；文案只写已知适用场景,不暗示未确认的安全认证。"},
		{"monochrome", "黑白编辑", "monochrome 黑白 单色", "用明暗关系与网格节奏强化轮廓,若商品颜色是关键属性则保持原色；文案像编辑标题一样简洁而有观察力。"},
		{"paper", "纸张拼贴", "paper 拼贴 纸张", "以纸张层次、裁切边缘和错位网格营造手作排版,商品轮廓与品牌标识保持完整；标题具有动作感但不夸大事实。"},
		{"bold", "撞色潮玩", "bold 撞色 潮玩", "用两到三种高对比色与大面积几何形建立视觉节奏,背景退让商品,标题短而鲜明。"},
		{"macro", "细节微距", "macro 微距 细节", "选择商品图实际可见的纹理和结构做近景,不编造背面、内部、成分或性能；标题指出可观察细节。"},
	}
	for _, style := range styles {
		for _, key := range strings.Fields(style.keys) {
			if strings.Contains(styleText, strings.ToLower(key)) {
				specs = append(specs, struct{ id, kind, title, tags, guidance string }{"meiye-style-" + style.id, "visual_style", style.title, style.keys, style.guidance})
				break
			}
		}
	}
	if strings.TrimSpace(req.StylePrompt) != "" {
		specs = append(specs, struct{ id, kind, title, tags, guidance string }{"meiye-style-custom", "custom_style_method", "自定义风格拆解", "自定义 风格 色彩 字体 光线", "把用户给出的风格描述拆解为色盘、光线、镜头、排版、标题语气与装饰密度,写成跨图一致的设计规则。风格词不代表商品事实,不将参考品牌原文、性能或价格搬入结果。"})
	}
	if req.ReferenceMode == "style" || req.ReferenceMode == "detail" {
		specs = append(specs, struct{ id, kind, title, tags, guidance string }{"meiye-reference-analysis", "reference_method", "长图与风格参考逐段解析", "参考风格 长图 详情页 文案", "先按参考图的实际顺序分段观察版式、颜色、文字密度、镜头与视觉重复规律,再为当前商品重写每段任务。只迁移设计语言和已获准的结构,绝不复制他牌文案、Logo、价格、未经确认的卖点；保留用户商品图的身份与真实细节。"})
	}
	for _, spec := range specs {
		content, _ := json.Marshal(map[string]string{"guidance": spec.guidance, "reviewScope": "original_visual_method_only; not_product_facts_or_platform_policy"})
		tags, _ := json.Marshal(strings.Fields(spec.tags))
		entries = append(entries, model.EcommerceKnowledgeEntry{
			ID: spec.id, SourceID: "meiye-original", KnowledgeDomain: ecommerceKnowledgeDomain(spec.kind, "general"), KnowledgeType: spec.kind, Title: spec.title,
			ContentJSON: string(content), Category: "general", TagsJSON: string(tags),
			PlatformsJSON: "[]", LanguagesJSON: "[]", RegionsJSON: "[]",
			SourceURL: "builtin://meiyeai/ecommerce-knowledge", Version: "builtin-v1",
			TrustLevel: "first_party", ReviewStatus: "approved", License: "MeiYeAI original",
		})
	}
	return entries
}
