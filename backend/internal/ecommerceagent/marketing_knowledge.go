package ecommerceagent

import "strings"

// Category guidance is a source of questions and creative methods, never
// evidence that the particular product has a material or function.
type marketingProfile struct {
	name, keywords, questions, observations, expression, photography string
}

var marketingProfiles = []marketingProfile{
	{"母婴", "母婴|婴儿|奶瓶|婴幼儿|baby|bottle|feeding", "照护关系、外观识别与日常使用", "可见轮廓、颜色、开口、图案和握持位置", "亲子时刻与照护动作；年龄、容量、材质和安全性须有资料", "柔和家庭窗光、完整主体与可见局部；人物仅在设置允许且动作可信时出现"},
	{"美妆", "美妆|护肤|面霜|精华|彩妆|香水|skincare|cosmetic|beauty|perfume", "包装识别、使用仪式与选购信息", "包装形状、可见标签、颜色和开合轮廓", "围绕日常仪式和包装视觉；成分、肤质适用及功效须有资料", "干净静物与局部标签，控制高光反射；未见内容物不要捏造质地"},
	{"玩具收藏", "玩具|积木|手办|模型|盲盒|公仔|拼图|doll|toy|figure|collectible|puzzle", "玩法展示、尺寸感、收藏陈列与送礼对象", "可见部件、表情、涂装、连接方式和包装文字", "围绕能直接演示的玩法、摆放和收藏场景；年龄、安全、材质、授权与隐藏款概率须有资料", "用手部互动或桌面陈列建立尺度；不添加不存在的配件、角色或包装内容"},
	{"宠物", "宠物|猫|狗|犬|猫咪|狗狗|牵引绳|猫砂|宠物粮|pet|puppy|kitten|dog|cat", "适配对象、使用动作、清洁收纳与人宠关系", "可见开口、扣件、尺寸参照、表面纹理和接触位置", "围绕真实喂养、出行或陪伴场景；适用品种、尺寸、成分、耐咬和安全性须有资料", "产品与宠物的接触关系要自然；宠物体型和配件比例可信，不暗示医疗效果"},
	{"箱包旅行", "行李箱|旅行箱|背包|双肩包|手提包|钱包|行李袋|luggage|suitcase|backpack|handbag|wallet|travel bag", "收纳方式、携带动作、开合细节与出行场景", "可见隔层、拉链、提手、轮组和外部口袋", "围绕实际可见收纳和携带方式；容量、尺寸、承重、防水和登机适配须有资料", "全貌、开合局部与真实出行场景交替；不凭外观推算内部空间"},
	{"珠宝首饰", "珠宝|首饰|项链|耳环|耳饰|戒指|手链|吊坠|jewelry|jewellery|necklace|earring|ring|bracelet", "佩戴比例、搭配场合、细节工艺与礼赠", "可见镶嵌、扣头、链节、表面反光和实际颜色", "围绕佩戴搭配和微距细节；贵金属纯度、宝石种类、镀层及过敏性须有资料", "用干净微距、耳颈手部局部或首饰盒陈列；不虚构宝石等级与材质"},
	{"服装鞋履", "服装|服饰|衣服|裙|外套|裤|鞋|靴|袜|apparel|clothing|fashion|shoes|sneaker|boot", "版型、颜色、搭配、尺码选择与可见细节", "轮廓、印花、缝线、鞋底纹路与外露配件", "围绕穿搭关系与真实造型；面料成分、尺码、脚感和穿着效果须有资料", "整体与局部交替；模特仅在允许时使用，保持实际版型、颜色和图案"},
	{"数码", "耳机|手机|电脑|键盘|数码|headphone|earphone|electronics|tech", "外观辨识、操作位置与使用场景", "可见轮廓、颜色、按键与接口", "围绕看得见的设计及日常场景；续航、降噪、连接方式和性能须有资料", "产品全貌与结构近景交替，控制高光与真实接触阴影"},
	{"家电厨具", "家电|电器|电饭煲|咖啡机|空气净化器|吸尘器|净水器|冰箱|烤箱|电热水壶|appliance|kettle|vacuum cleaner|coffee maker|air fryer", "摆放关系、操作路径、清洁维护与厨房/家务场景", "机身轮廓、可见按键、线缆、开口、附件和可拆部位", "围绕实际可见布局与合理操作；功率、容量、温控、净化效果和功能须有资料", "空间中景与可见操作部位近景交替，不生成内部零件或虚构工作结果"},
	{"家居", "家居|家具|沙发|桌椅|台灯|灯具|卫浴|马桶|furniture|home|lamp|toilet", "外观、空间搭配与可见结构", "轮廓、色彩、纹理与接触部位", "围绕空间氛围和可见设计；尺寸、承重及材料成分须有资料", "可信空间关系和局部纹理，未经提供不要声称准确尺寸"},
	{"食品", "食品|饮料|咖啡|零食|茶|food|drink|coffee|snack", "包装识别、食用场景与已确认信息", "可见包装颜色、形状和标签", "围绕用餐时刻或包装设计；原料、口味、营养及保质期须有资料", "包装主体与真实餐桌场景，未见的食材和内容物不要虚构"},
	{"运动健身", "运动|健身|瑜伽|哑铃|跑步|球拍|护具|骑行|fitness|workout|yoga|dumbbell|running|racket|cycling", "使用动作、收纳携带、训练场景与可见调节方式", "可见握持区、绑带、刻度、纹理和连接位置", "围绕真实训练动作和可见结构；重量、阻力、防护等级、减脂或训练效果须有资料", "通过动作或器材摆放体现用途；不制造危险姿势或保证效果"},
	{"户外露营", "露营|帐篷|营地|登山|徒步|钓鱼|户外|camping|tent|hiking|trekking|fishing|outdoor", "搭建收纳、携带方式、营地场景与使用步骤", "可见扣件、杆件、拉链、收纳包和展开状态", "围绕看得见的搭建与收纳；人数、防水、抗风、承重、续航和防护等级须有资料", "呈现真实环境和可信尺度；不要把晴好场景暗示成全天候能力"},
	{"汽车用品", "汽车|车载|车用|汽车配件|摩托车|骑行|轮胎|车垫|车载支架|车载手机支架|automotive|car accessory|motorcycle|dash cam", "安装位置、适配车型、使用动作与收纳关系", "可见接口、扣具、支架、走线和接触表面", "围绕实际安装位置和驾驶相关场景；适配车型、尺寸、安全、功率和认证须有资料", "场景拍摄不可分散驾驶注意力；不虚构适配范围、安装结果或安全效果"},
	{"工业工具", "工具|电钻|螺丝刀|扳手|钳子|测量仪|焊机|五金|industrial|drill|screwdriver|wrench|pliers|tool", "操作握持、配件清单、使用步骤与收纳", "可见握持区、接口、调节件、刻度和表面处理", "围绕可见操作关系；功率、精度、扭矩、承重、防护和适用材料须有资料", "用清晰工位与安全的手部动作展示；不添加危险演示或未随附配件"},
	{"办公文具", "办公|文具|笔记本|钢笔|文件夹|收纳盒|打印机|office|stationery|notebook|pen|organizer|printer", "桌面使用、分类收纳、书写或整理动作", "可见开合结构、纸张、笔尖、按键和分隔", "围绕具体桌面任务；容量、纸张规格、墨水、防水和兼容性须有资料", "保持桌面干净、物件尺度合理；不凭外观推测设备兼容性"},
	{"园艺植物", "园艺|花盆|种植|园林|肥料|园艺工具|plant|gardening|planter|garden|fertilizer", "种植步骤、摆放空间、季节场景与维护方式", "可见盆体、工具结构、排水口和包装标签", "围绕已知的种植或维护动作；材质、适用植物、养分、效果和安全性须有资料", "用真实植物与比例自然的种植环境；不承诺生长或防虫效果"},
	{"礼赠文创图书", "礼品|礼盒|礼赠|贺卡|文创|手工|书籍|图书|唱片|gift|gift set|handmade|book|vinyl|craft", "送礼对象、开箱顺序、内容组成与收藏展示", "可见包装、印刷、折页、封面和实际随附物", "围绕真实包装与使用/收藏场景；手工制作、限量、授权、礼盒内容和节日时效须有资料", "展示真实可交付内容；不借氛围暗示未包含物品或虚构稀缺"},
}

// MarketingKnowledge returns one relevant profile. When vision has not yet
// identified the category, a compact index helps it choose after observation.
func MarketingKnowledge(product string) string {
	product = strings.ToLower(product)
	bestProfile, bestMatchLength := -1, 0
	for i, p := range marketingProfiles {
		for _, word := range strings.Split(p.keywords, "|") {
			if word != "" && strings.Contains(product, word) && len([]rune(word)) > bestMatchLength {
				bestProfile, bestMatchLength = i, len([]rune(word))
			}
		}
	}
	if bestProfile >= 0 {
		p := marketingProfiles[bestProfile]
		return "【品类营销方法：" + p.name + "】关注问题：" + p.questions + "。先观察：" + p.observations + "。表达方向：" + p.expression + "。摄影：" + p.photography + "。这些只是策划候选，不是该商品事实。"
	}
	return "【品类营销方法索引】先观察商品并识别品类，再从母婴、美妆、玩具收藏、宠物、箱包旅行、珠宝首饰、服装鞋履、数码、家电厨具、家居、食品、运动健身、户外露营、汽车用品、工业工具、办公文具、园艺植物、礼赠文创图书中选择适用的购买问题；未知品类依据可见轮廓、颜色、使用关系和细节策划。品类常识只用于提出问题与创意角度，功能、性能、材质成分、兼容性和参数不得当成事实。"
}
