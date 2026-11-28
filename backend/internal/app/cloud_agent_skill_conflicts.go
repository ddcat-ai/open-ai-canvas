package app

import "strings"

// 技能角色回答「这个包装的是哪一层」，互斥组回答「同一轮能不能同时开」。
// 两者分开：知识层可以和一个生产主控共存，但同组生产主控只能选一个。
const (
	cloudAgentSkillRoleKnowledge   = "knowledge"
	cloudAgentSkillRoleProduction  = "production"
	cloudAgentSkillRolePrompt      = "prompt"
	cloudAgentSkillRoleMethod      = "method"
	cloudAgentSkillRolePostprocess = "postprocess"
	cloudAgentSkillRoleGuide       = "guide"
)

// 出片位内部再分两级：完整主控能独立跑完一条片子，
// 品类工位只负责某一品类或某一素材形态。两级都占用出片位，不能并行。
const (
	cloudAgentSkillTierFull     = "full"
	cloudAgentSkillTierCategory = "category"
)

// 互斥组。组内任意两个包都会争同一轮的工具链和上下文，
// 同一时间只能有一个 primary，需要衔接时按顺序切换，不能并行注入。
const (
	cloudAgentSkillGroupStoryKnowledge     = "knowledge-story"
	cloudAgentSkillGroupMarketingKnowledge = "knowledge-marketing"
	cloudAgentSkillGroupProduction         = "production"
	cloudAgentSkillGroupVideoModel         = "video-model-prompt"
	cloudAgentSkillGroupPromptSchema       = "prompt-schema"
)

type cloudAgentSkillProfile struct {
	ID      string
	Name    string
	Aliases []string
	Role    string
	Group   string
	// Tier 只对出片位有效：full 是能独立成片的完整主控，category 是品类工位。
	Tier string
	// Scope 只用于文档与测试说明，不随检索结果下发。
	Scope string
}

// cloudAgentSkillProfiles 是内置技能的角色与互斥组唯一事实来源。
// 新增重型包时必须在这里登记，否则 skills_conflict_test 会失败。
var cloudAgentSkillProfiles = []cloudAgentSkillProfile{
	// 知识层：可以和一个生产主控共存；同组的知识体系互相重复。
	{ID: "14811816983052", Name: "故事与影像制作-源起", Aliases: []string{"故事开发"}, Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupStoryKnowledge, Scope: "故事结构、角色、剧本、短剧、分镜知识层"},
	{ID: "yingshi-drama-workshop", Name: "影视剧作工坊", Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupStoryKnowledge, Scope: "影视剧本、视觉开发与分镜知识包"},
	{ID: "16000000000081", Name: "短剧实战手册", Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupStoryKnowledge, Scope: "短剧钩子、付费点与反转方法卡"},
	{ID: "16000000000105", Name: "营销与转化-源起", Aliases: []string{"广告全链路打法"}, Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupMarketingKnowledge, Scope: "广告调研、战役、脚本与投放策略"},
	{ID: "16000000000097", Name: "广告文案四步系统", Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupMarketingKnowledge, Scope: "标题、长文案与投放时机"},
	{ID: "16000000000098", Name: "消费心理转化设计", Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupMarketingKnowledge, Scope: "价格锚点、选择架构与行动指令"},
	{ID: "16000000000099", Name: "决策思维模型格森", Role: cloudAgentSkillRoleKnowledge, Scope: "多模型交叉验证的判断方法"},
	{ID: "16000000000100", Name: "体验设计五原则", Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupMarketingKnowledge, Scope: "门店、活动与内容体验设计"},
	{ID: "16000000000102", Name: "定位与命名策略", Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupMarketingKnowledge, Scope: "品牌定位、命名与生命周期"},
	{ID: "16000000000104", Name: "故事营销八阶段", Role: cloudAgentSkillRoleKnowledge, Group: cloudAgentSkillGroupMarketingKnowledge, Scope: "需求内容与品牌故事推进"},
	{ID: "16000000000078", Name: "散文质地工艺", Role: cloudAgentSkillRoleKnowledge, Scope: "散文与长文案的质地打磨"},

	// 出片位：能独立串工具出成片或成图。同一轮只留一个 primary。
	// full=完整主控（可独立跑完一条片子），category=品类工位（只管某品类或某素材形态）。
	{ID: "14811816970252", Name: "剧本资产视频一条龙创作", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierFull, Scope: "创意到短片的完整生产链"},
	{ID: "14811816983308", Name: "三幕式短剧工厂", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierFull, Scope: "一句话剧情到多集短剧"},
	{ID: "14811816981772", Name: "一图成片-电影广告全能导演", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierFull, Scope: "图片到电影、广告、社媒、电商视频"},
	{ID: "14811816970508", Name: "叙事短片导演分镜", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierFull, Scope: "森海风格叙事短片从分镜到成片"},
	{ID: "yingce-short-drama-workflow", Name: "影策短剧制作工作流", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierFull, Scope: "小说或剧本到短剧成片与资产核验"},
	{ID: "14811816960780", Name: "珠宝电商图文视频一站式", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "珠宝品类主图、详情页与短视频"},
	{ID: "14519800321292", Name: "顶级波普视觉广告导演", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "快消品 12 秒波普广告分镜与成片"},
	{ID: "14811816980748", Name: "数字人搞笑采访视频生成", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "15 秒数字人喜剧采访短片"},
	{ID: "14889292802060", Name: "社媒素人App宣传", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "App 截图到素人 UGC 宣传视频"},
	{ID: "14811816961036", Name: "TikTok网红带货视频", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "TikTok 带货短视频脚本"},
	{ID: "14811816962060", Name: "高能未来电子产品广告视频", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "电子产品电影感广告视频"},
	{ID: "14811816962316", Name: "穿搭上身试穿视频生成", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "15 秒竖版穿搭试穿视频"},
	{ID: "14811816961804", Name: "ASMR沉浸式潮玩开箱导演", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "10 秒竖版 ASMR 开箱视频"},
	{ID: "14811816961292", Name: "绿幕猫咪跳舞素材生成", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "单段绿幕抠图素材"},
	{ID: "14811816969996", Name: "角色精灵图动画产线", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "游戏角色逐帧序列动画"},
	{ID: "14889292801804", Name: "3D国漫风转身变身特效", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "360 度旋转变身特效脚本"},
	{ID: "14811816982028", Name: "系列套图生成", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "母版到系列图的批量生产"},
	{ID: "14811816960268", Name: "小红书素人穿搭配方", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "小红书素人穿搭上身图"},
	{ID: "14811816962572", Name: "AI造型师高转化模特图", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "服装电商模特展示图"},
	{ID: "14811816981516", Name: "二维动画线稿批量上色", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "线稿批量统一上色"},
	{ID: "14811816969484", Name: "珠宝设计出款", Role: cloudAgentSkillRoleProduction, Group: cloudAgentSkillGroupProduction, Tier: cloudAgentSkillTierCategory, Scope: "珠宝单款、批量与系列出款"},

	// 提示词体系：每个包都定义一套提示词结构，混用会互相打架。
	{ID: "16000000000090", Name: "H3 视频提示词套件", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupVideoModel, Scope: "MiniMax H3 六段式提示词"},
	{ID: "16000000000092", Name: "Seedance 2.5 导演工艺", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupVideoModel, Scope: "Seedance 2.5 资产锁定与连续性"},
	{ID: "16000000000093", Name: "Seedance 提示词工程", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupVideoModel, Scope: "Seedance 1.x 八块公式与参考图语法"},
	{ID: "16000000000091", Name: "模型路由交互", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupVideoModel, Scope: "模型未定时的选型与兜底"},
	{ID: "16000000000095", Name: "视觉提示词工程", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupPromptSchema, Scope: "四层结构、五槽模板与反向解构"},
	{ID: "14811816960524", Name: "名导十五秒视频风格资产引擎", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupPromptSchema, Scope: "参考图视觉基因到 15 秒提示词资产"},
	{ID: "15507072002828", Name: "人像捏脸导演", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupPromptSchema, Scope: "脸谱与五官细项的生图提示词"},
	{ID: "15434297644556", Name: "先锋服装商拍视觉指导", Role: cloudAgentSkillRolePrompt, Group: cloudAgentSkillGroupPromptSchema, Scope: "先锋时装大片的五段短 Prompt"},

	// 单点方法：同一轮只读最相关的一张，不单独构成生产链。
	{ID: "14811816982284", Name: "角色设计", Role: cloudAgentSkillRoleMethod, Scope: "人设内核、行为与视觉概念"},
	{ID: "14811816982796", Name: "剧本撰写", Role: cloudAgentSkillRoleMethod, Scope: "场景、对白与动作描述"},
	{ID: "14811816982540", Name: "世界观美术设定", Role: cloudAgentSkillRoleMethod, Scope: "世界观法则与场景设定"},
	{ID: "16000000000079", Name: "系列弧光规划", Role: cloudAgentSkillRoleMethod, Scope: "季弧、试播集与分集刻画"},
	{ID: "16000000000094", Name: "分镜语法", Role: cloudAgentSkillRoleMethod, Scope: "屏幕方向、运动镜头与预演"},
	{ID: "16000000000096", Name: "视觉基调设计", Role: cloudAgentSkillRoleMethod, Scope: "色彩、光线与摄影机运动基调"},
	{ID: "16000000000087", Name: "视听理论基础", Role: cloudAgentSkillRoleMethod, Scope: "声画对位与视听判断"},
	{ID: "16000000000086", Name: "AI 表演实验室", Aliases: []string{"AI表演实验室"}, Role: cloudAgentSkillRoleMethod, Scope: "表情、眼神与表演诊断"},
	{ID: "16000000000074", Name: "喜剧 Mechanics", Role: cloudAgentSkillRoleMethod, Scope: "段子、情景喜剧与相声捧逗"},
	{ID: "16000000000077", Name: "一镜到底短剧流水线", Role: cloudAgentSkillRoleMethod, Scope: "OnlySHOT 首尾帧、时长、成本与失败分诊方法"},
	{ID: "14889899551756", Name: "OC魅力诊断师", Role: cloudAgentSkillRoleMethod, Scope: "30 秒短剧角色出场诊断"},
	{ID: "15215320902412", Name: "治愈系原创IP孵化助手", Role: cloudAgentSkillRoleMethod, Scope: "治愈系 IP 设定与首批选题"},

	// 后处理：只在成片或成图之后追加，不参与主控选型。
	{ID: "16000000000088", Name: "剪辑节奏", Role: cloudAgentSkillRolePostprocess, Scope: "连续性、平行剪辑与转场"},
	{ID: "16000000000101", Name: "发布片三件套", Role: cloudAgentSkillRolePostprocess, Scope: "A/B 变体、卡点与多画幅"},
	{ID: "doubao-audio-prompt", Name: "豆包音频提示词", Role: cloudAgentSkillRolePostprocess, Scope: "台词与声音提示词"},
	{ID: "yingce-image-editing", Name: "图片编辑工作流", Role: cloudAgentSkillRolePostprocess, Scope: "改图、标注编辑与图层拆分"},

	// 指路：只做选包，不做创作，不占生产位。
	{ID: "16000000000107", Name: "技能选择指南", Aliases: []string{"选包门房"}, Role: cloudAgentSkillRoleGuide, Scope: "模糊需求到具体卡片的指路"},
}

var cloudAgentSkillProfileByID, cloudAgentSkillProfileByName = func() (map[string]cloudAgentSkillProfile, map[string]cloudAgentSkillProfile) {
	byID := make(map[string]cloudAgentSkillProfile, len(cloudAgentSkillProfiles))
	byName := make(map[string]cloudAgentSkillProfile, len(cloudAgentSkillProfiles)*2)
	for _, profile := range cloudAgentSkillProfiles {
		byID[profile.ID] = profile
		byName[cloudAgentSkillProfileKey(profile.Name)] = profile
		for _, alias := range profile.Aliases {
			byName[cloudAgentSkillProfileKey(alias)] = profile
		}
	}
	return byID, byName
}()

// cloudAgentSkillProfileKey 统一去掉空白、连字符与大小写差异：
// 同一技能在本地改名、加后缀或换目录时仍能对上角色。
func cloudAgentSkillProfileKey(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		switch r {
		case ' ', '\t', '\n', '\r', '-', '_', '—', '－', '·':
			continue
		}
		builder.WriteRune(r)
	}
	return builder.String()
}

// cloudAgentSkillProfileFor 先按 ID 命中，再按名称兜底：
// 用户本地克隆或改名后 ID 会变，但包名通常保留。
func cloudAgentSkillProfileFor(skill cloudAgentSkill) (cloudAgentSkillProfile, bool) {
	if profile, ok := cloudAgentSkillProfileByID[strings.TrimSpace(skill.ID)]; ok {
		return profile, true
	}
	profile, ok := cloudAgentSkillProfileByName[cloudAgentSkillProfileKey(skill.Name)]
	return profile, ok
}

const cloudAgentSkillConflictGuidance = "role=knowledge 只作知识层，可与一个出片位共存；role=production 表示占用本轮出片位，productionTier=full 是能独立成片的完整主控，productionTier=category 是品类工位，二者同样只能有一个 primary；role=prompt 只选一套提示词体系；role=method 只读最相关的一张；role=postprocess 只在成片或成图后追加。conflictGroup 相同且已有 primary=true 的条目时，其余都是候选，换方案时再切换，不要并行注入两套流程。"
