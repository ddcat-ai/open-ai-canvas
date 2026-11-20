package ecommerceagent

import (
	"strings"
	"yingce/backend/internal/ecommercecatalog"
)

func init() { StyleLibrary = append(StyleLibrary, productStylePresets()...) }

// ProductDesignProfile describes creative methods, never facts about an SKU.
type ProductDesignProfile struct {
	Key, Category, Subject, Scene, Props, Details, Story string
	Terms, Names, Palette                                []string
}

var ProductDesignProfiles = []ProductDesignProfile{
	{"juicer", "appliance", "榨汁机", "晨光厨房备料台、餐桌倒饮、办公室饮用；只有证实便携且无需插电时安排外出使用", "与卖家确认用途相符的切块鲜果、果汁杯、砧板；水果是场景道具而非随赠配件", "杯盖连接处、可见按键、杯身透光和实际可见刀片；不凭空透视内部", "鲜果与整机开场→准备食材→有依据的搅打操作→果饮质地→杯身细节→倒饮→厨房早餐→已知规格或操作说明→完整产品收束；按实际机型调整，不把搅拌杯当原汁机", []string{"榨汁", "搅拌", "破壁", "juicer", "blender"}, []string{"鲜果黑场", "晨光果饮", "果色实验室", "厨房制作志", "轻食生活刊", "通透器物册"}, []string{"果绿 #A5CD39", "炭黑 #151A13", "奶白 #F4F3E9"}},
	{"beauty", "beauty", "美妆个护", "窗边梳妆台、浴室置物架、日常涂抹动作", "干净镜面、化妆刷、玻璃托盘；原料仅在成分已确认时出现", "包装原文字、可见泵头或刷头、真实质地；不绘制皮肤功效前后对比", "包装识别→已确认用途→真实质地→使用动作→可见细节→梳妆场景→已确认用法→已知规格→系列收束", []string{"美妆", "护肤", "精华", "口红", "香水", "beauty", "serum", "cosmetic"}, []string{"琥珀香氛志", "晨光梳妆", "冷白质地册", "水光静物", "色彩试妆刊", "浴室日常"}, []string{"胭脂 #B96B78", "象牙白 #F8F0E8", "深棕 #49362F"}},
	{"apparel", "apparel", "服饰鞋包", "真实街道穿搭、衣帽间搭配、面料细节棚拍", "与商品定位相符的日常服装与鞋履；搭配单品不暗示包含在订单", "走线、织纹、扣件与可见剪裁；版型和颜色以参考为准", "全身造型→侧面版型→面料近景→动作穿着→搭配→细节→第二环境→已确认尺码→穿搭收束", []string{"服饰", "衣", "裙", "裤", "鞋", "包", "apparel", "fashion", "dress", "shoe"}, []string{"街角穿搭刊", "自然织物志", "剪裁建筑学", "复古衣橱", "运动街拍", "通勤造型册"}, []string{"墨黑 #202020", "纸白 #F6F4EE", "砖红 #AD493E"}},
	{"tech", "tech", "数码产品", "日常工作桌面、真实通勤环境、可见接口操作特写", "电脑、桌垫与收纳物；设备连接和兼容性仅在确认后展示", "可见接口、按键、旋钮和表面工艺；不推测芯片或隐藏零件", "整机识别→已知核心用途→真实操作→可见接口→材质近景→办公→通勤→已确认规格→整机收束", []string{"数码", "耳机", "键盘", "手机", "音箱", "tech", "headphone", "speaker", "keyboard"}, []string{"桌面效率志", "冷光精密册", "都市声景", "暗场金属", "几何交互", "通勤随身刊"}, []string{"钢蓝 #426780", "深灰 #1F252B", "冰白 #EDF4F8"}},
	{"baby", "maternal", "母婴用品", "明亮家庭照护空间、备物台、自然亲子互动", "棉毯、真实尺寸的收纳篮；不摆危险小零件", "可见把手、连接处、刻度和握持部位；不假设材质认证", "完整产品→照护需求→可见设计→成人手部操作→局部细节→家居照护→出行备物→已知规格→陪伴收束", []string{"母婴", "奶瓶", "婴", "baby", "bottle"}, []string{"晨光照护", "奶油成长册", "安心细节志", "亲子生活刊", "彩色陪伴", "外出备物记"}, []string{"奶油 #F7E9D2", "浅蓝 #BCD8E7", "暖棕 #8C6851"}},
	{"food", "food", "食品饮品", "早餐餐桌、真实餐盘、厨房备餐", "与已知食材相符的原料和餐具；不虚构配方", "包装标识、真实食物质地、份量关系；不暗示未经证实的健康功效", "食欲开场→已知口味→质地近景→食用搭配→包装细节→早餐→分享→已知配料规格→餐桌收束", []string{"食品", "饮料", "零食", "茶", "咖啡", "food", "coffee", "snack"}, []string{"食欲暖光", "原料手作志", "早餐生活刊", "复古食堂", "清新茶叙", "分享餐桌"}, []string{"麦黄 #E6C078", "陶土 #B56743", "奶白 #FFF4DF"}},
	{"pet", "pet", "宠物用品", "真实宠物活动区、家居喂养角、户外陪伴", "按动物体型选择道具，不误导适用物种", "可见开口、连接件、触面；人与宠物互动符合真实受力", "产品识别→使用关系→局部设计→居家互动→操作说明→宠物视角→陪伴场景→已知尺寸→整机收束", []string{"宠物", "猫", "狗", "pet", "cat", "dog"}, []string{"萌宠日常刊", "阳光陪伴", "家居共处", "趣味爪印", "自然散步志", "喂养细节册"}, []string{"燕麦 #E4D5B7", "草绿 #839F62", "暖白 #FAF6EB"}},
	{"outdoor", "sport", "运动户外", "真实运动场、城市步道、合适季节的户外环境", "用途相符的运动装备；未经证实不展示浸水、负重或极限条件", "织纹、扣具、握持或佩戴连接处", "用途开场→动作关系→细节→运动情境→操作→户外→日常收纳→已知规格→完整产品收束", []string{"运动", "户外", "健身", "sport", "outdoor", "fitness"}, []string{"山野纪实", "跑道动势", "城市轻运动", "装备机能册", "晨练日常", "岩色探行"}, []string{"岩灰 #515B56", "荧光绿 #C0DC4A", "雾白 #EDF0E7"}},
	{"home", "home", "家居家电", "真实住宅空间、用途对应的台面或地面、日常操作", "与商品尺寸匹配的家居用品，不让布景遮住商品", "可见边缘、连接、面板和表面纹理", "空间全貌→使用问题→可见操作→细节→第二视角→生活场景→收纳关系→已知尺寸→空间收束", []string{"家居", "家电", "沙发", "灯", "桌", "椅", "appliance", "home", "furniture"}, []string{"窗光住宅志", "空间建筑册", "暖木日常", "冷白家务志", "暗场器物", "居家编辑刊"}, []string{"暖灰 #B6ACA0", "木棕 #9B795B", "石白 #F2F0E9"}},
	{"general", "general", "商品", "与已识别用途相符的真实环境，未知用途时使用中性工作台", "少量有明确使用关系的道具，未知时不用道具", "图上清楚可见的轮廓、表面与连接部位", "完整商品→可见设计→真实局部→第二视角→合理操作或陈列→场景→细节→已知信息→完整收束", nil, []string{"自然物件志", "精密静物册", "纸本编辑刊", "日常使用记", "暗场轮廓", "彩色几何册"}, []string{"石白 #F0EEE8", "墨灰 #343A40", "暖橙 #C9895D"}},
}

func ProductDesignFor(category string) ProductDesignProfile {
	match := ecommercecatalog.Resolve(category)
	if match.Node.ID != "na" && match.Node.ID != "" {
		var profile ProductDesignProfile
		for _, p := range append(append([]ProductDesignProfile{}, ProductDesignProfiles...), industryDesignProfiles()...) {
			if p.Key == match.Playbook.DesignKey {
				profile = p
				break
			}
		}
		if profile.Key != "" {
			profile.Subject = match.Node.Name
			profile.Category = match.Group
			profile.Scene = match.Playbook.Scene + "；围绕当前子品类「" + match.Node.Name + "」选用真实环境"
			profile.Details = match.Playbook.Focus
			profile.Story = match.Playbook.Story
			return profile
		}
	}
	category = strings.ToLower(category)
	for _, profile := range ProductDesignProfiles {
		for _, term := range profile.Terms {
			if strings.Contains(category, term) {
				return profile
			}
		}
	}
	return ProductDesignProfiles[len(ProductDesignProfiles)-1]
}

func productStylePresets() []StylePreset {
	var presets []StylePreset
	types := []string{"思源黑体 Heavy 大标题 + 思源黑体 Regular 正文，数字用等宽体", "思源宋体 SemiBold 标题 + 思源黑体 Regular 正文", "窄体粗黑标题 + 常规黑体说明，数字对齐", "复古宋体 Bold 标题 + 黑体正文", "斜体粗黑短标题 + 中黑说明", "思源宋体 Light 标题 + 思源黑体 Medium 正文"}
	layouts := []string{"全幅主视觉与左上大标题，底部短标签", "非对称三七分栏，标题在留白区", "严谨网格与侧栏信息，局部窗口错落", "编辑跨页，大小图交替与纵向导语", "斜切分区与编号步骤，产品不遮挡文字", "大留白居中与细节小窗，短句分层"}
	graphics := []string{"锐角色签与细引线", "细线图标和页码", "方角信息条与编号放大窗", "纸本边框与编辑侧注", "箭头与场景短标签", "细线圆窗与短刻度；刻度只作图形，不暗示测量结果"}
	for _, p := range append(append([]ProductDesignProfile{}, ProductDesignProfiles...), industryDesignProfiles()...) {
		for i, name := range p.Names {
			presets = append(presets, stylePreset(p.Key+"-"+[]string{"hero", "daylight", "grid", "editorial", "action", "object"}[i], "品类专属", name, p.Subject+"专属美术："+p.Scene+"；"+layouts[i], "围绕"+p.Subject+"的实际购买问题安排画面", "lifestyle", []string{name}, p.Palette, types[i], layouts[i], graphics[i], p.Scene+"；道具："+p.Props, []string{"暗场侧逆光，准确还原商品本色", "侧窗柔光与自然接触阴影", "冷白柔光，表面反射受控", "暖日光，适量胶片颗粒", "自然日光，凝固合理动作", "大柔光箱与窄条轮廓光"}[i], p.Story))
		}
	}
	return presets
}

// Four model directions plus these twenty product-adapted options make 24.
func ProductStyleLibrary(category string) []StylePreset {
	p := ProductDesignFor(category)
	var result []StylePreset
	for _, preset := range StyleLibrary {
		if strings.HasPrefix(preset.Key, p.Key+"-") {
			result = append(result, AdaptStylePreset(preset, category))
		}
	}
	preferences := map[string][]string{
		"juicer":  {"nature-organic", "hardcore-proof", "minimal-white", "urban-modern", "sport-power", "magazine-editorial"},
		"beauty":  {"light-luxury", "magazine-editorial", "quiet-healing", "nature-organic", "retro-film", "dopamine-pop"},
		"apparel": {"street-trend", "magazine-editorial", "retro-film", "sport-power", "urban-modern", "y2k"},
		"tech":    {"hardcore-proof", "future-tech", "electro-cyber", "urban-modern", "minimal-white", "street-trend"},
		"baby":    {"warm-companion", "quiet-healing", "hand-drawn", "cute-playful", "minimal-white", "nature-organic"},
		"food":    {"nature-organic", "retro-film", "warm-companion", "dopamine-pop", "guochao", "festival-gift"},
		"pet":     {"cute-playful", "hand-drawn", "warm-companion", "nature-organic", "dopamine-pop", "quiet-healing"},
		"outdoor": {"sport-power", "hardcore-proof", "nature-organic", "street-trend", "urban-modern", "minimal-white"},
		"home":    {"minimal-white", "quiet-healing", "warm-companion", "light-luxury", "nature-organic", "magazine-editorial"},
	}
	seen := map[string]bool{}
	for _, key := range preferences[p.Key] {
		if preset, ok := StylePresetByKey(key); ok {
			result = append(result, AdaptStylePreset(preset, category))
			seen[key] = true
		}
	}
	for _, preset := range StyleLibrary {
		if len(result) == 20 {
			break
		}
		if preset.Group == "品类专属" || seen[preset.Key] {
			continue
		}
		if p.Key != "tech" && (preset.Key == "electro-cyber" || preset.Key == "future-tech") {
			continue
		}
		if p.Key != "apparel" && p.Key != "tech" && preset.Key == "y2k" {
			continue
		}
		result = append(result, AdaptStylePreset(preset, category))
	}
	return result
}

func AdaptStylePreset(preset StylePreset, category string) StylePreset {
	p := ProductDesignFor(category)
	subject := []rune(p.Subject)
	if len(subject) > 10 {
		subject = subject[:10]
	}
	preset.Label = string(subject) + "·" + preset.Label
	preset.Style = p.Subject + "专属场景：" + p.Scene + "；美术语言：" + preset.Visual.Layout
	preset.Why = "面向" + p.Subject + "买家的使用和选购需求"
	preset.Visual.Scene, preset.Visual.Props, preset.Visual.Narrative = p.Scene, p.Props, p.Story
	return preset
}

const HumanPhotographyKnowledge = `【真人商业摄影执行】仅在用途和用户要求需要时出现人物，不强制每屏放模特。按真实目标人群与销售地区选择年龄、体态、穿着与动作；国内平台默认中国本土生活风格，跨境按明确地区选择当地人物，地区优先于平台默认，不能所有市场套同一网红脸或同一欧美脸。每轮重新策划同时改变面貌识别点、妆发与情境，逐张 prompt 具体复述脸型、眉眼鼻唇与本轮角色；同一套人物一致。用户提供人物参考时保留身份和体貌，年龄、脸型与肤色不得被随机选角覆盖。明确要求陈列假人时保持假人材质与结构，不添加真人皮肤。真人呈现真实相机拍摄质感：皮肤保留随年龄与景别可辨的毛孔、细小肤纹、自然色差和局部轻微瑕疵，近景有自然唇纹、细软汗毛与发际碎发；眼周细纹符合年龄，不给儿童加成人皱纹，不用全脸统一噪点假装毛孔，不磨皮美白成蜡像。皮肤高光柔和，亮暗自然过渡；眼神跟随商品或互动对象，瞳孔与眼球高光对应现场光源，眼白牙齿保留自然色泽；表情与五官轻微左右不对称，避免模板大眼尖下巴、玻璃眼珠、瓷娃娃皮肤、塑料高光、复制面孔与僵硬广告笑。优先抓拍操作、侧脸或自然手部互动，35–85mm 真实相机视角，按场景安排侧窗光或大柔光箱与适度景深，克制调色，不美容滤镜、不伪 HDR、不 CG 人偶、不把“8K/完美/超真实”当作摄影方案，中远景不过度锐化。手指数量、关节、指甲、握持受力和产品遮挡关系正确，手掌不穿透杯身；人物、商品、背景光向一致，有真实接触阴影与合理尺度。qualityChecks 必须列出肤质、眼神、手部、接触关系、尺度及市场人设的待验收项，不声称已通过。`

func ProductPlanningKnowledge(category string) string {
	p := ProductDesignFor(category)
	return "【按商品选择叙事，而非固定九屏模板】品类：" + p.Subject + "；可用场景：" + p.Scene + "；道具边界：" + p.Props + "；真实细节：" + p.Details + "；九屏叙事候选：" + p.Story + "。这是候选购买问题与视觉关系，应按已选风格、事实和实际张数重排；不适用的功能/规格屏替换为真实细节或合理场景。\n【字体与信息组件】标题选具体中文字体家族、字重和字号比例，正文选可读黑体；衬线、圆体、窄黑、斜黑随风格选择，不一律粗圆体。九屏统一字体家族，按内容组合步骤轨道、局部引线、原料侧注、规格表、场景标签与留白导语，相邻屏不重复堆四角气泡。规格仅用已确认值，数字含单位，清楚区分整机/包装尺寸；缺失数字不画虚假尺寸线。功能文案直接说明已确认的用途、操作与利益，不能因无用户文案而省略；每页标题+说明+按需的2–4个短卖点，场景页适度留白。\n" + HumanPhotographyKnowledge
}
