package ecommerceagent

import "strings"

// A sellingKit is the distilled selling-point playbook of one category, built
// from what top-selling listings of that category commonly show: feature →
// buyer value pairs, the product states a detail page cycles through, and
// detail close-ups. The Agent writes these for the seller's product without
// waiting for the seller to list them; the system marks inferred items for
// the seller to verify before publishing.
type sellingKit struct {
	name, keywords string
	points         []string // "功能｜买家价值"
	states         string   // product states to rotate across pages
	details        string   // close-up subjects
}

var sellingKits = []sellingKit{
	{"奶瓶/学饮杯", "奶瓶|学饮|吸管杯|baby bottle|sippy", []string{"防胀气设计｜减少宝宝吸入空气，喝奶更顺畅", "柔软仿真奶嘴｜贴合吸吮习惯，喝奶更舒适", "双把手训练设计｜宝宝练习自主抓握", "透明瓶身｜一眼看清剩余奶量", "清晰容量刻度｜冲奶用量好掌握", "大容量（按刻度上限）｜满足日常多种饮用需求", "防漏密封瓶盖｜外出携带更安心", "宽口径｜冲奶、清洗更方便", "组合式结构可拆洗｜每个部件都能洗干净", "人体工学握持｜家长和宝宝都好拿"}, "满奶、半瓶、空瓶展示透明度、拆开成奶嘴/瓶盖/瓶身/把手组件、倒置不漏、宝宝双手抱握、外出放进妈咪包、清洗晾干", "奶嘴纹理、把手弧度、刻度线、瓶盖密封圈、宽口径瓶口"},
	{"母婴用品", "母婴|婴儿|宝宝|儿童|baby|kid", []string{"温和亲肤｜呵护宝宝娇嫩肌肤", "安全圆角设计｜减少磕碰", "轻巧便携｜外出随手带", "易清洗｜省时省心", "可爱造型｜宝宝更喜欢"}, "使用中、收纳、外出携带、拆解组件、清洗", "边角圆润处、材质纹理、扣件"},
	{"美妆护肤", "美妆|护肤|面霜|精华|乳液|彩妆|口红|香水|skincare|cosmetic|serum|perfume", []string{"质地轻薄｜上脸好推开不黏腻", "快速吸收｜叠加后续步骤不搓泥", "按压泵头｜用量好控制", "便携小巧｜随身补涂", "清新香调｜使用更愉悦"}, "合盖、开盖、挤出膏体/液体质地、上手涂抹、上脸使用、梳妆台陈列、旅行收纳", "膏体质地、泵头、瓶身纹理、刷头"},
	{"数码3C", "耳机|手机|电脑|键盘|鼠标|音箱|充电|数码|headphone|earphone|phone|laptop|keyboard|speaker|charger", []string{"长续航｜一次充电用更久", "快速连接｜开盖即连", "舒适佩戴｜长时间不累", "清晰音质｜细节听得清", "轻巧便携｜随身好收纳", "触控操作｜轻点即可切换"}, "开盒展示、充电中、佩戴中、桌面使用、折叠收纳、多色并排", "接口、按键、充电触点、耳罩/耳塞、指示灯"},
	{"家电厨具", "家电|电器|电饭煲|空气炸锅|咖啡机|吸尘器|净水器|电热水壶|榨汁|appliance|kettle|vacuum|air fryer", []string{"一键操作｜上手零门槛", "大容量｜一家人够用", "易清洗内胆｜不粘好打理", "安静运行｜不打扰家人", "多档调节｜按需选择"}, "工作中、开盖、取出内胆、操作面板特写、成品展示、收纳", "面板按键、内胆涂层、出风/出水口、把手"},
	{"服装鞋履", "服装|衣服|裙|外套|裤|T恤|鞋|靴|袜|apparel|dress|shoes|sneaker", []string{"亲肤面料｜穿着舒适", "立体剪裁｜修饰身形", "百搭配色｜日常通勤都能穿", "细节做工｜耐穿有质感", "透气设计｜久穿不闷"}, "平铺、上身正面/侧面/背面、动态行走、搭配组合、多色展示", "领口、袖口、面料纹理、走线、鞋底纹路"},
	{"箱包", "行李箱|背包|双肩包|手提包|钱包|luggage|backpack|bag|wallet", []string{"大容量分区｜收纳井井有条", "轻量设计｜背着不累", "耐磨面料｜经久耐用", "顺滑拉链｜开合流畅", "多种背法｜场景随心切换"}, "合起、打开展示内部分区、装满物品、背/提在身上、出行场景", "拉链、内袋、肩带、五金件、轮子"},
	{"食品饮品", "食品|零食|饮料|咖啡|茶|饼干|坚果|food|snack|drink|coffee|tea", []string{"精选原料｜吃得放心", "独立小包装｜随吃随拿", "口感层次｜一口满足", "多种吃法｜冲泡/直食都可以", "便携装｜办公出游都合适"}, "整袋、拆开、倒出、冲泡/装盘、食用中、原料陈列", "食材切面、颗粒质感、包装封口"},
	{"家居日用", "家居|收纳|杯子|水杯|毛巾|床品|灯|台灯|家具|home|cup|mug|lamp|towel", []string{"简约设计｜百搭各种家居风格", "实用收纳｜空间更整洁", "耐用材质｜长久使用", "易打理｜一擦就干净", "人性化细节｜用起来更顺手"}, "空置陈列、使用中、收纳/折叠、多件组合、不同空间摆放", "材质纹理、边角工艺、连接结构"},
	{"宠物用品", "宠物|猫|狗|pet|cat|dog", []string{"宠物爱用｜吸引主子主动靠近", "易清洁｜铲屎官省心", "稳固防翻｜不怕调皮", "安全圆角｜不伤宠物", "适配多种体型｜大小都合适"}, "宠物使用中、空置、清洁拆洗、主人互动、收纳", "接触面、底部防滑、扣件"},
	{"运动户外", "运动|健身|瑜伽|跑步|露营|帐篷|户外|骑行|fitness|yoga|camping|outdoor", []string{"轻量便携｜随身带走", "稳固耐用｜放心使用", "快速收纳｜几秒收好", "人体工学｜使用更省力", "多场景适用｜室内户外都行"}, "收纳状态、展开、使用中动作、户外场景、多件组合", "握把、扣件、面料、支撑结构"},
}

// CategorySellingKit returns the selling-point playbook that best matches the
// product text, or a generic method when no category matches.
func CategorySellingKit(product string) string {
	text := strings.ToLower(product)
	best, bestLen := -1, 0
	for i, kit := range sellingKits {
		for _, word := range strings.Split(kit.keywords, "|") {
			if word != "" && strings.Contains(text, word) && len([]rune(word)) > bestLen {
				best, bestLen = i, len([]rune(word))
			}
		}
	}
	if best < 0 {
		return "【同类爆款卖点库】未匹配到具体品类：先识别品类，再围绕真实设计、操作和场景组织购买利益。没有本商品依据的功能和参数不得从同类商品移植。" + ProductPlanningKnowledge(product)
	}
	kit := sellingKits[best]
	var b strings.Builder
	b.WriteString("【同类爆款卖点库：" + kit.name + "】以下仅是品类购买问题候选，不是本商品事实。只有卖家资料或清晰可辨的商品证据支持时才写进文案，缺少依据改为真实可见设计或场景，不由外观推断材质、性能或内部结构：\n")
	for _, point := range kit.points {
		b.WriteString("- " + point + "\n")
	}
	b.WriteString("【商品状态轮换】九屏的商品状态要轮换，不要每屏都是同一状态：" + kit.states + "。\n")
	b.WriteString("【细节特写对象】" + kit.details + "。")
	return b.String()
}
