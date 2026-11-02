package ecommerceagent

import (
	"fmt"
	"hash/fnv"
	"math/rand/v2"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// DesignPlaybookVersion identifies the design knowledge base that drew a run's
// layouts, UI kit, typography, persona and scenes.
const DesignPlaybookVersion = "meiye-design-playbook-20261031-v1"

// PlatformGuide is the art-direction brief of one marketplace family: how its
// buyers read images, which layouts and UI suit it, what to avoid, and which
// style-library routes fit it.
type PlatformGuide struct {
	Key, Label, Tone, Layout, UIKit, Avoid string
	Routes                                 []string
}

// platformGuides is keyed by family. Labels name the family; PlatformGuideFor
// prefixes the concrete platform name.
var platformGuides = map[string]PlatformGuide{
	"xiaohongshu": {
		Key: "xiaohongshu", Label: "种草笔记",
		Tone:   "像真实用户的生活分享：先给情绪和场景，再给理由；标题口语、有观点，可用清单或对比句式，不喊广告口号。",
		Layout: "3:4 竖版笔记封面感：上部约三分之一放两行大字标题，下部是手机实拍感的生活场景（自然窗光、浅景深）；内页按开箱、前后对比、教程步骤、好物清单组织，一张只讲一件事。",
		UIKit:  "手写批注与箭头、便签纸、圆角贴纸、荧光笔划线、相纸白边与胶带；低饱和胶片色或奶油色调，主色不超过三种。",
		Avoid:  "硬广促销角标、价格爆炸贴、过度精修的棚拍感与密集参数表；不伪造评价、点赞与“亲测有效”。",
		Routes: []string{"安静治愈", "复古胶片", "杂志编辑", "自然有机", "多巴胺撞色", "手绘童趣"},
	},
	"short-video": {
		Key: "short-video", Label: "内容电商",
		Tone:   "停留逻辑优先：第一眼就要有钩子，大字直接说出场景痛点或惊喜点，人物表情与动作要强，节奏像短视频封面。",
		Layout: "粗描边大字钩子横跨画面上部、宽度约占 70% 以上；人物手持或正在使用商品，动作幅度大但自然；用动感斜切、前后对比与局部放大制造爆点，配色高对比高饱和。",
		UIKit:  "爆炸星形贴、粗描边大字、箭头与圈注、速度线与闪光；福利点只写卖家提供的真实赠品或规格。",
		Avoid:  "编造价格、限时、销量与“全网最低”；低清抠图与廉价渐变；大字遮挡商品主体或人物面部。",
		Routes: []string{"痛点对比", "电音赛博", "运动机能", "多巴胺撞色", "潮流街头", "节日礼赠"},
	},
	"shelf": {
		Key: "shelf", Label: "货架电商",
		Tone:   "买家带着需求来比较：首屏一眼看懂“是什么、好在哪、适合谁”，品牌旗舰店质感，信息层级清楚可信。",
		Layout: "首屏卖点总览：品牌主标题 + 商品大图 + 3–4 个图标卖点气泡与引线；后续轮换场景大图、细节放大窗、规格卡与对比分栏；主图商品约占画面 60–70%，详情竖版连续阅读。",
		UIKit:  "统一线宽的图标、卖点气泡、标签条、编号与规格卡；天猫偏品牌留白，京东偏理性参数与对比，淘宝可更生活化。",
		Avoid:  "极限词（最、第一、国家级）；虚构原价、销量与好评；促销角标遮挡商品；深色压抑背景让移动端小图看不清。",
		Routes: []string{"极简留白", "轻奢质感", "硬核实证", "温情陪伴", "国潮新中式", "都市摩登"},
	},
	"pdd": {
		Key: "pdd", Label: "直给性价比",
		Tone:   "买家快速滑动比价：必须一眼看清商品本身、件数与组合，利益点直接上图，不绕弯。",
		Layout: "商品完整放大、背景明亮干净；多件装、多色、多规格用整齐的组合陈列或宫格“一图看全”；件数与规格用大号数字标签；主图少用氛围大片，场景留给副图。",
		UIKit:  "暖红橙利益点徽章、圆角大号数字标签、勾选图标与简洁分栏；粗黑体、强对比。",
		Avoid:  "编造价格、补贴、销量与包邮承诺；暗调与过度留白的奢侈品式画面；借用其他品牌元素。",
		Routes: []string{"痛点对比", "多巴胺撞色", "活力萌趣", "温情陪伴", "节日礼赠"},
	},
	"wholesale": {
		Key: "wholesale", Label: "批发采购",
		Tone:   "买家是店主与采购：看工厂实力、规格齐全、供货稳定与拿样效率，信息要专业可信。",
		Layout: "确有多款时用多 SKU 整齐陈列墙与颜色/规格矩阵，单款用多角度与细节；批量堆叠与装箱实拍、产线或仓储场景；参数表清楚，起订量与阶梯价只写卖家数据。",
		UIKit:  "白底信息卡、表格线框、编号、色卡与简洁线性图标；工业蓝灰或品牌色，装饰极少。",
		Avoid:  "虚构产能、厂房面积、认证与合作品牌；用零售情绪大片替代规格信息。",
		Routes: []string{"硬核实证", "极简留白", "都市摩登", "痛点对比"},
	},
	"vipshop": {
		Key: "vipshop", Label: "品牌特卖",
		Tone:   "正品感与品牌调性优先：画面像品牌官方画册，穿搭与生活方式感强。",
		Layout: "模特穿搭或生活方式大图 + 品牌与系列名 + 精简卖点；确有多色多款时整齐陈列；留白克制，标题字体讲究。",
		UIKit:  "细线框标签、极简图标、编号与品牌色块，不用爆炸贴。",
		Avoid:  "虚构折扣力度、原价与限时；低质感拼贴与杂乱背景。",
		Routes: []string{"轻奢质感", "杂志编辑", "都市摩登", "极简留白", "节日礼赠"},
	},
	"dewu": {
		Key: "dewu", Label: "潮流品质",
		Tone:   "年轻潮流买家看真实细节、做工和上脚上身效果，审美偏街头、球鞋与潮玩文化。",
		Layout: "暗场或街头场景的英雄大图、多角度细节特写（鞋底、缝线、标签、材质纹理）、上脚或上身效果、侧面平视陈列；画面干净、质感硬朗。",
		UIKit:  "鞋盒标签、尺码条、编号、细线引线与方形取景框放大窗，条形码元素点缀。",
		Avoid:  "卖家未提供时出现“鉴定”“正品保证”等平台背书字样；虚构联名与限量。",
		Routes: []string{"潮流街头", "电音赛博", "Y2K 千禧", "硬核实证", "杂志编辑"},
	},
	"aikucun": {
		Key: "aikucun", Label: "社交分销",
		Tone:   "素材要方便店主转发：一图看清品牌、商品与卖点，真实可信、亲和好分享。",
		Layout: "商品清楚居中 + 品牌名 + 3 个短卖点；确有多色多款时做合集图；生活化场景配一句分享口吻的文案。",
		UIKit:  "圆角卡片、简洁图标、品牌色标签与轻量贴纸。",
		Avoid:  "虚构价格、佣金与销量；信息过密难以转发阅读。",
		Routes: []string{"温情陪伴", "痛点对比", "多巴胺撞色", "极简留白", "节日礼赠"},
	},
	"railway": {
		Key: "railway", Label: "旅途礼赠",
		Tone:   "面向旅客与出行人群：地方特产、文创礼品与旅途好物，调性稳重可信，有地域文化与礼赠感。",
		Layout: "旅途场景（车厢小桌板、站台、行李架）与地域风物结合；礼盒陈列，产地风光虚化作背景；标题端正、信息清楚。",
		UIKit:  "印章与票根式标签、线描风物图标、铁路线路式引线与简洁信息卡。",
		Avoid:  "虚构地理标志、获奖与官方合作；过度潮流或夸张的视觉。",
		Routes: []string{"国潮新中式", "节日礼赠", "自然有机", "都市摩登", "轻奢质感"},
	},
	"wechat": {
		Key: "wechat", Label: "熟人私域",
		Tone:   "像朋友真实分享的好物：亲切可信，突出真实使用场景和人。",
		Layout: "真实生活场景与人物使用，温暖自然光；首图商品与人同框，标题像一句推荐语；单张信息量适合朋友圈与群聊转发。",
		UIKit:  "手写感短句、圆角对话气泡、简洁图标、相纸白边。",
		Avoid:  "伪造聊天截图、好评与成交记录；夸张促销与刷屏式大字。",
		Routes: []string{"温情陪伴", "安静治愈", "自然有机", "复古胶片", "节日礼赠"},
	},
	"listing": {
		Key: "listing", Label: "跨境 Listing",
		Tone:   "买家只能靠图片判断商品：主图合规优先，副图逐张回答一个购买问题；目标语言短而具体。",
		Layout: "主图纯白 RGB 255、商品完整约占画面 85%、无文字水印与道具；副图依次用信息图（3–4 个图标卖点）、生活方式场景、尺寸对比（数值只用卖家资料）、细节特写与包装内容；A+ 用横幅模块分段讲品牌故事。",
		UIKit:  "白底或浅灰信息图、统一线性图标、细引线与圆形放大窗、目标语言短标题。",
		Avoid:  "主图加文字、Logo 水印、促销标与边框；副图写 Best Seller、No.1、认证等未授权宣称；机械直译中文口号。",
		Routes: []string{"极简留白", "硬核实证", "都市摩登", "自然有机", "温情陪伴"},
	},
	"indie": {
		Key: "indie", Label: "品牌独立站",
		Tone:   "讲品牌故事与生活方式：像杂志编辑摄影，克制、有观点、有审美门槛。",
		Layout: "全幅编辑摄影 + 大留白 + 小号衬线标题；商品与环境、人物的关系像杂志内页；横版 Banner 与竖版内容图组合，系列色调统一。",
		UIKit:  "极简文字排版、细分隔线、编号与页码式标注，几乎不用图标与贴纸。",
		Avoid:  "平台式促销角标、爆炸贴与密集卖点气泡；廉价素材感背景。",
		Routes: []string{"杂志编辑", "自然有机", "复古胶片", "轻奢质感", "安静治愈", "极简留白"},
	},
	"mobile-cross": {
		Key: "mobile-cross", Label: "跨境移动电商",
		Tone:   "小屏快速滑动：商品要大、对比要强，目标语言短标题一眼读懂。",
		Layout: "商品约占画面 60–80%，背景纯色或简洁场景、高对比；目标语言 2–5 个词的大标题；使用场景与人物动作直观；俄语、德语等长单词预留字号余量，阿拉伯语从右到左排版。",
		UIKit:  "粗描边标签、圆形利益点徽章、大号数字、箭头与对比分栏；TikTok Shop 像内容封面，Shopee、Lazada 明快高饱和。",
		Avoid:  "虚构折扣、包邮与销量；主图白底或无字要求按平台官方执行；画面里残留中文。",
		Routes: []string{"多巴胺撞色", "痛点对比", "运动机能", "活力萌趣", "潮流街头", "科技未来"},
	},
	"b2b-global": {
		Key: "b2b-global", Label: "跨境 B2B",
		Tone:   "海外采购商看供货能力、定制能力与规格完整度，画面专业可信。",
		Layout: "白底或浅灰棚拍的多 SKU 阵列（确有多款时）、规格表、材质与工艺细节、包装与装箱方式、定制选项（仅卖家提供时）；英文标题简洁。",
		UIKit:  "表格线框、编号、色卡、简洁线性图标与品牌色条。",
		Avoid:  "虚构工厂实力、认证与客户案例；零售促销语言。",
		Routes: []string{"硬核实证", "极简留白", "都市摩登", "科技未来"},
	},
	"default": {
		Key: "default", Label: "通用电商",
		Tone:   "忠于商品资料与目标语言：画面清楚、可信，同时要有品牌设计感。",
		Layout: "主图商品完整清楚；副图与详情轮换场景大图、细节放大窗、信息卡与对比分栏；移动端优先。",
		UIKit:  "按已选方向统一标签、图标、引线与装饰，整套一致。",
		Avoid:  "推测未核实的平台强制规则；编造价格、认证、参数与功效。",
		Routes: []string{"极简留白", "温情陪伴", "杂志编辑", "痛点对比", "科技未来"},
	},
}

// platformFamilies maps workbench platform ids (and common Chinese names) to a
// guide family.
var platformFamilies = map[string]string{
	"shein": "indie", "希音": "indie",
	"xiaohongshu": "xiaohongshu", "小红书": "xiaohongshu", "小红书电商": "xiaohongshu",
	"douyin": "short-video", "kuaishou": "short-video", "抖音": "short-video", "抖音电商": "short-video", "快手": "short-video", "快手电商": "short-video",
	"taobao": "shelf", "tmall": "shelf", "jd": "shelf", "淘宝": "shelf", "天猫": "shelf", "京东": "shelf",
	"pdd": "pdd", "pinduoduo": "pdd", "拼多多": "pdd",
	"1688":    "wholesale",
	"vipshop": "vipshop", "唯品会": "vipshop",
	"dewu": "dewu", "得物": "dewu",
	"aikucun": "aikucun", "爱库存": "aikucun",
	"railway": "railway", "国铁商城": "railway",
	"wechat-shop": "wechat", "video-shop": "wechat", "微信小店": "wechat", "视频号小店": "wechat",
	// The listing family is the same set as the web's platform-style.ts
	// familyOf "listing": its main images are pure white without text.
	"amazon": "listing", "亚马逊": "listing", "ebay": "listing", "walmart": "listing", "aliexpress": "listing", "速卖通": "listing",
	"coupang": "listing", "mercado-libre": "listing", "emag": "listing", "wayfair": "listing", "noon": "listing",
	"shopify": "indie", "etsy": "indie", "独立站": "indie",
	"tiktok": "mobile-cross", "tiktok-shop": "mobile-cross", "temu": "mobile-cross", "shopee": "mobile-cross", "lazada": "mobile-cross",
	"ozon": "mobile-cross", "wildberries": "mobile-cross", "rakuten": "mobile-cross", "11street": "mobile-cross",
	"alibaba": "b2b-global", "阿里巴巴国际站": "b2b-global", "dhgate": "b2b-global",
}

var platformDisplayNames = map[string]string{
	"shein":  "SHEIN（希音）",
	"taobao": "淘宝", "tmall": "天猫", "jd": "京东", "pdd": "拼多多", "pinduoduo": "拼多多", "douyin": "抖音电商", "kuaishou": "快手电商", "1688": "1688", "xiaohongshu": "小红书电商",
	"amazon": "Amazon", "temu": "Temu", "shopee": "Shopee", "lazada": "Lazada", "tiktok": "TikTok Shop", "tiktok-shop": "TikTok Shop", "shopify": "Shopify", "ebay": "eBay", "aliexpress": "AliExpress",
	"wechat-shop": "微信小店", "video-shop": "视频号小店", "etsy": "Etsy", "walmart": "Walmart", "mercado-libre": "Mercado Libre", "coupang": "Coupang", "rakuten": "Rakuten", "ozon": "Ozon",
	"alibaba": "阿里巴巴国际站", "dhgate": "DHgate", "11street": "11Street", "wayfair": "Wayfair", "noon": "Noon", "wildberries": "WBPartners", "emag": "eMAG",
	"vipshop": "唯品会", "dewu": "得物", "aikucun": "爱库存", "railway": "国铁商城",
}

// crossBorderFamilies cast models for the target market instead of a domestic
// default.
var crossBorderFamilies = map[string]bool{"listing": true, "indie": true, "mobile-cross": true, "b2b-global": true}

func platformKey(platformID string) string { return strings.ToLower(strings.TrimSpace(platformID)) }

func platformFamily(platformID string) string {
	if family, ok := platformFamilies[platformKey(platformID)]; ok {
		return family
	}
	return "default"
}

// PlatformGuideFor returns the guide of the platform's family, labelled with
// the platform's own name. Unknown platforms get the neutral default guide.
func PlatformGuideFor(platformID string) PlatformGuide {
	id := platformKey(platformID)
	guide := platformGuides[platformFamily(id)]
	guide.Routes = append([]string(nil), guide.Routes...)
	if p, ok := PlatformKnowledgeFor(platformID); ok {
		guide.Tone = p.Style
		guide.Avoid += "；" + p.Risk
		if !p.WhiteMain && guide.Key == "listing" {
			guide.Layout = "真实商品多角度摄影，背景按具体类目核实，不套用Amazon的纯白占比；不掩盖缺陷。"
		}
		if p.AllListingNoText {
			guide.Layout = "商品刊登图采用客观真实摄影，不添加标题、营销图形或信息图；独立社媒封面另按用途处理。"
			guide.UIKit = "商品刊登图不叠加UI、水印或边框。"
		}
		if p.ID == "shein" {
			guide.Key, guide.Label = "indie", "时尚目录"
			guide.Layout = "服饰用正背面版型、自然上身、面料细节；非服饰用清楚的用途与细节摄影。主图不叠加文案，副图按站点类目核实。"
			guide.UIKit = "克制留白与统一色彩，不用爆炸贴、平台徽章或价格贴。"
			guide.Routes = []string{"杂志编辑", "潮流街头", "极简留白", "自然有机"}
		}
	}
	name := platformDisplayNames[id]
	if name == "" {
		name = strings.TrimSpace(platformID)
	}
	if name != "" {
		guide.Label = name + "（" + guide.Label + "）"
	}
	return guide
}

// ListingMainImage reports a cross-border listing main image (Amazon, eBay,
// Walmart, AliExpress …): pure white with no text, so its copy stays empty.
// It mirrors the web's commercePlatformListingMain: a main image, or a single
// image whose purpose is a main image, on a listing-family platform.
func ListingMainImage(platformID, imageType, purpose string) bool {
	if p, ok := PlatformKnowledgeFor(platformID); ok {
		return p.WhiteMain && (imageType == "main" || (imageType == "single" && strings.Contains(purpose, "主图")))
	}
	if platformFamily(platformID) != "listing" {
		return false
	}
	kind := strings.TrimSpace(imageType)
	return kind == "main" || (kind == "single" && strings.Contains(purpose, "主图"))
}

// directionsTerm names a content type in the fast directions prompt: the
// content label, the narrative field description and an optional type rule.
type directionsTerm struct{ label, narrative, rule string }

var directionsTerms = map[string]directionsTerm{
	"detail":         {label: "整套详情页", narrative: "九屏节奏一句话"},
	"set":            {label: "产品套图", narrative: "套图张与张的分工一句话", rule: "【产品套图】每套方向都是一整组不同用途商品图（主图、卖点、细节、场景、规格、收束）共用的美术方案，不是某一张的内容。"},
	"main-secondary": {label: "主副图组合", narrative: "主图与副图的分工一句话", rule: "【主副图组合】每套方向是一组“主图 + 副图”的统一美术方案：主图服从平台主图规则（要求白底或无字时照做），副图承担场景或卖点补充；不要把主图和副图拆成两套方向。"},
	"main":           {label: "商品主图", narrative: "主图的画面焦点与候选差异一句话", rule: "【商品主图】平台要求白底或无字时，四套在合规前提下只拉开布光、角度、陈列与道具的差异。"},
	"secondary":      {label: "商品副图", narrative: "副图与主图的信息分工一句话"},
	"single":         {label: "单张成品", narrative: "单图的画面焦点一句话", rule: "【单张成品】每套方向是一张独立成品的美术方案，按用户所选用途（主图、副图、Banner、SKU 展示、场景图）设计画面焦点。"},
	"marketing":      {label: "营销物料", narrative: "物料的信息主次一句话", rule: "【营销物料】每套方向是一套可延展到用户所选物料（海报、Banner、信息流、社媒封面等）的广告美术方案；活动、价格与权益只用用户提供的真实信息。"},
	"white":          {label: "白底图", narrative: "白底陈列的光影与角度一句话", rule: "【白底图专属，优先于上面第 2–4 条】四套都必须是纯白背景（RGB 255）、无道具、无新增文字的完整商品图，只在布光（柔光箱、侧逆光、顶光）、阴影（接触阴影、柔投影、无影）、角度（正面、三分之四、俯拍）与陈列（单件、组合、悬浮）上拉开差异；palette 写“纯白 #FFFFFF”与商品本色，typography 写“不新增文字”，graphics 写“不新增装饰”，label 用光影词开头（如“柔光轻影”“侧光立体”）。"},
	"three-view":     {label: "三视图", narrative: "三视图的视角编排与光影一句话", rule: "【三视图专属，优先于上面第 2–4 条】四套都保持纯白背景、无道具、无新增文字，视角按用户设定的正面、侧面、背面等编排，只在布光、阴影与视图排列方式上区分；palette 写纯白与商品本色，typography 写“不新增文字”，graphics 写“不新增装饰”。"},
	"sku":            {label: "SKU 商品图", narrative: "SKU 之间统一与区分的方式一句话", rule: "【SKU 图】每套方向是一套全 SKU 统一的美术方案：同一背景、主体尺度与文案位置，只在整体风格上区分。"},
	"scene":          {label: "使用场景图", narrative: "场景与人物关系一句话"},
	"selling":        {label: "卖点图", narrative: "卖点逐张呈现的方式一句话"},
	"feature":        {label: "功能图", narrative: "功能演示的顺序一句话"},
	"size":           {label: "尺寸展示图", narrative: "尺寸标注的视角与层级一句话"},
	"material":       {label: "材质展示图", narrative: "材质呈现的尺度一句话"},
	"package":        {label: "包装展示图", narrative: "包装展示的状态一句话"},
	"poster":         {label: "活动海报", narrative: "海报的信息主次一句话"},
	"amazon-a-plus":  {label: "Amazon A+ 模块", narrative: "A+ 模块的叙事顺序一句话"},
	"social":         {label: "社交推广图", narrative: "社交封面的抓眼点一句话"},
}

func directionsTermFor(imageType string) directionsTerm {
	if term, ok := directionsTerms[strings.TrimSpace(imageType)]; ok {
		return term
	}
	return directionsTerm{label: "整组商品图", narrative: "整组节奏一句话"}
}

// FastDirectionsSystemFor adapts the fast directions prompt to the content
// type. Detail keeps WorkbenchFastDirectionsSystem unchanged; other types name
// their own content and narrative, and white types stay on pure white.
// "main-secondary" is the 主副图 quick type (a two-image set).
func FastDirectionsSystemFor(imageType string) string {
	kind := strings.TrimSpace(imageType)
	if kind == "" || kind == "detail" {
		return WorkbenchFastDirectionsSystem
	}
	term := directionsTermFor(kind)
	system := strings.Replace(WorkbenchFastDirectionsSystem, "整套详情页视觉方向", term.label+"视觉方向", 1)
	system = strings.Replace(system, `"narrative":"九屏节奏一句话"`, `"narrative":"`+term.narrative+`"`, 1)
	if term.rule != "" {
		system = strings.Replace(system, "只输出一个 JSON 对象", term.rule+"\n只输出一个 JSON 对象", 1)
	}
	return system
}

// platformTypeRule is the one platform rule that changes what the four
// directions may do for a content type.
func platformTypeRule(family, kind string) string {
	listingMain := kind == "main" || kind == "set" || kind == "main-secondary"
	switch {
	case kind == "white" || kind == "three-view":
		return "白底类型在任何平台都保持纯白、无道具、无新增文字，四套只在布光、阴影、角度与陈列上区分。"
	case family == "listing" && listingMain:
		return "主图须纯白 RGB 255、商品约占画面 85%、无文字水印与道具：四套的主图只在布光、角度与陈列上区分，风格反差放到副图与场景图。"
	case family == "pdd" && listingMain:
		return "首图让商品与组合一眼看清，件数与规格只写卖家提供的真实信息。"
	case family == "xiaohongshu":
		return "首图按笔记封面思路设计：留出两行大字标题区，画面像真实生活分享。"
	case family == "short-video":
		return "首图像短视频封面：第一眼就有钩子大字或强动作。"
	}
	return ""
}

// directionFamilies are the four style families of the fast directions prompt
// (静, 燃, 潮, 都市; the lists match WorkbenchFastDirectionsSystem) with the
// style-library routes each one covers.
var directionFamilies = []struct {
	name   string
	routes []string
}{
	{"静", []string{"安静治愈", "极简留白", "自然有机", "温情陪伴"}},
	{"燃", []string{"电音赛博", "科技未来", "硬核实证", "运动机能"}},
	{"潮", []string{"潮流街头", "多巴胺撞色", "活力萌趣", "国潮新中式", "Y2K 千禧", "手绘童趣", "痛点对比", "节日礼赠"}},
	{"都市", []string{"都市摩登", "轻奢质感", "复古胶片", "杂志编辑"}},
}

// familyRoutes groups a platform's suitable routes by direction family, e.g.
// "静＝安静治愈、自然有机；潮＝多巴胺撞色". Families without a route are left out.
func familyRoutes(routes []string) string {
	var parts []string
	for _, family := range directionFamilies {
		var picked []string
		for _, route := range routes {
			if slices.Contains(family.routes, route) {
				picked = append(picked, route)
			}
		}
		if len(picked) > 0 {
			parts = append(parts, family.name+"＝"+strings.Join(picked, "、"))
		}
	}
	return strings.Join(parts, "；")
}

// directionsRouteRule makes each family start from this platform's routes
// instead of the same four archetypes everywhere, and keeps routes that do
// not suit the category (neon for a baby bottle) out.
const directionsRouteRule = "选路线：四个家族各出一套，每套先从本平台该家族的路线里选适合商品的一条，label 以该路线名开头；家族没列出路线或列出的不适合商品时，再从该家族其他路线里选。按品类避让：母婴、食品、宠物不用电音赛博或赛博霓虹，燃家族改用明亮克制的硬核实证或科技未来。"

// PlatformDirectionsBrief tells the directions model how the platform and the
// content type shape the four directions, within 500 runes.
func PlatformDirectionsBrief(platformID, imageType string) string {
	guide := PlatformGuideFor(platformID)
	term := directionsTermFor(imageType)
	head := "【平台与类型适配】" + guide.Label + " × " + term.label + "\n调性：" + guide.Tone + "\n适合路线（按家族）：" + familyRoutes(guide.Routes) + "\n" + directionsRouteRule + "\n"
	tail := ""
	if rule := platformTypeRule(platformFamily(platformID), strings.TrimSpace(imageType)); rule != "" {
		tail = rule + "\n"
	}
	tail += "四套都贴合该平台的阅读习惯与" + term.label + "的用途，保持四个风格家族的强反差；平台规则以官方当期要求为准。"
	body := "版式与 UI：" + guide.Layout + guide.UIKit + "\n避免：" + guide.Avoid
	if budget := 500 - utf8.RuneCountInString(head+tail) - 1; budget > 1 {
		head += clipRunes(body, budget) + "\n"
	}
	return clipRunes(head+tail, 500)
}

// clipRunes keeps at most limit runes, ending with an ellipsis when cut.
func clipRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	if limit <= 1 {
		return string(runes[:max(limit, 0)])
	}
	return string(runes[:limit-1]) + "…"
}

var directionsInspirations = []string{
	"一天中的特定时刻（清晨、午后、深夜）",
	"材质与光线的关系",
	"使用者的一个情绪瞬间",
	"城市、自然与室内空间的反差",
	"色温与撞色的对比",
	"季节与节令",
	"日常生活里的仪式感",
	"商品造型的几何线条",
	"温度、声音或触感的通感联想",
	"旅行与移动中的场景",
}

// DirectionsInspirationLine is a one-line random brief appended to the fast
// directions prompt, so a repeated request never sends identical text and the
// four directions start from a new angle.
func DirectionsInspirationLine(r *rand.Rand) string {
	r = designRand(r)
	angle := directionsInspirations[r.IntN(len(directionsInspirations))]
	return fmt.Sprintf("【本轮灵感 #%06x】至少一套方向从「%s」切入；每次请求都重新构思，四套不套用常见模板。", r.Uint32()&0xffffff, angle)
}

func designRand(r *rand.Rand) *rand.Rand {
	if r != nil {
		return r
	}
	now := uint64(time.Now().UnixNano())
	return rand.New(rand.NewPCG(now, now^0x9e3779b97f4a7c15))
}

// designOption is one playbook entry. Tags steer selection:
//   - "people": shows a person or hands, only drawn when people are allowed;
//   - "text": the concept depends on on-image text, skipped in no-text runs
//     while other entries remain;
//   - "white": a pure-white, text-free product image;
//   - "multi": needs several real colours, SKUs or pieces (全家福, 多色陈列,
//     SKU 阵列, 款式目录 …); only drawn when VariationInput.MultiVariant is set,
//     so a single product never gets invented variants;
//   - "p:<family>": only for these platform families;
//   - "x:<family>": never for this platform family;
//   - "c:<category>": only for these product categories;
//   - "f:<family>": preferred for this platform family;
//   - "s:<style group>": fits these style-library families (静谧治愈 …);
//   - "id:<platform>": casting entry for this exact platform id.
type designOption struct {
	id   string
	text string
	tags []string
}

func opt(id, text string, tags ...string) designOption {
	return designOption{id: id, text: text, tags: tags}
}

func (o designOption) has(tag string) bool { return slices.Contains(o.tags, tag) }

// designRole is one page role of a set or detail page with its alternatives.
// closeup roles always show a macro or close-up; people roles carry the pages
// with a person when people are allowed.
type designRole struct {
	name     string
	closeup  bool
	people   bool
	variants []designOption
}

// Main images for every family except cross-border listings.
var designMainLayouts = []designOption{
	opt("main-plinth", "台座英雄：商品完整居中站在与本套配色一致的几何台座上，约占画面 65%，85mm 平视微俯，背景是本套主色无缝纸加柔和暗角；左上留主标题区，底部一条细卖点标签条，台座有真实接触阴影。"),
	opt("main-offaxis", "偏轴三分之四：商品转到侧前方 30° 偏右放置，约占画面 55%，70mm 低机位略仰拍出体量；左侧三分之一留白竖排标题与 2 个卖点胶囊，背景是本套场景的柔焦延伸。"),
	opt("main-hand", "手持实拍：一只手自然握持或正在操作商品，商品约占画面 50%，轮廓完整不被手指遮挡，50mm 平视，背景是真实使用环境的浅景深虚化；标题放上方留白，右下角一枚圆形卖点徽章。", "people"),
	opt("main-foreground", "前景场景：商品放在真实使用环境的前景台面上，约占画面 45%，35mm 平视带出空间纵深，只留 1–2 件说明用途的道具；标题压在上部墙面或窗景的留白处，底部一行场景短句。"),
	opt("main-flatlay", "俯拍平铺：90° 俯拍，商品居中约占画面 50%，四周按网格整齐摆放 3–4 件真实配件或用途相关的道具，背景是本套纹理台面；标题横放在顶部留白，四角保留安全边距。"),
	opt("main-macro", "局部开场：100mm 微距特写一处最有辨识度的可见局部，占满画面约 70%，侧逆光拉出纹理；右下角小窗嵌入完整商品全貌，标题沿左上暗部斜向排列，短而大。"),
	opt("main-diagonal", "斜切色面：画面按本套主色与辅色对角斜切成两块色面，商品横跨分割线、约占画面 60%，85mm 平视加硬光，投出清晰投影；标题放在浅色块内，卖点标签贴着分割线排列。"),
	opt("main-float", "悬浮倒影：商品悬浮在亮面台面上方，下方一道柔和倒影，约占画面 55%，100mm 平视，轮廓光把商品从深色或渐变背景中分离；顶部居中标题，底部一行小字。"),
	opt("main-family", "全家福陈列：多色或多件商品前后错落成三角构图，主款在前约占画面 40%，其余款依次后退且完整可辨（只放真实存在的颜色与规格），70mm 微俯；顶部标题，底部色名或规格小标签。", "multi"),
	opt("main-window", "窗光叶影：商品放在窗边台面，斜射窗光在背景墙投出窗格或叶影，商品约占画面 50%，50mm 平视，色温跟随本套主色；标题小而疏，落在投影之间的留白。"),
	opt("main-note-cover", "笔记封面：上部三分之一是两行手写感大字标题加荧光笔划线，下部是手机实拍感的生活场景，商品约占画面 45%，自然窗光与轻微景深；角落贴 1–2 张手写便签或圆角贴纸。", "p:xiaohongshu", "p:wechat", "text"),
	opt("main-list", "好物清单：俯拍生活化桌面，商品与 2–3 件同场景好物按清单排开，商品最大、约占画面 40%，每件旁一个手写编号与一句短评，顶部两行手写感标题，自然窗光加奶油色调。", "p:xiaohongshu", "p:wechat", "text"),
	opt("main-unbox", "开箱第一眼：手机俯拍视角，拆开的包装与商品同框，商品约占画面 50%，一张手撕边便签写一句真实感受，背景是生活化桌面与自然侧光。", "p:xiaohongshu", "p:wechat", "p:aikucun", "text"),
	opt("main-hook", "钩子封面：粗描边大字斜切横跨画面上部、宽度约占 80%，商品放大到下半部约占 55% 并微微倾斜制造动势，背景是高饱和纯色加放射速度线；一枚爆炸星形贴标出核心卖点。", "p:short-video", "p:mobile-cross", "p:pdd", "text"),
	opt("main-reaction", "惊喜反应：人物把商品举到镜头前，表情生动，商品约占画面 45% 且清楚可辨，背景浅景深虚化；上方粗描边大字钩子标题，角落一枚爆炸贴。", "p:short-video", "p:mobile-cross", "people", "text"),
	opt("main-combo", "一图看全：主商品居左约占画面 55%，右侧竖排 2–3 个圆角小方格展示真实的颜色、规格或件数，每格配大号数字或色名标签，背景是明亮干净的暖白。", "p:pdd", "p:wholesale", "p:aikucun", "p:shelf", "text", "multi"),
	opt("main-sku-wall", "SKU 阵列：同款不同颜色或规格按 3×2 或 4×2 网格整齐排列在浅灰棚拍背景上，每格大小一致、朝向统一；顶部标题，底部一条规格色卡，方便采购一眼对比。", "p:wholesale", "p:b2b-global", "multi"),
	opt("main-cover", "杂志封面：商品偏下居中约占画面 50%，上部超大衬线刊头横跨全宽，商品轻压刊头底边形成前后层次；左下角小号期号与一行导语，整体大留白。", "text"),
	opt("main-dark", "暗场英雄：商品居中约占画面 55%，背景几近全黑，左右两条窄长条灯勾出边缘高光，地面一层淡反射；标题用本套强调色放在顶部，信息极简。"),
	opt("main-street", "街头低机位：24mm 广角贴地仰拍，商品放在混凝土地面或台阶上约占画面 50%，背景是虚化的街景与涂鸦墙；标题像贴纸一样斜贴在一角。", "c:apparel", "c:sport", "c:tech", "c:general"),
	opt("main-nature", "自然物环绕：商品立在石块、苔藓或原木切面上，约占画面 50%，前景 2–3 件自然材质道具虚化，85mm 平视加林间斑驳光；标题压在留白的天空或石面上。", "c:beauty", "c:food", "c:home", "c:maternal", "c:pet", "c:bathroom", "c:general"),
}

// Cross-border listing main images: compliant pure white, varied only in
// angle, light and arrangement.
var designListingMainLayouts = []designOption{
	opt("lst-front", "合规正面：纯白背景 RGB 255，商品正面平视完整居中，约占画面 85%，85mm 无畸变，大柔光箱均匀照明，只留极淡接触阴影；无文字、无水印、无道具与边框。", "white"),
	opt("lst-quarter", "合规三分之四：纯白背景 RGB 255，商品转 30° 同时看清正面与侧面结构，约占画面 85%，顶光加两侧柔光，底部一道柔和投影；无文字、无新增图形与道具。", "white"),
	opt("lst-bundle", "合规组合：纯白背景 RGB 255，套装或多件按前后错落陈列（只放真实包含的部件），整体约占画面 85%，主件在前，各部件完整不互相遮挡；无文字、无道具。", "white", "multi"),
	opt("lst-high", "合规微俯：纯白背景 RGB 255，微俯 30° 同时拍到顶部与正面，商品约占画面 85%，边缘轮廓光让浅色商品与背景分离；无文字、无道具。", "white"),
	opt("lst-open", "合规展开：纯白背景 RGB 255，商品以展开或开启的使用形态完整呈现（仅商品本身可开合时），约占画面 85%，均匀柔光；无文字、无手部、无道具。", "white"),
	opt("lst-profile", "合规侧影：纯白背景 RGB 255，侧面平视完整呈现商品厚度与线条，约占画面 85%，左侧主光在右侧留下柔和渐变，阴影短而轻；无文字、无道具。", "white"),
}

var designSecondaryLayouts = []designOption{
	opt("sec-callouts", "信息图：商品居中约占画面 50%，四周 3–4 个图标卖点用细引线指向对应部位，每个卖点 4–6 字加一行说明，背景是本套浅色纯底，标题在顶部。", "text"),
	opt("sec-lifestyle", "生活方式：人物在真实场景中正在使用商品，商品约占画面 35% 且清楚可辨，35mm 平视抓拍感；标题放在环境留白处，配 1–2 个场景短标签。", "people"),
	opt("sec-size", "尺寸对照：商品与常见日用品并排平视、无畸变，用细线和端点标出长宽高（数值只用卖家资料，没有数据只做比例对照、不写数字），背景白色或浅灰。"),
	opt("sec-detail-trio", "细节三连：上半部是商品全貌，下半部三个等大圆角方格分别放三处真实可见局部的微距特写，每格一行短说明，网格间距统一。"),
	opt("sec-compare", "前后对比：左右分栏、同一机位同一光线，左侧普通做法偏灰略杂乱，右侧使用本商品后整洁并用本套主色，中间细分隔线与对勾标识，结论条放底部；只对比看得见的差异。", "text"),
	opt("sec-in-box", "包装清单：俯拍平铺商品、真实配件与包装盒，按网格对齐并编号，每件配一个小标签（只列卖家确认或图上可见的部件），背景是浅色纸面。"),
	opt("sec-angles", "多角度条带：正面、侧面、背面、顶面四个视角横向等距排列，统一尺度与光线，底部细线标注角度名称，背景纯色。"),
	opt("sec-steps", "操作三步：三格分镜各拍一个手部动作（打开、使用、收纳），配 01/02/03 大号编号与一句动作说明，统一俯拍或平视机位。", "people"),
	opt("sec-scene-grid", "场景四宫格：2×2 四格分别展示四个不同使用场景（按品类改写，如居家、通勤、户外、旅行），每格商品清楚可辨，格间细白边，顶部一行总标题。"),
	opt("sec-material", "材质微距：100mm 微距贴近商品表面，侧逆光拉出纹理或光泽，局部占满画面；左下角一个小号标签写材质或工艺（只用已确认信息，否则只写可见质感）。"),
	opt("sec-space", "空间尺度：35mm 拍出商品在桌面、柜面或地面上的真实尺度，商品约占画面 25% 但处在视觉中心与光线最亮处；标题放在大面积留白的墙面上。"),
	opt("sec-split", "分栏卖点：左侧 60% 是商品中近景，右侧 40% 竖排 3 条“图标 + 粗体卖点 + 一行说明”，分栏线用本套强调色细线。", "text"),
	opt("sec-note", "笔记内页：手机实拍感的桌面或手持画面，商品约占画面 45%，贴 2–3 张手写便签写使用感受（只写可见或卖家提供的事实），手绘箭头指向细节。", "p:xiaohongshu", "p:wechat", "text"),
	opt("sec-listing-info", "Listing 信息图：白底或浅灰底，商品偏左约占画面 50%，右侧 3–4 条目标语言短卖点配统一线性图标，顶部一行 3–6 个单词的标题，信息克制不拥挤。", "p:listing", "p:mobile-cross", "p:b2b-global", "text"),
	opt("sec-burst", "爆点特写：商品关键部位放大到画面约 70%，配粗描边大字与箭头圈注，角落小窗嵌入人物使用时的表情反应，节奏像短视频截帧。", "p:short-video", "p:mobile-cross", "p:pdd", "people", "text"),
}

// White images differ only in angle, shadow and light; never props or text.
var designWhiteLayouts = []designOption{
	opt("wh-front", "正面平视：纯白无缝背景，商品完整居中约占画面 80%，大柔光箱正面均匀照明，保留自然接触阴影；无道具、无文字。", "white"),
	opt("wh-quarter", "三分之四侧前：纯白背景，商品转 30° 同时看清正面与侧面，顶光加左侧柔光，底部柔和投影向右后方延伸；无道具、无文字。", "white"),
	opt("wh-high", "微俯 45°：纯白背景，看清商品顶部与正面结构，约占画面 75%，环形柔光让阴影极短；无道具、无文字。", "white"),
	opt("wh-profile", "侧面轮廓：纯白背景，严格侧面平视展示厚度与线条，左侧主光、右侧白色反光板补光，阴影干净；无道具、无文字。", "white"),
	opt("wh-back", "背面视角：纯白背景，商品背面完整平视（仅在有背面参考或结构可推演时），均匀柔光与轻微接触阴影；无道具、无文字。", "white"),
	opt("wh-float", "悬浮无影：纯白背景，商品略微离地悬浮，底部只留一圈极淡柔影，四周光线均匀，浅灰轮廓光勾出边缘；无道具、无文字。", "white"),
	opt("wh-mirror", "镜面倒影：纯白背景配白色亮面地台，商品下方一道淡倒影，85mm 平视，整体干净高调；无道具、无文字。", "white"),
	opt("wh-group", "组合陈列：纯白背景，多色或多件（只放真实存在的款式与配件）前后错落排列，每件完整不遮挡，光线与阴影方向统一；无道具、无文字。", "white", "multi"),
	opt("wh-top", "顶视平铺：纯白背景，90° 俯拍，商品平放居中，柔光无影台消除阴影，边缘清晰便于抠图；无道具、无文字。", "white"),
	opt("wh-hard", "硬光投影：纯白背景，单侧硬光在白色台面投下清晰几何投影，增强立体感但不压暗商品本色；无道具、无文字。", "white"),
}

// One treatment covers every view of a three-view set.
var designThreeViewLayouts = []designOption{
	opt("tv-soft", "三视统一柔光：纯白无缝背景，正交平视、无透视畸变，大柔光箱均匀照明，各视图商品大小与基线一致，只留极淡接触阴影；无道具、无文字。", "white"),
	opt("tv-rim", "三视轮廓光：纯白背景，正交平视，正面柔光加两侧浅灰轮廓光勾出边缘，各视图阴影方向一致；无道具、无文字。", "white"),
	opt("tv-shadowless", "三视无影：纯白背景，柔光无影台消除阴影，正交平视，轮廓边缘锐利、便于对齐与测量；无道具、无文字。", "white"),
	opt("tv-grounded", "三视落地：纯白背景配浅白地台，正交平视，各视图底部同一水平接触线与一致的柔和投影；无道具、无文字。", "white"),
}

var designBannerLayouts = []designOption{
	opt("ban-left-text", "横版左文右图：左侧 45% 放主标题、副标题与一个按钮样式的标签，右侧 55% 是商品三分之四大图与本套场景，商品向画面中心微转引导视线。", "text"),
	opt("ban-symmetric", "横版中心对称：商品居中约占画面高度 70%，左右两侧对称排两组卖点图标，标题在商品上方，背景从本套主色渐变到辅色。"),
	opt("ban-wide-scene", "横版场景宽景：35mm 拍出商品在真实场景中的全景，商品落在右三分线上并处在光线最亮处，左侧大面积留白放两行标题。"),
	opt("ban-diagonal", "横版斜切动势：背景按 15° 斜切成两块色面，商品沿斜线倾斜放置并带速度线，标题沿斜线排布，适合新品首发与活动开场。", "text"),
	opt("ban-lineup", "横版多款陈列：3–5 款真实存在的颜色或规格从左到右等距排开、由大到小形成节奏，顶部居中标题，底部一行系列名。", "multi"),
	opt("ban-portrait", "横版人物情绪：人物半身在右侧使用或展示商品，表情自然，商品清楚可辨，左侧留白放标题与一句情绪短句，背景浅景深。", "people"),
	opt("ban-minimal", "横版极简留白：商品小而精地放在右下三分之一，其余是大面积本套主色留白，左上角一行大号衬线标题，像品牌官网首屏。"),
}

// A SKU set keeps one layout for every SKU.
var designSkuLayouts = []designOption{
	opt("sku-uniform", "统一陈列：每张同一背景色、同一机位与同一商品尺度，商品居中约占画面 70%，底部规格条写本款颜色与规格（只用卖家信息）。"),
	opt("sku-swatch", "色卡式：商品居中，右下角一个圆形色块标出本款颜色名，背景是本款颜色的浅调同色系，整组按色系依次变化。", "multi"),
	opt("sku-ghost", "前后对位：本款完整居中，其他颜色款在后方半透明虚化排列以突出当前款，顶部写规格名称。", "multi"),
	opt("sku-spec", "规格标注：商品三分之四视角，旁边用细线标出本款容量、尺寸或规格（只写卖家资料），浅灰背景，信息卡固定在右侧。"),
	opt("sku-flatlay", "平铺对比：俯拍把本款与配件按固定网格平铺，左上角固定位置放 SKU 名称，整组位置不变方便横向比较。"),
	opt("sku-scene", "同场景换款：每款放在同一台面、同一光线下，朝向一致只换款式，角落小标签写款式名，适合多色同场景对比。", "multi"),
}

var designSceneLayouts = []designOption{
	opt("scn-morning", "清晨窗边：商品放在洒满斜射晨光的台面上，约占画面 45%，35mm 平视，窗格投影落在背景墙，标题放在亮部留白。"),
	opt("scn-person", "人物使用中景：人物正在自然使用商品，商品处在画面视觉中心且轮廓完整，50mm 平视浅景深，背景是真实生活空间。", "people"),
	opt("scn-outdoor", "户外自然光：商品在草地、石阶或海边等真实环境中，约占画面 40%，逆光勾出轮廓，前景有虚化的植物或环境元素。"),
	opt("scn-night", "夜晚暖光：室内夜景，台灯或氛围灯形成暖色光池，商品位于光池中心，周围暗而有层次，标题用浅色小字。"),
	opt("scn-desk", "桌面叙事：90° 俯拍真实桌面，商品与 3–4 件同场景物品按使用顺序摆放，像正在被使用的一刻，标题在顶部。"),
	opt("scn-transit", "旅途通勤：商品出现在背包、车内、工位或行李箱旁的真实场景，35mm 抓拍感，商品清楚、环境叙事明确。"),
	opt("scn-hands", "手部互动：手正在打开、按压或握持商品，85mm 中近景，背景是场景的柔焦延伸，强调使用动作。", "people"),
}

var designCustomLayouts = []designOption{
	opt("cus-levitate", "分层悬浮：商品与其可见部件或相关元素在空中分层悬浮（只用已可见外观，不画内部零件），约占画面 60%，硬光投影，背景是本套主色。"),
	opt("cus-scale", "大小对比：一处局部微距特写占满画面，右下角小窗放完整商品，形成强烈的大小对比与好奇感。"),
	opt("cus-stage", "几何展台：商品站在多层错落的几何台阶顶端，侧光拉出台阶阴影，像一座小型展台，标题放在顶层留白。"),
	opt("cus-silhouette", "逆光剪影：逆光下商品呈半剪影，一束窄光照亮关键部位，背景暗而有烟雾层次，标题极简。"),
	opt("cus-collage", "拼贴海报：商品实拍与撕纸、手绘线条、色块拼贴组合，商品保持写实完整，拼贴只做装饰、不遮挡商品。", "text"),
	opt("cus-mirror", "镜像对称：商品与亮面或水面里的倒影上下对称，构图居中，背景渐变，标题放在倒影下方。"),
	opt("cus-miniature", "微缩世界：商品作为微缩场景里的巨物主角，周围是缩小比例的人物或场景模型，趣味强但商品外观写实。"),
}

// Marketing forms for posters, banners, feeds, splash screens and covers.
var designMarketingLayouts = []designOption{
	opt("mk-bigtype", "大字报：超大粗体标题占画面一半以上，商品从文字后方或字缝中露出、约占画面 40%，只用两种高对比颜色，信息只有标题、一句副标题与卖家提供的活动信息。", "text"),
	opt("mk-collage", "杂志拼贴：商品实拍与撕纸、胶带、旧报纸纹理和手写注释拼贴，大号衬线标题，像杂志专题内页，商品保持写实完整。", "text"),
	opt("mk-portrait", "人物情绪特写：85mm 拍人物面部与商品同框的近景，表情真实有感染力，商品清楚位于面部旁或手中，标题放在人物视线方向的留白。", "people"),
	opt("mk-blocks", "几何色块：画面由 3–4 个本套色彩的几何形块构成，商品放在色块交汇处、约占画面 50%，硬光投影，标题沿色块边缘对齐。"),
	opt("mk-concept", "概念氛围：用与商品意象相关的超现实场景（水下、云端、沙丘或光隧道）承托商品，商品写实、约占画面 40%，标题极简。"),
	opt("mk-doodle", "手绘混搭：商品实拍叠加白色或彩色手绘线条（光芒、箭头、涂鸦小人、星星），像设计师在照片上随手标注，轻松有趣。"),
	opt("mk-minimal", "极简留白：商品小而精地放在画面下三分之一，上方大面积纯色留白，只放一行大号标题与一行小字，克制而高级。"),
	opt("mk-split", "分屏对比：画面上下或左右一分为二，一边是情绪场景、一边是商品棚拍特写，用同一色调连接，标题跨越分割线。"),
	opt("mk-burst", "动感爆发：商品倾斜悬浮，周围是放射速度线与定格飞溅的相关元素（水花、粉末或纸片），强对比色，适合新品首发与活动开场。"),
	opt("mk-cinema", "电影海报：低机位、强逆光与薄雾的电影感场景，商品是画面主角，上方留标题、下方一条信息条放卖家提供的时间或权益。", "text"),
	opt("mk-feed", "信息流原生：像用户随手拍的生活画面（手机视角、自然光），商品自然出现在场景里，顶部一行口语化标题，避免一眼看出是广告。"),
	opt("mk-splash", "开屏竖版：竖构图，商品从画面底部向上伸出约占 50%，顶部安全区放品牌名与标题，中部为系统控件预留空位，背景纵向渐变。"),
	opt("mk-cover", "社媒封面：两行大字标题压在上半部并配荧光笔划线，下半部是商品的真实生活场景，角落贴 1–2 个贴纸标签。", "text"),
	opt("mk-grid", "九宫格系列：画面切成 3×3 网格，中心格放商品主视觉，周围 8 格是本套色彩、真实细节、场景与情绪碎片（不画商品没有的颜色或款式），整体同一色调。"),
	opt("mk-type-wrap", "文字环绕：标题文字沿商品轮廓环绕，或从商品后方穿过形成前后层次，商品居中约占画面 45%，纯色背景。", "text"),
}

var designSizeLayouts = []designOption{
	opt("size-front", "正面长宽：商品正面平视、无透视畸变，细线与端点标出长与宽，数值只用卖家资料；浅灰或白色背景，标注线用本套强调色。"),
	opt("size-side", "侧面高度：严格侧面平视，竖向细线标出高度与厚度，旁边放一件常见日用品作比例参照（不写未确认数值）。"),
	opt("size-3d", "整体三维：三分之四视角，三条坐标式细线分别标出长、宽、高，数值框统一放在右侧信息栏。"),
	opt("size-hand", "手部比例：手掌或手指与商品同框平视，直观呈现大小，配一条简洁的尺寸标注线（数值只用卖家资料）。", "people"),
}

var designMaterialLayouts = []designOption{
	opt("mat-macro", "表面微距：100mm 微距贴近表面，侧逆光拉出纹理或光泽，局部占满画面，角落小标签写已确认的材质或工艺。"),
	opt("mat-split", "整体与局部：左侧商品全貌约占 45%，右侧上下两个局部特写窗展示两处不同表面，细线连接对应位置。"),
	opt("mat-light", "光泽对比：同一表面在硬光与柔光下各拍一格并排对照，表现哑光、亮面或织纹的真实质感。"),
	opt("mat-touch", "触感瞬间：手指轻触或弯折商品表面的近景特写，浅景深，强调可见的柔软、弹性或纹理。", "people"),
}

var designPackageLayouts = []designOption{
	opt("pkg-full", "完整外包装：包装盒三分之四视角居中约占 60%，商品立在包装旁，柔光棚拍，包装文字保持原样清晰。"),
	opt("pkg-unbox", "开箱陈列：俯拍打开的包装盒，商品与真实配件按原位摆放，盒盖斜靠在一侧，像开箱的第一眼。"),
	opt("pkg-flatlay", "内容平铺：商品、配件与说明书按网格平铺并编号，每件一个小标签（只列真实包含的物品）。"),
	opt("pkg-gift", "礼赠合影：商品与包装组合陈列在本套色彩的台面上，丝带或纸张只作点缀，不添加虚构赠品。"),
}

var designSingleDefaultLayouts = slices.Concat(designCustomLayouts, designSceneLayouts, designBannerLayouts)

var designAPlusLayouts = slices.Concat(designBannerLayouts, designSecondaryLayouts)

// Product-set roles in reading order: 主图→卖点总览→细节特写→使用场景→
// 多角度→尺寸或规格→场景二/人物→收束.
var designSetRoles = []designRole{
	{name: "主图", variants: []designOption{
		opt("set-main-plinth", "主图｜商品完整居中站在本套台座上，约占画面 65%，85mm 平视，背景是本套主色无缝纸，左上留主标题区，底部一条卖点标签条。"),
		opt("set-main-offaxis", "主图｜三分之四侧前方英雄视角，商品偏右约占画面 60%，左侧竖排标题与 2 个卖点胶囊，背景是本套场景的柔焦延伸。"),
		opt("set-main-dark", "主图｜明暗极简英雄照：商品居中约占画面 55%，轮廓光勾边，地面一层淡反射，顶部居中一行标题，其余信息极简。"),
		opt("set-main-flatlay", "主图｜俯拍平铺：商品居中约占画面 50%，四周按网格摆放真实随附配件或用途相关道具，顶部横向标题，四角保留安全边距。"),
		opt("set-main-window", "主图｜窗光叶影：商品放在窗边台面约占画面 55%，斜射窗光在背景墙投出窗格或叶影，50mm 平视，标题小而疏，落在投影之间的留白。"),
		opt("set-main-diagonal", "主图｜斜切色面：背景按本套主色与辅色对角斜切，商品横跨分割线约占画面 60%，85mm 平视加硬光投影，标题放在浅色块内。"),
		opt("set-main-float", "主图｜悬浮倒影：商品悬浮在亮面台面上方约占画面 55%，下方一道柔和倒影，轮廓光把商品从背景中分离，顶部居中标题。"),
		opt("set-main-combo", "主图｜一图看全：主商品居左约占画面 55%，右侧竖排 2–3 个圆角小方格展示真实的颜色、规格或件数，背景明亮干净。", "p:pdd", "p:wholesale", "p:aikucun", "text", "multi"),
		opt("set-main-note", "主图｜笔记封面：上部两行手写感大字标题，下部是手机实拍感的生活场景，商品约占画面 45%，角落一张手写便签。", "p:xiaohongshu", "p:wechat", "text"),
		opt("set-main-hook", "主图｜钩子封面：粗描边大字斜切横跨上部，商品放大到下半部约占 55% 并微微倾斜，背景是高饱和纯色加速度线。", "p:short-video", "p:mobile-cross", "text"),
	}},
	{name: "卖点总览", variants: []designOption{
		opt("set-points-bubbles", "卖点总览｜商品居中，四周 3–4 个图标卖点气泡用细引线指向对应部位，顶部双色大标题，底部一条标语横幅。", "text"),
		opt("set-points-split", "卖点总览｜左右分栏：左侧商品中近景约占 55%，右侧竖排 3 条“图标 + 卖点 + 一行说明”，分栏线用本套强调色。", "text"),
		opt("set-points-ring", "卖点总览｜环形布局：商品在中心，卖点卡片沿圆环等距排布并以弧线连接，像新品发布会的信息总览。", "text"),
		opt("set-points-grid", "卖点总览｜四宫格卡片：上半部商品中近景约占 50%，下半部 2×2 四张等大圆角卡片各讲一个卖点并配图标，卡片间距统一。", "text"),
		opt("set-points-icons", "卖点总览｜图标环绕：商品居中约占 55%，四周 3–4 个线性图标用细引线指向对应部位，图标只对应真实可见的设计（无文字时只保留图标与引线）。"),
	}},
	{name: "细节特写", closeup: true, variants: []designOption{
		opt("set-detail-macro", "细节特写｜100mm 微距贴近一处真实可见局部，侧逆光拉出纹理，局部占满画面，角落小窗放商品全貌。"),
		opt("set-detail-windows", "细节特写｜商品中景加两到三个圆形放大窗展示真实局部（微距），放大窗用细线连接到对应部位。"),
		opt("set-detail-trio", "细节特写｜上下分屏：上方商品全貌，下方三格等大的局部特写，每格一行短说明。"),
		opt("set-detail-texture", "细节特写｜材质纹理：100mm 微距贴近商品表面，侧逆光拉出纹理或光泽，局部占满画面，左下角一行短说明。"),
		opt("set-detail-split", "细节特写｜整体与局部：左侧商品全貌约占 45%，右侧上下两个微距特写窗展示两处不同的真实局部，细线连接对应位置。"),
	}},
	{name: "使用场景", people: true, variants: []designOption{
		opt("set-scene-person", "使用场景｜人物正在使用商品的中景，商品清楚处在视觉中心，35mm 平视浅景深，标题放在环境留白处。", "people"),
		opt("set-scene-hands", "使用场景｜手部特写互动：手正在打开、按压或握持商品，85mm 中近景，背景是场景的柔焦延伸。", "people"),
		opt("set-scene-routine", "使用场景｜日常动作：人物在真实生活空间里完成一个使用动作（按品类改写，如倒取、整理、收纳），商品处在动作中心，50mm 平视浅景深，标题放在留白处。", "people"),
		opt("set-scene-together", "使用场景｜同伴互动：两位人物（家人、朋友或照护者与孩子，按品类选择）围绕商品自然互动，商品清楚可辨，35mm 平视，暖色侧光。", "people"),
		opt("set-scene-still", "使用场景｜无人静物场景：商品放在真实使用环境的台面上，窗光与生活道具交代用途，标题放在亮部留白。"),
		opt("set-scene-desk", "使用场景｜俯拍桌面叙事：商品与同场景物品按使用顺序摆放，像正在被使用的一刻，标题在顶部。"),
	}},
	{name: "多角度", variants: []designOption{
		opt("set-angles-row", "多角度｜正面、侧面、背面三个视角横向等距排列，统一尺度与光线，底部细线标注视角名称。"),
		opt("set-angles-main", "多角度｜主视角大图约占画面 60%，右侧竖排两个小窗显示侧面与顶面，背景统一。"),
		opt("set-angles-turn", "多角度｜旋转台上的连续角度：三个角度半透明叠影排开，表现 360° 外观，背景纯色。"),
		opt("set-angles-grid", "多角度｜四视角宫格：2×2 四格分别是正面、侧面、背面与俯视，统一尺度与光线，格间细白边，每格一个视角小标签。"),
		opt("set-angles-low-top", "多角度｜仰俯对照：上半部低机位仰拍表现体量，下半部 90° 俯拍表现顶面轮廓，两格同一光线，中间一条细线分隔。"),
	}},
	{name: "尺寸或规格", variants: []designOption{
		opt("set-spec-lines", "尺寸或规格｜商品平视无畸变，细线与端点标出长宽高，数值只用卖家资料；没有数据时只做与手掌或日用品的比例对照。"),
		opt("set-spec-card", "尺寸或规格｜规格卡：商品三分之四视角在左，右侧白色信息卡逐行列出 4–6 项规格并配线性图标（只写卖家资料或图上可见信息）。", "text"),
		opt("set-spec-box", "尺寸或规格｜包装与配件清单：俯拍平铺真实部件并编号，每件配一个小标签。"),
		opt("set-spec-ruler", "尺寸或规格｜比例参照：商品与一件常见日用品并排平视、无畸变，背景是浅色细网格，网格只做比例参照，不写未确认的数值。"),
		opt("set-spec-views", "尺寸或规格｜三视尺寸：正面、侧面、顶面三个视角等距排列，细线与端点标出主要尺寸（数值只用卖家资料，没有数据时只画比例线、不写数字）。"),
	}},
	{name: "场景二/人物", people: true, variants: []designOption{
		opt("set-scene2-move", "场景二/人物｜换到完全不同的环境（如从居家换到户外或通勤），人物与商品互动的另一个动作，35mm 抓拍感。", "people"),
		opt("set-scene2-portrait", "场景二/人物｜人物半身情绪特写，商品在手中或身旁清楚可辨，85mm 浅景深，标题放在人物视线方向的留白。", "people"),
		opt("set-scene2-night", "场景二/人物｜夜晚光池：室内夜景的暖色光池里人物使用商品，周围暗而有层次，85mm 中近景，浅色小字标题。", "people"),
		opt("set-scene2-outdoor", "场景二/人物｜户外光线：自然光户外环境里人物在行走或休憩中使用或携带商品，逆光勾出轮廓，35mm 平视，标题放在天空或墙面留白。", "people"),
		opt("set-scene2-space", "场景二/人物｜无人环境宽景：商品在另一个真实空间中的真实尺度，约占画面 25% 但处在光线最亮处。"),
		opt("set-scene2-grid", "场景二/人物｜多场景拼图：2×2 四格不同场景，每格商品清楚可辨，顶部一行总标题。"),
	}},
	{name: "收束", variants: []designOption{
		opt("set-end-cover", "收束｜回到完整商品的新角度，居中大留白，品牌情绪大标题与一行标语，像品牌画册封底。"),
		opt("set-end-echo", "收束｜商品回到首张的场景色调，与系列色彩首尾呼应，底部一行品牌标语与细线信息条。"),
		opt("set-end-flatlay", "收束｜俯拍收尾：90° 俯拍商品与本套道具整齐归位在台面上，像使用结束后的整洁一角，顶部一行品牌标语。"),
		opt("set-end-blank", "收束｜纯色留白：商品小而精地放在画面下三分之一，上方大面积本套主色留白，一行大号标题与一行小字。"),
		opt("set-end-scene", "收束｜场景宽景：35mm 拍出商品回到真实使用空间的宽景，商品处在光线最亮处约占画面 30%，上方一句收尾标语。"),
		opt("set-end-family", "收束｜多色或多件全家福陈列（只放真实款式），顶部系列标题，作为整套的最后一张。", "multi"),
	}},
}

// Short sets keep the most persuasive roles, then restore reading order;
// longer sets repeat the middle roles before the closing image.
var (
	designSetPriority = []int{0, 1, 3, 2, 7, 4, 6, 5}
	designSetExtra    = []int{2, 3, 6, 4, 1}
)

// Detail pages: every entry starts with an informationComponent category and
// names the product state, as the planning contract and ProductStateRule
// require. The first page is a 卖点总览 or 标题导语 opener; the last page always
// carries 4–6 product facts.
var designDetailFirst = []designOption{
	opt("dt-first-plinth", "卖点总览｜首屏台座英雄：顶部小号英文品类标签 + 超大双色主标题 + 卖点标签条（3–4 个短卖点用“/”分隔），完整新品站在主题台座上居中约占 55%，两侧 3–4 个图标卖点气泡用细引线指向对应部位，底部一条标语横幅（商品状态：完整新品）"),
	opt("dt-first-ring", "卖点总览｜首屏环形信息：商品居中悬浮约占 50%，3–4 张卖点卡片沿圆环等距环绕并用弧形引线连接，背景是本套主色径向渐变，标题在顶部、标语在底部（商品状态：完整新品）"),
	opt("dt-first-diagonal", "卖点总览｜首屏斜切大字：背景按 15° 斜切为本套主辅两色，双色超大标题沿斜线排布，商品三分之四视角跨越分割线约占 55%，卖点气泡贴在分割线两侧（商品状态：完整新品）"),
	opt("dt-first-flatlay", "卖点总览｜首屏俯拍陈列：90° 俯拍，商品居中约占 45%，周围按网格摆放真实随附配件或用途相关道具，四角 3–4 个编号卖点卡片，顶部横向大标题（商品状态：完整新品与随附配件或道具）"),
	opt("dt-first-cover", "标题导语｜首屏杂志封面：超大衬线刊头横跨顶部，商品偏下居中约占 50% 并轻压刊头底边形成前后层次，左下两行导语与 3 个小号卖点词，大留白（商品状态：完整新品）"),
	opt("dt-first-portrait", "标题导语｜首屏人物情绪大片：人物正在使用商品的半身中景占满画面，商品清楚处在视线焦点，标题与一句导语放在人物视线方向的留白，右下角 2–3 个短卖点标签（商品状态：使用中）", "people"),
	opt("dt-first-scene", "标题导语｜首屏场景宽景：35mm 拍出商品所在的真实使用空间，商品处在光线最亮的视觉中心约占 35%，上方大面积墙面或天空留白放标题与导语（商品状态：完整新品与环境同框）"),
}

var designDetailLast = []designOption{
	opt("dt-last-card", "规格卡｜产品信息收尾：上半部情感场景大图 + 大标题，下半部产品信息卡逐行列出 4–6 项（如容量、尺寸、材质、适用人群、核心特点、使用与清洁）并配线性图标，底部一句品牌标语（商品状态：完整新品）"),
	opt("dt-last-card-person", "规格卡｜产品信息收尾（人物版）：上半部人物与商品的情感大图 + 大标题，下半部产品信息卡逐行列出 4–6 项并配线性图标，底部一句品牌标语（商品状态：完整新品）", "people"),
	opt("dt-last-table", "规格卡｜参数表收尾：左侧商品三分之四视角约占 45%，右侧白色信息卡逐行列出 4–6 项产品信息（图标 + 项目名 + 内容），底部细线下一句品牌标语（商品状态：空置展示，看清结构）"),
	opt("dt-last-views", "规格卡｜三视信息页：正面、侧面、顶面三个视角等距排列并用细线标注主要尺寸（数值只用卖家资料或图上可见刻度），下方 4–6 项产品信息网格卡与品牌标语（商品状态：完整新品）"),
	opt("dt-last-family", "规格卡｜全家福信息页：上半部多色或多件组合整齐陈列（只放真实款式），下半部 2×3 信息卡网格写 4–6 项产品信息，底部品牌标语（商品状态：多色或多件组合）", "multi"),
	opt("dt-last-blank", "留白收束｜极简封底：完整商品换新角度居中约占 40%，四周大面积本套主色留白，上方一行品牌情绪标题，底部一条细线信息条横排 4–6 项产品信息（商品状态：完整新品）"),
	opt("dt-last-echo", "留白收束｜场景回望：商品回到首屏的场景色调，35mm 宽景，上方一句标语，下方半透明信息条列出 4–6 项产品信息并配图标（商品状态：使用后整洁归位）"),
}

var designDetailRoles = []designRole{
	{name: "情感场景", people: true, variants: []designOption{
		opt("dt-emotion-wide", "场景注释｜情感使用场景：人物正在使用商品的全幅中景，商品清楚处在视觉焦点，35mm 平视浅景深，一角大标题 + 2 个短标签（商品状态：使用中）", "people"),
		opt("dt-emotion-touch", "场景注释｜亲密互动：85mm 拍人物的手与面部和商品互动的瞬间，背景柔焦暖光，标题放在留白一侧并配一句情绪短句（商品状态：使用中）", "people"),
		opt("dt-emotion-company", "场景注释｜陪伴瞬间：人物与家人、朋友或宠物共处的一刻，商品自然处在互动中心，暖色侧逆光，左上标题与一句场景说明（商品状态：使用中）", "people"),
		opt("dt-emotion-still", "场景注释｜情感静物：无人画面，商品放在刚被使用过的生活场景里（床头、餐桌或工位），保留生活痕迹，窗光斜射，标题与 2 个短标签放在亮部留白（商品状态：使用后静置）"),
	}},
	{name: "微距细节", closeup: true, variants: []designOption{
		opt("dt-macro-corners", "细节放大窗｜核心细节：商品中景居中，四角各一个圆形放大窗展示真实可见局部（微距），每个放大窗配图标卖点卡片并用细线连到对应部位（商品状态：空置，看清结构与做工）"),
		opt("dt-macro-full", "细节放大窗｜微距大特写：100mm 微距让一处关键局部占满画面约 70%，侧逆光拉出纹理与边缘，右下角小窗嵌入商品全貌，2 个卖点标签贴近细节（商品状态：局部微距）"),
		opt("dt-macro-loupe", "细节放大窗｜放大镜视角：商品三分之四视角在左，右侧一个大号放大镜窗口展示局部特写，窗口内外用虚线引线连接，下方两行说明（商品状态：完整新品）"),
		opt("dt-macro-trio", "细节放大窗｜三格细节：上方商品全貌约占 40%，下方三个等大方格展示三处真实局部特写，每格一行短说明（商品状态：空置展示）"),
	}},
	{name: "功能图标", variants: []designOption{
		opt("dt-icons-cards", "图标组｜核心功能卖点：3–4 个功能图标卡（功能名 + 一句说明）横排或 2×2 排列，商品换到侧面或三分之四视角约占 45%（商品状态：与上屏不同的内容物量或开合状态）"),
		opt("dt-icons-columns", "图标组｜功能双列：商品居中，两侧各竖排 3 个小图标，每个图标配 4–6 字功能名，顶部标题加一句副标题（商品状态：开合或展开状态）"),
		opt("dt-icons-strip", "图标组｜功能条带：上半部商品俯拍约占 50%，下半部一条横向功能条带，4 个等宽图标单元用细竖线分隔（商品状态：满量或装载状态）"),
	}},
	{name: "多场景拼图", people: true, variants: []designOption{
		opt("dt-grid-three", "场景注释｜多场景拼图：顶部大标题 + 3 宫格场景卡（按品类改写，如居家、外出、成长），格内有人物使用，每格配图标与短说明（商品状态：三格各不相同）", "people"),
		opt("dt-grid-day", "场景注释｜全天四格：2×2 四格分别是清晨、午后、傍晚、夜晚的使用场景，人物在每格中动作不同，格间细白边（商品状态：四格各不相同）", "people"),
		opt("dt-grid-bands", "场景注释｜场景条带：三条横向长画面自上而下排列三个不同环境，商品在每条中清楚可辨，左侧小号场景名标签，可无人物（商品状态：三条各不相同）"),
	}},
	{name: "对照", variants: []designOption{
		opt("dt-compare-sides", "双栏对照｜痛点对比：普通做法与本商品设计左右分栏对照，左侧灰调、右侧本套主色，对勾与叉号图标，底部结论条（商品状态：功能演示，如倒置不漏或密封）"),
		opt("dt-compare-stack", "双栏对照｜上下对照：上半部是使用前的困扰场景（灰调、略杂乱），下半部是使用本商品后的整洁场景，中间一条强调色分隔线与箭头（商品状态：使用前后对比）"),
		opt("dt-compare-states", "双栏对照｜状态对照：同一机位同一光线并排两种状态（收起与展开、空置与装满），中间细线分隔，每侧一个短标签（商品状态：两种状态对照）"),
		opt("dt-compare-person", "双栏对照｜人物前后：同一人物在左右两格中使用前后的动作与神情对比，商品在右格清楚出现，底部结论条（商品状态：使用中）", "people"),
	}},
	{name: "结构拆解", closeup: true, variants: []designOption{
		opt("dt-parts-explode", "细节放大窗｜结构拆解：组件沿轴线爆炸分层或拆开平铺（只拆真实可见的外部部件），逐个用细引线标注部件与卖点，关键连接处配局部特写小窗（商品状态：拆解组件）"),
		opt("dt-parts-layers", "细节放大窗｜分层悬浮：外部部件沿垂直方向分层悬浮（概念示意，只用可见外观），每层右侧一行标注，底部一个局部特写圆窗（商品状态：拆解组件）"),
		opt("dt-parts-wire", "细节放大窗｜线框示意：商品侧面大图约占 50%，半透明线框勾出可见结构层次（不画未知内部零件），右侧两个局部特写窗（商品状态：空置展示）"),
		opt("dt-parts-order", "细节放大窗｜装配顺序：俯拍配件按装配顺序平铺并编号，其中两处连接或密封部位用局部微距放大窗展示（商品状态：拆解组件）"),
	}},
	{name: "另一场景", people: true, variants: []designOption{
		opt("dt-scene-carry", "场景注释｜另一真实场景：换环境、景别与人物动作（如外出携带或收纳），35mm 抓拍感，一角标题 + 2 个短标签（商品状态：收纳或携带）", "people"),
		opt("dt-scene-outdoor", "场景注释｜户外光线：自然光户外环境，人物在行走或休憩中使用商品，逆光勾出轮廓，标题放在天空留白（商品状态：携带使用中）", "people"),
		opt("dt-scene-night", "场景注释｜夜晚光池：室内夜景的暖色光池里人物使用商品，周围暗而有层次，浅色小字标题（商品状态：使用中）", "people"),
		opt("dt-scene-storage", "场景注释｜收纳一刻：商品被收进包、抽屉或柜格的瞬间，俯拍或平视，环境整洁有序，标题与 2 个标签放在留白处，可无人物（商品状态：收纳状态）"),
	}},
	{name: "步骤", variants: []designOption{
		opt("dt-steps-hands", "步骤编号｜使用三步：三格横排分镜，每格一个手部动作（打开、使用、收纳），配 01/02/03 大号编号与一句说明，统一俯拍机位（商品状态：使用中分步）", "people"),
		opt("dt-steps-timeline", "步骤编号｜竖向时间线：左侧竖线串起 3–4 个步骤节点，右侧每步一张商品小图与一句说明，顶部标题（商品状态：分步演示）"),
		opt("dt-steps-care", "步骤编号｜清洁收纳：三格展示拆开、清洗、晾干或收纳的步骤，编号圆点加短句（商品状态：拆解与清洁）"),
		opt("dt-steps-cycle", "步骤编号｜一图流程：商品在中心，四周 4 个编号节点顺时针排列并用弧形箭头连接，每个节点一个动作图标与 4–6 字说明（商品状态：完整新品）"),
	}},
	{name: "侧栏目录", variants: []designOption{
		opt("dt-index-points", "侧栏目录｜卖点目录：左侧窄栏竖排 4–5 个编号卖点（01–05），右侧大图是商品三分之四视角约占 55%，本页讲解的卖点在目录中高亮（商品状态：完整新品）"),
		opt("dt-index-styles", "侧栏目录｜款式目录：右侧窄栏列出颜色、规格或适用场景，左侧大图是对应款式，目录项配小色块或图标（商品状态：多色或多件组合）", "multi"),
		opt("dt-index-scenes", "侧栏目录｜场景目录：右侧窄栏竖排 3–4 个适用场景并配线性图标，左侧大图是商品在其中一个场景里的使用画面，本页场景在目录中高亮（商品状态：使用中）"),
		opt("dt-index-chapter", "侧栏目录｜章节导航：顶部横向细栏写章节名与页码，左侧竖排 3 个卖点小节，右侧是商品与场景大图，像品牌画册的目录页（商品状态：完整新品与场景同框）"),
	}},
	{name: "情绪长图", people: true, variants: []designOption{
		opt("dt-mood-film", "标题导语｜情绪长图：全幅氛围大片，人物与商品处在光线最美的时刻，上部大号标题 + 两行导语，下部留白自然过渡到下一屏（商品状态：使用中）", "people"),
		opt("dt-mood-voice", "标题导语｜人物独白：人物近景望向画外，商品在手中或身旁，旁边一句第一人称短句作标题（只写场景感受，不写功效）（商品状态：使用中）", "people"),
		opt("dt-mood-manifesto", "标题导语｜品牌宣言：大面积本套主色背景，中央两行大字品牌宣言，商品小而精地放在文字下方约占 30%，像品牌态度页（商品状态：完整新品）"),
		opt("dt-mood-chapter", "标题导语｜场景开篇：35mm 宽景交代一个具体场景（如周末清晨的厨房），商品处在视觉中心约占 30%，左上标题与一句导语，像章节开篇（商品状态：与环境同框）"),
	}},
}

// UI kits name the label shape, icon style, leader line and magnifier, number
// and card material, and decoration of one set.
var designUIKits = []designOption{
	opt("ui-soft", "柔软胶囊套件：奶油色圆角胶囊标签与小圆点；双色面性圆润图标，圆角统一；圆头虚线引线配白描边圆形放大窗，带柔和投影；圆形色块数字编号，奶油白大圆角软卡片；装饰为云朵、小星星与爱心贴纸，每屏不超过 3 处。", "x:listing", "x:b2b-global", "c:maternal", "c:pet", "c:food", "c:home", "c:general", "f:xiaohongshu", "f:pdd", "f:wechat", "f:aikucun", "s:静谧治愈", "s:活力趣味"),
	opt("ui-hud", "科技 HUD 套件：锐角切角标签与细线框；1.5px 线性科技图标；直角折线引线配方形取景框放大窗，取景框四角带刻度；等宽字体编号 01/02，半透明深色玻璃卡带细亮边；装饰为点阵网格、扫描线与少量光点。", "c:tech", "c:appliance", "c:sport", "c:general", "f:shelf", "f:dewu", "f:mobile-cross", "s:电音燃动", "s:都市质感"),
	opt("ui-pearl", "珠光细线套件：发丝细线框标签配珠光底色；极细线性图标；发丝引线配细金或细银描边的圆形放大窗；细衬线罗马数字编号，珠光白卡与细金边；装饰为水滴光斑、花枝剪影或丝绸褶皱局部。", "c:beauty", "c:home", "c:bathroom", "c:apparel", "c:general", "f:vipshop", "f:shelf", "f:indie", "s:静谧治愈", "s:都市质感"),
	opt("ui-journal", "手账拼贴套件：撕纸胶带标签与便签纸；马克笔手绘图标，线条略带抖动；手绘箭头引线配手撕边不规则放大窗；手写圈码编号，牛皮纸或方格便签卡片；装饰为贴纸、手写批注与荧光笔划线。", "f:xiaohongshu", "f:wechat", "f:aikucun", "x:listing", "x:b2b-global", "x:wholesale", "s:活力趣味", "s:潮流先锋", "s:静谧治愈"),
	opt("ui-burst", "爆款冲击套件：爆炸星形贴与斜切色块标签；带高光的 3D 面性图标；粗箭头引线配粗描边圆形放大窗；超大粗体数字编号，高饱和色块卡片；装饰为速度线、闪光与放射线。", "f:short-video", "f:pdd", "f:mobile-cross", "x:indie", "x:vipshop", "x:listing", "x:b2b-global", "x:railway", "x:dewu", "x:xiaohongshu", "x:wechat", "s:活力趣味", "s:潮流先锋", "s:电音燃动"),
	opt("ui-seal", "东方印章套件：朱红印章方标签与竖排题签；单线白描国风图标；回纹折线引线配圆形月洞放大窗；中文数字编号（壹、贰、叁），宣纸或绢纹卡片；装饰为云纹、窗棂与淡墨晕染。", "x:listing", "x:b2b-global", "c:food", "c:home", "c:beauty", "c:maternal", "c:general", "f:railway", "f:shelf", "f:wechat", "s:潮流先锋", "s:活力趣味"),
	opt("ui-editorial", "编辑无框套件：无框文字标签加细下划线；几乎不用图标，必要时用极细线图标；极细直线引线配矩形裁切放大窗；大号细体数字编号与页码，不用卡片、以大留白分区；装饰为期号角标、细分隔线与引号。", "f:indie", "f:vipshop", "f:xiaohongshu", "f:shelf", "s:都市质感", "s:静谧治愈"),
	opt("ui-frost", "磨砂玻璃套件：半透明磨砂玻璃胶囊标签；线性加面性双色图标；圆点引线配柔边圆形放大窗；圆角方块数字编号，磨砂玻璃卡片带背景模糊与 1px 白色描边；装饰为柔光渐变光斑，每屏 1–2 处。", "c:appliance", "c:beauty", "c:tech", "c:bathroom", "c:home", "c:general", "f:shelf", "f:mobile-cross", "s:电音燃动", "s:都市质感", "s:静谧治愈"),
	opt("ui-tag", "潮流吊牌套件：尺码条与票据式标签；等宽字体编号与条形码；刻度尺引线配方形取景框放大窗；吊牌、鞋盒标签与票据纸卡片；装饰为胶带、条形码与喷漆箭头。", "x:listing", "x:b2b-global", "c:apparel", "c:sport", "c:tech", "c:general", "f:dewu", "f:short-video", "f:indie", "s:潮流先锋", "s:电音燃动"),
	opt("ui-clean", "白底信息图套件：浅灰圆角矩形标签；同一线宽与圆角的线性图标；细灰引线配白描边圆形放大窗；简洁无衬线数字编号，白卡加极淡阴影；不用装饰，信息清楚克制。", "f:listing", "f:b2b-global", "f:wholesale", "f:shelf", "f:default"),
	opt("ui-film", "复古胶片套件：胶片齿孔边标签与旧标签纸；打字机字体编号；手绘虚线引线配邮戳圆窗放大；复古相纸白边卡片；装饰为胶片颗粒、轻微漏光与日期戳。", "x:listing", "x:b2b-global", "c:food", "c:apparel", "c:home", "c:tech", "c:beauty", "c:general", "f:xiaohongshu", "f:indie", "f:wechat", "s:都市质感", "s:静谧治愈"),
	opt("ui-sport", "运动号码套件：号码布标签与斜切角标；粗线性运动图标；斜切折线引线配六边形放大窗；斜体粗数字编号，碳纤维纹或网眼纹卡片；装饰为速度线与荧光描边。", "x:listing", "x:b2b-global", "c:sport", "c:tech", "c:apparel", "c:appliance", "f:short-video", "f:dewu", "f:mobile-cross", "s:电音燃动", "s:潮流先锋"),
	opt("ui-craft", "自然手作套件：牛皮纸吊牌与麻绳标签；手绘植物线稿图标；细枝状引线配圆形叶片放大窗；手写数字编号，再生纸或压花纸卡片；装饰为叶片剪影、压花与纸纹。", "x:listing", "x:b2b-global", "c:food", "c:beauty", "c:home", "c:maternal", "c:pet", "c:bathroom", "c:general", "f:indie", "f:xiaohongshu", "f:railway", "s:静谧治愈", "s:活力趣味"),
	opt("ui-neon", "赛博霓虹套件：发光描边标签；霓虹线性图标；发光引线配故障错位放大窗；像素字体编号，黑色半透明卡加霓虹边；装饰为声波线、像素网格与故障条纹。", "x:listing", "c:tech", "c:sport", "c:apparel", "c:general", "f:dewu", "f:short-video", "x:railway", "x:b2b-global", "s:电音燃动", "s:潮流先锋"),
}

var designTypography = []designOption{
	opt("ty-round", "标题用圆润综艺粗体（站酷快乐体一类），正文用圆角黑体，数字用圆体；标题字距略紧，正文行距 1.6 倍。", "c:maternal", "c:pet", "c:food", "c:general", "f:pdd", "f:xiaohongshu", "f:wechat", "f:aikucun", "s:活力趣味", "s:静谧治愈"),
	opt("ty-condensed", "标题用窄体几何黑体或思源黑体 Heavy，正文用细线黑体，参数数字用等宽字体，拉丁字母全大写点缀。", "c:tech", "c:appliance", "c:sport", "c:bathroom", "c:general", "f:shelf", "f:dewu", "s:电音燃动", "s:都市质感"),
	opt("ty-song", "标题用高对比宋体（标宋或 Didot 风格衬线），正文用细黑体，英文小标签用细衬线斜体。", "c:beauty", "c:home", "c:apparel", "c:bathroom", "c:food", "c:general", "f:vipshop", "f:indie", "f:shelf", "s:静谧治愈", "s:都市质感"),
	opt("ty-sign", "标题用手写招牌体或毛笔字，正文用人文黑体，数字用粗黑体。", "c:food", "c:pet", "c:general", "f:railway", "f:wechat", "f:xiaohongshu", "s:活力趣味", "s:潮流先锋"),
	opt("ty-callig", "标题用书法行楷，正文用宋体，竖排题签点缀，英文用细衬线。", "c:food", "c:home", "c:beauty", "c:general", "f:railway", "f:shelf", "x:listing", "x:mobile-cross", "x:b2b-global", "s:潮流先锋", "s:静谧治愈"),
	opt("ty-sport", "标题用斜切压缩超粗黑体，数字像赛事号码，正文用窄体黑体。", "c:sport", "c:tech", "c:apparel", "c:appliance", "c:general", "f:short-video", "f:dewu", "f:mobile-cross", "s:电音燃动", "s:潮流先锋"),
	opt("ty-didone", "标题用超大 Didone 或 Garamond 风格衬线英文，配中文细宋体副标题，正文用细栏无衬线。", "c:apparel", "c:beauty", "c:home", "c:food", "c:general", "f:indie", "f:vipshop", "s:都市质感", "s:静谧治愈"),
	opt("ty-note", "标题用手写批注体加荧光笔底色，正文用圆体，小标签用打字机字体。", "f:xiaohongshu", "f:wechat", "x:listing", "x:b2b-global", "x:wholesale", "s:活力趣味", "s:静谧治愈", "s:潮流先锋"),
	opt("ty-outline", "标题用超粗无衬线加 4–6px 描边与投影，正文用粗黑体，关键数字放大到标题的 1.5 倍。", "f:short-video", "f:pdd", "f:mobile-cross", "x:indie", "x:vipshop", "x:railway", "x:listing", "x:xiaohongshu", "x:wechat", "s:活力趣味", "s:潮流先锋", "s:电音燃动"),
	opt("ty-geometric", "标题用 Futura、DIN 一类几何无衬线的目标语言字形，正文用 Inter、Helvetica 一类中性无衬线，字重对比明确。", "p:listing", "p:b2b-global", "p:mobile-cross", "p:indie"),
	opt("ty-typewriter", "标题用打字机字体与复古衬线混排，正文用复古等宽字，配日期戳式小标签。", "c:food", "c:apparel", "c:home", "c:tech", "c:beauty", "c:general", "f:xiaohongshu", "f:indie", "s:都市质感", "s:潮流先锋"),
	opt("ty-bubble", "标题用气泡圆体或卡通变形字加彩色描边，正文用圆角黑体。", "c:maternal", "c:pet", "c:food", "c:general", "f:pdd", "f:short-video", "f:aikucun", "x:indie", "x:vipshop", "s:活力趣味"),
}

// Scenes per product category; the run draws a few and assigns them by page.
var designScenes = map[string][]designOption{
	"maternal": {
		opt("s-ma-nursery", "清晨洒满窗光的婴儿房，原木婴儿床与针织毯"),
		opt("s-ma-playmat", "客厅爬行垫上的亲子游戏角，散落几块木质积木"),
		opt("s-ma-balcony", "午后阳台的藤编摇椅与纱帘，暖色逆光"),
		opt("s-ma-nightlight", "夜间卧室的暖色小夜灯光池，安静柔和"),
		opt("s-ma-park", "公园草坪上的野餐垫与婴儿推车"),
		opt("s-ma-kitchen", "厨房岛台旁的冲调与清洗角，收纳整齐"),
		opt("s-ma-car", "周末自驾的车内后座儿童座椅旁"),
		opt("s-ma-grandma", "祖辈家中的老木桌与碎花桌布，温暖怀旧"),
		opt("s-ma-books", "早教绘本角，矮书架与软垫"),
	},
	"beauty": {
		opt("s-be-vanity", "晨光梳妆台，圆镜与白色大理石台面"),
		opt("s-be-basin", "浴室洗手台，雾面玻璃与湿润水汽"),
		opt("s-be-stone", "洞石台座与水波焦散光的静物台"),
		opt("s-be-hotel", "酒店感卫浴里的毛巾与金属托盘"),
		opt("s-be-commute", "通勤包里的化妆包与城市晨光"),
		opt("s-be-bedside", "夜晚床头的护肤时刻，暖色台灯"),
		opt("s-be-florist", "花店般的鲜花与散落花瓣的台面"),
		opt("s-be-locker", "健身后更衣室的镜前补妆"),
		opt("s-be-seaside", "海边度假的白色窗台与草编包"),
	},
	"apparel": {
		opt("s-ap-street", "城市街角的混凝土台阶与涂鸦墙"),
		opt("s-ap-studio", "极简摄影棚的无缝背景纸与大柔光"),
		opt("s-ap-closet", "自然光衣帽间与木质衣架"),
		opt("s-ap-gallery", "美术馆白墙与几何长凳"),
		opt("s-ap-subway", "清晨地铁站台，虚化的通勤人流"),
		opt("s-ap-cafe", "咖啡店窗边座位"),
		opt("s-ap-boardwalk", "郊外草地或海边栈道的风"),
		opt("s-ap-campus", "复古校园走廊与红砖墙"),
		opt("s-ap-neon", "夜晚霓虹街头与湿润路面的反光"),
	},
	"bathroom": {
		opt("s-ba-morning", "清晨窗光洒入的浅灰石材卫生间"),
		opt("s-ba-shower", "酒店式干湿分离的玻璃淋浴区"),
		opt("s-ba-small", "小户型卫生间的收纳角与一盆绿植"),
		opt("s-ba-mirror", "夜晚暖色镜前灯下的洗漱台"),
		opt("s-ba-wabi", "原木与微水泥的侘寂风卫浴"),
		opt("s-ba-retro", "白色瓷砖与黄铜五金的复古卫浴"),
		opt("s-ba-family", "家庭卫生间的晨间忙碌时刻，多支牙刷与毛巾"),
		opt("s-ba-showroom", "样板间级的极简卫浴，大面积留白"),
	},
	"appliance": {
		opt("s-al-island", "明亮开放式厨房的岛台"),
		opt("s-al-floor", "客厅木地板与沙发旁的清洁动线"),
		opt("s-al-bedroom", "卧室夜间安静的一角"),
		opt("s-al-rental", "小户型出租屋的书桌旁"),
		opt("s-al-laundry", "阳台洗衣区与晾衣架"),
		opt("s-al-breakfast", "早餐桌上的晨光与咖啡"),
		opt("s-al-pets", "养宠家庭的客厅，猫爬架旁"),
		opt("s-al-tidy", "周末大扫除后整洁的客厅"),
		opt("s-al-summer", "夏日午后开窗通风的客厅"),
	},
	"tech": {
		opt("s-te-metro", "清晨通勤地铁车厢的窗边"),
		opt("s-te-skyline", "夜晚城市高楼窗前的书桌与台灯"),
		opt("s-te-desk", "极简白色桌面与机械键盘"),
		opt("s-te-cafe", "咖啡馆靠窗座位与笔记本电脑"),
		opt("s-te-gym", "健身房跑步机与运动毛巾"),
		opt("s-te-airport", "机场候机厅的落地窗与登机箱"),
		opt("s-te-reading", "卧室床头的夜读时刻"),
		opt("s-te-camp", "户外露营的帐篷与折叠桌"),
		opt("s-te-esports", "霓虹灯下的电竞房"),
	},
	"home": {
		opt("s-ho-nordic", "自然窗光的北欧客厅，亚麻沙发与原木茶几"),
		opt("s-ho-wabi", "侘寂风卧室，微水泥墙与亚麻床品"),
		opt("s-ho-rental", "小户型出租屋里温馨改造的角落"),
		opt("s-ho-kitchen", "开放式厨房的餐边柜"),
		opt("s-ho-garden", "阳台花园的藤编椅与绿植"),
		opt("s-ho-study", "书房的胡桃木书架与台灯"),
		opt("s-ho-entry", "玄关收纳与清晨出门的时刻"),
		opt("s-ho-midcentury", "中古风客厅，丝绒与黄铜"),
		opt("s-ho-kidsroom", "儿童房的彩色收纳"),
	},
	"food": {
		opt("s-fo-breakfast", "晨间餐桌，亚麻桌布与侧窗晨光"),
		opt("s-fo-picnic", "周末郊游的野餐垫"),
		opt("s-fo-office", "办公室工位的下午茶时刻"),
		opt("s-fo-dark", "暗调木桌上的油画式静物"),
		opt("s-fo-camp", "露营地的折叠桌与炉具"),
		opt("s-fo-party", "朋友聚会的长餐桌"),
		opt("s-fo-tea", "中式茶席与竹木器物"),
		opt("s-fo-store", "便利店式明亮货架与冷柜"),
		opt("s-fo-sofa", "夜晚追剧的沙发与毛毯"),
	},
	"sport": {
		opt("s-sp-river", "清晨城市滨江跑道"),
		opt("s-sp-weights", "健身房力量区与镜墙"),
		opt("s-sp-yoga", "瑜伽馆木地板与窗光"),
		opt("s-sp-trail", "山野徒步小径与碎石"),
		opt("s-sp-court", "夜间灯光下的篮球场"),
		opt("s-sp-pool", "游泳馆蓝色水面的反光"),
		opt("s-sp-road", "骑行公路与远处山脊线"),
		opt("s-sp-living", "家中客厅铺开瑜伽垫的一角"),
		opt("s-sp-snow", "雪场或冬季户外"),
	},
	"pet": {
		opt("s-pe-rug", "洒满阳光的客厅地毯与猫爬架"),
		opt("s-pe-park", "公园草坪的遛狗时刻"),
		opt("s-pe-grooming", "宠物美容台与吹风"),
		opt("s-pe-bed", "卧室床边的宠物窝"),
		opt("s-pe-feeding", "厨房地面的喂食角"),
		opt("s-pe-car", "自驾出游的车内后座"),
		opt("s-pe-rain", "雨天玄关的擦脚与出门准备"),
		opt("s-pe-window", "冬日窗边晒太阳的取暖角"),
	},
	"general": {
		opt("s-ge-window", "清晨窗边的木质台面"),
		opt("s-ge-apartment", "城市公寓的极简客厅"),
		opt("s-ge-cafe", "咖啡馆靠窗座位"),
		opt("s-ge-steps", "户外自然光下的石阶"),
		opt("s-ge-desk", "夜晚暖色台灯下的书桌"),
		opt("s-ge-hotel", "旅途中的酒店房间"),
		opt("s-ge-picnic", "周末野餐的草地"),
		opt("s-ge-plinth", "品牌展陈般的几何展台"),
		opt("s-ge-office", "办公室工位"),
	},
}

// Personas per product category: age, look, styling and the action with the
// product. Pools mix genders and generations so repeated runs cast differently.
var designPersonas = map[string][]designOption{
	"maternal": {
		opt("h-ma-dad", "30 岁左右的年轻爸爸，短发、浅色卫衣，一手抱着 1 岁宝宝、一手拿着商品，笑着低头看宝宝"),
		opt("h-ma-mom", "28 岁妈妈，低马尾、燕麦色针织开衫，坐在地垫上陪 8 个月大的宝宝，宝宝双手抱着商品"),
		opt("h-ma-grandma", "60 岁左右的奶奶，银灰短发、碎花衬衫，在阳台藤椅旁细心照看 2 岁孙女使用商品"),
		opt("h-ma-parents", "35 岁的双职工父母同框，爸爸推婴儿车、妈妈把商品放进妈咪包，准备出门"),
		opt("h-ma-toddler", "2 岁左右的幼儿专注地自己使用商品，表情开心，大人的手在画面边缘护着"),
		opt("h-ma-grandpa", "65 岁左右的爷爷，戴老花镜、穿开衫，坐在木桌旁给孙子读绘本，商品就在手边"),
		opt("h-ma-newmom", "25 岁新手妈妈，齐肩短发、宽松衬衫，夜里在小夜灯下温柔地使用商品"),
	},
	"beauty": {
		opt("h-be-urban", "26 岁都市女性，清透底妆、低盘发、白衬衫，在晨光梳妆台前把商品点涂在手背"),
		opt("h-be-man", "30 岁男士，干净寸头、灰色针织衫，站在浴室镜前用商品做基础护理"),
		opt("h-be-elegant", "45 岁优雅女性，及肩卷发、驼色羊绒衫，在床头暖灯下慢慢涂抹商品"),
		opt("h-be-student", "22 岁大学生，齐刘海、宽松卫衣，在宿舍书桌前对着小镜子试用商品"),
		opt("h-be-office", "35 岁职场女性，利落短发、西装外套，在通勤地铁上拿出商品补妆"),
		opt("h-be-athlete", "28 岁健身女性，高马尾、运动背心，运动后在更衣室使用商品"),
		opt("h-be-silver", "55 岁女性，银灰短发、亚麻衬衫，在洒满窗光的浴室里自然地使用商品"),
	},
	"apparel": {
		opt("h-ap-street", "24 岁街头风男生，寸头、宽松版型，在涂鸦墙前侧身行走展示商品"),
		opt("h-ap-commuter", "30 岁通勤女性，低马尾、极简妆容，在地铁站台转身的瞬间展示上身效果"),
		opt("h-ap-gentleman", "50 岁左右的男士，灰白短发、合体剪裁，在美术馆白墙前站定"),
		opt("h-ap-student", "20 岁女大学生，长直发、学院风搭配，在红砖校园走廊里回头"),
		opt("h-ap-family", "35 岁爸爸与 6 岁女儿同框，在草地上奔跑（亲子款或家庭场景时）"),
		opt("h-ap-curvy", "28 岁丰盈身材女性，卷发、自信微笑，在咖啡店窗边自然坐着展示穿着"),
		opt("h-ap-senior", "65 岁银发女性，短发、复古眼镜，在海边栈道上迎风而立"),
	},
	"bathroom": {
		opt("h-ba-morning", "32 岁男士，晨起刚洗完脸，毛巾搭在肩上，伸手使用商品"),
		opt("h-ba-woman", "30 岁女性，盘发、浴袍，在暖色镜前灯下整理洗漱台"),
		opt("h-ba-family", "一家三口的早晨：5 岁孩子踮脚刷牙，妈妈在旁边帮忙，商品在画面中心"),
		opt("h-ba-elder", "68 岁老人，短发、居家开衫，扶着台面轻松地使用商品，只表现日常便利"),
		opt("h-ba-single", "26 岁独居青年，T 恤短裤，在小户型卫生间里把商品收纳归位"),
		opt("h-ba-dad", "40 岁父亲，挽起袖子，周末给卫生间做清洁整理"),
	},
	"appliance": {
		opt("h-al-cook", "34 岁居家男士，灰色家居服，在开放式厨房用商品准备早餐"),
		opt("h-al-renter", "29 岁独居女生，毛绒拖鞋、宽松睡衣，在出租屋书桌旁使用商品"),
		opt("h-al-retirees", "60 岁左右的退休夫妇，在明亮客厅里一起研究商品的按键"),
		opt("h-al-mom", "38 岁妈妈，围裙、低马尾，一边照看孩子一边用商品做家务"),
		opt("h-al-catowner", "26 岁养猫青年，在客厅木地板上用商品清理猫毛，猫咪在旁好奇张望"),
		opt("h-al-dad", "45 岁爸爸，周末在阳台洗衣区轻松操作商品"),
	},
	"tech": {
		opt("h-te-coder", "25 岁程序员男生，黑框眼镜、连帽卫衣，在夜晚城市窗前的书桌旁使用商品"),
		opt("h-te-commuter", "28 岁通勤女性，短发、风衣，在地铁车厢窗边使用商品"),
		opt("h-te-student", "19 岁大学生，背双肩包，在校园长椅上使用商品"),
		opt("h-te-business", "40 岁商务男士，衬衫不打领带，在机场候机厅落地窗前使用商品"),
		opt("h-te-runner", "33 岁健身女性，运动服，在跑步机上使用商品"),
		opt("h-te-senior", "62 岁银发男士，开衫配老花镜，在客厅沙发上学着使用商品，表情轻松"),
		opt("h-te-gamer", "23 岁电竞玩家，潮牌外套，在霓虹电竞房里使用商品"),
	},
	"home": {
		opt("h-ho-linen", "30 岁女性，亚麻长裙，赤脚坐在北欧客厅的沙发一角使用商品"),
		opt("h-ho-cook", "35 岁男士，围裙卷袖，在开放式厨房的餐边柜旁整理商品"),
		opt("h-ho-couple", "一对 28 岁情侣，在刚搬进的小公寓里布置商品"),
		opt("h-ho-grandma", "70 岁奶奶与 8 岁孙子，在阳台花园一起使用商品"),
		opt("h-ho-designer", "45 岁设计师，短发、黑色毛衣，在胡桃木书房里安静地使用商品"),
		opt("h-ho-renter", "26 岁独居女生，在出租屋改造的温馨角落里摆放商品"),
	},
	"food": {
		opt("h-fo-breakfast", "27 岁女生，针织开衫，在晨光餐桌前打开商品准备早餐"),
		opt("h-fo-picnic", "32 岁爸爸与 5 岁儿子，在野餐垫上分享商品"),
		opt("h-fo-friends", "一群 25 岁左右的朋友，在聚会长桌上互相传递商品"),
		opt("h-fo-tea", "60 岁的爷爷在中式茶席前冲泡或品尝商品"),
		opt("h-fo-office", "30 岁职场男士，在工位下午茶时刻享用商品"),
		opt("h-fo-student", "22 岁大学生，在宿舍追剧时拆开商品"),
		opt("h-fo-camp", "35 岁妈妈在露营地的折叠桌旁给家人分装商品"),
	},
	"sport": {
		opt("h-sp-runner", "26 岁晨跑女性，高马尾、运动背心，在滨江跑道上使用商品"),
		opt("h-sp-lifter", "30 岁健身男士，紧身运动 T 恤，在力量区组间休息时使用商品"),
		opt("h-sp-cyclist", "45 岁骑行爱好者，骑行服与头盔，在山脊公路边停车使用商品"),
		opt("h-sp-teen", "20 岁篮球少年，球衣与护腕，在夜间球场边使用商品"),
		opt("h-sp-yogi", "35 岁瑜伽教练，素色瑜伽服，在木地板瑜伽馆里使用商品"),
		opt("h-sp-hiker", "58 岁徒步大叔，速干衣与登山杖，在山野小径上使用商品"),
	},
	"pet": {
		opt("h-pe-cat", "28 岁女生与橘猫，在阳光地毯上一起使用商品"),
		opt("h-pe-retriever", "35 岁男士与金毛犬，在公园草坪上使用商品"),
		opt("h-pe-girl", "8 岁小女孩与柯基，在卧室床边玩耍，商品在两者之间"),
		opt("h-pe-auntie", "62 岁退休阿姨与泰迪犬，在玄关准备出门遛弯"),
		opt("h-pe-couple", "30 岁情侣与布偶猫，在客厅猫爬架旁使用商品"),
		opt("h-pe-shiba", "26 岁独居男生与柴犬，在自驾出游的车内后座"),
	},
	"general": {
		opt("h-ge-woman", "28 岁都市女性，简约针织衫，在窗边自然地使用商品"),
		opt("h-ge-man", "32 岁男士，白 T 恤配工装裤，在公寓客厅使用商品"),
		opt("h-ge-couple", "60 岁左右的夫妇，在周末早晨的餐桌旁一起使用商品"),
		opt("h-ge-student", "21 岁大学生，在宿舍书桌前使用商品"),
		opt("h-ge-dad", "38 岁爸爸与 7 岁女儿，在客厅地毯上一起使用商品"),
		opt("h-ge-office", "45 岁职场女性，在办公室工位上使用商品"),
		opt("h-ge-senior", "70 岁银发老人，在洒满阳光的阳台上轻松地使用商品"),
	},
}

// Cross-border casting adds the target market's faces and regional styling to
// the persona; id-tagged entries belong to that platform's market.
var designCastingModifiers = []designOption{
	opt("cast-nordic", "选角：北欧裔面孔，北欧极简穿搭（针织、亚麻与低饱和色）"),
	opt("cast-black", "选角：非裔面孔，明亮配色的都市休闲穿搭"),
	opt("cast-latino", "选角：拉丁裔面孔，暖色系度假风穿搭", "id:mercado-libre"),
	opt("cast-southasian", "选角：南亚裔面孔，按商品场景选择现代日常穿搭", "id:india"),
	opt("cast-eastasian", "选角：东亚裔面孔，美式通勤休闲穿搭"),
	opt("cast-mideast", "选角：中东裔面孔，得体的长袖穿搭（女性可佩头巾），沉稳大地色", "id:noon"),
	opt("cast-sea", "选角：东南亚裔面孔，轻薄明快的热带休闲穿搭", "id:shopee", "id:lazada"),
	opt("cast-slavic", "选角：东欧裔面孔，层次分明的保暖外套与围巾", "id:ozon", "id:wildberries", "id:emag"),
	opt("cast-korean", "选角：韩国都市面孔，韩系宽松叠穿与干净底妆", "id:coupang", "id:11street"),
	opt("cast-japanese", "选角：日本都市面孔，日系简约的大地色穿搭", "id:rakuten"),
	opt("cast-mixed", "选角：混血面孔，欧美极简运动休闲风"),
	opt("cast-mediterranean", "选角：南欧地中海面孔，亚麻衬衫与草编配饰的夏日风"),
}

// DesignVariation is one random draw from the playbook for a planning run: a
// layout for every image, one UI kit, one type pairing, one persona and a few
// scenes. Signature identifies the draw so the next run can avoid it.
type DesignVariation struct {
	Seed       string   `json:"seed"`
	Layouts    []string `json:"layouts"`
	UIKit      string   `json:"uiKit"`
	Typography string   `json:"typography"`
	Persona    string   `json:"persona"`
	Scenes     []string `json:"scenes"`
	Signature  string   `json:"signature"`
	// LayoutSignature identifies the layout list alone, so a caller can keep
	// a product's next sets from repeating one exact list of layouts.
	LayoutSignature string `json:"layoutSignature"`
	// Picks are the ids of the drawn entries. They are not serialized; the
	// caller passes them back in VariationInput.Avoid on the next run.
	Picks []string `json:"-"`
}

// VariationInput describes the request a variation is drawn for. Category is a
// product category key (beauty, maternal, apparel, bathroom, appliance, tech,
// home, food, sport, pet, general). Style is optional text naming the selected
// direction (label and description); it keeps the UI kit and typography inside
// that style's family of the style library. MultiVariant is set when the
// product really has several colours, SKUs or pieces; without it entries
// tagged "multi" are never drawn. Avoid lists recent signatures, layout
// signatures and entry ids (DesignVariation.Picks): a draw whose signature or
// layout signature is listed is drawn again, and listed entries are skipped
// while the pool still has other fitting entries.
type VariationInput struct {
	ImageType, Platform, Category, Distribution, Purpose, Style string
	Region, Language                                            string
	Count                                                       int
	NoText, PeopleAllowed, MultiVariant                         bool
	Avoid                                                       []string
}

// PickDesignVariation draws the layouts, UI kit, typography, persona and
// scenes of one run from the playbook. Layouts fit the content type and
// platform and do not repeat within a set while the pool allows; detail pages
// open with 卖点总览 or 标题导语, close with 规格卡 or 留白收束, never repeat an
// informationComponent on adjacent pages, include at least two close-ups and,
// when people are allowed, at least three pages with people.
func PickDesignVariation(r *rand.Rand, in VariationInput) DesignVariation {
	r = designRand(r)
	avoid := make(map[string]bool, len(in.Avoid))
	for _, key := range in.Avoid {
		if key = strings.TrimSpace(key); key != "" {
			avoid[key] = true
		}
	}
	v := drawDesignVariation(r, in, avoid)
	for attempt := 1; attempt < 8 && (avoid[v.Signature] || avoid[v.LayoutSignature]); attempt++ {
		v = drawDesignVariation(r, in, avoid)
	}
	return v
}

type designPicker struct {
	r        *rand.Rand
	family   string
	platform string
	category string
	style    string
	noText   bool
	people   bool
	multi    bool
	avoid    map[string]bool
	used     map[string]bool
}

// designStyleGroup names the style-library family (静谧治愈, 电音燃动, 潮流先锋,
// 都市质感, 活力趣味) closest to a direction, or "" when nothing matches.
func designStyleGroup(style string) string {
	if strings.TrimSpace(style) == "" {
		return ""
	}
	if preset, ok := MatchStylePreset(style); ok {
		return preset.Group
	}
	return ""
}

func drawDesignVariation(r *rand.Rand, in VariationInput, avoid map[string]bool) DesignVariation {
	kind := strings.TrimSpace(in.ImageType)
	category := strings.TrimSpace(in.Category)
	if _, ok := designScenes[category]; !ok {
		category = "general"
	}
	p := &designPicker{r: r, family: platformFamily(in.Platform), platform: platformKey(in.Platform), category: category, style: designStyleGroup(in.Style), noText: in.NoText, people: in.PeopleAllowed && kind != "white" && kind != "three-view", multi: in.MultiVariant, avoid: avoid, used: map[string]bool{}}
	v := DesignVariation{Seed: fmt.Sprintf("%08x", r.Uint32())}
	layouts := p.layouts(kind, min(max(in.Count, 1), 30), in)
	picks := make([]string, 0, len(layouts)+8)
	pure, withPeople := true, false
	for _, layout := range layouts {
		v.Layouts = append(v.Layouts, layout.text)
		picks = append(picks, layout.id)
		pure = pure && layout.has("white")
		withPeople = withPeople || layout.has("people")
	}
	v.LayoutSignature = "layouts:" + designSignature(picks)
	// Pure-white images carry no UI, text, people or scene.
	if !pure {
		if kit, ok := p.pickPreferred(designUIKits); ok {
			v.UIKit, picks = kit.text, append(picks, kit.id)
		}
		if !in.NoText {
			if pairing, ok := p.pickPreferred(designTypography); ok {
				v.Typography, picks = pairing.text, append(picks, pairing.id)
			}
		}
		if p.people && (withPeople || designPersonaTypes[kind]) {
			if persona, ok := p.pickOne(designPersonas[category]); ok {
				v.Persona, picks = persona.text, append(picks, persona.id)
				market, overseas, direction := designCastingMarket(in)
				v.Persona += "；市场人物方向：" + direction
				if overseas {
					casting := *p
					casting.platform = market
					if cast, ok := casting.pickCasting(); ok {
						v.Persona, picks = v.Persona+"；"+cast.text, append(picks, cast.id)
					}
				}
				if face, ok := p.pickOne(designFaceDetails); ok {
					v.Persona, picks = v.Persona+"；"+face.text, append(picks, face.id)
				}
				v.Persona += "；按商品明确的适用人群校准年龄与性别，脸部识别点服从人物年龄和已上传参考。逐张 prompt 复述本轮人物面貌与自然肤质，不能只写漂亮模特或只改变衣服。"
			}
		}
		for _, scene := range p.pick(designScenes[category], designSceneCounts[kind]) {
			v.Scenes, picks = append(v.Scenes, scene.text), append(picks, scene.id)
		}
	}
	v.Picks, v.Signature = picks, designSignature(picks)
	return v
}

// designPersonaTypes always cast a persona when people are allowed; other
// types cast one only when a drawn layout shows people.
var designPersonaTypes = map[string]bool{"detail": true, "scene": true, "social": true, "marketing": true, "poster": true, "amazon-a-plus": true}

var designSceneCounts = map[string]int{"detail": 4, "set": 3, "secondary": 3, "scene": 3, "amazon-a-plus": 3, "main": 2, "single": 2, "marketing": 2, "poster": 2, "social": 2, "selling": 2, "feature": 2}

func (p *designPicker) layouts(kind string, count int, in VariationInput) []designOption {
	switch kind {
	case "detail":
		return p.detailLayouts(count)
	case "set":
		if count == 2 && strings.Contains(in.Distribution, "主图") && strings.Contains(in.Distribution, "副图") {
			return append(p.pick(p.mainPool(), 1), p.pick(designSecondaryLayouts, 1)...)
		}
		return p.setLayouts(count)
	case "main":
		return p.pick(p.mainPool(), count)
	case "secondary", "selling", "feature":
		return p.pick(designSecondaryLayouts, count)
	case "white":
		return p.pick(designWhiteLayouts, count)
	case "three-view":
		return repeatedLayout(p.pick(designThreeViewLayouts, 1), count)
	case "sku":
		return repeatedLayout(p.pick(designSkuLayouts, 1), count)
	case "single":
		return p.pick(p.singlePool(in.Purpose), count)
	case "scene":
		return p.pick(designSceneLayouts, count)
	case "marketing", "poster", "social":
		return p.pick(designMarketingLayouts, count)
	case "amazon-a-plus":
		return p.pick(designAPlusLayouts, count)
	case "size":
		return p.pick(designSizeLayouts, count)
	case "material":
		return p.pick(designMaterialLayouts, count)
	case "package":
		return p.pick(designPackageLayouts, count)
	}
	return p.pick(p.mainPool(), count)
}

func (p *designPicker) mainPool() []designOption {
	if p.family == "listing" {
		return designListingMainLayouts
	}
	return designMainLayouts
}

func (p *designPicker) singlePool(purpose string) []designOption {
	switch strings.TrimSpace(purpose) {
	case "商品主图":
		return p.mainPool()
	case "商品副图":
		return designSecondaryLayouts
	case "Banner":
		return designBannerLayouts
	case "SKU 展示":
		return designSkuLayouts
	case "商品场景图":
		return designSceneLayouts
	case "自定义":
		return designCustomLayouts
	}
	return designSingleDefaultLayouts
}

// setLayouts fills the set roles in reading order; the scene roles show people
// when allowed, and listing main images stay compliant white.
func (p *designPicker) setLayouts(count int) []designOption {
	var roles []int
	if count <= len(designSetRoles) {
		roles = append(roles, designSetPriority[:count]...)
		slices.Sort(roles)
	} else {
		roles = []int{0, 1, 2, 3, 4, 5, 6}
		for i := 0; i < count-len(designSetRoles); i++ {
			roles = append(roles, designSetExtra[i%len(designSetExtra)])
		}
		roles = append(roles, len(designSetRoles)-1)
	}
	out := make([]designOption, 0, count)
	for _, index := range roles {
		role := designSetRoles[index]
		pool := role.variants
		if index == 0 && p.family == "listing" {
			pool = prefixedLayouts(role.name+"｜", designListingMainLayouts)
		}
		if role.people && p.people {
			if tagged := taggedLayouts(pool, "people"); len(tagged) > 0 {
				pool = tagged
			}
		}
		out = append(out, p.pick(pool, 1)...)
	}
	return out
}

// detailLayouts builds a detail set: an opener, shuffled middle roles with at
// least two close-ups and up to three people pages, and a product-information
// closer, ordered so adjacent pages never share an informationComponent. When
// people are allowed but the middle is too short for three people pages, the
// opener or closer shows people instead.
func (p *designPicker) detailLayouts(count int) []designOption {
	middleCount := max(count-2, 0)
	firstPool, lastPool := designDetailFirst, designDetailLast
	if short := 3 - min(3, middleCount-min(middleCount, 2)); p.people && count >= 4 && short > 0 {
		ends := []int{0, 1}
		p.shuffleInts(ends)
		for _, end := range ends[:min(short, 2)] {
			if end == 0 {
				firstPool = taggedLayouts(designDetailFirst, "people")
			} else {
				lastPool = taggedLayouts(designDetailLast, "people")
			}
		}
	}
	first, _ := p.pickOne(firstPool)
	if count == 1 {
		return []designOption{first}
	}
	last, _ := p.pickOne(lastPool)
	middle := p.orderMiddle(designComponent(first.text), p.detailMiddle(middleCount))
	return append(append([]designOption{first}, middle...), last)
}

func (p *designPicker) detailMiddle(n int) []designOption {
	if n <= 0 {
		return nil
	}
	type slot struct {
		role   int
		people bool
	}
	slots := make([]slot, 0, n)
	taken := map[int]bool{}
	add := func(role int, people bool) {
		slots = append(slots, slot{role: role, people: people})
		taken[role] = true
	}
	var closeups, peopleRoles []int
	for i, role := range designDetailRoles {
		if role.closeup {
			closeups = append(closeups, i)
		}
		if role.people {
			peopleRoles = append(peopleRoles, i)
		}
	}
	p.shuffleInts(closeups)
	p.shuffleInts(peopleRoles)
	for _, i := range closeups {
		if len(slots) < min(n, 2) {
			add(i, false)
		}
	}
	if p.people {
		want := min(3, n-len(slots))
		for _, i := range peopleRoles {
			if want <= 0 {
				break
			}
			add(i, true)
			want--
		}
	}
	for len(slots) < n {
		var rest []int
		for i := range designDetailRoles {
			if !taken[i] {
				rest = append(rest, i)
			}
		}
		if len(rest) == 0 {
			clear(taken)
			continue
		}
		p.shuffleInts(rest)
		for _, i := range rest {
			if len(slots) == n {
				break
			}
			add(i, false)
		}
	}
	out := make([]designOption, 0, n)
	for _, s := range slots {
		pool := designDetailRoles[s.role].variants
		if s.people {
			if tagged := taggedLayouts(pool, "people"); len(tagged) > 0 {
				pool = tagged
			}
		}
		out = append(out, p.pick(pool, 1)...)
	}
	return out
}

// orderMiddle shuffles the middle pages until no two adjacent pages (or the
// opener and the first middle page) share an informationComponent, and falls
// back to a most-frequent-first arrangement for long sets.
func (p *designPicker) orderMiddle(prev string, items []designOption) []designOption {
	work := append([]designOption(nil), items...)
	if len(work) < 2 {
		return work
	}
	for attempt := 0; attempt < 200; attempt++ {
		p.r.Shuffle(len(work), func(i, j int) { work[i], work[j] = work[j], work[i] })
		if componentRepeats(prev, work) == 0 {
			return work
		}
	}
	remaining := work
	ordered := make([]designOption, 0, len(work))
	for len(remaining) > 0 {
		counts := map[string]int{}
		for _, item := range remaining {
			counts[designComponent(item.text)]++
		}
		best := -1
		for i, item := range remaining {
			component := designComponent(item.text)
			if component == prev {
				continue
			}
			if best < 0 || counts[component] > counts[designComponent(remaining[best].text)] {
				best = i
			}
		}
		if best < 0 {
			best = 0
		}
		ordered = append(ordered, remaining[best])
		prev = designComponent(remaining[best].text)
		remaining = slices.Delete(remaining, best, best+1)
	}
	return ordered
}

func componentRepeats(prev string, items []designOption) int {
	repeats := 0
	for _, item := range items {
		component := designComponent(item.text)
		if component == prev {
			repeats++
		}
		prev = component
	}
	return repeats
}

// designComponent is the informationComponent category a detail layout starts with.
func designComponent(text string) string {
	if before, _, ok := strings.Cut(text, "｜"); ok {
		return before
	}
	return ""
}

func (p *designPicker) allowed(o designOption, level int) bool {
	if (o.has("people") && !p.people) || (o.has("multi") && !p.multi) {
		return false
	}
	if o.has("x:" + p.family) {
		return false
	}
	platforms, platformMatch, categories, categoryMatch := false, false, false, false
	styles, styleMatch := false, false
	for _, tag := range o.tags {
		if name, ok := strings.CutPrefix(tag, "p:"); ok {
			platforms, platformMatch = true, platformMatch || name == p.family
		} else if name, ok := strings.CutPrefix(tag, "c:"); ok {
			categories, categoryMatch = true, categoryMatch || name == p.category
		} else if name, ok := strings.CutPrefix(tag, "s:"); ok {
			styles, styleMatch = true, styleMatch || name == p.style
		}
	}
	if platforms && !platformMatch {
		return false
	}
	if level < 1 && categories && !categoryMatch {
		return false
	}
	if level < 2 && p.style != "" && styles && !styleMatch {
		return false
	}
	return level >= 3 || !p.noText || !o.has("text")
}

// candidates relaxes the category fit, then the style fit, then the no-text
// preference, until the pool has n entries that neither a recent run nor this
// run used. People, multi-variant and platform fit are never relaxed.
func (p *designPicker) candidates(pool []designOption, n int) []designOption {
	var list []designOption
	for level := 0; level <= 3; level++ {
		list = list[:0]
		fresh := 0
		for _, o := range pool {
			if p.allowed(o, level) {
				list = append(list, o)
				if !p.avoid[o.id] && !p.used[o.id] {
					fresh++
				}
			}
		}
		if fresh >= n {
			return list
		}
	}
	if len(list) > 0 {
		return list
	}
	for _, o := range pool {
		if (p.people || !o.has("people")) && (p.multi || !o.has("multi")) {
			list = append(list, o)
		}
	}
	if len(list) > 0 {
		return list
	}
	return pool
}

// tiers splits entries into fresh ones, ones a recent run used, and ones this
// run already drew, so draws prefer the first and repeat only when needed.
func (p *designPicker) tiers(list []designOption) [3][]designOption {
	var tiers [3][]designOption
	for _, o := range list {
		switch {
		case p.used[o.id]:
			tiers[2] = append(tiers[2], o)
		case p.avoid[o.id]:
			tiers[1] = append(tiers[1], o)
		default:
			tiers[0] = append(tiers[0], o)
		}
	}
	return tiers
}

func (p *designPicker) pick(pool []designOption, n int) []designOption {
	if n <= 0 || len(pool) == 0 {
		return nil
	}
	var order []designOption
	for _, tier := range p.tiers(p.candidates(pool, n)) {
		p.weightedShuffle(tier)
		order = append(order, tier...)
	}
	out := make([]designOption, 0, n)
	for i := 0; i < n; i++ {
		o := order[i%len(order)]
		p.used[o.id] = true
		out = append(out, o)
	}
	return out
}

func (p *designPicker) pickOne(pool []designOption) (designOption, bool) {
	if picked := p.pick(pool, 1); len(picked) == 1 {
		return picked[0], true
	}
	return designOption{}, false
}

// pickPreferred draws one entry, weighting entries made for the platform
// family three times higher.
func (p *designPicker) pickPreferred(pool []designOption) (designOption, bool) {
	for _, tier := range p.tiers(p.candidates(pool, 1)) {
		total := 0
		for _, o := range tier {
			total += p.weight(o)
		}
		if total == 0 {
			continue
		}
		x := p.r.IntN(total)
		for _, o := range tier {
			if x -= p.weight(o); x < 0 {
				p.used[o.id] = true
				return o, true
			}
		}
	}
	return designOption{}, false
}

// weight favours entries made for the platform family three to one.
func (p *designPicker) weight(o designOption) int {
	if o.has("f:"+p.family) || o.has("p:"+p.family) {
		return 3
	}
	return 1
}

// weightedShuffle orders entries randomly, drawing platform-specific entries
// earlier, so they are likelier to be picked without crowding out the rest.
func (p *designPicker) weightedShuffle(list []designOption) {
	for i := range list {
		total := 0
		for _, o := range list[i:] {
			total += p.weight(o)
		}
		x := p.r.IntN(total)
		for j := i; j < len(list); j++ {
			if x -= p.weight(list[j]); x < 0 {
				list[i], list[j] = list[j], list[i]
				break
			}
		}
	}
}

// pickCasting prefers the casting of the exact target market, then any
// market-neutral casting.
func (p *designPicker) pickCasting() (designOption, bool) {
	var market, neutral []designOption
	for _, o := range designCastingModifiers {
		marked := false
		for _, tag := range o.tags {
			if id, ok := strings.CutPrefix(tag, "id:"); ok {
				marked = true
				if id == p.platform {
					market = append(market, o)
				}
			}
		}
		if !marked {
			neutral = append(neutral, o)
		}
	}
	if len(market) > 0 {
		return p.pickOne(market)
	}
	return p.pickOne(neutral)
}

func (p *designPicker) shuffleInts(values []int) {
	p.r.Shuffle(len(values), func(i, j int) { values[i], values[j] = values[j], values[i] })
}

func taggedLayouts(pool []designOption, tag string) []designOption {
	var out []designOption
	for _, o := range pool {
		if o.has(tag) {
			out = append(out, o)
		}
	}
	return out
}

func prefixedLayouts(prefix string, pool []designOption) []designOption {
	out := make([]designOption, len(pool))
	for i, o := range pool {
		out[i] = designOption{id: o.id, text: prefix + o.text, tags: o.tags}
	}
	return out
}

// repeatedLayout gives every image the same layout, for types whose images must
// match (SKU sets, three-view sets).
func repeatedLayout(picked []designOption, count int) []designOption {
	if len(picked) == 0 {
		return nil
	}
	out := make([]designOption, count)
	for i := range out {
		out[i] = picked[0]
	}
	return out
}

func designSignature(ids []string) string {
	h := fnv.New64a()
	for _, id := range ids {
		h.Write([]byte(id + "|"))
	}
	return fmt.Sprintf("%012x", h.Sum64()&0xffffffffffff)
}

// DetailOutline returns the drawn page layouts for the parallel detail
// planning batches, so every batch shares this run's outline.
func (v DesignVariation) DetailOutline() []string {
	return append([]string(nil), v.Layouts...)
}

// PromptBlock is the planning prompt's last block: the drawn layouts, UI kit,
// typography, persona and scenes, ranked above the fixed examples earlier in
// the prompt.
func (v DesignVariation) PromptBlock(imageType string) string {
	kind := strings.TrimSpace(imageType)
	var b strings.Builder
	b.WriteString("【本轮版式方案·" + DesignPlaybookVersion + "】\n")
	b.WriteString("本方案由服务端为本轮随机抽取（编号 " + v.Seed + "），同一风格再次生成也会换一套版式、UI 元素与人物。它优先于前文所有固定的版式、机位与人物示例：逐张分镜约束与整套内容分镜、九屏与页面大纲示例、头部品牌详情页的骨架示例、按品类给出的模特人设与字体示例、“最后一屏上图下卡”的固定写法。已选方向的配色、光线、视觉锁定句与整体气质，商品真实性与平台规则，以及用户明确指定的内容、无文字、白底和不要人物等要求，仍然高于本方案")
	if v.UIKit != "" {
		b.WriteString("；UI 套件、字体与场景在已选方向的气质内落地，颜色与质感跟随方向")
	}
	b.WriteString("。\n")
	same := len(v.Layouts) > 1
	for _, layout := range v.Layouts {
		same = same && layout == v.Layouts[0]
	}
	switch {
	case same:
		fmt.Fprintf(&b, "全部 %d 张使用同一版式，只换真实的 SKU 或视角，不新增颜色或款式：%s\n", len(v.Layouts), v.Layouts[0])
	case len(v.Layouts) > 0:
		if kind == "detail" {
			b.WriteString("逐屏版式：第 N 屏的 composition、informationComponent 与 prompt 必须落实对应版式；informationComponent 以版式开头的分类开头，再写清位置、层级、间距与手机端可读性；可按商品细化位置、文案与道具，但不换成别的骨架。\n")
		} else {
			b.WriteString("逐张版式：第 N 张的 composition 与 prompt 必须落实对应版式；可按商品细化位置、文案与道具，但不换成别的骨架，相邻两张不退回同一构图。\n")
		}
		for i, layout := range v.Layouts {
			fmt.Fprintf(&b, "图%d：%s\n", i+1, layout)
		}
	}
	if v.UIKit != "" {
		b.WriteString("UI 套件（标签、图标、引线与放大窗、编号与卡片、装饰整套统一）：" + v.UIKit + "\n")
	}
	if v.Typography != "" {
		b.WriteString("字体（整套统一，优先于前文按品类给出的字体示例；跨境平台用目标语言的同气质字形）：" + v.Typography + "\n")
	}
	if v.Persona != "" {
		b.WriteString("人物设定（整套同一角色，只在版式需要人物的页面出现，各页换动作、景别与场景；用户启用模特并上传模特图时以模特图为准，用户要求不要人物时不出现）：" + v.Persona + "\n")
	}
	if len(v.Scenes) > 0 {
		b.WriteString("场景库（按页取用，不同页面用不同场景，改写成适合本商品与已选方向布景的具体画面）：" + strings.Join(v.Scenes, "；") + "\n")
	}
	if v.UIKit == "" {
		b.WriteString("本轮全部是纯白合规画面：纯白背景、无道具、无新增文字与图形，只执行上述角度、阴影、布光与陈列差异；visualStrategy 写明逐张的角度与光影安排。")
		return b.String()
	}
	if kind == "detail" {
		b.WriteString("商品状态按各屏括号内的提示轮换，并与【商品状态多样化】一致。")
	}
	named := []string{"UI 套件"}
	if v.Typography != "" {
		named = append(named, "字体")
	}
	if v.Persona != "" {
		named = append(named, "人物设定")
	}
	b.WriteString("用户选择无文字时，版式中的标题、标签与编号区改为留白，不添加任何文字。visualStrategy 必须写明本方案的 " + strings.Join(named, "、") + "，并说明逐张版式如何落实。")
	return b.String()
}
