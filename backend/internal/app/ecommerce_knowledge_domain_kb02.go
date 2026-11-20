package app

import (
	"encoding/json"
	"yingce/backend/internal/model"
)

// KB02: 营销卖点知识库 - 营销策略、消费心理、卖点提炼方法
// 提供专业的营销框架和卖点策划方法,帮助 Agent 制定有效的营销策略
func kb02MarketingStrategyKnowledge() []model.EcommerceKnowledgeEntry {
	specs := []struct{ id, title, guidance string }{
		{
			"kb02-usp-framework", "USP 独特销售主张框架",
			"USP (Unique Selling Proposition) 是产品在目标市场中与竞品的核心差异点。构建 USP 的三要素：1) 明确的产品利益点 2) 独特性或差异化 3) 对消费者有足够吸引力。应用方法：先识别产品的核心功能或设计特点,再分析目标人群的核心需求,找到两者的最佳交集。注意：USP 必须基于真实的产品特性,不得虚构竞争优势或夸大差异。示例：奶瓶的 USP 可以是'宽口径设计便于清洗',耳机的 USP 可以是'可折叠便携设计'。",
		},
		{
			"kb02-fab-method", "FAB 利益转化法则",
			"FAB = Feature (特征) → Advantage (优势) → Benefit (利益)。将产品特征转化为消费者利益的三步法：Feature 描述产品的客观特性(材质、结构、规格);Advantage 说明这个特性带来的功能优势;Benefit 转化为消费者的实际收益和使用场景。应用示例：特征'316不锈钢内胆' → 优势'耐腐蚀不串味' → 利益'宝宝每次都能喝到纯净奶香'。注意：每个环节必须基于可验证的事实,利益描述要具体到场景,避免空泛的'更好''更高级'等表述。",
		},
		{
			"kb02-aida-formula", "AIDA 注意力漏斗模型",
			"AIDA 是经典的消费者决策路径：Attention (注意) → Interest (兴趣) → Desire (欲望) → Action (行动)。在电商视觉中的应用：首图抓注意(强视觉冲击、清晰商品识别);详情页前段建立兴趣(展示使用场景、可见设计差异);中段激发欲望(真实利益点、解决具体问题);末段促进行动(规格确认、消除疑虑)。注意：每个阶段的内容必须对应真实信息,不得在'欲望'阶段虚构功效或性能承诺。",
		},
		{
			"kb02-pain-point-analysis", "痛点挖掘与解决方案呈现",
			"痛点分析三步法：1) 识别目标用户在使用同类产品时的真实困扰 2) 找到本产品能够解决或改善的具体点 3) 用'问题-解决方案-使用场景'结构呈现。常见痛点类型：功能性痛点(操作不便、效果不佳)、情感性痛点(不安心、不体面)、时间成本痛点(准备麻烦、清洁耗时)。注意：痛点必须真实存在且产品确实能解决,不得制造焦虑或虚构问题;解决方案必须基于产品的实际功能或设计。",
		},
		{
			"kb02-consumer-psychology", "消费心理与购买动机",
			"五大核心购买动机：1) 功能需求(解决实际问题) 2) 情感需求(身份认同、情感满足) 3) 社交需求(送礼、分享) 4) 安全需求(品质保障、售后无忧) 5) 尝鲜需求(新品、流行)。不同品类的主导动机：母婴类以安全需求为主,美妆类情感需求强,3C数码功能需求占主导,服饰类社交和情感需求并重。应用策略：在视觉和文案中同时满足主导动机和次要动机,用真实场景和可见证据支撑心理诉求。",
		},
		{
			"kb02-price-value-perception", "价格感知与价值塑造",
			"价值感知 = 感知利益 / 感知成本。提升价值感的方法：1) 展示高品质细节(材质纹理、工艺精度) 2) 呈现使用场景的丰富性 3) 对比说明(省时间/省空间/更耐用) 4) 附加价值(设计美感、品牌调性)。注意：价值塑造必须基于产品的真实属性,高级感来自设计细节和视觉品质,不得通过虚构材质、夸大工艺或伪造认证来提升价格感知。避免'性价比之王''超值'等绝对化表述。",
		},
		{
			"kb02-trust-building", "信任建立与风险消除",
			"建立信任的五个维度：1) 产品真实展示(多角度、细节、实际尺寸感) 2) 品质证据(可见的材质、工艺) 3) 使用场景可信度(真实环境、自然互动) 4) 信息透明(规格清晰、适用范围明确) 5) 专业呈现(摄影品质、排版规范)。注意：所有信任要素必须基于真实信息,认证标识、检测数据、材质说明必须有确认来源,不得虚构第三方背书或用户评价。",
		},
		{
			"kb02-category-specific-selling-points", "品类专属卖点提炼",
			"不同品类的核心卖点方向：母婴(安全材质、易清洁、符合发育阶段)、数码(操作便利、续航、便携性)、美妆(功效成分、质地、适用肤质)、服饰(版型、面料、搭配性)、家居(空间适配、材质质感、功能性)、食品(原料、口味、新鲜度)。提炼原则：从可见的设计特征出发,结合品类的核心购买关注点,转化为具体的使用利益。避免跨品类复制卖点模板。",
		},
		{
			"kb02-scenario-marketing", "场景化营销策略",
			"场景营销三要素：人物(目标用户画像)、情境(具体使用时刻)、问题解决(产品在该场景的价值)。有效场景的特征：1) 真实可信(日常会遇到) 2) 具体可感(有画面感) 3) 与产品强相关 4) 能唤起情感共鸣。应用方法：为不同的详情页屏幕分配不同场景,通过场景串联产品的多个使用价值。注意：场景必须符合产品的实际用途,不得虚构使用环境或暗示不适用的场景。",
		},
		{
			"kb02-differentiation-strategy", "差异化定位策略",
			"差异化的四个方向：1) 功能差异(独特功能或性能) 2) 设计差异(外观、交互方式) 3) 体验差异(使用便利性、情感体验) 4) 价值观差异(品牌理念、生活方式)。识别差异点的方法：对比同类产品的常见设计,找出本产品在外观、结构或使用方式上的可观察差异。注意：差异化必须基于产品的真实特征,不得通过贬低竞品或虚构优势来建立差异。",
		},
	}

	entries := make([]model.EcommerceKnowledgeEntry, 0, len(specs))
	for _, spec := range specs {
		content, _ := json.Marshal(map[string]string{
			"guidance":    spec.guidance,
			"domain":      "KB02",
			"application": "营销策略制定、卖点提炼、文案策划、消费心理分析",
		})
		entries = append(entries, model.EcommerceKnowledgeEntry{
			ID:              spec.id,
			SourceID:        "meiye-kb02",
			KnowledgeDomain: "KB02",
			KnowledgeType:   "marketing_strategy",
			Title:           spec.title,
			ContentJSON:     string(content),
			Category:        "general",
			TagsJSON:        "[]",
			PlatformsJSON:   "[]",
			LanguagesJSON:   "[]",
			SourceURL:       "builtin://meiyeai/kb02-marketing-strategy",
			Version:         "kb02-v1-20261030",
			TrustLevel:      "first_party",
			ReviewStatus:    "approved",
			License:         "MeiYeAI KB02 Original",
		})
	}
	return entries
}
